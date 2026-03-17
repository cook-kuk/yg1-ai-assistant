/**
 * Slot Replacement — Integration Tests
 *
 * Validates:
 *   - Old filter removed, new filter added (no duplicates)
 *   - Stage history consistency after replacement
 *   - Other filters unaffected
 *   - Validation gate passes after replacement
 */

import { describe, it, expect } from "vitest"
import {
  buildSessionState,
  createInitialStage,
  createFilterStage,
} from "../session-manager"
import { validateSlotConsistency } from "../validation-gate"
import type { AppliedFilter, NarrowingStage, ExplorationSessionState } from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

const baseInput: RecommendationInput = {
  locale: "en",
  manufacturerScope: "yg1-only",
  material: "알루미늄",
  operationType: "측면가공",
  diameterMm: 10,
}

function makeFilter(field: string, value: string, rawValue: string | number, at: number): AppliedFilter {
  return { field, op: "eq", value, rawValue, appliedAt: at }
}

function buildTestState(filters: AppliedFilter[]): ExplorationSessionState {
  const stages: NarrowingStage[] = [createInitialStage(baseInput, 100)]
  let input = { ...baseInput }

  for (const f of filters) {
    const accFilters = filters.slice(0, filters.indexOf(f) + 1)
    stages.push(createFilterStage(f, input, accFilters, 100 - (filters.indexOf(f) + 1) * 20))
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
    displayedOptions: [],
  })
}

/**
 * Simulate the replace_slot logic from route.ts
 */
function simulateSlotReplacement(
  state: ExplorationSessionState,
  oldFilter: AppliedFilter,
  newFilter: AppliedFilter
): { newFilters: AppliedFilter[]; newStages: NarrowingStage[] } {
  const replacedFilter = { ...newFilter, appliedAt: oldFilter.appliedAt }

  // Replace old filter with new
  const newFilters = state.appliedFilters.map(f =>
    f.field === oldFilter.field && f.appliedAt === oldFilter.appliedAt ? replacedFilter : f
  )

  // Rebuild stages
  const existingStages = (state.stageHistory ?? []).filter(
    s => !s.filterApplied || s.filterApplied.field !== oldFilter.field
  )
  const replacementStage: NarrowingStage = {
    stepIndex: replacedFilter.appliedAt,
    stageName: `${replacedFilter.field}_${replacedFilter.value}`,
    filterApplied: replacedFilter,
    candidateCount: 80,
    resolvedInputSnapshot: { ...baseInput },
    filtersSnapshot: [...newFilters],
  }
  const newStages = [...existingStages, replacementStage].sort((a, b) => a.stepIndex - b.stepIndex)

  return { newFilters, newStages }
}

describe("Slot Replacement — Filter Management", () => {
  it("replaces diameter 2mm → 4mm with exactly one diameterMm filter", () => {
    const f1 = makeFilter("diameterMm", "2mm", 2, 0)
    const state = buildTestState([f1])

    const newFilter = makeFilter("diameterMm", "4mm", 4, 0)
    const { newFilters } = simulateSlotReplacement(state, f1, newFilter)

    expect(newFilters).toHaveLength(1)
    expect(newFilters[0].value).toBe("4mm")
    expect(newFilters[0].rawValue).toBe(4)

    // Validation gate should pass
    const issue = validateSlotConsistency(newFilters)
    expect(issue).toBeNull()
  })

  it("replaces fluteCount 4→2 without affecting other filters", () => {
    const f1 = makeFilter("toolSubtype", "Square", "Square", 0)
    const f2 = makeFilter("fluteCount", "4날", 4, 1)
    const state = buildTestState([f1, f2])

    const newFilter = makeFilter("fluteCount", "2날", 2, 1)
    const { newFilters } = simulateSlotReplacement(state, f2, newFilter)

    expect(newFilters).toHaveLength(2)
    expect(newFilters[0].value).toBe("Square")  // unchanged
    expect(newFilters[1].value).toBe("2날")      // replaced

    const issue = validateSlotConsistency(newFilters)
    expect(issue).toBeNull()
  })

  it("detects duplicate filters (validation gate)", () => {
    // Simulate a bug where replacement was appended instead
    const duplicateFilters = [
      makeFilter("diameterMm", "2mm", 2, 0),
      makeFilter("diameterMm", "4mm", 4, 1),
    ]

    const issue = validateSlotConsistency(duplicateFilters)
    expect(issue).not.toBeNull()
    expect(issue!.code).toBe("DUPLICATE_SLOT_FILTER")
  })
})

describe("Slot Replacement — Stage History", () => {
  it("rebuilds stage history correctly after replacement", () => {
    const f1 = makeFilter("toolSubtype", "Square", "Square", 0)
    const f2 = makeFilter("fluteCount", "4날", 4, 1)
    const state = buildTestState([f1, f2])

    const newFilter = makeFilter("fluteCount", "2날", 2, 1)
    const { newStages } = simulateSlotReplacement(state, f2, newFilter)

    // Should have: initial + Square + 2날 (not 4날)
    const filterStages = newStages.filter(s => s.filterApplied != null)
    expect(filterStages).toHaveLength(2)

    const fluteStage = filterStages.find(s => s.filterApplied!.field === "fluteCount")
    expect(fluteStage).toBeDefined()
    expect(fluteStage!.filterApplied!.value).toBe("2날")
    expect(fluteStage!.stageName).toBe("fluteCount_2날")
  })
})
