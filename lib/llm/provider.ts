/**
 * LLM Provider Abstraction
 * Supports Claude (with tool_use), OpenAI (placeholder), Azure (placeholder).
 * Falls back to deterministic summary if no key available.
 */

import { createAnthropicMessageWithLogging } from "@/lib/llm/anthropic-tracer"
import { logRuntimeError } from "@/lib/runtime-logger"
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

/** Agent name for per-agent model override */
export type AgentName =
  | "intent-classifier"
  | "parameter-extractor"
  | "comparison"
  | "response-composer"
  | "ambiguity-resolver"

export interface LLMProvider {
  complete(systemPrompt: string, messages: LLMMessage[], maxTokens?: number, modelTier?: ModelTier, agentName?: AgentName): Promise<string>
  completeWithTools(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens?: number,
    modelTier?: ModelTier,
    agentName?: AgentName
  ): Promise<{ text: string | null; toolUse: LLMToolResult | null }>
  available(): boolean
}

function anthropicMainModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
}

/** Agent-specific env var mapping */
const AGENT_MODEL_ENV: Record<AgentName, string> = {
  "intent-classifier":    "AGENT_INTENT_CLASSIFIER_MODEL",
  "parameter-extractor":  "AGENT_PARAMETER_EXTRACTOR_MODEL",
  "comparison":           "AGENT_COMPARISON_MODEL",
  "response-composer":    "AGENT_RESPONSE_COMPOSER_MODEL",
  "ambiguity-resolver":   "AGENT_AMBIGUITY_RESOLVER_MODEL",
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
    case "haiku":  return process.env.ANTHROPIC_HAIKU_MODEL  || "claude-haiku-4-5-20251001"
    case "sonnet": return process.env.ANTHROPIC_SONNET_MODEL || anthropicMainModel()
    case "opus":   return process.env.ANTHROPIC_OPUS_MODEL   || "claude-opus-4-0-20250415"
  }
}

// ── Claude Provider ───────────────────────────────────────────
export function createClaudeProvider(): LLMProvider {
  return {
    available() { return !!process.env.ANTHROPIC_API_KEY },

    async complete(systemPrompt, messages, maxTokens = 1024, modelTier?, agentName?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const model = resolveModel(modelTier, agentName)
      const startMs = Date.now()
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
        const response = await createAnthropicMessageWithLogging({
          client,
          route: "/api/recommend",
          operation: "provider.complete",
          request: {
            model: model as Parameters<typeof client.messages.create>[0]["model"],
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
            model,
            route: "/api/recommend",
            promptPreview: messages[messages.length - 1]?.content ?? "",
            responsePreview: content,
            durationMs: Date.now() - startMs,
          }).catch(() => {})
        )

        return content
      } catch (error) {
        await logRuntimeError({
          category: "llm",
          event: "provider.complete.error",
          error,
          context: {
            route: "/api/recommend",
            model,
            maxTokens,
          },
        })
        throw error
      }
    },

    async completeWithTools(systemPrompt, messages, tools, maxTokens = 1024, modelTier?, agentName?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const model = resolveModel(modelTier, agentName)
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
        const resp = await client.messages.create({
          model: model as Parameters<typeof client.messages.create>[0]["model"],
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

        return { text, toolUse }
      } catch (error) {
        await logRuntimeError({
          category: "llm",
          event: "provider.completeWithTools.error",
          error,
          context: {
            route: "/api/recommend",
            model,
            maxTokens,
            toolCount: tools.length,
          },
        })
        throw error
      }
    },
  }
}

// ── OpenAI Placeholder ────────────────────────────────────────
export function createOpenAIProvider(): LLMProvider {
  return {
    available() { return !!process.env.OPENAI_API_KEY },
    async complete() { throw new Error("OpenAI provider not yet implemented") },
    async completeWithTools() { throw new Error("OpenAI provider not yet implemented") },
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
export function getProvider(): LLMProvider {
  const claude = createClaudeProvider()
  if (claude.available()) return claude

  // Deterministic fallback (no LLM, always works)
  return {
    available() { return true },
    async complete() { return "" },
    async completeWithTools() { return { text: null, toolUse: null } },
  }
}
