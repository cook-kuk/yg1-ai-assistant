import { describe, it, expect } from "vitest"
import {
  constraintsToFilters,
  scoredProductToCandidateRef,
  buildResultContext,
  shouldSearch,
} from "../search-adapter"
import type { RecommendationSessionState, LlmTurnDecision } from "../types"
import type { ScoredProduct } from "@/lib/recommendation/domain/types"
import { createInitialSessionState } from "../turn-orchestrator"

// ── Helpers ──

function makeState(overrides: Partial<RecommendationSessionState> = {}): RecommendationSessionState {
  return { ...createInitialSessionState(), ...overrides }
}

function makeDecision(
  actionType: LlmTurnDecision["actionInterpretation"]["type"],
  needsGroundedFact = false
): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
    actionInterpretation: { type: actionType, rationale: "test", confidence: 0.9 },
    answerIntent: {
      topic: "test",
      needsGroundedFact,
      shouldUseCurrentResultContext: false,
      shouldResumePendingQuestion: false,
    },
    uiPlan: { optionMode: "none" },
    answerDraft: "test",
  }
}

function makeScoredProduct(overrides: Partial<ScoredProduct> = {}): ScoredProduct {
  return {
    product: {
      id: "test-id",
      manufacturer: "YG-1",
      brand: "YG-1",
      sourcePriority: 1 as 1,
      sourceType: "smart-catalog" as const,
      rawSourceFile: "test.csv",
      rawSourceSheet: null,
      normalizedCode: "TEST001",
      displayCode: "TEST-001",
      seriesName: "V7 Plus A",
      productName: "Test Product",
      toolType: "Solid",
      toolSubtype: "Square",
      diameterMm: 10,
      diameterInch: null,
      fluteCount: 4,
      coating: "AlTiN",
      toolMaterial: "Carbide",
      shankDiameterMm: 10,
      lengthOfCutMm: 22,
      overallLengthMm: 72,
      helixAngleDeg: 35,
      ballRadiusMm: null,
      taperAngleDeg: null,
      coolantHole: false,
      applicationShapes: ["Side_Milling"],
      materialTags: ["P", "M"],
      country: "KR",
      description: null,
      featureText: null,
      seriesIconUrl: null,
      sourceConfidence: "high",
      dataCompletenessScore: 0.9,
      evidenceRefs: ["TEST001"],
    },
    score: 85,
    scoreBreakdown: null,
    matchedFields: ["diameter match"],
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

// ── Tests ──

describe("constraintsToFilters", () => {
  it("maps base constraints to RecommendationInput fields", () => {
    const state = makeState({
      constraints: {
        base: { material: "스테인리스", diameter: 10, operation: "황삭" },
        refinements: {},
      },
    })

    const { input, filters } = constraintsToFilters(state)

    expect(input.material).toBe("스테인리스")
    expect(input.diameterMm).toBe(10)
    expect(input.operationType).toBe("황삭")
    expect(input.manufacturerScope).toBe("yg1-only")
    expect(input.locale).toBe("ko")
    expect(filters).toHaveLength(0)
  })

  it("maps refinements to AppliedFilter array", () => {
    const state = makeState({
      constraints: {
        base: { material: "알루미늄" },
        refinements: { flute: 4, coating: "AlTiN" },
      },
    })

    const { input, filters } = constraintsToFilters(state)

    expect(input.material).toBe("알루미늄")
    expect(filters).toHaveLength(2)

    const fluteFilter = filters.find((f) => f.field === "fluteCount")
    expect(fluteFilter).toBeDefined()
    expect(fluteFilter!.rawValue).toBe(4)
    expect(fluteFilter!.op).toBe("eq")

    const coatingFilter = filters.find((f) => f.field === "coating")
    expect(coatingFilter).toBeDefined()
    expect(coatingFilter!.rawValue).toBe("AlTiN")
    expect(coatingFilter!.op).toBe("includes")
  })

  it("returns empty filters when no refinements present", () => {
    const state = makeState({
      constraints: { base: {}, refinements: {} },
    })

    const { filters } = constraintsToFilters(state)
    expect(filters).toHaveLength(0)
  })
})

describe("scoredProductToCandidateRef", () => {
  it("converts ScoredProduct to CandidateRef correctly", () => {
    const scored = makeScoredProduct()
    const ref = scoredProductToCandidateRef(scored, 1)

    expect(ref.productCode).toBe("TEST001")
    expect(ref.displayCode).toBe("TEST-001")
    expect(ref.rank).toBe(1)
    expect(ref.score).toBe(85)
    expect(ref.seriesName).toBe("V7 Plus A")
  })

  it("preserves rank ordering", () => {
    const scored = makeScoredProduct()
    const ref1 = scoredProductToCandidateRef(scored, 1)
    const ref2 = scoredProductToCandidateRef(scored, 5)

    expect(ref1.rank).toBe(1)
    expect(ref2.rank).toBe(5)
  })
})

describe("buildResultContext", () => {
  it("builds ResultContext with correct structure", () => {
    const candidates = [
      makeScoredProduct({ score: 90 }),
      makeScoredProduct({ score: 70 }),
    ]
    const state = makeState({
      constraints: { base: { material: "steel" }, refinements: {} },
    })

    const ctx = buildResultContext(candidates, state)

    expect(ctx.candidates).toHaveLength(2)
    expect(ctx.totalConsidered).toBe(2)
    expect(ctx.searchTimestamp).toBeGreaterThan(0)
    expect(ctx.constraintsUsed.base.material).toBe("steel")
  })
})

describe("shouldSearch", () => {
  it("returns true for show_recommendation", () => {
    expect(shouldSearch(makeDecision("show_recommendation"))).toBe(true)
  })

  it("returns true for replace_slot", () => {
    expect(shouldSearch(makeDecision("replace_slot"))).toBe(true)
  })

  it("returns true for continue_narrowing", () => {
    expect(shouldSearch(makeDecision("continue_narrowing"))).toBe(true)
  })

  it("returns true when needsGroundedFact is true", () => {
    expect(shouldSearch(makeDecision("answer_general", true))).toBe(true)
  })

  it("returns false for answer_general without grounded fact", () => {
    expect(shouldSearch(makeDecision("answer_general"))).toBe(false)
  })

  it("returns false for redirect_off_topic", () => {
    expect(shouldSearch(makeDecision("redirect_off_topic"))).toBe(false)
  })

  it("returns false for reset_session", () => {
    expect(shouldSearch(makeDecision("reset_session"))).toBe(false)
  })

  it("returns false for skip_field", () => {
    expect(shouldSearch(makeDecision("skip_field"))).toBe(false)
  })
})
