import { describe, expect, it } from "vitest"

import { resolveProductReferences } from "../comparison-agent"
import type { CandidateSnapshot } from "@/lib/types/exploration"

const candidates: CandidateSnapshot[] = [
  {
    rank: 1,
    productCode: "GEE8304030",
    displayCode: "GEE8304030",
    displayLabel: "ALU-CUT 3 Flute 45 Helix",
    brand: "YG-1",
    seriesName: "E5E83",
    seriesIconUrl: null,
    diameterMm: 4,
    fluteCount: 3,
    coating: "Bright Finish",
    toolMaterial: "Carbide",
    shankDiameterMm: 6,
    lengthOfCutMm: 10,
    overallLengthMm: 80,
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
    productCode: "GEE8304026",
    displayCode: "GEE8304026",
    displayLabel: "ALU-CUT 3 Flute 45 Helix",
    brand: "YG-1",
    seriesName: "E5E83",
    seriesIconUrl: null,
    diameterMm: 4,
    fluteCount: 3,
    coating: "Bright Finish",
    toolMaterial: "Carbide",
    shankDiameterMm: 6,
    lengthOfCutMm: 10,
    overallLengthMm: 70,
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
]

describe("resolveProductReferences", () => {
  it("falls back to top 2 for comparison-style ambiguous requests by default", () => {
    const resolved = resolveProductReferences(["비교해줘"], candidates)
    expect(resolved.map(candidate => candidate.displayCode)).toEqual(["GEE8304030", "GEE8304026"])
  })

  it("does not fall back to products for concept explanations in strict mode", () => {
    const resolved = resolveProductReferences(["코팅 종류별 특징 먼저 설명해줘"], candidates, {
      fallbackToTop2: false,
    })
    expect(resolved).toEqual([])
  })

  it("still resolves explicit product references in strict mode", () => {
    const resolved = resolveProductReferences(["1번"], candidates, { fallbackToTop2: false })
    expect(resolved.map(candidate => candidate.displayCode)).toEqual(["GEE8304030"])
  })
})
