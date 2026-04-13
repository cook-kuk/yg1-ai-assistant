import { describe, expect, it, vi } from "vitest"

import {
  applyEditIntent,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
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

function makeFilter(field: string, value: string | number, op = "eq", rawValue?: unknown): AppliedFilter {
  return { field, op, value: String(value), rawValue: rawValue ?? value, appliedAt: 0 }
}

describe("demo fast-path guardrails", () => {
  it("keeps explicit skip phrasing deterministic", () => {
    const base: AppliedFilter[] = [
      makeFilter("diameterMm", 10, "eq", 10),
      makeFilter("brand", "CRX S"),
    ]

    const parsed = parseEditIntent("브랜드는 상관없음", base)
    expect(parsed?.intent.type).toBe("skip_field")
    expect(shouldExecuteEditIntentDeterministically(parsed)).toBe(true)

    if (!parsed) return
    const mutation = applyEditIntent(parsed.intent, base, 1)
    const next = [...base]
    for (const idx of [...mutation.removeIndices].sort((a, b) => b - a)) {
      next.splice(idx, 1)
    }
    if (mutation.addFilter) next.push(mutation.addFilter as AppliedFilter)

    const brandFilters = next.filter(filter => filter.field === "brand")
    expect(brandFilters).toHaveLength(1)
    expect(brandFilters[0].op).toBe("skip")
    expect(next.some(filter => filter.field === "diameterMm")).toBe(true)
  })

  it.each([
    "CRX S 가 아닌걸로",
    "CRX S 말고 다른 브랜드",
    "CRX S 제외",
    "2날 말고 4날로",
    "Ball로 바꿔줘",
    "이전으로 돌아가서 CRX S 제외",
  ])("[%s] stays out of the deterministic fast-path", (msg) => {
    expect(hasEditSignal(msg)).toBe(false)
    expect(parseEditIntent(msg, [makeFilter("brand", "CRX S")])).toBeNull()
  })

  it.each([
    "추천해줘",
    "어떤걸 추천해?",
    "구리 10mm 2날",
    "차이 설명해줘",
  ])("[%s] is not treated as an edit signal", (msg) => {
    expect(hasEditSignal(msg)).toBe(false)
  })
})
