import { describe, expect, test } from "vitest"

import { getRoutingDecision } from "../complexity-router"

describe("getRoutingDecision", () => {
  test("단순 칩 클릭 값은 mini/light", () => {
    const r = getRoutingDecision({ message: "4날 (1558개)" })
    expect(r.modelTier).toBe("mini")
    expect(r.reasoningTier).toBe("light")
  })

  test("일반 추천은 full/normal", () => {
    const r = getRoutingDecision({ message: "4날 Square 추천" })
    expect(r.modelTier).toBe("full")
    expect(r.reasoningTier).toBe("normal")
  })

  test("부정 조건은 deep 승격 + full", () => {
    const r = getRoutingDecision({ message: "티타늄 말고 뭐가 좋아?" })
    expect(r.modelTier).toBe("full")
    expect(r.reasoningTier).toBe("deep")
  })

  test("비교 요청은 full + deep 로 승격", () => {
    const r = getRoutingDecision({
      message: "두 제품 비교해줘",
      hasComparisonTargets: true,
    })
    expect(r.modelTier).toBe("full")
    expect(r.reasoningTier).toBe("deep")
  })

  test("SQL 신호(개수)는 full 로 강제 승격", () => {
    const r = getRoutingDecision({ message: "카바이드 엔드밀 몇 개 있어?" })
    expect(r.modelTier).toBe("full")
  })

  test("pending 질문에 대한 단순 yes 응답은 mini 강등", () => {
    const r = getRoutingDecision({ message: "응", hasPendingQuestion: true })
    expect(r.modelTier).toBe("mini")
    expect(r.reasoningTier).toBe("light")
    expect(r.reasons.some(r => r.includes("demote"))).toBe(true)
  })

  test("off-topic 잡담은 mini 강등", () => {
    const r = getRoutingDecision({ message: "난 아무것도 모르는 신입사원이야" })
    expect(r.modelTier).toBe("mini")
  })

  test("필터 없는 수정 요청은 canShortCircuit", () => {
    const r = getRoutingDecision({
      message: "기존 조건 수정",
      appliedFilterCount: 0,
    })
    expect(r.canShortCircuit).toBe(true)
    expect(r.shortCircuitType).toBe("clarify_no_filters")
  })

  test("이전 후보 없는 선택 요청은 canShortCircuit", () => {
    const r = getRoutingDecision({
      message: "1번으로 할게",
      displayedProductsCount: 0,
    })
    expect(r.canShortCircuit).toBe(true)
    expect(r.shortCircuitType).toBe("clarify_missing_selection_context")
  })

  test("긴 잡담은 자동 deep 승격하지 않음", () => {
    const r = getRoutingDecision({
      message: "나는 오늘 아침에 밥을 먹고 출근하는 길에 잠깐 생각을 해봤는데 말이야 이건 정말 긴 문장이지",
    })
    // 도메인 신호 없는 잡담이므로 mini + light 유지
    expect(r.modelTier).toBe("mini")
  })
})
