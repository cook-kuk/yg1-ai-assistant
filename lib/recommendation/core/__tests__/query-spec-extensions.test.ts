/**
 * Phase C+D: QuerySpec sort / tolerance / similarity extensions.
 *
 * - sort → ORDER BY <col> <dir>
 * - tolerance → eq rewritten as between
 * - similarTo → WITH ref CTE + SQRT distance + LIMIT
 */

import { describe, it, expect, vi } from "vitest"
import type { QuerySpec } from "../query-spec"
import { compileProductQuery } from "../compile-product-query"
import {
  querySpecToAppliedFilters,
  expandToleranceConstraint,
} from "../query-spec-to-filters"

// Mock schema cache so similarity distance range is deterministic.
vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    numericStats: {
      // range = 20 (max - min)
      search_diameter_mm: {
        min: 1, max: 21,
        percentiles: { p10: 2, p25: 4, p50: 8, p75: 12, p90: 16 },
      },
      "COALESCE(milling_overall_length, holemaking_overall_length, threading_overall_length, option_overall_length, option_oal)": {
        min: 0, max: 200,
        percentiles: { p10: 20, p25: 50, p50: 100, p75: 140, p90: 180 },
      },
    },
  }),
  getDbSchema: async () => ({ numericStats: {} }),
}))

// ── Sort ──────────────────────────────────────────────────────

describe("Phase C — sort", () => {
  it("asc sort on diameterMm appends ORDER BY with ASC direction", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      sort: { field: "diameterMm", direction: "asc" },
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toMatch(/ORDER BY .* ASC/)
    expect(out.sql).toContain("search_diameter_mm")
    expect(out.sql).not.toMatch(/ORDER BY edp_series_name/)
  })

  it("desc sort on overallLengthMm uses DESC and numericExpr", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      sort: { field: "overallLengthMm", direction: "desc" },
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toMatch(/ORDER BY .* DESC NULLS LAST/)
    expect(out.sql).toContain("milling_overall_length")
  })
})

// ── Tolerance ─────────────────────────────────────────────────

describe("Phase C — tolerance", () => {
  it("absolute tolerance rewrites eq 10 → between [9, 11]", () => {
    const rewritten = expandToleranceConstraint({
      field: "diameterMm",
      op: "eq",
      value: 10,
      tolerance: 1,
    })
    expect(rewritten.op).toBe("between")
    expect(rewritten.value).toEqual([9, 11])
  })

  it("ratio tolerance rewrites eq 10 (10%) → between [9, 11]", () => {
    const rewritten = expandToleranceConstraint({
      field: "diameterMm",
      op: "eq",
      value: 10,
      toleranceRatio: 0.1,
    })
    expect(rewritten.op).toBe("between")
    const [lo, hi] = rewritten.value as [number, number]
    expect(lo).toBeCloseTo(9, 10)
    expect(hi).toBeCloseTo(11, 10)
  })

  it("tolerance flows through compileProductQuery as BETWEEN", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10, tolerance: 1 }],
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toContain("BETWEEN")
    expect(out.params).toEqual([9, 11])
  })

  it("tolerance flows through querySpecToAppliedFilters as between", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10, tolerance: 1 }],
    }
    const filters = querySpecToAppliedFilters(spec, 0)
    expect(filters).toHaveLength(1)
    expect(filters[0].op).toBe("between")
    expect(filters[0].rawValue).toBe(9)
    expect(filters[0].rawValue2).toBe(11)
  })
})

// ── Similarity ────────────────────────────────────────────────

describe("Phase C — similarity", () => {
  it("similarTo without explicit fields uses default similarityComparable set", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      similarTo: { referenceProductId: "EDP-123", topK: 5 },
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toContain("WITH ref AS")
    expect(out.sql).toContain("edp_no =")
    expect(out.sql).toContain("SQRT(")
    expect(out.sql).toContain("_similarity_score")
    expect(out.sql).toMatch(/ORDER BY _similarity_score ASC/)
    expect(out.sql).toMatch(/LIMIT \$\d+/)
    expect(out.params).toContain("EDP-123")
    expect(out.params).toContain(5)
  })

  it("similarTo with explicit fields restricts the distance expression", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      similarTo: {
        referenceProductId: "EDP-999",
        fields: ["diameterMm"],
        topK: 3,
      },
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toContain("search_diameter_mm")
    // Only one POWER term when a single field is specified.
    const powerMatches = out.sql.match(/POWER\(/g) ?? []
    expect(powerMatches.length).toBe(1)
    expect(out.params).toContain("EDP-999")
    expect(out.params).toContain(3)
  })
})

// ── Combined / regression ────────────────────────────────────

describe("Phase C — combined + regression", () => {
  it("sort + filters compose together", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "gte", value: 5 }],
      sort: { field: "diameterMm", direction: "asc" },
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toContain("WHERE")
    expect(out.sql).toContain(">=")
    expect(out.sql).toMatch(/ORDER BY .* ASC/)
    expect(out.sql).toContain("search_diameter_mm")
  })

  it("absence of sort/similarTo/tolerance yields the legacy default ORDER BY", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 10 }],
    }
    const out = compileProductQuery(spec)
    expect(out.sql).toContain("ORDER BY edp_series_name, search_diameter_mm")
    expect(out.sql).not.toContain("_similarity_score")
    expect(out.sql).not.toContain("BETWEEN")
    expect(out.params).toEqual([10])
  })
})
