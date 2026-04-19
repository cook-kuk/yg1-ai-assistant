import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { appendRuntimeLog, logRuntimeError } from "@/lib/runtime-logger"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

type AnthropicMessageCreateParams = Anthropic.MessageCreateParamsNonStreaming
type AnthropicMessageCreateResult = Anthropic.Message

function summarizeAnthropicRequest(request: AnthropicMessageCreateParams) {
  const textMessages = request.messages.map(message => ({
    role: message.role,
    preview: Array.isArray(message.content)
      ? JSON.stringify(message.content).slice(0, 180)
      : String(message.content).slice(0, 180),
    length: Array.isArray(message.content)
      ? JSON.stringify(message.content).length
      : String(message.content).length,
  }))
  const lastUser = [...textMessages].reverse().find(message => message.role === "user")
  const lastAssistant = [...textMessages].reverse().find(message => message.role === "assistant")
  return {
    model: request.model,
    max_tokens: request.max_tokens,
    systemPreview: typeof request.system === "string" ? request.system.slice(0, 180) : null,
    systemLength: typeof request.system === "string" ? request.system.length : 0,
    messageCount: request.messages.length,
    messageRoles: request.messages.map(message => message.role),
    lastUserPreview: lastUser?.preview ?? null,
    lastAssistantPreview: lastAssistant?.preview ?? null,
    toolCount: Array.isArray(request.tools) ? request.tools.length : 0,
    toolNames: Array.isArray(request.tools) ? request.tools.map(tool => tool.name) : [],
  }
}

function summarizeAnthropicResponse(response: AnthropicMessageCreateResult) {
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("\n")
  return {
    model: response.model,
    id: response.id,
    type: response.type,
    role: response.role,
    contentTypes: response.content.map(block => block.type),
    textPreview: text.slice(0, 180),
    textLength: text.length,
    stop_reason: response.stop_reason,
    usage: response.usage ?? null,
  }
}

export async function createAnthropicMessageWithLogging(params: {
  client: Anthropic
  request: AnthropicMessageCreateParams
  route: string
  operation: string
}): Promise<AnthropicMessageCreateResult> {
  const startedAt = Date.now()
  traceRecommendation("llm.anthropic.request", {
    route: params.route,
    operation: params.operation,
    request: summarizeAnthropicRequest(params.request),
  })

  await appendRuntimeLog({
    category: "llm",
    event: "anthropic.request",
    context: {
      provider: "anthropic",
      route: params.route,
      operation: params.operation,
      request: params.request,
    },
  })

  try {
    const response = await params.client.messages.create(params.request)
    const durationMs = Date.now() - startedAt
    traceRecommendation("llm.anthropic.response", {
      route: params.route,
      operation: params.operation,
      durationMs,
      response: summarizeAnthropicResponse(response),
    })

    // One-liner grep target — mirrors `[openai:cache-hit]` in provider.ts
    // so ops can `grep '[anthropic:tokens]'` for quota / cost drift across
    // the whole runtime without parsing structured logs. Cache-* fields
    // come from prompt-cache responses and are 0 on plain calls.
    const usage = response.usage
    if (usage) {
      const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0
      const cacheCreate = (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0
      // eslint-disable-next-line no-console
      console.log(
        `[anthropic:tokens] route=${params.route} op=${params.operation} ` +
        `model=${response.model} in=${usage.input_tokens} out=${usage.output_tokens} ` +
        `cache_r=${cacheRead} cache_w=${cacheCreate} stop=${response.stop_reason} ${durationMs}ms`,
      )
    }

    await appendRuntimeLog({
      category: "llm",
      event: "anthropic.response",
      context: {
        provider: "anthropic",
        route: params.route,
        operation: params.operation,
        durationMs,
        response,
      },
    })

    return response
  } catch (error) {
    traceRecommendationError("llm.anthropic.error", error, {
      route: params.route,
      operation: params.operation,
      durationMs: Date.now() - startedAt,
      request: params.request,
    })
    await logRuntimeError({
      category: "llm",
      event: "anthropic.error",
      error,
      context: {
        provider: "anthropic",
        route: params.route,
        operation: params.operation,
        durationMs: Date.now() - startedAt,
        request: params.request,
      },
    })
    throw error
  }
}
