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
})
