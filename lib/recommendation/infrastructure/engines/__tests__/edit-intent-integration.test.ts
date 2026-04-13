import { describe, expect, it, vi } from "vitest"

import {
  applyEditIntent,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
} from "@/lib/recommendation/core/edit-intent"
import { replaceFieldFilter } from "@/lib/recommendation/infrastructure/engines/serve-engine-filter-state"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

vi.mock("@/lib/recommendation/core/sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

function makeFilter(field: string, value: string | number, op: AppliedFilter["op"] = "eq"): AppliedFilter {
  return { field, op, value: String(value), rawValue: value, appliedAt: 0 }
}

const baseInput: RecommendationInput = {}

function applyFilterToInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  return { ...input, [filter.field]: filter.rawValue }
}

function simulateRuntimeEditIntent(
  message: string,
  filtersIn: AppliedFilter[],
  turnCount: number,
) {
  if (!hasEditSignal(message)) return null

  const filters = [...filtersIn]
  const parsed = parseEditIntent(message, filters)
  if (!parsed || !shouldExecuteEditIntentDeterministically(parsed) || parsed.confidence < 0.9) return null

  const mutation = applyEditIntent(parsed.intent, filters, turnCount)
  for (const index of [...mutation.removeIndices].sort((a, b) => b - a)) {
    filters.splice(index, 1)
  }

  if (mutation.addFilter) {
    const built = mutation.addFilter.op === "skip"
      ? mutation.addFilter
      : buildAppliedFilterFromValue(
          mutation.addFilter.field,
          mutation.addFilter.rawValue,
          turnCount,
          mutation.addFilter.op === "neq" ? "neq" : undefined,
        )
    if (built) {
      const replaced = replaceFieldFilter(baseInput, filters, built, applyFilterToInput)
      filters.splice(0, filters.length, ...replaced.nextFilters)
    }
  }

  return {
    action: parsed.intent.type,
    filters,
    goBack: mutation.goBack,
  }
}

describe("edit-intent runtime integration", () => {
  const baseFilters: AppliedFilter[] = [
    makeFilter("toolSubtype", "Square"),
    makeFilter("fluteCount", 2),
    makeFilter("coating", "TiAlN"),
    makeFilter("brand", "CRX-S"),
  ]

  it("applies the basic Stage 1 skip_field flow", () => {
    const result = simulateRuntimeEditIntent("브랜드는 상관없음", baseFilters, 5)
    expect(result?.action).toBe("skip_field")
    expect(result?.filters.filter(filter => filter.field === "brand")).toEqual([
      expect.objectContaining({ field: "brand", op: "skip", rawValue: "skip" }),
    ])
  })

  it("defers replacement semantics to the multi-stage resolver", () => {
    const result = simulateRuntimeEditIntent("2날 말고 4날로", baseFilters, 5)
    expect(result).toBeNull()
  })

  it("defers slang skip phrasing to Stage 2/3", () => {
    expect(simulateRuntimeEditIntent("브랜드 노상관", baseFilters, 5)).toBeNull()
    expect(simulateRuntimeEditIntent("형상 알아서 해줘 10mm", baseFilters, 5)).toBeNull()
  })
})
