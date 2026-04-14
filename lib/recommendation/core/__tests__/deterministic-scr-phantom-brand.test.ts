import { describe, expect, it } from "vitest"
import { parseDeterministic, isGroundedCategoricalValue } from "../deterministic-scr"

/**
 * Regression: first-turn intake with no brand mention was auto-applying
 * a phantom `brand` filter because the phonetic consonant-skeleton fuzzy
 * match false-positived on generic Korean text (e.g. "엔드밀 추천" ≈ "SUPER
 * ALLOY"). The phantom guard must drop any brand/country/seriesName filter
 * whose canonical value doesn't actually appear in the user message.
 */
describe("deterministic-scr phantom categorical guard", () => {
  it("엔드밀 추천 → no brand filter (phantom SUPER ALLOY/TitaNox blocked)", () => {
    const actions = parseDeterministic("엔드밀 추천")
    const brand = actions.find(a => a.field === "brand")
    expect(brand).toBeUndefined()
  })

  it("엔드밀 추천해줘 → no brand/country/seriesName", () => {
    const actions = parseDeterministic("엔드밀 추천해줘")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
    expect(actions.find(a => a.field === "country")).toBeUndefined()
    expect(actions.find(a => a.field === "seriesName")).toBeUndefined()
  })

  it("제품 보여줘 → no phantom categorical", () => {
    const actions = parseDeterministic("제품 보여줘")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
    expect(actions.find(a => a.field === "country")).toBeUndefined()
  })

  it("explicit brand mention still works: X-POWER 보여줘 → brand=X-POWER", () => {
    const actions = parseDeterministic("X-POWER 보여줘")
    const brand = actions.find(a => a.field === "brand")
    expect(brand).toBeDefined()
    expect(String(brand?.value).toLowerCase()).toContain("x-power")
  })

  it("Korean transliteration still resolves to the intended brand", () => {
    const actions = parseDeterministic("엑스파워 추천해줘")
    const brand = actions.find(a => a.field === "brand")
    expect(brand?.value).toBe("X-POWER")
  })

  it("indifference wording with a brand cue does not hallucinate a brand filter", () => {
    const actions = parseDeterministic("브랜드 노상관")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
  })

  it("SKD11 material code does not trigger a phantom brand", () => {
    const actions = parseDeterministic("SKD11 가공")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
  })

  it("HSK holder query does not trigger a phantom brand", () => {
    const actions = parseDeterministic("HSK 생크")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
  })

  it("small-talk question does not trigger a phantom brand", () => {
    const actions = parseDeterministic("당신 누구야")
    expect(actions.find(a => a.field === "brand")).toBeUndefined()
  })

  // Word-boundary guard: brand value that only appears as the prefix of a
  // longer alphanumeric token (i.e. inside a product code) is NOT a real
  // mention and must be dropped. Reproduces the I5 failure where asking
  // "GMG55100 이랑 GMG40100의 차이" auto-applied brand=GMG.
  it("brand prefix inside product code is NOT a real mention", () => {
    const actions = parseDeterministic("GMG55100 이랑 GMG40100의 차이가 뭐야?")
    const brand = actions.find(a => a.field === "brand" && String(a.value).toUpperCase() === "GMG")
    expect(brand).toBeUndefined()
  })
})

describe("isGroundedCategoricalValue — material / workPieceName", () => {
  it("rejects industry-only inference: aerospace → Titanium is phantom", () => {
    expect(isGroundedCategoricalValue("workPieceName", "Titanium", "나는 아무것도 몰라요 그냥 에어로스페이스에서 일해요")).toBe(false)
    expect(isGroundedCategoricalValue("material", "Titanium", "aerospace industry")).toBe(false)
  })

  it("accepts Korean alias of workpiece (티타늄 → Titanium)", () => {
    expect(isGroundedCategoricalValue("workPieceName", "Titanium", "티타늄 가공")).toBe(true)
  })

  it("accepts English alias of material (titanium → Titanium)", () => {
    expect(isGroundedCategoricalValue("material", "Titanium", "titanium part")).toBe(true)
  })

  it("accepts material via dense alias (스테인리스 → Stainless Steel)", () => {
    expect(isGroundedCategoricalValue("material", "Stainless Steel", "스테인리스 추천")).toBe(true)
  })

  it("rejects unrelated carbon-steel text for Stainless Steel", () => {
    expect(isGroundedCategoricalValue("material", "Stainless Steel", "탄소강 가공")).toBe(false)
  })
})
