import { describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { DbSchema } from "../sql-agent-schema-cache"
import { naturalLanguageToFilters } from "../sql-agent"

const schema: DbSchema = {
  columns: [
    { column_name: "search_subtype", data_type: "text" },
    { column_name: "search_coating", data_type: "text" },
    { column_name: "total_stock", data_type: "integer" },
  ],
  columnDescriptions: {},
  sampleValues: {
    search_subtype: ["Square", "Ball", "Radius"],
    tool_subtype: ["Square", "Ball", "Radius"],
    search_coating: ["TiAlN", "AlCrN", "DLC"],
    coating: ["TiAlN", "AlCrN", "DLC"],
  },
  numericStats: {
    total_stock: {
      min: 0, max: 5000,
      p10: 0, p25: 10, p50: 100, p75: 500, p90: 2000,
      distinctCount: 120, nonNullCount: 3800,
    },
  },
  auxTables: {},
  auxSampleValues: {},
  auxNumericStats: {},
  workpieces: [
    { tag_name: "SUS", normalized_work_piece_name: "Stainless Steels" },
    { tag_name: "AL", normalized_work_piece_name: "Aluminum" },
  ],
  brands: ["CRX S", "ALU-CUT"],
  countries: ["KOR", "USA"],
  valueIndex: {},
  phoneticIndex: [],
  loadedAt: Date.now(),
}

describe("naturalLanguageToFilters prompt guardrails", () => {
  it("locks SQL-agent reasoning to allowed fields, operators, and domain dictionary", async () => {
    const provider = {
      complete: vi.fn(async (systemPrompt: string) => {
        expect(systemPrompt).toContain("## Allowed Output Fields")
        expect(systemPrompt).toContain("search_subtype -> toolSubtype")
        expect(systemPrompt).toContain("## Allowed Operators")
        expect(systemPrompt).toContain("eq, neq, like, gte, lte, between, skip, reset, back")
        expect(systemPrompt).toContain("## Domain Dictionary")
        expect(systemPrompt).toContain("toolSubtype canonical values/examples")
        expect(systemPrompt).toContain("Hard constraints:")
        return JSON.stringify({
          reasoning: "prompt guardrails verified",
          filters: [],
          confidence: "high",
          clarification: null,
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await naturalLanguageToFilters(
      "square coating explanation",
      schema,
      [],
      provider,
      "cot",
    )

    expect(provider.complete).toHaveBeenCalledTimes(1)
    expect(result.filters).toEqual([])
    expect(result.confidence).toBe("high")
  })
})
