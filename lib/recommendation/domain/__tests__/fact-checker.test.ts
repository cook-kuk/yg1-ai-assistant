import { describe, expect, it } from "vitest"

import { runFactCheck } from "../fact-checker"
import { buildExplanation } from "../explanation-builder"
import type {
  ScoredProduct,
  RecommendationInput,
  EvidenceSummary,
  CuttingConditions,
  ScoreBreakdown,
  RecommendationExplanation,
} from "@/lib/recommendation/domain/types"
import type { CanonicalProduct, InventorySnapshot, LeadTimeRecord, ProductEvidence } from "@/lib/types/canonical"

// ── Helpers ────────────────────────────────────────────────────

function makeProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
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
    applicationShapes: ["Side_Milling", "Slotting"],
    materialTags: ["N"],
    country: null,
    description: null,
    featureText: null,
    seriesIconUrl: null,
    sourceConfidence: "high",
    dataCompletenessScore: 0.85,
    evidenceRefs: [],
    ...overrides,
  }
}

function makeBreakdown(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
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
    ...overrides,
  }
}

function makeScored(overrides: Partial<ScoredProduct> = {}): ScoredProduct {
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
    ...overrides,
  }
}

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    material: "알루미늄",
    diameterMm: 12,
    flutePreference: 3,
    coatingPreference: undefined,
    operationType: undefined,
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

function makeConditions(): CuttingConditions {
  return {
    Vc: "330 m/min",
    n: "8750 rpm",
    fz: "0.04 mm/tooth",
    vf: "1050 mm/min",
    ap: "1.5D",
    ae: "0.05D",
  }
}

function makeEvidence(overrides: Partial<EvidenceSummary> = {}): EvidenceSummary {
  return {
    productCode: "4GDA12050",
    seriesName: "ALU-POWER HPC",
    chunks: [
      {
        id: "ev-abc123",
        productCode: "4GDA12050",
        seriesName: "ALU-POWER HPC",
        toolType: "End Mill",
        toolSubtype: "Square",
        cuttingType: "Slotting",
        isoGroup: "N",
        diameterMm: 12,
        conditions: makeConditions(),
        coating: "H-Coating",
        toolMaterial: "Carbide",
        fluteCount: 3,
        helixAngle: null,
        confidence: 0.92,
        sourceFile: "yg1_4G_mill",
        pdfFile: "yg1_4G_mill.pdf",
        referencePages: "47",
        pageTitle: "ALU-POWER HPC",
        searchText: "4GDA12050 ALU-POWER HPC slotting N",
      },
    ],
    bestCondition: makeConditions(),
    bestConfidence: 0.92,
    sourceCount: 1,
    ...overrides,
  }
}

function makeExplanation(): RecommendationExplanation {
  return {
    productCode: "4GDA12050",
    displayCode: "4GDA-12050",
    matchPct: 100,
    matchStatus: "exact",
    matchedFacts: [],
    unmatchedFacts: [],
    supportingEvidence: [],
    warnings: [],
    summaryText: "test summary",
  }
}

// ════════════════════════════════════════════════════════════════
// FACT CHECKER TESTS
// ════════════════════════════════════════════════════════════════

describe("runFactCheck", () => {
  // ── Step 1: Product Identity ─────────────────────────────

  it("step 1 passes when all identity fields are present", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    const step1 = result.factCheckReport.steps[0]
    expect(step1.name).toBe("product_identity")
    expect(step1.passed).toBe(true)
    expect(step1.issues).toHaveLength(0)
    expect(step1.fieldsVerified).toBe(4)
  })

  it("step 1 fails when normalizedCode is empty", async () => {
    const scored = makeScored({ product: makeProduct({ normalizedCode: "" }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step1 = result.factCheckReport.steps[0]
    expect(step1.passed).toBe(false)
    expect(step1.issues).toContain("정규화된 제품 코드 없음")
  })

  it("step 1 fails when displayCode is empty", async () => {
    const scored = makeScored({ product: makeProduct({ displayCode: "" }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step1 = result.factCheckReport.steps[0]
    expect(step1.passed).toBe(false)
    expect(step1.issues).toContain("표시용 제품 코드 없음")
  })

  it("step 1 flags non-YG-1 manufacturer", async () => {
    const scored = makeScored({ product: makeProduct({ manufacturer: "Sandvik" }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step1 = result.factCheckReport.steps[0]
    expect(step1.passed).toBe(false)
    expect(step1.issues[0]).toContain("Sandvik")
  })

  // ── Step 2: Spec Check ──────────────────────────────────

  it("step 2 passes when >= 4 spec fields are present", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    const step2 = result.factCheckReport.steps[1]
    expect(step2.name).toBe("spec_check")
    expect(step2.passed).toBe(true)
    expect(step2.fieldsChecked).toBe(7)
  })

  it("step 2 fails when too many spec fields are null", async () => {
    const scored = makeScored({
      product: makeProduct({
        diameterMm: null,
        fluteCount: null,
        coating: null,
        toolMaterial: null,
        materialTags: [],
        lengthOfCutMm: null,
        overallLengthMm: null,
      }),
    })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step2 = result.factCheckReport.steps[1]
    expect(step2.passed).toBe(false)
    expect(step2.fieldsVerified).toBe(0)
  })

  it("step 2 issues list missing fields", async () => {
    const scored = makeScored({
      product: makeProduct({ diameterMm: null, coating: null }),
    })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step2 = result.factCheckReport.steps[1]
    expect(step2.issues).toContain("직경 정보 없음")
    expect(step2.issues).toContain("코팅 정보 없음")
  })

  // ── Step 3: Cutting Conditions ──────────────────────────

  it("step 3 passes with evidence and high confidence", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    const step3 = result.factCheckReport.steps[2]
    expect(step3.name).toBe("cutting_condition")
    expect(step3.passed).toBe(true)
    expect(step3.fieldsVerified).toBe(3)
  })

  it("step 3 fails with no evidence", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), null, makeExplanation())
    const step3 = result.factCheckReport.steps[2]
    expect(step3.passed).toBe(false)
    expect(step3.issues).toContain("절삭조건 데이터 없음")
  })

  it("step 3 flags low confidence evidence", async () => {
    const evidence = makeEvidence({ bestConfidence: 0.4 })
    const result = await runFactCheck(makeScored(), makeInput(), evidence, makeExplanation())
    const step3 = result.factCheckReport.steps[2]
    expect(step3.issues.some(i => i.includes("신뢰도 낮음"))).toBe(true)
    expect(step3.fieldsVerified).toBe(2) // evidence exists + sourceCount, but not confidence
  })

  it("step 3 passes even with low confidence (evidence exists)", async () => {
    const evidence = makeEvidence({ bestConfidence: 0.3 })
    const result = await runFactCheck(scored(), makeInput(), evidence, makeExplanation())
    const step3 = result.factCheckReport.steps[2]
    // passed = fieldsVerified >= 1, evidence exists so at least 1
    expect(step3.passed).toBe(true)

    function scored() { return makeScored() }
  })

  // ── Step 4: Inventory & Lead Time ───────────────────────

  it("step 4 passes with stock info", async () => {
    const scored = makeScored({ stockStatus: "instock", totalStock: 100, minLeadTimeDays: 3 })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step4 = result.factCheckReport.steps[3]
    expect(step4.name).toBe("inventory_check")
    expect(step4.passed).toBe(true)
    expect(step4.fieldsVerified).toBe(3)
  })

  it("step 4 flags unknown stock status", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    const step4 = result.factCheckReport.steps[3]
    expect(step4.issues).toContain("재고 정보 없음")
  })

  it("step 4 flags missing lead time", async () => {
    const scored = makeScored({ stockStatus: "instock", totalStock: 50, minLeadTimeDays: null })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const step4 = result.factCheckReport.steps[3]
    expect(step4.issues).toContain("납기 정보 없음")
  })

  // ── Step 5: Render-Safe Assembly ────────────────────────

  it("wraps product code as verified when step 1 passes", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    expect(result.productCode.status).toBe("verified")
    expect(result.productCode.value).toBe("4GDA12050")
  })

  it("wraps product code as partial when step 1 fails", async () => {
    const scored = makeScored({ product: makeProduct({ normalizedCode: "" }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    expect(result.productCode.status).toBe("partial")
  })

  it("wraps displayCode as unverified when missing", async () => {
    const scored = makeScored({ product: makeProduct({ displayCode: "" }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    expect(result.displayCode.status).toBe("unverified")
  })

  it("wraps spec fields as verified when present", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    expect(result.diameterMm.status).toBe("verified")
    expect(result.diameterMm.value).toBe(12)
    expect(result.fluteCount.status).toBe("verified")
    expect(result.coating.status).toBe("verified")
  })

  it("wraps spec fields as unverified when null", async () => {
    const scored = makeScored({ product: makeProduct({ diameterMm: null, fluteCount: null }) })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    expect(result.diameterMm.status).toBe("unverified")
    expect(result.fluteCount.status).toBe("unverified")
  })

  it("wraps cutting condition fields from evidence", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), makeExplanation())
    expect(result.hasCuttingConditions).toBe(true)
    expect(result.bestCondition.status).toBe("verified")
    expect(result.conditionConfidence.value).toBe(0.92)
  })

  it("wraps cutting condition fields as unverified when no evidence", async () => {
    const result = await runFactCheck(makeScored(), makeInput(), null, makeExplanation())
    expect(result.hasCuttingConditions).toBe(false)
    expect(result.bestCondition.status).toBe("unverified")
    expect(result.conditionConfidence.value).toBe(0)
  })

  // ── Report Aggregation ──────────────────────────────────

  it("computes verificationPct correctly", async () => {
    const scored = makeScored({ stockStatus: "instock", totalStock: 100, minLeadTimeDays: 3 })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    const report = result.factCheckReport
    expect(report.totalFieldsChecked).toBeGreaterThan(0)
    expect(report.verificationPct).toBe(
      Math.round((report.totalFieldsVerified / report.totalFieldsChecked) * 100)
    )
  })

  it("report overallStatus is verified when all steps pass", async () => {
    const scored = makeScored({ stockStatus: "instock", totalStock: 100, minLeadTimeDays: 5 })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    expect(result.factCheckReport.overallStatus).toBe("verified")
  })

  it("preserves score and matchStatus from scored input", async () => {
    const scored = makeScored({ score: 72, matchStatus: "approximate" })
    const result = await runFactCheck(scored, makeInput(), makeEvidence(), makeExplanation())
    expect(result.score).toBe(72)
    expect(result.matchStatus).toBe("approximate")
  })

  it("preserves explanation in output", async () => {
    const explanation = makeExplanation()
    const result = await runFactCheck(makeScored(), makeInput(), makeEvidence(), explanation)
    expect(result.explanation).toBe(explanation)
  })
})

// ════════════════════════════════════════════════════════════════
// EXPLANATION BUILDER TESTS
// ════════════════════════════════════════════════════════════════

describe("buildExplanation", () => {
  // ── Matched Facts ──────────────────────────────────────

  it("detects exact diameter match", () => {
    const scored = makeScored()
    const input = makeInput({ diameterMm: 12 })
    const result = buildExplanation(scored, input, null)
    const diameterFact = result.matchedFacts.find(f => f.field === "diameter")
    expect(diameterFact).toBeDefined()
    expect(diameterFact!.matchType).toBe("exact")
    expect(diameterFact!.requestedValue).toBe("12mm")
    expect(diameterFact!.productValue).toBe("12mm")
  })

  it("detects close diameter match (diff <= 0.5)", () => {
    const scored = makeScored({ product: makeProduct({ diameterMm: 12.3 }) })
    const input = makeInput({ diameterMm: 12 })
    const result = buildExplanation(scored, input, null)
    const diameterFact = result.matchedFacts.find(f => f.field === "diameter")
    expect(diameterFact).toBeDefined()
    expect(diameterFact!.matchType).toBe("close")
  })

  it("detects partial diameter match (diff <= 2)", () => {
    const scored = makeScored({ product: makeProduct({ diameterMm: 13.5 }) })
    const input = makeInput({ diameterMm: 12 })
    const result = buildExplanation(scored, input, null)
    const diameterFact = result.matchedFacts.find(f => f.field === "diameter")
    expect(diameterFact).toBeDefined()
    expect(diameterFact!.matchType).toBe("partial")
  })

  it("detects exact flute count match", () => {
    const scored = makeScored()
    const input = makeInput({ flutePreference: 3 })
    const result = buildExplanation(scored, input, null)
    const fluteFact = result.matchedFacts.find(f => f.field === "fluteCount")
    expect(fluteFact).toBeDefined()
    expect(fluteFact!.matchType).toBe("exact")
  })

  it("does not include flute match when counts differ", () => {
    const scored = makeScored()
    const input = makeInput({ flutePreference: 4 })
    const result = buildExplanation(scored, input, null)
    const fluteFact = result.matchedFacts.find(f => f.field === "fluteCount")
    expect(fluteFact).toBeUndefined()
  })

  it("returns empty matched facts when no breakdown", () => {
    const scored = makeScored({ scoreBreakdown: null })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.matchedFacts).toHaveLength(0)
  })

  // ── Unmatched Facts ─────────────────────────────────────

  it("detects critical diameter mismatch (diff > 2)", () => {
    const scored = makeScored({ product: makeProduct({ diameterMm: 20 }) })
    const input = makeInput({ diameterMm: 12 })
    const result = buildExplanation(scored, input, null)
    const unmatch = result.unmatchedFacts.find(f => f.field === "diameter")
    expect(unmatch).toBeDefined()
    expect(unmatch!.impact).toBe("critical")
    expect(unmatch!.reason).toContain("8.0mm")
  })

  it("detects moderate impact when product diameter is null", () => {
    const scored = makeScored({ product: makeProduct({ diameterMm: null }) })
    const input = makeInput({ diameterMm: 12 })
    const result = buildExplanation(scored, input, null)
    const unmatch = result.unmatchedFacts.find(f => f.field === "diameter")
    expect(unmatch).toBeDefined()
    expect(unmatch!.impact).toBe("moderate")
    expect(unmatch!.productValue).toBeNull()
  })

  it("detects flute count mismatch as moderate", () => {
    const scored = makeScored()
    const input = makeInput({ flutePreference: 4 })
    const result = buildExplanation(scored, input, null)
    const unmatch = result.unmatchedFacts.find(f => f.field === "fluteCount")
    expect(unmatch).toBeDefined()
    expect(unmatch!.impact).toBe("moderate")
  })

  it("detects coating mismatch as minor", () => {
    const scored = makeScored()
    const input = makeInput({ coatingPreference: "TiAlN" })
    const result = buildExplanation(scored, input, null)
    const unmatch = result.unmatchedFacts.find(f => f.field === "coating")
    expect(unmatch).toBeDefined()
    expect(unmatch!.impact).toBe("minor")
  })

  it("returns empty unmatched facts when no breakdown", () => {
    const scored = makeScored({ scoreBreakdown: null })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.unmatchedFacts).toHaveLength(0)
  })

  // ── Supporting Evidence ──────────────────────────────────

  it("always includes catalog_spec evidence", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    const catalogEv = result.supportingEvidence.find(e => e.type === "catalog_spec")
    expect(catalogEv).toBeDefined()
    expect(catalogEv!.source).toBe("yg1_4G_mill")
  })

  it("includes cutting_condition evidence when present", () => {
    const result = buildExplanation(makeScored(), makeInput(), makeEvidence())
    const cuttingEv = result.supportingEvidence.find(e => e.type === "cutting_condition")
    expect(cuttingEv).toBeDefined()
    expect(cuttingEv!.confidence).toBe(0.92)
    expect(cuttingEv!.sourceCount).toBe(1)
  })

  it("omits cutting_condition evidence when no evidence", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    const cuttingEv = result.supportingEvidence.find(e => e.type === "cutting_condition")
    expect(cuttingEv).toBeUndefined()
  })

  it("includes inventory evidence when inventory exists", () => {
    const scored = makeScored({
      inventory: [{ edp: "4GDA-12050", normalizedEdp: "4GDA12050", description: null, spec: null, warehouseOrRegion: "KR", quantity: 50, snapshotDate: null, price: null, currency: null, unit: null, sourceFile: "inv.csv" }],
      stockStatus: "instock",
    })
    const result = buildExplanation(scored, makeInput(), null)
    const invEv = result.supportingEvidence.find(e => e.type === "inventory")
    expect(invEv).toBeDefined()
    expect(invEv!.confidence).toBe(1.0)
  })

  it("includes lead_time evidence when lead times exist", () => {
    const scored = makeScored({
      leadTimes: [{ edp: "4GDA-12050", normalizedEdp: "4GDA12050", plant: "KR01", leadTimeDays: 5 }],
      minLeadTimeDays: 5,
    })
    const result = buildExplanation(scored, makeInput(), null)
    const ltEv = result.supportingEvidence.find(e => e.type === "lead_time")
    expect(ltEv).toBeDefined()
    expect(ltEv!.summary).toContain("5일")
  })

  // ── Warnings ────────────────────────────────────────────

  it("warns for approximate match", () => {
    const scored = makeScored({ matchStatus: "approximate" })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.warnings).toContain("정확 일치 없음 — 근사 후보입니다")
  })

  it("warns for low data completeness", () => {
    const scored = makeScored({ product: makeProduct({ dataCompletenessScore: 0.3 }) })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.warnings.some(w => w.includes("데이터 불완전"))).toBe(true)
  })

  it("warns for out of stock", () => {
    const scored = makeScored({ stockStatus: "outofstock" })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.warnings).toContain("현재 재고 없음")
  })

  it("warns for unknown stock status", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    expect(result.warnings).toContain("재고 정보 확인 불가")
  })

  it("warns when no cutting condition evidence", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    expect(result.warnings.some(w => w.includes("절삭조건 데이터 없음"))).toBe(true)
  })

  it("warns for low cutting condition confidence", () => {
    const evidence = makeEvidence({ bestConfidence: 0.5 })
    const result = buildExplanation(makeScored(), makeInput(), evidence)
    expect(result.warnings.some(w => w.includes("신뢰도 낮음"))).toBe(true)
  })

  it("warns when material is not specified", () => {
    const input = makeInput({ material: undefined })
    const result = buildExplanation(makeScored(), input, null)
    expect(result.warnings).toContain("소재 미지정 — 소재 적합성 미확인")
  })

  // ── Summary Text ────────────────────────────────────────

  it("summary includes match count", () => {
    const scored = makeScored()
    const input = makeInput({ diameterMm: 12, flutePreference: 3 })
    const result = buildExplanation(scored, input, null)
    expect(result.summaryText).toContain("일치")
  })

  it("summary includes matchPct", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    expect(result.summaryText).toContain("매칭률")
  })

  it("summary includes cutting condition count when present", () => {
    const result = buildExplanation(makeScored(), makeInput(), makeEvidence())
    expect(result.summaryText).toContain("절삭조건 1건 보유")
  })

  // ── Output Shape ────────────────────────────────────────

  it("output includes productCode and displayCode", () => {
    const result = buildExplanation(makeScored(), makeInput(), null)
    expect(result.productCode).toBe("4GDA12050")
    expect(result.displayCode).toBe("4GDA-12050")
  })

  it("output matchPct defaults to 0 when no breakdown", () => {
    const scored = makeScored({ scoreBreakdown: null })
    const result = buildExplanation(scored, makeInput(), null)
    expect(result.matchPct).toBe(0)
  })
})
