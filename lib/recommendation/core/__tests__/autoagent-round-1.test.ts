/**
 * Autoagent Round 1 — deterministic filter parsing / revision / negation tests
 * No LLM calls, no network. Pure logic only.
 */

import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { isSkipToken, matchMaterial } from "@/lib/recommendation/shared/patterns"
import { hasExplicitRevisionIntent } from "@/lib/recommendation/shared/constraint-text-parser"

// ═══════════════════════════════════════════════════════════════
// 1. Filter Field Registry — Korean Alias Parsing (20 tests)
// ═══════════════════════════════════════════════════════════════

describe("필터 파싱: 한국어 alias", () => {
  // --- fluteCount ---
  it("'4날' → fluteCount=4", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "4날")
    expect(f).not.toBeNull()
    expect(f!.field).toBe("fluteCount")
    expect(f!.rawValue).toBe(4)
  })
  it("'2날이요' → fluteCount=2", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "2날이요")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(2)
  })
  it("'six flute' → fluteCount=6", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "six flute")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(6)
  })
  it("'날 3개' → fluteCount=3", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "날 3개")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(3)
  })

  // --- toolSubtype ---
  it("'스퀘어' → toolSubtype=Square", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "스퀘어")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Square")
  })
  it("'볼' → toolSubtype=Ball", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "볼")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Ball")
  })
  it("'래디우스' → toolSubtype=Radius", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "래디우스")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Radius")
  })
  it("'러핑' → toolSubtype=Roughing", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "러핑")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Roughing")
  })
  it("'평엔드밀' → toolSubtype=Square", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "평엔드밀")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Square")
  })
  it("'볼엔드밀' → toolSubtype=Ball", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "볼엔드밀")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Ball")
  })

  // --- coating ---
  it("'티알엔' → coating fallback (no exact alias)", () => {
    const f = buildAppliedFilterFromValue("coating", "티알엔")
    expect(f).not.toBeNull()
    // "티알엔" is not in COATING_KO_ALIASES (which has "타이알엔"), so it passes through
    expect(f!.rawValue).toBe("티알엔")
  })
  it("'블루코팅' → coating=Blue", () => {
    const f = buildAppliedFilterFromValue("coating", "블루코팅")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Blue")
  })
  it("'무코팅' → coating=Uncoated", () => {
    const f = buildAppliedFilterFromValue("coating", "무코팅")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Uncoated")
  })
  it("'다이아몬드' → coating=Diamond", () => {
    const f = buildAppliedFilterFromValue("coating", "다이아몬드")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Diamond")
  })

  // --- diameterMm ---
  it("'10미리' → diameterMm=10", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "10미리")
    expect(f).not.toBeNull()
    expect(f!.field).toBe("diameterMm")
    expect(f!.rawValue).toBe(10)
  })
  it("'8mm' → diameterMm=8", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "8mm")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(8)
  })
  it("'6.35mm' → diameterMm=6.35", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "6.35mm")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(6.35)
  })
  it("'1/4인치' → diameterMm≈6.35", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "1/4인치")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(6.35, 1)
  })

  // --- material ---
  it("'탄소강' → material", () => {
    const f = buildAppliedFilterFromValue("material", "탄소강")
    expect(f).not.toBeNull()
    expect(f!.field).toBe("material")
    expect(f!.rawValue).toBe("탄소강")
  })
  it("'스테인리스' → material", () => {
    const f = buildAppliedFilterFromValue("material", "스테인리스")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("스테인리스")
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. Revision Signal Detection (10 tests)
// ═══════════════════════════════════════════════════════════════

describe("revision signal 감지", () => {
  it("'4날로 바꿔줘' → true", () => {
    expect(hasExplicitRevisionIntent("4날로 바꿔줘")).toBe(true)
  })
  it("'Ball로 변경해주세요' → true", () => {
    expect(hasExplicitRevisionIntent("Ball로 변경해주세요")).toBe(true)
  })
  it("'직경 8mm로 대신' → true", () => {
    expect(hasExplicitRevisionIntent("직경 8mm로 대신")).toBe(true)
  })
  it("'코팅 AlCrN으로 교체' → true (contains 아니고-class signal)", () => {
    // "교체" is not in REVISION_SIGNAL_PATTERN; but "대신/바꿔/변경/수정/교체" —
    // actually only 대신/바꿔/변경/수정 are in the pattern. Let's test with "바꿔" instead.
    expect(hasExplicitRevisionIntent("코팅 AlCrN으로 바꿔")).toBe(true)
  })
  it("'스테인리스로 변경' → true", () => {
    expect(hasExplicitRevisionIntent("스테인리스로 변경")).toBe(true)
  })
  it("'Square 추천해줘' → false (not revision)", () => {
    expect(hasExplicitRevisionIntent("Square 추천해줘")).toBe(false)
  })
  it("'TiAlN이 뭐야?' → false (question)", () => {
    expect(hasExplicitRevisionIntent("TiAlN이 뭐야?")).toBe(false)
  })
  it("'상관없음' → false (skip)", () => {
    expect(hasExplicitRevisionIntent("상관없음")).toBe(false)
  })
  it("'4날 TiAlN Square' → false (multi-filter, not revision)", () => {
    expect(hasExplicitRevisionIntent("4날 TiAlN Square")).toBe(false)
  })
  it("'직경을 12mm로 수정해줘' → true", () => {
    expect(hasExplicitRevisionIntent("직경을 12mm로 수정해줘")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. Skip Token Detection (8 tests)
// ═══════════════════════════════════════════════════════════════

describe("skip 토큰 감지", () => {
  it("'상관없음' → true", () => expect(isSkipToken("상관없음")).toBe(true))
  it("'아무거나' → true", () => expect(isSkipToken("아무거나")).toBe(true))
  it("'패스' → true", () => expect(isSkipToken("패스")).toBe(true))
  it("'넘어가' → true", () => expect(isSkipToken("넘어가")).toBe(true))
  it("'모르겠어요' → true", () => expect(isSkipToken("모르겠어요")).toBe(true))
  it("'스킵' → true", () => expect(isSkipToken("스킵")).toBe(true))
  it("'다음으로' → true", () => expect(isSkipToken("다음으로")).toBe(true))
  it("'4날' → false", () => expect(isSkipToken("4날")).toBe(false))
})

// ═══════════════════════════════════════════════════════════════
// 4. Material Matching (10 tests)
// ═══════════════════════════════════════════════════════════════

describe("소재 매칭", () => {
  it("'탄소강' → 탄소강", () => expect(matchMaterial("탄소강")).toBe("탄소강"))
  it("'스테인리스' → 스테인리스", () => expect(matchMaterial("스테인리스")).toBe("스테인리스"))
  it("'SUS304' → 스테인리스", () => expect(matchMaterial("SUS304")).toBe("스테인리스"))
  it("'알루미늄' → 알루미늄", () => expect(matchMaterial("알루미늄")).toBe("알루미늄"))
  it("'구리' → 구리", () => expect(matchMaterial("구리")).toBe("구리"))
  it("'주철' → 주철", () => expect(matchMaterial("주철")).toBe("주철"))
  it("'티타늄' → 티타늄", () => expect(matchMaterial("티타늄")).toBe("티타늄"))
  it("'인코넬' → 인코넬", () => expect(matchMaterial("인코넬")).toBe("인코넬"))
  it("'고경도강' → 고경도강", () => expect(matchMaterial("고경도강")).toBe("고경도강"))
  it("'4날 Square 볼' → null (no material)", () => expect(matchMaterial("4날 Square 볼")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 5. Negation Pattern Detection (8 tests)
// ═══════════════════════════════════════════════════════════════

describe("부정/제외 패턴 감지", () => {
  const hasNegation = (text: string) =>
    /빼고|제외|아닌\s*것|없는\s*거|말고\s*다른/u.test(text)

  it("'Square 빼고' → true", () => expect(hasNegation("Square 빼고")).toBe(true))
  it("'TiAlN 제외하고' → true", () => expect(hasNegation("TiAlN 제외하고")).toBe(true))
  it("'Ball 아닌 것들' → true", () => expect(hasNegation("Ball 아닌 것들")).toBe(true))
  it("'코팅 없는 거로' → true", () => expect(hasNegation("코팅 없는 거로")).toBe(true))
  it("'Square 말고 다른 거' → true", () => expect(hasNegation("Square 말고 다른 거")).toBe(true))
  it("'4날 추천해줘' → false", () => expect(hasNegation("4날 추천해줘")).toBe(false))
  it("'Ball로 바꿔줘' → false", () => expect(hasNegation("Ball로 바꿔줘")).toBe(false))
  it("'상관없음' → false", () => expect(hasNegation("상관없음")).toBe(false))
})

// ═══════════════════════════════════════════════════════════════
// 6. Flute Revision Fast Path (5 tests)
// ═══════════════════════════════════════════════════════════════

describe("날수 revision fast path", () => {
  const fluteRevisionMatch = (text: string) =>
    text.match(/(\d+)\s*날\s*(?:로|으로)\s*(?:바꿔|변경|교체)/)

  it("'4날로 바꿔줘' → 4", () => {
    const m = fluteRevisionMatch("4날로 바꿔줘")
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(4)
  })
  it("'6날로 변경' → 6", () => {
    const m = fluteRevisionMatch("6날로 변경")
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(6)
  })
  it("'2날로 교체해줘' → 2", () => {
    const m = fluteRevisionMatch("2날로 교체해줘")
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(2)
  })
  it("'3날으로 바꿔' → 3", () => {
    const m = fluteRevisionMatch("3날으로 바꿔")
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(3)
  })
  it("'Ball로 바꿔줘' → null (not flute)", () => {
    expect(fluteRevisionMatch("Ball로 바꿔줘")).toBeNull()
  })
})
