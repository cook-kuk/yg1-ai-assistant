/**
 * Phase F — explanation-builder accepts an optional RankingTrace.
 * Regression: behavior WITHOUT a trace is unchanged (narrative summary).
 * New:        behavior WITH a trace prepends a grounded rationale listing
 *             each contribution label and all matchedConstraints.
 */

import { describe, expect, it } from "vitest"
import { buildExplanation } from "../explanation-builder"
import type { RankingTrace } from "../ranking-trace"
import type {
  ScoredProduct,
  RecommendationInput,
  ScoreBreakdown,
} from "@/lib/recommendation/domain/types"
import type { CanonicalProduct } from "@/lib/types/canonical"

function makeProduct(): CanonicalProduct {
  return {
    id: "test-001",
    manufacturer: "YG-1",
    brand: "ALU-POWER HPC",
    sourcePriority: 1 as const,
    sourceType: "smart-catalog" as const,
    rawSourceFile: "yg1_4G_mill",
    rawSourceSheet: null,
    normalizedCode: "4GDA12050",
    displayCode: "4GDA-12050",
    seriesName: "ALU-POWER HPC",
    productName: null,
    toolType: "Solid",
    toolSubtype: "Square",
    diameterMm: 12,
    diameterInch: null,
    fluteCount: 3,
    coating: "H-Coating",
    toolMaterial: "Carbide",
    shankDiameterMm: 12,
    lengthOfCutMm: 36,
    overallLengthMm: 83,
    helixAngleDeg: null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    coolantHole: false,
    applicationShapes: ["Side_Milling"],
    materialTags: ["N"],
    country: null,
    description: null,
    featureText: null,
    seriesIconUrl: null,
    sourceConfidence: "high",
    dataCompletenessScore: 0.85,
    evidenceRefs: [],
    materialRatingScore: null,
  }
}

function makeBreakdown(): ScoreBreakdown {
  return {
    diameter: { score: 25, max: 25, detail: "exact" },
    flutes: { score: 10, max: 10, detail: "exact" },
    materialTag: { score: 20, max: 20, detail: "exact" },
    operation: { score: 10, max: 10, detail: "partial" },
    toolShape: { score: 5, max: 5, detail: "matched" },
    coating: { score: 5, max: 5, detail: "matched" },
    completeness: { score: 5, max: 5, detail: "" },
    evidence: { score: 5, max: 5, detail: "" },
    total: 85,
    maxTotal: 85,
    matchPct: 100,
  }
}

function makeScored(): ScoredProduct {
  return {
    product: makeProduct(),
    score: 85,
    scoreBreakdown: makeBreakdown(),
    matchedFields: ["diameter", "materialTag"],
    matchStatus: "exact",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  }
}

function makeInput(): RecommendationInput {
  return {
    material: "알루미늄",
    diameterMm: 12,
    flutePreference: 3,
    coatingPreference: undefined,
    operationType: undefined,
    manufacturerScope: "yg1-only",
    locale: "ko",
  } as RecommendationInput
}

describe("explanation-builder — RankingTrace integration (Phase F)", () => {
  it("without a trace, summaryText matches the existing narrative shape (regression)", () => {
    const out = buildExplanation(makeScored(), makeInput(), null)
    // Existing narrative contains matchPct and "일치".
    expect(out.summaryText).toMatch(/매칭률/)
    expect(out.summaryText).toMatch(/일치/)
    // No trace-specific tokens.
    expect(out.summaryText).not.toMatch(/기여도:/)
    expect(out.summaryText).not.toMatch(/최종점수/)
  })

  it("with a trace, every contribution label appears in summaryText", () => {
    const trace: RankingTrace = {
      productId: "4GDA12050",
      finalScore: 0.92,
      rank: 1,
      contributions: [
        { source: "filter_match", label: "직경 12mm 일치", weight: 0.45, value: "12mm" },
        { source: "workpiece_match", label: "알루미늄 적합", weight: 0.30 },
        { source: "stock_boost", label: "재고 충분", weight: 0.10 },
      ],
      matchedConstraints: [
        { field: "diameterMm", value: "12" },
        { field: "fluteCount", value: "3" },
      ],
    }

    const out = buildExplanation(makeScored(), makeInput(), null, trace)

    for (const c of trace.contributions) {
      expect(out.summaryText).toContain(c.label)
    }
    // Rationale header present.
    expect(out.summaryText).toMatch(/기여도:/)
    // Final score + rank emitted.
    expect(out.summaryText).toMatch(/최종점수 0\.92/)
    expect(out.summaryText).toMatch(/순위 1/)
    // Narrative path preserved as suffix.
    expect(out.summaryText).toMatch(/매칭률/)
  })

  it("matchedConstraints render in field=value form", () => {
    const trace: RankingTrace = {
      productId: "4GDA12050",
      finalScore: 0.80,
      rank: 2,
      contributions: [
        { source: "filter_match", label: "coating match", weight: 0.2 },
      ],
      matchedConstraints: [
        { field: "diameterMm", value: "12" },
        { field: "coating", value: "H-Coating" },
      ],
    }
    const out = buildExplanation(makeScored(), makeInput(), null, trace)
    expect(out.summaryText).toMatch(/일치 조건:/)
    expect(out.summaryText).toContain("diameterMm=12")
    expect(out.summaryText).toContain("coating=H-Coating")
  })

  it("contributions are sorted by |weight| descending", () => {
    const trace: RankingTrace = {
      productId: "4GDA12050",
      finalScore: 0.5,
      rank: 3,
      contributions: [
        { source: "other",        label: "LOW_WEIGHT_LABEL",  weight: 0.05 },
        { source: "filter_match", label: "HIGH_WEIGHT_LABEL", weight: 0.80 },
        { source: "feedback",     label: "MID_WEIGHT_LABEL",  weight: -0.40 },
      ],
      matchedConstraints: [],
    }
    const out = buildExplanation(makeScored(), makeInput(), null, trace)
    const text = out.summaryText
    const iHigh = text.indexOf("HIGH_WEIGHT_LABEL")
    const iMid = text.indexOf("MID_WEIGHT_LABEL")
    const iLow = text.indexOf("LOW_WEIGHT_LABEL")
    expect(iHigh).toBeGreaterThanOrEqual(0)
    expect(iMid).toBeGreaterThan(iHigh)
    expect(iLow).toBeGreaterThan(iMid)
  })
})
