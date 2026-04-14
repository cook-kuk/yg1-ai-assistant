import { describe, expect, it } from "vitest"

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import type { MultiStageResolverResult } from "@/lib/recommendation/core/multi-stage-query-resolver"
import { applyClarificationArbiterDecision } from "../serve-engine-runtime"

function makeClarificationResult(overrides: Partial<MultiStageResolverResult> = {}): MultiStageResolverResult {
  return {
    source: "clarification",
    filters: [],
    sort: null,
    routeHint: "none",
    intent: "ask_clarification",
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: 0,
    unresolvedTokens: ["Square"],
    reasoning: "clarification:generic",
    concepts: [],
    clarification: {
      question: "현재는 형상 쪽이 애매합니다.",
      chips: ["직접 입력"],
      askedField: null,
    },
    ...overrides,
  }
}

describe("applyClarificationArbiterDecision", () => {
  it("reuses current UI options instead of keeping a generic clarification", () => {
    const prevState = buildSessionState({
      candidateCount: 5,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Carbon Steels", rawValue: "Carbon Steels", appliedAt: 0 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        workPieceName: "Carbon Steels",
      } as any,
      turnCount: 1,
      displayedCandidates: [] as any,
      displayedChips: ["Square (2개)", "Ball (2개)", "Radius (1개)"],
      displayedOptions: [
        { index: 1, label: "Square (2개)", field: "toolSubtype", value: "Square", count: 2 },
        { index: 2, label: "Ball (2개)", field: "toolSubtype", value: "Ball", count: 2 },
        { index: 3, label: "Radius (1개)", field: "toolSubtype", value: "Radius", count: 1 },
      ],
      currentMode: "question",
      lastAskedField: "toolSubtype",
    })

    const outcome = applyClarificationArbiterDecision({
      decision: {
        decision: "use_state_options",
        confidence: 0.86,
        reasoning: "current UI already shows shape alternatives",
        targetField: "toolSubtype",
        excludedValue: "Square",
      },
      prevState,
      result: makeClarificationResult(),
      userMessage: "Square 아니것중에 추천할거 있어요?",
    })

    expect(outcome.kind).toBe("use_state_options")
    if (outcome.kind !== "use_state_options") return

    expect(outcome.clarification.chips).toEqual(expect.arrayContaining(["Ball (2개)", "Radius (1개)", "직접 입력"]))
    expect(outcome.clarification.chips).not.toContain("Square (2개)")
    expect(outcome.clarification.displayedOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "toolSubtype", value: "Ball" }),
      expect.objectContaining({ field: "toolSubtype", value: "Radius" }),
    ]))
  })

  it("suppresses a clarification and lets legacy routing continue when the arbiter says not to ask", () => {
    const prevState = buildSessionState({
      candidateCount: 3,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Stainless", rawValue: "Stainless", appliedAt: 0 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        workPieceName: "Stainless",
      } as any,
      turnCount: 1,
      displayedCandidates: [] as any,
      displayedChips: [],
      displayedOptions: [],
      currentMode: "recommendation",
    })

    const outcome = applyClarificationArbiterDecision({
      decision: {
        decision: "continue_legacy",
        confidence: 0.78,
        reasoning: "user is asking to keep flowing, not to stop for another question",
        targetField: null,
        excludedValue: null,
      },
      prevState,
      result: makeClarificationResult(),
      userMessage: "그거 말고 더 무난한 거",
    })

    expect(outcome.kind).toBe("continue_legacy")
    if (outcome.kind !== "continue_legacy") return

    expect(outcome.result.source).toBe("none")
    expect(outcome.result.intent).toBe("none")
    expect(outcome.result.clarification).toBeNull()
  })

  it("preserves concrete execution data when legacy fallback should continue after a clarification overlay", () => {
    const prevState = buildSessionState({
      candidateCount: 7,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Carbon Steels", rawValue: "Carbon Steels", appliedAt: 0 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        workPieceName: "Carbon Steels",
      } as any,
      turnCount: 1,
      displayedCandidates: [] as any,
      displayedChips: [],
      displayedOptions: [],
      currentMode: "recommendation",
    })

    const result = makeClarificationResult({
      source: "stage2",
      filters: [{ field: "fluteCount", op: "eq", value: 2, rawValue: 2, appliedAt: 1 }] as any,
      intent: "continue_narrowing",
      clarification: {
        question: "현재는 2날로 보이는데 더 확인할까요?",
        chips: ["직접 입력"],
        askedField: "fluteCount",
      },
    })

    const outcome = applyClarificationArbiterDecision({
      decision: {
        decision: "continue_legacy",
        confidence: 0.73,
        reasoning: "deterministic execution already has a concrete delta",
        targetField: null,
        excludedValue: null,
      },
      prevState,
      result,
      userMessage: "2날로 바꿔줘",
    })

    expect(outcome.kind).toBe("continue_legacy")
    if (outcome.kind !== "continue_legacy") return

    expect(outcome.result.source).toBe("stage2")
    expect(outcome.result.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount", rawValue: 2 }),
    ]))
    expect(outcome.result.clarification).toBeNull()
  })
})
