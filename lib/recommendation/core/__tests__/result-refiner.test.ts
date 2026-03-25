import { describe, it, expect } from "vitest"
import {
  refineResults,
  buildRefinementOptions,
  computeDistribution,
} from "../result-refiner"
import type { ResultContext, CandidateRef } from "../types"

// ── Helpers ──

function makeCandidate(overrides: Partial<CandidateRef> = {}): CandidateRef {
  return {
    productCode: "TEST001",
    displayCode: "TEST-001",
    rank: 1,
    score: 85,
    seriesName: "V7 Plus A",
    keySpecs: {
      flute: 4,
      coating: "AlTiN",
      hasInventory: true,
    },
    ...overrides,
  }
}

function makeResultContext(candidates: CandidateRef[]): ResultContext {
  return {
    candidates,
    totalConsidered: candidates.length,
    searchTimestamp: Date.now(),
    constraintsUsed: { base: { material: "steel" }, refinements: {} },
  }
}

// ── Tests ──

describe("refineResults", () => {
  it("filters by flute count", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A3", keySpecs: { flute: 4, coating: "TiN", hasInventory: false } }),
      makeCandidate({ productCode: "A4", keySpecs: { flute: 6, coating: "AlTiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "fluteCount", "4")

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every(c => c.keySpecs?.flute === 4)).toBe(true)
  })

  it("filters by flute count with Korean suffix (4날)", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "flute", "4날")

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].keySpecs?.flute).toBe(4)
  })

  it("filters by coating", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
      makeCandidate({ productCode: "A3", keySpecs: { flute: 2, coating: "AlTiN", hasInventory: false } }),
    ])

    const result = refineResults(ctx, "coating", "AlTiN")

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every(c => c.keySpecs?.coating?.includes("AlTiN"))).toBe(true)
  })

  it("filters by coating case-insensitively", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "coating", "altin")

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].productCode).toBe("A1")
  })

  it("filters by stock (hasInventory)", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "TiN", hasInventory: false } }),
      makeCandidate({ productCode: "A3", keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "stock")

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.every(c => c.keySpecs?.hasInventory === true)).toBe(true)
  })

  it("recomputes ranks after filtering", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", rank: 1, keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", rank: 2, keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A3", rank: 3, keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "fluteCount", "4")

    expect(result.candidates[0].rank).toBe(1)
    expect(result.candidates[1].rank).toBe(2)
  })

  it("returns all candidates when no value for non-stock field", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1" }),
      makeCandidate({ productCode: "A2" }),
      makeCandidate({ productCode: "A3" }),
    ])

    const result = refineResults(ctx, "fluteCount")

    expect(result.candidates).toHaveLength(3)
  })

  it("preserves totalConsidered from original context", () => {
    const ctx = makeResultContext([
      makeCandidate({ productCode: "A1", keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ productCode: "A2", keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
    ])

    const result = refineResults(ctx, "fluteCount", "4")

    expect(result.candidates).toHaveLength(1)
    expect(result.totalConsidered).toBe(2) // original count preserved
  })
})

describe("computeDistribution", () => {
  it("computes flute distribution correctly", () => {
    const candidates = [
      makeCandidate({ keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 6, coating: "AlTiN", hasInventory: true } }),
    ]

    const dist = computeDistribution(candidates, "flute")

    expect(dist).toHaveLength(3)
    // Sorted by count descending
    expect(dist[0]).toEqual({ key: "4날", count: 2 })
    expect(dist.find(d => d.key === "2날")?.count).toBe(1)
    expect(dist.find(d => d.key === "6날")?.count).toBe(1)
  })

  it("computes coating distribution correctly", () => {
    const candidates = [
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
    ]

    const dist = computeDistribution(candidates, "coating")

    expect(dist).toHaveLength(2)
    expect(dist[0]).toEqual({ key: "AlTiN", count: 2 })
    expect(dist[1]).toEqual({ key: "TiN", count: 1 })
  })

  it("handles candidates without keySpecs", () => {
    const candidates = [
      makeCandidate({ keySpecs: undefined }),
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
    ]

    const dist = computeDistribution(candidates, "flute")

    expect(dist).toHaveLength(1)
    expect(dist[0]).toEqual({ key: "4날", count: 1 })
  })
})

describe("buildRefinementOptions", () => {
  it("returns correct format for flute options", () => {
    const ctx = makeResultContext([
      makeCandidate({ keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
    ])

    const options = buildRefinementOptions(ctx, "flute")

    expect(options).toHaveLength(2)
    expect(options[0]).toEqual({ label: "4날 (2개)", value: "4날", count: 2 })
    expect(options[1]).toEqual({ label: "2날 (1개)", value: "2날", count: 1 })
  })

  it("returns empty array when no candidates have specs", () => {
    const ctx = makeResultContext([
      makeCandidate({ keySpecs: undefined }),
    ])

    const options = buildRefinementOptions(ctx, "flute")

    expect(options).toHaveLength(0)
  })

  it("returns coating options correctly", () => {
    const ctx = makeResultContext([
      makeCandidate({ keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      makeCandidate({ keySpecs: { flute: 4, coating: "TiN", hasInventory: true } }),
    ])

    const options = buildRefinementOptions(ctx, "coating")

    expect(options).toHaveLength(2)
    expect(options.every(o => o.count > 0)).toBe(true)
    expect(options.every(o => o.label.includes("개)"))).toBe(true)
  })
})
