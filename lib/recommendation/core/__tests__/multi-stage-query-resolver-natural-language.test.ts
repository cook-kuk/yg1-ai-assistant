import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import {
  _resetMaterialMappingCacheForTest,
  _setMaterialMappingTestPaths,
} from "@/lib/recommendation/shared/material-mapping"
import { assessComplexity } from "../complexity-router"
import {
  _resetMultiStageResolverCacheForTest,
  resolveMultiStageQuery,
} from "../multi-stage-query-resolver"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {
      coating: ["TiAlN", "AlCrN", "DLC"],
      tool_subtype: ["Square", "Ball", "Radius"],
      search_coating: ["TiAlN", "AlCrN", "DLC"],
      search_subtype: ["Square", "Ball", "Radius"],
    },
    workpieces: ["Titanium", "Stainless Steels", "Aluminum", "Carbon Steels"],
    brands: ["CRX S", "ALU-CUT", "4G MILL"],
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

describe("resolveMultiStageQuery natural-language regressions", () => {
  beforeEach(() => {
    _resetMultiStageResolverCacheForTest()
    _setMaterialMappingTestPaths({
      materialPath: path.join(FIXTURE_ROOT, "material-mapping-sample.csv"),
      brandAffinityPath: path.join(FIXTURE_ROOT, "brand-material-affinity-sample.csv"),
      seriesProfilePath: path.join(FIXTURE_ROOT, "series-profile-sample.csv"),
    })
  })

  afterEach(() => {
    _resetMaterialMappingCacheForTest()
  })

  it("keeps '티타늄 말고 뭐가 좋아?' on the semantic negation path", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "티타늄" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.94,
      unresolvedTokens: [],
      reasoning: "exclude titanium and keep recommending",
    }))

    const result = await resolveMultiStageQuery({
      message: "티타늄 말고 뭐가 좋아?",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("티타늄 말고 뭐가 좋아?"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "workPieceName",
          op: "eq",
          value: "Titanium",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "workPieceName", op: "neq", rawValue: "Titanium" }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("keeps 'CRX S 빼고' as a brand exclusion instead of a positive brand match", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "brand", op: "neq", value: "CRX S", rawToken: "CRX S" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "exclude the brand",
    }))

    const result = await resolveMultiStageQuery({
      message: "CRX S 빼고",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("CRX S 빼고"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "brand",
          op: "eq",
          value: "CRX S",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeProvider(),
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "neq", rawValue: "CRX S" }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("recovers typo-heavy material and numeric tokens from '스텐인리스 4날 10mn'", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawToken: "스텐인리스" },
        { field: "fluteCount", op: "eq", value: 4, rawToken: "4날" },
        { field: "diameterMm", op: "eq", value: 10, rawToken: "10mn" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "typo-aware recovery for material, flute, and diameter",
    }))

    const result = await resolveMultiStageQuery({
      message: "스텐인리스 4날 10mn",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("스텐인리스 4날 10mn"),
      stage2Provider,
      stage3Provider: makeProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "workPieceName" }),
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
    ]))
    expect(result.validation?.valid).toBe(true)
  })

  it("keeps positive and negated clauses attached to the correct fields in one turn", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "fluteCount", op: "neq", value: 2, rawToken: "2개" },
        { field: "toolSubtype", op: "eq", value: "Square", rawToken: "square 아니고" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.87,
      unresolvedTokens: [],
      reasoning: "wrong attachment to test validation recovery",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "fluteCount", op: "eq", value: 2, rawToken: "2개여야" },
        { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square 아니고" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.96,
      unresolvedTokens: [],
      reasoning: "positive flute constraint and local negation on subtype",
    }))

    const result = await resolveMultiStageQuery({
      message: "날수는 2개여야하고 형상은 고민중인데 square 아니고 다른거 추천 가능해?",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("날수는 2개여야하고 형상은 고민중인데 square 아니고 다른거 추천 가능해?"),
      stage2Provider,
      stage3Provider,
      stage1CotEscalation: {
        enabled: true,
      },
    })

    expect(result.source).toBe("stage3")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", op: "eq", rawValue: 2 }),
      expect.objectContaining({ field: "toolSubtype", op: "neq", rawValue: "Square" }),
    ]))
    expect(result.validation?.valid).toBe(true)
  })
})
