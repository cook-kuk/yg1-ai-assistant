import { describe, expect, it } from "vitest"

import { extractParameters } from "../parameter-extractor"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

function createMockProvider(responseText: string): LLMProvider {
  return {
    available: () => true,
    complete: async () => responseText,
    completeWithTools: async () => ({ text: null, toolUse: null }),
  }
}

describe("parameter-extractor", () => {
  it("prefers validated LLM output over deterministic aliases", async () => {
    const provider = createMockProvider(`{
      "fluteCount": 4,
      "toolSubtype": "roughing",
      "rawValue": "4날 roughing"
    }`)

    const result = await extractParameters("4날 roughing으로 추천", null, provider)

    expect(result.fluteCount).toBe(4)
    expect(result.toolSubtype).toBe("Roughing")
    expect(result.rawValue).toBe("4날 roughing")
  })

  it("uses deterministic fallback when LLM returns invalid values", async () => {
    const provider = createMockProvider(`{
      "fluteCount": "many",
      "toolSubtype": "",
      "rawValue": ""
    }`)

    const result = await extractParameters("3날 square로 추천", null, provider)

    expect(result.fluteCount).toBe(3)
    expect(result.toolSubtype).toBe("Square")
    expect(result.rawValue).toBe("3날 square로 추천")
  })
})
