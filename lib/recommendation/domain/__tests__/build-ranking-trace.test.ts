/**
 * Phase F.2 — Adapter tests: ScoreBreakdown -> RankingTrace
 *
 * Covers:
 *   - non-zero sub-scores become contributions in the right order
 *   - zero-weight sub-scores are dropped
 *   - matchedConstraints flow from AppliedFilter[]
 *   - legacy fallback path (null breakdown handled at the call site; here we
 *     just assert the adapter does not explode on an empty breakdown)
 *   - integration: adapter + buildExplanation emits contribution labels
 */
import { describe, expect, it } from "vitest"
import { buildTraceFromScoreBreakdown } from "../build-ranking-trace"
import { buildExplanation } from "../explanation-builder"
import type { ScoreBreakdown } from "@/lib/types/canonical"
import type { AppliedFilter } from "@/lib/types/exploration"
import type {
  ScoredProduct,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"
import type { CanonicalProduct } from "@/lib/types/canonical"

function cell(score: number, detail = ""): { score: number; max: number; detail: string } {
  return { score, max: Math.max(score, 10), detail }
}

function makeBreakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    diameter:     cell(25, "exact"),
    flutes:       cell(10, "exact"),
    materialTag:  cell(20, "exact"),
    operation:    cell(0),
    toolShape:    cell(0),
    coating:      cell(0),
    completeness: cell(0),
    evidence:     cell(0),
    total: 55,
    maxTotal: 85,
    matchPct: 65,
    ...overrides,
  }
}

function makeFilters(...pairs: Array<[string, string]>): AppliedFilter[] {
  return pairs.map(([field, value], i) => ({
    field,
    value,
    op: "eq",
    rawValue: value,
    appliedAt: i,
  }))
}

describe("buildTraceFromScoreBreakdown", () => {
  it("produces one contribution per non-zero sub-score, sorted by |weight| desc", () => {
    const bd = makeBreakdown()
    const trace = buildTraceFromScoreBreakdown("P1", bd, 1, [])
    expect(trace.contributions.length).toBe(3)
    // diameter (25) > materialTag (20) > flutes (10)
    expect(trace.contributions[0].label).toContain("직경")
    expect(trace.contributions[1].label).toContain("소재군")
    expect(trace.contributions[2].label).toContain("날 수")
    expect(trace.contributions[0].weight).toBe(25)
  })

  it("drops zero-weight sub-scores", () => {
    const bd = makeBreakdown({
      diameter: cell(0),
      flutes: cell(0),
      materialTag: cell(20),
    })
    const trace = buildTraceFromScoreBreakdown("P1", bd, 1, [])
    expect(trace.contributions.length).toBe(1)
    expect(trace.contributions[0].label).toContain("소재군")
  })

  it("flows matchedConstraints through from AppliedFilter[]", () => {
    const bd = makeBreakdown()
    const filters = makeFilters(["diameterMm", "12"], ["coating", "H-Coating"])
    const trace = buildTraceFromScoreBreakdown("P1", bd, 2, filters)
    expect(trace.matchedConstraints).toEqual([
      { field: "diameterMm", value: "12" },
      { field: "coating", value: "H-Coating" },
    ])
    expect(trace.rank).toBe(2)
    expect(trace.finalScore).toBe(bd.total)
    expect(trace.productId).toBe("P1")
  })

  it("defaults matchedConstraints to empty when no filters provided", () => {
    const trace = buildTraceFromScoreBreakdown("P1", makeBreakdown(), 1)
    expect(trace.matchedConstraints).toEqual([])
  })

  it("handles an all-zero breakdown by producing zero contributions (safe fallback)", () => {
    const zero: ScoreBreakdown = {
      diameter:     cell(0),
      flutes:       cell(0),
      materialTag:  cell(0),
      operation:    cell(0),
      toolShape:    cell(0),
      coating:      cell(0),
      completeness: cell(0),
      evidence:     cell(0),
      total: 0,
      maxTotal: 0,
      matchPct: 0,
    }
    const trace = buildTraceFromScoreBreakdown("P1", zero, 1, [])
    expect(trace.contributions).toEqual([])
    expect(trace.finalScore).toBe(0)
  })
})

// ── End-to-end: adapter + buildExplanation ──────────────────
describe("build-ranking-trace + buildExplanation (integration)", () => {
  function makeProduct(): CanonicalProduct {
    return {
      id: "test-int-001",
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
    } as unknown as CanonicalProduct
  }
  function makeScored(bd: ScoreBreakdown): ScoredProduct {
    return {
      product: makeProduct(),
      score: bd.total,
      scoreBreakdown: bd,
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
      manufacturerScope: "yg1-only",
      locale: "ko",
    } as RecommendationInput
  }

  it("explanation summaryText contains every contribution label produced by the adapter", () => {
    const bd = makeBreakdown()
    const filters = makeFilters(["diameterMm", "12"])
    const trace = buildTraceFromScoreBreakdown("4GDA12050", bd, 1, filters)
    const explanation = buildExplanation(makeScored(bd), makeInput(), null, trace)

    for (const c of trace.contributions) {
      expect(explanation.summaryText).toContain(c.label)
    }
    expect(explanation.summaryText).toMatch(/기여도:/)
    expect(explanation.summaryText).toMatch(/일치 조건:/)
    expect(explanation.summaryText).toContain("diameterMm=12")
    // narrative suffix preserved
    expect(explanation.summaryText).toMatch(/매칭률/)
  })

  it("explanation falls back to narrative-only when no trace is provided", () => {
    const bd = makeBreakdown()
    const explanation = buildExplanation(makeScored(bd), makeInput(), null)
    expect(explanation.summaryText).not.toMatch(/기여도:/)
    expect(explanation.summaryText).toMatch(/매칭률/)
  })
})
