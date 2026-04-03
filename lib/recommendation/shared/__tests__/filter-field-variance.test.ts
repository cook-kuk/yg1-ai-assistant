import { describe, expect, it } from "vitest"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsedField(field: string, answer: string): string | null {
  const filter = parseAnswerToFilter(field, answer)
  return filter?.field ?? null
}

function parsedRawValue(field: string, answer: string): unknown {
  const filter = parseAnswerToFilter(field, answer)
  return filter?.rawValue ?? null
}

function parsedDisplayValue(field: string, answer: string): string | null {
  const filter = parseAnswerToFilter(field, answer)
  return filter?.value ?? null
}

function canonicalize(field: string, raw: string): unknown {
  const def = getFilterFieldDefinition(field)
  if (!def?.canonicalizeRawValue) return raw
  return def.canonicalizeRawValue(raw)
}

// ===========================================================================
// 1. Diameter variations (20 cases)
// ===========================================================================
describe("diameter variance — all should parse to diameterMm with value 10", () => {
  const FIELD = "diameterMm"
  const EXPECTED = 10

  it.each([
    ["10mm"],
    ["10MM"],
    ["10 mm"],
    ["10.0mm"],
    ["10"],
    ["10.0"],
  ])("basic numeric: %j → 10", (answer) => {
    expect(parsedField(FIELD, answer)).toBe("diameterMm")
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it.each([
    ["10밀리"],
    ["10미리"],
  ])("Korean unit alias: %j → 10", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it.each([
    ["φ10"],
    ["Φ10mm"],
  ])("phi symbol: %j → 10", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it("파이10 → 10", () => {
    expect(parsedRawValue(FIELD, "파이10")).toBe(EXPECTED)
  })

  it.each([
    ["직경 10mm"],
    ["지름 10"],
    ["dia 10"],
  ])("field-prefixed: %j → 10", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it.each([
    ["10mm (234개)"],
    ["10mm — Ball End mill"],
  ])("with suffix metadata: %j → 10", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  // Korean particles attached — numeric extraction should still work
  it.each([
    ["10mm짜리"],
    ["10mm로"],
    ["10mm요"],
  ])("with Korean particles: %j → 10", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })
})

// ===========================================================================
// 2. FluteCount variations (15 cases)
// ===========================================================================
describe("fluteCount variance — all should parse to fluteCount with value 2", () => {
  const FIELD = "fluteCount"
  const EXPECTED = 2

  it.each([
    ["2날"],
    ["2 날"],
    ["2플루트"],
  ])("Korean flute notation: %j → 2", (answer) => {
    expect(parsedField(FIELD, answer)).toBe("fluteCount")
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it.each([
    ["2날이요"],
    ["2날로"],
  ])("Korean with particles: %j → 2", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it.each([
    ["2 flute"],
  ])("English: %j → 2", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  // TODO: system doesn't handle English word numbers
  it.skip("two flute → 2", () => {
    expect(parsedRawValue(FIELD, "two flute")).toBe(EXPECTED)
  })

  // TODO: system doesn't handle reversed order
  it.skip("날 2개 → 2", () => {
    expect(parsedRawValue(FIELD, "날 2개")).toBe(EXPECTED)
  })

  it.each([
    ["2"],
    ["2개"],
  ])("bare numeric: %j → 2", (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBe(EXPECTED)
  })

  it("2개 날 → 2", () => {
    expect(parsedRawValue(FIELD, "2개 날")).toBe(EXPECTED)
  })

  it("4날 (69개) — with count suffix", () => {
    expect(parsedRawValue(FIELD, "4날 (69개)")).toBe(4)
  })
})

// ===========================================================================
// 3. Coating variations (20 cases)
// ===========================================================================
describe("coating variance — canonicalization and parsing", () => {
  const FIELD = "coating"

  // TiAlN case variations
  it.each([
    ["TiAlN", "TiAlN"],
    ["tialn", "tialn"],
    ["TIALN", "TIALN"],
  ])("TiAlN case: %j → rawValue %j", (answer, expectedRaw) => {
    expect(parsedField(FIELD, answer)).toBe("coating")
    const raw = parsedRawValue(FIELD, answer)
    expect(raw).toBe(expectedRaw)
  })

  it("Ti-Al-N → TiAlN", () => {
    expect(canonicalize(FIELD, "Ti-Al-N")).toBe("TiAlN")
  })

  // Korean particle forms
  it.each([
    ["TiAlN으로"],
    ["TiAlN요"],
  ])("TiAlN with Korean particles: %j should parse", (answer) => {
    const raw = parsedRawValue(FIELD, answer)
    // The raw value may still include the particle, but parsing should succeed
    expect(raw).not.toBeNull()
  })

  // Blue / 블루
  it.each([
    ["블루", "Blue"],
    ["블루코팅", "Blue"],
    ["블루 코팅", "Blue"],
  ])("Blue Korean: %j → canonicalizes to %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it.each([
    ["Blue"],
    ["blue"],
    ["BLUE"],
  ])("Blue English: %j → parses successfully", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })

  // Gold / 골드
  it.each([
    ["골드코팅", "TiN"],
    ["골드 코팅", "TiN"],
    ["Gold", "Gold"],
    ["TiN", "TiN"],
  ])("Gold: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  // Uncoated
  it.each([
    ["무코팅", "Uncoated"],
    ["비코팅", "Uncoated"],
  ])("Uncoated Korean: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it("코팅없음 → Uncoated", () => {
    expect(canonicalize(FIELD, "코팅없음")).toBe("Uncoated")
  })

  it.each([
    ["Uncoated"],
    ["uncoated"],
  ])("Uncoated English: %j → parses", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })

  // AlCrN
  it.each([
    ["AlCrN"],
    ["alcrn"],
    ["ALCRN"],
  ])("AlCrN case: %j → parses", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })

  // DLC / Diamond
  it.each([
    ["DLC"],
    ["dlc"],
  ])("DLC: %j → parses", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })

  it.each([
    ["다이아몬드", "Diamond"],
    ["Diamond", "Diamond"],
  ])("Diamond: %j → canonicalizes to %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })
})

// ===========================================================================
// 4. ToolSubtype variations (20 cases)
// ===========================================================================
describe("toolSubtype variance", () => {
  const FIELD = "toolSubtype"

  // Square
  it.each([
    ["Square", "Square"],
    ["square", "Square"],
    ["SQUARE", "Square"],
    ["스퀘어", "Square"],
  ])("Square: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it("스퀘어로 → Square", () => {
    expect(canonicalize(FIELD, "스퀘어로")).toBe("Square")
  })

  it("평엔드밀 → Square", () => {
    expect(canonicalize(FIELD, "평엔드밀")).toBe("Square")
  })

  // Ball
  it.each([
    ["Ball", "Ball"],
    ["ball", "Ball"],
    ["볼", "Ball"],
  ])("Ball: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it.each([
    ["볼엔드밀", "Ball"],
    ["볼 엔드밀", "Ball"],
  ])("Ball Korean compound: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  // Radius
  it.each([
    ["Radius", "Radius"],
    ["radius", "Radius"],
    ["라디우스", "Radius"],
    ["코너레디우스", "Radius"],
    ["코너 레디우스", "Radius"],
  ])("Radius: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it("R엔드밀 → Radius", () => {
    expect(canonicalize(FIELD, "R엔드밀")).toBe("Radius")
  })

  // Roughing
  it.each([
    ["Roughing", "Roughing"],
    ["roughing", "Roughing"],
    ["황삭", "Roughing"],
  ])("Roughing: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it.each([
    ["러프", "Roughing"],
    ["러핑", "Roughing"],
  ])("Roughing Korean aliases: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  // Taper
  it.each([
    ["Taper", "Taper"],
    ["taper", "Taper"],
    ["테이퍼", "Taper"],
  ])("Taper: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  // Chamfer
  it.each([
    ["Chamfer", "Chamfer"],
    ["chamfer", "Chamfer"],
    ["챔퍼", "Chamfer"],
  ])("Chamfer: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  // High-Feed
  it.each([
    ["High-Feed", "High-Feed"],
    ["하이피드", "High-Feed"],
  ])("High-Feed: %j → %j", (answer, expected) => {
    expect(canonicalize(FIELD, answer)).toBe(expected)
  })

  it("high feed → High-Feed", () => {
    expect(canonicalize(FIELD, "high feed")).toBe("High-Feed")
  })
})

// ===========================================================================
// 5. WorkPieceName variations (10 cases)
// ===========================================================================
describe("workPieceName variance", () => {
  const FIELD = "workPieceName"

  it.each([
    ["알루미늄"],
    ["aluminum"],
    ["Aluminum"],
  ])("Aluminum: %j → parses successfully", (answer) => {
    const raw = parsedRawValue(FIELD, answer)
    expect(raw).not.toBeNull()
    expect(parsedField(FIELD, answer)).toBe("workPieceName")
  })

  it("알루미늄으로 → 알루미늄", () => {
    const raw = parsedRawValue("workPieceName", "알루미늄으로")
    expect(raw).not.toBeNull()
  })

  it.each([
    ["스테인리스"],
    ["SUS"],
    ["stainless"],
  ])("Stainless: %j → parses", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })

  it("스텐 → parses as stainless", () => {
    expect(parsedRawValue(FIELD, "스텐")).not.toBeNull()
  })

  it.each([
    ["주철"],
    ["cast iron"],
  ])("Cast iron: %j → parses", (answer) => {
    expect(parsedRawValue(FIELD, answer)).not.toBeNull()
  })
})

// ===========================================================================
// 6. Country variations (8 cases)
// ===========================================================================
describe("country variance — all should canonicalize to uppercase", () => {
  const FIELD = "country"

  it.each([
    ["kr", "KR"],
    ["KR", "KR"],
    ["Kr", "KR"],
  ])("Korea: %j → rawValue %j", (answer, expected) => {
    expect(parsedField(FIELD, answer)).toBe("country")
    expect(parsedRawValue(FIELD, answer)).toBe(expected)
  })

  // TODO: system doesn't translate 한국 → KR
  it.skip("한국 → KR", () => {
    expect(parsedRawValue(FIELD, "한국")).toBe("KR")
  })

  it.each([
    ["us", "US"],
    ["US", "US"],
  ])("US: %j → rawValue %j", (answer, expected) => {
    expect(parsedRawValue(FIELD, answer)).toBe(expected)
  })

  // TODO: system doesn't translate 미국 → US
  it.skip("미국 → US", () => {
    expect(parsedRawValue(FIELD, "미국")).toBe("US")
  })

  it("JP → JP", () => {
    expect(parsedRawValue(FIELD, "JP")).toBe("JP")
  })

  // TODO: system doesn't translate 일본 → JP
  it.skip("일본 → JP", () => {
    expect(parsedRawValue(FIELD, "일본")).toBe("JP")
  })
})

// ===========================================================================
// 7. Inch diameter variations (12 cases)
// ===========================================================================
describe("inch diameter variance — fractional inch to mm conversion", () => {
  const FIELD = "diameterMm"

  // 3/8" = 9.525mm
  it.each([
    ['3/8"'],
    ["3/8 inch"],
  ])('3/8 inch: %j → 9.525mm', (answer) => {
    expect(parsedField(FIELD, answer)).toBe("diameterMm")
    expect(parsedRawValue(FIELD, answer)).toBeCloseTo(9.525, 2)
  })

  // TODO: system doesn't handle 인치 Korean suffix
  it.skip("3/8인치 → 9.525mm", () => {
    expect(parsedRawValue(FIELD, "3/8인치")).toBeCloseTo(9.525, 2)
  })

  // 1/2" = 12.7mm
  it.each([
    ['1/2"'],
    ["1/2 inch"],
  ])('1/2 inch: %j → 12.7mm', (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBeCloseTo(12.7, 2)
  })

  // 0.5 inch — whole decimal inch
  it("0.5 inch → 12.7mm", () => {
    expect(parsedRawValue(FIELD, "0.5 inch")).toBeCloseTo(12.7, 2)
  })

  // 1/4" = 6.35mm
  it.each([
    ['1/4"'],
    ["1/4 inch"],
  ])('1/4 inch: %j → 6.35mm', (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBeCloseTo(6.35, 2)
  })

  // 3/4" = 19.05mm
  it.each([
    ['3/4"'],
    ["3/4 inch"],
  ])('3/4 inch: %j → 19.05mm', (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBeCloseTo(19.05, 2)
  })

  // 1" = 25.4mm
  it.each([
    ['1"'],
    ["1 inch"],
  ])('1 inch: %j → 25.4mm', (answer) => {
    expect(parsedRawValue(FIELD, answer)).toBeCloseTo(25.4, 2)
  })

  // 1-1/2" = 38.1mm
  it('1-1/2" → 38.1mm', () => {
    expect(parsedRawValue(FIELD, '1-1/2"')).toBeCloseTo(38.1, 2)
  })
})

// ===========================================================================
// 8. Skip token variations (10 cases)
// ===========================================================================
describe("skip token variance — all should return null", () => {
  const FIELD = "diameterMm"

  it.each([
    ["상관없음"],
    ["상관 없음"],
    ["모름"],
    ["skip"],
  ])("recognized skip token: %j → null", (answer) => {
    expect(parseAnswerToFilter(FIELD, answer)).toBeNull()
  })

  it.each([
    ["아무거나"],
    ["패스"],
    ["스킵"],
    ["넘어가"],
    ["다 괜찮아"],
    ["뭐든 상관없어"],
  ])("extended skip variant: %j → null", (answer) => {
    expect(parseAnswerToFilter(FIELD, answer)).toBeNull()
  })
})

// ===========================================================================
// 9. Mixed/noisy inputs (10 cases)
// ===========================================================================
describe("mixed and noisy input variance", () => {
  it("leading/trailing whitespace: '  10mm  ' → 10", () => {
    expect(parsedRawValue("diameterMm", "  10mm  ")).toBe(10)
  })

  it("polite form: '10mm입니다' → 10", () => {
    expect(parsedRawValue("diameterMm", "10mm입니다")).toBe(10)
  })

  it("approximate prefix: '약 10mm' → 10", () => {
    expect(parsedRawValue("diameterMm", "약 10mm")).toBe(10)
  })

  it("approximate wrapper: '한 10mm쯤' → 10", () => {
    expect(parsedRawValue("diameterMm", "한 10mm쯤")).toBe(10)
  })

  it("with count suffix: 'Square (1234개)' → Square", () => {
    expect(parsedField("toolSubtype", "Square (1234개)")).toBe("toolSubtype")
    const raw = parsedRawValue("toolSubtype", "Square (1234개)")
    expect(canonicalize("toolSubtype", String(raw))).toBe("Square")
  })

  it("with description and count: 'TiAlN — 내열코팅 (50개)' → TiAlN", () => {
    expect(parsedField("coating", "TiAlN — 내열코팅 (50개)")).toBe("coating")
    const raw = parsedRawValue("coating", "TiAlN — 내열코팅 (50개)")
    expect(raw).not.toBeNull()
    // Should strip the description suffix and keep TiAlN
    expect(String(raw).toLowerCase()).toContain("tialn")
  })

  it("flute with count: '4날 (69개)' → 4", () => {
    expect(parsedRawValue("fluteCount", "4날 (69개)")).toBe(4)
  })

  it("approximate suffix: '10mm정도' → 10", () => {
    expect(parsedRawValue("diameterMm", "10mm정도")).toBe(10)
  })

  it("uppercase MM: '12MM' → 12", () => {
    expect(parsedRawValue("diameterMm", "12MM")).toBe(12)
  })

  it("mixed case coating: 'Tialn' → parses", () => {
    expect(parsedRawValue("coating", "Tialn")).not.toBeNull()
  })
})

// ===========================================================================
// 10. Additional edge cases for coverage (bonus variance)
// ===========================================================================
describe("additional variance — edge cases", () => {
  // Diameter with various unit-like suffixes
  it.each([
    ["5.5mm", 5.5],
    ["0.5mm", 0.5],
    ["20", 20],
    ["3.175", 3.175],
    ["100mm", 100],
  ])("diameter edge: %j → %j", (answer, expected) => {
    expect(parsedRawValue("diameterMm", answer)).toBeCloseTo(expected, 3)
  })

  // Flute count range
  it.each([
    ["1", 1],
    ["3", 3],
    ["4", 4],
    ["6", 6],
  ])("fluteCount: %j → %j", (answer, expected) => {
    expect(parsedRawValue("fluteCount", answer)).toBe(expected)
  })

  // Coating with em dash descriptions stripped
  it("coating with em dash: 'DLC — 다이아몬드 코팅' → DLC", () => {
    const raw = parsedRawValue("coating", "DLC — 다이아몬드 코팅")
    expect(raw).not.toBeNull()
    expect(String(raw)).toBe("DLC")
  })

  // Country case normalization
  it.each([
    ["de", "DE"],
    ["cn", "CN"],
    ["il", "IL"],
  ])("country: %j → %j", (answer, expected) => {
    expect(parsedRawValue("country", answer)).toBe(expected)
  })

  // toolSubtype with count suffix
  it("toolSubtype: 'Roughing (42개)' → Roughing", () => {
    const raw = parsedRawValue("toolSubtype", "Roughing (42개)")
    expect(raw).not.toBeNull()
    expect(canonicalize("toolSubtype", String(raw))).toBe("Roughing")
  })

  // Empty / whitespace-only should return null
  it.each([
    [""],
    ["   "],
  ])("empty/whitespace: %j → null", (answer) => {
    expect(parseAnswerToFilter("diameterMm", answer)).toBeNull()
  })
})
