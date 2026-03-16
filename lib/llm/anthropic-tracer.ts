import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { appendRuntimeLog, logRuntimeError } from "@/lib/runtime-logger"

type AnthropicMessageCreateParams = Anthropic.MessageCreateParamsNonStreaming
type AnthropicMessageCreateResult = Anthropic.Message

export async function createAnthropicMessageWithLogging(params: {
  client: Anthropic
  request: AnthropicMessageCreateParams
  route: string
  operation: string
}): Promise<AnthropicMessageCreateResult> {
  const startedAt = Date.now()

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

    await appendRuntimeLog({
      category: "llm",
      event: "anthropic.response",
      context: {
        provider: "anthropic",
        route: params.route,
        operation: params.operation,
        durationMs: Date.now() - startedAt,
        response,
      },
    })

    return response
  } catch (error) {
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
