import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LLMProvider } from "@/lib/llm/provider"
import { assessComplexity } from "../complexity-router"
import { parseEditIntent } from "../edit-intent"
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

  it("returns Stage 1 immediately for deterministic skip intents", async () => {
    const stage2Provider = makeProvider()
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

    expect(result.source).toBe("stage1")
    expect(result.intent).toBe("continue_narrowing")
    expect(result.removeFields).toEqual(["shankType"])
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "shankType", op: "skip", rawValue: "skip" }),
    ])
    expect(stage2Provider.complete).not.toHaveBeenCalled()
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

  it("merges Stage 1 deterministic output with Stage 2 semantic output", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "coating", op: "skip", rawToken: "뭐가 됐든" }],
        sort: null,
        routeHint: "none",
        clearOtherFilters: false,
        confidence: 0.91,
        unresolvedTokens: [],
        reasoning: "skip coating and keep flute",
      }),
    )

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

  it("keeps Stage 1 deterministic filters when semantic output is replayed from cache", async () => {
    const stage2Provider = makeProvider(
      JSON.stringify({
        filters: [{ field: "coating", op: "skip", rawToken: "뭐가 됐든" }],
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
          type: "apply_filter",
          field: "fluteCount",
          value: 4,
          op: "eq" as const,
          source: "deterministic",
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
      complexity: assessComplexity("알루컷 브랜드 중에서 추천해줄수 있어요?"),
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
      message: "GMI4710055 ?댁젣?덉씠??鍮꾩듂???쒗뭹??異붿쿇?댁쨪???덉뼱??",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("GMI4710055 ?댁젣?덉씠??鍮꾩듂???쒗뭹??異붿쿇?댁쨪???덉뼱??"),
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
      message: "GMI4710055 ?댁젣?덉씠??鍮꾩듂???쒗뭹??異붿쿇?댁쨪???덉뼱??",
      turnCount: 6,
      currentFilters: [],
      complexity: assessComplexity("GMI4710055 ?댁젣?덉씠??鍮꾩듂???쒗뭹??異붿쿇?댁쨪???덉뼱??"),
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
      stageOneClearUnmentionedFields: true,
      stage2Provider,
      stage3Provider: makeUnavailableProvider(),
    })

    expect(result.source).toBe("stage1")
    expect(result.clearOtherFilters).toBe(true)
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
    expect(result.clarification?.question).toContain("조금만 더 구체적으로")
    expect(result.clarification?.chips).toContain("직접 입력")
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
})
