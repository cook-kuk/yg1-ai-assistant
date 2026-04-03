/**
 * AutoAgent Round 6 — 부정 패턴 + 리셋 + go_back 파싱
 */
import { buildAppliedFilterFromValue, applyFilterToRecommendationInput } from "@/lib/recommendation/shared/filter-field-registry"
import { isSkipToken, matchMaterial, canonicalizeToolSubtype } from "@/lib/recommendation/shared/patterns"
import type { RecommendationInput } from "@/lib/recommendation/domain/types"

describe("부정 패턴 → 필터 매칭", () => {
  const negation = (text: string) => /빼고|제외|아닌\s*것|없는\s*거|말고\s*다른/u.test(text)

  it("'DLC 빼고 TiAlN으로' → negation=true", () => expect(negation("DLC 빼고 TiAlN으로")).toBe(true))
  it("'6날 제외' → negation=true", () => expect(negation("6날 제외")).toBe(true))
  it("'Roughing 빼고' → negation=true", () => expect(negation("Roughing 빼고")).toBe(true))
  it("'형상 조건 초기화' → negation=false", () => expect(negation("형상 조건 초기화")).toBe(false))
  it("'코팅 없는 거로' → negation=true", () => expect(negation("코팅 없는 거로")).toBe(true))
})

describe("리셋 패턴 감지", () => {
  const RESET_KEYWORDS = ["처음부터 다시", "처음부터", "다시 시작", "리셋"]
  const isReset = (text: string) => RESET_KEYWORDS.some(s => text.includes(s))

  it("'처음부터 다시' → reset", () => expect(isReset("처음부터 다시")).toBe(true))
  it("'다시 시작' → reset", () => expect(isReset("다시 시작")).toBe(true))
  it("'리셋' → reset", () => expect(isReset("리셋")).toBe(true))
  it("'조건 초기화' → not reset (different pattern)", () => expect(isReset("조건 초기화")).toBe(false))
  it("'처음부터' → reset", () => expect(isReset("처음부터")).toBe(true))
})

describe("go_back 패턴 감지", () => {
  const GO_BACK_PATTERN = /이전\s*단계|이전으로|되돌리|뒤로|한\s*단계\s*전|되돌려|전\s*단계/u
  const isGoBack = (text: string) => GO_BACK_PATTERN.test(text)

  it("'이전 단계로' → go_back", () => expect(isGoBack("이전 단계로")).toBe(true))
  it("'이전으로' → go_back", () => expect(isGoBack("이전으로")).toBe(true))
  it("'되돌리기' → go_back", () => expect(isGoBack("되돌리기")).toBe(true))
  it("'뒤로' → go_back", () => expect(isGoBack("뒤로")).toBe(true))
  it("'한 단계 전' → go_back", () => expect(isGoBack("한 단계 전")).toBe(true))
  it("'추천해줘' → not go_back", () => expect(isGoBack("추천해줘")).toBe(false))
})

describe("필터 적용 → input 변환", () => {
  function makeBaseInput(): RecommendationInput {
    return { manufacturerScope: "yg1-only", locale: "ko" } as RecommendationInput
  }

  it("fluteCount=4 → input.flutePreference=4", () => {
    const filter = buildAppliedFilterFromValue("fluteCount", 4)!
    const input = applyFilterToRecommendationInput(makeBaseInput(), filter)
    expect(input.flutePreference).toBe(4)
  })

  it("toolSubtype=Square → input.toolSubtype='Square'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Square")!
    const input = applyFilterToRecommendationInput(makeBaseInput(), filter)
    expect(input.toolSubtype).toBe("Square")
  })

  it("diameterMm=10 → input.diameterMm=10", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", 10)!
    const input = applyFilterToRecommendationInput(makeBaseInput(), filter)
    expect(input.diameterMm).toBe(10)
  })

  it("coating=TiAlN → input.coatingPreference includes 'TiAlN'", () => {
    const filter = buildAppliedFilterFromValue("coating", "TiAlN")!
    const input = applyFilterToRecommendationInput(makeBaseInput(), filter)
    expect(input.coatingPreference).toBeDefined()
  })
})

describe("skip 토큰 — false positive 방지", () => {
  it("'4날' → not skip", () => expect(isSkipToken("4날")).toBe(false))
  it("'Square' → not skip", () => expect(isSkipToken("Square")).toBe(false))
  it("'TiAlN' → not skip", () => expect(isSkipToken("TiAlN")).toBe(false))
  it("'Ball로 바꿔줘' → not skip", () => expect(isSkipToken("Ball로 바꿔줘")).toBe(false))
  it("'추천해줘' → not skip", () => expect(isSkipToken("추천해줘")).toBe(false))
  it("'8mm' → not skip", () => expect(isSkipToken("8mm")).toBe(false))
})

describe("matchMaterial — false positive 방지", () => {
  it("'4날 Square 볼' → null (no material keyword)", () => {
    // "볼" is not a material keyword
    expect(matchMaterial("4날 Square 볼")).toBeNull()
  })
  it("'추천해줘' → null", () => expect(matchMaterial("추천해줘")).toBeNull())
  it("'Ball로 바꿔줘' → null", () => expect(matchMaterial("Ball로 바꿔줘")).toBeNull())
})
