/**
 * Session Manager — Contract Tests
 *
 * Validates:
 *   - Session state construction
 *   - Undo one step back
 *   - Undo to before specific filter
 *   - Stage history integrity
 *   - Prevent re-asking known values (via validation gate)
 */

import { describe, it, expect } from "vitest"
import {
  buildSessionState,
  carryForwardState,
  createInitialStage,
  createFilterStage,
  restoreOnePreviousStep,
  restoreToBeforeFilter,
} from "../session-manager"
import type { AppliedFilter, NarrowingStage, ExplorationSessionState } from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

// ── Helpers ──────────────────────────────────────────────────

const baseInput: RecommendationInput = {
  manufacturerScope: "yg1-only",
  locale: "ko",
  material: "알루미늄",
  operationType: "측면가공",
  diameterMm: 10,
}

function makeFilter(field: string, value: string, at: number): AppliedFilter {
  return { field, op: "eq", value, rawValue: value, appliedAt: at }
}

function applyFilterToInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  const copy = { ...input }
  if (filter.field === "fluteCount") copy.flutePreference = Number(filter.rawValue) || undefined
  if (filter.field === "coating") copy.coatingPreference = String(filter.rawValue)
  if (filter.field === "toolSubtype") copy.toolSubtype = String(filter.rawValue)
  return copy
}

function buildTestState(filters: AppliedFilter[]): ExplorationSessionState {
  let input = { ...baseInput }
  const stages: NarrowingStage[] = [createInitialStage(baseInput, 100)]

  for (const f of filters) {
    input = applyFilterToInput(input, f)
    stages.push(createFilterStage(f, input, filters.slice(0, filters.indexOf(f) + 1), 100 - (filters.indexOf(f) + 1) * 20))
  }

  return buildSessionState({
    candidateCount: 100 - filters.length * 20,
    appliedFilters: filters,
    narrowingHistory: filters.map(f => ({
      question: `${f.field}?`,
      answer: f.value,
      extractedFilters: [f],
      candidateCountBefore: 100,
      candidateCountAfter: 80,
    })),
    stageHistory: stages,
    resolutionStatus: "narrowing",
    resolvedInput: input,
    turnCount: filters.length,
    displayedCandidates: [],
    displayedChips: [],
  })
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

describe("Session State Construction", () => {
  it("builds valid session state with all required fields", () => {
    const state = buildSessionState({
      candidateCount: 50,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: baseInput,
      turnCount: 0,
      displayedCandidates: [],
      displayedChips: [],
    })

    expect(state.sessionId).toMatch(/^ses-/)
    expect(state.candidateCount).toBe(50)
    expect(state.displayedCandidates).toEqual([])
    expect(state.displayedChips).toEqual([])
  })

  it("carryForwardState preserves unmodified fields", () => {
    const original = buildTestState([makeFilter("fluteCount", "4날", 0)])
    const updated = carryForwardState(original, { candidateCount: 30 })

    expect(updated.sessionId).toBe(original.sessionId)
    expect(updated.candidateCount).toBe(30)
    expect(updated.appliedFilters).toEqual(original.appliedFilters)
    expect(updated.stageHistory).toEqual(original.stageHistory)
  })
})

describe("Undo: One Step Back", () => {
  it("removes last filter and restores previous input", () => {
    const f1 = makeFilter("toolSubtype", "Square", 0)
    const f2 = makeFilter("fluteCount", "4날", 1)
    const state = buildTestState([f1, f2])

    const result = restoreOnePreviousStep(state, baseInput, applyFilterToInput)

    expect(result.remainingFilters).toHaveLength(1)
    expect(result.remainingFilters[0].value).toBe("Square")
    expect(result.removedFilterDesc).toBe("4날")
  })

  it("restores to initial when only one filter exists", () => {
    const f1 = makeFilter("toolSubtype", "Square", 0)
    const state = buildTestState([f1])

    const result = restoreOnePreviousStep(state, baseInput, applyFilterToInput)

    expect(result.remainingFilters).toHaveLength(0)
    expect(result.removedFilterDesc).toBe("Square")
  })
})

describe("Undo: Back to Before Specific Filter", () => {
  it("restores to state before Square was applied", () => {
    const f1 = makeFilter("toolSubtype", "Square", 0)
    const f2 = makeFilter("fluteCount", "4날", 1)
    const f3 = makeFilter("coating", "AlTiN", 2)
    const state = buildTestState([f1, f2, f3])

    const result = restoreToBeforeFilter(state, "Square", "toolSubtype", baseInput, applyFilterToInput)

    expect(result.remainingFilters).toHaveLength(0)
    expect(result.removedFilterDesc).toBe("Square")
  })

  it("restores to state before fluteCount=4날", () => {
    const f1 = makeFilter("toolSubtype", "Square", 0)
    const f2 = makeFilter("fluteCount", "4날", 1)
    const f3 = makeFilter("coating", "AlTiN", 2)
    const state = buildTestState([f1, f2, f3])

    const result = restoreToBeforeFilter(state, "4날", "fluteCount", baseInput, applyFilterToInput)

    expect(result.remainingFilters).toHaveLength(1)
    expect(result.remainingFilters[0].value).toBe("Square")
  })
})
