/**
 * Edit-Intent Integration Test
 *
 * serve-engine-runtime에서 edit-intent가 실행될 때의 filter 변이를
 * 실제 runtime과 동일한 로직으로 재현.
 *
 * 검증 대상:
 * 1. parseEditIntent → applyEditIntent 흐름
 * 2. buildAppliedFilterFromValue를 통한 실제 필터 빌드
 * 3. replaceFieldFilter를 통한 실제 input 갱신
 * 4. before/after state diff
 */

import { describe, it, expect, vi, beforeAll } from "vitest"
import { hasEditSignal, parseEditIntent, applyEditIntent } from "@/lib/recommendation/core/edit-intent"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { replaceFieldFilter } from "@/lib/recommendation/infrastructure/engines/serve-engine-filter-state"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

// Mock DB schema cache for brand resolution
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
    brands: ["CRX S", "CRX-S"],
    loadedAt: Date.now(),
  }),
}))

// ── Helpers ──────────────────────────────────────────────────

function makeFilter(field: string, value: string | number, op = "eq"): AppliedFilter {
  return { field, op, value: String(value), rawValue: value, appliedAt: 0 }
}

const baseInput: RecommendationInput = {}

function applyFilterToInput(input: RecommendationInput, filter: AppliedFilter): RecommendationInput {
  return { ...input, [filter.field]: filter.rawValue }
}

/** Simulate the exact runtime logic from serve-engine-runtime.ts line ~1717-1780 */
function simulateRuntimeEditIntent(
  msg: string,
  filtersIn: AppliedFilter[],
  turnCount: number,
): {
  handled: boolean
  action: string | null
  filters: AppliedFilter[]
  goBack: boolean
  log: string
} | null {
  if (!hasEditSignal(msg)) return null

  const filters = [...filtersIn] // clone
  const editResult = parseEditIntent(msg, filters)
  if (!editResult || editResult.confidence < 0.9) return null

  const mutation = applyEditIntent(editResult.intent, filters, turnCount)

  if (editResult.intent.type === "reset_all") {
    return {
      handled: true,
      action: "reset_session",
      filters: [],
      goBack: false,
      log: "reset_all",
    }
  }

  // Apply removals (reverse order)
  const removed: string[] = []
  for (const idx of [...mutation.removeIndices].sort((a, b) => b - a)) {
    removed.push(`${filters[idx].field}=${filters[idx].rawValue}(${filters[idx].op})`)
    filters.splice(idx, 1)
  }

  // Apply addition — mirrors runtime logic exactly
  let added: string | null = null
  if (mutation.addFilter) {
    const built = buildAppliedFilterFromValue(
      mutation.addFilter.field,
      mutation.addFilter.rawValue,
      turnCount,
      mutation.addFilter.op === "neq" ? "neq" : undefined,
    )
    if (built) {
      const skipIdx = filters.findIndex(x => x.field === built.field && x.op === "skip")
      if (skipIdx >= 0) filters.splice(skipIdx, 1)
      const result = replaceFieldFilter(baseInput, filters, built, applyFilterToInput)
      filters.splice(0, filters.length, ...result.nextFilters)
      added = `${built.field}=${built.rawValue}(${built.op})`
    } else {
      // Fallback: push raw filter (same as runtime)
      filters.push(mutation.addFilter)
      added = `${mutation.addFilter.field}=${mutation.addFilter.rawValue}(${mutation.addFilter.op})`
    }
  }

  return {
    handled: true,
    action: editResult.intent.type,
    filters,
    goBack: mutation.goBack,
    log: `${editResult.intent.type}: removed=[${removed.join(",")}], added=${added ?? "none"}`,
  }
}

function filtersToString(filters: AppliedFilter[]): string[] {
  return filters.map(f => `${f.field}=${f.rawValue}(${f.op})`)
}

// ── E2E Cases ───────────────────────────────────────────────

describe("edit-intent runtime integration", () => {
  // Base state: user has already narrowed to Square/2flute/TiAlN/CRX-S
  const baseFilters: AppliedFilter[] = [
    makeFilter("toolSubtype", "Square"),
    makeFilter("fluteCount", 2),
    makeFilter("coating", "TiAlN"),
    makeFilter("brand", "CRX-S"),
  ]

  // ── Case 1: "CRX S 가 아닌걸로" ──
  it("CRX S 가 아닌걸로 → brand eq 제거, brand neq 추가", () => {
    const result = simulateRuntimeEditIntent("CRX S 가 아닌걸로", baseFilters, 5)!
    expect(result).not.toBeNull()
    expect(result.handled).toBe(true)
    expect(result.action).toBe("exclude_field")

    // brand=CRX-S(eq) 제거됨
    const brandEq = result.filters.find(f => f.field === "brand" && f.op === "eq")
    expect(brandEq).toBeUndefined()

    // brand neq 추가됨
    const brandNeq = result.filters.find(f => f.field === "brand" && f.op === "neq")
    expect(brandNeq).toBeDefined()

    // 나머지 필터 유지
    expect(result.filters.some(f => f.field === "toolSubtype" && f.op === "eq")).toBe(true)
    expect(result.filters.some(f => f.field === "fluteCount" && f.op === "eq")).toBe(true)
    expect(result.filters.some(f => f.field === "coating" && f.op === "eq")).toBe(true)

    console.log("[Case 1] BEFORE:", filtersToString(baseFilters))
    console.log("[Case 1] AFTER: ", filtersToString(result.filters))
  })

  // ── Case 2: "CRX S 말고 다른 브랜드" ──
  it("CRX S 말고 다른 브랜드 → brand eq 제거, brand neq 추가", () => {
    const result = simulateRuntimeEditIntent("CRX S 말고 다른 브랜드", baseFilters, 5)!
    expect(result).not.toBeNull()
    expect(result.action).toBe("exclude_field")

    const brandEq = result.filters.find(f => f.field === "brand" && f.op === "eq")
    expect(brandEq).toBeUndefined()

    const brandNeq = result.filters.find(f => f.field === "brand" && f.op === "neq")
    expect(brandNeq).toBeDefined()

    console.log("[Case 2] BEFORE:", filtersToString(baseFilters))
    console.log("[Case 2] AFTER: ", filtersToString(result.filters))
  })

  // ── Case 3: "2날 말고 4날로" ──
  it("2날 말고 4날로 → fluteCount=2 제거, fluteCount=4 추가", () => {
    const result = simulateRuntimeEditIntent("2날 말고 4날로", baseFilters, 5)!
    expect(result).not.toBeNull()
    expect(result.action).toBe("replace_field")

    // fluteCount=2 제거됨
    const flute2 = result.filters.find(f => f.field === "fluteCount" && String(f.rawValue) === "2")
    expect(flute2).toBeUndefined()

    // fluteCount=4 추가됨
    const flute4 = result.filters.find(f => f.field === "fluteCount" && f.op === "eq")
    expect(flute4).toBeDefined()
    expect(Number(flute4!.rawValue)).toBe(4)

    // 나머지 유지
    expect(result.filters.some(f => f.field === "toolSubtype")).toBe(true)
    expect(result.filters.some(f => f.field === "coating")).toBe(true)
    expect(result.filters.some(f => f.field === "brand")).toBe(true)

    console.log("[Case 3] BEFORE:", filtersToString(baseFilters))
    console.log("[Case 3] AFTER: ", filtersToString(result.filters))
  })

  // ── Case 4: "브랜드는 상관없음" ──
  it("브랜드는 상관없음 → brand 필터 전부 제거", () => {
    const result = simulateRuntimeEditIntent("브랜드는 상관없음", baseFilters, 5)!
    expect(result).not.toBeNull()
    expect(result.action).toBe("clear_field")

    // brand 필터 없어야 함
    const brandFilters = result.filters.filter(f => f.field === "brand")
    expect(brandFilters).toHaveLength(0)

    // 나머지 3개 유지
    expect(result.filters).toHaveLength(3)
    expect(result.filters.some(f => f.field === "toolSubtype")).toBe(true)
    expect(result.filters.some(f => f.field === "fluteCount")).toBe(true)
    expect(result.filters.some(f => f.field === "coating")).toBe(true)

    console.log("[Case 4] BEFORE:", filtersToString(baseFilters))
    console.log("[Case 4] AFTER: ", filtersToString(result.filters))
  })

  // ── Case 5: "이전으로 돌아가서 CRX S 제외" ──
  it("이전으로 돌아가서 CRX S 제외 → goBack=true + brand neq 추가", () => {
    const result = simulateRuntimeEditIntent("이전으로 돌아가서 CRX S 제외", baseFilters, 5)!
    expect(result).not.toBeNull()
    expect(result.action).toBe("go_back_then_apply")
    expect(result.goBack).toBe(true)

    // brand neq 추가됨
    const brandNeq = result.filters.find(f => f.field === "brand" && f.op === "neq")
    expect(brandNeq).toBeDefined()

    console.log("[Case 5] BEFORE:", filtersToString(baseFilters))
    console.log("[Case 5] AFTER: ", filtersToString(result.filters))
    console.log("[Case 5] goBack:", result.goBack)
  })

  // ── Non-edit messages should NOT be handled ──
  it.each([
    "구리",
    "Square 4날 10mm",
    "추천해줘",
    "구리에 무난한 거",
    "왜 이걸 추천했어?",
  ])("non-edit '%s' is NOT handled by edit-intent", (msg) => {
    const result = simulateRuntimeEditIntent(msg, baseFilters, 5)
    expect(result).toBeNull()
  })

  // ── KG-only expressions should NOT be handled ──
  it.each([
    "TiAlN",
    "Ball",
    "4날",
    "10mm",
  ])("pure entity '%s' is NOT handled by edit-intent", (msg) => {
    const result = simulateRuntimeEditIntent(msg, baseFilters, 5)
    expect(result).toBeNull()
  })
})
