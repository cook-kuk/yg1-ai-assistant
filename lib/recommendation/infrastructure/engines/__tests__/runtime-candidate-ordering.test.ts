import { describe, expect, it } from "vitest"

import { applyRuntimeCandidateOrdering } from "../runtime-candidate-ordering"
import type { ScoredProduct } from "@/lib/recommendation/domain/types"

function makeCandidate(displayCode: string, lengthOfCutMm: number | null): ScoredProduct {
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
      overallLengthMm: 60,
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

describe("applyRuntimeCandidateOrdering", () => {
  it("replaces retrieval order with phase-g compiled rows", () => {
    const out = applyRuntimeCandidateOrdering(
      [
        makeCandidate("A", 5),
        makeCandidate("B", 30),
        makeCandidate("C", 12),
      ],
      null,
      {
        rowCount: 3,
        products: [
          { normalizedCode: "C", displayCode: "C" } as any,
          { normalizedCode: "A", displayCode: "A" } as any,
          { normalizedCode: "B", displayCode: "B" } as any,
        ],
      },
    )

    expect(out.phaseGReplaced).toBe(true)
    expect(out.candidates.map(candidate => candidate.product.displayCode)).toEqual(["C", "A", "B"])
  })

  it("applies query sort after phase-g replacement", () => {
    const out = applyRuntimeCandidateOrdering(
      [
        makeCandidate("A", 5),
        makeCandidate("B", 30),
        makeCandidate("C", 12),
      ],
      { field: "lengthOfCutMm", direction: "desc" },
      null,
    )

    expect(out.sortApplied).toBe(true)
    expect(out.candidates.map(candidate => candidate.product.displayCode)).toEqual(["B", "C", "A"])
  })
})
