/**
 * 실제 사용자 피드백 (low_rated.json / golden-runner-result.json) 에서 verbatim 발췌한
 * 빡센 멀티필터 회귀.
 *
 * 합성 케이스가 아닌 진짜 사용자 발화 — 한국어 변형, 색상 이름, 분수 인치, 다중 negation,
 * 비공식 단위(파이/날장) 등이 섞여 있다. 여기서 fail 하는 것 = production 에서 사용자가
 * 진짜로 칠 때 백엔드가 못 잡는 것.
 */
import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

function f(text: string, field: string) {
  return parseDeterministic(text).find(a => a.field === field)
}

describe("real feedback: low_rated.json verbatim", () => {
  it("'HRc60이상 되는 피삭재를 가공할꺼야. 파란색상의 제품이 있던데 그게 고경도강용으로 알고있음 2날 12파이 제품으로 추천해줘'", () => {
    const text = "HRc60이상 되는 피삭재를 가공할꺼야. 파란색상의 제품이 있던데 그게 고경도강용으로 알고있음 2날 12파이 제품으로 추천해줘"
    const actions = parseDeterministic(text)
    // workMaterial: 고경도강 → H (또는 HRc60 으로도 H 매핑)
    expect(actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "H")).toBeDefined()
    // 날수 2
    expect(f(text, "fluteCount")?.value).toBe(2)
    // 직경 12 (파이는 = 직경 한국 구어체)
    expect(f(text, "diameterMm")?.value).toBe(12)
  })

  it("'직경이 16mm, 날장이 40 정도 되는 와이지원의 하이스 엔드밀을 추천해주세요'", () => {
    const text = "직경이 16mm, 날장이 40 정도 되는 와이지원의 하이스 엔드밀을 추천해주세요"
    expect(f(text, "diameterMm")?.value).toBe(16)
    expect(f(text, "lengthOfCutMm")?.value).toBe(40)
    expect(f(text, "toolMaterial")?.value).toBe("HSS")
  })

  it("'흑연가공을 하고 있어요, 깊이가 깊은 가공이 필요해서 유효길이가 있는 제품이 필요해요, 전장은 80이상으로 추천해주세요'", () => {
    const text = "흑연가공을 하고 있어요, 깊이가 깊은 가공이 필요해서 유효길이가 있는 제품이 필요해요, 전장은 80이상으로 추천해주세요"
    // 흑연 → workMaterial=O (그라파이트)
    expect(parseDeterministic(text).find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "O")).toBeDefined()
    // 전장 80 이상
    const oal = f(text, "overallLengthMm")
    expect(oal?.value).toBe(80)
    expect(oal?.op).toBe("gte")
  })

  it("'국내용 제품으로 추천해줄래?' → country=한국 (동의어 viaExplicitCue)", () => {
    const a = f("국내용 제품으로 추천해줄래?", "country")
    expect(a?.value).toBe("한국")
  })

  it("'코팅은 상관없고, 소재는 알루미늄입니다' → workMaterial=N", () => {
    const text = "코팅은 상관없고, 소재는 알루미늄입니다"
    expect(parseDeterministic(text).find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "N")).toBeDefined()
  })

  it("'4날이 좋겠고, 가장 인기있는 아이템을 추천해줘' → fluteCount=4", () => {
    const a = f("4날이 좋겠고, 가장 인기있는 아이템을 추천해줘", "fluteCount")
    expect(a?.value).toBe(4)
  })

  it("'와이지원 카바이드 엔드밀 제품 중 제일 날장이 긴 제품을 알려주세요' → toolMaterial=Carbide", () => {
    const a = f("와이지원 카바이드 엔드밀 제품 중 제일 날장이 긴 제품을 알려주세요", "toolMaterial")
    expect(a?.value).toBe("Carbide")
  })
})

describe("real feedback: golden-runner-result.json verbatim", () => {
  it("'CRX S 빼고' → brand=CRX-S neq", () => {
    const a = f("CRX S 빼고", "brand")
    expect(a).toBeDefined()
    expect(String(a?.value).toUpperCase().replace(/[\s-]/g, "")).toBe("CRXS")
    expect(a?.op).toBe("neq")
  })

  it("'2날 말고 4날로' → fluteCount=4 (replace, 마지막 값 우선)", () => {
    const actions = parseDeterministic("2날 말고 4날로")
    const flutes = actions.filter(a => a.field === "fluteCount")
    // 최소 1개의 fluteCount 액션이 4 또는 (2 neq + 4 eq) 형태로 잡혀야 함
    const has4 = flutes.some(a => a.value === 4 && a.op !== "neq")
    expect(has4).toBe(true)
  })

  it("'이전으로 돌아가서 CRX S 제외' → brand neq CRX-S", () => {
    const a = f("이전으로 돌아가서 CRX S 제외", "brand")
    expect(a).toBeDefined()
    expect(a?.op).toBe("neq")
  })

  it("'전장 100mm 이상' → overallLengthMm gte 100", () => {
    const a = f("전장 100mm 이상", "overallLengthMm")
    expect(a?.value).toBe(100)
    expect(a?.op).toBe("gte")
  })

  it("'전장 200mm 이상' → overallLengthMm gte 200", () => {
    const a = f("전장 200mm 이상", "overallLengthMm")
    expect(a?.value).toBe(200)
    expect(a?.op).toBe("gte")
  })
})

describe("real feedback: heavy multi-spec verbatim", () => {
  it("'1/2 인치 알루미늄 ALU-POWER' → diameter 12.7 + N + brand", () => {
    const text = "1/2 인치 알루미늄 ALU-POWER 추천해줘"
    const actions = parseDeterministic(text)
    const dia = actions.find(a => a.field === "diameterMm")
    expect(dia?.value).toBeCloseTo(12.7, 1)
    expect(actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "N")).toBeDefined()
    const brand = actions.find(a => a.field === "brand")
    expect(brand).toBeDefined()
  })

  it("'스테인리스 8mm Side Milling 4날 카바이드 TiAlN' → 5+ 필드", () => {
    const text = "스테인리스 8mm Side Milling 4날 카바이드 TiAlN"
    const actions = parseDeterministic(text)
    const fields = new Map(actions.map(a => [a.field, a]))

    expect(fields.get("diameterMm")?.value).toBe(8)
    expect(fields.get("fluteCount")?.value).toBe(4)
    expect(fields.get("toolMaterial")?.value).toBe("Carbide")
    expect(fields.get("coating")?.value).toBe("TiAlN")
    expect(fields.get("applicationShape")?.value).toBe("Side_Milling")
    expect(actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "M")).toBeDefined()
  })

  it("'고경도강 4mm Ball X1-EH 국내용' → 4+ 필드 (브랜드 + 국가 동의어)", () => {
    const text = "고경도강 4mm Ball X1-EH 국내용"
    const actions = parseDeterministic(text)
    const fields = new Map(actions.map(a => [a.field, a]))

    expect(fields.get("diameterMm")?.value).toBe(4)
    expect(actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "H")).toBeDefined()
    expect(fields.get("country")?.value).toBe("한국")
    const brand = actions.find(a => a.field === "brand")
    expect(brand).toBeDefined()
  })

  it("'주철 Slotting 16mm 5날 짧은 시리즈' → workMaterial=K + 가공형상 + 직경 + 날수", () => {
    const text = "주철 Slotting 16mm 5날 짧은 시리즈"
    const actions = parseDeterministic(text)
    const fields = new Map(actions.map(a => [a.field, a]))
    expect(fields.get("diameterMm")?.value).toBe(16)
    expect(fields.get("fluteCount")?.value).toBe(5)
    expect(fields.get("applicationShape")?.value).toBe("Slotting")
    expect(actions.find(a => (a.field === "workMaterial" || a.field === "material") && a.value === "K")).toBeDefined()
  })
})
