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
      coating: ["TiAlN", "AlCrN", "DLC", "Y-Coating"],
      search_coating: ["TiAlN", "AlCrN", "DLC", "Y-Coating"],
      tool_subtype: ["Square", "Ball", "Radius"],
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

function makeUnavailableProvider(): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  return {
    available: () => false,
    complete: vi.fn(async () => ""),
    completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
  } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }
}

function makeRecommendationState(): any {
  return {
    sessionId: "clarification-regression",
    candidateCount: 14,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { machiningCategory: "Milling" },
    turnCount: 3,
    currentMode: "recommendation",
    displayedCandidates: [
      { productCode: "V7-100", displayCode: "V7-100", displayLabel: "V7 demo", brand: "YG-1", seriesName: "V7", rank: 1 },
    ],
    displayedChips: ["스테인리스", "Square"],
    displayedOptions: [
      { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 6 },
      { index: 2, label: "2날", field: "fluteCount", value: "2", count: 8 },
    ],
  }
}

describe("resolveMultiStageQuery clarification-first regressions", () => {
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

  it("asks clarification for '금속 코팅으로 부탁해요'", async () => {
    const result = await resolveMultiStageQuery({
      message: "금속 코팅으로 부탁해요",
      turnCount: 5,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: makeRecommendationState(),
      complexity: assessComplexity("금속 코팅으로 부탁해요", 1),
      stage2Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.91,
        unresolvedTokens: [],
        reasoning: "collapsed generic coating into a specific coating",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "kept the same collapse",
      })),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.clarification?.question).toContain("금속 코팅")
    expect(result.clarification?.chips).toContain("직접 입력")
  })

  it("asks clarification for 'multiple helix 있는 거'", async () => {
    const result = await resolveMultiStageQuery({
      message: "multiple helix 있는 거",
      turnCount: 6,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: makeRecommendationState(),
      complexity: assessComplexity("multiple helix 있는 거", 1),
      stage2Provider: makeProvider(JSON.stringify({
        action: "escalate_to_cot",
        concepts: [
          { kind: "feature", op: "eq", value: "multiple helix", rawToken: "multiple helix" },
        ],
        filters: [],
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.42,
        unresolvedTokens: ["multiple helix"],
        reasoning: "feature phrase is unresolved",
      })),
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.clarification?.question).toContain("multiple helix")
    expect(result.clarification?.chips).toEqual(expect.arrayContaining(["시리즈명", "제품 특성", "직접 입력"]))
  })

  it("asks clarification for '티타늄 말고 뭐가 좋아?'", async () => {
    const result = await resolveMultiStageQuery({
      message: "티타늄 말고 뭐가 좋아?",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("티타늄 말고 뭐가 좋아?"),
      stage2Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "티타늄" }],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.94,
        unresolvedTokens: [],
        reasoning: "exclude titanium",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [{ field: "workPieceName", op: "neq", value: "Titanium", rawToken: "티타늄" }],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "kept the exclusion",
      })),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "comparative_preference_ambiguity" }),
    ]))
    expect(result.clarification?.chips).toContain("직접 입력")
  })

  it("asks clarification for '날수는 2개여야하고 square 아니고'", async () => {
    const result = await resolveMultiStageQuery({
      message: "날수는 2개여야하고 square 아니고",
      turnCount: 7,
      currentFilters: [],
      complexity: assessComplexity("날수는 2개여야하고 square 아니고"),
      stage2Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [
          { field: "fluteCount", op: "eq", value: 2, rawToken: "2개" },
          { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square" },
        ],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.93,
        unresolvedTokens: [],
        reasoning: "mixed positive and negative clause",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [
          { field: "fluteCount", op: "eq", value: 2, rawToken: "2개" },
          { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square" },
        ],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.96,
        unresolvedTokens: [],
        reasoning: "kept the same mixed clause edit",
      })),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mixed_clause_ambiguity" }),
    ]))
    expect(result.clarification?.chips).toContain("직접 입력")
  })

  it("asks repair clarification for '그게 아니고'", async () => {
    const result = await resolveMultiStageQuery({
      message: "그게 아니고",
      turnCount: 8,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
        { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
      ],
      sessionState: makeRecommendationState(),
      complexity: assessComplexity("그게 아니고", 2),
      stage2Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.22,
        unresolvedTokens: [],
        reasoning: "ignored the correction signal",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.31,
        unresolvedTokens: [],
        reasoning: "still ignored the correction signal",
      })),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "correction_signal_ignored" }),
    ]))
    expect(result.clarification?.question).toContain("무엇이 틀렸는지")
  })

  it("asks repair clarification for '진짜 너 말 안듣는다'", async () => {
    const result = await resolveMultiStageQuery({
      message: "진짜 너 말 안듣는다",
      turnCount: 9,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
      ],
      sessionState: makeRecommendationState(),
      complexity: assessComplexity("진짜 너 말 안듣는다", 2),
      stage2Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.19,
        unresolvedTokens: [],
        reasoning: "no repair delta",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        action: "execute",
        filters: [],
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.21,
        unresolvedTokens: [],
        reasoning: "still no repair delta",
      })),
    })

    expect(result.action).toBe("ask_clarification")
    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "correction_signal_ignored" }),
    ]))
    expect(result.clarification?.chips).toContain("직접 입력")
  })
})
