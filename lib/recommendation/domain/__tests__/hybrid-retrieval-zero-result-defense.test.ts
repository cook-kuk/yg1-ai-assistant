/**
 * Tests for zero-result defense in hybrid retrieval.
 *
 * Feedback-derived: condition combos like "Milling + 10mm + M + Trochoidal"
 * return 0 from DB because Trochoidal shape is rare. The fallback should
 * retry without operationType and return candidates.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import type { CanonicalProduct } from "@/lib/types/canonical"
import type { RecommendationInput } from "@/lib/recommendation/domain/types"

const millingProduct = {
  id: "test-1",
  manufacturer: "YG-1",
  brand: "YG-1",
  sourcePriority: 2,
  sourceType: "catalog-csv",
  rawSourceFile: "test.csv",
  rawSourceSheet: null,
  normalizedCode: "MILL001",
  displayCode: "MILL-001",
  seriesName: "TEST",
  productName: "Test Endmill",
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
  materialTags: ["M"],
  country: null,
  description: null,
  featureText: null,
  seriesIconUrl: null,
  sourceConfidence: "high",
  dataCompletenessScore: 0.8,
  evidenceRefs: [],
} satisfies CanonicalProduct

let searchCallCount = 0
const searchMock = vi.fn(async () => {
  searchCallCount++
  // First call: operationType=Trochoidal → 0 results
  // Second call: no operationType → products found
  if (searchCallCount === 1) return []
  return [millingProduct]
})

vi.mock("@/lib/recommendation/infrastructure/repositories/recommendation-repositories", () => ({
  ProductRepo: {
    search: (...args: unknown[]) => searchMock(...args),
    searchPage: vi.fn(async () => ({ products: [], totalCount: 0 })),
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

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

beforeEach(() => {
  searchCallCount = 0
  searchMock.mockClear()
})

describe("hybrid-retrieval zero-result defense", () => {
  it("retries without operationType when Trochoidal produces 0 results", async () => {
    const input = makeInput({
      machiningCategory: "Milling",
      diameterMm: 10,
      material: "스테인리스",
      operationType: "Trochoidal",
    })

    const result = await runHybridRetrieval(input, [])

    // Should have called search twice: once with Trochoidal, once without
    expect(searchMock).toHaveBeenCalledTimes(2)
    // Second call should have operationType undefined
    const secondCallInput = searchMock.mock.calls[1][0] as RecommendationInput
    expect(secondCallInput.operationType).toBeUndefined()
    // Should return candidates from the retry
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates[0].product.normalizedCode).toBe("MILL001")
  })

  it("does not retry when operationType is not set", async () => {
    searchCallCount = 1 // skip the "return empty" first call
    const input = makeInput({
      machiningCategory: "Milling",
      diameterMm: 10,
    })

    await runHybridRetrieval(input, [])

    expect(searchMock).toHaveBeenCalledTimes(1)
  })

  it("does not retry when first search returns results", async () => {
    searchCallCount = 1 // return products on first call
    const input = makeInput({
      machiningCategory: "Milling",
      diameterMm: 10,
      operationType: "Trochoidal",
    })

    const result = await runHybridRetrieval(input, [])

    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(result.candidates.length).toBeGreaterThan(0)
  })

  it("strips skip and empty-field filters before any processing", async () => {
    searchCallCount = 1 // return products
    const input = makeInput({ machiningCategory: "Milling" })
    const filters = [
      { field: "", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 0 },
      { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 1 },
    ] as any[]

    const result = await runHybridRetrieval(input, filters)

    // Should not crash and should return results
    expect(result.candidates.length).toBeGreaterThan(0)
    // The skip filter should have been stripped
    expect(result.filtersApplied.some(f => f.op === "skip")).toBe(false)
  })
})
