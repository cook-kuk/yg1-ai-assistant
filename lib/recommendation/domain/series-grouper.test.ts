import { describe, expect, it } from "vitest"

import type { CandidateSnapshot } from "@/lib/recommendation/domain/types"
import { buildGroupSummaries, groupCandidatesBySeries } from "@/lib/recommendation/domain/series-grouper"

function makeCandidate(
  seriesName: string | null,
  score: number,
  overrides: Partial<CandidateSnapshot> = {}
): CandidateSnapshot {
  return {
    rank: 1,
    productCode: `${seriesName ?? "UNGROUPED"}-${score}`,
    displayCode: `${seriesName ?? "UNGROUPED"}-${score}`,
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
    ...overrides,
  }
}

describe("groupCandidatesBySeries", () => {
  it("sorts groups by material rating before top score", () => {
    const candidates = [
      makeCandidate("Alpha", 99),
      makeCandidate("Beta", 91),
      makeCandidate("Gamma", 97),
      makeCandidate("Delta", 100),
      makeCandidate(null, 110),
    ]

    const groups = groupCandidatesBySeries(
      candidates,
      new Map([
        ["BETA", { rating: "EXCELLENT", score: 3 }],
        ["GAMMA", { rating: "GOOD", score: 2 }],
        ["DELTA", { rating: "NULL", score: 1 }],
      ])
    )

    expect(groups.map(group => group.seriesName)).toEqual(["Beta", "Gamma", "Delta", "Alpha", "(기타)"])
    expect(groups.map(group => group.materialRating ?? null)).toEqual(["EXCELLENT", "GOOD", "NULL", null, null])
    expect(groups.map(group => group.materialRatingScore ?? null)).toEqual([3, 2, 1, null, null])
  })

  it("keeps material rating on summaries", () => {
    const groups = groupCandidatesBySeries(
      [makeCandidate("Beta", 91)],
      new Map([["BETA", { rating: "EXCELLENT", score: 3 }]])
    )

    expect(buildGroupSummaries(groups)).toEqual([
      {
        seriesKey: "Beta",
        seriesName: "Beta",
        candidateCount: 1,
        materialRating: "EXCELLENT",
        materialRatingScore: 3,
      },
    ])
  })
})
