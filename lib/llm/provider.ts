/**
 * LLM Provider Abstraction
 * Supports Claude (with tool_use), OpenAI (placeholder), Azure (placeholder).
 * Falls back to deterministic summary if no key available.
 */

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

export interface LLMProvider {
  complete(systemPrompt: string, messages: LLMMessage[], maxTokens?: number, modelTier?: ModelTier): Promise<string>
  completeWithTools(
    systemPrompt: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens?: number,
    modelTier?: ModelTier
  ): Promise<{ text: string | null; toolUse: LLMToolResult | null }>
  available(): boolean
}

function anthropicMainModel(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
}

/** Resolve model ID from tier */
function resolveModel(tier?: ModelTier): string {
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

    async complete(systemPrompt, messages, maxTokens = 1024, modelTier?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const { default: Anthropic } = await import("@anthropic-ai/sdk")
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const model = resolveModel(modelTier)
      const startMs = Date.now()
      const resp = await client.messages.create({
        model: model as Parameters<typeof client.messages.create>[0]["model"],
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      })
      const content = resp.content[0]
      if (content.type !== "text") throw new Error("Unexpected content type")

      // Slack LLM 알림 (비동기)
      import("@/lib/slack-notifier").then(({ notifyLlmCall }) =>
        notifyLlmCall({
          model,
          route: "/api/recommend",
          promptPreview: messages[messages.length - 1]?.content ?? "",
          responsePreview: content.text,
          durationMs: Date.now() - startMs,
          inputTokens: resp.usage?.input_tokens,
          outputTokens: resp.usage?.output_tokens,
        }).catch(() => {})
      )

      return content.text
    },

    async completeWithTools(systemPrompt, messages, tools, maxTokens = 1024, modelTier?) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const { default: Anthropic } = await import("@anthropic-ai/sdk")
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const model = resolveModel(modelTier)
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

  // OpenAI/Azure providers are still placeholders.
  // Do not select them until real implementations exist.

  // Deterministic fallback (no LLM, always works)
  return {
    available() { return true },
    async complete() { return "" },
    async completeWithTools() { return { text: null, toolUse: null } },
  }
}
