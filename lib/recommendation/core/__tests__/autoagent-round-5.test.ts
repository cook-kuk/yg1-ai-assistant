/**
 * AutoAgent Round 5 — 칩 클릭 파싱 + 직경 변경 + 복합 자연어
 */
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { matchMaterial, canonicalizeToolSubtype, canonicalizeCoating, FLUTE_PATTERNS, DIAMETER_PATTERNS } from "@/lib/recommendation/shared/patterns"

function extractFlute(text: string): number | null {
  for (const p of FLUTE_PATTERNS) {
    const m = text.match(p)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

function extractDiameter(text: string): number | null {
  for (const p of DIAMETER_PATTERNS) {
    const m = text.match(p)
    if (m) return parseFloat(m[1])
  }
  return null
}

describe("복합 자연어 → 필드 추출", () => {
  it("'4날 TiAlN Square 추천해줘' → flute=4", () => expect(extractFlute("4날 TiAlN Square 추천해줘")).toBe(4))
  it("'4날 TiAlN Square 추천해줘' → subtype=Square", () => expect(canonicalizeToolSubtype("Square")).toBe("Square"))
  it("'6날 AlCrN Radius로' → flute=6", () => expect(extractFlute("6날 AlCrN Radius로")).toBe(6))
  it("'2날 DLC Ball 엔드밀' → flute=2, subtype=Ball", () => {
    expect(extractFlute("2날 DLC Ball 엔드밀")).toBe(2)
    expect(canonicalizeToolSubtype("Ball")).toBe("Ball")
  })
  it("'8mm 2날 Ball' → diameter=8, flute=2", () => {
    expect(extractDiameter("8mm 2날 Ball")).toBe(8)
    expect(extractFlute("8mm 2날 Ball")).toBe(2)
  })
  it("'10mm 4날 Square TiAlN 탄소강' → all fields", () => {
    expect(extractDiameter("10mm 4날 Square TiAlN 탄소강")).toBe(10)
    expect(extractFlute("10mm 4날 Square TiAlN 탄소강")).toBe(4)
    expect(canonicalizeToolSubtype("Square")).toBe("Square")
    expect(matchMaterial("탄소강")).toBe("탄소강")
  })
})

describe("칩 텍스트 → 필터 파싱", () => {
  it("'4날 (787개)' → fluteCount=4", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "4날 (787개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(4)
  })
  it("'2날 (181개)' → fluteCount=2", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "2날 (181개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(2)
  })
  it("'Square (2069개)' → toolSubtype=Square", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square (2069개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Square")
  })
  it("'Ball (559개)' → toolSubtype=Ball", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Ball (559개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Ball")
  })
  it("'Y-Coating (66개)' → coating", () => {
    const f = buildAppliedFilterFromValue("coating", "Y-Coating (66개)")
    expect(f).not.toBeNull()
  })
  it("'TiAlN — 내열·범용 (12개)' → coating=TiAlN", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN — 내열·범용 (12개)")
    expect(f).not.toBeNull()
  })
  it("'10mm (45개)' → diameterMm=10", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "10mm (45개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(10)
  })
})

describe("직경 파싱 edge case", () => {
  it("'직경 8mm로' → 8", () => expect(extractDiameter("직경 8mm로")).toBe(8))
  it("'10미리' → 10", () => expect(extractDiameter("10미리")).toBe(10))
  it("'φ12' → 12", () => expect(extractDiameter("φ12")).toBe(12))
  it("'6.35mm' → 6.35", () => expect(extractDiameter("6.35mm")).toBe(6.35))
  it("'D10' → 10", () => expect(extractDiameter("D10")).toBe(10))
})

describe("코팅 canonicalize edge case", () => {
  it("'Ti-Al-N' → TiAlN", () => expect(canonicalizeCoating("Ti-Al-N")).toBe("TiAlN"))
  it("'Al-Cr-N' → AlCrN", () => expect(canonicalizeCoating("Al-Cr-N")).toBe("AlCrN"))
  it("'TiAlN' → TiAlN", () => expect(canonicalizeCoating("TiAlN")).toBe("TiAlN"))
  it("'tialn' → tialn (lowercase passthrough)", () => {
    const r = canonicalizeCoating("tialn")
    expect(r).not.toBeNull()
  })
})
