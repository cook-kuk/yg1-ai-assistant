/**
 * Phase 4 Integration Tests
 *
 * Validates fixes for: side-question isolation, dynamic post-rec chips,
 * result refinement (flute/stock), back/undo, validator guardrails,
 * field consistency, and non-search intent candidate preservation.
 */

import { describe, it, expect } from "vitest"
import {
  createInitialSessionState,
  applyStateTransition,
  buildSurface,
} from "../turn-orchestrator"
import {
  setBaseConstraint,
  createRevisionNode,
} from "../constraint-helpers"
import { validateSurfaceV2 } from "../response-validator"
import { refineResults, buildRefinementOptions } from "../result-refiner"
import type {
  RecommendationSessionState,
  LlmTurnDecision,
  ResultContext,
  CandidateRef,
  ResolvedAction,
} from "../types"

// ── Helpers ──────────────────────────────────────────────────

function mockDecision(overrides: Partial<LlmTurnDecision>): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
    actionInterpretation: {
      type: "continue_narrowing",
      rationale: "test",
      confidence: 0.9,
    },
    answerIntent: {
      topic: "narrowing",
      needsGroundedFact: false,
      shouldUseCurrentResultContext: false,
      shouldResumePendingQuestion: false,
    },
    uiPlan: { optionMode: "question_options" },
    answerDraft: "테스트 답변",
    ...overrides,
  }
}

function makeCandidateWithSpecs(
  code: string,
  rank: number,
  specs: { flute?: number | null; coating?: string | null; hasInventory?: boolean }
): CandidateRef {
  return {
    productCode: code,
    displayCode: code,
    rank,
    score: 100 - rank,
    seriesName: "TEST",
    keySpecs: specs,
  }
}

function makeResultContext(candidates: CandidateRef[]): ResultContext {
  return {
    candidates,
    totalConsidered: candidates.length * 5,
    searchTimestamp: Date.now(),
    constraintsUsed: { base: { material: "steel" }, refinements: {} },
  }
}

function stateWithNarrowingAndPending(): RecommendationSessionState {
  return {
    ...createInitialSessionState(),
    journeyPhase: "narrowing",
    constraints: {
      base: { material: "steel", diameter: 10 },
      refinements: {},
    },
    pendingQuestion: {
      field: "material",
      questionText: "세부 소재를 알려주세요",
      options: [
        { index: 1, label: "SUS304", field: "material", value: "SUS304", count: 0 },
        { index: 2, label: "SS400", field: "material", value: "SS400", count: 0 },
      ],
      turnAsked: 2,
      context: null,
    },
    turnCount: 3,
  }
}

function stateWithResults(): RecommendationSessionState {
  const candidates: CandidateRef[] = [
    makeCandidateWithSpecs("A001", 1, { flute: 3, coating: "AlTiN", hasInventory: true }),
    makeCandidateWithSpecs("A002", 2, { flute: 4, coating: "TiAlN", hasInventory: false }),
    makeCandidateWithSpecs("A003", 3, { flute: 3, coating: "AlTiN", hasInventory: true }),
    makeCandidateWithSpecs("A004", 4, { flute: 4, coating: "DLC", hasInventory: true }),
    makeCandidateWithSpecs("A005", 5, { flute: 2, coating: "TiAlN", hasInventory: false }),
  ]

  return {
    ...createInitialSessionState(),
    journeyPhase: "results_displayed",
    constraints: {
      base: { material: "steel", diameter: 10 },
      refinements: {},
    },
    resultContext: makeResultContext(candidates),
    turnCount: 5,
  }
}

// ── Test 1: Side question during narrowing preserves constraints ──

describe("Phase4 Test 1: Side question during narrowing preserves constraints", () => {
  it("constraints and pendingQuestion unchanged after side question", () => {
    const state = stateWithNarrowingAndPending()
    const constraintsBefore = JSON.parse(JSON.stringify(state.constraints))
    const pendingBefore = JSON.parse(JSON.stringify(state.pendingQuestion))

    const decision = mockDecision({
      actionInterpretation: {
        type: "answer_general",
        rationale: "user asked about Saudi branch",
        confidence: 0.9,
      },
      uiPlan: { optionMode: "none" },
      answerDraft: "사우디 지점은 리야드에 위치합니다.",
    })

    const next = applyStateTransition(state, decision)

    expect(next.constraints).toEqual(constraintsBefore)
    expect(next.pendingQuestion).toEqual(pendingBefore)
    expect(next.sideThreadActive).toBe(true)
  })
})

// ── Test 2: Side question during post-result preserves resultContext ──

describe("Phase4 Test 2: Side question during post-result preserves resultContext", () => {
  it("resultContext unchanged after side question with results displayed", () => {
    const state = stateWithResults()
    state.journeyPhase = "post_result_exploration"
    const candidatesBefore = state.resultContext!.candidates.length

    const decision = mockDecision({
      phaseInterpretation: { currentPhase: "post_result_exploration", confidence: 0.9 },
      actionInterpretation: {
        type: "answer_general",
        rationale: "user asked about Incheon factory address",
        confidence: 0.9,
      },
      uiPlan: { optionMode: "none" },
      answerDraft: "인천 공장은 남동공단에 위치합니다.",
    })

    const next = applyStateTransition(state, decision)

    expect(next.resultContext).not.toBeNull()
    expect(next.resultContext!.candidates.length).toBe(candidatesBefore)
    expect(next.sideThreadActive).toBe(true)
    expect(next.constraints).toEqual(state.constraints)
  })
})

// ── Test 3: Dynamic post-rec chips include distribution-based options ──

describe("Phase4 Test 3: Dynamic post-rec chips include distribution-based options", () => {
  it("buildSurface with result_followups + refine produces distribution chips", () => {
    const state = stateWithResults()

    const decision = mockDecision({
      phaseInterpretation: { currentPhase: "post_result_exploration", confidence: 0.9 },
      actionInterpretation: {
        type: "refine_current_results",
        rationale: "narrow by flute",
        confidence: 0.9,
      },
      uiPlan: { optionMode: "result_followups" },
      nextQuestion: { field: "flute", suggestedOptions: [], allowSkip: false },
      answerDraft: "날수로 좁혀볼까요?",
    })

    const surface = buildSurface(decision, state)

    // Should have distribution-based chips (e.g. "3날 (2개)", "4날 (2개)", "2날 (1개)")
    expect(surface.chips.length).toBeGreaterThan(0)
    expect(surface.chips.some(c => c.includes("날"))).toBe(true)
    expect(surface.displayedOptions.length).toBeGreaterThan(0)
    // Not the static 3 follow-up options
    expect(surface.chips.every(c => !c.includes("왜 이 제품을"))).toBe(true)
  })
})

// ── Test 4: Result refinement by flute actually filters ──

describe("Phase4 Test 4: Result refinement by flute filters correctly", () => {
  it("only 3-flute candidates remain after refine fluteCount=3", () => {
    const state = stateWithResults()
    const result = refineResults(state.resultContext!, "fluteCount", "3")

    expect(result.candidates.length).toBe(2)
    expect(result.candidates.every(c => c.keySpecs?.flute === 3)).toBe(true)
    // Re-ranked from 1
    expect(result.candidates[0].rank).toBe(1)
    expect(result.candidates[1].rank).toBe(2)
  })
})

// ── Test 5: Result refinement by stock filters correctly ──

describe("Phase4 Test 5: Result refinement by stock filters correctly", () => {
  it("only in-stock candidates remain", () => {
    const state = stateWithResults()
    const result = refineResults(state.resultContext!, "stock")

    expect(result.candidates.length).toBe(3)
    expect(result.candidates.every(c => c.keySpecs?.hasInventory === true)).toBe(true)
  })

  it("stock filter works even without explicit value", () => {
    const state = stateWithResults()
    const resultNoValue = refineResults(state.resultContext!, "stock")
    const resultWithValue = refineResults(state.resultContext!, "stock", "yes")

    // Both should filter to in-stock only
    expect(resultNoValue.candidates.length).toBe(3)
    expect(resultWithValue.candidates.length).toBe(3)
  })
})

// ── Test 6: Back/undo removes last constraint ──

describe("Phase4 Test 6: Back/undo removes last constraint", () => {
  it("go_back reverts to state before last revision", () => {
    let state = createInitialSessionState()

    // Revision 1: set material
    const action1: ResolvedAction = {
      type: "set_base_constraint",
      field: "material",
      oldValue: null,
      newValue: "steel",
    }
    state = createRevisionNode(state, action1)
    expect(state.constraints.base.material).toBe("steel")

    // Revision 2: set diameter
    const action2: ResolvedAction = {
      type: "set_base_constraint",
      field: "diameter",
      oldValue: null,
      newValue: 10,
    }
    state = createRevisionNode(state, action2)
    expect(state.revisionNodes.length).toBe(2)
    expect(state.constraints.base.diameter).toBe(10)

    // go_back: should revert diameter
    const decision = mockDecision({
      actionInterpretation: { type: "go_back", rationale: "undo last", confidence: 0.95 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.revisionNodes.length).toBe(1)
    expect(next.constraints.base.material).toBe("steel")
    expect(next.constraints.base.diameter).toBeUndefined()
    expect(next.pendingQuestion).toBeNull()
  })
})

// ── Test 7: Validator catches company leakage in recommendation ──

describe("Phase4 Test 7: Validator catches company leakage in recommendation", () => {
  it("warns when recommendation answer contains award/company info", () => {
    const surface = {
      answer: "이 제품은 수상 이력이 있는 시리즈입니다. A001 추천합니다.",
      displayedOptions: [],
      chips: [],
    }

    const decision = mockDecision({
      answerIntent: {
        topic: "recommendation",
        needsGroundedFact: false,
        shouldUseCurrentResultContext: true,
        shouldResumePendingQuestion: false,
      },
      uiPlan: { optionMode: "none" },
    })

    const result = validateSurfaceV2(surface, decision, true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some(w => w.includes("Company info leakage"))).toBe(true)
    expect(result.valid).toBe(false)
  })
})

// ── Test 8: Validator strips fake citations ──

describe("Phase4 Test 8: Validator strips fake citations", () => {
  it("removes fake citation phrases from answer", () => {
    const surface = {
      answer: "이 제품이 좋습니다. 공식 정보 기반 AI 추론 결과입니다.",
      displayedOptions: [],
      chips: [],
    }

    const decision = mockDecision({
      answerIntent: {
        topic: "narrowing",
        needsGroundedFact: false,
        shouldUseCurrentResultContext: false,
        shouldResumePendingQuestion: false,
      },
      uiPlan: { optionMode: "none" },
    })

    const result = validateSurfaceV2(surface, decision, false)
    expect(result.answer).not.toContain("공식 정보 기반 AI 추론")
    expect(result.rewrites).toContain("removed_fake_citations")
  })
})

// ── Test 9: Field consistency enforced ──

describe("Phase4 Test 9: Field consistency enforced", () => {
  it("removes options with wrong field when question field differs", () => {
    const surface = {
      answer: "코팅을 선택해주세요.",
      displayedOptions: [
        { label: "AlTiN", field: "coating", value: "AlTiN" },
        { label: "4날", field: "fluteCount", value: "4" },
        { label: "TiAlN", field: "coating", value: "TiAlN" },
      ],
      chips: ["AlTiN", "4날", "TiAlN"],
    }

    const decision = mockDecision({
      nextQuestion: {
        field: "coating",
        suggestedOptions: [
          { label: "AlTiN", value: "AlTiN" },
          { label: "TiAlN", value: "TiAlN" },
        ],
        allowSkip: false,
      },
    })

    const result = validateSurfaceV2(surface, decision, false)
    // fluteCount option should be removed
    expect(result.displayedOptions.every(
      opt => !opt.field || opt.field === "coating" || opt.field === "_action" || opt.field === "_control"
    )).toBe(true)
    expect(result.chips).not.toContain("4날")
    expect(result.rewrites).toContain("removed_stale_field_options")
  })
})

// ── Test 10: Non-search intent preserves candidate count ──

describe("Phase4 Test 10: Non-search intent preserves candidate count", () => {
  it("answer_general does not alter resultContext or candidate count", () => {
    const state = stateWithResults()
    // Manually set 32 candidates
    const candidates: CandidateRef[] = Array.from({ length: 32 }, (_, i) =>
      makeCandidateWithSpecs(`P${String(i + 1).padStart(3, "0")}`, i + 1, {
        flute: (i % 3) + 2,
        coating: "AlTiN",
        hasInventory: i % 2 === 0,
      })
    )
    state.resultContext = makeResultContext(candidates)
    expect(state.resultContext.candidates.length).toBe(32)

    const decision = mockDecision({
      actionInterpretation: {
        type: "answer_general",
        rationale: "general question",
        confidence: 0.9,
      },
      uiPlan: { optionMode: "none" },
      answerDraft: "일반적인 답변입니다.",
    })

    const next = applyStateTransition(state, decision)
    expect(next.resultContext).not.toBeNull()
    expect(next.resultContext!.candidates.length).toBe(32)
  })
})
