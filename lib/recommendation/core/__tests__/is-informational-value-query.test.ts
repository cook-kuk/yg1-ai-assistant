import { describe, expect, it } from "vitest"

import { isInformationalValueQuery, parseDeterministic } from "../deterministic-scr"

describe("isInformationalValueQuery — 정보성 쿼리 격리", () => {
  describe("단순 카운트 질문은 정보성 쿼리", () => {
    it.each([
      ["몇 개야?"],
      ["몇 개인가?"],
      ["몇 개인지"],
      ["몇 개예요?"],
      ["몇 개입니까?"],
      ["몇개?"],
      ["how many?"],
      ["How many products are there?"],
    ])("detects %s as informational", (message) => {
      expect(isInformationalValueQuery(message)).toBe(true)
    })
  })

  describe("빈/공백 입력", () => {
    it("returns false for empty string", () => {
      expect(isInformationalValueQuery("")).toBe(false)
    })

    it("returns false for whitespace only", () => {
      expect(isInformationalValueQuery("   ")).toBe(false)
    })
  })

  describe("mutation 신호는 정보성이 아님 (FN 방지)", () => {
    it.each([
      ["추천해주되 몇 개 있어?"],
      ["Ball 말고 몇 개 추천?"],
      ["빼고 몇 개만 골라줘"],
      ["필터 바꿔주고 몇 개 보여줘"],
      ["다른 걸로 선택해서 몇 개"],
    ])("does NOT classify %s as informational", (message) => {
      expect(isInformationalValueQuery(message)).toBe(false)
    })
  })

  describe("구조화된 스펙 신호가 있어도 몇개 패턴이 우선 (현재 동작 snapshot)", () => {
    // NOTE: 2단계("몇 개" 매칭)가 3단계(hasStructuredDeterministicSpecSignals)보다 먼저
    // 실행되어 정보성으로 분류된다. 복합 쿼리 FP 위험은 문서화된 한계 —
    // 동작 변경 시 이 테스트도 같이 업데이트할 것.
    it.each([
      ["몇 개야? 직경 8mm 이상으로"],
      ["Ball 엔드밀 몇 개?"],
      ["TiAlN 코팅 드릴 몇 개 있어?"],
    ])("current snapshot: %s → informational (structured signals ignored after 몇개 match)", (message) => {
      expect(isInformationalValueQuery(message)).toBe(true)
    })
  })

  describe("구조화 스펙만 있고 카운트 키워드 없음 → 정보성 아님", () => {
    it.each([
      ["직경 8mm 이상"],
      ["TiAlN 코팅"],
      ["스테인리스강 Ball 엔드밀"],
      ["rpm 5000"],
    ])("does NOT classify %s as informational", (message) => {
      expect(isInformationalValueQuery(message)).toBe(false)
    })
  })

  describe("field_count / general_question 분기 (query-target-classifier 경유)", () => {
    it.each([
      ["코팅 종류 어떤 게 있어?"],
      ["어떤 차이가 있나요?"],
      ["설명해줘"],
      ["뭐야 이거?"],
    ])("%s may be informational via classifier", (message) => {
      // 분류 결과가 field_count/general_question일 때 true.
      // 개별 판정은 classifyQueryTarget의 책임이므로 여기선 불변조건만 확인:
      // 최소한 예외 없이 boolean 반환.
      expect(typeof isInformationalValueQuery(message)).toBe("boolean")
    })
  })

  describe("parseDeterministic 통합 — 정보성 쿼리는 필터 추출 스킵", () => {
    it("returns empty actions for pure count query", () => {
      expect(parseDeterministic("몇 개야?")).toEqual([])
    })

    it("returns empty actions for English how many", () => {
      expect(parseDeterministic("How many?")).toEqual([])
    })

    it("returns empty actions even when diameter is present (snapshot of current precedence)", () => {
      // 복합 쿼리 FP 의도된 현재 동작: "몇 개" 있으면 필터 추출 스킵.
      expect(parseDeterministic("몇 개야? 직경 8mm 이상으로")).toEqual([])
    })

    it("DOES extract filter when mutation cue present (FN 방지)", () => {
      // "추천" cue가 있으면 정보성으로 분류되지 않아 필터 추출 진행.
      const actions = parseDeterministic("추천해주되 직경 8mm 이상인 것 몇 개?")
      // 직경 필터 추출 기대 (정확한 shape은 파서 내부 결정이라 length만 검증).
      expect(actions.length).toBeGreaterThan(0)
    })
  })
})
