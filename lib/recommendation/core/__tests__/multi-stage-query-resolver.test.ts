import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import { _resetMultiStageResolverCacheForTest, resolveMultiStageQuery } from "../multi-stage-query-resolver"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN", "DLC"],
      tool_subtype: ["Square", "Ball", "Radius"],
    },
    workpieces: ["Stainless Steels", "Aluminum", "Carbon Steels"],
    brands: ["CRX S", "ALU-CUT", "TANK-POWER", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

function makeProvider(...responses: string[]): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const queue = [...responses]
  const complete = vi.fn(async () => queue.shift() ?? "")
  return {
    available: () => true,
    complete,
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

function makeUnavailableProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => "")
  return {
    available: () => false,
    complete,
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

describe("resolveMultiStageQuery", () => {
  beforeEach(() => {
    _resetMultiStageResolverCacheForTest()
  })

  it("uses Stage 2 for skip variants and replays the result from cache", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "brand", op: "skip", rawToken: "노상관" }],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.92,
        unresolvedTokens: [],
        reasoning: "brand indifference",
      }),
    )

    const first = await resolveMultiStageQuery({
      message: "브랜드 노상관",
      turnCount: 5,
      currentFilters: [],
      complexity: assessComplexity("브랜드 노상관"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(first.source).toBe("stage2")
    expect(first.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "skip", rawValue: "skip" }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)

    const cachedStage2Provider = makeProvider()
    const second = await resolveMultiStageQuery({
      message: "브랜드 노상관",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("브랜드 노상관"),
      stage2Provider: cachedStage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(second.source).toBe("cache")
    expect(second.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "skip", rawValue: "skip" }),
    ])
    expect(cachedStage2Provider.complete).not.toHaveBeenCalled()
  })

  it("escalates to Stage 3 when Stage 2 stays uncertain", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.41,
        unresolvedTokens: ["크렉스에스"],
        reasoning: "phonetic token unresolved",
      }),
    )
    const stage3Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "brand", op: "eq", value: "CRX S", rawToken: "크렉스에스" }],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.94,
        unresolvedTokens: [],
        reasoning: "phonetic brand mapping",
      }),
    )

    const result = await resolveMultiStageQuery({
      message: "크렉스에스로만 보여줘",
      turnCount: 9,
      currentFilters: [],
      complexity: assessComplexity("크렉스에스로만 보여줘"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage3")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", rawValue: "CRX S" }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("returns clearOtherFilters for global relaxation phrases", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        clearOtherFilters: true,
        confidence: 0.84,
        unresolvedTokens: [],
        reasoning: "drop all other constraints",
      }),
    )

    const result = await resolveMultiStageQuery({
      message: "다 됨 직경만 10mm",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("다 됨 직경만 10mm"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "diameterMm",
          value: 10,
          op: "eq",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.clearOtherFilters).toBe(true)
    expect(result.filters).toHaveLength(0)
  })
})
