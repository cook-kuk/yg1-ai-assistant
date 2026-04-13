import { describe, expect, it } from "vitest"

import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"
import { applyFilterToRecommendationInput, buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { replaceFieldFilter } from "../serve-engine-filter-state"

function makeBaseInput(): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
  }
}

function requireFilter(filter: AppliedFilter | null): AppliedFilter {
  expect(filter).not.toBeNull()
  return filter as AppliedFilter
}

describe("replaceFieldFilter range merging", () => {
  it("merges same-field gte/lte filters into a single between filter", () => {
    const base = makeBaseInput()
    const gte = requireFilter(buildAppliedFilterFromValue("diameterMm", 10, 1, "gte"))
    const lte = requireFilter(buildAppliedFilterFromValue("diameterMm", 20, 2, "lte"))

    const result = replaceFieldFilter(base, [gte], lte, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toEqual([
      expect.objectContaining({
        field: "diameterMm",
        op: "between",
        rawValue: 10,
        rawValue2: 20,
      }),
    ])
  })

  it("tightens an existing between filter when a stricter lower bound arrives", () => {
    const base = makeBaseInput()
    const between = requireFilter(buildAppliedFilterFromValue("diameterMm", [8, 20], 1, "between"))
    const tighterLowerBound = requireFilter(buildAppliedFilterFromValue("diameterMm", 10, 2, "gte"))

    const result = replaceFieldFilter(base, [between], tighterLowerBound, applyFilterToRecommendationInput)

    expect(result.nextFilters).toEqual([
      expect.objectContaining({
        field: "diameterMm",
        op: "between",
        rawValue: 10,
        rawValue2: 20,
      }),
    ])
  })
})
