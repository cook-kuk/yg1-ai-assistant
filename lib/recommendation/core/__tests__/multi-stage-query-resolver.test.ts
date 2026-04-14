import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import { parseEditIntent } from "../edit-intent"
import { _resetMultiStageResolverCacheForTest, resolveMultiStageQuery } from "../multi-stage-query-resolver"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "@/lib/recommendation/shared/material-mapping"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

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
  findValueByPhonetic: (text: string) => {
    if (String(text).includes("알루컷")) {
      return {
        column: "edp_brand_name",
        value: "ALU-CUT for Korean Market",
        similarity: 0.99,
        matchedToken: "알루컷",
      }
    }
    return null
  },
}))

vi.mock("../deterministic-scr", () => ({
  buildDeterministicSemanticHints: (actions: Array<{
    field?: string
    value?: string | number
    value2?: string | number
    op?: "eq" | "neq" | "gte" | "lte" | "between" | null
  }>) => actions.map(action => {
    const valueCandidate = action.op === "between" && action.value2 != null
      ? [action.value ?? null, action.value2]
      : (action.value ?? null)
    const numericCue = typeof action.value === "number" ? [action.value] : []
    const domainCue = action.field === "fluteCount"
      ? "geometry"
      : action.field === "coating"
      ? "coating"
      : action.field === "brand"
      ? "brand-series"
      : null
    return {
      fieldCandidate: action.field ?? null,
      valueCandidate,
      operatorCue: action.op ?? null,
      numericCue,
      domainCue,
    }
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

function makeDeepComplexity(reason: string = "test_force_deep") {
  return {
    ...assessComplexity("티타늄 말고 뭐가 좋아?"),
    reason,
  }
}

describe("resolveMultiStageQuery", () => {
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

  it("routes deterministic skip intents through Stage 2 semantic interpretation", async () => {
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "shankType", op: "skip", rawToken: "?앺겕 ????꾨Т嫄곕굹" }],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.93,
      unresolvedTokens: [],
      reasoning: "release the pending shankType constraint",
    }))
    const stage3Provider = makeProvider()

    const result = await resolveMultiStageQuery({
      message: "생크 타입 아무거나",
      turnCount: 2,
      currentFilters: [],
      stageOneEditIntent: parseEditIntent("생크 타입 아무거나"),
      complexity: assessComplexity("생크 타입 아무거나"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "shankType", op: "skip", rawValue: "skip" }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).not.toHaveBeenCalled()
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

  it("falls back to clarification for stateful deictic negation when deeper repair is unavailable", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "brand", op: "neq", value: "CRX S", rawToken: "\uADF8\uAC70" }],
        sort: null,
        routeHint: "show_recommendation",
        intent: "continue_narrowing",
        clearOtherFilters: false,
        removeFields: ["brand"],
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "exclude the currently anchored brand",
      }),
      JSON.stringify({
        filters: [{ field: "brand", op: "neq", value: "4G MILL", rawToken: "\uADF8\uAC70" }],
        sort: null,
        routeHint: "show_recommendation",
        intent: "continue_narrowing",
        clearOtherFilters: false,
        removeFields: ["brand"],
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "exclude the currently anchored brand",
      }),
    )

    const message = "\uADF8\uAC70 \uB9D0\uACE0"
    const first = await resolveMultiStageQuery({
      message,
      turnCount: 7,
      currentFilters: [
        { field: "brand", op: "eq", value: "CRX S", rawValue: "CRX S", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "s1",
        candidateCount: 12,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 6,
        currentMode: "recommendation",
        displayedCandidates: [
          { productCode: "CRX001", displayCode: "CRX001", displayLabel: "CRX demo", brand: "CRX S", seriesName: "CRX", rank: 1 },
        ],
        displayedChips: ["CRX S"],
        displayedOptions: [{ index: 1, label: "CRX S", field: "brand", value: "CRX S", count: 12 }],
        uiNarrowingPath: [{ kind: "filter", label: "CRX S", field: "brand", value: "CRX S", candidateCount: 12 }],
      } as any,
      complexity: assessComplexity(message, 1),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
        currentCandidateCount: 12,
      },
    })

    const second = await resolveMultiStageQuery({
      message,
      turnCount: 8,
      currentFilters: [
        { field: "brand", op: "eq", value: "4G MILL", rawValue: "4G MILL", appliedAt: 3 },
      ],
      sessionState: {
        sessionId: "s2",
        candidateCount: 9,
        appliedFilters: [],
        narrowingHistory: [],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 7,
        currentMode: "recommendation",
        displayedCandidates: [
          { productCode: "4GM001", displayCode: "4GM001", displayLabel: "4G demo", brand: "4G MILL", seriesName: "4G", rank: 1 },
        ],
        displayedChips: ["4G MILL"],
        displayedOptions: [{ index: 1, label: "4G MILL", field: "brand", value: "4G MILL", count: 9 }],
        uiNarrowingPath: [{ kind: "filter", label: "4G MILL", field: "brand", value: "4G MILL", candidateCount: 9 }],
      } as any,
      complexity: assessComplexity(message, 1),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
        currentCandidateCount: 9,
      },
    })

    expect(first.source).toBe("clarification")
    expect(first.intent).toBe("ask_clarification")
    expect(first.clarification).not.toBeNull()
    expect(second.source).toBe("clarification")
    expect(second.intent).toBe("ask_clarification")
    expect(second.clarification).not.toBeNull()
  })

  it("sends unresolved phonetic brand tokens to Stage 2", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "brand", op: "eq", value: "ALU-CUT", rawToken: "알루컷" }],
        sort: null,
        routeHint: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.93,
        unresolvedTokens: [],
        reasoning: "phonetic brand mapping",
      }),
    )

    const result = await resolveMultiStageQuery({
      message: "알루컷 브랜드 추천",
      turnCount: 2,
      currentFilters: [],
      complexity: assessComplexity("알루컷 브랜드 추천"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", rawValue: "ALU-CUT" }),
    ])
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("passes deterministic candidates to Stage 2 as semantic hints instead of stage1 truth", async () => {
    const stage2Provider = {
      available: () => true,
      complete: vi.fn(async (systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        expect(systemPrompt).toContain("Semantic policy:")
        expect(systemPrompt).toContain('Do not finalize natural-language negation, alternatives, comparison, or follow-up revision from cue words alone.')
        const userPrompt = messages[0]?.content ?? ""
        expect(userPrompt).toContain("Stage 1 semantic hints:")
        expect(userPrompt).toContain('"fieldCandidate":"fluteCount"')
        expect(userPrompt).toContain('"valueCandidate":4')
        expect(userPrompt).toContain('"operatorCue":"eq"')
        expect(userPrompt).toContain('"numericCue":[4]')
        expect(userPrompt).toContain('"domainCue":"geometry"')
        return JSON.stringify({
          filters: [
            { field: "fluteCount", op: "eq", value: 4, rawToken: "4 flute" },
            { field: "coating", op: "skip", rawToken: "뭐가 됐든" },
          ],
          sort: null,
          routeHint: "none",
          clearOtherFilters: false,
          confidence: 0.91,
          unresolvedTokens: [],
          reasoning: "skip coating and keep flute",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "코팅 뭐가 됐든 4날만",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("코팅 뭐가 됐든 4날만"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "fluteCount",
          value: 4,
          op: "eq",
          source: "deterministic",
        },
      ],
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
      expect.objectContaining({ field: "coating", op: "skip", rawValue: "skip" }),
    ]))
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("passes state, UI context, and history to Stage 2 before clarification for ambiguous refine turns", async () => {
    const stage2Provider = {
      available: () => true,
      complete: vi.fn(async (_systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        const userPrompt = messages[0]?.content ?? ""
        expect(userPrompt).toContain("Resolver mode: repair")
        expect(userPrompt).toContain("Current state truth: mode=repair")
        expect(userPrompt).toContain("filters=workPieceName eq Stainless Steels")
        expect(userPrompt).toContain("toolSubtype eq Square")
        expect(userPrompt).toContain("UI context: displayedChips=")
        expect(userPrompt).toContain("displayedOptions=")
        expect(userPrompt).toContain("topCandidates=V7-100")
        expect(userPrompt).toContain("Recent conversation history: conversation=user:")
        expect(userPrompt).toContain("narrowing=asked=fluteCount")
        expect(userPrompt).toContain("Request-preparation intent: product_recommendation")
        expect(userPrompt).toContain("Request-preparation chat slots: fluteCount=2 (chat/high)")
        expect(userPrompt).toContain("Recognized entities: toolSubtype=Square")
        return JSON.stringify({
          filters: [
            { field: "fluteCount", op: "eq", value: 2, rawToken: "2\uAC1C" },
            { field: "toolSubtype", op: "neq", value: "Square", rawToken: "square" },
          ],
          sort: null,
          routeHint: "show_recommendation",
          clearOtherFilters: false,
          confidence: 0.96,
          unresolvedTokens: [],
          reasoning: "state-aware refine using existing UI context",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "\uB0A0\uC218\uB294 2\uAC1C\uC5EC\uC57C\uD558\uACE0 square \uC544\uB2C8\uACE0",
      turnCount: 4,
      currentFilters: [
        { field: "workPieceName", op: "eq", value: "Stainless Steels", rawValue: "Stainless Steels", appliedAt: 1 },
        { field: "fluteCount", op: "eq", value: "4", rawValue: 4, appliedAt: 2 },
        { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 2 },
      ],
      sessionState: {
        sessionId: "refine-1",
        candidateCount: 12,
        appliedFilters: [],
        narrowingHistory: [
          {
            question: "\uB0A0\uC218 \uBA87 \uAC1C\uAC00 \uD544\uC694\uD558\uC138\uC694?",
            askedField: "fluteCount",
            answer: "4\uB0A0",
            extractedFilters: [
              { field: "fluteCount", op: "eq", value: "4", rawValue: 4, appliedAt: 2 },
            ],
            candidateCountBefore: 28,
            candidateCountAfter: 12,
          },
        ],
        stageHistory: [],
        resolutionStatus: "narrowing",
        resolvedInput: { machiningCategory: "Milling" },
        turnCount: 3,
        currentMode: "narrowing",
        displayedCandidates: [
          { productCode: "V7-100", displayCode: "V7-100", displayLabel: "V7 demo", brand: "YG-1", seriesName: "V7", rank: 1 },
        ],
        displayedChips: ["\uC2A4\uD150\uC778\uB9AC\uC2A4", "4\uB0A0", "Square"],
        displayedOptions: [
          { index: 1, label: "2\uB0A0", field: "fluteCount", value: "2", count: 8 },
          { index: 2, label: "Square \uC81C\uC678", field: "toolSubtype", value: "Square", count: 9 },
        ],
        uiNarrowingPath: [
          { kind: "filter", label: "\uC2A4\uD150\uC778\uB9AC\uC2A4", field: "workPieceName", value: "Stainless Steels", candidateCount: 28 },
          { kind: "filter", label: "4\uB0A0", field: "fluteCount", value: "4", candidateCount: 12 },
        ],
      } as any,
      conversationHistory: [
        { role: "user", text: "\uC2A4\uD150\uC778\uB9AC\uC2A4 \uCD94\uCC9C\uD574\uC918" },
        { role: "assistant", text: "4\uB0A0 Square \uD6C4\uBCF4 12\uAC1C\uB97C \uBCF4\uACE0 \uC788\uC2B5\uB2C8\uB2E4." },
      ],
      requestPreparationIntent: "product_recommendation",
      requestPreparationSlots: [
        { field: "fluteCount", value: 2, source: "chat", confidence: "high" } as any,
      ],
      recognizedEntities: [
        { field: "toolSubtype", value: "Square" },
      ],
      complexity: assessComplexity("\uB0A0\uC218\uB294 2\uAC1C\uC5EC\uC57C\uD558\uACE0 square \uC544\uB2C8\uACE0", 3),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
      stage1CotEscalation: {
        enabled: true,
        currentCandidateCount: 12,
      },
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.validation?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "mixed_clause_ambiguity" }),
    ]))
    expect(result.clarification?.question).toContain("Square")
    expect(result.clarification?.chips).toContain("\uC9C1\uC811 \uC785\uB825")
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("keeps Stage 2 resolved filters when semantic output is replayed from cache", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [
          { field: "fluteCount", op: "eq", value: 4, rawToken: "4 flute" },
          { field: "coating", op: "skip", rawToken: "뭐가 됐든" },
        ],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.91,
        unresolvedTokens: [],
        reasoning: "skip coating and keep flute",
      }),
    )

    const args = {
      message: "코팅 뭐가 됐든 4날만",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("코팅 뭐가 됐든 4날만"),
      stageOneDeterministicActions: [
        {
          type: "apply_filter" as const,
          field: "fluteCount",
          value: 4,
          op: "eq" as const,
          source: "deterministic" as const,
        },
      ],
    }

    await resolveMultiStageQuery({
      ...args,
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    const cachedStage2Provider = makeProvider()
    const cached = await resolveMultiStageQuery({
      ...args,
      turnCount: 4,
      stage2Provider: cachedStage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(cached.source).toBe("cache")
    expect(cached.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
      expect.objectContaining({ field: "coating", op: "skip", rawValue: "skip" }),
    ]))
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

  it("passes schema phonetic hints into Stage 3 so brand truth survives timeout fallback", async () => {
    const stage3Provider = {
      available: () => true,
      complete: vi.fn(async (_systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        const userPrompt = messages[0]?.content ?? ""
        expect(userPrompt).toContain("Possible schema phonetic hints:")
        expect(userPrompt).toContain("알루컷")
        expect(userPrompt).toContain("ALU-CUT for Korean Market")
        return JSON.stringify({
          filters: [{ field: "brand", op: "eq", value: "ALU-CUT for Korean Market", rawToken: "알루컷" }],
          sort: null,
          routeHint: "show_recommendation",
          clearOtherFilters: false,
          confidence: 0.95,
          unresolvedTokens: [],
          reasoning: "schema phonetic hint matched brand",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "알루컷 브랜드 중에서 추천해줄수 있어요?",
      turnCount: 3,
      currentFilters: [],
      complexity: makeDeepComplexity("schema_hint_stage3"),
      stage2Provider: makeProvider(""),
      stage3Provider,
    })

    expect(result.source).toBe("stage3")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", rawValue: "ALU-CUT" }),
    ])
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("does not let a weaker Stage 3 overlay override a Stage 2 compare route", async () => {
    const result = await resolveMultiStageQuery({
      message: "GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?"),
      stage2Provider: makeProvider(JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "compare_products",
        intent: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.85,
        unresolvedTokens: ["GMI4710055"],
        reasoning: "similarity request recognized",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        intent: "show_recommendation",
        clearOtherFilters: true,
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "weaker overlay without compare route hint",
      })),
    })

    expect(result.source).toBe("stage2")
    expect(result.routeHint).toBe("compare_products")
    expect(result.clearOtherFilters).toBe(false)
  })

  it("ignores clearOtherFilters-only outputs when there is nothing to release", async () => {
    const result = await resolveMultiStageQuery({
      message: "GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?"),
      stage2Provider: makeProvider(JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        intent: "none",
        clearOtherFilters: false,
        confidence: 0.15,
        unresolvedTokens: ["GMI4710055"],
        reasoning: "still unresolved",
      })),
      stage3Provider: makeProvider(JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        intent: "none",
        clearOtherFilters: true,
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "no-op clear only",
      })),
    })

    expect(result.source).toBe("clarification")
    expect(result.clearOtherFilters).toBe(false)
    expect(result.intent).toBe("ask_clarification")
  })

  it("passes compare_products guidance into the resolver prompt", async () => {
    const stage2Provider = {
      available: () => true,
      complete: vi.fn(async (systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        expect(systemPrompt).toContain("compare_products")
        expect(systemPrompt).toContain("similar product")
        expect(messages[0]?.content ?? "").toContain("GMI4710055")
        return JSON.stringify({
          filters: [],
          sort: null,
          routeHint: "compare_products",
          clearOtherFilters: false,
          confidence: 0.93,
          unresolvedTokens: ["GMI4710055"],
          reasoning: "similar product request around a specific item",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.routeHint).toBe("compare_products")
  })

  it("maps Stage 2 question route hints to answer_general intent", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "general_question",
        clearOtherFilters: false,
        confidence: 0.91,
        unresolvedTokens: [],
        reasoning: "tool-domain side question",
      }),
    )

    const result = await resolveMultiStageQuery({
      message: "Excellent가 뭐야?",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("Excellent가 뭐야?"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("answer_general")
    expect(result.routeHint).toBe("general_question")
  })

  it("keeps the concrete filter and drops redundant clearOtherFilters on an empty session", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "diameterMm", op: "eq", value: 10, rawToken: "10mm" }],
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
      stageOneClearUnmentionedFields: true,
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.clearOtherFilters).toBe(false)
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
    ])
  })

  it("normalizes numeric inventory thresholds to totalStock", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "stockStatus", op: "gte", value: 100, rawToken: "재고 100개 이상" }],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.89,
        unresolvedTokens: [],
        reasoning: "numeric inventory threshold",
      }),
    )

    const result = await resolveMultiStageQuery({
      message: "알루미늄 Square 재고 100개 이상 3날",
      turnCount: 3,
      currentFilters: [],
      complexity: assessComplexity("알루미늄 Square 재고 100개 이상 3날"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "totalStock", op: "gte", rawValue: 100 }),
    ]))
  })

  it("asks for workpiece on bare first-turn recommendation requests", async () => {
    const stage2Provider = makeProvider()
    const stage3Provider = makeProvider()

    const result = await resolveMultiStageQuery({
      message: "추천해줘",
      turnCount: 1,
      currentFilters: [],
      complexity: assessComplexity("추천해줘"),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("none")
    expect(result.intent).toBe("none")
    expect(result.clarification).toBeNull()
    expect(stage2Provider.complete).not.toHaveBeenCalled()
    expect(stage3Provider.complete).not.toHaveBeenCalled()
  })

  it("returns clarification instead of none when every stage fails", async () => {
    const stage2Provider = makeProvider("")

    const result = await resolveMultiStageQuery({
      message: "알루컷으로 제일 좋은 거",
      turnCount: 7,
      currentFilters: [],
      complexity: assessComplexity("알루컷으로 제일 좋은 거"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.clarification?.question).toContain("기준이 넓어서")
    expect(result.clarification?.chips).toContain("직접 입력")
  })
  it("does not commit Stage 1 sort hints when later stages fall back to clarification", async () => {
    const result = await resolveMultiStageQuery({
      message: "?醫롮삢 ??뽰뵬 疫뀀떯援ф에??곕뗄荑??곻폒?紐꾩뒄",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("?醫롮삢 ??뽰뵬 疫뀀떯援ф에??곕뗄荑??곻폒?紐꾩뒄"),
      stageOneSort: { field: "lengthOfCutMm", direction: "desc" },
      stage2Provider: makeProvider(""),
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("clarification")
    expect(result.sort).toBeNull()
    expect(result.intent).toBe("ask_clarification")
    expect(result.clarification).not.toBeNull()
  })

  it("does not treat intent-only show_recommendation as a resolved truth source", async () => {
    const result = await resolveMultiStageQuery({
      message: "애매한 브랜드로 추천해줄수 있어요?",
      turnCount: 8,
      currentFilters: [],
      complexity: assessComplexity("애매한 브랜드로 추천해줄수 있어요?"),
      stage2Provider: makeProvider(""),
      stage3Provider: makeProvider(JSON.stringify({
        filters: [],
        sort: null,
        routeHint: "none",
        intent: "show_recommendation",
        clearOtherFilters: false,
        confidence: 0.95,
        unresolvedTokens: [],
        reasoning: "user wants recommendations",
      })),
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(result.filters).toEqual([])
    expect(result.clarification).not.toBeNull()
  })
  it("injects scoped material mapping context into Stage 2 for unresolved material aliases", async () => {
    const stage2Provider = {
      available: () => true,
      complete: vi.fn(async (_systemPrompt: string, messages: Array<{ role: string; content: string }>) => {
        const userPrompt = messages[0]?.content ?? ""
        expect(userPrompt).toContain("Material mapping context:")
        expect(userPrompt).toContain("Carbon Steel")
        expect(userPrompt).toContain("ISO P")
        return JSON.stringify({
          filters: [{ field: "workPieceName", op: "eq", value: "Carbon Steel", rawToken: "AISI 1010" }],
          sort: null,
          routeHint: "show_recommendation",
          clearOtherFilters: false,
          confidence: 0.93,
          unresolvedTokens: [],
          reasoning: "material mapping context resolved the alias",
        })
      }),
      completeWithTools: vi.fn(async () => ({ text: null, toolUse: null })),
    } as unknown as LLMProvider & { complete: ReturnType<typeof vi.fn> }

    const result = await resolveMultiStageQuery({
      message: "AISI 1010 carbon steel recommendation",
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity("AISI 1010 carbon steel recommendation"),
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage2")
    expect(result.intent).toBe("show_recommendation")
    expect(result.filters).toEqual([
      expect.objectContaining({
        field: "workPieceName",
        op: "eq",
        value: "Carbon Steels",
        rawValue: "Carbon Steels",
      }),
    ])
  })

  it("routes fast deterministic filter hints through semantic interpretation before clarification", async () => {
    const message = "10mm 이상"
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 10 }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.99,
      unresolvedTokens: [],
      reasoning: "should not run",
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "diameterMm", op: "gte", value: 10 }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.99,
      unresolvedTokens: [],
      reasoning: "should not run",
    }))

    const result = await resolveMultiStageQuery({
      message,
      turnCount: 3,
      currentFilters: [],
      stageOneDeterministicActions: [
        {
          type: "apply_filter",
          field: "diameterMm",
          value: 10,
          op: "gte",
          source: "deterministic",
        },
      ] as any,
      complexity: assessComplexity(message),
      stage2Provider,
      stage3Provider,
    })

    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).toHaveBeenCalledTimes(1)
  })

  it("does not escalate normal-path requests to Stage 3", async () => {
    const message = "4날 Square 추천"
    const stage2Provider = makeProvider(JSON.stringify({
      filters: [],
      sort: null,
      routeHint: "none",
      clearOtherFilters: false,
      confidence: 0.41,
      unresolvedTokens: ["square"],
      reasoning: "still uncertain",
      clarification: {
        question: "형상을 더 구체적으로 알려주세요.",
        chips: ["Square", "Ball", "직접 입력"],
      },
    }))
    const stage3Provider = makeProvider(JSON.stringify({
      filters: [{ field: "toolSubtype", op: "eq", value: "Square" }],
      sort: null,
      routeHint: "show_recommendation",
      clearOtherFilters: false,
      confidence: 0.98,
      unresolvedTokens: [],
      reasoning: "should not run",
    }))

    const result = await resolveMultiStageQuery({
      message,
      turnCount: 4,
      currentFilters: [],
      complexity: assessComplexity(message),
      stage2Provider,
      stage3Provider,
    })

    expect(stage2Provider.complete).toHaveBeenCalledTimes(1)
    expect(stage3Provider.complete).not.toHaveBeenCalled()
    expect(result.source).toBe("clarification")
    expect(result.intent).toBe("ask_clarification")
  })
})

