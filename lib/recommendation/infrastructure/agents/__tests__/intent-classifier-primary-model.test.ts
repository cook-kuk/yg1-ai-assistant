import { afterEach, describe, expect, it, vi } from "vitest"

import { classifyIntent } from "../intent-classifier"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

function makeProvider(response: string): LLMProvider {
  return {
    available: () => true,
    complete: vi.fn(async () => response),
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  }
}

describe("intent-classifier primary model routing", () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY
    delete process.env.GROQ_INTENT_MODEL
    vi.unstubAllGlobals()
  })

  it("uses the configured provider even when Groq env vars are present", async () => {
    process.env.GROQ_API_KEY = "configured"
    process.env.GROQ_INTENT_MODEL = "llama-3.3-70b-versatile"
    const fetchSpy = vi.fn(async () => {
      throw new Error("Groq fetch should not be called")
    })
    vi.stubGlobal("fetch", fetchSpy)

    const provider = makeProvider(JSON.stringify({
      intent: "ASK_RECOMMENDATION",
      confidence: 0.88,
      extractedValue: null,
    }))

    const result = await classifyIntent("추천해줘", null, provider)

    expect(result.intent).toBe("ASK_RECOMMENDATION")
    expect(result.confidence).toBe(0.88)
    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
