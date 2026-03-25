import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))
import {
  convertToV2State,
  convertFromV2State,
  mapLegacyPhase,
  mapV2PhaseToMode,
} from "../state-adapter"
import { createInitialSessionState } from "../turn-orchestrator"
import type { ExplorationSessionState, AppliedFilter, DisplayedOption } from "@/lib/types/exploration"
import type { RecommendationSessionState } from "../types"

// ── Helper: minimal legacy state ──────────────────────────

function makeLegacyState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 0,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: {} as ExplorationSessionState["resolvedInput"],
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  } as ExplorationSessionState
}

function makeFilter(field: string, value: string, rawValue?: string | number): AppliedFilter {
  return {
    field,
    op: "eq",
    value,
    rawValue: rawValue ?? value,
    appliedAt: 0,
  }
}

// ── Tests ──────────────────────────────────────────────────

describe("convertToV2State", () => {
  it("returns initial state when legacy is null", () => {
    const result = convertToV2State(null)
    const initial = createInitialSessionState()

    expect(result.journeyPhase).toBe(initial.journeyPhase)
    expect(result.constraints).toEqual(initial.constraints)
    expect(result.resultContext).toBeNull()
    expect(result.pendingQuestion).toBeNull()
    expect(result.turnCount).toBe(0)
  })

  it("maps appliedFilters to base constraints", () => {
    const legacy = makeLegacyState({
      appliedFilters: [
        makeFilter("material", "Steel", "Steel"),
        makeFilter("diameterMm", "10", 10),
        makeFilter("toolSubtype", "Square", "Square"),
      ],
    })

    const result = convertToV2State(legacy)

    expect(result.constraints.base.material).toBe("Steel")
    expect(result.constraints.base.diameter).toBe(10)
    expect(result.constraints.base.endType).toBe("Square")
  })

  it("maps appliedFilters to refinement constraints", () => {
    const legacy = makeLegacyState({
      appliedFilters: [
        makeFilter("fluteCount", "4", "4"),
        makeFilter("coating", "AlTiN", "AlTiN"),
      ],
    })

    const result = convertToV2State(legacy)

    expect(result.constraints.refinements.flute).toBe("4")
    expect(result.constraints.refinements.coating).toBe("AlTiN")
  })

  it("preserves numeric mv-backed refinements without stringifying them", () => {
    const legacy = makeLegacyState({
      appliedFilters: [makeFilter("ballRadiusMm", "1mm", 1)],
    })

    const result = convertToV2State(legacy)
    expect(result.constraints.refinements.ballRadiusMm).toBe(1)
  })

  it("maps workPieceName to materialDetail", () => {
    const legacy = makeLegacyState({
      appliedFilters: [makeFilter("workPieceName", "SUS304", "SUS304")],
    })

    const result = convertToV2State(legacy)
    expect(result.constraints.base.materialDetail).toBe("SUS304")
  })

  it("maps lastAskedField to pendingQuestion", () => {
    const options: DisplayedOption[] = [
      { index: 1, label: "4날", field: "fluteCount", value: "4", count: 10 },
      { index: 2, label: "2날", field: "fluteCount", value: "2", count: 5 },
    ]

    const legacy = makeLegacyState({
      lastAskedField: "fluteCount",
      displayedOptions: options,
      turnCount: 3,
    })

    const result = convertToV2State(legacy)

    expect(result.pendingQuestion).not.toBeNull()
    expect(result.pendingQuestion!.field).toBe("fluteCount")
    expect(result.pendingQuestion!.options).toEqual(options)
    expect(result.pendingQuestion!.turnAsked).toBe(3)
  })

  it("returns null pendingQuestion when lastAskedField is undefined", () => {
    const legacy = makeLegacyState({})
    const result = convertToV2State(legacy)
    expect(result.pendingQuestion).toBeNull()
  })

  it("maps suspendedFlow to sideThreadActive", () => {
    const legacy = makeLegacyState({
      suspendedFlow: {
        pendingField: "coating",
        pendingQuestion: "어떤 코팅을 원하시나요?",
        displayedOptionsSnapshot: [],
        displayedChipsSnapshot: [],
        reason: "side_question",
      },
    })

    const result = convertToV2State(legacy)
    expect(result.sideThreadActive).toBe(true)
  })

  it("preserves turnCount", () => {
    const legacy = makeLegacyState({ turnCount: 7 })
    const result = convertToV2State(legacy)
    expect(result.turnCount).toBe(7)
  })

  it("builds resultContext from displayedCandidates", () => {
    const legacy = makeLegacyState({
      candidateCount: 100,
      displayedCandidates: [
        {
          rank: 1,
          productCode: "P001",
          displayCode: "YG1-P001",
          displayLabel: "Test",
          brand: null,
          seriesName: "X-Series",
          seriesIconUrl: null,
          diameterMm: 10,
          fluteCount: 4,
          coating: "AlTiN",
          toolMaterial: null,
          shankDiameterMm: null,
          lengthOfCutMm: null,
          overallLengthMm: null,
          helixAngleDeg: null,
          description: null,
          featureText: null,
          materialTags: [],
          score: 0.95,
          scoreBreakdown: null,
          matchStatus: "exact" as const,
          stockStatus: "in_stock",
          totalStock: 50,
          inventorySnapshotDate: null,
          inventoryLocations: [],
          hasEvidence: false,
          bestCondition: null,
        },
      ],
    })

    const result = convertToV2State(legacy)

    expect(result.resultContext).not.toBeNull()
    expect(result.resultContext!.candidates).toHaveLength(1)
    expect(result.resultContext!.candidates[0].productCode).toBe("P001")
    expect(result.resultContext!.candidates[0].seriesName).toBe("X-Series")
    expect(result.resultContext!.totalConsidered).toBe(100)
  })
})

describe("mapLegacyPhase", () => {
  it("returns intake for empty state", () => {
    const legacy = makeLegacyState({})
    expect(mapLegacyPhase(legacy)).toBe("intake")
  })

  it("returns narrowing when lastAskedField is set", () => {
    const legacy = makeLegacyState({ lastAskedField: "coating" })
    expect(mapLegacyPhase(legacy)).toBe("narrowing")
  })

  it("returns results_displayed when resolutionStatus starts with resolved", () => {
    const legacy = makeLegacyState({ resolutionStatus: "resolved_exact" })
    expect(mapLegacyPhase(legacy)).toBe("results_displayed")
  })

  it("returns results_displayed when resolutionStatus is resolved_approximate", () => {
    const legacy = makeLegacyState({ resolutionStatus: "resolved_approximate" })
    expect(mapLegacyPhase(legacy)).toBe("results_displayed")
  })

  it("returns results_displayed when in recommendation mode with displayed products", () => {
    const legacy = makeLegacyState({
      currentMode: "recommendation",
      displayedCandidates: [
        { rank: 1, productCode: "P1", displayCode: "P1", score: 0.9 } as any,
      ],
    })
    expect(mapLegacyPhase(legacy)).toBe("results_displayed")
  })
})

describe("convertFromV2State", () => {
  it("builds appliedFilters from constraints", () => {
    const v2: RecommendationSessionState = {
      ...createInitialSessionState(),
      constraints: {
        base: { material: "Steel", diameter: 10 },
        refinements: { coating: "AlTiN" },
      },
    }

    const result = convertFromV2State(v2, null)

    expect(result.appliedFilters).toHaveLength(3)

    const materialFilter = result.appliedFilters.find((f) => f.field === "material")
    expect(materialFilter).toBeDefined()
    expect(materialFilter!.value).toBe("Steel")

    const diameterFilter = result.appliedFilters.find((f) => f.field === "diameterMm")
    expect(diameterFilter).toBeDefined()
    expect(diameterFilter!.rawValue).toBe(10)

    const coatingFilter = result.appliedFilters.find((f) => f.field === "coating")
    expect(coatingFilter).toBeDefined()
    expect(coatingFilter!.value).toBe("AlTiN")
  })

  it("rebuilds arbitrary registry-backed refinements from V2 constraints", () => {
    const v2: RecommendationSessionState = {
      ...createInitialSessionState(),
      constraints: {
        base: {},
        refinements: { ballRadiusMm: 1, brand: "TANK-POWER" },
      },
    }

    const result = convertFromV2State(v2, null)

    expect(result.appliedFilters.some((f) => f.field === "ballRadiusMm" && f.rawValue === 1)).toBe(true)
    expect(result.appliedFilters.some((f) => f.field === "brand" && f.rawValue === "TANK-POWER")).toBe(true)
  })

  it("maps pendingQuestion field to lastAskedField", () => {
    const v2: RecommendationSessionState = {
      ...createInitialSessionState(),
      pendingQuestion: {
        field: "fluteCount",
        questionText: "날수?",
        options: [],
        turnAsked: 2,
        context: null,
      },
    }

    const result = convertFromV2State(v2, null)
    expect(result.lastAskedField).toBe("fluteCount")
  })

  it("maps V2 phase to legacy currentMode", () => {
    const v2Results: RecommendationSessionState = {
      ...createInitialSessionState(),
      journeyPhase: "results_displayed",
    }
    expect(convertFromV2State(v2Results, null).currentMode).toBe("recommendation")

    const v2Narrowing: RecommendationSessionState = {
      ...createInitialSessionState(),
      journeyPhase: "narrowing",
    }
    expect(convertFromV2State(v2Narrowing, null).currentMode).toBe("narrowing")
  })

  it("preserves prevLegacy fields not covered by V2", () => {
    const prevLegacy = makeLegacyState({
      sessionId: "keep-me",
      narrowingHistory: [
        { question: "q", answer: "a", extractedFilters: [], candidateCountBefore: 10, candidateCountAfter: 5 },
      ],
    })

    const v2 = createInitialSessionState()
    const result = convertFromV2State(v2, prevLegacy)

    expect(result.sessionId).toBe("keep-me")
    expect(result.narrowingHistory).toHaveLength(1)
  })
})

describe("mapV2PhaseToMode", () => {
  it("maps all known phases correctly", () => {
    expect(mapV2PhaseToMode("intake")).toBe("question")
    expect(mapV2PhaseToMode("narrowing")).toBe("narrowing")
    expect(mapV2PhaseToMode("results_displayed")).toBe("recommendation")
    expect(mapV2PhaseToMode("post_result_exploration")).toBe("recommendation")
    expect(mapV2PhaseToMode("comparison")).toBe("comparison")
    expect(mapV2PhaseToMode("revision")).toBe("question")
  })
})

describe("round-trip conversion", () => {
  it("preserves key constraint information through legacy → V2 → legacy", () => {
    const original = makeLegacyState({
      appliedFilters: [
        makeFilter("material", "Steel", "Steel"),
        makeFilter("diameterMm", "10", 10),
        makeFilter("fluteCount", "4", "4"),
        makeFilter("coating", "AlTiN", "AlTiN"),
      ],
      lastAskedField: "toolSubtype",
      turnCount: 5,
    })

    const v2 = convertToV2State(original)
    const roundTripped = convertFromV2State(v2, original)

    // Key fields survive the round-trip
    expect(roundTripped.turnCount).toBe(5)
    expect(roundTripped.lastAskedField).toBe("toolSubtype")
    expect(roundTripped.appliedFilters).toHaveLength(4)

    // Verify each constraint field is present
    const fields = roundTripped.appliedFilters.map((f) => f.field)
    expect(fields).toContain("material")
    expect(fields).toContain("diameterMm")
    expect(fields).toContain("fluteCount")
    expect(fields).toContain("coating")
  })

  it("preserves journey phase semantics through round-trip", () => {
    const resolved = makeLegacyState({ resolutionStatus: "resolved_exact" })
    const v2 = convertToV2State(resolved)
    expect(v2.journeyPhase).toBe("results_displayed")

    const back = convertFromV2State(v2, resolved)
    expect(back.currentMode).toBe("recommendation")
  })
})
