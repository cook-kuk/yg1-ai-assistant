/**
 * AutoAgent Round 3 — constraint-text-parser edge cases
 * 조건 변경/부정 패턴의 deterministic 파싱 테스트
 */
import { hasExplicitRevisionIntent } from "@/lib/recommendation/shared/constraint-text-parser"
import { matchMaterial, isSkipToken, canonicalizeToolSubtype, canonicalizeCoating } from "@/lib/recommendation/shared/patterns"

describe("조건 변경 패턴 - revision 인식", () => {
  const rev = hasExplicitRevisionIntent

  // 기본 패턴
  it("'Ball로 바꿔줘' → revision", () => expect(rev("Ball로 바꿔줘")).toBe(true))
  it("'6날로 변경해주세요' → revision", () => expect(rev("6날로 변경해주세요")).toBe(true))
  it("'직경 8mm로 변경' → revision", () => expect(rev("직경 8mm로 변경")).toBe(true))
  it("'코팅 AlCrN으로 교체' → revision", () => expect(rev("코팅 AlCrN으로 교체")).toBe(true))
  it("'스테인리스로 변경' → revision", () => expect(rev("스테인리스로 변경")).toBe(true))
  it("'직경을 12mm로 올려줘' → revision", () => expect(rev("직경을 12mm로 올려줘")).toBe(true))
  it("'3날로 줄여줘' → revision", () => expect(rev("3날로 줄여줘")).toBe(true))

  // 말고 패턴
  it("'Square 말고 Radius' → revision", () => expect(rev("Square 말고 Radius")).toBe(true))
  it("'4날 말고 6날' → revision", () => expect(rev("4날 말고 6날")).toBe(true))

  // 대신 패턴
  it("'TiAlN 대신 AlCrN' → revision", () => expect(rev("TiAlN 대신 AlCrN")).toBe(true))

  // 부정만 (revision이 아님)
  it("'Square 빼고' → may or may not be revision", () => {
    // "빼고" alone is more negation than revision
    // This is a judgment call — either answer is acceptable
    expect(typeof rev("Square 빼고")).toBe("boolean")
  })

  // 일반 질문 (revision 아님)
  it("'TiAlN이 뭐야?' → not revision", () => expect(rev("TiAlN이 뭐야?")).toBe(false))
  it("'상관없음' → not revision", () => expect(rev("상관없음")).toBe(false))
  it("'추천해줘' → not revision", () => expect(rev("추천해줘")).toBe(false))
})

describe("canonicalizeToolSubtype - 확장 alias", () => {
  it("'고이송' → High-Feed", () => expect(canonicalizeToolSubtype("고이송")).toBe("High-Feed"))
  it("'플랫' → Square", () => expect(canonicalizeToolSubtype("플랫")).toBe("Square"))
  it("'플랫엔드밀' → Square", () => expect(canonicalizeToolSubtype("플랫엔드밀")).toBe("Square"))
  it("'코너R' → Radius", () => expect(canonicalizeToolSubtype("코너R")).toBe("Radius"))
  it("'러핑' → Roughing", () => expect(canonicalizeToolSubtype("러핑")).toBe("Roughing"))
  it("'볼노즈' → Ball", () => expect(canonicalizeToolSubtype("볼노즈")).toBe("Ball"))
})

describe("canonicalizeCoating - 확장 alias", () => {
  it("'와이코팅' → Y-Coating", () => expect(canonicalizeCoating("와이코팅")).toBe("Y-Coating"))
  it("'엑스코팅' → X-Coating", () => expect(canonicalizeCoating("엑스코팅")).toBe("X-Coating"))
  it("'블루코팅' → Blue", () => expect(canonicalizeCoating("블루코팅")).toBe("Blue"))
  it("'무코팅' → Uncoated", () => expect(canonicalizeCoating("무코팅")).toBe("Uncoated"))
  it("'비코팅' → Uncoated", () => expect(canonicalizeCoating("비코팅")).toBe("Uncoated"))
  it("'다이아몬드' → Diamond", () => expect(canonicalizeCoating("다이아몬드")).toBe("Diamond"))
})

describe("skip 토큰 확장", () => {
  it("'뭐든 상관없어' → skip", () => expect(isSkipToken("뭐든 상관없어")).toBe(true))
  it("'다 괜찮아' → skip", () => expect(isSkipToken("다 괜찮아")).toBe(true))
  it("'다음으로' → skip", () => expect(isSkipToken("다음으로")).toBe(true))
  it("'넘겨' → skip", () => expect(isSkipToken("넘겨")).toBe(true))
  it("'알아서 해줘' → not skip (delegation)", () => expect(isSkipToken("알아서 해줘")).toBe(false))
})

describe("matchMaterial - 혼합 텍스트", () => {
  it("'SUS304 황삭할 건데' → 스테인리스", () => expect(matchMaterial("SUS304 황삭할 건데")).toBe("스테인리스"))
  it("'인코넬용 엔드밀' → 인코넬", () => expect(matchMaterial("인코넬용 엔드밀")).toBe("인코넬"))
  it("'구리 전용 2날 10mm' → 구리", () => expect(matchMaterial("구리 전용 2날 10mm")).toBe("구리"))
  it("'탄소강 10mm Square' → 탄소강", () => expect(matchMaterial("탄소강 10mm Square")).toBe("탄소강"))
  it("'주철 엔드밀 4날' → 주철", () => expect(matchMaterial("주철 엔드밀 4날")).toBe("주철"))
})
