import { describe, expect, it } from "vitest"

import { extractFiltersWithLLM } from "../llm-filter-extractor"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

function createMockProvider(responseText: string): LLMProvider {
  return {
    available: () => true,
    complete: async () => responseText,
    completeWithTools: async () => ({ text: null, toolUse: null }),
  }
}

describe("llm-filter-extractor", () => {
  it("parses compound filters with field-specific skip", async () => {
    const provider = createMockProvider(`{
      "extractedFilters": {
        "toolSubtype": "Square",
        "fluteCount": 3
      },
      "skippedFields": ["coating"],
      "skipPendingField": false,
      "isSideQuestion": false,
      "confidence": 0.94
    }`)

    const result = await extractFiltersWithLLM(
      "square에 3날 제품 코팅은 아무거나 괜찮은 걸로 추천해주세요",
      "toolSubtype",
      [],
      provider
    )

    expect(result.extractedFilters).toEqual({
      toolSubtype: "Square",
      fluteCount: 3,
    })
    expect(result.skippedFields).toEqual(["coating"])
    expect(result.skipPendingField).toBe(false)
    expect(result.isSideQuestion).toBe(false)
  })

  it("keeps pure pending-field skip separate from field-specific skip", async () => {
    const provider = createMockProvider(`{
      "extractedFilters": {},
      "skippedFields": [],
      "skipPendingField": true,
      "isSideQuestion": false,
      "confidence": 0.88
    }`)

    const result = await extractFiltersWithLLM(
      "아무거나 괜찮아요",
      "coating",
      [],
      provider
    )

    expect(result.extractedFilters).toEqual({})
    expect(result.skippedFields).toEqual([])
    expect(result.skipPendingField).toBe(true)
  })
})
