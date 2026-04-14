import { describe, it, expect } from "vitest"
import {
  computeUncertaintySignal,
  decideMode,
  deriveConfidence,
  deriveRisk,
  buildReasonCodes,
  selectHighestInfoGainQuestion,
  evaluateUncertainty,
  assignPerspectiveLabel,
  buildReasonSummary,
  getPerspectiveKo,
  type UncertaintySignal,
  type RecommendationMeta,
} from "../uncertainty-gate"
import type {
  AppliedFilter,
  EvidenceSummary,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

// ── Helpers ──────────────────────────────────────────────────

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

function makeScoreBreakdown(matchPct = 80) {
  const mk = (score: number, max: number) => ({ score, max, detail: "" })
  return {
    diameter: mk(20, 20),
    materialTag: mk(15, 15),
    operation: mk(10, 10),
    flutes: mk(5, 5),
    toolShape: mk(5, 5),
    coating: mk(3, 3),
    completeness: mk(2, 2),
    evidence: mk(5, 5),
    total: 65,
    maxTotal: 65,
    matchPct,
  }
}

function makeCandidate(overrides: Partial<ScoredProduct> & { code?: string; score?: number } = {}): ScoredProduct {
  const code = overrides.code ?? "TEST001"
  return {
    product: {
      id: code,
      normalizedCode: code,
      displayCode: code,
      brand: "YG-1",
      seriesName: "TestSeries",
      toolSubtype: "endmill",
      coating: "TiAlN",
      fluteCount: 4,
      diameterMm: 10,
      materialTags: ["P"],
    } as ScoredProduct["product"],
    score: overrides.score ?? 80,
    scoreBreakdown: overrides.scoreBreakdown ?? makeScoreBreakdown(),
    matchedFields: ["diameterMm", "material"],
    matchStatus: overrides.matchStatus ?? "exact",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "in_stock" as ScoredProduct["stockStatus"],
    totalStock: 100,
    minLeadTimeDays: null,
    ...overrides,
  } as ScoredProduct
}

function makeFilter(field: string, value: string, op = "eq"): AppliedFilter {
  return { field, op, value, rawValue: value } as AppliedFilter
}

// ── decideMode ───────────────────────────────────────────────

describe("decideMode", () => {
  const baseSignal: UncertaintySignal = {
    missingCriticalSlots: [],
    candidateCount: 50,
    topScoreGap: 15,
    evidenceCoverage: 0.8,
    hasConstraintConflict: false,
    highRiskTask: false,
    lowConfidenceMapping: false,
    zeroOrTooWideResults: false,
    userIntentAmbiguous: false,
    topMatchPct: 75,
    meaningfulFilterCount: 3,
  }

  it("returns FAST when all signals are confident", () => {
    expect(decideMode(baseSignal)).toBe("FAST")
  })

  it("returns ASK when 2+ critical slots missing + >3000 candidates", () => {
    expect(decideMode({
      ...baseSignal,
      missingCriticalSlots: ["diameterMm", "material"],
      candidateCount: 5000,
    })).toBe("ASK")
  })

  it("returns ASK when intent ambiguous + 1 missing slot", () => {
    expect(decideMode({
      ...baseSignal,
      userIntentAmbiguous: true,
      missingCriticalSlots: ["material"],
    })).toBe("ASK")
  })

  it("returns VERIFY for high risk task", () => {
    expect(decideMode({ ...baseSignal, highRiskTask: true })).toBe("VERIFY")
  })

  it("returns VERIFY for constraint conflict", () => {
    expect(decideMode({ ...baseSignal, hasConstraintConflict: true })).toBe("VERIFY")
  })

  it("returns VERIFY for low confidence mapping", () => {
    expect(decideMode({ ...baseSignal, lowConfidenceMapping: true })).toBe("VERIFY")
  })

  it("returns VERIFY for close top score gap with weak evidence", () => {
    // Close gap + low evidence → VERIFY (even if slots filled, strongMatch fails)
    expect(decideMode({ ...baseSignal, topScoreGap: 2, candidateCount: 5, evidenceCoverage: 0.3 })).toBe("VERIFY")
  })

  it("returns FAST for close top score gap with all slots filled + strong match", () => {
    // Close gap but all critical slots filled + high match + good evidence → stay FAST
    expect(decideMode({ ...baseSignal, topScoreGap: 2, candidateCount: 5 })).toBe("FAST")
  })

  it("returns VERIFY for low evidence coverage", () => {
    expect(decideMode({
      ...baseSignal,
      evidenceCoverage: 0.1,
      candidateCount: 30,
    })).toBe("VERIFY")
  })

  it("returns VERIFY for zero results", () => {
    expect(decideMode({ ...baseSignal, zeroOrTooWideResults: true })).toBe("VERIFY")
  })
})

// ── deriveConfidence ─────────────────────────────────────────

describe("deriveConfidence", () => {
  it("returns high when topMatchPct >= 70, evidenceCoverage >= 0.5, gap >= 10", () => {
    expect(deriveConfidence({
      topMatchPct: 75,
      evidenceCoverage: 0.6,
      topScoreGap: 15,
      meaningfulFilterCount: 2,
      candidateCount: 50,
      missingCriticalSlots: [],
    } as unknown as UncertaintySignal)).toBe("high")
  })

  it("returns medium when topMatchPct >= 40", () => {
    expect(deriveConfidence({
      topMatchPct: 50,
      evidenceCoverage: 0.2,
      topScoreGap: 5,
      meaningfulFilterCount: 1,
      candidateCount: 200,
      missingCriticalSlots: [],
    } as unknown as UncertaintySignal)).toBe("medium")
  })

  it("returns low when topMatchPct < 40 and few filters", () => {
    expect(deriveConfidence({
      topMatchPct: 20,
      evidenceCoverage: 0.1,
      topScoreGap: 2,
      meaningfulFilterCount: 0,
      candidateCount: 5000,
      missingCriticalSlots: ["diameterMm"],
    } as unknown as UncertaintySignal)).toBe("low")
  })
})

// ── deriveRisk ───────────────────────────────────────────────

describe("deriveRisk", () => {
  it("returns high for high risk task", () => {
    expect(deriveRisk({ highRiskTask: true } as UncertaintySignal)).toBe("high")
  })

  it("returns high for constraint conflict", () => {
    expect(deriveRisk({ hasConstraintConflict: true } as UncertaintySignal)).toBe("high")
  })

  it("returns high for low confidence mapping", () => {
    expect(deriveRisk({
      highRiskTask: false,
      hasConstraintConflict: false,
      lowConfidenceMapping: true,
    } as UncertaintySignal)).toBe("high")
  })

  it("returns medium for close gap with multiple candidates", () => {
    expect(deriveRisk({
      highRiskTask: false,
      hasConstraintConflict: false,
      lowConfidenceMapping: false,
      zeroOrTooWideResults: false,
      topScoreGap: 3,
      candidateCount: 5,
      missingCriticalSlots: [],
      userIntentAmbiguous: false,
      evidenceCoverage: 0.5,
      topMatchPct: 60,
      meaningfulFilterCount: 2,
    } satisfies UncertaintySignal)).toBe("medium")
  })

  it("returns low when no risk signals", () => {
    expect(deriveRisk({
      highRiskTask: false,
      hasConstraintConflict: false,
      lowConfidenceMapping: false,
      zeroOrTooWideResults: false,
      topScoreGap: 15,
      candidateCount: 10,
      missingCriticalSlots: [],
      userIntentAmbiguous: false,
      evidenceCoverage: 0.5,
      topMatchPct: 60,
      meaningfulFilterCount: 2,
    } satisfies UncertaintySignal)).toBe("low")
  })
})

// ── buildReasonCodes ─────────────────────────────────────────

describe("buildReasonCodes", () => {
  it("maps score breakdown fields to reason codes", () => {
    const primary = makeCandidate({ score: 80 })
    const codes = buildReasonCodes(primary, makeInput(), null)
    expect(codes).toContain("diameter_match")
    expect(codes).toContain("material_fit")
    expect(codes).toContain("operation_fit")
    expect(codes).toContain("flute_match")
    expect(codes).toContain("evidence_grounded")
    expect(codes).toContain("performance_priority") // matchPct=80
    expect(codes).toContain("inventory_advantage") // totalStock=100
  })

  it("adds evidence_grounded from evidence summary", () => {
    const primary = makeCandidate({
      scoreBreakdown: { ...makeScoreBreakdown(), evidence: { score: 0, max: 5, detail: "" } },
    })
    const ev: EvidenceSummary = { sourceCount: 3 } as EvidenceSummary
    const codes = buildReasonCodes(primary, makeInput(), ev)
    expect(codes).toContain("evidence_grounded")
  })

  it("deduplicates codes", () => {
    const primary = makeCandidate({ score: 80 })
    const ev: EvidenceSummary = { sourceCount: 2 } as EvidenceSummary
    const codes = buildReasonCodes(primary, makeInput(), ev)
    const evidenceCount = codes.filter(c => c === "evidence_grounded").length
    expect(evidenceCount).toBe(1)
  })
})

// ── computeUncertaintySignal ─────────────────────────────────

describe("computeUncertaintySignal", () => {
  it("detects missing critical slots", () => {
    const signal = computeUncertaintySignal(
      [makeCandidate()],
      new Map(),
      makeInput(), // no diameterMm, no material, no operationType
      [],
      100,
    )
    expect(signal.missingCriticalSlots).toContain("diameterMm")
    expect(signal.missingCriticalSlots).toContain("material")
    expect(signal.missingCriticalSlots).toContain("operationType")
  })

  it("no missing slots when all critical inputs present", () => {
    const signal = computeUncertaintySignal(
      [makeCandidate()],
      new Map(),
      makeInput({ diameterMm: 10, material: "P", operationType: "slotting" }),
      [],
      50,
    )
    expect(signal.missingCriticalSlots).toHaveLength(0)
  })

  it("computes topScoreGap correctly", () => {
    const c1 = makeCandidate({ code: "A", score: 80 })
    const c2 = makeCandidate({ code: "B", score: 75 })
    const signal = computeUncertaintySignal([c1, c2], new Map(), makeInput(), [], 100)
    expect(signal.topScoreGap).toBe(5)
  })

  it("topScoreGap = 100 when only 1 candidate", () => {
    const signal = computeUncertaintySignal(
      [makeCandidate()],
      new Map(),
      makeInput(),
      [],
      1,
    )
    expect(signal.topScoreGap).toBe(100)
  })

  it("detects constraint conflict (drill + 4 flutes)", () => {
    const filters = [
      makeFilter("fluteCount", "4"),
      makeFilter("operationType", "drilling"),
    ]
    const signal = computeUncertaintySignal(
      [makeCandidate()],
      new Map(),
      makeInput(),
      filters,
      50,
    )
    expect(signal.hasConstraintConflict).toBe(true)
  })

  it("detects high risk task", () => {
    const signal = computeUncertaintySignal(
      [makeCandidate()],
      new Map(),
      makeInput(),
      [],
      50,
      { isCuttingConditionTask: true },
    )
    expect(signal.highRiskTask).toBe(true)
  })

  it("detects low confidence when top is matchStatus=none", () => {
    const signal = computeUncertaintySignal(
      [makeCandidate({ matchStatus: "none" })],
      new Map(),
      makeInput(),
      [],
      50,
    )
    expect(signal.lowConfidenceMapping).toBe(true)
  })
})

// ── selectHighestInfoGainQuestion ────────────────────────────

describe("selectHighestInfoGainQuestion", () => {
  it("returns null when no missing fields", () => {
    const input = makeInput({
      toolSubtype: "endmill",
      flutePreference: 4,
      coatingPreference: "TiAlN",
      diameterMm: 10,
      material: "P",
      operationType: "slotting",
    })
    const q = selectHighestInfoGainQuestion([makeCandidate()], input, [])
    expect(q).toBeNull()
  })

  it("selects highest reduction ratio field", () => {
    // Create candidates with diverse toolSubtype and coating
    const c1 = makeCandidate({ code: "A" })
    ;(c1.product as Record<string, unknown>).toolSubtype = "endmill"
    ;(c1.product as Record<string, unknown>).coating = "TiAlN"
    const c2 = makeCandidate({ code: "B" })
    ;(c2.product as Record<string, unknown>).toolSubtype = "drill"
    ;(c2.product as Record<string, unknown>).coating = "TiAlN"
    const c3 = makeCandidate({ code: "C" })
    ;(c3.product as Record<string, unknown>).toolSubtype = "tap"
    ;(c3.product as Record<string, unknown>).coating = "DLC"

    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting" })
    const q = selectHighestInfoGainQuestion([c1, c2, c3], input, [])
    expect(q).not.toBeNull()
    expect(q!.reductionRatio).toBeGreaterThan(0)
  })

  it("skips fields that are already filtered", () => {
    const c1 = makeCandidate({ code: "A" })
    ;(c1.product as Record<string, unknown>).toolSubtype = "endmill"
    const c2 = makeCandidate({ code: "B" })
    ;(c2.product as Record<string, unknown>).toolSubtype = "drill"

    const filters = [makeFilter("toolSubtype", "endmill")]
    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting" })
    const q = selectHighestInfoGainQuestion([c1, c2], input, filters)
    // toolSubtype should be excluded since already filtered
    if (q) expect(q.field).not.toBe("toolSubtype")
  })
})

// ── evaluateUncertainty (integration) ────────────────────────

describe("evaluateUncertainty", () => {
  it("returns FAST with high confidence for well-specified query", () => {
    const primary = makeCandidate({ score: 90, matchStatus: "exact" })
    const second = makeCandidate({ code: "ALT", score: 60, matchStatus: "approximate" })
    const evMap = new Map<string, EvidenceSummary>()
    evMap.set("TEST001", { sourceCount: 5 } as EvidenceSummary)
    evMap.set("ALT", { sourceCount: 3 } as EvidenceSummary)
    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting" })
    const filters = [
      makeFilter("diameterMm", "10"),
      makeFilter("material", "P"),
      makeFilter("operationType", "slotting"),
    ]

    const meta = evaluateUncertainty(
      [primary, second], evMap, input, filters, 50,
      primary, evMap.get("TEST001")!,
    )

    expect(meta.mode).toBe("FAST")
    expect(meta.confidence).toBe("high")
    expect(meta.risk).toBe("low")
    expect(meta.missing_info).toHaveLength(0)
    expect(meta.reason_codes.length).toBeGreaterThan(0)
  })

  it("returns ASK for ambiguous query with many candidates", () => {
    const input = makeInput() // no diameter, no material, no operation
    const meta = evaluateUncertainty(
      [makeCandidate()], new Map(), input, [], 5000,
      null, null,
    )
    expect(meta.mode).toBe("ASK")
    expect(meta.missing_info.length).toBeGreaterThanOrEqual(2)
  })

  it("returns VERIFY for high risk task", () => {
    const primary = makeCandidate()
    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting" })
    const meta = evaluateUncertainty(
      [primary], new Map(), input,
      [makeFilter("diameterMm", "10"), makeFilter("material", "P")],
      50, primary, null,
      { isCuttingConditionTask: true },
    )
    expect(meta.mode).toBe("VERIFY")
    expect(meta.risk).toBe("high")
  })

  it("returns VERIFY for competitor replacement (substitute purpose)", () => {
    const primary = makeCandidate()
    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting" })
    const meta = evaluateUncertainty(
      [primary], new Map(), input,
      [makeFilter("diameterMm", "10"), makeFilter("material", "P")],
      50, primary, null,
      { isCompetitorReplacement: true },
    )
    expect(meta.mode).toBe("VERIFY")
    expect(meta.risk).toBe("high")
  })

  it("returns VERIFY for regional task", () => {
    const primary = makeCandidate()
    const input = makeInput({ diameterMm: 10, material: "P", operationType: "slotting", country: "US" })
    const meta = evaluateUncertainty(
      [primary], new Map(), input,
      [makeFilter("diameterMm", "10"), makeFilter("material", "P")],
      50, primary, null,
      { isRegionalTask: true },
    )
    expect(meta.mode).toBe("VERIFY")
  })

  it("returns ASK when intentAmbiguous + missing slots", () => {
    const input = makeInput({ diameterMm: 10 }) // missing material + operationType
    const meta = evaluateUncertainty(
      [makeCandidate()], new Map(), input, [], 200,
      null, null,
      { intentAmbiguous: true },
    )
    expect(meta.mode).toBe("ASK")
  })
})

// ── assignPerspectiveLabel ──────────────────────────────────

describe("assignPerspectiveLabel", () => {
  it("returns performance_priority for high match + evidence", () => {
    const c = makeCandidate({ scoreBreakdown: makeScoreBreakdown(85), evidence: [{ source: "test" } as never] })
    expect(assignPerspectiveLabel(c, 85)).toBe("performance_priority")
  })

  it("returns supply_priority for low match + in stock", () => {
    const c = makeCandidate({ scoreBreakdown: makeScoreBreakdown(40), totalStock: 50, evidence: [] })
    expect(assignPerspectiveLabel(c, 80)).toBe("supply_priority")
  })

  it("returns balanced for mid-range match", () => {
    const c = makeCandidate({ scoreBreakdown: makeScoreBreakdown(65), evidence: [] })
    expect(assignPerspectiveLabel(c, 65)).toBe("balanced")
  })
})

// ── buildReasonSummary ──────────────────────────────────────

describe("buildReasonSummary", () => {
  it("builds Korean summary with icon and confidence", () => {
    const meta: RecommendationMeta = {
      confidence: "high",
      risk: "low",
      missing_info: [],
      reason_codes: ["diameter_match", "material_fit", "inventory_advantage"],
      mode: "FAST",
    }
    const result = buildReasonSummary(meta)
    expect(result).toContain("✅")
    expect(result).toContain("직경 일치")
    expect(result).toContain("소재 적합")
    expect(result).toContain("재고 유리")
    expect(result).toContain("신뢰도: 높음")
  })

  it("uses warning icon for low confidence", () => {
    const meta: RecommendationMeta = {
      confidence: "low",
      risk: "high",
      missing_info: ["직경"],
      reason_codes: ["safe_default"],
      mode: "VERIFY",
    }
    const result = buildReasonSummary(meta)
    expect(result).toContain("⚠️")
    expect(result).toContain("신뢰도: 낮음")
  })

  it("returns null for empty reason codes", () => {
    const meta: RecommendationMeta = {
      confidence: "low",
      risk: "high",
      missing_info: [],
      reason_codes: [],
      mode: "ASK",
    }
    expect(buildReasonSummary(meta)).toBeNull()
  })

  it("limits to 4 reason codes max", () => {
    const meta: RecommendationMeta = {
      confidence: "medium",
      risk: "low",
      missing_info: [],
      reason_codes: ["diameter_match", "material_fit", "operation_fit", "flute_match", "coating_match", "inventory_advantage"],
      mode: "FAST",
    }
    const result = buildReasonSummary(meta)!
    // Should only have 4 labels, not 6
    const dotCount = (result.match(/·/g) || []).length
    expect(dotCount).toBe(3) // 4 labels = 3 separators
  })
})

// ── getPerspectiveKo ────────────────────────────────────────

describe("getPerspectiveKo", () => {
  it("returns correct Korean labels", () => {
    expect(getPerspectiveKo("balanced")).toBe("무난한 선택")
    expect(getPerspectiveKo("performance_priority")).toBe("성능 우선")
    expect(getPerspectiveKo("supply_priority")).toBe("수급 우선")
  })
})
