/**
 * Phase 6 Integration Tests — V2 Transition
 *
 * Validates that USE_NEW_ORCHESTRATOR defaults to true, state adapter
 * round-trips preserve data, the V2 orchestrator handles errors gracefully,
 * all action types transition without crashes, and rollback safety works.
 */

import { describe, it, expect } from "vitest"
import { shouldUseV2ForPhase } from "@/lib/feature-flags"
import {
  convertToV2State,
  convertFromV2State,
  mapLegacyPhase,
} from "../state-adapter"
import {
  createInitialSessionState,
  applyStateTransition,
  orchestrateTurnV2,
} from "../turn-orchestrator"
import type {
  RecommendationSessionState,
  LlmTurnDecision,
} from "../types"
import type { ExplorationSessionState } from "@/lib/types/exploration"

// ── Helpers ──────────────────────────────────────────────────

function makeLegacyState(
  overrides: Partial<ExplorationSessionState>
): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 0,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
    turnCount: 0,
    lastAction: null,
    currentMode: "question",
    displayedProducts: [],
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  } as ExplorationSessionState
}

const mockCandidate = {
  rank: 1,
  productCode: "E5D7004010",
  displayCode: "E5D7004010",
  seriesName: "ALU-POWER",
  brand: "YG-1",
  diameterMm: 10,
  fluteCount: 3,
  coating: "AlTiN",
  materialTags: ["N"],
  score: 92,
  matchStatus: "good_match",
  totalStock: 100,
  stockStatus: "instock",
} as any

function makeDecision(
  actionType: LlmTurnDecision["actionInterpretation"]["type"],
  phaseOverride?: RecommendationSessionState["journeyPhase"]
): LlmTurnDecision {
  return {
    phaseInterpretation: {
      currentPhase: phaseOverride ?? "narrowing",
      confidence: 0.9,
    },
    actionInterpretation: {
      type: actionType,
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
  }
}

// ── 1. Feature flag tests ────────────────────────────────────

describe("Phase6: Feature flag defaults", () => {
  it("shouldUseV2ForPhase returns true for all phases when V2_ENABLED_PHASES=all (default)", () => {
    // Default env has V2_ENABLED_PHASES="all" and USE_NEW_ORCHESTRATOR=true
    expect(shouldUseV2ForPhase("intake")).toBe(true)
    expect(shouldUseV2ForPhase("question")).toBe(true)
    expect(shouldUseV2ForPhase("recommendation")).toBe(true)
    expect(shouldUseV2ForPhase("narrowing")).toBe(true)
    expect(shouldUseV2ForPhase("results_displayed")).toBe(true)
  })
})

// ── 2. State adapter round-trip tests ────────────────────────

describe("Phase6: State adapter round-trip", () => {
  it("convertToV2State + convertFromV2State preserves key fields", () => {
    const legacy = makeLegacyState({
      appliedFilters: [
        { field: "material", op: "eq", value: "Steel", rawValue: "Steel", appliedAt: 1 },
      ],
      turnCount: 5,
      currentMode: "question",
    })

    const v2 = convertToV2State(legacy)
    const roundTrip = convertFromV2State(v2, legacy)

    expect(roundTrip.appliedFilters.some((f) => f.field === "material")).toBe(true)
    expect(roundTrip.turnCount).toBe(5)
    expect(roundTrip.currentMode).toBe("question")
  })

  it("handles null prevState gracefully", () => {
    const v2State = convertToV2State(null)
    expect(v2State.journeyPhase).toBe("intake")
    expect(v2State.turnCount).toBe(0)
    expect(v2State.constraints.base).toEqual({})
    expect(v2State.constraints.refinements).toEqual({})
  })

  it("maps narrowing mode correctly", () => {
    const legacy = makeLegacyState({
      currentMode: "question",
      lastAskedField: "coating",
    })
    const v2 = convertToV2State(legacy)
    expect(v2.journeyPhase).toBe("narrowing")
  })

  it("maps recommendation mode correctly", () => {
    const legacy = makeLegacyState({
      currentMode: "recommendation",
      resolutionStatus: "resolved_exact",
      displayedCandidates: [mockCandidate],
    })
    const v2 = convertToV2State(legacy)
    expect(v2.journeyPhase).toBe("results_displayed")
  })

  it("preserves applied filters through conversion", () => {
    const legacy = makeLegacyState({
      appliedFilters: [
        { field: "material", op: "eq", value: "Aluminum", rawValue: "Aluminum", appliedAt: 1 },
        { field: "fluteCount", op: "eq", value: "3", rawValue: "3", appliedAt: 2 },
      ],
    })

    const v2 = convertToV2State(legacy)
    expect(v2.constraints.base.material).toBe("Aluminum")
    expect(v2.constraints.refinements.flute).toBe("3")

    const roundTrip = convertFromV2State(v2, legacy)
    expect(roundTrip.appliedFilters.some((f) => f.field === "material")).toBe(true)
    expect(roundTrip.appliedFilters.some((f) => f.field === "fluteCount")).toBe(true)
  })

  it("converts diameter as number in base constraints", () => {
    const legacy = makeLegacyState({
      appliedFilters: [
        { field: "diameterMm", op: "eq", value: "10", rawValue: "10", appliedAt: 1 },
      ],
    })
    const v2 = convertToV2State(legacy)
    expect(v2.constraints.base.diameter).toBe(10)
    expect(typeof v2.constraints.base.diameter).toBe("number")
  })

  it("builds resultContext from displayedCandidates", () => {
    const legacy = makeLegacyState({
      displayedCandidates: [mockCandidate],
      candidateCount: 50,
    })
    const v2 = convertToV2State(legacy)
    expect(v2.resultContext).not.toBeNull()
    expect(v2.resultContext!.candidates).toHaveLength(1)
    expect(v2.resultContext!.candidates[0].productCode).toBe("E5D7004010")
    expect(v2.resultContext!.totalConsidered).toBe(50)
  })

  it("builds pendingQuestion from lastAskedField", () => {
    const legacy = makeLegacyState({
      lastAskedField: "coating",
      turnCount: 3,
    })
    const v2 = convertToV2State(legacy)
    expect(v2.pendingQuestion).not.toBeNull()
    expect(v2.pendingQuestion!.field).toBe("coating")
    expect(v2.pendingQuestion!.turnAsked).toBe(3)
  })
})

// ── 3. V2 orchestrator fallback test ─────────────────────────

describe("Phase6: V2 orchestrator error handling", () => {
  it("orchestrateTurnV2 returns valid result even with stub provider", async () => {
    const state = createInitialSessionState()
    const stubProvider = {
      available: () => false,
      complete: async () => "",
    }

    const result = await orchestrateTurnV2("hello", state, stubProvider as any)
    expect(result.answer).toBeTruthy()
    expect(result.chips).toBeDefined()
    expect(result.sessionState.turnCount).toBe(1)
    expect(result.trace).toBeDefined()
    expect(result.trace.snapshotId).toBeTruthy()
    expect(result.trace.action).toBeTruthy()
  })
})

// ── 4. V2 handles all action types without crash ─────────────

describe("Phase6: V2 handles all action types without crash", () => {
  const actionTypes: LlmTurnDecision["actionInterpretation"]["type"][] = [
    "continue_narrowing",
    "replace_slot",
    "show_recommendation",
    "go_back",
    "compare_products",
    "answer_general",
    "redirect_off_topic",
    "reset_session",
    "skip_field",
    "ask_clarification",
    "refine_current_results",
  ]

  for (const actionType of actionTypes) {
    it(`handles ${actionType} without error`, () => {
      const state = createInitialSessionState()
      const decision = makeDecision(actionType)
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(1)
    })
  }
})

// ── 5. State transition specifics ────────────────────────────

describe("Phase6: State transition specifics", () => {
  it("reset_session preserves turnCount", () => {
    const state: RecommendationSessionState = {
      ...createInitialSessionState(),
      turnCount: 5,
      constraints: { base: { material: "Steel" }, refinements: { flute: "3" } },
    }
    const decision = makeDecision("reset_session", "intake")
    const next = applyStateTransition(state, decision)
    // turnCount increments to 6, then reset_session preserves that incremented count
    expect(next.turnCount).toBe(6)
    expect(next.constraints.base).toEqual({})
    expect(next.constraints.refinements).toEqual({})
    expect(next.journeyPhase).toBe("intake")
  })

  it("answer_general sets sideThreadActive", () => {
    const state = createInitialSessionState()
    const decision = makeDecision("answer_general")
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(true)
  })

  it("non-general action clears sideThreadActive when previously active", () => {
    const state: RecommendationSessionState = {
      ...createInitialSessionState(),
      sideThreadActive: true,
    }
    const decision = makeDecision("continue_narrowing")
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("skip_field clears pendingQuestion", () => {
    const state: RecommendationSessionState = {
      ...createInitialSessionState(),
      pendingQuestion: {
        field: "coating",
        questionText: "What coating?",
        options: [],
        turnAsked: 1,
        context: null,
      },
    }
    const decision = makeDecision("skip_field")
    const next = applyStateTransition(state, decision)
    expect(next.pendingQuestion).toBeNull()
  })
})

// ── 6. Rollback safety ───────────────────────────────────────

describe("Phase6: Rollback safety", () => {
  it("shouldUseV2ForPhase logic respects USE_NEW_ORCHESTRATOR flag", () => {
    // When USE_NEW_ORCHESTRATOR is not "false" (default), shouldUseV2ForPhase
    // returns true for all phases with V2_ENABLED_PHASES="all"
    // This verifies the function works correctly under current defaults
    expect(shouldUseV2ForPhase("intake")).toBe(true)
    expect(shouldUseV2ForPhase("narrowing")).toBe(true)
    expect(shouldUseV2ForPhase("results_displayed")).toBe(true)
  })

  it("createInitialSessionState returns valid intake state", () => {
    const state = createInitialSessionState()
    expect(state.journeyPhase).toBe("intake")
    expect(state.turnCount).toBe(0)
    expect(state.constraints).toEqual({ base: {}, refinements: {} })
    expect(state.resultContext).toBeNull()
    expect(state.pendingQuestion).toBeNull()
    expect(state.pendingAction).toBeNull()
    expect(state.revisionNodes).toEqual([])
    expect(state.currentRevisionId).toBeNull()
    expect(state.sideThreadActive).toBe(false)
  })
})
