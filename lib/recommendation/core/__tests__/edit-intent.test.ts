import { describe, it, expect, vi, beforeAll } from "vitest"
import {
  hasEditSignal,
  parseEditIntent,
  applyEditIntent,
  type EditIntent,
} from "../edit-intent"
import type { AppliedFilter } from "@/lib/types/exploration"

// Mock DB schema cache so extractEntities can resolve brand names like "CRX S"
vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "YG-1", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

// ── Helper ──────────────────────────────────────────────────

function makeFilter(field: string, value: string, op = "eq"): AppliedFilter {
  return { field, op, value, rawValue: value, appliedAt: 0 }
}

// ── hasEditSignal ───────────────────────────────────────────

describe("hasEditSignal", () => {
  it.each([
    "CRX S 말고",
    "TiAlN 빼고",
    "Square 아닌걸로",
    "Ball로 바꿔줘",
    "브랜드는 상관없음",
    "처음부터 다시",
    "코팅 변경해줘",
    "2날에서 4날로 교체",
  ])("returns true for edit expression: %s", (msg) => {
    expect(hasEditSignal(msg)).toBe(true)
  })

  it.each([
    "구리",
    "Square",
    "2날",
    "10mm",
    "CRX-S",
    "TiAlN",
    "추천해줘",
    "구리에 무난한 거",
  ])("returns false for non-edit expression: %s", (msg) => {
    expect(hasEditSignal(msg)).toBe(false)
  })
})

// ── parseEditIntent: replace_field ──────────────────────────

describe("parseEditIntent — replace_field", () => {
  it("2날 말고 4날로", () => {
    const result = parseEditIntent("2날 말고 4날로")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("replace_field")
    if (result!.intent.type === "replace_field") {
      expect(result!.intent.field).toBe("fluteCount")
      expect(result!.intent.oldValue).toBe("2")
      expect(result!.intent.newValue).toBe("4")
    }
  })

  it("Square에서 Ball로 바꿔줘", () => {
    const result = parseEditIntent("Square에서 Ball로 바꿔줘")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("replace_field")
    if (result!.intent.type === "replace_field") {
      expect(result!.intent.field).toBe("toolSubtype")
      expect(result!.intent.oldValue).toBe("Square")
      expect(result!.intent.newValue).toBe("Ball")
    }
  })

  it("DLC로 바꿔 (with existing coating filter)", () => {
    const filters = [makeFilter("coating", "TiAlN")]
    const result = parseEditIntent("DLC로 바꿔", filters)
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("replace_field")
    if (result!.intent.type === "replace_field") {
      expect(result!.intent.field).toBe("coating")
      expect(result!.intent.newValue).toBe("DLC")
    }
  })

  it("10mm 말고 8mm", () => {
    const result = parseEditIntent("10mm 말고 8mm")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("replace_field")
    if (result!.intent.type === "replace_field") {
      expect(result!.intent.field).toBe("diameterMm")
      expect(result!.intent.newValue).toBe("8")
    }
  })

  it("TiAlN 말고 DLC로", () => {
    const result = parseEditIntent("TiAlN 말고 DLC로")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("replace_field")
    if (result!.intent.type === "replace_field") {
      expect(result!.intent.field).toBe("coating")
      expect(result!.intent.oldValue).toBe("TiAlN")
      expect(result!.intent.newValue).toBe("DLC")
    }
  })
})

// ── parseEditIntent: exclude_field ──────────────────────────

describe("parseEditIntent — exclude_field", () => {
  it("CRX S 가 아닌걸로", () => {
    const result = parseEditIntent("CRX S 가 아닌걸로")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("exclude_field")
    if (result!.intent.type === "exclude_field") {
      expect(result!.intent.field).toBe("brand")
    }
  })

  it("CRX S 아닌 걸로", () => {
    const result = parseEditIntent("CRX S 아닌 걸로")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("exclude_field")
  })

  it("CRX S 말고 다른 브랜드", () => {
    const result = parseEditIntent("CRX S 말고 다른 브랜드")
    expect(result).not.toBeNull()
    // "말고 다른 브랜드" — no replacement entity after, should be exclude
    expect(result!.intent.type).toBe("exclude_field")
    if (result!.intent.type === "exclude_field") {
      expect(result!.intent.field).toBe("brand")
    }
  })

  it("TiAlN 빼고", () => {
    const result = parseEditIntent("TiAlN 빼고")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("exclude_field")
    if (result!.intent.type === "exclude_field") {
      expect(result!.intent.field).toBe("coating")
      expect(result!.intent.value).toBe("TiAlN")
    }
  })

  it("TiAlN 제외하고", () => {
    const result = parseEditIntent("TiAlN 제외하고")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("exclude_field")
  })

  it("TiAlN만 아니면 돼", () => {
    const result = parseEditIntent("TiAlN만 아니면 돼")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("exclude_field")
    if (result!.intent.type === "exclude_field") {
      expect(result!.intent.field).toBe("coating")
      expect(result!.intent.value).toBe("TiAlN")
    }
  })
})

// ── parseEditIntent: clear_field ────────────────────────────

describe("parseEditIntent — clear_field", () => {
  it("브랜드는 상관없음", () => {
    const result = parseEditIntent("브랜드는 상관없음")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("clear_field")
    if (result!.intent.type === "clear_field") {
      expect(result!.intent.field).toBe("brand")
    }
  })

  it("코팅은 상관없어", () => {
    const result = parseEditIntent("코팅은 상관없어")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("clear_field")
    if (result!.intent.type === "clear_field") {
      expect(result!.intent.field).toBe("coating")
    }
  })

  it("소재 아무거나", () => {
    const result = parseEditIntent("소재 아무거나")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("clear_field")
    if (result!.intent.type === "clear_field") {
      expect(result!.intent.field).toBe("workPieceName")
    }
  })
})

// ── parseEditIntent: go_back_then_apply ─────────────────────

describe("parseEditIntent — go_back_then_apply", () => {
  it("이전으로 돌아가서 CRX S 제외", () => {
    const result = parseEditIntent("이전으로 돌아가서 CRX S 제외")
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("go_back_then_apply")
    if (result!.intent.type === "go_back_then_apply") {
      expect(result!.intent.inner.type).toBe("exclude_field")
    }
  })
})

// ── parseEditIntent: reset_all ──────────────────────────────

describe("parseEditIntent — reset_all", () => {
  it.each([
    "처음부터",
    "처음부터 다시",
    "초기화",
    "리셋",
    "다시 시작",
  ])("detects reset: %s", (msg) => {
    const result = parseEditIntent(msg)
    expect(result).not.toBeNull()
    expect(result!.intent.type).toBe("reset_all")
  })
})

// ── parseEditIntent: returns null for non-edit ──────────────

describe("parseEditIntent — non-edit returns null", () => {
  it.each([
    "구리",
    "Square",
    "2날",
    "10mm",
    "추천해줘",
    "구리에 무난한 거",
    "직경 10 이상",
  ])("returns null for: %s", (msg) => {
    expect(parseEditIntent(msg)).toBeNull()
  })
})

// ── End-to-end: parse → apply → verify state ───────────────

describe("end-to-end: parse + apply state diff", () => {
  /** Helper: simulate applying an edit to a filter array */
  function simulateApply(
    msg: string,
    before: AppliedFilter[],
  ): { intent: string; removed: string[]; added: string | null; after: string[] } | null {
    const parsed = parseEditIntent(msg, before)
    if (!parsed) return null
    const result = applyEditIntent(parsed.intent, before, 10)

    const removed = result.removeIndices.map(i => `${before[i].field}=${before[i].rawValue}(${before[i].op})`)
    const added = result.addFilter
      ? `${result.addFilter.field}=${result.addFilter.rawValue}(${result.addFilter.op})`
      : null

    // Build "after" array
    const afterFilters = before.filter((_, i) => !result.removeIndices.includes(i))
    if (result.addFilter) afterFilters.push(result.addFilter)
    const after = afterFilters.map(f => `${f.field}=${f.rawValue}(${f.op})`)

    return { intent: parsed.intent.type, removed, added, after }
  }

  const baseFilters: AppliedFilter[] = [
    makeFilter("toolSubtype", "Square"),
    makeFilter("fluteCount", "2"),
    makeFilter("coating", "TiAlN"),
    makeFilter("brand", "CRX-S"),
  ]

  it("CRX S 가 아닌걸로 → brand eq 제거 + neq 추가", () => {
    const r = simulateApply("CRX S 가 아닌걸로", baseFilters)!
    expect(r.intent).toBe("exclude_field")
    expect(r.removed).toEqual(["brand=CRX-S(eq)"])
    expect(r.added).toBe("brand=CRX S(neq)")
    expect(r.after).toEqual([
      "toolSubtype=Square(eq)",
      "fluteCount=2(eq)",
      "coating=TiAlN(eq)",
      "brand=CRX S(neq)",
    ])
  })

  it("CRX S 말고 다른 브랜드 → brand eq 제거 + neq 추가", () => {
    const r = simulateApply("CRX S 말고 다른 브랜드", baseFilters)!
    expect(r.intent).toBe("exclude_field")
    expect(r.removed).toEqual(["brand=CRX-S(eq)"])
    expect(r.added).toContain("brand=")
    expect(r.added).toContain("(neq)")
  })

  it("2날 말고 4날로 → fluteCount eq 교체", () => {
    const r = simulateApply("2날 말고 4날로", baseFilters)!
    expect(r.intent).toBe("replace_field")
    expect(r.removed).toEqual(["fluteCount=2(eq)"])
    expect(r.added).toBe("fluteCount=4(eq)")
    expect(r.after).toEqual([
      "toolSubtype=Square(eq)",
      "coating=TiAlN(eq)",
      "brand=CRX-S(eq)",
      "fluteCount=4(eq)",
    ])
  })

  it("브랜드는 상관없음 → brand 필터 전부 제거", () => {
    const r = simulateApply("브랜드는 상관없음", baseFilters)!
    expect(r.intent).toBe("clear_field")
    expect(r.removed).toEqual(["brand=CRX-S(eq)"])
    expect(r.added).toBeNull()
    expect(r.after).toEqual([
      "toolSubtype=Square(eq)",
      "fluteCount=2(eq)",
      "coating=TiAlN(eq)",
    ])
  })

  it("이전으로 돌아가서 CRX S 제외 → goBack + neq 추가", () => {
    const parsed = parseEditIntent("이전으로 돌아가서 CRX S 제외", baseFilters)!
    expect(parsed.intent.type).toBe("go_back_then_apply")
    const result = applyEditIntent(parsed.intent, baseFilters, 10)
    expect(result.goBack).toBe(true)
    expect(result.addFilter!.op).toBe("neq")
    expect(result.addFilter!.field).toBe("brand")
  })
})

// ── applyEditIntent (unit) ──────────────────────────────────

describe("applyEditIntent", () => {
  const filters: AppliedFilter[] = [
    makeFilter("toolSubtype", "Square"),
    makeFilter("fluteCount", "4"),
    makeFilter("coating", "TiAlN"),
    makeFilter("brand", "CRX-S"),
  ]

  it("replace_field removes old eq and adds new", () => {
    const intent: EditIntent = {
      type: "replace_field",
      field: "coating",
      oldValue: "TiAlN",
      newValue: "DLC",
    }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.removeIndices).toEqual([2]) // coating=TiAlN at index 2
    expect(result.addFilter).not.toBeNull()
    expect(result.addFilter!.field).toBe("coating")
    expect(result.addFilter!.op).toBe("eq")
    expect(result.addFilter!.rawValue).toBe("DLC")
    expect(result.goBack).toBe(false)
  })

  it("exclude_field removes matching eq and adds neq", () => {
    const intent: EditIntent = {
      type: "exclude_field",
      field: "brand",
      value: "CRX-S",
    }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.removeIndices).toEqual([3]) // brand=CRX-S at index 3
    expect(result.addFilter).not.toBeNull()
    expect(result.addFilter!.op).toBe("neq")
    expect(result.goBack).toBe(false)
  })

  it("exclude_field on non-existing value just adds neq", () => {
    const intent: EditIntent = {
      type: "exclude_field",
      field: "coating",
      value: "DLC",
    }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.removeIndices).toEqual([]) // no DLC eq filter
    expect(result.addFilter!.op).toBe("neq")
  })

  it("clear_field removes all filters for that field", () => {
    const intent: EditIntent = { type: "clear_field", field: "brand" }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.removeIndices).toEqual([3])
    expect(result.addFilter).toBeNull()
  })

  it("go_back_then_apply sets goBack=true", () => {
    const intent: EditIntent = {
      type: "go_back_then_apply",
      inner: { type: "exclude_field", field: "brand", value: "CRX-S" },
    }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.goBack).toBe(true)
    expect(result.addFilter!.op).toBe("neq")
  })

  it("reset_all removes all filters", () => {
    const intent: EditIntent = { type: "reset_all" }
    const result = applyEditIntent(intent, filters, 5)
    expect(result.removeIndices).toEqual([0, 1, 2, 3])
    expect(result.addFilter).toBeNull()
  })
})
