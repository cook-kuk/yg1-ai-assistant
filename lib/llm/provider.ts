/**
 * LLM Provider Abstraction
 * Supports Claude, OpenAI (placeholder), Azure (placeholder).
 * Falls back to deterministic summary if no key available.
 */

export interface LLMMessage { role: "user" | "assistant"; content: string }
export interface LLMProvider {
  complete(systemPrompt: string, messages: LLMMessage[], maxTokens?: number): Promise<string>
  available(): boolean
}

// ── Claude Provider ───────────────────────────────────────────
export function createClaudeProvider(): LLMProvider {
  return {
    available() { return !!process.env.ANTHROPIC_API_KEY },
    async complete(systemPrompt, messages, maxTokens = 512) {
      if (!this.available()) throw new Error("No ANTHROPIC_API_KEY")
      const { default: Anthropic } = await import("@anthropic-ai/sdk")
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const resp = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      })
      const content = resp.content[0]
      if (content.type !== "text") throw new Error("Unexpected content type")
      return content.text
    },
  }
}

// ── OpenAI Placeholder ────────────────────────────────────────
export function createOpenAIProvider(): LLMProvider {
  return {
    available() { return !!process.env.OPENAI_API_KEY },
    async complete(systemPrompt, messages, maxTokens = 512) {
      throw new Error("OpenAI provider not yet implemented — use Claude or deterministic fallback")
    },
  }
}

// ── Azure Placeholder ─────────────────────────────────────────
export function createAzureProvider(): LLMProvider {
  return {
    available() { return !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) },
    async complete(systemPrompt, messages, maxTokens = 512) {
      throw new Error("Azure OpenAI provider not yet implemented")
    },
  }
}

// ── Auto-select best available provider ───────────────────────
export function getProvider(): LLMProvider {
  const claude = createClaudeProvider()
  if (claude.available()) return claude

  const azure = createAzureProvider()
  if (azure.available()) return azure

  const openai = createOpenAIProvider()
  if (openai.available()) return openai

  // Deterministic fallback (no LLM, always works)
  return {
    available() { return true },
    async complete() { return "" },
  }
}
