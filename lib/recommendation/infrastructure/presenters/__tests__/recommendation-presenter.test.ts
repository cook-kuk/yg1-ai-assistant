import { describe, expect, it } from "vitest"

import { buildRecommendationResponseDto } from "../recommendation-presenter"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeCandidate(rank: number, displayCode: string) {
  return {
    rank,
    productCode: displayCode,
    displayCode,
    displayLabel: null,
    brand: "YG-1",
    seriesName: "TEST",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 4,
    coating: "TiAlN",
    toolSubtype: "Square",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    lengthOfCutMm: 20,
    overallLengthMm: 75,
    helixAngleDeg: 35,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 50,
    scoreBreakdown: null,
    matchStatus: "approximate" as const,
    stockStatus: "instock",
    totalStock: 10,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
  }
}

describe("buildRecommendationResponseDto", () => {
  it("preserves lastRecommendationArtifact candidates for non-recommendation replies", () => {
    const preserved = [makeCandidate(1, "KEEP-001")]
    const questionSnapshot = [makeCandidate(1, "QUESTION-001")]
    const sessionState = {
      sessionId: "s1",
      candidateCount: 1,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: questionSnapshot,
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: preserved,
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "질문 응답",
      purpose: "question",
      isComplete: false,
      sessionState,
      candidateSnapshot: questionSnapshot,
    })

    expect(dto.candidates?.[0]?.displayCode).toBe("KEEP-001")
  })
})
