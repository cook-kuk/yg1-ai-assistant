import { describe, expect, it } from "vitest"

import { applyFilterToRecommendationInput } from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

const baseInput: RecommendationInput = {
  manufacturerScope: "yg1-only",
  locale: "ko",
} as RecommendationInput

function diameterFilter(op: string, value: number): AppliedFilter {
  return {
    field: "diameterMm",
    op,
    value: `${value}mm`,
    rawValue: value,
    appliedAt: 0,
  }
}

describe("diameter filter → RecommendationInput (range operators)", () => {
  // ── Regression: S02/S07 "직경 10mm 이상" / "100mm 이상" ──
  // Previously, any numeric diameter filter (gte/gt/lte/lt/eq) mirrored its
  // rawValue onto input.diameterMm. The scorer in hybrid-retrieval then
  // rewarded |product.diameterMm - input.diameterMm| == 0, so products at
  // exactly the boundary dominated the top-N — the opposite of what the
  // user asked ("10mm 이상" → top5 all Ø10mm, nothing larger).
  //
  // Fix: only `eq` should set the scalar target. Range operators rely on
  // the DB filter having already narrowed the pool; the scorer then ranks
  // the survivors without a diameter-proximity bias.

  it("eq sets input.diameterMm", () => {
    const out = applyFilterToRecommendationInput(baseInput, diameterFilter("eq", 10))
    expect(out.diameterMm).toBe(10)
  })

  it("gte does NOT set input.diameterMm", () => {
    const out = applyFilterToRecommendationInput(baseInput, diameterFilter("gte", 10))
    expect(out.diameterMm).toBeUndefined()
  })

  it("gt does NOT set input.diameterMm", () => {
    const out = applyFilterToRecommendationInput(baseInput, diameterFilter("gt", 10))
    expect(out.diameterMm).toBeUndefined()
  })

  it("lte does NOT set input.diameterMm", () => {
    const out = applyFilterToRecommendationInput(baseInput, diameterFilter("lte", 20))
    expect(out.diameterMm).toBeUndefined()
  })

  it("lt does NOT set input.diameterMm", () => {
    const out = applyFilterToRecommendationInput(baseInput, diameterFilter("lt", 20))
    expect(out.diameterMm).toBeUndefined()
  })

  it("between does NOT set input.diameterMm (boundary would bias scoring)", () => {
    const f: AppliedFilter = {
      field: "diameterMm",
      op: "between",
      value: "10-20mm",
      rawValue: 10,
      rawValue2: 20,
      appliedAt: 0,
    }
    const out = applyFilterToRecommendationInput(baseInput, f)
    expect(out.diameterMm).toBeUndefined()
  })

  it("diameterRefine with gte (chip re-ask) also skips the scalar", () => {
    const f: AppliedFilter = {
      field: "diameterRefine",
      op: "gte",
      value: "10mm",
      rawValue: 10,
      appliedAt: 0,
    }
    const out = applyFilterToRecommendationInput(baseInput, f)
    expect(out.diameterMm).toBeUndefined()
  })
})
