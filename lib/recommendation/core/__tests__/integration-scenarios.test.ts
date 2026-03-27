/**
 * Integration Scenarios — V2 Orchestrator
 *
 * Tests the pipeline behavior given specific (mocked) LLM decisions.
 * Covers: constraint accumulation, result refinement, side questions,
 * pending actions, back/undo, and validator hallucination detection.
 */

import { describe, it, expect } from "vitest"
import { createInitialSessionState, applyStateTransition, buildSurface } from "../turn-orchestrator"
import { setBaseConstraint, applyRefinement, createRevisionNode } from "../constraint-helpers"
import { validateSurfaceV2 } from "../response-validator"
import type {
  RecommendationSessionState,
  LlmTurnDecision,
  ResultContext,
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
    answerDraft: "Test answer",
    ...overrides,
  }
}

function stateWithResults(): RecommendationSessionState {
  const state = createInitialSessionState()
  state.journeyPhase = "results_displayed"
  state.constraints = {
    base: { material: "알루미늄", diameter: 10 },
    refinements: {},
  }
  state.resultContext = {
    candidates: [
      { productCode: "A001", displayCode: "A001", rank: 1, score: 90, seriesName: "ALU-CUT" },
      { productCode: "A002", displayCode: "A002", rank: 2, score: 85, seriesName: "ALU-POWER" },
      { productCode: "A003", displayCode: "A003", rank: 3, score: 80, seriesName: "ALU-CUT" },
    ],
    totalConsidered: 50,
    searchTimestamp: Date.now(),
    constraintsUsed: { base: { material: "알루미늄" }, refinements: {} },
  }
  return state
}

// ── Scenario 1: Constraint accumulation ─────────────────────

describe("Scenario 1: Constraint accumulation", () => {
  it("accumulates base constraints across turns", () => {
    let state = createInitialSessionState()
    expect(state.constraints.base).toEqual({})

    // Turn 1: set material
    state = setBaseConstraint(state, "material", "알루미늄")
    expect(state.constraints.base).toEqual({ material: "알루미늄" })

    // Turn 2: set diameter — both should exist
    state = setBaseConstraint(state, "diameter", 10)
    expect(state.constraints.base).toEqual({ material: "알루미늄", diameter: 10 })
  })

  it("does not overwrite existing base constraint via setBaseConstraint", () => {
    let state = createInitialSessionState()
    state = setBaseConstraint(state, "material", "알루미늄")
    state = setBaseConstraint(state, "material", "스틸")
    expect(state.constraints.base.material).toBe("알루미늄")
  })

  it("builds chips from nextQuestion options", () => {
    const decision = mockDecision({
      uiPlan: { optionMode: "question_options" },
      nextQuestion: {
        field: "material",
        suggestedOptions: [
          { label: "알루미늄", value: "aluminum" },
          { label: "스틸", value: "steel" },
        ],
        allowSkip: true,
      },
    })
    const surface = buildSurface(decision, createInitialSessionState())
    expect(surface.chips.length).toBe(3) // 2 options + skip
    expect(surface.displayedOptions.every((o) => o.field === "material")).toBe(true)
  })
})

// ── Scenario 2: Result refinement doesn't reset ─────────────

describe("Scenario 2: Result refinement preserves state", () => {
  it("keeps journeyPhase in results area after refinement decision", () => {
    const state = stateWithResults()

    const decision = mockDecision({
      phaseInterpretation: { currentPhase: "post_result_exploration", confidence: 0.9 },
      actionInterpretation: { type: "continue_narrowing", rationale: "refine flute", confidence: 0.9 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.journeyPhase).toBe("post_result_exploration")
    expect(next.constraints.base.material).toBe("알루미늄")
    expect(next.constraints.base.diameter).toBe(10)
  })

  it("preserves resultContext through state transition", () => {
    const state = stateWithResults()
    const decision = mockDecision({
      phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.9 },
      actionInterpretation: { type: "continue_narrowing", rationale: "narrow further", confidence: 0.8 },
    })
    const next = applyStateTransition(state, decision)
    expect(next.resultContext).not.toBeNull()
    expect(next.resultContext!.candidates.length).toBe(3)
  })
})

// ── Scenario 3: Side question isolation ─────────────────────

describe("Scenario 3: Side question isolation", () => {
  it("activates sideThreadActive without changing constraints", () => {
    const state = stateWithResults()
    state.pendingQuestion = {
      field: "coating",
      questionText: "어떤 코팅을 원하시나요?",
      options: [],
      turnAsked: 2,
      context: null,
    }

    const decision = mockDecision({
      actionInterpretation: { type: "answer_general", rationale: "side question", confidence: 0.9 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(true)
    expect(next.constraints).toEqual(state.constraints)
    expect(next.pendingQuestion).toEqual(state.pendingQuestion)
  })

  it("deactivates sideThread when user returns to narrowing", () => {
    let state = stateWithResults()
    state.sideThreadActive = true

    const decision = mockDecision({
      actionInterpretation: { type: "continue_narrowing", rationale: "back on topic", confidence: 0.9 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })
})

// ── Scenario 4: Pending action binding ──────────────────────

describe("Scenario 4: Pending action binding", () => {
  it("clears pendingAction on reset_session (full reset)", () => {
    let state = createInitialSessionState()
    state.pendingAction = {
      type: "apply_filter",
      label: "코팅 DLC 적용",
      payload: { field: "coating", value: "DLC" },
      sourceTurnId: "turn-1",
      createdAt: Date.now(),
      expiresAfterTurns: 3,
    }

    const decision = mockDecision({
      actionInterpretation: { type: "reset_session", rationale: "user wants fresh start", confidence: 0.95 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.pendingAction).toBeNull()
    expect(next.constraints.base).toEqual({})
  })

  it("preserves pendingAction on unrelated action", () => {
    let state = createInitialSessionState()
    state.pendingAction = {
      type: "apply_filter",
      label: "코팅 DLC 적용",
      payload: { field: "coating", value: "DLC" },
      sourceTurnId: "turn-1",
      createdAt: Date.now(),
      expiresAfterTurns: 3,
    }

    const decision = mockDecision({
      actionInterpretation: { type: "continue_narrowing", rationale: "asking next question", confidence: 0.9 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.pendingAction).toEqual(state.pendingAction)
  })
})

// ── Scenario 5: Back/undo ───────────────────────────────────

describe("Scenario 5: Back/undo via go_back", () => {
  it("reverts constraints to parent revision", () => {
    let state = createInitialSessionState()

    // Build two revision nodes by applying two constraint actions
    const action1: ResolvedAction = {
      type: "set_base_constraint",
      field: "material",
      oldValue: null,
      newValue: "알루미늄",
    }
    state = createRevisionNode(state, action1)
    // After action1: constraints = { base: { material: "알루미늄" }, refinements: {} }
    expect(state.constraints.base.material).toBe("알루미늄")

    const action2: ResolvedAction = {
      type: "set_base_constraint",
      field: "diameter",
      oldValue: null,
      newValue: 10,
    }
    state = createRevisionNode(state, action2)
    // After action2: constraints = { base: { material: "알루미늄", diameter: 10 }, refinements: {} }
    expect(state.revisionNodes.length).toBe(2)
    expect(state.constraints.base.diameter).toBe(10)

    // Now go_back should revert to constraintsBefore of the last revision node
    const decision = mockDecision({
      actionInterpretation: { type: "go_back", rationale: "undo last", confidence: 0.95 },
    })

    const next = applyStateTransition(state, decision)
    // go_back pops the last revision and restores constraintsBefore
    expect(next.revisionNodes.length).toBe(1)
    expect(next.constraints.base.material).toBe("알루미늄")
    expect(next.constraints.base.diameter).toBeUndefined()
  })

  it("clears pendingQuestion on go_back", () => {
    let state = createInitialSessionState()
    const action: ResolvedAction = { type: "no_op", field: null, oldValue: null, newValue: null }
    state = createRevisionNode(state, action)
    state.pendingQuestion = {
      field: "coating",
      questionText: "코팅 선택",
      options: [],
      turnAsked: 1,
      context: null,
    }

    const decision = mockDecision({
      actionInterpretation: { type: "go_back", rationale: "undo", confidence: 0.9 },
    })

    const next = applyStateTransition(state, decision)
    expect(next.pendingQuestion).toBeNull()
  })
})

// ── Scenario 6: Validator catches hallucination ─────────────

describe("Scenario 6: Validator catches company info leakage", () => {
  it("warns when recommendation answer contains company info", () => {
    const surface = {
      answer: "YG-1은 1981년 설립된 글로벌 절삭공구 기업입니다. 이 엔드밀을 추천합니다.",
      displayedOptions: [
        { label: "추천 이유", field: "_action", value: "explain" },
      ],
      chips: ["추천 이유"],
    }

    const decision = mockDecision({
      answerIntent: {
        topic: "recommendation",
        needsGroundedFact: false,
        shouldUseCurrentResultContext: true,
        shouldResumePendingQuestion: false,
      },
    })

    const result = validateSurfaceV2(surface, decision, true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some((w) => w.includes("Company info leakage"))).toBe(true)
    expect(result.valid).toBe(false)
  })

  it("does not warn for clean recommendation answers", () => {
    const surface = {
      answer: "ALU-CUT 시리즈 A001 엔드밀을 추천합니다. DLC 코팅으로 알루미늄 가공에 최적입니다.",
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
    expect(result.warnings.length).toBe(0)
    expect(result.valid).toBe(true)
  })
})
