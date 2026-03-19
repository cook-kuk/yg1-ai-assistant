import { describe, expect, it } from "vitest"

import {
  buildPersistedSessionState,
  getDisplayedProductsFromState,
  getFullDisplayedProductsFromState,
  hasActiveRecommendationSession,
  getRecommendationSourceSnapshot,
} from "../session-kernel"
import type { CandidateSnapshot, ExplorationSessionState } from "@/lib/types/exploration"

function makeCandidate(rank: number, code: string, seriesName: string): CandidateSnapshot {
  return {
    rank,
    productCode: code,
    displayCode: code,
    displayLabel: code,
    brand: "YG-1",
    seriesName,
    seriesIconUrl: null,
    diameterMm: 4,
    fluteCount: 3,
    coating: "Bright Finish",
    toolMaterial: "Carbide",
    shankDiameterMm: 4,
    lengthOfCutMm: 10,
    overallLengthMm: 60,
    helixAngleDeg: 45,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 95 - rank,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "unknown",
    totalStock: null,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: true,
    bestCondition: null,
  }
}

function buildPrevState(): ExplorationSessionState {
  const artifact = [
    makeCandidate(1, "E5D7004010", "E5D70"),
    makeCandidate(2, "E5D7004020", "E5D70"),
    makeCandidate(3, "EI880040", "EI880"),
  ]

  return {
    sessionId: "ses-kernel",
    candidateCount: artifact.length,
    appliedFilters: [
      { field: "coating", op: "includes", value: "Bright Finish", rawValue: "Bright Finish", appliedAt: 0 },
    ],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "resolved_exact",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "Aluminum",
      operationType: "Side Milling",
      diameterMm: 4,
      toolType: "End Mill",
    },
    turnCount: 2,
    displayedProducts: artifact.slice(0, 2),
    displayedCandidates: artifact.slice(0, 2),
    fullDisplayedProducts: artifact,
    fullDisplayedCandidates: artifact,
    displayedSetFilter: null,
    displayedChips: ["전체 보기", "추천해주세요"],
    displayedOptions: [],
    displayedSeriesGroups: [
      { seriesKey: "E5D70", seriesName: "E5D70", seriesIconUrl: null, description: null, candidateCount: 2, topScore: 95, members: artifact.slice(0, 2) },
      { seriesKey: "EI880", seriesName: "EI880", seriesIconUrl: null, description: null, candidateCount: 1, topScore: 92, members: artifact.slice(2) },
    ],
    uiNarrowingPath: [
      { kind: "filter", label: "coating: Bright Finish", field: "coating", value: "Bright Finish", candidateCount: artifact.length },
      { kind: "series_group", label: "E5D70", value: "E5D70", candidateCount: 2 },
    ],
    currentMode: "group_focus",
    restoreTarget: "E5D70",
    lastAction: "restore_previous_group",
    underlyingAction: "show_recommendation",
    lastComparisonArtifact: null,
    lastRecommendationArtifact: artifact,
    candidateCounts: {
      dbMatchCount: artifact.length,
      filteredCount: artifact.length,
      rankedCount: artifact.length,
      displayedCount: 2,
      hiddenBySeriesCapCount: 0,
    },
    lastClarification: null,
    displayedGroups: [],
    activeGroupKey: "E5D70",
  }
}

describe("session-kernel", () => {
  it("repairs empty recommendation resets from persisted artifacts", () => {
    const prevState = buildPrevState()

    const repaired = buildPersistedSessionState({
      prevState,
      candidateCount: 0,
      appliedFilters: prevState.appliedFilters,
      narrowingHistory: prevState.narrowingHistory,
      stageHistory: prevState.stageHistory,
      resolutionStatus: "resolved_none",
      resolvedInput: prevState.resolvedInput,
      turnCount: prevState.turnCount + 1,
      displayedProducts: [],
      fullDisplayedProducts: prevState.fullDisplayedProducts,
      displayedChips: ["추천해주세요"],
      displayedOptions: [],
      lastAction: "show_recommendation",
      currentMode: "recommendation",
      preserveUnderlyingRecommendation: true,
    })

    expect(repaired.candidateCount).toBeGreaterThan(0)
    expect(repaired.resolutionStatus).not.toBe("resolved_none")
    expect(repaired.displayedProducts?.length ?? 0).toBeGreaterThan(0)
    expect(repaired.candidateCount).toBe(prevState.fullDisplayedProducts?.length ?? 0)
    expect(repaired.lastRecommendationArtifact?.length ?? 0).toBe(prevState.lastRecommendationArtifact?.length ?? 0)
  })

  it("restores active series view from full artifact when displayed list is lost", () => {
    const prevState = buildPrevState()

    const repaired = buildPersistedSessionState({
      prevState,
      candidateCount: 0,
      appliedFilters: prevState.appliedFilters,
      narrowingHistory: prevState.narrowingHistory,
      stageHistory: prevState.stageHistory,
      resolutionStatus: "resolved_none",
      resolvedInput: prevState.resolvedInput,
      turnCount: prevState.turnCount + 1,
      displayedProducts: [],
      fullDisplayedProducts: prevState.fullDisplayedProducts,
      displayedChips: ["전체 보기", "추천해주세요"],
      displayedOptions: [],
      lastAction: "restore_previous_group",
      currentMode: "group_focus",
      activeGroupKey: "E5D70",
      restoreTarget: "E5D70",
      preserveUnderlyingRecommendation: true,
    })

    expect(repaired.activeGroupKey).toBe("E5D70")
    expect(repaired.displayedProducts?.every(candidate => candidate.seriesName === "E5D70")).toBe(true)
    expect(getRecommendationSourceSnapshot(repaired).every(candidate => candidate.seriesName === "E5D70")).toBe(true)
  })

  it("preserves displayed options and comparison artifact across general chat overlays", () => {
    const prevState = {
      ...buildPrevState(),
      displayedOptions: [
        { index: 1, label: "E5D70 (2)", field: "seriesName", value: "E5D70", count: 2 },
        { index: 2, label: "EI880 (1)", field: "seriesName", value: "EI880", count: 1 },
      ],
      lastComparisonArtifact: {
        comparedProductCodes: ["E5D7004010", "EI880040"],
        comparedRanks: [1, 3],
        compareField: "coating",
        text: "comparison text",
        timestamp: Date.now(),
      },
    }

    const overlay = buildPersistedSessionState({
      prevState,
      candidateCount: prevState.candidateCount,
      appliedFilters: prevState.appliedFilters,
      narrowingHistory: prevState.narrowingHistory,
      stageHistory: prevState.stageHistory,
      resolutionStatus: prevState.resolutionStatus,
      resolvedInput: prevState.resolvedInput,
      turnCount: prevState.turnCount + 1,
      displayedProducts: getDisplayedProductsFromState(prevState),
      fullDisplayedProducts: getFullDisplayedProductsFromState(prevState),
      displayedChips: ["Recommend", "Full View"],
      displayedOptions: [],
      lastAction: "answer_general",
      currentMode: "general_chat",
      preserveUnderlyingRecommendation: true,
    })

    expect(overlay.displayedOptions?.length ?? 0).toBe(2)
    expect(overlay.lastComparisonArtifact?.comparedProductCodes).toEqual(["E5D7004010", "EI880040"])
    expect(hasActiveRecommendationSession(overlay)).toBe(true)
  })

  it("builds candidate count breakdown from restored artifacts", () => {
    const prevState = buildPrevState()
    const restored = buildPersistedSessionState({
      prevState,
      candidateCount: 0,
      appliedFilters: prevState.appliedFilters,
      narrowingHistory: prevState.narrowingHistory,
      stageHistory: prevState.stageHistory,
      resolutionStatus: "resolved_none",
      resolvedInput: prevState.resolvedInput,
      turnCount: prevState.turnCount + 1,
      displayedProducts: [],
      fullDisplayedProducts: prevState.fullDisplayedProducts,
      displayedChips: ["Recommend"],
      displayedOptions: [],
      lastAction: "show_recommendation",
      currentMode: "recommendation",
      preserveUnderlyingRecommendation: true,
    })

    expect(restored.candidateCounts?.dbMatchCount).toBeGreaterThan(0)
    expect(restored.candidateCounts?.filteredCount).toBeGreaterThan(0)
    expect(restored.candidateCounts?.displayedCount).toBeGreaterThan(0)
  })
})
