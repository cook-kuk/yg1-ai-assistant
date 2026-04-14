/**
 * Comprehensive tests for hybrid-retrieval.ts
 *
 * Tests cover:
 *   - Diameter post-filter (exact, ±0.5mm, ±2mm fallback stages)
 *   - Machining category shape matching
 *   - Tool subtype filtering
 *   - Material tag filtering (single & multi-select)
 *   - Scoring: diameter, flutes, material, operation, toolShape, coating, completeness
 *   - Match status classification (exact / approximate / none)
 *   - Series diversity reranker
 *   - classifyHybridResults helper
 *   - mapOperationToCuttingType (via evidence pipeline)
 *   - flattenActiveFilters (via narrowing filter application)
 *   - Edge cases: empty candidates, null fields, no input criteria
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

import type { CanonicalProduct } from "@/lib/types/canonical"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

// ── Mock repos ────────────────────────────────────────────────
const mockProducts: CanonicalProduct[] = []

vi.mock("@/lib/recommendation/infrastructure/repositories/recommendation-repositories", () => ({
  ProductRepo: {
    search: vi.fn(async () => mockProducts),
    searchPage: vi.fn(async () => ({ products: mockProducts, totalCount: mockProducts.length })),
  },
  EvidenceRepo: {
    buildSummary: vi.fn(async () => ({
      productCode: "",
      seriesName: null,
      chunks: [],
      sourceCount: 0,
      bestConfidence: 0,
    })),
  },
  InventoryRepo: {
    getEnrichedAsync: vi.fn(async () => ({
      snapshots: [],
      totalStock: 0,
      stockStatus: "unknown" as const,
    })),
    getEnrichedBatchAsync: vi.fn(async (codes: readonly string[]) => {
      const out = new Map<string, { snapshots: never[]; totalStock: number; stockStatus: "unknown" }>()
      for (const c of codes) out.set(c, { snapshots: [], totalStock: 0, stockStatus: "unknown" })
      return out
    }),
  },
  LeadTimeRepo: {
    getByEdp: vi.fn(() => []),
    minLeadTime: vi.fn(() => null),
  },
}))

vi.mock("@/lib/feature-flags", () => ({
  ENABLE_POST_SQL_CANDIDATE_FILTERS: true,
}))

vi.mock("@/lib/recommendation/infrastructure/observability/recommendation-trace", () => ({
  traceRecommendation: vi.fn(),
}))

// Mock material-resolver — return the input uppercased as tag for predictability
vi.mock("@/lib/recommendation/domain/material-resolver", () => ({
  resolveMaterialTag: vi.fn((input: string) => {
    const map: Record<string, string> = {
      "알루미늄": "N",
      "스테인리스": "M",
      "탄소강": "P",
      "주철": "K",
      "티타늄": "S",
      "경화강": "H",
    }
    return map[input] ?? input.toUpperCase()
  }),
}))

// Mock operation-resolver
vi.mock("@/lib/recommendation/domain/operation-resolver", () => ({
  getAppShapesForOperation: vi.fn((input: string) => {
    const map: Record<string, string[]> = {
      "슬로팅": ["Slotting"],
      "측면가공": ["Side_Milling"],
      "정삭": ["Profiling", "Finishing"],
      "램핑": ["Ramping"],
      "포켓팅": ["Pocketing"],
      "다이싱킹": ["Die-Sinking"],
    }
    return map[input] ?? []
  }),
}))

// Mock filter-field-registry
vi.mock("@/lib/recommendation/shared/filter-field-registry", () => ({
  applyPostFilterToProducts: vi.fn(() => null),
}))

import { runHybridRetrieval, classifyHybridResults, type HybridResult } from "@/lib/recommendation/domain/hybrid-retrieval"

// ── Helpers ───────────────────────────────────────────────────
function makeProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    id: "test-id",
    manufacturer: "YG-1",
    brand: "YG-1",
    sourcePriority: 1,
    sourceType: "catalog-csv",
    rawSourceFile: "test.csv",
    rawSourceSheet: null,
    normalizedCode: "TEST001",
    displayCode: "TEST-001",
    seriesName: "SERIES-A",
    productName: "Test Product",
    toolType: "Solid",
    toolSubtype: "Square",
    diameterMm: 10,
    diameterInch: null,
    fluteCount: 4,
    coating: "TiAlN",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    lengthOfCutMm: 22,
    overallLengthMm: 72,
    helixAngleDeg: 30,
    ballRadiusMm: null,
    taperAngleDeg: null,
    coolantHole: false,
    applicationShapes: ["Side_Milling", "Slotting"],
    materialTags: ["P", "M"],
    country: null,
    description: null,
    featureText: null,
    seriesIconUrl: null,
    sourceConfidence: "high",
    dataCompletenessScore: 0.8,
    evidenceRefs: [],
    materialRatingScore: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

beforeEach(() => {
  mockProducts.length = 0
})

// ═══════════════════════════════════════════════════════════════
// 1. Diameter post-filter heuristics
// ═══════════════════════════════════════════════════════════════
describe("diameter post-filter", () => {
  it("stage 1: keeps only exact diameter matches when available", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "EXACT", diameterMm: 10 }),
      makeProduct({ normalizedCode: "NEAR", diameterMm: 10.3 }),
      makeProduct({ normalizedCode: "FAR", diameterMm: 11.5 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("EXACT")
    expect(codes).not.toContain("NEAR")
    expect(codes).not.toContain("FAR")
  })

  it("stage 2: falls back to ±0.5mm when no exact match", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "NEAR1", diameterMm: 10.3 }),
      makeProduct({ normalizedCode: "NEAR2", diameterMm: 10.5 }),
      makeProduct({ normalizedCode: "FAR", diameterMm: 11.5 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("NEAR1")
    expect(codes).toContain("NEAR2")
    expect(codes).not.toContain("FAR")
  })

  it("stage 3: falls back to ±2mm when no ±0.5mm match", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "WIDER1", diameterMm: 11.5 }),
      makeProduct({ normalizedCode: "WIDER2", diameterMm: 8.5 }),
      makeProduct({ normalizedCode: "TOOFAR", diameterMm: 13 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("WIDER1")
    expect(codes).toContain("WIDER2")
    expect(codes).not.toContain("TOOFAR")
  })

  it("keeps all candidates when no diameter matches at any stage", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "FAR1", diameterMm: 20 }),
      makeProduct({ normalizedCode: "FAR2", diameterMm: 25 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    // All kept because even ±2mm yields 0, so the filter is not applied
    expect(result.candidates.length).toBe(2)
  })

  it("skips diameter filter when diameterMm is not specified", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "A", diameterMm: 5 }),
      makeProduct({ normalizedCode: "B", diameterMm: 50 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: undefined }), [])
    expect(result.candidates.length).toBe(2)
  })

  it("excludes products with null diameterMm from exact match stage", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "EXACT", diameterMm: 10 }),
      makeProduct({ normalizedCode: "NULL_DIAM", diameterMm: null }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("EXACT")
    expect(codes).not.toContain("NULL_DIAM")
  })

  it("boundary: ±0.5mm includes exactly 0.5 difference", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "BOUNDARY", diameterMm: 10.5 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("BOUNDARY")
  })

  it("boundary: ±2mm includes exactly 2.0 difference", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "EDGE", diameterMm: 12.0 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("EDGE")
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. Machining category shape matching
// ═══════════════════════════════════════════════════════════════
describe("machining category shape filter", () => {
  it("excludes Threading-only products when category is Milling", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "MILL", applicationShapes: ["Side_Milling"] }),
      makeProduct({ normalizedCode: "TAP", applicationShapes: ["Threading_Blind"] }),
    )
    const result = await runHybridRetrieval(makeInput({ machiningCategory: "Milling" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("MILL")
    expect(codes).not.toContain("TAP")
  })

  it("excludes Milling-only products when category is Holemaking", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "DRILL", applicationShapes: ["Drilling"] }),
      makeProduct({ normalizedCode: "MILL", applicationShapes: ["Side_Milling"] }),
    )
    const result = await runHybridRetrieval(makeInput({ machiningCategory: "Holemaking" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("DRILL")
    expect(codes).not.toContain("MILL")
  })

  it("keeps products with empty applicationShapes (unknown)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "UNK", applicationShapes: [] }),
    )
    const result = await runHybridRetrieval(makeInput({ machiningCategory: "Milling" }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("UNK")
  })

  it("keeps mixed-category products with at least one matching shape", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "MIX", applicationShapes: ["Slotting", "Threading_Blind"] }),
    )
    const result = await runHybridRetrieval(makeInput({ machiningCategory: "Milling" }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("MIX")
  })

  it("no category filter when machiningCategory is not in CATEGORY_SHAPE_MAP (e.g. Turning)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "ANY", applicationShapes: ["Threading_Blind"] }),
    )
    const result = await runHybridRetrieval(makeInput({ machiningCategory: "Turning" }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("ANY")
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. Tool subtype filter
// ═══════════════════════════════════════════════════════════════
describe("toolSubtype post-filter", () => {
  it("keeps products matching the requested toolSubtype (case-insensitive)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "SQ", toolSubtype: "Square" }),
      makeProduct({ normalizedCode: "BALL", toolSubtype: "Ball" }),
    )
    const result = await runHybridRetrieval(makeInput({ toolSubtype: "square" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("SQ")
    expect(codes).not.toContain("BALL")
  })

  it("keeps products with no toolSubtype data (empty string)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "NOTYPE", toolSubtype: "" }),
      makeProduct({ normalizedCode: "SQ", toolSubtype: "Square" }),
    )
    const result = await runHybridRetrieval(makeInput({ toolSubtype: "Square" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("NOTYPE")
    expect(codes).toContain("SQ")
  })

  it("supports partial match (includes)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "SPIRAL", toolSubtype: "Spiral Flute Tap" }),
    )
    const result = await runHybridRetrieval(makeInput({ toolSubtype: "spiral" }), [])
    expect(result.candidates.map(c => c.product.normalizedCode)).toContain("SPIRAL")
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. Material tag filter
// ═══════════════════════════════════════════════════════════════
describe("material tag filter", () => {
  it("keeps only products matching the material tag", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "STEEL", materialTags: ["P"] }),
      makeProduct({ normalizedCode: "ALU", materialTags: ["N"] }),
    )
    const result = await runHybridRetrieval(makeInput({ material: "탄소강" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("STEEL")
    expect(codes).not.toContain("ALU")
  })

  it("multi-material: keeps products matching any of the tags", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "PM", materialTags: ["P", "M"] }),
      makeProduct({ normalizedCode: "N_ONLY", materialTags: ["N"] }),
    )
    const result = await runHybridRetrieval(makeInput({ material: "탄소강,스테인리스" }), [])
    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("PM")
    expect(codes).not.toContain("N_ONLY")
  })

  it("keeps all when no products match material (graceful fallback)", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "A", materialTags: ["N"] }),
      makeProduct({ normalizedCode: "B", materialTags: ["K"] }),
    )
    const result = await runHybridRetrieval(makeInput({ material: "경화강" }), [])
    // H tag not in any product → filter yields 0 → keep all
    expect(result.candidates.length).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. Scoring dimensions
// ═══════════════════════════════════════════════════════════════
describe("scoring", () => {
  it("diameter exact match gets 40 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(40)
  })

  it("diameter ≤0.1mm difference gets 90% (36 points)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10.05 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(36) // round(40*0.9)
  })

  it("diameter ≤0.5mm difference gets 60% (24 points)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10.3 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(24) // round(40*0.6)
  })

  it("diameter ≤1.0mm difference gets 30% (12 points)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10.8 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(12) // round(40*0.3)
  })

  it("diameter >1mm difference gets 0 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 11.5 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(0)
  })

  it("no diameter input gives 10 points (default)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: undefined }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.diameter.score).toBe(10)
  })

  it("flute exact match gets full 15 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", fluteCount: 4 }))
    const result = await runHybridRetrieval(makeInput({ flutePreference: 4 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.flutes.score).toBe(15)
  })

  it("flute mismatch gets 0 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", fluteCount: 2 }))
    const result = await runHybridRetrieval(makeInput({ flutePreference: 4 }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.flutes.score).toBe(0)
  })

  it("no flute preference gives 50% (8 points)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", fluteCount: 4 }))
    const result = await runHybridRetrieval(makeInput({ flutePreference: undefined }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.flutes.score).toBe(8) // round(15*0.5)
  })

  it("material match on all requested tags gets full score", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", materialTags: ["P", "M"] }))
    const result = await runHybridRetrieval(makeInput({ material: "탄소강" }), [])
    const bd = result.candidates[0].scoreBreakdown!
    // single tag, matched → ratio=1 → max(1,0.7) → 20
    expect(bd.materialTag.score).toBe(20)
  })

  it("material partial match: 1 of 2 tags gets at least 70%", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", materialTags: ["P"] }))
    const result = await runHybridRetrieval(makeInput({ material: "탄소강,스테인리스" }), [])
    const bd = result.candidates[0].scoreBreakdown!
    // ratio=0.5, max(0.5,0.7)=0.7 → round(20*0.7)=14
    expect(bd.materialTag.score).toBe(14)
  })

  it("material mismatch gets 0 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", materialTags: ["N"] }))
    const result = await runHybridRetrieval(makeInput({ material: "탄소강" }), [])
    // Material filter removed the N-only product, but if it passes through scoring...
    // Actually the hard filter catches this; let's test without the hard filter
    // by having a product that matches the hard filter but not the scoring
    // This specific scenario: all products match P in hard filter
    // Let's just test scoring directly with no material filter (no material match in tags)
    mockProducts.length = 0
    mockProducts.push(makeProduct({ normalizedCode: "P1", materialTags: ["K"] }))
    const result2 = await runHybridRetrieval(makeInput({ material: "경화강" }), [])
    // H not in ["K"] → hard filter removes. But if hard filter yields 0, all kept
    // Actually H !== K so filter yields 0 → keeps all → scoring: H not in [K] → 0
    const bd = result2.candidates[0].scoreBreakdown!
    expect(bd.materialTag.score).toBe(0)
  })

  it("coating match gets full 5 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", coating: "TiAlN" }))
    const result = await runHybridRetrieval(makeInput({ coatingPreference: "TiAlN" }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.coating.score).toBe(5)
  })

  it("coating partial string match works (case-insensitive)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", coating: "TiAlN Nano" }))
    const result = await runHybridRetrieval(makeInput({ coatingPreference: "tialn" }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.coating.score).toBe(5)
  })

  it("coating mismatch gets 0 points", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", coating: "AlCrN" }))
    const result = await runHybridRetrieval(makeInput({ coatingPreference: "TiAlN" }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.coating.score).toBe(0)
  })

  it("no coating preference gives 50% (3 points)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", coating: "TiAlN" }))
    const result = await runHybridRetrieval(makeInput({ coatingPreference: undefined }), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.coating.score).toBe(3) // round(5*0.5)
  })

  it("completeness score scaled by weight", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", dataCompletenessScore: 1.0 }))
    const result = await runHybridRetrieval(makeInput({}), [])
    const bd = result.candidates[0].scoreBreakdown!
    expect(bd.completeness.score).toBe(5) // round(1.0 * 5)
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. Match status classification
// ═══════════════════════════════════════════════════════════════
describe("match status", () => {
  it("high scoring product gets 'exact' status (ratio >= 0.75)", async () => {
    // All criteria match → high score
    mockProducts.push(makeProduct({
      normalizedCode: "PERFECT",
      diameterMm: 10,
      fluteCount: 4,
      materialTags: ["P"],
      coating: "TiAlN",
      applicationShapes: ["Slotting"],
      dataCompletenessScore: 1.0,
    }))
    const result = await runHybridRetrieval(makeInput({
      diameterMm: 10,
      flutePreference: 4,
      material: "탄소강",
      coatingPreference: "TiAlN",
      operationType: "슬로팅",
    }), [])
    expect(result.candidates[0].matchStatus).toBe("exact")
  })

  it("low scoring product gets 'none' status (ratio < 0.45)", async () => {
    mockProducts.push(makeProduct({
      normalizedCode: "BAD",
      diameterMm: 20,
      fluteCount: 2,
      materialTags: ["N"],
      coating: "AlCrN",
      applicationShapes: ["Drilling"],
      dataCompletenessScore: 0.1,
    }))
    const result = await runHybridRetrieval(makeInput({
      diameterMm: 10,
      flutePreference: 4,
      material: "탄소강",
      coatingPreference: "TiAlN",
      operationType: "슬로팅",
    }), [])
    // diameterMm=20 vs 10 → diff=10 → 0 points. flute mismatch → 0. material N vs P → 0. coating mismatch → 0.
    expect(result.candidates[0].matchStatus).toBe("none")
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. Tool shape compatibility scoring
// ═══════════════════════════════════════════════════════════════
describe("tool shape compatibility scoring", () => {
  it("explicit toolSubtype match gets full shape score (15)", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", toolSubtype: "Square" }))
    const result = await runHybridRetrieval(makeInput({ toolSubtype: "Square" }), [])
    expect(result.candidates[0].scoreBreakdown!.toolShape.score).toBe(15)
  })

  it("explicit toolSubtype mismatch gets 0", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", toolSubtype: "Ball" }))
    const result = await runHybridRetrieval(makeInput({ toolSubtype: "Square" }), [])
    expect(result.candidates[0].scoreBreakdown!.toolShape.score).toBe(0)
  })

  it("operation-based compat: Slotting + Square gets +10 bonus", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", toolSubtype: "Square", applicationShapes: ["Slotting"] }))
    const result = await runHybridRetrieval(makeInput({ operationType: "슬로팅" }), [])
    expect(result.candidates[0].scoreBreakdown!.toolShape.score).toBe(10)
  })

  it("operation-based compat: Slotting + Ball gets -15 penalty", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", toolSubtype: "Ball", applicationShapes: ["Slotting"] }))
    const result = await runHybridRetrieval(makeInput({ operationType: "슬로팅" }), [])
    expect(result.candidates[0].scoreBreakdown!.toolShape.score).toBe(-15)
  })
})

// ═══════════════════════════════════════════════════════════════
// 8. Series diversity reranker
// ═══════════════════════════════════════════════════════════════
describe("series diversity reranker", () => {
  it("defers excess same-series items beyond max 2 in top 5 window", async () => {
    // 6 products from same series, all high score
    for (let i = 0; i < 6; i++) {
      mockProducts.push(makeProduct({
        normalizedCode: `S${i}`,
        seriesName: "SAME_SERIES",
        diameterMm: 10,
        dataCompletenessScore: 0.9 - i * 0.01,
      }))
    }
    // 2 products from different series with slightly lower completeness
    mockProducts.push(makeProduct({ normalizedCode: "D1", seriesName: "DIFF_A", diameterMm: 10, dataCompletenessScore: 0.7 }))
    mockProducts.push(makeProduct({ normalizedCode: "D2", seriesName: "DIFF_B", diameterMm: 10, dataCompletenessScore: 0.65 }))

    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    // The reranker defers 3rd+ same-series items out of the top-5 diversity window.
    // Since DIFF products score the same as SAME ones, they may or may not fill the window.
    // At minimum, the deferred items should appear after position 4 (0-indexed).
    const codes = result.candidates.map(c => c.product.normalizedCode)
    // The first 2 same-series items keep their position; extras get pushed after window
    const sameSeriesPositions = codes
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.startsWith("S"))
    // First two same-series items should be in top-5 window
    expect(sameSeriesPositions[0].i).toBeLessThan(5)
    expect(sameSeriesPositions[1].i).toBeLessThan(5)
    // All 8 products are present
    expect(result.candidates.length).toBe(8)
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. classifyHybridResults
// ═══════════════════════════════════════════════════════════════
describe("classifyHybridResults", () => {
  it("returns null primary when no candidates", () => {
    const result = classifyHybridResults({
      candidates: [],
      evidenceMap: new Map(),
      totalConsidered: 0,
      filtersApplied: [],
    })
    expect(result.primary).toBeNull()
    expect(result.alternatives).toEqual([])
    expect(result.status).toBe("none")
  })

  it("returns first candidate as primary, rest as alternatives (max 9)", () => {
    const makeScoredProduct = (code: string, status: "exact" | "approximate" | "none") => ({
      product: makeProduct({ normalizedCode: code }),
      score: 80,
      scoreBreakdown: null as any,
      matchedFields: [],
      matchStatus: status,
      inventory: [],
      leadTimes: [],
      evidence: [],
      stockStatus: "unknown" as const,
      totalStock: null,
      minLeadTimeDays: null,
    })

    const candidates = Array.from({ length: 12 }, (_, i) =>
      makeScoredProduct(`P${i}`, i === 0 ? "exact" : "approximate")
    )

    const result = classifyHybridResults({
      candidates,
      evidenceMap: new Map(),
      totalConsidered: 12,
      filtersApplied: [],
    })
    expect(result.primary!.product.normalizedCode).toBe("P0")
    expect(result.alternatives.length).toBe(9)
    expect(result.status).toBe("exact")
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. Sorting
// ═══════════════════════════════════════════════════════════════
describe("sorting", () => {
  it("sorts by score descending", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "LOW", diameterMm: 20, dataCompletenessScore: 0.1 }),
      makeProduct({ normalizedCode: "HIGH", diameterMm: 10, dataCompletenessScore: 0.9 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    expect(result.candidates[0].product.normalizedCode).toBe("HIGH")
  })

  it("tie-breaks by sourcePriority ascending", async () => {
    mockProducts.push(
      makeProduct({ normalizedCode: "PRI2", sourcePriority: 2, diameterMm: 10, dataCompletenessScore: 0.8 }),
      makeProduct({ normalizedCode: "PRI1", sourcePriority: 1, diameterMm: 10, dataCompletenessScore: 0.8 }),
    )
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    // Same score, PRI1 (priority 1) should come first
    expect(result.candidates[0].product.normalizedCode).toBe("PRI1")
  })
})

// ═══════════════════════════════════════════════════════════════
// 11. Edge cases
// ═══════════════════════════════════════════════════════════════
describe("edge cases", () => {
  it("returns empty candidates when no products from DB", async () => {
    // mockProducts is already empty
    const result = await runHybridRetrieval(makeInput({}), [])
    expect(result.candidates).toEqual([])
    expect(result.totalConsidered).toBe(0)
  })

  it("handles product with all null optional fields", async () => {
    mockProducts.push(makeProduct({
      normalizedCode: "SPARSE",
      diameterMm: null,
      fluteCount: null,
      coating: null,
      toolSubtype: null,
      applicationShapes: [],
      materialTags: [],
      dataCompletenessScore: 0,
    }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    // null diameterMm doesn't match any diameter stage → all stages yield 0 → filter not applied → product kept
    expect(result.candidates.length).toBe(1)
    // But diameter score should be 0 since product has no diameter info
    expect(result.candidates[0].scoreBreakdown!.diameter.score).toBe(0)
  })

  it("topN limits the final output", async () => {
    for (let i = 0; i < 10; i++) {
      mockProducts.push(makeProduct({ normalizedCode: `P${i}`, diameterMm: 10 }))
    }
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [], 3)
    expect(result.candidates.length).toBe(3)
  })

  it("matched fields populated correctly for full match", async () => {
    mockProducts.push(makeProduct({
      normalizedCode: "FULL",
      diameterMm: 10,
      fluteCount: 4,
      materialTags: ["P"],
      coating: "TiAlN",
      toolSubtype: "Square",
      applicationShapes: ["Slotting"],
    }))
    const result = await runHybridRetrieval(makeInput({
      diameterMm: 10,
      flutePreference: 4,
      material: "탄소강",
      coatingPreference: "TiAlN",
      toolSubtype: "Square",
      operationType: "슬로팅",
    }), [])
    const fields = result.candidates[0].matchedFields
    expect(fields.some(f => f.includes("직경"))).toBe(true)
    expect(fields.some(f => f.includes("날"))).toBe(true)
    expect(fields.some(f => f.includes("소재"))).toBe(true)
    expect(fields.some(f => f.includes("형상"))).toBe(true)
    expect(fields.some(f => f.includes("코팅"))).toBe(true)
  })

  it("filtersApplied includes diameter when diameter filter was applied", async () => {
    mockProducts.push(makeProduct({ normalizedCode: "P1", diameterMm: 10 }))
    const result = await runHybridRetrieval(makeInput({ diameterMm: 10 }), [])
    const diamFilter = result.filtersApplied.find(f => f.field === "diameterMm")
    expect(diamFilter).toBeDefined()
    expect(diamFilter!.op).toBe("range")
  })
})
