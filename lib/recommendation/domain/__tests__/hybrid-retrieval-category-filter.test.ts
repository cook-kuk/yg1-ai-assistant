/**
 * Tests for machining-category cross-contamination filter in hybrid retrieval.
 *
 * Bug scenario: "Milling + 10mm" pulls TAP products (Threading) via ±2mm
 * diameter range, causing "Spiral Flute" (TAP subtype) chips to appear.
 *
 * The fix: post-filter excludes products whose applicationShapes don't
 * contain any shapes matching the user's machiningCategory.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"

// We test the exported helper indirectly via runHybridRetrieval,
// but we can also unit-test the shape-matching logic by importing internals.
// Since productMatchesMachiningCategory is not exported, we test through
// the full pipeline with mocked repos.

import type { CanonicalProduct } from "@/lib/types/canonical"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

// ── Mock repos before importing the module under test ──────────
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

import { runHybridRetrieval } from "@/lib/recommendation/domain/hybrid-retrieval"

// ── Helpers ─────────────────────────────────────────────────────
function makeProduct(overrides: Partial<CanonicalProduct>): CanonicalProduct {
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
    seriesName: "TEST",
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
    ...overrides,
  }
}

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    diameterMm: 10,
    machiningCategory: "Milling",
    ...overrides,
  } as RecommendationInput
}

beforeEach(() => {
  mockProducts.length = 0
})

describe("hybrid-retrieval machining category filter", () => {
  it("excludes Threading-only products when machiningCategory is Milling", async () => {
    const millingProduct = makeProduct({
      normalizedCode: "MILL001",
      displayCode: "MILL-001",
      toolSubtype: "Square",
      diameterMm: 10,
      applicationShapes: ["Side_Milling", "Slotting"],
    })
    const tapProduct = makeProduct({
      normalizedCode: "TAP001",
      displayCode: "TZ933-001",
      toolSubtype: "Spiral Flute",
      diameterMm: 10,
      applicationShapes: ["Threading_Blind", "Threading_Through"],
    })

    mockProducts.push(millingProduct, tapProduct)

    const result = await runHybridRetrieval(makeInput(), [])

    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("MILL001")
    expect(codes).not.toContain("TAP001")
  })

  it("excludes Holemaking-only products when machiningCategory is Milling", async () => {
    const millingProduct = makeProduct({
      normalizedCode: "MILL002",
      displayCode: "MILL-002",
      toolSubtype: "Square",
      diameterMm: 10,
      applicationShapes: ["Facing", "Profiling"],
    })
    const drillProduct = makeProduct({
      normalizedCode: "DRILL001",
      displayCode: "DRILL-001",
      toolSubtype: "Twist Drill",
      diameterMm: 10,
      applicationShapes: ["Drilling"],
    })

    mockProducts.push(millingProduct, drillProduct)

    const result = await runHybridRetrieval(makeInput(), [])

    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("MILL002")
    expect(codes).not.toContain("DRILL001")
  })

  it("keeps products with no applicationShapes (unknown category)", async () => {
    const millingProduct = makeProduct({
      normalizedCode: "MILL003",
      displayCode: "MILL-003",
      diameterMm: 10,
      applicationShapes: ["Side_Milling"],
    })
    const unknownProduct = makeProduct({
      normalizedCode: "UNK001",
      displayCode: "UNK-001",
      diameterMm: 10,
      applicationShapes: [],
    })

    mockProducts.push(millingProduct, unknownProduct)

    const result = await runHybridRetrieval(makeInput(), [])

    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("MILL003")
    expect(codes).toContain("UNK001")
  })

  it("keeps mixed-category products that include at least one Milling shape", async () => {
    const mixedProduct = makeProduct({
      normalizedCode: "MIX001",
      displayCode: "MIX-001",
      diameterMm: 10,
      applicationShapes: ["Side_Milling", "Threading_Blind"],
    })

    mockProducts.push(mixedProduct)

    const result = await runHybridRetrieval(makeInput(), [])

    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("MIX001")
  })

  it("does not filter by category when machiningCategory is not set", async () => {
    const tapProduct = makeProduct({
      normalizedCode: "TAP002",
      displayCode: "TZ903-001",
      toolSubtype: "Spiral Flute",
      diameterMm: 10,
      applicationShapes: ["Threading_Blind"],
    })

    mockProducts.push(tapProduct)

    const result = await runHybridRetrieval(
      makeInput({ machiningCategory: undefined }),
      [],
    )

    const codes = result.candidates.map(c => c.product.normalizedCode)
    expect(codes).toContain("TAP002")
  })
})
