import { describe, expect, test } from "vitest"

import { checkSessionConsistency } from "../session-consistency-guard"

describe("checkSessionConsistency", () => {
  test("clarify_no_filters: 수정 요청 + 적용 필터 0", () => {
    const r = checkSessionConsistency({
      message: "기존 조건 바꿔줘",
      appliedFilterCount: 0,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(true)
    expect(r.type).toBe("clarify_no_filters")
    expect(r.reply).toMatch(/기존 조건이 없습니다/)
  })

  test("clarify_no_filters: 필터가 있으면 통과", () => {
    const r = checkSessionConsistency({
      message: "기존 조건 바꿔줘",
      appliedFilterCount: 2,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(false)
  })

  test("clarify_missing_compare_targets: 비교 요청 + 대상 부족", () => {
    const r = checkSessionConsistency({
      message: "둘 중 뭐가 더 나아?",
      appliedFilterCount: 1,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(true)
    expect(r.type).toBe("clarify_missing_compare_targets")
  })

  test("clarify_missing_compare_targets: 표시 제품 2개면 통과", () => {
    const r = checkSessionConsistency({
      message: "둘 중 뭐가 더 나아?",
      appliedFilterCount: 1,
      displayedProductsCount: 2,
    })
    expect(r.blocked).toBe(false)
  })

  test("clarify_missing_selection_context: 선택 요청 + 이전 후보 없음", () => {
    const r = checkSessionConsistency({
      message: "1번으로 할게",
      appliedFilterCount: 0,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(true)
    expect(r.type).toBe("clarify_missing_selection_context")
  })

  test("clarify_missing_selection_context: 표시 제품 있으면 통과", () => {
    const r = checkSessionConsistency({
      message: "1번으로 할게",
      appliedFilterCount: 0,
      displayedProductsCount: 3,
    })
    expect(r.blocked).toBe(false)
  })

  test("정상 추천 요청은 통과", () => {
    const r = checkSessionConsistency({
      message: "알루미늄 2mm 황삭 측면가공 추천",
      appliedFilterCount: 0,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(false)
  })

  test("빈 메시지는 통과", () => {
    const r = checkSessionConsistency({
      message: "",
      appliedFilterCount: 0,
      displayedProductsCount: 0,
    })
    expect(r.blocked).toBe(false)
  })
})
