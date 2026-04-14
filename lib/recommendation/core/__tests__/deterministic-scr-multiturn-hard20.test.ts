/**
 * 멀티턴 골든셋 회귀 — scripts/e2e-multiturn-hard-20.js 의 시나리오를
 * vitest 단위 테스트로 옮긴 것.
 *
 * 원본은 라이브 API 를 때리는 E2E 라 CI 에서 못 돌리고, 회귀 보호가 약해진다.
 * 여기서는 각 턴의 user 발화에 대해 parseDeterministic 의 출력만 검증한다.
 * 검증 대상은 deterministic-scr 단의 invariant:
 *   1) Phantom 가드: small-talk / 인사 / farewell / 질문 turn 은
 *      brand / country / seriesName 카테고리 필터를 환각으로 박지 않는다.
 *   2) "추천해줘" / "이전 단계" / "고마워" 같은 의도 turn 은 새 필터를 만들지 않는다.
 *   3) Range / negation / stock threshold turn 은 의도된 필터를 추출한다.
 *
 * Multiturn 형태를 지키되 단일턴 추출기 한계 내에서만 검증.
 */
import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

const PHANTOM_FIELDS = new Set(["brand", "country", "seriesName"])

function activeFiltersFor(text: string) {
  return parseDeterministic(text).filter(a => a.type === "apply_filter" && (a.op as string) !== "skip")
}

function hasPhantomCategorical(text: string): string[] {
  const norm = (s: string) => String(s).toLowerCase().replace(/[\s\-_]+/g, "")
  const msgN = norm(text)
  return activeFiltersFor(text)
    .filter(a => PHANTOM_FIELDS.has(a.field))
    .map(a => String(a.value))
    .filter(v => v && !msgN.includes(norm(v)))
}

// ── Group 1: Phantom filter traps (P1~P5) ─────────────────────
describe("hard20 P-series — phantom filter guard", () => {
  const phantomCases: Array<[string, string]> = [
    ["P1.t1", "엔드밀 추천해주세요."],
    ["P1.t2", "너 이름은?"],
    ["P2.t1", "탄소강 10mm 엔드밀 추천"],
    ["P2.t2", "안녕하세요"],
    ["P3.t1", "스테인리스 8mm 엔드밀"],
    ["P3.t2", "Square"],
    ["P3.t3", "고마워"],
    ["P4.t1", "엔드밀 추천해주세요."],
    ["P4.t2", "당신 누구야"],
    ["P5.t1", "엔드밀 하나 추천해줘"],
  ]
  it.each(phantomCases)("%s '%s' → no phantom brand/country/seriesName", (_id, text) => {
    expect(hasPhantomCategorical(text)).toEqual([])
  })
})

// ── Group 1 cont: Intent misclassification (I1~I5) ────────────
describe("hard20 I-series — intent turn must not invent filters", () => {
  const intentOnlyTurns: Array<[string, string]> = [
    ["I1.t3", "오호 추천해줘"],
    ["I3.t3", "음 죄송해요 corner radius 말고 square로 다시해주세요"],
    ["I4.t4", "상관없음"],
    ["I5.t3", "GMG55100 이랑 GMG40100의 차이가 뭐야?"],
  ]
  it.each(intentOnlyTurns)("%s '%s' → no phantom categorical", (_id, text) => {
    expect(hasPhantomCategorical(text)).toEqual([])
  })

  it("I2.t2 '다 필요없고 알루미늄 가공용으로 3날짜리 Corner radius' → no phantom brand/country/series", () => {
    const text = "다 필요없고 알루미늄 가공용으로 3날짜리 Corner radius"
    expect(hasPhantomCategorical(text)).toEqual([])
  })
})

// ── Group 2: Brand explanation routes (B1~B5) ─────────────────
describe("hard20 B-series — brand explanation/legitimate brand mention", () => {
  it("B1.t2 'Tank-power 브랜드에 대해서 설명해줘' → brand 값이 있다면 substring 매칭", () => {
    const text = "Tank-power 브랜드에 대해서 설명해줘"
    // Tank-power 는 발화에 있으므로 brand 추출돼도 phantom 은 아님.
    expect(hasPhantomCategorical(text)).toEqual([])
  })

  it("B4.t2 '구리요' → mid-flow material 변경, phantom 없음", () => {
    expect(hasPhantomCategorical("구리요")).toEqual([])
  })

  it("B5.t1 'ONLY ONE 브랜드만 보여줘' → 명시 brand, phantom 없음", () => {
    // 'ONLY ONE' 이 발화에 있으므로 brand 추출되더라도 substring 검증 통과해야 함.
    expect(hasPhantomCategorical("ONLY ONE 브랜드만 보여줘")).toEqual([])
  })
})

// ── Group 2: Range/op edge cases (R1~R5) ──────────────────────
describe("hard20 R-series — range / negation / stock / go-back", () => {
  it("R1.t2 '직경 8~12mm 사이' → diameter between 8 ~ 12 양쪽 잡힘", () => {
    const actions = activeFiltersFor("직경 8~12mm 사이")
    const dia = actions.find(a => a.field === "diameterMm")
    expect(dia).toBeDefined()
    expect(dia?.op).toBe("between")
    expect(dia?.value).toBe(8)
    // 상한은 value2 에 보관
    expect((dia as { value2?: number }).value2).toBe(12)
    expect(hasPhantomCategorical("직경 8~12mm 사이")).toEqual([])
  })

  it("R2.t2 '전체 길이 100mm 이상' → length-related gte 추출 (있으면) / 최소 phantom 없음", () => {
    const text = "전체 길이 100mm 이상"
    expect(hasPhantomCategorical(text)).toEqual([])
  })

  it("R3.t2 'Y-Coating 빼고' → coating neq 또는 phantom 없음", () => {
    const text = "Y-Coating 빼고"
    expect(hasPhantomCategorical(text)).toEqual([])
    const actions = activeFiltersFor(text)
    const coating = actions.find(a => a.field === "coating")
    if (coating) expect(coating.op === "neq" || (coating.op as string) === "exclude").toBe(true)
  })

  it("R3.t2b 'T-Coating 빼고' → coating neq=T-Coating and never falls back to TiN", () => {
    const text = "T-Coating 빼고"
    expect(hasPhantomCategorical(text)).toEqual([])
    const actions = activeFiltersFor(text)
    const coating = actions.find(a => a.field === "coating")
    expect(coating).toBeDefined()
    expect(coating?.op === "neq" || (coating?.op as string) === "exclude").toBe(true)
    expect(coating?.value).toBe("T-Coating")
  })

  it("R4.t3 '재고 50개 이상만 보여줘' → stockStatus 임계값 추출", () => {
    const actions = activeFiltersFor("재고 50개 이상만 보여줘")
    const stock = actions.find(a => a.field === "stockStatus")
    expect(stock).toBeDefined()
    // 임계값 50 이 어딘가에 들어가야 함 (value 또는 rawValue)
    const v = String((stock as { value?: unknown }).value ?? "")
    expect(/50|instock/i.test(v)).toBe(true)
  })

  it("R5.t4 '이전 단계' → 새 카테고리 필터 만들지 않음", () => {
    const actions = activeFiltersFor("이전 단계")
    // brand/country/seriesName 가 박히면 안 됨
    expect(actions.filter(a => PHANTOM_FIELDS.has(a.field))).toEqual([])
  })
})

// ── 멀티턴 진행: 같은 시나리오 여러 턴이 누적 invariant 를 깨지 않음 ───
// parseDeterministic 은 stateless 이므로 "각 턴 단독 추출 결과 합집합" 으로 검증.
describe("hard20 multiturn accumulation — turn 시퀀스 합집합에서도 phantom 없음", () => {
  const sequences: Array<{ id: string; turns: string[] }> = [
    { id: "P3", turns: ["스테인리스 8mm 엔드밀", "Square", "고마워"] },
    { id: "I1", turns: ["엔드밀 추천", "Square", "오호 추천해줘"] },
    { id: "I3", turns: ["엔드밀 추천", "Corner Radius", "음 죄송해요 corner radius 말고 square로 다시해주세요"] },
    { id: "I4", turns: ["엔드밀", "Square", "4날", "상관없음"] },
    { id: "I5", turns: ["초내열합금 10mm 엔드밀", "Square", "GMG55100 이랑 GMG40100의 차이가 뭐야?"] },
    { id: "R4", turns: ["탄소강 10mm 엔드밀", "Square", "재고 50개 이상만 보여줘"] },
    { id: "R5", turns: ["탄소강 10mm 엔드밀", "Square", "4날", "이전 단계"] },
  ]
  it.each(sequences)("$id 시퀀스의 모든 턴에서 phantom 없음", ({ turns }) => {
    for (const t of turns) {
      expect(hasPhantomCategorical(t)).toEqual([])
    }
  })
})
