import { describe, expect, it } from "vitest"

import type { RecommendationCandidateDto, RecommendationSeriesGroupSummaryDto } from "@/lib/contracts/recommendation"
import {
  groupRecommendationCandidatesBySeries,
  sortCandidatesByPriority,
} from "@/lib/frontend/recommendation/recommendation-grouping"

function makeCandidate(
  seriesName: string,
  score: number,
  overrides: Partial<RecommendationCandidateDto> = {}
): RecommendationCandidateDto {
  return {
    rank: 1,
    productCode: overrides.productCode ?? `${seriesName}-${score}`,
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
    ...overrides,
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

  it("그룹 내 members 가 score 내림차순으로 정렬된다", () => {
    const candidates = [
      makeCandidate("Alpha", 70, { productCode: "A-70" }),
      makeCandidate("Alpha", 90, { productCode: "A-90" }),
      makeCandidate("Alpha", 80, { productCode: "A-80" }),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups[0].members.map(m => m.productCode)).toEqual(["A-90", "A-80", "A-70"])
  })

  it("score 동률 시 matchStatus(exact > approximate > none) 우선", () => {
    const candidates = [
      makeCandidate("Alpha", 90, { productCode: "A-approx", matchStatus: "approximate" }),
      makeCandidate("Alpha", 90, { productCode: "A-exact", matchStatus: "exact" }),
      makeCandidate("Alpha", 90, { productCode: "A-none", matchStatus: "none" }),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups[0].members.map(m => m.productCode)).toEqual(["A-exact", "A-approx", "A-none"])
  })

  it("score+matchStatus 동률 시 stockStatus(instock > limited > unknown > outofstock) 우선", () => {
    const candidates = [
      makeCandidate("Alpha", 90, { productCode: "A-out", stockStatus: "outofstock" }),
      makeCandidate("Alpha", 90, { productCode: "A-in", stockStatus: "instock" }),
      makeCandidate("Alpha", 90, { productCode: "A-lim", stockStatus: "limited" }),
      makeCandidate("Alpha", 90, { productCode: "A-unk", stockStatus: "unknown" }),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups[0].members.map(m => m.productCode)).toEqual(["A-in", "A-lim", "A-unk", "A-out"])
  })

  it("재고 상태까지 동률이면 totalStock 많은 순", () => {
    const candidates = [
      makeCandidate("Alpha", 90, { productCode: "A-50", stockStatus: "instock", totalStock: 50 }),
      makeCandidate("Alpha", 90, { productCode: "A-200", stockStatus: "instock", totalStock: 200 }),
      makeCandidate("Alpha", 90, { productCode: "A-100", stockStatus: "instock", totalStock: 100 }),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups[0].members.map(m => m.productCode)).toEqual(["A-200", "A-100", "A-50"])
  })

  it("최후 안정 정렬: 모든 게 동률이면 productCode 사전순", () => {
    const candidates = [
      makeCandidate("Alpha", 90, { productCode: "Z-1" }),
      makeCandidate("Alpha", 90, { productCode: "A-1" }),
      makeCandidate("Alpha", 90, { productCode: "M-1" }),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups[0].members.map(m => m.productCode)).toEqual(["A-1", "M-1", "Z-1"])
  })

  it("기존 시리즈 정렬(topScore 기준)은 그대로", () => {
    const candidates = [
      makeCandidate("Alpha", 70),
      makeCandidate("Beta", 95),
      makeCandidate("Alpha", 90),  // Alpha 그룹의 topScore = 90
      makeCandidate("Gamma", 60),
    ]
    const groups = groupRecommendationCandidatesBySeries(candidates)
    expect(groups.map(g => g.seriesName)).toEqual(["Beta", "Alpha", "Gamma"])
    // Alpha 그룹 내부 order: 90 → 70
    const alpha = groups.find(g => g.seriesName === "Alpha")!
    expect(alpha.members.map(m => m.score)).toEqual([90, 70])
  })
})

describe("sortCandidatesByPriority — 플랫 모드용 export", () => {
  it("score 내림차순 + 동률 tiebreaker 일관 적용", () => {
    const candidates = [
      makeCandidate("X", 80, { productCode: "X-1", matchStatus: "exact", stockStatus: "instock" }),
      makeCandidate("X", 90, { productCode: "X-2", matchStatus: "approximate", stockStatus: "outofstock" }),
      makeCandidate("X", 80, { productCode: "X-3", matchStatus: "exact", stockStatus: "instock", totalStock: 100 }),
    ]
    const sorted = sortCandidatesByPriority(candidates)
    // X-2 (score=90 우선) → X-3 (score=80 동률 + totalStock 100) → X-1 (score=80 동률 + totalStock null)
    expect(sorted.map(c => c.productCode)).toEqual(["X-2", "X-3", "X-1"])
  })

  it("입력 배열을 mutate 하지 않는다 (immutable)", () => {
    const candidates = [
      makeCandidate("X", 70),
      makeCandidate("X", 90),
    ]
    const original = [...candidates]
    sortCandidatesByPriority(candidates)
    expect(candidates).toEqual(original)
  })
})
