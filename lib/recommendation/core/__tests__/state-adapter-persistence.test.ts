import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { convertFromV2State } from "../state-adapter"
import { createInitialSessionState } from "../turn-orchestrator"

describe("state adapter persistence", () => {
  it("preserves displayed recommendation truth while materializing new filters", () => {
    const prevLegacy = {
      sessionId: "session-1",
      candidateCount: 2,
      appliedFilters: [
        { field: "material", op: "eq", value: "Steel", rawValue: "Steel", appliedAt: 1 },
      ],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_exact",
      resolvedInput: {
        material: "Steel",
        manufacturerScope: "yg1-only",
        locale: "ko",
      },
      turnCount: 4,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      displayedProducts: [{ productCode: "A1" }],
      displayedSeriesGroups: [{ seriesKey: "X1" }],
      lastRecommendationArtifact: [{ productCode: "A1" }],
      uiNarrowingPath: [{ field: "material", value: "Steel" }],
    } as any

    const v2 = {
      ...createInitialSessionState(),
      constraints: {
        base: { material: "Aluminum" },
        refinements: {},
      },
      turnCount: 5,
    }

    const result = convertFromV2State(v2, prevLegacy)

    expect(result.appliedFilters.some((filter) => filter.field === "material" && filter.rawValue === "Aluminum")).toBe(true)
    expect(result.displayedProducts).toEqual(prevLegacy.displayedProducts)
    expect(result.displayedSeriesGroups).toEqual(prevLegacy.displayedSeriesGroups)
    expect(result.lastRecommendationArtifact).toEqual(prevLegacy.lastRecommendationArtifact)
    expect(result.uiNarrowingPath).toEqual(prevLegacy.uiNarrowingPath)
  })
})
