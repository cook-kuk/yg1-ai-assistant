import { describe, expect, it } from "vitest"

import { routeProtectedRecommendationIntent } from "../orchestrator"
import type { ExplorationSessionState } from "@/lib/types/exploration"

const sessionState: ExplorationSessionState = {
  sessionId: "ses-protected-router",
  candidateCount: 3,
  appliedFilters: [],
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
  turnCount: 1,
  displayedProducts: [
    {
      rank: 1,
      productCode: "E5D7004010",
      displayCode: "E5D7004010",
      displayLabel: "E5D70",
      brand: "YG-1",
      seriesName: "E5D70",
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
      score: 95,
      scoreBreakdown: null,
      matchStatus: "exact",
      stockStatus: "unknown",
      totalStock: null,
      inventorySnapshotDate: null,
      inventoryLocations: [],
      hasEvidence: true,
      bestCondition: null,
    },
  ],
  displayedCandidates: [],
  fullDisplayedProducts: [
    {
      rank: 1,
      productCode: "E5D7004010",
      displayCode: "E5D7004010",
      displayLabel: "E5D70",
      brand: "YG-1",
      seriesName: "E5D70",
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
      score: 95,
      scoreBreakdown: null,
      matchStatus: "exact",
      stockStatus: "unknown",
      totalStock: null,
      inventorySnapshotDate: null,
      inventoryLocations: [],
      hasEvidence: true,
      bestCondition: null,
    },
    {
      rank: 2,
      productCode: "EI880040",
      displayCode: "EI880040",
      displayLabel: "EI880",
      brand: "YG-1",
      seriesName: "EI880",
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
      score: 93,
      scoreBreakdown: null,
      matchStatus: "exact",
      stockStatus: "unknown",
      totalStock: null,
      inventorySnapshotDate: null,
      inventoryLocations: [],
      hasEvidence: true,
      bestCondition: null,
    },
  ],
  fullDisplayedCandidates: undefined,
  displayedSetFilter: null,
  displayedChips: ["전체 보기", "추천해주세요"],
  displayedOptions: [],
  displayedSeriesGroups: [
    { seriesKey: "E5D70", seriesName: "E5D70", seriesIconUrl: null, description: null, candidateCount: 1, topScore: 95, members: [] },
    { seriesKey: "EI880", seriesName: "EI880", seriesIconUrl: null, description: null, candidateCount: 1, topScore: 93, members: [] },
  ],
  currentMode: "group_focus",
  lastAction: "restore_previous_group",
  underlyingAction: "show_recommendation",
  lastRecommendationArtifact: [],
}

describe("routeProtectedRecommendationIntent", () => {
  it("routes full-view command deterministically", () => {
    expect(routeProtectedRecommendationIntent("전체 보기", sessionState)).toEqual({
      type: "filter_displayed",
      field: "reset",
      operator: "reset",
      value: "__all__",
    })
  })

  it("routes series menu command deterministically", () => {
    expect(routeProtectedRecommendationIntent("다른 시리즈 보기", sessionState)).toEqual({
      type: "show_group_menu",
    })
  })

  it("routes series selection from persisted groups", () => {
    expect(routeProtectedRecommendationIntent("EI880", sessionState)).toEqual({
      type: "restore_previous_group",
      groupKey: "EI880",
    })
  })

  it("routes recommendation request without tool-use decomposition", () => {
    expect(routeProtectedRecommendationIntent("추천해주세요", sessionState)).toEqual({
      type: "show_recommendation",
    })
  })
})
