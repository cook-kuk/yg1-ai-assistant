import { describe, test, expect } from "vitest"
import { resolveFieldFromKorean } from "../auto-synonym"
import { parseEditIntent } from "../edit-intent"

describe("resolveFieldFromKorean", () => {
  test("기본 매핑", () => {
    expect(resolveFieldFromKorean("코팅")).toBe("coating")
    expect(resolveFieldFromKorean("직경")).toBe("diameterMm")
    expect(resolveFieldFromKorean("날수")).toBe("fluteCount")
    expect(resolveFieldFromKorean("브랜드")).toBe("brand")
    expect(resolveFieldFromKorean("형상")).toBe("toolSubtype")
    expect(resolveFieldFromKorean("시리즈")).toBe("seriesName")
    expect(resolveFieldFromKorean("생크")).toBe("shankType")
    expect(resolveFieldFromKorean("전장")).toBe("overallLengthMm")
    expect(resolveFieldFromKorean("국가")).toBe("country")
  })

  test("조사 제거", () => {
    expect(resolveFieldFromKorean("코팅은")).toBe("coating")
    expect(resolveFieldFromKorean("브랜드는")).toBe("brand")
    expect(resolveFieldFromKorean("직경을")).toBe("diameterMm")
  })

  test("없는 필드", () => {
    expect(resolveFieldFromKorean("아무말")).toBeNull()
  })
})

describe("parseEditIntent with auto-field", () => {
  test("코팅 상관없음 → clear coating", () => {
    const result = parseEditIntent("코팅은 상관없음")
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("coating")
    }
  })

  test("브랜드 아무거나 → clear brand", () => {
    const result = parseEditIntent("브랜드 아무거나")
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("brand")
    }
  })

  test("직경 상관없어 → clear diameterMm", () => {
    const result = parseEditIntent("직경 상관없어")
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("diameterMm")
    }
  })

  test("생크 뭐든 → clear shankType", () => {
    const result = parseEditIntent("생크 뭐든")
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("shankType")
    }
  })
})

describe("reject_applied_filter (negation fallback)", () => {
  const existing = [
    { field: "brand", op: "eq", value: "X1-EH", rawValue: "X1-EH", appliedAt: 0 },
  ] as const

  test("entity 없음 + field 키워드: '브랜드 잘못' → clear brand", () => {
    const result = parseEditIntent("브랜드 잘못 들어갔어요", existing as never)
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("brand")
    }
  })

  test("entity 없음 + 요청 안 했: '브랜드 요청한 적 없어요' → clear brand", () => {
    const result = parseEditIntent("브랜드 요청한 적 없어요", existing as never)
    expect(result?.intent.type).toBe("clear_field")
    if (result?.intent.type === "clear_field") {
      expect(result.intent.field).toBe("brand")
    }
  })

  test("filter 없으면 null", () => {
    const result = parseEditIntent("브랜드 잘못 들어갔어요", [])
    expect(result).toBeNull()
  })
})
