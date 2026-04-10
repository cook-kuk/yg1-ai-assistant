/**
 * Phase G — Dual-path executor tests.
 *
 * These tests verify the narrow, testable seam: `specNeedsCompiler` predicate
 * + `executeSpecViaCompiler` actually calling compileProductQuery against a
 * mocked DB pool and producing SQL with ORDER BY / similarity CTE.
 *
 * The full serve-engine-runtime.ts path is not unit-testable in isolation
 * (it's a 5k-line orchestration) — we test the seam, and a regression
 * integration test (kg-merge-integration.test.ts) covers the upstream merge.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { QuerySpec } from "../query-spec"

// Mock numeric stats cache for deterministic similarity distance.
vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    numericStats: {
      search_diameter_mm: { min: 1, max: 21, samples: [] },
    },
  }),
  getDbSchema: async () => ({ numericStats: {} }),
}))

// Capture SQL + params that executeCompiledProductQuery would run, and return
// an empty rowset so downstream code doesn't need a real schema.
const executeCalls: Array<{ sql: string; params: unknown[]; opLabel: string }> = []
vi.mock("@/lib/data/repos/product-db-source", () => ({
  executeCompiledProductQuery: vi.fn(async (sql: string, params: unknown[], opLabel: string) => {
    executeCalls.push({ sql, params, opLabel })
    return { products: [], rowCount: 0 }
  }),
}))

beforeEach(() => {
  executeCalls.length = 0
})

describe("specNeedsCompiler predicate", () => {
  it("returns false for plain constraint-only spec (legacy path is fine)", async () => {
    const { specNeedsCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 4 }],
    }
    expect(specNeedsCompiler(spec)).toBe(false)
  })

  it("returns false for eq + tolerance (legacy path handles it via expandToleranceConstraint)", async () => {
    const { specNeedsCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 4, tolerance: 0.5 }],
    }
    // Tolerance alone does NOT trigger the compiler path — querySpecToAppliedFilters
    // rewrites it into `between` which AppliedFilter[] supports natively.
    expect(specNeedsCompiler(spec)).toBe(false)
  })

  it("returns true when spec.sort is present", async () => {
    const { specNeedsCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      sort: { field: "diameterMm", direction: "asc" },
    }
    expect(specNeedsCompiler(spec)).toBe(true)
  })

  it("returns true when spec.similarTo is present", async () => {
    const { specNeedsCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      similarTo: { referenceProductId: "EDP_12345" },
    }
    expect(specNeedsCompiler(spec)).toBe(true)
  })

  it("returns false for null/undefined spec", async () => {
    const { specNeedsCompiler } = await import("../execute-spec-via-compiler")
    expect(specNeedsCompiler(null)).toBe(false)
    expect(specNeedsCompiler(undefined)).toBe(false)
  })
})

describe("executeSpecViaCompiler — SQL evidence", () => {
  it("'직경 작은 순으로' sort spec → executes SQL with ORDER BY ASC", async () => {
    const { executeSpecViaCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      sort: { field: "diameterMm", direction: "asc" },
    }
    const result = await executeSpecViaCompiler(spec)

    expect(executeCalls).toHaveLength(1)
    const call = executeCalls[0]
    expect(call.sql).toMatch(/ORDER BY\s+.*search_diameter_mm.*\s+ASC\s+NULLS LAST/i)
    expect(call.sql).toMatch(/FROM catalog_app\.product_recommendation_mv/)
    expect(result.mode).toBe("sort")
  })

  it("similarity spec → executes SQL with similarity CTE + _similarity_score ORDER BY", async () => {
    const { executeSpecViaCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
      similarTo: { referenceProductId: "EDP_ABC", topK: 5 },
    }
    const result = await executeSpecViaCompiler(spec)

    expect(executeCalls).toHaveLength(1)
    const call = executeCalls[0]
    expect(call.sql).toMatch(/WITH ref AS/)
    expect(call.sql).toMatch(/_similarity_score/)
    expect(call.sql).toMatch(/ORDER BY _similarity_score ASC NULLS LAST/)
    // reference product id + top-k are parameterized
    expect(call.params).toContain("EDP_ABC")
    expect(call.params).toContain(5)
    expect(result.mode).toBe("similarity")
  })

  it("sort spec with an equality constraint → emits WHERE + ORDER BY in the same SQL", async () => {
    const { executeSpecViaCompiler } = await import("../execute-spec-via-compiler")
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "toolFamily", op: "eq", value: "End Mill" }],
      sort: { field: "diameterMm", direction: "desc" },
    }
    await executeSpecViaCompiler(spec)
    const call = executeCalls[0]
    expect(call.sql).toMatch(/WHERE/)
    expect(call.sql).toMatch(/ORDER BY\s+.*search_diameter_mm.*\s+DESC/i)
  })
})

describe("classifySpecMode", () => {
  it("classifies sort/similarity/tolerance/plain", async () => {
    const { classifySpecMode } = await import("../execute-spec-via-compiler")
    expect(classifySpecMode({
      intent: "narrow",
      navigation: "none",
      constraints: [],
      sort: { field: "diameterMm", direction: "asc" },
    })).toBe("sort")
    expect(classifySpecMode({
      intent: "narrow",
      navigation: "none",
      constraints: [],
      similarTo: { referenceProductId: "X" },
    })).toBe("similarity")
    expect(classifySpecMode({
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 4, tolerance: 0.3 }],
    })).toBe("tolerance")
    expect(classifySpecMode({
      intent: "narrow",
      navigation: "none",
      constraints: [{ field: "diameterMm", op: "eq", value: 4 }],
    })).toBe("plain")
  })
})
