import { describe, expect, it } from "vitest"
import { parseDeterministic } from "../deterministic-scr"

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
})
