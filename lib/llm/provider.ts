/**
 * LLM Provider Abstraction
 * Supports Claude (with tool_use), OpenAI (placeholder), Azure (placeholder).
 * Falls back to deterministic summary if no key available.
 */

import { createAnthropicMessageWithLogging } from "@/lib/llm/anthropic-tracer"
import { isBenchmarkEnabled, recordBenchmarkLlmCall } from "@/lib/llm/benchmark-collector"
import { logRuntimeError } from "@/lib/runtime-logger"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import Anthropic from "@anthropic-ai/sdk"

export interface LLMMessage { role: "user" | "assistant"; content: string }

/**
 * Anthropic prefix caching helper.
 *
 * Splits a system prompt into static (cached) and dynamic (per-request) blocks.
 * Static text gets cache_control: ephemeral so subsequent calls within ~5 min
 * pay 90% less for the cached prefix tokens.
 *
 * Convention: callers insert "===DYNAMIC===" between the static prefix and the
 * dynamic suffix. If the marker is absent, the entire prompt is treated as a
 * single cacheable block (best-effort caching for legacy callers).
 */
const PREFIX_CACHE_MARKER = "===DYNAMIC==="
const MIN_CACHEABLE_LENGTH = 1024 // Anthropic requires ≥1024 input tokens for caching; ~4 chars/token
function buildCacheableSystem(systemPrompt: string): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  const idx = systemPrompt.indexOf(PREFIX_CACHE_MARKER)
  if (idx < 0) {
    if (systemPrompt.length < MIN_CACHEABLE_LENGTH) {
      return [{ type: "text", text: systemPrompt }]
    }
    return [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
  }
  const staticPart = systemPrompt.slice(0, idx).trim()
  const dynamicPart = systemPrompt.slice(idx + PREFIX_CACHE_MARKER.length).trim()
  const blocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = []
  if (staticPart) {
    if (staticPart.length >= MIN_CACHEABLE_LENGTH) {
      blocks.push({ type: "text", text: staticPart, cache_control: { type: "ephemeral" } })
    } else {
      blocks.push({ type: "text", text: staticPart })
    }
  }
  if (dynamicPart) blocks.push({ type: "text", text: dynamicPart })
  return blocks
}

export interface LLMTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LLMToolResult {
  toolName: string
  input: Record<string, unknown>
}

/** Model tier for multi-agent routing */
export type ModelTier = "haiku" | "sonnet" | "opus"
export type ModelSpecifier = ModelTier | string

/** Agent name for per-agent model override */
export type AgentName =
  | "intent-classifier"
  | "parameter-extractor"
  | "comparison"
  | "response-composer"
  | "ambiguity-resolver"
  | "semantic-turn-extractor"
  | "unified-judgment"
  | "query-decomposer"
  | "turn-orchestrator"
  | "tool-use-router"
  | "single-call-router"
  | "query-planner"
  | "self-correction"
  | "turn-repair"

export interface LLMProvider {
  complete(systemPrompt: string, messages: LLMMessage[], maxTokens?: number, model?: ModelSpecifier, agentName?: AgentName): Promise<string>
  completeWithTools(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens?: number,
    model?: ModelSpecifier,
    agentName?: AgentName
  ): Promise<{ text: string | null; toolUse: LLMToolResult | null }>
  /**
   * Optional: yield raw text deltas as the model produces them. Used for true
   * token-by-token streaming (Claude-style). Callers should fall back to
   * complete() when this is absent. Implementations are free to skip benchmark
   * recording on this path — the streaming surface is for UI realtime, the
   * non-streaming complete() path remains the source of truth for telemetry.
   */
  stream?(systemPrompt: string, messages: LLMMessage[], maxTokens?: number, model?: ModelSpecifier, agentName?: AgentName): AsyncIterable<string>
  available(): boolean
}

function summarizeMessages(messages: LLMMessage[]) {
  const lastUser = [...messages].reverse().find(message => message.role === "user")
  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant")
  return {
    count: messages.length,
    roles: messages.map(message => message.role),
    lastUserPreview: lastUser?.content.slice(0, 180) ?? null,
    lastUserLength: lastUser?.content.length ?? 0,
    lastAssistantPreview: lastAssistant?.content.slice(0, 180) ?? null,
    lastAssistantLength: lastAssistant?.content.length ?? 0,
  }
}

function summarizeTextBlocks(blocks: Anthropic.ContentBlock[]) {
  const contentTypes = blocks.map(block => block.type)
  const textBlocks = blocks.filter((block): block is Anthropic.TextBlock => block.type === "text")
  const joinedText = textBlocks.map(block => block.text).join("\n")
  return {
    contentTypes,
    textBlockCount: textBlocks.length,
    textPreview: joinedText.slice(0, 180),
    textLength: joinedText.length,
  }
}

function anthropicMainModel(): string {
  return process.env.ANTHROPIC_MODEL
    || process.env.ANTHROPIC_FAST_MODEL
    || process.env.ANTHROPIC_SONNET_MODEL
    || process.env.ANTHROPIC_HAIKU_MODEL
    || process.env.ANTHROPIC_OPUS_MODEL
    || ""
}

/** Agent-specific env var mapping */
const AGENT_MODEL_ENV: Record<AgentName, string> = {
  "intent-classifier":    "AGENT_INTENT_CLASSIFIER_MODEL",
  "parameter-extractor":  "AGENT_PARAMETER_EXTRACTOR_MODEL",
  "comparison":           "AGENT_COMPARISON_MODEL",
  "response-composer":    "AGENT_RESPONSE_COMPOSER_MODEL",
  "ambiguity-resolver":   "AGENT_AMBIGUITY_RESOLVER_MODEL",
  "semantic-turn-extractor": "AGENT_SEMANTIC_TURN_EXTRACTOR_MODEL",
  "unified-judgment":        "AGENT_UNIFIED_JUDGMENT_MODEL",
  "query-decomposer":        "AGENT_QUERY_DECOMPOSER_MODEL",
  "turn-orchestrator":       "AGENT_TURN_ORCHESTRATOR_MODEL",
  "tool-use-router":         "AGENT_TOOL_USE_ROUTER_MODEL",
  "single-call-router":      "AGENT_SINGLE_CALL_ROUTER_MODEL",
  "query-planner":           "AGENT_QUERY_PLANNER_MODEL",
  "self-correction":         "AGENT_SELF_CORRECTION_MODEL",
  "turn-repair":             "AGENT_TURN_REPAIR_MODEL",
}

function isModelTier(value: string): value is ModelTier {
  return value === "haiku" || value === "sonnet" || value === "opus"
}

/** Resolve model ID from tier, with optional agent-level override.
 *
 *  IMPORTANT: AGENT_<NAME>_MODEL is only honored when AGENT_<NAME>_PROVIDER
 *  is anthropic/empty. Otherwise that env var holds an OpenAI model id like
 *  "gpt-5.4-mini" — we must NOT pass it to the Anthropic API or it 404s.
 *  This came up in shadow mode where Claude and OpenAI are both invoked for
 *  the same agent, so the Claude side hit the OpenAI model id by mistake.
 */
export function resolveModel(tier?: ModelTier, agentName?: AgentName): string {
  // 1. Agent-specific override — only when this agent is anthropic-routed.
  if (agentName) {
    const envKey = AGENT_MODEL_ENV[agentName]
    const providerKey = `AGENT_${agentName.toUpperCase().replace(/-/g, "_")}_PROVIDER`
    const agentProvider = (process.env[providerKey] || "").toLowerCase()
    const isAnthropic = !agentProvider || agentProvider === "anthropic" || agentProvider === "claude"
    if (isAnthropic) {
      const agentModel = envKey ? process.env[envKey] : undefined
      if (agentModel) return agentModel
    }
  }

  // 2. Tier-level default
  if (!tier) return anthropicMainModel()
  switch (tier) {
    case "haiku":  return process.env.ANTHROPIC_HAIKU_MODEL  || anthropicMainModel()
    case "sonnet": return process.env.ANTHROPIC_SONNET_MODEL || anthropicMainModel()
    case "opus":   return process.env.ANTHROPIC_OPUS_MODEL   || anthropicMainModel()
  }
}

export function resolveModelInput(model?: ModelSpecifier, agentName?: AgentName): string {
  if (!model) return resolveModel(undefined, agentName)
  return isModelTier(model) ? resolveModel(model, agentName) : model
}

// ── Claude Provider ───────────────────────────────────────────
export function createClaudeProvider(): LLMProvider {
  return {
    available() { return !!process.env.ANTHROPIC_API_KEY },

    async complete(systemPrompt, messages, maxTokens = 1500, model?, agentName?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const resolvedModel = resolveModelInput(model, agentName)
      if (!resolvedModel) throw new Error("No Anthropic model configured in environment")
      const startMs = Date.now()
      traceRecommendation("llm.provider.complete:input", {
        model: resolvedModel,
        agentName: agentName ?? null,
        maxTokens,
        systemPromptPreview: systemPrompt.slice(0, 180),
        systemPromptLength: systemPrompt.length,
        messages: summarizeMessages(messages),
      })
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
        const response = await createAnthropicMessageWithLogging({
          client,
          route: "/api/recommend",
          operation: "provider.complete",
          request: {
            model: resolvedModel as Parameters<typeof client.messages.create>[0]["model"],
            max_tokens: maxTokens,
            system: buildCacheableSystem(systemPrompt) as Parameters<typeof client.messages.create>[0]["system"],
            messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
          },
        })
        const content = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map(block => block.text)
          .join("\n")

        // Slack LLM 알림 (비동기)
        import("@/lib/slack-notifier").then(({ notifyLlmCall }) =>
          notifyLlmCall({
            model: resolvedModel,
            route: "/api/recommend",
            promptPreview: messages[messages.length - 1]?.content ?? "",
            responsePreview: content,
            durationMs: Date.now() - startMs,
          }).catch(() => {})
        )

        const completeDurationMs = Date.now() - startMs
        if (isBenchmarkEnabled()) {
          const u = response.usage as unknown as Record<string, number> | undefined
          recordBenchmarkLlmCall({
            agent: agentName ?? null,
            model: resolvedModel,
            provider: "anthropic",
            inputTokens: u?.input_tokens ?? 0,
            outputTokens: u?.output_tokens ?? 0,
            cacheReadTokens: u?.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
            durationMs: completeDurationMs,
          })
        }
        traceRecommendation("llm.provider.complete:output", {
          model: resolvedModel,
          agentName: agentName ?? null,
          durationMs: completeDurationMs,
          textPreview: content.slice(0, 180),
          textLength: content.length,
          contentBlocks: summarizeTextBlocks(response.content),
          usage: response.usage ?? null,
        })
        return content
      } catch (error) {
        traceRecommendationError("llm.provider.complete:error", error, {
          model: resolvedModel,
          agentName: agentName ?? null,
          maxTokens,
        })
        await logRuntimeError({
          category: "llm",
          event: "provider.complete.error",
          error,
          context: {
            route: "/api/recommend",
            model: resolvedModel,
            maxTokens,
          },
        })
        throw error
      }
    },

    async *stream(systemPrompt, messages, maxTokens = 1500, model?, agentName?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const resolvedModel = resolveModelInput(model, agentName)
      if (!resolvedModel) throw new Error("No Anthropic model configured in environment")
      const startMs = Date.now()
      traceRecommendation("llm.provider.stream:input", {
        model: resolvedModel,
        agentName: agentName ?? null,
        maxTokens,
        systemPromptLength: systemPrompt.length,
        messages: summarizeMessages(messages),
      })
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      let accumulated = ""
      try {
        const stream = client.messages.stream({
          model: resolvedModel as Parameters<typeof client.messages.create>[0]["model"],
          max_tokens: maxTokens,
          system: buildCacheableSystem(systemPrompt) as Parameters<typeof client.messages.create>[0]["system"],
          messages: messages as Parameters<typeof client.messages.create>[0]["messages"],
        })
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            const chunk = event.delta.text
            if (chunk) {
              accumulated += chunk
              yield chunk
            }
          }
        }
        traceRecommendation("llm.provider.stream:output", {
          model: resolvedModel,
          agentName: agentName ?? null,
          durationMs: Date.now() - startMs,
          textLength: accumulated.length,
          textPreview: accumulated.slice(0, 180),
        })
      } catch (error) {
        traceRecommendationError("llm.provider.stream:error", error, {
          model: resolvedModel,
          agentName: agentName ?? null,
        })
        throw error
      }
    },

    async completeWithTools(systemPrompt, messages, tools, maxTokens = 1500, model?, agentName?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const resolvedModel = resolveModelInput(model, agentName)
      if (!resolvedModel) throw new Error("No Anthropic model configured in environment")
      const startMs = Date.now()
      traceRecommendation("llm.provider.completeWithTools:input", {
        model: resolvedModel,
        agentName: agentName ?? null,
        maxTokens,
        systemPromptPreview: systemPrompt.slice(0, 180),
        systemPromptLength: systemPrompt.length,
        messages: summarizeMessages(messages),
        toolCount: tools.length,
        toolNames: tools.map(tool => tool.name),
      })
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
        const resp = await client.messages.create({
          model: resolvedModel as Parameters<typeof client.messages.create>[0]["model"],
          max_tokens: maxTokens,
          system: buildCacheableSystem(systemPrompt) as Parameters<typeof client.messages.create>[0]["system"],
          messages,
          tools: tools as Parameters<typeof client.messages.create>[0]["tools"],
          tool_choice: { type: "auto" },
        })

        let text: string | null = null
        let toolUse: LLMToolResult | null = null

        for (const block of resp.content) {
          if (block.type === "text") text = block.text
          if (block.type === "tool_use") {
            toolUse = {
              toolName: block.name,
              input: block.input as Record<string, unknown>,
            }
          }
        }

        // Slack: send prompt + tool choice for debugging
        const durationMs = Date.now() - startMs
        const lastUserMsg = messages[messages.length - 1]?.content ?? ""
        const toolNames = tools.map((t: LLMTool) => t.name).join(", ")
        import("@/lib/slack-notifier").then(({ notifyLlmCall }) =>
          notifyLlmCall({
            model: resolvedModel,
            route: "tool-use-router",
            promptPreview: `[system: ${systemPrompt.slice(0, 200)}...]\n[tools: ${toolNames}]\n[user: ${typeof lastUserMsg === "string" ? lastUserMsg.slice(0, 150) : JSON.stringify(lastUserMsg).slice(0, 150)}]`,
            responsePreview: toolUse
              ? `TOOL: ${toolUse.toolName}(${JSON.stringify(toolUse.input).slice(0, 200)})`
              : `TEXT: ${(text ?? "").slice(0, 300)}`,
            durationMs,
            inputTokens: resp.usage?.input_tokens,
            outputTokens: resp.usage?.output_tokens,
          }).catch(() => {})
        )

        if (isBenchmarkEnabled()) {
          const u = resp.usage as unknown as Record<string, number> | undefined
          recordBenchmarkLlmCall({
            agent: agentName ?? null,
            model: resolvedModel,
            provider: "anthropic",
            inputTokens: u?.input_tokens ?? 0,
            outputTokens: u?.output_tokens ?? 0,
            cacheReadTokens: u?.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
            durationMs,
          })
        }
        traceRecommendation("llm.provider.completeWithTools:output", {
          model: resolvedModel,
          agentName: agentName ?? null,
          durationMs,
          textPreview: text?.slice(0, 180) ?? null,
          textLength: text?.length ?? 0,
          toolUse: toolUse
            ? {
                toolName: toolUse.toolName,
                inputKeys: Object.keys(toolUse.input),
              }
            : null,
          usage: resp.usage ?? null,
          content: summarizeTextBlocks(resp.content),
        })
        return { text, toolUse }
      } catch (error) {
        traceRecommendationError("llm.provider.completeWithTools:error", error, {
          model: resolvedModel,
          agentName: agentName ?? null,
          maxTokens,
          toolCount: tools.length,
        })
        await logRuntimeError({
          category: "llm",
          event: "provider.completeWithTools.error",
          error,
          context: {
            route: "/api/recommend",
            model: resolvedModel,
            maxTokens,
            toolCount: tools.length,
          },
        })
        throw error
      }
    },
  }
}

// ── OpenAI-compatible Provider ────────────────────────────────
// Works with: OpenAI, Groq, Google Gemini, xAI Grok, DeepSeek, Mistral,
// Together, Fireworks, OpenRouter, Ollama, LM Studio, vLLM, Azure OpenAI, ...
// Configured per agent via env vars (see resolveOpenAICompatibleConfig).
interface OpenAICompatibleConfig {
  apiKey: string
  baseURL: string
  model: string
}

/** Resolve OpenAI-compatible config with per-agent override.
 *  Priority (highest first):
 *    1. AGENT_<NAME>_PROVIDER + AGENT_<NAME>_MODEL/API_KEY/BASE_URL
 *    2. LLM_PROVIDER (global) + LLM_MODEL/API_KEY/BASE_URL
 *    3. OPENAI_* defaults
 */
function resolveOpenAICompatibleConfig(agentName?: AgentName): OpenAICompatibleConfig | null {
  const agentEnvKey = agentName ? agentName.toUpperCase().replace(/-/g, "_") : null

  function pick(suffix: string): string | undefined {
    if (agentEnvKey) {
      const v = process.env[`AGENT_${agentEnvKey}_${suffix}`]
      if (v) return v
    }
    return process.env[`LLM_${suffix}`] || process.env[`OPENAI_${suffix === "API_KEY" ? "API_KEY" : suffix}`]
  }

  // Provider preset baseURLs
  const provider = (agentEnvKey && process.env[`AGENT_${agentEnvKey}_PROVIDER`])
    || process.env.LLM_PROVIDER
    || ""
  const PROVIDER_BASE_URLS: Record<string, string> = {
    openai:     "https://api.openai.com/v1",
    groq:       "https://api.groq.com/openai/v1",
    gemini:     "https://generativelanguage.googleapis.com/v1beta/openai/",
    google:     "https://generativelanguage.googleapis.com/v1beta/openai/",
    xai:        "https://api.x.ai/v1",
    grok:       "https://api.x.ai/v1",
    deepseek:   "https://api.deepseek.com/v1",
    mistral:    "https://api.mistral.ai/v1",
    together:   "https://api.together.xyz/v1",
    fireworks:  "https://api.fireworks.ai/inference/v1",
    openrouter: "https://openrouter.ai/api/v1",
    ollama:     "http://host.docker.internal:11434/v1",
    lmstudio:   "http://host.docker.internal:1234/v1",
    vllm:       "http://host.docker.internal:8000/v1",
    local:      "http://host.docker.internal:11434/v1",
  }

  const apiKey = pick("API_KEY") || ""
  const baseURL = pick("BASE_URL") || PROVIDER_BASE_URLS[provider.toLowerCase()] || "https://api.openai.com/v1"
  const model = pick("MODEL") || ""

  // Local providers may not need API key
  const isLocal = /localhost|127\.0\.0\.1|host\.docker\.internal/i.test(baseURL)
  if (!model) return null
  if (!apiKey && !isLocal) return null
  return { apiKey: apiKey || "local", baseURL, model }
}

export function createOpenAIProvider(agentName?: AgentName): LLMProvider {
  const config = resolveOpenAICompatibleConfig(agentName)
  return {
    available() { return config != null },
    async complete(systemPrompt, messages, maxTokens = 1500, _model, agentNameArg) {
      const cfg = resolveOpenAICompatibleConfig(agentNameArg ?? agentName)
      if (!cfg) throw new Error("OpenAI-compatible provider not configured")
      const startMs = Date.now()
      const url = cfg.baseURL.replace(/\/$/, "") + "/chat/completions"
      // gpt-5.x / o1 / o3 families require max_completion_tokens and reject custom temperature
      const isReasoningModel = /^(gpt-5|o1|o3|o4)/i.test(cfg.model)
      // Strip the Anthropic prefix-cache marker — OpenAI doesn't understand it
      // and would otherwise leak the literal "===DYNAMIC===" string into the
      // model's context as noise. Replacing with a paragraph break also keeps
      // the static prefix at the front of the system message so OpenAI's
      // automatic prompt caching can pick it up cleanly.
      const cleanedSystem = systemPrompt.replace(/\s*===DYNAMIC===\s*/g, "\n\n")
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          { role: "system", content: cleanedSystem },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }
      // OpenAI prompt caching: passing prompt_cache_key buckets requests so
      // identical-prefix calls from the same agent share a cache slot. Without
      // it OpenAI still attempts auto-caching but hit rate is far lower for
      // multi-tenant workloads. Per-agent key isolates buckets cleanly.
      const cacheKey = (agentNameArg ?? agentName)
      if (cacheKey) body.prompt_cache_key = `yg1:${cacheKey}`
      if (isReasoningModel) {
        body.max_completion_tokens = maxTokens
      } else {
        body.max_tokens = maxTokens
        body.temperature = 0.1
      }
      traceRecommendation("llm.provider.complete:input", {
        provider: "openai-compatible",
        baseURL: cfg.baseURL,
        model: cfg.model,
        agentName: agentNameArg ?? agentName ?? null,
        maxTokens,
        systemPromptPreview: systemPrompt.slice(0, 180),
        systemPromptLength: systemPrompt.length,
        messages: summarizeMessages(messages),
      })
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(`openai-compatible HTTP ${res.status}: ${errText.slice(0, 400)}`)
        }
        const json = await res.json() as {
          choices?: Array<{ message?: { content?: string } }>
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            prompt_tokens_details?: { cached_tokens?: number }
          }
        }
        const content = json.choices?.[0]?.message?.content ?? ""
        const durationMs = Date.now() - startMs
        const cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? 0
        if (isBenchmarkEnabled()) {
          recordBenchmarkLlmCall({
            agent: agentNameArg ?? agentName ?? null,
            model: cfg.model,
            provider: "openai-compatible",
            inputTokens: json.usage?.prompt_tokens ?? 0,
            outputTokens: json.usage?.completion_tokens ?? 0,
            cacheReadTokens: cachedTokens,
            cacheWriteTokens: 0,
            durationMs,
          })
        }
        if (cachedTokens > 0) {
          console.log(`[openai:cache-hit] agent=${cacheKey ?? "?"} cached=${cachedTokens}/${json.usage?.prompt_tokens ?? 0} tokens (${durationMs}ms)`)
        }
        traceRecommendation("llm.provider.complete:output", {
          provider: "openai-compatible",
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
          durationMs,
          textPreview: content.slice(0, 180),
          textLength: content.length,
        })
        return content
      } catch (error) {
        traceRecommendationError("llm.provider.complete:error", error, {
          provider: "openai-compatible",
          baseURL: cfg.baseURL,
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
        })
        await logRuntimeError({
          category: "llm",
          event: "provider.complete.error",
          error,
          context: { route: "/api/recommend", provider: "openai-compatible", model: cfg.model },
        })
        throw error
      }
    },
    async *stream(systemPrompt, messages, maxTokens = 1500, _model, agentNameArg) {
      const cfg = resolveOpenAICompatibleConfig(agentNameArg ?? agentName)
      if (!cfg) throw new Error("OpenAI-compatible provider not configured")
      const startMs = Date.now()
      const url = cfg.baseURL.replace(/\/$/, "") + "/chat/completions"
      const isReasoningModel = /^(gpt-5|o1|o3|o4)/i.test(cfg.model)
      const cleanedSystem = systemPrompt.replace(/\s*===DYNAMIC===\s*/g, "\n\n")
      const body: Record<string, unknown> = {
        model: cfg.model,
        stream: true,
        messages: [
          { role: "system", content: cleanedSystem },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }
      const cacheKey = (agentNameArg ?? agentName)
      if (cacheKey) body.prompt_cache_key = `yg1:${cacheKey}`
      if (isReasoningModel) {
        body.max_completion_tokens = maxTokens
      } else {
        body.max_tokens = maxTokens
        body.temperature = 0.1
      }
      traceRecommendation("llm.provider.stream:input", {
        provider: "openai-compatible",
        model: cfg.model,
        agentName: agentNameArg ?? agentName ?? null,
        maxTokens,
        systemPromptLength: systemPrompt.length,
      })
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "")
        throw new Error(`openai-compatible stream HTTP ${res.status}: ${errText.slice(0, 400)}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let accumulated = ""
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // SSE frames are separated by blank lines; data lines start with "data: "
          let idx: number
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim()
            buf = buf.slice(idx + 1)
            if (!line.startsWith("data:")) continue
            const data = line.slice(5).trim()
            if (data === "[DONE]") {
              traceRecommendation("llm.provider.stream:output", {
                provider: "openai-compatible",
                model: cfg.model,
                agentName: agentNameArg ?? agentName ?? null,
                durationMs: Date.now() - startMs,
                textLength: accumulated.length,
              })
              return
            }
            try {
              const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
              const chunk = json.choices?.[0]?.delta?.content
              if (chunk) {
                accumulated += chunk
                yield chunk
              }
            } catch { /* ignore malformed frame */ }
          }
        }
        traceRecommendation("llm.provider.stream:output", {
          provider: "openai-compatible",
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
          durationMs: Date.now() - startMs,
          textLength: accumulated.length,
        })
      } catch (error) {
        traceRecommendationError("llm.provider.stream:error", error, {
          provider: "openai-compatible",
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
        })
        throw error
      }
    },
    async completeWithTools(systemPrompt, messages, tools, maxTokens = 1500, _model, agentNameArg) {
      const cfg = resolveOpenAICompatibleConfig(agentNameArg ?? agentName)
      if (!cfg) throw new Error("OpenAI-compatible provider not configured")
      const startMs = Date.now()
      const url = cfg.baseURL.replace(/\/$/, "") + "/chat/completions"
      const isReasoningModel = /^(gpt-5|o1|o3|o4)/i.test(cfg.model)
      const cleanedSystem = systemPrompt.replace(/\s*===DYNAMIC===\s*/g, "\n\n")
      // Anthropic LLMTool → OpenAI function tool
      const openaiTools = tools.map(t => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }))
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          { role: "system", content: cleanedSystem },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        tools: openaiTools,
        tool_choice: "auto",
      }
      const cacheKey = (agentNameArg ?? agentName)
      if (cacheKey) body.prompt_cache_key = `yg1:${cacheKey}`
      if (isReasoningModel) {
        body.max_completion_tokens = maxTokens
      } else {
        body.max_tokens = maxTokens
        body.temperature = 0.1
      }
      traceRecommendation("llm.provider.completeWithTools:input", {
        provider: "openai-compatible",
        baseURL: cfg.baseURL,
        model: cfg.model,
        agentName: agentNameArg ?? agentName ?? null,
        maxTokens,
        systemPromptPreview: systemPrompt.slice(0, 180),
        systemPromptLength: systemPrompt.length,
        messages: summarizeMessages(messages),
        toolCount: tools.length,
        toolNames: tools.map(t => t.name),
      })
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(`openai-compatible HTTP ${res.status}: ${errText.slice(0, 400)}`)
        }
        const json = await res.json() as {
          choices?: Array<{
            message?: {
              content?: string | null
              tool_calls?: Array<{
                id?: string
                type?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            prompt_tokens_details?: { cached_tokens?: number }
          }
        }
        const msg = json.choices?.[0]?.message
        const content = msg?.content ?? null
        let toolUse: LLMToolResult | null = null
        const firstCall = msg?.tool_calls?.[0]
        if (firstCall?.function?.name) {
          let parsed: Record<string, unknown> = {}
          const rawArgs = firstCall.function.arguments ?? "{}"
          try {
            parsed = JSON.parse(rawArgs) as Record<string, unknown>
          } catch {
            // Some models occasionally emit non-JSON arguments; surface as _raw
            // so callers can recover instead of silently dropping the call.
            parsed = { _raw: rawArgs }
          }
          toolUse = { toolName: firstCall.function.name, input: parsed }
        }
        const durationMs = Date.now() - startMs
        const cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? 0
        if (isBenchmarkEnabled()) {
          recordBenchmarkLlmCall({
            agent: agentNameArg ?? agentName ?? null,
            model: cfg.model,
            provider: "openai-compatible",
            inputTokens: json.usage?.prompt_tokens ?? 0,
            outputTokens: json.usage?.completion_tokens ?? 0,
            cacheReadTokens: cachedTokens,
            cacheWriteTokens: 0,
            durationMs,
          })
        }
        if (cachedTokens > 0) {
          console.log(`[openai:cache-hit] agent=${cacheKey ?? "?"} cached=${cachedTokens}/${json.usage?.prompt_tokens ?? 0} tokens (${durationMs}ms) [tools]`)
        }
        traceRecommendation("llm.provider.completeWithTools:output", {
          provider: "openai-compatible",
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
          durationMs,
          textPreview: (content ?? "").slice(0, 180),
          textLength: (content ?? "").length,
          toolUse: toolUse ? { name: toolUse.toolName, inputPreview: JSON.stringify(toolUse.input).slice(0, 200) } : null,
        })
        return { text: content, toolUse }
      } catch (error) {
        traceRecommendationError("llm.provider.completeWithTools:error", error, {
          provider: "openai-compatible",
          baseURL: cfg.baseURL,
          model: cfg.model,
          agentName: agentNameArg ?? agentName ?? null,
        })
        await logRuntimeError({
          category: "llm",
          event: "provider.completeWithTools.error",
          error,
          context: { route: "/api/recommend", provider: "openai-compatible", model: cfg.model },
        })
        throw error
      }
    },
  }
}

// ── Azure Placeholder ─────────────────────────────────────────
export function createAzureProvider(): LLMProvider {
  return {
    available() { return !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) },
    async complete() { throw new Error("Azure OpenAI provider not yet implemented") },
    async completeWithTools() { throw new Error("Azure OpenAI provider not yet implemented") },
  }
}

// ── Auto-select best available provider ───────────────────────

/**
 * Shadow wrapper: production response from `primary` (Claude). The `shadow`
 * provider (OpenAI) is fired in parallel and the paired outputs are appended
 * to test-results/_shadow-dump.jsonl for offline accuracy diff. Shadow errors
 * are swallowed and never affect the main response.
 */
function createShadowProvider(agentName: AgentName | undefined, primary: LLMProvider, shadow: LLMProvider): LLMProvider {
  return {
    available() { return primary.available() },
    async complete(systemPrompt, messages, maxTokens, model, agentNameArg) {
      const agent = agentNameArg ?? agentName ?? null
      const primaryStart = Date.now()
      const primaryPromise = primary.complete(systemPrompt, messages, maxTokens, model, agentNameArg)
        .then(out => ({ output: out, durMs: Date.now() - primaryStart, error: undefined as string | undefined }))
        .catch(err => ({ output: "", durMs: Date.now() - primaryStart, error: (err as Error).message }))
      const shadowStart = Date.now()
      const shadowPromise = shadow.complete(systemPrompt, messages, maxTokens, model, agentNameArg)
        .then(out => ({ output: out, durMs: Date.now() - shadowStart, error: undefined as string | undefined }))
        .catch(err => ({ output: "", durMs: Date.now() - shadowStart, error: (err as Error).message }))

      const primaryResult = await primaryPromise

      void (async () => {
        try {
          const shadowResult = await shadowPromise
          const { hashInput, appendShadowEntry } = await import("@/lib/llm/shadow-dump")
          const claudeModel = resolveModelInput(model, agentNameArg)
          const openaiEnvKey = agent ? agent.toUpperCase().replace(/-/g, "_") : ""
          const openaiModel = (openaiEnvKey && process.env[`AGENT_${openaiEnvKey}_MODEL`]) || "openai"
          await appendShadowEntry({
            ts: new Date().toISOString(),
            agent,
            inputHash: hashInput(systemPrompt, messages),
            claude: { model: claudeModel, output: primaryResult.output, durMs: primaryResult.durMs, error: primaryResult.error },
            openai: { model: openaiModel, output: shadowResult.output, durMs: shadowResult.durMs, error: shadowResult.error },
          })
        } catch { /* swallow */ }
      })()

      if (primaryResult.error) throw new Error(primaryResult.error)
      return primaryResult.output
    },
    async completeWithTools(systemPrompt, messages, tools, maxTokens, model, agentNameArg) {
      return primary.completeWithTools(systemPrompt, messages, tools, maxTokens, model, agentNameArg)
    },
    // Streaming bypasses the shadow comparison — UI realtime path uses primary only.
    stream: primary.stream
      ? (systemPrompt, messages, maxTokens, model, agentNameArg) =>
          primary.stream!(systemPrompt, messages, maxTokens, model, agentNameArg)
      : undefined,
  }
}

/** Per-agent provider selection.
 *  AGENT_<NAME>_PROVIDER 가 anthropic 외 값이면 OpenAI-호환 사용.
 *  미설정 시 LLM_PROVIDER 글로벌 default 확인. 둘 다 없으면 Claude.
 */
export function getProviderForAgent(agentName?: AgentName): LLMProvider {
  const agentEnvKey = agentName ? agentName.toUpperCase().replace(/-/g, "_") : null
  const explicitProvider = (
    (agentEnvKey && process.env[`AGENT_${agentEnvKey}_PROVIDER`])
    || process.env.LLM_PROVIDER
    || ""
  ).toLowerCase()

  // Shadow mode (OPENAI_SHADOW=true): primary=Claude (production response),
  // secondary=OpenAI (logged for accuracy diff). Overrides A/B ratio because
  // we want EVERY openai-routed call to dump a paired sample.
  if (explicitProvider && explicitProvider !== "anthropic" && explicitProvider !== "claude"
      && process.env.OPENAI_SHADOW === "true") {
    const openai = createOpenAIProvider(agentName)
    const claude = createClaudeProvider()
    if (openai.available() && claude.available()) {
      traceRecommendation("llm.getProviderForAgent:shadow", { agentName: agentName ?? null })
      return createShadowProvider(agentName, claude, openai)
    }
  }

  if (explicitProvider && explicitProvider !== "anthropic" && explicitProvider !== "claude") {
    // A/B traffic split: AGENT_<NAME>_OPENAI_RATIO (per-agent) or OPENAI_AB_RATIO (global).
    // Value in [0,1]. 1.0 = 100% openai (default when not set), 0.5 = half traffic to claude.
    // Random per call — aggregated stats over enough calls give the comparison.
    const ratioStr =
      (agentEnvKey && process.env[`AGENT_${agentEnvKey}_OPENAI_RATIO`])
      || process.env.OPENAI_AB_RATIO
      || ""
    const ratio = ratioStr ? parseFloat(ratioStr) : 1.0
    if (Number.isFinite(ratio) && ratio < 1.0 && Math.random() >= ratio) {
      traceRecommendation("llm.getProviderForAgent:ab-route", {
        agentName: agentName ?? null,
        chosen: "anthropic",
        ratio,
      })
      return getProvider() // Anthropic side of the A/B
    }

    const openai = createOpenAIProvider(agentName)
    if (openai.available()) {
      traceRecommendation("llm.getProviderForAgent:ab-route", {
        agentName: agentName ?? null,
        chosen: "openai",
        ratio,
      })
      return openai
    }
    traceRecommendation("llm.getProviderForAgent:fallback", {
      reason: `provider=${explicitProvider} not available (model/key missing)`,
      agentName: agentName ?? null,
    }, "warn")
  }

  return getProvider()
}

export function getProvider(): LLMProvider {
  // Global override: when LLM_PROVIDER=openai (or any non-anthropic) and an
  // OpenAI-compatible config is reachable, route the default getProvider()
  // path through it too. Without this, agents that call getProvider() directly
  // (sql-agent, llm-chip-*, semantic-turn-extractor, etc.) stay on Claude.
  const globalProvider = (process.env.LLM_PROVIDER || "").toLowerCase()
  if (globalProvider && globalProvider !== "anthropic" && globalProvider !== "claude") {
    const openai = createOpenAIProvider()
    if (openai.available()) return openai
  }

  const claude = createClaudeProvider()
  if (claude.available()) return claude

  // Deterministic fallback (no LLM, always works)
  traceRecommendation("llm.getProvider:fallback", {
    reason: "No ANTHROPIC_API_KEY available",
  }, "warn")
  return {
    available() { return true },
    async complete() { return "" },
    async completeWithTools() { return { text: null, toolUse: null } },
  }
}
