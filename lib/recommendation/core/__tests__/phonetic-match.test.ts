import { describe, expect, it } from "vitest"
import { romanizeHangul, levenshtein, findFuzzyMatch, phoneticKey, loosePhonetic } from "../phonetic-match"

describe("romanizeHangul", () => {
  it("strips punctuation/spaces", () => {
    expect(romanizeHangul("X-POWER")).toBe("xpower")
    expect(romanizeHangul("ALU POWER")).toBe("alupower")
  })
  it("English passes through lowercased", () => {
    expect(romanizeHangul("HELLO")).toBe("hello")
  })
})

describe("loosePhonetic / phoneticKey symmetry", () => {
  it("X-POWER and 엑스파워 collapse to same consonant skeleton kspw...", () => {
    const en = phoneticKey("X-POWER")
    const ko = phoneticKey("엑스파워")
    expect(en).toMatch(/^kspw/)
    expect(ko).toMatch(/^kspw/)
  })
  it("ALU-POWER and 알루파워 share lpw skeleton", () => {
    expect(phoneticKey("ALU-POWER")).toContain("lpw")
    expect(phoneticKey("알루파워")).toContain("lpw")
  })
  it("vowels are dropped", () => {
    expect(loosePhonetic("apple")).toBe("pl")
  })
  it("voicing collapsed, ng→n", () => {
    expect(loosePhonetic("tank")).toBe("tnk")
    expect(loosePhonetic("taeng")).toBe("tn")
    // tank and 탱크 (taengkeu) converge: tnkpwr ↔ tnkpw etc. via fuzzy match
  })
})

describe("levenshtein", () => {
  it("identical → 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0)
  })
  it("single edit → 1", () => {
    expect(levenshtein("abc", "abd")).toBe(1)
    expect(levenshtein("abc", "ab")).toBe(1)
    expect(levenshtein("abc", "abcd")).toBe(1)
  })
  it("empty → length of other", () => {
    expect(levenshtein("", "abc")).toBe(3)
    expect(levenshtein("abc", "")).toBe(3)
  })
})

describe("findFuzzyMatch — Korean brand transliterations", () => {
  const brands = ["X-POWER", "X-POWER PRO", "ALU-POWER", "TitaNox", "TANK-POWER", "JET-POWER", "4G MILL"]

  it("엑스파워 → X-POWER", () => {
    const m = findFuzzyMatch("엑스파워 추천해줘", brands)
    expect(m?.value).toMatch(/X-POWER/)
  })

  it("알루파워 → ALU-POWER", () => {
    const m = findFuzzyMatch("알루파워 시리즈로", brands)
    expect(m?.value).toBe("ALU-POWER")
  })

  it("탱크파워 → TANK-POWER", () => {
    const m = findFuzzyMatch("탱크파워로 부탁", brands)
    expect(m?.value).toBe("TANK-POWER")
  })

  it("제트파워 → JET-POWER", () => {
    const m = findFuzzyMatch("제트파워 어떄?", brands)
    expect(m?.value).toBe("JET-POWER")
  })

  it("타이타녹스 → TitaNox", () => {
    const m = findFuzzyMatch("타이타녹스로 가공", brands)
    expect(m?.value).toBe("TitaNox")
  })

  it("English input still works (substring fast path)", () => {
    const m = findFuzzyMatch("X-POWER series please", brands)
    expect(m?.value).toMatch(/X-POWER/)
    expect(m?.distance).toBe(0)
  })

  it("Unrelated text → null", () => {
    const m = findFuzzyMatch("그냥 추천해줘", brands)
    expect(m).toBeNull()
  })

  it("threshold filters loose matches", () => {
    // "스카이" doesn't sound like any brand
    const m = findFuzzyMatch("스카이", brands)
    expect(m).toBeNull()
  })
})

describe("deterministic-scr brand fuzzy integration", () => {
  it("엑스파워 추천해줘 → brand=X-POWER", async () => {
    const { parseDeterministic } = await import("../deterministic-scr")
    const a = parseDeterministic("엑스파워 추천해줘").find(x => x.field === "brand")
    expect(a?.value).toMatch(/X-POWER/)
    expect(a?.op).toBe("eq")
  })
  it("알루파워 시리즈로 → brand=ALU-POWER", async () => {
    const { parseDeterministic } = await import("../deterministic-scr")
    const a = parseDeterministic("알루파워 시리즈로 부탁").find(x => x.field === "brand")
    expect(a?.value).toBe("ALU-POWER")
  })
  it("타이타녹스 → brand=TitaNox", async () => {
    const { parseDeterministic } = await import("../deterministic-scr")
    const a = parseDeterministic("타이타녹스로 가공하려고").find(x => x.field === "brand")
    expect(a?.value).toBe("TitaNox")
  })
  it("4G MILL은 영문 그대로 → brand=4G MILL", async () => {
    const { parseDeterministic } = await import("../deterministic-scr")
    const a = parseDeterministic("4G MILL 추천해줘").find(x => x.field === "brand")
    expect(a?.value).toBe("4G MILL")
  })
  it("브랜드 언급 없으면 brand 액션 없음", async () => {
    const { parseDeterministic } = await import("../deterministic-scr")
    const a = parseDeterministic("그냥 추천해줘").find(x => x.field === "brand")
    expect(a).toBeUndefined()
  })
})
