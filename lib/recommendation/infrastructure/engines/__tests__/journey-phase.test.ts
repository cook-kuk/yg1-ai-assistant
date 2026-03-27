import { describe, expect, it } from "vitest"
import { detectJourneyPhase, isPostResultPhase } from "@/lib/recommendation/domain/context/journey-phase-detector"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeMinimalState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 0,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: {
      toolType: null,
      toolSubtype: null,
      material: null,
      materialTag: null,
      diameter: null,
      fluteCount: null,
      coating: null,
      cuttingType: null,
      lengthOfCut: null,
      overallLength: null,
      shankDiameter: null,
      helixAngle: null,
      toolMaterial: null,
    } as any,
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  }
}

describe("detectJourneyPhase", () => {
  it('returns "intake" for null session', () => {
    expect(detectJourneyPhase(null)).toBe("intake")
  })

  it('returns "intake" for empty session with no field or results', () => {
    const state = makeMinimalState()
    expect(detectJourneyPhase(state)).toBe("intake")
  })

  it('returns "narrowing" when lastAskedField exists and mode is question', () => {
    const state = makeMinimalState({
      lastAskedField: "coating",
      currentMode: "question",
    })
    expect(detectJourneyPhase(state)).toBe("narrowing")
  })

  it('returns "results_displayed" when resolutionStatus starts with "resolved"', () => {
    const state = makeMinimalState({
      resolutionStatus: "resolved_exact",
      currentMode: "recommendation",
      displayedCandidates: [{ rank: 1, productCode: "TEST", displayCode: "TEST" } as any],
    })
    expect(detectJourneyPhase(state)).toBe("results_displayed")
  })

  it('returns "results_displayed" when resolutionStatus is "resolved_approximate"', () => {
    const state = makeMinimalState({
      resolutionStatus: "resolved_approximate",
    })
    expect(detectJourneyPhase(state)).toBe("results_displayed")
  })

  it('returns "results_displayed" when displayedCandidates exist in recommendation mode', () => {
    const state = makeMinimalState({
      resolutionStatus: "broad",
      currentMode: "recommendation",
      displayedCandidates: [{ rank: 1, productCode: "TEST", displayCode: "TEST" } as any],
    })
    expect(detectJourneyPhase(state)).toBe("results_displayed")
  })

  it('returns "results_displayed" even when lastAskedField still has a value', () => {
    const state = makeMinimalState({
      resolutionStatus: "resolved_exact",
      lastAskedField: "coating",
      currentMode: "recommendation",
      displayedCandidates: [{ rank: 1, productCode: "TEST", displayCode: "TEST" } as any],
    })
    expect(detectJourneyPhase(state)).toBe("results_displayed")
  })

  it('returns "narrowing" not "results_displayed" when question mode with pending field and no results', () => {
    const state = makeMinimalState({
      resolutionStatus: "narrowing",
      lastAskedField: "fluteCount",
      currentMode: "question",
      displayedCandidates: [],
    })
    expect(detectJourneyPhase(state)).toBe("narrowing")
  })
})

describe("isPostResultPhase", () => {
  it("returns true for results_displayed", () => {
    expect(isPostResultPhase("results_displayed")).toBe(true)
  })

  it("returns true for post_result_exploration", () => {
    expect(isPostResultPhase("post_result_exploration")).toBe(true)
  })

  it("returns true for comparison", () => {
    expect(isPostResultPhase("comparison")).toBe(true)
  })

  it("returns false for narrowing", () => {
    expect(isPostResultPhase("narrowing")).toBe(false)
  })

  it("returns false for intake", () => {
    expect(isPostResultPhase("intake")).toBe(false)
  })

  it("returns false for revision", () => {
    expect(isPostResultPhase("revision")).toBe(false)
  })
})
