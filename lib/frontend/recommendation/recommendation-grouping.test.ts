import { describe, expect, it } from "vitest"

import type { RecommendationCandidateDto, RecommendationSeriesGroupSummaryDto } from "@/lib/contracts/recommendation"
import { groupRecommendationCandidatesBySeries } from "@/lib/frontend/recommendation/recommendation-grouping"

function makeCandidate(seriesName: string, score: number): RecommendationCandidateDto {
  return {
    rank: 1,
    productCode: `${seriesName}-${score}`,
    displayCode: `${seriesName}-${score}`,
    displayLabel: null,
    brand: "YG-1",
    seriesName,
    seriesIconUrl: null,
    diameterMm: null,
    fluteCount: null,
    coating: null,
    toolSubtype: null,
    toolMaterial: null,
    shankDiameterMm: null,
    lengthOfCutMm: null,
    overallLengthMm: null,
    helixAngleDeg: null,
    description: null,
    featureText: null,
    materialTags: [],
    score,
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

describe("groupRecommendationCandidatesBySeries", () => {
  it("applies summary order and material rating to UI groups", () => {
    const candidates = [
      makeCandidate("Alpha", 90),
      makeCandidate("Beta", 95),
      makeCandidate("Gamma", 92),
    ]
    const summaries: RecommendationSeriesGroupSummaryDto[] = [
      { seriesKey: "Beta", seriesName: "Beta", candidateCount: 1, materialRating: "EXCELLENT", materialRatingScore: 3 },
      { seriesKey: "Gamma", seriesName: "Gamma", candidateCount: 1, materialRating: "GOOD", materialRatingScore: 2 },
      { seriesKey: "Alpha", seriesName: "Alpha", candidateCount: 1, materialRating: "NULL", materialRatingScore: 1 },
    ]

    const groups = groupRecommendationCandidatesBySeries(candidates, summaries)

    expect(groups.map(group => group.seriesName)).toEqual(["Beta", "Gamma", "Alpha"])
    expect(groups.map(group => group.materialRating)).toEqual(["EXCELLENT", "GOOD", "NULL"])
    expect(groups.map(group => group.materialRatingScore)).toEqual([3, 2, 1])
  })
})
