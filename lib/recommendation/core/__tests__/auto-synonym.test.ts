import { describe, test, expect, beforeEach } from "vitest"
import { tokenize, jaccardSimilarity, getSynonymMap, _resetSynonymMapForTest } from "../auto-synonym"

beforeEach(() => _resetSynonymMapForTest())

describe("auto-synonym getSynonymMap", () => {
  test("patterns.ts 소재 매핑 자동 로드", () => {
    const map = getSynonymMap()
    expect(map.has("알루미늄")).toBe(true)
    expect(map.has("스텐")).toBe(true)
    expect(map.has("sus")).toBe(true)
  })

  test("KG ENTITY_NODES aliases 자동 로드", () => {
    const map = getSynonymMap()
    expect(map.has("스퀘어")).toBe(true)
    expect(map.has("볼노즈")).toBe(true)
    expect(map.has("y코팅")).toBe(true)
  })

  test("compact form 도 등록 (공백/하이픈 제거)", () => {
    const map = getSynonymMap()
    // "y-coating" → "ycoating" 도 매핑되어야 함
    expect(map.has("ycoating") || map.has("y-coating")).toBe(true)
  })
})

describe("auto-synonym tokenize", () => {
  test("SUS304 ≈ 스테인리스 (정규화 후 유사)", () => {
    const sim = jaccardSimilarity(tokenize("스테인리스 엔드밀"), tokenize("SUS304 엔드밀"))
    expect(sim).toBeGreaterThan(0.3)
  })

  test("숫자 보존", () => {
    expect(tokenize("직경 10mm").has("10")).toBe(true)
  })

  test("한국어 조사 제거", () => {
    const t = tokenize("알루미늄으로")
    expect(t.has("으로")).toBe(false)
  })

  test("빈 문자열", () => {
    expect(tokenize("").size).toBe(0)
  })
})

describe("jaccardSimilarity", () => {
  test("동일 → 1", () => {
    const a = new Set(["x", "y"])
    expect(jaccardSimilarity(a, a)).toBe(1)
  })
  test("교집합 없음 → 0", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0)
  })
  test("빈 집합 → 0", () => {
    expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0)
  })
})
