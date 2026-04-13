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
    workpieces: ["Titanium", "Stainless Steels", "Aluminum"],
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

describe("resolveMultiStageQuery validation-driven escalation", () => {
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

  it("re-routes a stage1 negation conflict into semantic CoT before execution", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "titanium" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "exclude titanium family instead of keeping it",
    }))

    const result = await resolveMultiStageQuery({
      message: "exclude titanium",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("exclude titanium"),
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
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "workPieceName", op: "neq", rawValue: "Titanium" }),
    ])
    expect(result.validation?.valid).toBe(true)
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("re-routes includes-based negation conflicts into semantic CoT before execution", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "brand", op: "neq", value: "4G MILL", rawToken: "4g mill" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.92,
      unresolvedTokens: [],
      reasoning: "exclude the mentioned brand instead of keeping it",
    }))

    const result = await resolveMultiStageQuery({
      message: "4G MILL 아닌 거로",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("4G MILL 아닌 거로"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "brand",
          op: "includes",
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
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "neq", rawValue: "4G MILL" }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("escalates a range mismatch from stage2 to stage3 and keeps the executable operator", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "eq", value: 10, rawToken: "10" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "picked the number but missed the range operator",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 10, rawToken: "at least 10" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "restored the gte operator from the utterance",
    }))

    const result = await resolveMultiStageQuery({
      message: "diameter at least 10",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("diameter at least 10"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage3")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "diameterMm", op: "gte", rawValue: 10 }),
    ])
    expect(result.validation?.valid).toBe(true)
  })

  it("asks for clarification when order quantity is ambiguously converted into inventory scope", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "stockStatus", op: "gte", value: 200, rawToken: "200개 이상" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "misread the bulk order quantity as an inventory threshold",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "stockStatus", op: "gte", value: 200, rawToken: "200개 이상" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "kept the inventory interpretation",
    }))

    const result = await resolveMultiStageQuery({
      message: "여기서 나는 200개 이상 주문해야해요",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("여기서 나는 200개 이상 주문해야해요"),
      stage2Provider,
      stage3Provider,
    })

    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("재고 기준인지")
    expect(result.clarification?.chips).toContain("재고 200개 이상")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "inventory_scope_ambiguity" }),
    ]))
  })

  it("asks for clarification when a bare mm phrase is ambiguously converted into diameter", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 100, rawToken: "100mm 이상" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "defaulted the bare mm phrase to diameter",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 100, rawToken: "100mm 이상" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.94,
      unresolvedTokens: [],
      reasoning: "kept the diameter interpretation",
    }))

    const result = await resolveMultiStageQuery({
      message: "100mm 이상이요",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("100mm 이상이요"),
      stage2Provider,
      stage3Provider,
    })

    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("직경 기준인지")
    expect(result.clarification?.chips).toContain("전장 100mm 이상")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "measurement_scope_ambiguity" }),
    ]))
  })

  it("keeps negation attached locally so '2 flutes and not square' does not exclude 2 flutes", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "fluteCount", op: "neq", value: 2, rawToken: "2 flutes" },
        { field: "toolSubtype", op: "neq", value: "Square", rawToken: "not square" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "wrongly flipped the flute clause to negation",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "fluteCount", op: "eq", value: 2, rawToken: "2 flutes" },
        { field: "toolSubtype", op: "neq", value: "Square", rawToken: "not square" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.96,
      unresolvedTokens: [],
      reasoning: "kept the positive flute clause and local negation",
    }))

    const result = await resolveMultiStageQuery({
      message: "2 flutes and not square",
      turnCount: 5,
      currentFilters: [
        { field: "fluteCount", op: "eq", value: "4", rawValue: 4, appliedAt: 2 },
        { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "compound-negation",
        candidateCount: 18,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 4,
        currentMode: "narrowing",
        displayedCandidates: [],
        displayedChips: ["4날", "Square"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("2 flutes and not square", 2),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage3")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", op: "eq", rawValue: 2 }),
      expect.objectContaining({ field: "toolSubtype", op: "neq", rawValue: "Square" }),
    ]))
    expect(result.validation?.valid).toBe(true)
  })

  it("blocks generic-to-specific coating collapse and asks for clarification", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "collapsed a generic coating mention into Y-Coating",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "kept the same collapse",
    }))

    const result = await resolveMultiStageQuery({
      message: "금속 코팅으로 추천해줘",
      turnCount: 6,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "generic-coating",
        candidateCount: 32,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 5,
        currentMode: "narrowing",
        displayedCandidates: [],
        displayedChips: ["엔드밀"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("금속 코팅으로 추천해줘", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "generic_specific_collapse" }),
    ]))
  })

  it("blocks correction-signal ignore and asks for repair clarification", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.8,
      unresolvedTokens: [],
      reasoning: "ignored the correction cue and tried to continue",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.84,
      unresolvedTokens: [],
      reasoning: "still ignored the correction cue",
    }))

    const result = await resolveMultiStageQuery({
      message: "그게 아니고",
      turnCount: 7,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
        { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "repair-ignore",
        candidateCount: 11,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 6,
        currentMode: "recommendation",
        displayedCandidates: [
          { productCode: "V7-100", displayCode: "V7-100", displayLabel: "V7 demo", brand: "YG-1", seriesName: "V7", rank: 1 },
        ],
        displayedChips: ["스테인리스", "TiAlN"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("그게 아니고", 2),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "correction_signal_ignored" }),
    ]))
  })

  it("blocks domain leakage from endmill context into drill/tap families", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "machiningCategory", op: "eq", value: "Holemaking", rawToken: "드릴" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.92,
      unresolvedTokens: [],
      reasoning: "switched from endmill context to drill domain",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "machiningCategory", op: "eq", value: "Holemaking", rawToken: "드릴" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "kept the drill-domain switch",
    }))

    const result = await resolveMultiStageQuery({
      message: "드릴로 바꿔",
      turnCount: 8,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "domain-lock",
        candidateCount: 14,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling", toolType: "End Mill" },
        turnCount: 7,
        currentMode: "narrowing",
        displayedCandidates: [],
        displayedChips: ["엔드밀"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("드릴로 바꿔", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "domain_lock_risk" }),
    ]))
  })
})
