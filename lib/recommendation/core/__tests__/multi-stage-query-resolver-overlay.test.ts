import { describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import { _resetMultiStageResolverCacheForTest, resolveMultiStageQuery } from "../multi-stage-query-resolver"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN"],
    },
    workpieces: ["Stainless Steels", "Aluminum"],
    brands: ["CRX S", "ALU-CUT"],
    loadedAt: Date.now(),
  }),
  findValueByPhonetic: () => null,
}))

function makeProvider(response: string): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    available: () => true,
    complete: vi.fn(async () => response),
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

describe("clarification-only overlay preservation", () => {
  it("keeps the compare route when stage 3 is a no-op overlay", async () => {
    _resetMultiStageResolverCacheForTest()

    const stage2Provider = makeProvider(JSON.stringify({
      filters: [],
      sort: null,
      routeHint: "compare_products",
      intent: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.86,
      unresolvedTokens: ["GMI4710055"],
      reasoning: "compare route detected",
    }))

    const stage3Provider = makeProvider(JSON.stringify({
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "none",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "no-op overlay",
    }))

    const result = await resolveMultiStageQuery({
      message: "compare GMI4710055",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("compare GMI4710055"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage2")
    expect(result.routeHint).toBe("compare_products")
    expect(result.intent).toBe("show_recommendation")
    expect(result.clearOtherFilters).toBe(false)
  })
})
