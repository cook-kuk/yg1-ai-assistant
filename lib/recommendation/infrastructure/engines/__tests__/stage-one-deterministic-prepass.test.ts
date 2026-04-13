import { describe, expect, it, vi } from "vitest"

import { parseDeterministic } from "@/lib/recommendation/core/deterministic-scr"
import {
  applyEditIntent,
  getEditIntentAffectedFields,
  getEditIntentHintTokens,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
} from "@/lib/recommendation/core/edit-intent"
import { mergeKgPatchIntoSpec } from "@/lib/recommendation/core/kg-spec-merge"
import { tryParseSortPhrase } from "@/lib/recommendation/core/knowledge-graph"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"

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

function makeFilter(field: string, value: string | number, op: AppliedFilter["op"] = "eq"): AppliedFilter {
  return { field, op, value: String(value), rawValue: value, appliedAt: 0 }
}

function simulateStageOnePrepass(
  message: string,
  filtersIn: AppliedFilter[],
  turnCount = 5,
): {
  filters: AppliedFilter[]
  handled: boolean
  semanticHints: string[]
  sortPatch: { sort: NonNullable<ReturnType<typeof tryParseSortPhrase>> } | null
} {
  const filters = [...filtersIn]
  const editResult = hasEditSignal(message) ? parseEditIntent(message, filters) : null
  const sort = tryParseSortPhrase(message)
  const sortPatch = sort ? { sort } : null
  const semanticHints: string[] = []

  if (editResult && shouldExecuteEditIntentDeterministically(editResult)) {
    const mutation = applyEditIntent(editResult.intent, filters, turnCount)
    for (const index of [...mutation.removeIndices].sort((a, b) => b - a)) {
      filters.splice(index, 1)
    }
    if (mutation.addFilter) {
      filters.push(mutation.addFilter)
    }
  } else if (editResult) {
    semanticHints.push(
      ...getEditIntentAffectedFields(editResult),
      ...getEditIntentHintTokens(editResult),
    )
  }

  const detHintTokens = parseDeterministic(message)
    .filter(action => action.type === "apply_filter" && action.field && action.value != null)
    .flatMap(action => [
      action.field!,
      String(action.value),
      action.value2 != null ? String(action.value2) : null,
    ])
    .filter((token): token is string => typeof token === "string" && token.trim().length > 0)

  semanticHints.push(...detHintTokens)

  return {
    filters,
    handled: Boolean(editResult && shouldExecuteEditIntentDeterministically(editResult)) || Boolean(sortPatch),
    semanticHints,
    sortPatch,
  }
}

describe("stage-one deterministic pre-pass", () => {
  it("keeps the Stage 1 fast-path skip patterns", () => {
    const result = simulateStageOnePrepass("생크 타입 아무거나 추천해주세요", [
      makeFilter("shankType", "Plain"),
      makeFilter("fluteCount", 4),
    ])

    expect(result.handled).toBe(true)
    expect(result.filters.filter(filter => filter.field === "shankType")).toEqual([
      expect.objectContaining({ field: "shankType", op: "skip", rawValue: "skip" }),
    ])
    expect(result.filters.some(filter => filter.field === "fluteCount" && Number(filter.rawValue) === 4)).toBe(true)
  })

  it("converts deterministic filter candidates into semantic hints instead of applying them", () => {
    const result = simulateStageOnePrepass("코팅은 뭐가 됐든 날수만 4날로 해줘", [
      makeFilter("coating", "TiAlN"),
      makeFilter("brand", "CRX-S"),
    ])

    expect(result.handled).toBe(false)
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "coating", op: "eq", rawValue: "TiAlN" }),
      expect.objectContaining({ field: "brand", op: "eq", rawValue: "CRX-S" }),
    ])
    expect(result.semanticHints).toEqual(expect.arrayContaining(["fluteCount", "4"]))
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
    const result = simulateStageOnePrepass("직경 큰 순서로 추천해주세요", [])
    expect(result.sortPatch).toEqual({
      sort: { field: "diameterMm", direction: "desc" },
    })

    const merged = mergeKgPatchIntoSpec(
      { intent: "show_recommendation", navigation: "none", constraints: [] },
      result.sortPatch,
    )
    expect(merged.sort).toEqual({ field: "diameterMm", direction: "desc" })
  })

  it("keeps global relaxation as a semantic hint until later stages validate it", () => {
    const result = simulateStageOnePrepass("다 상관없고 직경만 10mm", [
      makeFilter("coating", "TiAlN"),
      makeFilter("brand", "CRX-S"),
      makeFilter("fluteCount", 2),
    ])

    expect(result.handled).toBe(false)
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "coating", rawValue: "TiAlN" }),
      expect.objectContaining({ field: "brand", rawValue: "CRX-S" }),
      expect.objectContaining({ field: "fluteCount", rawValue: 2 }),
    ])
    expect(result.semanticHints).toEqual(expect.arrayContaining(["diameterMm", "10"]))
  })
})
