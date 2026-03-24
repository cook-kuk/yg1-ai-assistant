import { describe, expect, it } from "vitest"

import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

function makeBaseInput(): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    diameterMm: 4,
    material: "알루미늄",
    operationType: "Side Cutting",
    toolType: "엔드밀",
  }
}

describe("serve-engine runtime filter replacement", () => {
  it("replaces an existing same-field filter instead of stacking it", () => {
    const baseInput = makeBaseInput()
    const currentFilters: AppliedFilter[] = [
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 1 },
      { field: "lengthOfCutMm", op: "eq", value: "11mm", rawValue: 11, appliedAt: 2 },
    ]
    const nextFilter: AppliedFilter = {
      field: "lengthOfCutMm",
      op: "eq",
      value: "13mm",
      rawValue: 13,
      appliedAt: 3,
    }

    const result = replaceFieldFilter(baseInput, currentFilters, nextFilter, applyFilterToInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toEqual([
      currentFilters[0],
      nextFilter,
    ])
    expect(result.nextInput.lengthOfCutMm).toBe(13)
    expect(result.nextInput.coatingPreference).toBe("TiAlN")
  })

  it("replaces a selected field with skip so the old constraint is removed", () => {
    const baseInput = makeBaseInput()
    const currentFilters: AppliedFilter[] = [
      { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 1 },
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
    ]
    const skipFilter: AppliedFilter = {
      field: "fluteCount",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: 3,
    }

    const result = replaceFieldFilter(baseInput, currentFilters, skipFilter, applyFilterToInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toEqual([
      currentFilters[1],
      skipFilter,
    ])
    expect(result.nextInput.flutePreference).toBeUndefined()
    expect(result.nextInput.coatingPreference).toBe("TiAlN")
  })

  it("clears dependent workPieceName when material changes and applies toolType filters", () => {
    const baseInput = {
      ...makeBaseInput(),
      workPieceName: "ADC12",
    }

    const withToolType = applyFilterToInput(baseInput, {
      field: "toolType",
      op: "includes",
      value: "드릴",
      rawValue: "드릴",
      appliedAt: 3,
    })

    expect(withToolType.toolType).toBe("드릴")
    expect(withToolType.workPieceName).toBe("ADC12")

    const withMaterial = applyFilterToInput(withToolType, {
      field: "material",
      op: "includes",
      value: "주철",
      rawValue: "주철",
      appliedAt: 4,
    })

    expect(withMaterial.material).toBe("주철")
    expect(withMaterial.workPieceName).toBeUndefined()
    expect(withMaterial.toolType).toBe("드릴")
  })
})
