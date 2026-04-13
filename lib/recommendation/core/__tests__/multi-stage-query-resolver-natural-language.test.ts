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

  it("keeps '\uD2F0\uD0C0\uB284 \uB9D0\uACE0 \uBB50\uAC00 \uC88B\uC544?' on the semantic negation path", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "Titanium" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.94,
      unresolvedTokens: [],
      reasoning: "exclude titanium and keep recommending",
    }))

    const result = await resolveMultiStageQuery({
      message: "\uD2F0\uD0C0\uB284 \uB9D0\uACE0 \uBB50\uAC00 \uC88B\uC544?",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("\uD2F0\uD0C0\uB284 \uB9D0\uACE0 \uBB50\uAC00 \uC88B\uC544?"),
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

  it("keeps 'CRX S \uBE7C\uACE0' as a brand exclusion instead of a positive brand match", async () => {
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
      message: "CRX S \uBE7C\uACE0",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("CRX S \uBE7C\uACE0"),
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

  it("keeps '4G MILL \uB9D0\uACE0' as a brand exclusion instead of preserving the brand token", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "brand", op: "neq", value: "4G MILL", rawToken: "4G MILL" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.94,
      unresolvedTokens: [],
      reasoning: "exclude the brand",
    }))

    const result = await resolveMultiStageQuery({
      message: "4G MILL \uB9D0\uACE0",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("4G MILL \uB9D0\uACE0"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "brand",
          op: "eq",
          value: "4G MILL",
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
      expect.objectContaining({ field: "brand", op: "neq", rawValue: "4G MILL" }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("recovers typo-heavy material and numeric tokens from '\uC2A4\uD150\uC778\uB9AC\uC2A4 4\uB0AD 10mn'", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawToken: "\uC2A4\uD150\uC778\uB9AC\uC2A4" },
        { field: "fluteCount", op: "eq", value: 4, rawToken: "4\uB0AD" },
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
      message: "\uC2A4\uD150\uC778\uB9AC\uC2A4 4\uB0AD 10mn",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("\uC2A4\uD150\uC778\uB9AC\uC2A4 4\uB0AD 10mn"),
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

  it("keeps '\uB0A0\uC218\uB294 2\uAC1C\uC5EC\uC57C\uD558\uACE0 square \uC544\uB2C8\uACE0' attached to the correct fields", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "fluteCount", op: "neq", value: 2, rawToken: "2\uAC1C" },
        { field: "toolSubtype", op: "eq", value: "Square", rawToken: "square" },
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
        { field: "fluteCount", op: "eq", value: 2, rawToken: "2\uAC1C" },
        { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.96,
      unresolvedTokens: [],
      reasoning: "positive flute constraint and local negation on subtype",
    }))

    const result = await resolveMultiStageQuery({
      message: "\uB0A0\uC218\uB294 2\uAC1C\uC5EC\uC57C\uD558\uACE0 square \uC544\uB2C8\uACE0",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("\uB0A0\uC218\uB294 2\uAC1C\uC5EC\uC57C\uD558\uACE0 square \uC544\uB2C8\uACE0"),
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
