/**
 * Phase E.5 — integration: KG §9 specPatch → mergeKgPatchIntoSpec →
 * compileProductQuery. Proves the end-to-end wiring from a KG patch
 * to a SQL string that actually contains ORDER BY / BETWEEN / WITH ref.
 */

import { describe, it, expect } from "vitest"
import { mergeKgPatchIntoSpec, consumeKgSpecPatch } from "../kg-spec-merge"
import { compileProductQuery } from "../compile-product-query"
import type { QuerySpec } from "../query-spec"
import type { KGSpecPatch } from "../knowledge-graph"

function baseSpec(): QuerySpec {
  return {
    intent: "narrow",
    navigation: "none",
    constraints: [
      { field: "diameterMm", op: "eq", value: 10 },
    ],
  }
}

describe("kg-merge-integration — E.5", () => {
  it("sort patch flows through to ORDER BY in compiled SQL", () => {
    const spec = baseSpec()
    const patch: KGSpecPatch = { sort: { field: "diameterMm", direction: "asc" } }
    const merged = mergeKgPatchIntoSpec(spec, patch)
    expect(merged.sort).toEqual({ field: "diameterMm", direction: "asc" })

    const compiled = compileProductQuery(merged)
    expect(compiled.sql).toMatch(/ORDER BY/i)
    expect(compiled.sql).toMatch(/ASC/i)
    // Default ORDER BY should have been replaced with the sort field's numeric expr.
    expect(compiled.sql).toMatch(/search_diameter_mm/)
  })

  it("tolerance patch merges onto existing constraint and emits BETWEEN", () => {
    const spec = baseSpec()
    const patch: KGSpecPatch = {
      toleranceConstraints: [
        { field: "diameterMm", op: "eq", value: 10, tolerance: 0.5 },
      ],
    }
    const merged = mergeKgPatchIntoSpec(spec, patch)
    expect(merged.constraints).toHaveLength(1)
    expect(merged.constraints[0].tolerance).toBe(0.5)

    const compiled = compileProductQuery(merged)
    expect(compiled.sql).toMatch(/BETWEEN/i)
  })

  it("similarTo patch with a real productId emits WITH ref CTE", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
    }
    const patch: KGSpecPatch = {
      similarTo: { referenceProductId: "EDP-12345" },
    }
    const merged = mergeKgPatchIntoSpec(spec, patch)
    expect(merged.similarTo?.referenceProductId).toBe("EDP-12345")

    const compiled = compileProductQuery(merged)
    expect(compiled.sql).toMatch(/WITH ref AS/i)
    expect(compiled.sql).toMatch(/_similarity_score/i)
    expect(compiled.params).toContain("EDP-12345")
  })

  it("defensive: drops similarTo with __current__ sentinel", () => {
    const spec = baseSpec()
    const patch: KGSpecPatch = {
      similarTo: { referenceProductId: "__current__" },
    }
    const merged = mergeKgPatchIntoSpec(spec, patch)
    expect(merged.similarTo).toBeUndefined()
  })

  it("defensive: drops sort with non-sortable field", () => {
    const spec = baseSpec()
    // brand is text, not sortable per manifest.
    const patch: KGSpecPatch = {
      sort: { field: "brand" as never, direction: "asc" },
    }
    const merged = mergeKgPatchIntoSpec(spec, patch)
    expect(merged.sort).toBeUndefined()
  })

  it("consumeKgSpecPatch clears the patch from session state (consume-once)", () => {
    const patch: KGSpecPatch = { sort: { field: "diameterMm", direction: "desc" } }
    const session: { kgSpecPatch?: KGSpecPatch } = { kgSpecPatch: patch }
    const got = consumeKgSpecPatch(session)
    expect(got).toEqual(patch)
    expect(session.kgSpecPatch).toBeUndefined()
    // Second call returns undefined.
    expect(consumeKgSpecPatch(session)).toBeUndefined()
  })

  it("mergeKgPatchIntoSpec does not mutate input", () => {
    const spec = baseSpec()
    const before = JSON.stringify(spec)
    mergeKgPatchIntoSpec(spec, {
      sort: { field: "diameterMm", direction: "desc" },
      toleranceConstraints: [
        { field: "diameterMm", op: "eq", value: 10, tolerance: 1 },
      ],
    })
    expect(JSON.stringify(spec)).toBe(before)
  })
})
