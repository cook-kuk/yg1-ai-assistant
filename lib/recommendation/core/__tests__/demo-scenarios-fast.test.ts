/**
 * Demo scenarios — fast deterministic layer (no LLM)
 * 시연 핵심 시나리오의 wording variant invariant 검증.
 * 모든 케이스: parseEditIntent → applyEditIntent → 필터 mutation 결과를 invariant로 검증.
 */
import { describe, it, expect, vi } from "vitest"
import {
  hasEditSignal,
  parseEditIntent,
  applyEditIntent,
} from "../edit-intent"
import type { AppliedFilter } from "@/lib/types/exploration"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "YG-1", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

function makeFilter(field: string, value: string | number, op = "eq", rawValue?: any): AppliedFilter {
  return { field, op, value: String(value), rawValue: rawValue ?? value, appliedAt: 0 }
}

function applyAndGetFilters(msg: string, current: AppliedFilter[]): { filters: AppliedFilter[]; intentType: string | null } {
  const parsed = parseEditIntent(msg, current)
  if (!parsed) return { filters: current, intentType: null }
  const mutation = applyEditIntent(parsed.intent, current, 1)
  const next = [...current]
  if (mutation.removeIndices) {
    for (const idx of [...mutation.removeIndices].sort((a, b) => b - a)) {
      next.splice(idx, 1)
    }
  }
  if (mutation.addFilter) next.push(mutation.addFilter as AppliedFilter)
  return { filters: next, intentType: parsed.intent.type }
}

describe("DEMO S02 — exclude brand CRX S (variant set)", () => {
  const variants = [
    "CRX S 가 아닌걸로",
    "CRX S 아닌 걸로",
    "CRX S 말고 다른 브랜드",
    "CRX S 제외",
    "CRX S 빼고 보여줘",
  ]
  it.each(variants)("[%s] → edit signal detected", (msg) => {
    expect(hasEditSignal(msg)).toBe(true)
  })

  it.each(variants)("[%s] → results in brand!=CRX S filter", (msg) => {
    const base: AppliedFilter[] = [
      makeFilter("diameterMm", 10, "eq", 10),
      makeFilter("fluteCount", 2, "eq", 2),
    ]
    const { filters, intentType } = applyAndGetFilters(msg, base)
    expect(intentType).not.toBeNull()
    // INVARIANT: 어떤 형태로든 brand 필터가 'CRX S'를 배제해야 함
    const brandFilters = filters.filter(f => f.field === "brand")
    expect(brandFilters.length).toBeGreaterThan(0)
    const hasCrxsExclusion = brandFilters.some(f =>
      (f.op === "neq" && String(f.rawValue ?? f.value).toUpperCase().replace(/[\s-]/g, "") === "CRXS")
      || (f.op === "not_in" && Array.isArray(f.rawValue) && f.rawValue.some((v: any) => String(v).toUpperCase().replace(/[\s-]/g, "") === "CRXS"))
    )
    expect(hasCrxsExclusion).toBe(true)
    // Base 필터(diameter, flute)는 보존되어야 함
    expect(filters.some(f => f.field === "diameterMm")).toBe(true)
    expect(filters.some(f => f.field === "fluteCount")).toBe(true)
  })
})

describe("DEMO S04 — replace fluteCount 2 → 4", () => {
  const variants = ["2날 말고 4날로", "4날로 바꿔", "2날 말고 4날"]
  it.each(variants)("[%s] → fluteCount=4 (and not 2)", (msg) => {
    const base: AppliedFilter[] = [makeFilter("fluteCount", 2, "eq", 2)]
    const { filters } = applyAndGetFilters(msg, base)
    const flute = filters.filter(f => f.field === "fluteCount")
    expect(flute.length).toBeGreaterThan(0)
    // INVARIANT: 4날 필터는 있어야 하고, 2날 필터는 없어야 함
    const has4 = flute.some(f => Number(f.rawValue ?? f.value) === 4 && f.op === "eq")
    const has2 = flute.some(f => Number(f.rawValue ?? f.value) === 2 && f.op === "eq")
    expect(has4).toBe(true)
    expect(has2).toBe(false)
  })
})

describe("DEMO S05 — clear brand filter", () => {
  it("브랜드는 상관없음 → brand 필터 모두 제거", () => {
    const base: AppliedFilter[] = [
      makeFilter("diameterMm", 10, "eq", 10),
      { field: "brand", op: "neq", value: "CRX S 제외", rawValue: "CRX S", appliedAt: 0 },
    ]
    const { filters, intentType } = applyAndGetFilters("브랜드는 상관없음", base)
    expect(intentType).toBe("clear_field")
    // INVARIANT: 어떤 brand 필터도 남으면 안 됨
    expect(filters.some(f => f.field === "brand")).toBe(false)
    // 다른 필터는 보존
    expect(filters.some(f => f.field === "diameterMm")).toBe(true)
  })
})

describe("DEMO S06 — go back then exclude", () => {
  it("이전으로 돌아가서 CRX S 제외 → goBack + brand 제외", () => {
    const base: AppliedFilter[] = [makeFilter("diameterMm", 10, "eq", 10)]
    const parsed = parseEditIntent("이전으로 돌아가서 CRX S 제외", base)
    expect(parsed).not.toBeNull()
    expect(parsed!.intent.type).toMatch(/go_back|exclude/)
  })
})

describe("DEMO — non-edit messages must NOT trigger edit signal", () => {
  // 절대 원칙: edit-intent가 처리해야 할 문장 vs 단순 질문/요청 분리
  const nonEdit = [
    "추천해줘",
    "어떤걸 추천해?",
    "구리 10mm 2날",
    "차이 설명해줘",
  ]
  it.each(nonEdit)("[%s] → no edit signal", (msg) => {
    expect(hasEditSignal(msg)).toBe(false)
  })
})
