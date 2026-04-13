import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", () => ({
  resolveMultiStageQuery: vi.fn(async () => ({
    source: "none",
    filters: [],
    sort: null,
    routeHint: "none",
    intent: "refine_recommendation",
    clearOtherFilters: false,
    removeFields: [],
    followUpFilter: null,
    confidence: 0,
    unresolvedTokens: [],
    reasoning: "noop",
    clarification: null,
  })),
}))

vi.mock("@/lib/recommendation/infrastructure/engines/serve-engine-option-first", () => ({
  buildComparisonOptionState: () => null,
  buildRefinementOptionState: () => null,
}))

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

function makeCandidate(productCode: string, coating: string) {
  return {
    rank: 1,
    productCode,
    displayCode: productCode,
    displayLabel: productCode,
    brand: "YG-1",
    seriesName: "TEST",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 4,
    coating,
    toolSubtype: "Square",
    toolMaterial: "Carbide",
    shankDiameterMm: null,
    shankType: null,
    lengthOfCutMm: null,
    overallLengthMm: null,
    helixAngleDeg: null,
    coolantHole: null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    pointAngleDeg: null,
    threadPitchMm: null,
    description: null,
    featureText: null,
    materialTags: ["P"],
    score: 88,
    scoreBreakdown: null,
    matchStatus: "approximate",
    stockStatus: "unknown",
    totalStock: null,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
  }
}

describe("handleServeExploration alternative exploration questions", () => {
  it("asks for an alternative instead of applying a negation filter when the excluded value is absent", async () => {
    const prevState = buildSessionState({
      candidateCount: 4,
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
      displayedCandidates: [
        makeCandidate("A-1", "TiAlN"),
        makeCandidate("A-2", "TiAlN"),
        makeCandidate("B-1", "T-Coating"),
        makeCandidate("C-1", "H-Coating"),
      ] as any,
      displayedChips: [],
      displayedOptions: [],
      currentMode: "recommendation",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "Gold-Coating 말고 코팅에 뭐가 있어?" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.text).toContain("Gold-Coating")
    expect(body.text).toContain("보이지 않습니다")
    expect(body.chips).toEqual(expect.arrayContaining(["TiAlN (2개)", "T-Coating (1개)", "H-Coating (1개)", "직접 입력"]))
    expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
    expect(body.session?.engineState?.appliedFilters).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ field: "coating", op: "neq" })]),
    )
    expect(body.session?.engineState?.pendingClarification?.chipResolution?.["TiAlN (2개)"]).toEqual({
      field: "coating",
      value: "TiAlN",
    })
  })

  it("handles colloquial recommendation phrasing with a misspelled excluded coating", async () => {
    const prevState = buildSessionState({
      candidateCount: 4,
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
      displayedCandidates: [
        makeCandidate("A-1", "TiAlN"),
        makeCandidate("A-2", "TiAlN"),
        makeCandidate("B-1", "T-Coating"),
        makeCandidate("C-1", "H-Coating"),
      ] as any,
      displayedChips: [],
      displayedOptions: [],
      currentMode: "recommendation",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "그리고 Y-coatiing 말고 추천할거 있어요?" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.text).toContain("Y-coatiing")
    expect(body.text).toContain("보이지 않습니다")
    expect(body.chips).toEqual(expect.arrayContaining(["TiAlN (2개)", "T-Coating (1개)", "H-Coating (1개)", "직접 입력"]))
    expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
    expect(body.session?.engineState?.appliedFilters).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ field: "coating", op: "neq" })]),
    )
  })
})
