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

  it("drops unsupported or out-of-scope values during validation", async () => {
    const provider = createMockProvider(`{
      "extractedFilters": {
        "coating": "GhostCoat",
        "unknownField": "nope"
      },
      "skippedFields": ["unknownField"],
      "skipPendingField": false,
      "isSideQuestion": false,
      "confidence": 0.81
    }`)

    const result = await extractFiltersWithLLM(
      "GhostCoat으로 해줘",
      "coating",
      [],
      provider,
      {
        allowedFields: ["coating"],
        fieldValueScope: { coating: ["TiAlN", "AlCrN"] },
      }
    )

    expect(result.extractedFilters).toEqual({})
    expect(result.skippedFields).toEqual([])
    expect(result.validationIssues).toEqual(expect.arrayContaining([
      expect.stringContaining("out-of-scope value for coating"),
      expect.stringContaining("disallowed field: unknownField"),
    ]))
  })

  it("reconciles validated values to the candidate scope casing", async () => {
    const provider = createMockProvider(`{
      "extractedFilters": {
        "coating": "alcrn"
      },
      "skippedFields": [],
      "skipPendingField": false,
      "isSideQuestion": false,
      "confidence": 0.9
    }`)

    const result = await extractFiltersWithLLM(
      "alcrn으로 보여줘",
      "coating",
      [],
      provider,
      {
        allowedFields: ["coating"],
        fieldValueScope: { coating: ["TiAlN", "AlCrN"] },
      }
    )

    expect(result.extractedFilters).toEqual({
      coating: "AlCrN",
    })
  })

  it("keeps multiple values for one field when the LLM returns an array", async () => {
    const provider = createMockProvider(`{
      "extractedFilters": {
        "fluteCount": [4, 5]
      },
      "skippedFields": [],
      "skipPendingField": false,
      "isSideQuestion": false,
      "confidence": 0.92
    }`)

    const result = await extractFiltersWithLLM(
      "4날 또는 5날로 해줘",
      "fluteCount",
      [],
      provider,
      {
        allowedFields: ["fluteCount"],
        fieldValueScope: { fluteCount: ["4날", "5날", "6날"] },
      }
    )

    expect(result.extractedFilters).toEqual({
      fluteCount: [4, 5],
    })
  })
})
