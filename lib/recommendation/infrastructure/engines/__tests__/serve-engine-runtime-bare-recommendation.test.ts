import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  applyThinkingFieldsToPayload,
  buildResolverSimilaritySpecPatch,
  isBareRecommendationRequest,
  shouldExposeFullThinking,
  shouldUseSqlAgentSemanticCache,
  shouldAllowTurn0LexicalAnswerIntercept,
  shouldBypassFirstTurnMultiStageResolver,
  shouldShortCircuitFirstTurnIntake,
} from "../serve-engine-runtime"

describe("first-turn routing guards", () => {
  it("treats bare first-turn recommendation requests as recommendation flow", () => {
    expect(isBareRecommendationRequest("\uCD94\uCC9C\uD574\uC918", false)).toBe(true)
    expect(isBareRecommendationRequest("\uACE8\uB77C\uC918", false)).toBe(true)
    expect(isBareRecommendationRequest("\uBB50\uAC00 \uC88B\uC544?", false)).toBe(true)
  })

  it("does not fire once session context already exists", () => {
    expect(isBareRecommendationRequest("\uCD94\uCC9C\uD574\uC918", true)).toBe(false)
  })

  it("does not steal explicit knowledge questions", () => {
    expect(isBareRecommendationRequest("\uD5EC\uB9AD\uC2A4\uAC00 \uBB50\uC57C?", false)).toBe(false)
    expect(isBareRecommendationRequest("AlCrN\uACFC TiAlN \uCC28\uC774", false)).toBe(false)
  })

  it("bypasses first-turn multi-stage clarification only for pure recommendation asks", () => {
    expect(shouldBypassFirstTurnMultiStageResolver({
      message: "\uCD94\uCC9C\uD574\uC918",
      hasEditIntent: false,
      hasSort: false,
      stageOneActionCount: 0,
    })).toBe(true)

    expect(shouldBypassFirstTurnMultiStageResolver({
      message: "\uC2A4\uD14C\uC778\uB9AC\uC2A4 \uCD94\uCC9C\uD574\uC918",
      hasEditIntent: false,
      hasSort: false,
      stageOneActionCount: 1,
    })).toBe(false)

    expect(shouldBypassFirstTurnMultiStageResolver({
      message: "\uC88B\uC740 \uAC83 \uACE8\uB77C\uC918",
      hasEditIntent: false,
      hasSort: true,
      stageOneActionCount: 0,
    })).toBe(false)
  })

  it("blocks the turn0 lexical answer intercept once the resolver handled the turn", () => {
    expect(shouldAllowTurn0LexicalAnswerIntercept(null)).toBe(true)
    expect(shouldAllowTurn0LexicalAnswerIntercept({
      source: "none",
      confidence: 0,
      filters: [],
      removeFields: [],
      routeHint: "none",
      intent: "none",
      sort: null,
      clearOtherFilters: false,
      unresolvedTokens: [],
      reasoning: "",
      followUpFilter: null,
      clarification: null,
    } as any)).toBe(true)
    expect(shouldAllowTurn0LexicalAnswerIntercept({
      source: "stage2",
      confidence: 0.92,
      filters: [],
      removeFields: [],
      routeHint: "general_question",
      intent: "answer_general",
      sort: null,
      clearOtherFilters: false,
      unresolvedTokens: [],
      reasoning: "tool-domain question",
      followUpFilter: null,
      clarification: null,
    } as any)).toBe(false)
  })

  it("short-circuits first turn only for bypass or terminal resolver results", () => {
    expect(shouldShortCircuitFirstTurnIntake({
      bypassResolver: true,
      resolverResult: null,
    })).toBe(true)

    expect(shouldShortCircuitFirstTurnIntake({
      bypassResolver: false,
      resolverResult: {
        source: "stage2",
        confidence: 0.88,
        filters: [],
        removeFields: [],
        routeHint: "general_question",
        intent: "answer_general",
        sort: null,
        clearOtherFilters: false,
        unresolvedTokens: [],
        reasoning: "handled by stage2",
        followUpFilter: null,
        clarification: null,
      } as any,
    })).toBe(true)

    expect(shouldShortCircuitFirstTurnIntake({
      bypassResolver: false,
      resolverResult: {
        source: "none",
        confidence: 0,
        filters: [],
        removeFields: [],
        routeHint: "none",
        intent: "none",
        sort: null,
        clearOtherFilters: false,
        unresolvedTokens: [],
        reasoning: "",
        followUpFilter: null,
        clarification: null,
      } as any,
    })).toBe(false)
  })

  it("builds a similarity spec patch from resolver route hints plus product code", () => {
    const patch = buildResolverSimilaritySpecPatch({
      source: "stage3",
      confidence: 0.92,
      filters: [],
      removeFields: [],
      routeHint: "compare_products",
      intent: "show_recommendation",
      sort: null,
      clearOtherFilters: false,
      unresolvedTokens: ["GMI4710055"],
      reasoning: "similar product request",
      followUpFilter: null,
      clarification: null,
    } as any, "GMI4710055 이제품이랑 비슷한 제품을 추천해줄수 있어요?")

    expect(patch).toEqual({
      similarTo: {
        referenceProductId: "GMI4710055",
        topK: 10,
      },
    })
  })

  it("enables full thinking in dev/test app modes only", () => {
    const prevAppMode = process.env.APP_MODE

    process.env.APP_MODE = "dev"
    vi.stubEnv("NODE_ENV", "production")
    expect(shouldExposeFullThinking()).toBe(true)

    process.env.APP_MODE = "production"
    vi.stubEnv("NODE_ENV", "production")
    expect(shouldExposeFullThinking()).toBe(false)

    process.env.APP_MODE = ""
    vi.stubEnv("NODE_ENV", "test")
    expect(shouldExposeFullThinking()).toBe(true)

    process.env.APP_MODE = prevAppMode
    vi.unstubAllEnvs()
  })

  it("injects thinkingDeep into final payload and engine state", () => {
    const payload = applyThinkingFieldsToPayload({
      text: "ok",
      session: {
        publicState: null,
        engineState: {
          sessionId: "s1",
        },
      },
    }, {
      thinkingProcess: "short",
      thinkingDeep: "full cot",
    }) as any

    expect(payload.thinkingProcess).toBe("short")
    expect(payload.thinkingDeep).toBe("full cot")
    expect(payload.session.engineState.thinkingProcess).toBe("short")
    expect(payload.session.engineState.thinkingDeep).toBe("full cot")
  })

  it("always enables sql-agent semantic cache (cached reasoning replayed on hit)", () => {
    expect(shouldUseSqlAgentSemanticCache(true)).toBe(true)
    expect(shouldUseSqlAgentSemanticCache(false)).toBe(true)
  })
})
