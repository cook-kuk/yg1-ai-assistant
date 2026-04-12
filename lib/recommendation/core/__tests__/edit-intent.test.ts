import { describe, expect, it, vi } from "vitest"

import { applyEditIntent, hasEditSignal, parseEditIntent } from "../edit-intent"
import type { AppliedFilter } from "@/lib/types/exploration"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

function makeFilter(field: string, value: string, op: AppliedFilter["op"] = "eq"): AppliedFilter {
  return { field, op, value, rawValue: value, appliedAt: 0 }
}

describe("hasEditSignal", () => {
  it.each([
    "CRX S 말고",
    "TiAlN 빼고",
    "Square 아닌 걸로",
    "Ball로 바꿔줘",
    "브랜드는 상관없음",
    "처음부터 다시",
    "코팅 변경해줘",
  ])("detects Stage 1 edit phrasing: %s", (message) => {
    expect(hasEditSignal(message)).toBe(true)
  })

  it.each([
    "브랜드 노상관",
    "타입 신경 안 써요",
    "형상 알아서 해줘 10mm",
    "코팅은 뭐 아무래도 좋은데 날수만 4날로 해줘",
    "10mm",
    "추천해줘",
  ])("does not force Stage 2 phrasing into Stage 1: %s", (message) => {
    expect(hasEditSignal(message)).toBe(false)
  })
})

describe("parseEditIntent", () => {
  it("parses replace_field for numeric revisions", () => {
    const result = parseEditIntent("2날 말고 4날로")
    expect(result?.intent.type).toBe("replace_field")
    if (result?.intent.type === "replace_field") {
      expect(result.intent.field).toBe("fluteCount")
      expect(result.intent.oldValue).toBe("2")
      expect(result.intent.newValue).toBe("4")
    }
  })

  it("parses exclude_field for deterministic negation", () => {
    const result = parseEditIntent("TiAlN 빼고")
    expect(result?.intent.type).toBe("exclude_field")
    if (result?.intent.type === "exclude_field") {
      expect(result.intent.field).toBe("coating")
      expect(result.intent.value).toBe("TiAlN")
    }
  })

  it("parses skip_field only for the basic fast-path phrases", () => {
    const result = parseEditIntent("브랜드는 상관없음")
    expect(result?.intent.type).toBe("skip_field")
    if (result?.intent.type === "skip_field") {
      expect(result.intent.field).toBe("brand")
    }
  })

  it.each([
    "브랜드 노상관",
    "타입 신경 안 써요",
    "형상 알아서 해줘 10mm",
    "코팅은 뭐 아무래도 좋은데 날수만 4날로 해줘",
  ])("returns null for Stage 2/3 fallback phrases: %s", (message) => {
    expect(parseEditIntent(message)).toBeNull()
  })

  it("parses go_back_then_apply when the wording is explicit", () => {
    const result = parseEditIntent("이전으로 돌아가서 CRX S 제외")
    expect(result?.intent.type).toBe("go_back_then_apply")
  })

  it("parses reset_all", () => {
    const result = parseEditIntent("처음부터 다시")
    expect(result?.intent.type).toBe("reset_all")
  })
})

describe("applyEditIntent", () => {
  it("replaces the existing field with a skip filter", () => {
    const before = [makeFilter("brand", "CRX-S"), makeFilter("coating", "TiAlN")]
    const parsed = parseEditIntent("브랜드는 상관없음", before)
    expect(parsed?.intent.type).toBe("skip_field")
    if (!parsed) return

    const mutation = applyEditIntent(parsed.intent, before, 7)
    expect(mutation.removeIndices).toEqual([0])
    expect(mutation.addFilter).toEqual(
      expect.objectContaining({ field: "brand", op: "skip", rawValue: "skip" }),
    )
  })

  it("keeps Stage 2/3 phrases out of the deterministic mutator", () => {
    expect(parseEditIntent("브랜드 노상관", [makeFilter("brand", "CRX-S")])).toBeNull()
  })
})
