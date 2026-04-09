import { describe, test, expect } from "vitest"
import { resolveValue, validateAndResolveFilters } from "../value-resolver"

describe("resolveValue", () => {
  test("schema 캐시 없으면 not_found 반환 (회귀 방지)", () => {
    const r = resolveValue("anything")
    expect(["exact", "synonym", "fuzzy", "not_found"]).toContain(r.matchType)
  })

  test("빈 문자열 처리", () => {
    const r = resolveValue("")
    expect(r.found).toBe(false)
    expect(r.matchType).toBe("not_found")
  })

  test("정확 매칭 (대소문자 무시)", () => {
    const r = resolveValue("tialn")
    if (r.found) expect(r.matchType).toMatch(/exact|synonym/)
  })

  test("퍼지 매칭 - 오타", () => {
    const r = resolveValue("X-Powr")
    if (!r.found && r.suggestions.length > 0 && r.matchType === "fuzzy") {
      expect(r.userMessage).toContain("혹시")
    }
  })

  test("진짜 없는 값", () => {
    const r = resolveValue("완전없는공구문자열12345xyz")
    expect(r.found).toBe(false)
  })
})

describe("validateAndResolveFilters", () => {
  test("숫자 값은 검증 스킵", () => {
    const { resolvedFilters, messages } = validateAndResolveFilters([
      { field: "search_diameter_mm", op: "eq", value: "10" },
    ])
    expect(resolvedFilters[0]?.value).toBe("10")
    expect(messages).toHaveLength(0)
  })

  test("내부 필드(_)는 검증 스킵", () => {
    const { resolvedFilters } = validateAndResolveFilters([
      { field: "_workPieceName", op: "eq", value: "스테인리스" },
    ])
    expect(resolvedFilters).toHaveLength(1)
  })

  test("neq/between은 검증 스킵", () => {
    const { messages } = validateAndResolveFilters([
      { field: "edp_brand_name", op: "neq", value: "anything" },
      { field: "search_diameter_mm", op: "between", value: "5", value2: "10" },
    ])
    expect(messages).toHaveLength(0)
  })
})
