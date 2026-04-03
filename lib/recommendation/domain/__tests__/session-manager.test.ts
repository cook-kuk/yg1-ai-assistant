import { describe, it, expect } from "vitest"
import {
  buildSessionState,
  carryForwardState,
  createInitialStage,
  createFilterStage,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
} from "../session-manager"
import type { AppliedFilter, NarrowingStage, NarrowingTurn, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { RecommendationInput } from "@/lib/types/canonical"

// ── Helpers ──

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { machiningCategory: "Milling", ...overrides } as RecommendationInput
}

function makeFilter(field: string, value: string, appliedAt: number): AppliedFilter {
  return { field, op: "eq", value, rawValue: value, appliedAt }
}

function makeTurn(question: string, answer: string, filters: AppliedFilter[], before: number, after: number): NarrowingTurn {
  return { question, answer, extractedFilters: filters, candidateCountBefore: before, candidateCountAfter: after }
}

function makeMinimalState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return buildSessionState({
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: makeInput(),
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: [],
    ...overrides,
  })
}

// ════════════════════════════════════════════════════════════════
// buildSessionState
// ════════════════════════════════════════════════════════════════

describe("buildSessionState", () => {
  it("generates a session ID when none provided", () => {
    const state = makeMinimalState()
    expect(state.sessionId).toMatch(/^ses-\d+$/)
  })

  it("preserves prevSessionId when provided", () => {
    const state = makeMinimalState({ sessionId: "ses-custom-123" } as any)
    // buildSessionState uses prevSessionId param
    const state2 = buildSessionState({
      prevSessionId: "ses-custom-123",
      candidateCount: 50,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: makeInput(),
      turnCount: 0,
      displayedCandidates: [],
      displayedChips: [],
    })
    expect(state2.sessionId).toBe("ses-custom-123")
  })

  it("defaults optional fields to sensible values", () => {
    const state = makeMinimalState()
    expect(state.uiNarrowingPath).toEqual([])
    expect(state.displayedOptions).toEqual([])
    expect(state.restoreTarget).toBeNull()
    expect(state.activeGroupKey).toBeNull()
    expect(state.lastComparisonArtifact).toBeNull()
    expect(state.lastRecommendationArtifact).toBeNull()
    expect(state.lastClarification).toBeNull()
    expect(state.currentTask).toBeNull()
    expect(state.taskHistory).toEqual([])
    expect(state.pendingAction).toBeNull()
    expect(state.suspendedFlow).toBeNull()
  })

  it("uses displayedCandidates as fallback for displayedProducts", () => {
    const candidates = [{ productCode: "A001" }] as any[]
    const state = buildSessionState({
      candidateCount: 1,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_exact",
      resolvedInput: makeInput(),
      turnCount: 1,
      displayedCandidates: candidates,
      displayedChips: [],
    })
    expect(state.displayedProducts).toEqual(candidates)
    expect(state.fullDisplayedProducts).toEqual(candidates)
  })
})

// ════════════════════════════════════════════════════════════════
// createInitialStage / createFilterStage
// ════════════════════════════════════════════════════════════════

describe("createInitialStage", () => {
  it("creates stage with stepIndex -1 and no filter", () => {
    const input = makeInput()
    const stage = createInitialStage(input, 200)
    expect(stage.stepIndex).toBe(-1)
    expect(stage.stageName).toBe("initial_search")
    expect(stage.filterApplied).toBeNull()
    expect(stage.candidateCount).toBe(200)
    expect(stage.filtersSnapshot).toEqual([])
  })
})

describe("createFilterStage", () => {
  it("creates stage with filter details", () => {
    const filter = makeFilter("fluteCount", "4", 0)
    const input = makeInput()
    const stage = createFilterStage(filter, input, [filter], 50)
    expect(stage.stepIndex).toBe(0)
    expect(stage.stageName).toBe("fluteCount_4")
    expect(stage.filterApplied).toEqual(filter)
    expect(stage.candidateCount).toBe(50)
    expect(stage.filtersSnapshot).toEqual([filter])
  })
})

// ════════════════════════════════════════════════════════════════
// carryForwardState
// ════════════════════════════════════════════════════════════════

describe("carryForwardState", () => {
  it("preserves all fields when no overrides given", () => {
    const state = makeMinimalState()
    const next = carryForwardState(state, {})
    expect(next.candidateCount).toBe(state.candidateCount)
    expect(next.resolutionStatus).toBe(state.resolutionStatus)
    expect(next.sessionId).toBe(state.sessionId)
  })

  it("overrides specified fields", () => {
    const state = makeMinimalState()
    const next = carryForwardState(state, { candidateCount: 42, turnCount: 5 })
    expect(next.candidateCount).toBe(42)
    expect(next.turnCount).toBe(5)
  })

  it("rebuilds uiNarrowingPath when narrowingHistory is overridden", () => {
    const state = makeMinimalState()
    const filter = makeFilter("coating", "AlTiN", 0)
    const turn = makeTurn("What coating?", "AlTiN", [filter], 100, 30)
    const next = carryForwardState(state, { narrowingHistory: [turn] })
    expect(next.uiNarrowingPath!.length).toBe(1)
    expect(next.uiNarrowingPath![0].label).toBe("coating=AlTiN")
  })

  it("skips 'skip' ops when rebuilding uiNarrowingPath", () => {
    const state = makeMinimalState()
    const skipFilter: AppliedFilter = { field: "coating", op: "skip", value: "skip", rawValue: "skip", appliedAt: 0 }
    const turn = makeTurn("What coating?", "skip", [skipFilter], 100, 100)
    const next = carryForwardState(state, { narrowingHistory: [turn] })
    expect(next.uiNarrowingPath!.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// restoreOnePreviousStep
// ════════════════════════════════════════════════════════════════

describe("restoreOnePreviousStep", () => {
  const baseInput = makeInput()
  const identity = (input: RecommendationInput, _f: AppliedFilter) => input

  it("restores to previous stage when stageHistory has 2+ entries", () => {
    const filter1 = makeFilter("fluteCount", "4", 0)
    const stage0: NarrowingStage = {
      stepIndex: -1, stageName: "initial_search", filterApplied: null,
      candidateCount: 200, resolvedInputSnapshot: baseInput, filtersSnapshot: [],
    }
    const stage1: NarrowingStage = {
      stepIndex: 0, stageName: "fluteCount_4", filterApplied: filter1,
      candidateCount: 50, resolvedInputSnapshot: { ...baseInput, queryText: "4 flute" },
      filtersSnapshot: [filter1],
    }
    const turn = makeTurn("How many flutes?", "4", [filter1], 200, 50)
    const state = makeMinimalState({
      stageHistory: [stage0, stage1],
      narrowingHistory: [turn],
      appliedFilters: [filter1],
      turnCount: 1,
    } as any)

    const result = restoreOnePreviousStep(state, baseInput, identity)
    expect(result.remainingFilters).toEqual([])
    expect(result.remainingStages.length).toBe(1)
    expect(result.removedFilterDesc).toBe("4")
  })

  it("falls back to replay when only 1 stage exists", () => {
    const state = makeMinimalState({
      stageHistory: [{
        stepIndex: -1, stageName: "initial_search", filterApplied: null,
        candidateCount: 200, resolvedInputSnapshot: baseInput, filtersSnapshot: [],
      }],
      turnCount: 1,
    } as any)
    const result = restoreOnePreviousStep(state, baseInput, identity)
    expect(result.rebuiltInput).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
// restoreToBeforeFilter
// ════════════════════════════════════════════════════════════════

describe("restoreToBeforeFilter", () => {
  const baseInput = makeInput()
  const identity = (input: RecommendationInput, _f: AppliedFilter) => input

  it("restores to before a specific filter by value", () => {
    const f0 = makeFilter("fluteCount", "4", 0)
    const f1 = makeFilter("coating", "AlTiN", 1)
    const stage0: NarrowingStage = {
      stepIndex: -1, stageName: "initial_search", filterApplied: null,
      candidateCount: 200, resolvedInputSnapshot: baseInput, filtersSnapshot: [],
    }
    const stage1: NarrowingStage = {
      stepIndex: 0, stageName: "fluteCount_4", filterApplied: f0,
      candidateCount: 50, resolvedInputSnapshot: baseInput, filtersSnapshot: [f0],
    }
    const stage2: NarrowingStage = {
      stepIndex: 1, stageName: "coating_AlTiN", filterApplied: f1,
      candidateCount: 20, resolvedInputSnapshot: baseInput, filtersSnapshot: [f0, f1],
    }

    const state = makeMinimalState({
      stageHistory: [stage0, stage1, stage2],
      narrowingHistory: [
        makeTurn("Flutes?", "4", [f0], 200, 50),
        makeTurn("Coating?", "AlTiN", [f1], 50, 20),
      ],
      appliedFilters: [f0, f1],
      turnCount: 2,
    } as any)

    const result = restoreToBeforeFilter(state, "AlTiN", undefined, baseInput, identity)
    expect(result.remainingFilters).toEqual([f0])
    expect(result.removedFilterDesc).toBe("AlTiN")
  })

  it("restores to initial state when reverting the very first filter", () => {
    const f0 = makeFilter("fluteCount", "4", 0)
    const stage0: NarrowingStage = {
      stepIndex: -1, stageName: "initial_search", filterApplied: null,
      candidateCount: 200, resolvedInputSnapshot: baseInput, filtersSnapshot: [],
    }
    // filterApplied at index 0 matches
    const stageWithFilter: NarrowingStage = {
      stepIndex: 0, stageName: "fluteCount_4", filterApplied: f0,
      candidateCount: 50, resolvedInputSnapshot: baseInput, filtersSnapshot: [f0],
    }
    const state = makeMinimalState({
      stageHistory: [stageWithFilter],
      narrowingHistory: [makeTurn("Flutes?", "4", [f0], 200, 50)],
      appliedFilters: [f0],
      turnCount: 1,
    } as any)

    const result = restoreToBeforeFilter(state, "4", undefined, baseInput, identity)
    expect(result.remainingFilters).toEqual([])
    expect(result.remainingHistory).toEqual([])
  })

  it("falls back to replay when filter not found in stageHistory", () => {
    const state = makeMinimalState({
      stageHistory: [],
      appliedFilters: [],
      turnCount: 1,
    } as any)
    const result = restoreToBeforeFilter(state, "nonexistent", undefined, baseInput, identity)
    expect(result.rebuiltInput).toBeDefined()
  })
})
