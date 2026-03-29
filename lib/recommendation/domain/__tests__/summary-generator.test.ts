import { describe, expect, it } from "vitest"

import { buildDeterministicSummary } from "@/lib/recommendation/domain/summary-generator"
import type { RecommendationResult } from "@/lib/recommendation/domain/types"

function makeRecommendationResult(overrides: Partial<RecommendationResult> = {}): RecommendationResult {
  return {
    status: "exact",
    query: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "P",
      operationType: "Milling",
      diameterMm: 10,
      toolSubtype: "Square",
      flutePreference: 3,
    },
    primaryProduct: {
      product: {
        normalizedCode: "E5E83",
        displayCode: "E5E83",
        seriesName: "ALU-CUT",
        brand: "YG-1",
        toolSubtype: "Square",
        diameterMm: 10,
        fluteCount: 3,
        coating: "Bright Finish",
        toolMaterial: "Carbide",
        materialTags: ["N"],
      },
      score: 95,
      scoreBreakdown: null,
      matchedFields: ["toolSubtype", "fluteCount", "diameterMm"],
      matchStatus: "exact",
      inventory: [],
      leadTimes: [],
      evidence: [],
      stockStatus: "unknown",
      totalStock: null,
      minLeadTimeDays: null,
    } as any,
    alternatives: [],
    warnings: [],
    rationale: [],
    sourceSummary: [],
    deterministicSummary: "",
    llmSummary: null,
    totalCandidatesConsidered: 156,
    ...overrides,
  } as RecommendationResult
}

describe("buildDeterministicSummary", () => {
  it("uses a friendly conversational tone for exact matches", () => {
    const summary = buildDeterministicSummary(makeRecommendationResult())

    expect(summary).toContain("E5E83")
    expect(summary).toContain("먼저 보시면 됩니다")
    expect(summary).not.toContain("정확 매칭")
    expect(summary).not.toContain("브랜드명:")
    expect(summary).not.toContain("|")
  })

  it("keeps no-result summaries concise and polite", () => {
    const summary = buildDeterministicSummary(makeRecommendationResult({
      status: "none",
      primaryProduct: null,
      alternatives: [],
      totalCandidatesConsidered: 0,
    }))

    expect(summary).toContain("맞는 제품을 찾지 못했습니다")
    expect(summary).toContain("다시 보시면 좋겠습니다")
  })
})
