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

  it("escalates request-preparation and recognized-entity mismatches into stage3 clarification", async () => {
    const partialResult = JSON.stringify({
      filters: [{ field: "fluteCount", op: "eq", value: 4, rawToken: "4날" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "kept only the pending-selection prefix",
    })
    const stage2Provider = makeProvider(partialResult)
    const stage3Provider = makeProvider(partialResult)

    const result = await resolveMultiStageQuery({
      message: "4날 TiAlN Square 추천해줘",
      turnCount: 9,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "pending-selection-mismatch",
        candidateCount: 9828,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling", diameterMm: 10 },
        turnCount: 8,
        currentMode: "question",
        lastAskedField: "fluteCount",
        displayedCandidates: [],
        displayedChips: ["2날", "4날", "3날", "상관없음"],
        displayedOptions: [
          { index: 1, label: "2날", field: "fluteCount", value: "2날", count: 240 },
          { index: 2, label: "4날", field: "fluteCount", value: "4날", count: 120 },
        ],
      } as any,
      complexity: assessComplexity("4날 TiAlN Square 추천해줘", 1),
      requestPreparationIntent: "refinement",
      requestPreparationSlots: [
        { field: "fluteCount", value: 4, confidence: "high", source: "chat" },
        { field: "coating", value: "TiAlN", confidence: "high", source: "chat" },
        { field: "toolSubtype", value: "Square", confidence: "high", source: "chat" },
      ],
      recognizedEntities: [
        { field: "coating", value: "TiAlN" },
        { field: "toolSubtype", value: "Square" },
      ],
      stage2Provider,
      stage3Provider,
    })

    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "request_preparation_mismatch" }),
      expect.objectContaining({ code: "recognized_entity_mismatch" }),
    ]))
  })

  it("holds free-text feature meaning as a concept instead of collapsing it into seriesName", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [
        { field: "seriesName", op: "eq", value: "multiple helix", rawToken: "multiple helix" },
        { field: "fluteCount", op: "eq", value: 4, rawToken: "4 flutes" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.89,
      unresolvedTokens: [],
      reasoning: "misread the feature phrase as a series identifier",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      concepts: [
        { kind: "feature", op: "eq", value: "multiple helix", rawToken: "multiple helix" },
        { kind: "constraint", fieldHint: "fluteCount", op: "eq", value: 4, rawToken: "4 flutes" },
      ],
      filters: [
        { field: "fluteCount", op: "eq", value: 4, rawToken: "4 flutes" },
      ],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.94,
      unresolvedTokens: ["multiple helix"],
      reasoning: "kept the feature phrase as a concept because it is not a DB series value",
    }))

    const result = await resolveMultiStageQuery({
      message: "multiple helix 4 flutes 보여줘",
      turnCount: 9,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "feature-concept",
        candidateCount: 24,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 8,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("multiple helix 4 flutes 보여줘", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
    expect(result.source).toBe("clarification")
    expect(result.filters.some(filter => filter.field === "seriesName")).toBe(false)
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "concept_mapping_gap" }),
    ]))
  })

  it("asks clarification for the exact generic coating phrase", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.91,
      unresolvedTokens: [],
      reasoning: "collapsed a generic coating mention into a specific coating",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [{ field: "coating", op: "eq", value: "Y-Coating", rawToken: "금속 코팅" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "kept the same unsafe collapse",
    }))

    const result = await resolveMultiStageQuery({
      message: "금속 코팅으로 부탁해요",
      turnCount: 10,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "generic-coating-exact",
        candidateCount: 28,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 9,
        currentMode: "narrowing",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("금속 코팅으로 부탁해요", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("금속 코팅")
  })

  it("asks clarification for the exact multiple-helix phrase", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      concepts: [
        { kind: "feature", op: "eq", value: "multiple helix", rawToken: "multiple helix" },
      ],
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.82,
      unresolvedTokens: ["multiple helix"],
      reasoning: "held the phrase as a free-text feature",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      action: "ask_clarification",
      reason: "feature_identifier_ambiguity",
      question: "현재는 'multiple helix'를 특성 후보로 이해했는데, 여기서 'multiple helix'는 시리즈명인가요, 제품 특성인가요?",
      chips: ["시리즈명", "제품 특성", "직접 입력"],
      concepts: [
        { kind: "feature", op: "eq", value: "multiple helix", rawToken: "multiple helix" },
      ],
      filters: [],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.7,
      unresolvedTokens: ["multiple helix"],
      reasoning: "multiple helix cannot be executed safely without clarification",
    }))

    const result = await resolveMultiStageQuery({
      message: "multiple helix 있는 거",
      turnCount: 11,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "multiple-helix-exact",
        candidateCount: 24,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 10,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("multiple helix 있는 거", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(result.intent).toBe("ask_clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("multiple helix")
    expect(result.clarification?.chips).toEqual(expect.arrayContaining(["시리즈명", "제품 특성"]))
  })

  it("asks clarification for comparative preference wording instead of executing", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [{ field: "coating", op: "neq", value: "TiAlN", rawToken: "티타늄" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.84,
      unresolvedTokens: [],
      reasoning: "excluded TiAlN and tried to continue recommending",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [{ field: "coating", op: "neq", value: "TiAlN", rawToken: "티타늄" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.9,
      unresolvedTokens: [],
      reasoning: "still tried to execute without clarifying the comparison criterion",
    }))

    const result = await resolveMultiStageQuery({
      message: "티타늄 말고 뭐가 좋아?",
      turnCount: 12,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "comparative-preference",
        candidateCount: 21,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 11,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("티타늄 말고 뭐가 좋아?", 1),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "comparative_preference_ambiguity" }),
    ]))
    expect(result.clarification?.question).toContain("비교 기준")
  })

  it("asks clarification for the exact mixed local-negation phrase", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [
        { field: "fluteCount", op: "eq", value: 2, rawToken: "날수는 2개" },
        { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square 아니고" },
      ],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "kept operator attachment local to each clause",
    }))

    const result = await resolveMultiStageQuery({
      message: "날수는 2개여야하고 square 아니고",
      turnCount: 13,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "local-negation-exact",
        candidateCount: 18,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 12,
        currentMode: "narrowing",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("날수는 2개여야하고 square 아니고", 1),
      stage2Provider,
      stage3Provider: makeProvider(),
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mixed_clause_ambiguity" }),
    ]))
    expect(result.clarification?.question).toContain("Square")
  })

  it("asks clarification for the exact correction-only phrase '그게 아니고'", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.8,
      unresolvedTokens: [],
      reasoning: "ignored the correction cue and kept going",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.84,
      unresolvedTokens: [],
      reasoning: "still ignored the correction-only repair signal",
    }))

    const result = await resolveMultiStageQuery({
      message: "그게 아니고",
      turnCount: 14,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
        { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "repair-exact-short",
        candidateCount: 10,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 13,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: ["스테인리스", "TiAlN"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("그게 아니고", 2),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("기존 조건")
  })

  it("asks clarification for the exact repair-only phrase '진짜 너 말 안듣는다'", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.78,
      unresolvedTokens: [],
      reasoning: "ignored the user's repair frustration",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      action: "execute",
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.81,
      unresolvedTokens: [],
      reasoning: "still tried to continue without asking what was wrong",
    }))

    const result = await resolveMultiStageQuery({
      message: "진짜 너 말 안듣는다",
      turnCount: 15,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
        { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "repair-exact-frustration",
        candidateCount: 9,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 14,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: ["스테인리스", "TiAlN"],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("진짜 너 말 안듣는다", 2),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.validation?.action).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("새 추천으로 다시")
  })

  it("maps brand and material concepts into validated filters before execution", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      concepts: [
        { kind: "brand", op: "eq", value: "CRX S", rawToken: "crx s" },
        { kind: "material", op: "eq", value: "stainless", rawToken: "stainless" },
      ],
      filters: [],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "concept-first parse mapped brand and material through validated catalog values",
    }))

    const result = await resolveMultiStageQuery({
      message: "CRX S로 스테인리스 추천해줘",
      turnCount: 10,
      currentFilters: [
        { field: "machiningCategory", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ],
      sessionState: {
        sessionId: "brand-material-concepts",
        candidateCount: 19,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 9,
        currentMode: "recommendation",
        displayedCandidates: [],
        displayedChips: [],
        displayedOptions: [],
      } as any,
      complexity: assessComplexity("CRX S로 스테인리스 추천해줘", 1),
      stage2Provider,
      stage3Provider: makeProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "brand", rawValue: "CRX S" }),
      expect.objectContaining({ field: "workPieceName", rawValue: "Stainless Steels" }),
    ]))
    expect(result.validation?.valid).toBe(true)
  })
})
