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
  it("extracts registry-backed multiword series names deterministically", async () => {
    const provider = createMockProvider(`{
      "seriesName": "",
      "rawValue": ""
    }`)

    const result = await extractParameters("V7 PLUS로 추천", null, provider)

    expect(result.seriesName).toBe("V7 PLUS")
  })

  it("canonicalizes material aliases through the shared registry", async () => {
    const provider = createMockProvider(`{
      "material": "",
      "rawValue": ""
    }`)

    const result = await extractParameters("stainless square로 추천", null, provider)

    expect(result.material).toBe("Stainless Steel")
    expect(result.toolSubtype).toBe("Square")
  })

  it("canonicalizes coating aliases through the shared registry", async () => {
    const provider = createMockProvider(`{
      "coating": "",
      "rawValue": ""
    }`)

    const result = await extractParameters("altin coating으로 추천", null, provider)

    expect(result.coating).toBe("AlTiN")
  })

  it("drops phantom material when LLM infers it from an industry word (aerospace → Titanium)", async () => {
    // LLM hallucinates Titanium from "aerospace" context. The phantom guard must
    // drop it because neither "titanium"/"티타늄" nor any alias appears in text.
    const provider = createMockProvider(`{
      "material": "Titanium",
      "rawValue": ""
    }`)

    const result = await extractParameters("나는 아무것도 몰라요 그냥 에어로스페이스에서 일해요", null, provider)

    expect(result.material).toBeUndefined()
  })

  it("keeps material when a known alias is grounded in the message (티타늄 → Titanium)", async () => {
    const provider = createMockProvider(`{
      "material": "Titanium",
      "rawValue": ""
    }`)

    const result = await extractParameters("티타늄 가공용 추천", null, provider)

    expect(result.material).toBe("Titanium")
  })
})
