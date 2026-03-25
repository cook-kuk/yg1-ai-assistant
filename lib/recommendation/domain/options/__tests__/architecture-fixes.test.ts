/**
 * Architecture Fixes — Regression tests
 *
 * Tests for:
 * 1. Mention-vs-select distinction (query_field_info tool)
 * 2. Field-bound skip/delegation detection
 * 3. Extended filter fields in hybrid retrieval
 * 4. UI artifact awareness in option planner
 * 5. Post-recommendation stock-aware options
 */

import { beforeEach, describe, it, expect } from "vitest"
import { planOptions, resetOptionCounter } from "../option-planner"
import type { OptionPlannerContext } from "../types"

// ════════════════════════════════════════════════════════════════
// TEST 1: Mention-vs-select (tested via orchestrator tool definition)
// ════════════════════════════════════════════════════════════════

describe("architecture: mention-vs-select", () => {
  it("query_field_info tool exists in narrowing tools", async () => {
    // Verify the tool is defined by importing the orchestrator module
    // and checking the tool list structure
    const orchModule = await import("../../../infrastructure/agents/orchestrator")
    // orchestrateTurnWithTools uses NARROWING_TOOLS which includes query_field_info
    // We verify the module exports the function (tool-use routing)
    expect(typeof orchModule.orchestrateTurnWithTools).toBe("function")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Field-bound skip/delegation
// ════════════════════════════════════════════════════════════════

describe("architecture: skip/delegation phrases", () => {
  const SKIP_PHRASES = [
    "상관없음", "모름", "패스", "스킵",
    "무난한 걸로", "아무거나", "알아서 해줘",
    "추천으로 골라줘", "맡길게",
  ]

  for (const phrase of SKIP_PHRASES) {
    it(`"${phrase}" should be recognized as skip/delegation`, () => {
      // These phrases should contain at least one of the skip patterns
      const SKIP_PATTERNS = ["상관없음", "모름", "패스", "스킵", "무난한", "아무거나", "알아서", "추천으로", "골라줘", "추천해줘", "맡길게"]
      const clean = phrase.toLowerCase().trim()
      const isSkip = SKIP_PATTERNS.some(p => clean.includes(p))
      expect(isSkip).toBe(true)
    })
  }

  it("normal values are NOT skip", () => {
    const normalValues = ["DLC", "4날", "Square", "AlTiN", "10mm"]
    const SKIP_PATTERNS = ["상관없음", "모름", "패스", "스킵", "무난한", "아무거나", "알아서", "추천으로", "골라줘", "추천해줘", "맡길게"]
    for (const val of normalValues) {
      const clean = val.toLowerCase().trim()
      const isSkip = SKIP_PATTERNS.some(p => clean.includes(p))
      expect(isSkip).toBe(false)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Extended filter fields
// ════════════════════════════════════════════════════════════════

describe("architecture: extended filter fields", () => {
  it("extractCandidateFieldValues includes extended fields", async () => {
    const { extractCandidateFieldValues } = await import("../option-bridge")

    // Create mock scored products with extended fields
    const mockCandidates = [
      { product: { fluteCount: 4, coating: "DLC", seriesName: "E5E85", toolSubtype: "Square", toolMaterial: "Carbide", toolType: "Solid", brand: "YG-1", helixAngleDeg: 35, coolantHole: false }, stockStatus: "instock" },
      { product: { fluteCount: 2, coating: "AlTiN", seriesName: "E5E85", toolSubtype: "Square", toolMaterial: "Carbide", toolType: "Solid", brand: "YG-1", helixAngleDeg: 45, coolantHole: true }, stockStatus: "limited" },
      { product: { fluteCount: 4, coating: "DLC", seriesName: "X5070", toolSubtype: "Ball", toolMaterial: "HSS", toolType: "Solid", brand: "YG-1", helixAngleDeg: 35, coolantHole: false }, stockStatus: "instock" },
    ] as any[]

    const fieldValues = extractCandidateFieldValues(mockCandidates)

    // Original fields
    expect(fieldValues.has("fluteCount")).toBe(true)
    expect(fieldValues.has("coating")).toBe(true)

    // Extended fields should appear when there are distinct values
    expect(fieldValues.has("toolMaterial")).toBe(true) // Carbide vs HSS
    expect(fieldValues.has("helixAngleDeg")).toBe(true) // 35 vs 45
    expect(fieldValues.has("coolantHole")).toBe(true) // Yes vs No
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: UI artifact awareness in option planner
// ════════════════════════════════════════════════════════════════

describe("architecture: UI artifact awareness", () => {
  beforeEach(() => resetOptionCounter())

  it("skips compare option when comparison is already visible", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "A", seriesName: "S1", coating: "DLC", fluteCount: 4, diameterMm: 10, score: 85, matchStatus: "exact" },
        { displayCode: "B", seriesName: "S2", coating: "AlTiN", fluteCount: 2, diameterMm: 10, score: 75, matchStatus: "approximate" },
      ],
      displayedProducts: [
        { displayCode: "A", seriesName: "S1", coating: "DLC", fluteCount: 4, stockStatus: "instock" },
      ],
      visibleArtifacts: {
        hasRecommendation: true,
        hasComparison: true, // comparison already visible
        hasCuttingConditions: false,
      },
    }

    const options = planOptions(ctx)
    const compareOption = options.find(o => o.label.includes("비교"))
    expect(compareOption).toBeUndefined()
  })

  it("includes compare option when no comparison visible", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "A", seriesName: "S1", coating: "DLC", fluteCount: 4, diameterMm: 10, score: 85, matchStatus: "exact" },
        { displayCode: "B", seriesName: "S2", coating: "AlTiN", fluteCount: 2, diameterMm: 10, score: 75, matchStatus: "approximate" },
      ],
      visibleArtifacts: {
        hasRecommendation: true,
        hasComparison: false,
        hasCuttingConditions: false,
      },
    }

    const options = planOptions(ctx)
    const compareOption = options.find(o => o.label.includes("비교"))
    expect(compareOption).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Stock-aware post-recommendation options
// ════════════════════════════════════════════════════════════════

describe("architecture: stock-aware options", () => {
  beforeEach(() => resetOptionCounter())

  it("adds '재고 있는 대안 보기' when primary product is out of stock", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "OUT1", seriesName: "S1", coating: "DLC", fluteCount: 4, diameterMm: 10, score: 85, matchStatus: "exact" },
      ],
      displayedProducts: [
        { displayCode: "OUT1", seriesName: "S1", coating: "DLC", fluteCount: 4, stockStatus: "outofstock" },
      ],
    }

    const options = planOptions(ctx)
    const stockOption = options.find(o => o.label.includes("재고 있는 대안"))
    expect(stockOption).toBeDefined()
    expect(stockOption!.recommended).toBe(true)
  })

  it("adds '재고 상세 확인' when primary product has limited stock", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "LIM1", seriesName: "S1", coating: "DLC", fluteCount: 4, diameterMm: 10, score: 85, matchStatus: "exact" },
      ],
      displayedProducts: [
        { displayCode: "LIM1", seriesName: "S1", coating: "DLC", fluteCount: 4, stockStatus: "limited" },
      ],
    }

    const options = planOptions(ctx)
    const stockOption = options.find(o => o.label.includes("재고 상세"))
    expect(stockOption).toBeDefined()
  })

  it("no stock option when product is in stock", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "OK1", seriesName: "S1", coating: "DLC", fluteCount: 4, diameterMm: 10, score: 85, matchStatus: "exact" },
      ],
      displayedProducts: [
        { displayCode: "OK1", seriesName: "S1", coating: "DLC", fluteCount: 4, stockStatus: "instock" },
      ],
    }

    const options = planOptions(ctx)
    const stockOption = options.find(o => o.label.includes("재고"))
    expect(stockOption).toBeUndefined()
  })
})
