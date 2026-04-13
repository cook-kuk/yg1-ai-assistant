import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import {
  _resetMultiStageResolverCacheForTest,
  resolveMultiStageQuery,
} from "../multi-stage-query-resolver"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN", "DLC"],
      tool_subtype: ["Square", "Ball", "Radius"],
      search_coating: ["TiAlN", "AlCrN", "DLC"],
      search_subtype: ["Square", "Ball", "Radius"],
    },
    workpieces: [
      { tag_name: "SUS", normalized_work_piece_name: "Stainless Steels" },
      { tag_name: "AL", normalized_work_piece_name: "Aluminum" },
    ],
    brands: ["CRX S", "ALU-CUT"],
    loadedAt: Date.now(),
  }),
  findValueByPhonetic: () => null,
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

describe("resolveMultiStageQuery stage1 CoT gate", () => {
  beforeEach(() => {
    _resetMultiStageResolverCacheForTest()
  })

  it("escalates a stage1 skip short-circuit to Stage 2 in production when alias text remains", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "brand", op: "eq", value: "ALU-CUT", rawToken: "aluqut" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.92,
      unresolvedTokens: [],
      reasoning: "alias resolved after stage1 skip",
    }))

    const result = await resolveMultiStageQuery({
      message: "brand skip aluqut",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("brand skip aluqut"),
      stageOneEditIntent: {
        intent: { type: "skip_field", field: "brand" },
        confidence: 0.93,
        reason: "skip brand",
      },
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", rawValue: "ALU-CUT" }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("escalates canonicalization misses to Stage 2 only when the production gate is enabled", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "eq", value: 10, rawToken: "tenish" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "recovered diameter from canonicalization miss",
    }))

    const result = await resolveMultiStageQuery({
      message: "4 flute tenish",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("4 flute tenish"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "fluteCount",
          op: "eq",
          value: 4,
          source: "deterministic",
        },
        {
          type: "apply_filter",
          field: "diameterMm",
          op: "eq",
          value: "tenish",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
    ]))
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("keeps the old stage1 fast path when the production-only gate is not passed", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "eq", value: 10, rawToken: "tenish" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "should not be used",
    }))

    const result = await resolveMultiStageQuery({
      message: "4 flute tenish",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("4 flute tenish"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "fluteCount",
          op: "eq",
          value: 4,
          source: "deterministic",
        },
        {
          type: "apply_filter",
          field: "diameterMm",
          op: "eq",
          value: "tenish",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage1")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
    ])
    expect(stage2Provider.complete).not.toHaveBeenCalled()
  })

  it("returns a non-terminal result so SQL-agent can continue when forced CoT still resolves nothing", async () => {
    const stage2Provider = makeProvider("")

    const result = await resolveMultiStageQuery({
      message: "4 flute tenish",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("4 flute tenish"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "fluteCount",
          op: "eq",
          value: 4,
          source: "deterministic",
        },
        {
          type: "apply_filter",
          field: "diameterMm",
          op: "eq",
          value: "tenish",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
        currentCandidateCount: 0,
      },
    })

    expect(result.source).toBe("none")
    expect(result.clarification).toBeNull()
    expect(result.reasoning).toContain("defer:stage1_cot:")
    expect(result.unresolvedTokens.length).toBeGreaterThan(0)
  })

  it("defers replace-style stage1 edits to Stage 2 instead of finalizing the field in stage1", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "fluteCount", op: "eq", value: 4, rawToken: "4 flute" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "semantic replacement resolved by stage2",
    }))

    const result = await resolveMultiStageQuery({
      message: "2 flute instead 4 flute",
      turnCount: 5,
      currentFilters: [],
      complexity: assessComplexity("2 flute instead 4 flute"),
      stageOneEditIntent: {
        intent: { type: "replace_field", field: "fluteCount", oldValue: "2", newValue: "4" },
        confidence: 0.95,
        reason: "replace fluteCount: 2 -> 4",
      },
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "fluteCount",
          op: "eq",
          value: 4,
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })
})
