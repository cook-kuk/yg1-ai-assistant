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
}

function isModelTier(value: string): value is ModelTier {
  return value === "haiku" || value === "sonnet" || value === "opus"
}

/** Resolve model ID from tier, with optional agent-level override */
export function resolveModel(tier?: ModelTier, agentName?: AgentName): string {
  // 1. Agent-specific override (highest priority)
  if (agentName) {
    const envKey = AGENT_MODEL_ENV[agentName]
    const agentModel = envKey ? process.env[envKey] : undefined
    if (agentModel) return agentModel
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
            system: systemPrompt,
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
          system: systemPrompt,
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
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      }
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
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const content = json.choices?.[0]?.message?.content ?? ""
        const durationMs = Date.now() - startMs
        if (isBenchmarkEnabled()) {
          recordBenchmarkLlmCall({
            agent: agentNameArg ?? agentName ?? null,
            model: cfg.model,
            inputTokens: json.usage?.prompt_tokens ?? 0,
            outputTokens: json.usage?.completion_tokens ?? 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            durationMs,
          })
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
    async completeWithTools() {
      throw new Error("openai-compatible completeWithTools not implemented (use Claude provider for tool use)")
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

  if (explicitProvider && explicitProvider !== "anthropic" && explicitProvider !== "claude") {
    const openai = createOpenAIProvider(agentName)
    if (openai.available()) return openai
    traceRecommendation("llm.getProviderForAgent:fallback", {
      reason: `provider=${explicitProvider} not available (model/key missing)`,
      agentName: agentName ?? null,
    }, "warn")
  }

  return getProvider()
}

export function getProvider(): LLMProvider {
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
