/**
 * serve-engine-stock — stock filtering logic unit tests
 *
 * Tests the filtering logic from handleFilterByStock without
 * calling the actual handler (which needs full context/deps).
 * We extract and test the pure filtering logic directly.
 */

import { describe, it, expect } from "vitest"

// ── Replicate the pure filtering logic from handleFilterByStock ──

interface CandidateSnapshot {
  displayCode: string
  totalStock: number | null
  stockStatus: "instock" | "limited" | "outofstock" | "unknown"
}

function filterByStock(
  prevCandidates: CandidateSnapshot[],
  stockFilter: string,
  stockThreshold: number | null,
): CandidateSnapshot[] {
  if (stockThreshold != null && stockThreshold > 0) {
    return prevCandidates.filter(c => (c.totalStock ?? 0) >= stockThreshold)
  } else if (stockFilter === "instock") {
    return prevCandidates.filter(c => (c.totalStock ?? 0) > 0)
  } else if (stockFilter === "limited") {
    return prevCandidates.filter(c => c.stockStatus === "instock" || c.stockStatus === "limited")
  } else {
    return prevCandidates // "all" = no filter
  }
}

function buildStockLabel(stockFilter: string, stockThreshold: number | null): string {
  if (stockThreshold != null) return `재고 ${stockThreshold}개 이상인`
  if (stockFilter === "instock") return "재고 있는"
  if (stockFilter === "limited") return "재고 제한적 이상인"
  return "전체"
}

function buildStockChips(filteredCount: number, totalCount: number): string[] {
  const chips = ["⟵ 이전 단계", "처음부터 다시"]
  if (filteredCount < totalCount) {
    chips.unshift(`전체 ${totalCount}개 보기`)
  }
  return chips
}

function buildNoStockChips(totalCount: number): string[] {
  const chips = ["⟵ 이전 단계", "처음부터 다시"]
  if (totalCount > 0) {
    chips.unshift(`전체 ${totalCount}개 보기`)
  }
  return chips
}

// ── Test data ───────────────────────────────────────────────────

const candidates: CandidateSnapshot[] = [
  { displayCode: "A001", totalStock: 100, stockStatus: "instock" },
  { displayCode: "A002", totalStock: 5,   stockStatus: "limited" },
  { displayCode: "A003", totalStock: 0,   stockStatus: "outofstock" },
  { displayCode: "A004", totalStock: null, stockStatus: "unknown" },
  { displayCode: "A005", totalStock: 50,  stockStatus: "instock" },
]

// ── Tests ───────────────────────────────────────────────────────

describe("filterByStock: threshold mode", () => {
  it("filters by numeric threshold >= 50", () => {
    const result = filterByStock(candidates, "instock", 50)
    expect(result.map(c => c.displayCode)).toEqual(["A001", "A005"])
  })

  it("threshold = 1 filters out zero and null stock", () => {
    const result = filterByStock(candidates, "instock", 1)
    expect(result.map(c => c.displayCode)).toEqual(["A001", "A002", "A005"])
  })

  it("threshold = 200 returns empty when no candidate matches", () => {
    const result = filterByStock(candidates, "instock", 200)
    expect(result).toEqual([])
  })
})

describe("filterByStock: instock mode", () => {
  it("returns candidates with totalStock > 0", () => {
    const result = filterByStock(candidates, "instock", null)
    expect(result.map(c => c.displayCode)).toEqual(["A001", "A002", "A005"])
  })

  it("treats null totalStock as 0 (excluded)", () => {
    const result = filterByStock(candidates, "instock", null)
    expect(result.find(c => c.displayCode === "A004")).toBeUndefined()
  })
})

describe("filterByStock: limited mode", () => {
  it("returns instock + limited candidates", () => {
    const result = filterByStock(candidates, "limited", null)
    expect(result.map(c => c.displayCode)).toEqual(["A001", "A002", "A005"])
  })

  it("excludes outofstock and unknown", () => {
    const result = filterByStock(candidates, "limited", null)
    expect(result.find(c => c.stockStatus === "outofstock")).toBeUndefined()
    expect(result.find(c => c.stockStatus === "unknown")).toBeUndefined()
  })
})

describe("filterByStock: all mode", () => {
  it("returns all candidates unchanged", () => {
    const result = filterByStock(candidates, "all", null)
    expect(result).toHaveLength(5)
  })
})

describe("buildStockLabel", () => {
  it("returns threshold label", () => {
    expect(buildStockLabel("instock", 50)).toBe("재고 50개 이상인")
  })

  it("returns instock label", () => {
    expect(buildStockLabel("instock", null)).toBe("재고 있는")
  })

  it("returns limited label", () => {
    expect(buildStockLabel("limited", null)).toBe("재고 제한적 이상인")
  })

  it("returns all label", () => {
    expect(buildStockLabel("all", null)).toBe("전체")
  })
})

describe("buildStockChips", () => {
  it("includes '전체 N개 보기' when filtered < total", () => {
    const chips = buildStockChips(3, 5)
    expect(chips[0]).toBe("전체 5개 보기")
    expect(chips).toContain("⟵ 이전 단계")
  })

  it("omits '전체 N개 보기' when filtered == total", () => {
    const chips = buildStockChips(5, 5)
    expect(chips).toEqual(["⟵ 이전 단계", "처음부터 다시"])
  })
})

describe("buildNoStockChips", () => {
  it("includes '전체 N개 보기' when total > 0", () => {
    const chips = buildNoStockChips(5)
    expect(chips[0]).toBe("전체 5개 보기")
  })

  it("omits '전체 N개 보기' when total is 0", () => {
    const chips = buildNoStockChips(0)
    expect(chips).toEqual(["⟵ 이전 단계", "처음부터 다시"])
  })
})

describe("filterByStock: edge cases", () => {
  it("handles empty candidates array", () => {
    expect(filterByStock([], "instock", null)).toEqual([])
    expect(filterByStock([], "instock", 10)).toEqual([])
  })

  it("all-null-stock candidates filtered by instock returns empty", () => {
    const nullCandidates = [
      { displayCode: "X1", totalStock: null, stockStatus: "unknown" as const },
      { displayCode: "X2", totalStock: null, stockStatus: "unknown" as const },
    ]
    expect(filterByStock(nullCandidates, "instock", null)).toEqual([])
  })

  it("threshold 0 is not treated as threshold mode (falls through)", () => {
    // stockThreshold=0 => condition `stockThreshold > 0` is false => goes to stockFilter branch
    const result = filterByStock(candidates, "all", 0)
    expect(result).toHaveLength(5)
  })
})
