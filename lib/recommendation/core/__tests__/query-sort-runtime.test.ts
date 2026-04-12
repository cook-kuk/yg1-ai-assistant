import { describe, expect, it } from "vitest"

import { sortScoredCandidatesByQuerySort } from "../query-sort-runtime"
import type { ScoredProduct } from "@/lib/recommendation/domain/types"

function makeCandidate(displayCode: string, lengthOfCutMm: number | null, overallLengthMm: number | null = null): ScoredProduct {
  return {
    product: {
      normalizedCode: displayCode,
      displayCode,
      brand: "YG-1",
      id: displayCode,
      manufacturer: "YG-1",
      sourcePriority: 1,
      sourceType: "smart-catalog",
      rawSourceFile: "test.json",
      rawSourceSheet: null,
      seriesName: "SERIES",
      productName: "TEST",
      toolType: "End Mill",
      diameterMm: 10,
      diameterInch: null,
      fluteCount: 4,
      coating: "TiAlN",
      toolSubtype: "Square",
      toolMaterial: "Carbide",
      shankDiameterMm: 10,
      shankType: "Plain",
      lengthOfCutMm,
      overallLengthMm,
      helixAngleDeg: 45,
      coolantHole: null,
      ballRadiusMm: null,
      taperAngleDeg: null,
      pointAngleDeg: null,
      threadPitchMm: null,
      description: null,
      featureText: null,
      applicationShapes: [],
      materialTags: ["P"],
      country: null,
      seriesIconUrl: null,
      materialRatingScore: null,
      workpieceMatched: false,
      sourceConfidence: "high",
      dataCompletenessScore: 1,
      evidenceRefs: [],
    } as any,
    score: 50,
    scoreBreakdown: null,
    matchedFields: [],
    matchStatus: "approximate",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  }
}

describe("sortScoredCandidatesByQuerySort", () => {
  it("sorts numeric fields descending and keeps nulls last", () => {
    const sorted = sortScoredCandidatesByQuerySort(
      [
        makeCandidate("A", 18),
        makeCandidate("B", null),
        makeCandidate("C", 42),
        makeCandidate("D", 30),
      ],
      { field: "lengthOfCutMm", direction: "desc" },
    )

    expect(sorted.map(candidate => candidate.product.displayCode)).toEqual(["C", "D", "A", "B"])
  })

  it("returns the original order when the sort field is unsupported", () => {
    const original = [
      makeCandidate("A", 18, 70),
      makeCandidate("B", 42, 65),
    ]

    const sorted = sortScoredCandidatesByQuerySort(
      original,
      { field: "brand", direction: "asc" },
    )

    expect(sorted.map(candidate => candidate.product.displayCode)).toEqual(["A", "B"])
  })
})
