/**
 * 긴급 버그 1: NEQ 필터 생성 + 버그 2: reasoning rescue 테스트
 */
import { describe, expect, it } from "vitest"
import { buildAppliedFilterFromValue, buildDbWhereClauseForFilter } from "@/lib/recommendation/shared/filter-field-registry"
import { validateAction } from "@/lib/recommendation/core/single-call-router"
import type { AppliedFilter } from "@/lib/types/exploration"

describe("NEQ 필터 — buildDbWhereClauseForFilter", () => {
  it("op=neq → NOT (eq clause) 생성", () => {
    const filter: AppliedFilter = {
      field: "coating",
      op: "neq",
      value: "TiAlN 제외",
      rawValue: "TiAlN",
      appliedAt: 0,
    }
    let paramIdx = 0
    const params: unknown[] = []
    const clause = buildDbWhereClauseForFilter(filter, (v) => {
      params.push(v)
      return `$${++paramIdx}`
    })
    expect(clause).not.toBeNull()
    expect(clause).toContain("NOT")
    expect(clause).toContain("LIKE")
    expect(params).toContain("%tialn%")
  })

  it("op=neq toolSubtype → NOT clause", () => {
    const filter: AppliedFilter = {
      field: "toolSubtype",
      op: "neq",
      value: "Ball 제외",
      rawValue: "Ball",
      appliedAt: 0,
    }
    let paramIdx = 0
    const clause = buildDbWhereClauseForFilter(filter, (v) => {
      return `$${++paramIdx}`
    })
    expect(clause).not.toBeNull()
    expect(clause).toContain("NOT")
  })

  it("op=skip → null (기존 동작 유지)", () => {
    const filter: AppliedFilter = {
      field: "coating",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: 0,
    }
    const clause = buildDbWhereClauseForFilter(filter, () => "$1")
    expect(clause).toBeNull()
  })

  it("op=eq → 기존 동작 유지", () => {
    const filter = buildAppliedFilterFromValue("coating", "TiAlN")!
    expect(["eq", "includes"]).toContain(filter.op)
    const clause = buildDbWhereClauseForFilter(filter, (v) => `'${v}'`)
    expect(clause).not.toBeNull()
    expect(clause).not.toContain("NOT")
  })
})

describe("NEQ 필터 — 부정 패턴 값 추출", () => {
  // buildAppliedFilterFromValue로 값 인식 가능 여부 검증
  it.each([
    ["TiAlN", "coating", "TiAlN"],
    ["AlCrN", "coating", "AlCrN"],
    ["DLC", "coating", "DLC"],
    ["Square", "toolSubtype", "Square"],
    ["Ball", "toolSubtype", "Ball"],
    ["Radius", "toolSubtype", "Radius"],
  ])("'%s' → field=%s, value=%s", (input, expectedField, expectedValue) => {
    const filter = buildAppliedFilterFromValue(expectedField, input)
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe(expectedField)
    expect(filter!.rawValue).toBe(expectedValue)
  })
})

describe("SCR action validation — neq op 허용", () => {
  it("apply_filter with op=neq → valid", () => {
    expect(validateAction({ type: "apply_filter", field: "coating", value: "TiAlN", op: "neq" })).toBe(true)
  })

  it("apply_filter with op=eq → valid", () => {
    expect(validateAction({ type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" })).toBe(true)
  })
})

describe("SCR reasoning rescue — field=value 패턴 추출", () => {
  // rescueActionsFromReasoning은 내부 함수이므로 간접 테스트
  // buildAppliedFilterFromValue가 다양한 값을 처리하는지 확인
  it.each([
    ["workPieceName", "탄소강", "탄소강"],
    ["workPieceName", "구리", "구리"],
    ["workPieceName", "SUS304", "SUS304"],
    ["diameterMm", "10", 10],
    ["fluteCount", "4", 4],
    ["toolSubtype", "Square", "Square"],
    ["coating", "TiAlN", "TiAlN"],
  ])("buildAppliedFilterFromValue('%s', '%s') → %s", (field, input, expected) => {
    const filter = buildAppliedFilterFromValue(field, input)
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(expected)
  })
})
