import { describe, expect, it, vi } from "vitest"

import { parseDeterministic } from "@/lib/recommendation/core/deterministic-scr"
import {
  applyEditIntent,
  getEditIntentAffectedFields,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
} from "@/lib/recommendation/core/edit-intent"
import { mergeKgPatchIntoSpec } from "@/lib/recommendation/core/kg-spec-merge"
import { tryParseSortPhrase } from "@/lib/recommendation/core/knowledge-graph"
import { replaceFieldFilter } from "@/lib/recommendation/infrastructure/engines/serve-engine-filter-state"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

vi.mock("@/lib/recommendation/core/sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "YG-1", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
  getDbSchema: async () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "YG-1", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
  findColumnsForToken: () => [],
  findValueByPhonetic: () => null,
}))

const GLOBAL_RELAX_RE =
  /(?:^|\s)(?:\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694|\uC74C)?|\uC544\uBB34\uAC70\uB098|\uBB50\uB4E0(?:\s*\uC0C1\uAD00\s*\uC5C6(?:\uC5B4|\uC5B4\uC694)?)?|\uB2E4\s*\uAD1C\uCC2E(?:\uC544|\uC544\uC694)?|\uBB34\uAD00)(?:$|\s)/iu

function makeFilter(field: string, value: string | number, op: AppliedFilter["op"] = "eq"): AppliedFilter {
  return { field, op, value: String(value), rawValue: value, appliedAt: 0 }
}

function applyFilterToInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  return { ...input, [filter.field]: filter.rawValue }
}

function simulateStageOnePrepass(
  message: string,
  filtersIn: AppliedFilter[],
  turnCount = 5,
): {
  filters: AppliedFilter[]
  handled: boolean
  reasoning: string[]
  sortPatch: { sort: NonNullable<ReturnType<typeof tryParseSortPhrase>> } | null
} {
  const filters = [...filtersIn]
  const editResult = hasEditSignal(message) ? parseEditIntent(message, filters) : null
  const sort = tryParseSortPhrase(message)
  const sortPatch = sort ? { sort } : null
  const editCanExecute = shouldExecuteEditIntentDeterministically(editResult)
  const semanticHintFields = new Set(editCanExecute ? [] : getEditIntentAffectedFields(editResult))
  const allowDeterministicMerge = !editResult || !editCanExecute || editResult.intent.type === "skip_field"
  if (!allowDeterministicMerge) {
    return { filters, handled: !!sortPatch, reasoning: sort ? [`sort:${sort.field}:${sort.direction}`] : [], sortPatch }
  }

  const detApplyActions = parseDeterministic(message).filter(
    action => action.type === "apply_filter" && action.field && action.value != null,
  )
  const effectiveDetApplyActions =
    detApplyActions.filter(action => {
      if (!action.field) return true
      if (editResult?.intent.type === "skip_field" && action.field === editResult.intent.field) return false
      if (semanticHintFields.has(action.field)) return false
      return true
    })
  const currentTurnFields = new Set(detApplyActions.map(action => action.field!))
  const shouldClearUnmentionedFields =
    !editResult
    && currentTurnFields.size > 0
    && GLOBAL_RELAX_RE.test(message)

  const reasoning: string[] = []
  if (shouldClearUnmentionedFields) {
    for (let index = filters.length - 1; index >= 0; index--) {
      if (!currentTurnFields.has(filters[index].field)) {
        filters.splice(index, 1)
      }
    }
    reasoning.push(`relax:${[...currentTurnFields].join("|")}`)
  }

  if (editResult?.intent.type === "skip_field") {
    const mutation = applyEditIntent(editResult.intent, filters, turnCount)
    for (const index of [...mutation.removeIndices].sort((a, b) => b - a)) {
      filters.splice(index, 1)
    }
    if (mutation.addFilter) {
      const replaced = replaceFieldFilter({}, filters, mutation.addFilter, applyFilterToInput)
      filters.splice(0, filters.length, ...replaced.nextFilters)
      reasoning.push(`skip:${mutation.addFilter.field}`)
    }
  }

  for (const action of effectiveDetApplyActions) {
    const isBetween = action.op === "between" && action.value2 != null
    const inputValue = isBetween
      ? [action.value as string | number, action.value2 as string | number]
      : (action.value as string | number)
    const built = buildAppliedFilterFromValue(action.field!, inputValue, turnCount, action.op)
    if (!built) continue
    const skipIdx = filters.findIndex(filter => filter.field === built.field && filter.op === "skip")
    if (skipIdx >= 0) filters.splice(skipIdx, 1)
    if (action.op === "neq") {
      const existingIdx = filters.findIndex(filter => filter.field === built.field && filter.op !== "neq")
      if (existingIdx >= 0) filters.splice(existingIdx, 1)
    }
    const replaced = replaceFieldFilter({}, filters, built, applyFilterToInput)
    filters.splice(0, filters.length, ...replaced.nextFilters)
    reasoning.push(`${action.field}=${action.value}`)
  }

  if (sort) reasoning.push(`sort:${sort.field}:${sort.direction}`)

  return { filters, handled: reasoning.length > 0, reasoning, sortPatch }
}

describe("stage-one deterministic pre-pass", () => {
  it("keeps the Stage 1 fast-path skip patterns", () => {
    const result = simulateStageOnePrepass("생크 타입 아무거나 추천해줘도 됩니다", [
      makeFilter("shankType", "Plain"),
      makeFilter("fluteCount", 4),
    ])

    expect(result.handled).toBe(true)
    expect(result.filters.filter(filter => filter.field === "shankType")).toEqual([
      expect.objectContaining({ field: "shankType", op: "skip", rawValue: "skip" }),
    ])
    expect(result.filters.some(filter => filter.field === "fluteCount" && Number(filter.rawValue) === 4)).toBe(true)
  })

  it("keeps deterministic filters but leaves skip slang for later stages", () => {
    const result = simulateStageOnePrepass("코팅은 뭐 아무래도 좋은데 날수만 4날로 해줘", [
      makeFilter("coating", "TiAlN"),
      makeFilter("brand", "CRX-S"),
    ])

    expect(result.handled).toBe(true)
    expect(result.filters.some(filter => filter.field === "fluteCount" && Number(filter.rawValue) === 4)).toBe(true)
    expect(result.filters.some(filter => filter.field === "coating" && filter.op === "eq" && String(filter.rawValue) === "TiAlN")).toBe(true)
    expect(result.filters.some(filter => filter.field === "brand" && String(filter.rawValue) === "CRX-S")).toBe(true)
  })

  it("does not parse slang skip phrases in Stage 1", () => {
    const result = simulateStageOnePrepass("브랜드 노상관", [
      makeFilter("brand", "CRX-S"),
      makeFilter("diameterMm", 10),
    ])

    expect(result.handled).toBe(false)
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "brand", op: "eq", rawValue: "CRX-S" }),
      expect.objectContaining({ field: "diameterMm", op: "eq", rawValue: 10 }),
    ])
  })

  it("stages sort intent for superlatives", () => {
    const result = simulateStageOnePrepass("날장 제일 긴걸로 추천해주세요", [])
    expect(result.sortPatch).toEqual({
      sort: { field: "lengthOfCutMm", direction: "desc" },
    })

    const merged = mergeKgPatchIntoSpec(
      { intent: "show_recommendation", navigation: "none", constraints: [] },
      result.sortPatch,
    )
    expect(merged.sort).toEqual({ field: "lengthOfCutMm", direction: "desc" })
  })

  it("keeps only explicit constraints for the basic global relax cues", () => {
    const result = simulateStageOnePrepass("다 괜찮아 직경만 10mm", [
      makeFilter("coating", "TiAlN"),
      makeFilter("brand", "CRX-S"),
      makeFilter("fluteCount", 2),
    ])

    expect(result.handled).toBe(true)
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
    ])
  })
})
