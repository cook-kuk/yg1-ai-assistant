import { describe, expect, it } from "vitest"

import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand: parse and return rawValue (single or first element of array) */
function parseRaw(field: string, answer: string) {
  const filter = parseAnswerToFilter(field, answer)
  return filter?.rawValue ?? null
}

/** Shorthand: parse and return display value string */
function parseValue(field: string, answer: string) {
  const filter = parseAnswerToFilter(field, answer)
  return filter?.value ?? null
}

/** Call canonicalizeRawValue directly on a field definition */
function canonicalize(field: string, raw: string) {
  const def = getFilterFieldDefinition(field)
  if (!def?.canonicalizeRawValue) return raw
  return def.canonicalizeRawValue(raw)
}

// ===========================================================================
// 1. Coating alias canonicalization (20 cases)
// ===========================================================================
describe("coating alias canonicalization", () => {
  it.each([
    // Korean color aliases
    ["블루코팅", "Blue"],
    ["블루", "Blue"],
    ["골드코팅", "TiN"],
    ["골드", "Gold"],
    ["블랙코팅", "TiAlN"],
    ["블랙", "Black"],
    ["실버코팅", "Bright"],
    ["실버", "Bright"],
    ["무코팅", "Uncoated"],
    ["비코팅", "Uncoated"],
    ["코팅없", "Uncoated"],
    ["다이아몬드코팅", "Diamond"],
    ["다이아몬드", "Diamond"],
    // English passthrough — must survive canonicalization unchanged
    ["TiAlN", "TiAlN"],
    ["AlCrN", "AlCrN"],
    ["DLC", "DLC"],
    ["TiCN", "TiCN"],
    ["TiN", "TiN"],
    // Mixed / lowercase English passthrough
    ["tialn", "tialn"],
    ["TIALN", "TIALN"],
  ])("canonicalize(%j) → %j", (input, expected) => {
    expect(canonicalize("coating", input)).toBe(expected)
  })

  // Through parseAnswerToFilter — rawValue should be the canonicalized string
  it.each([
    ["블루코팅", "Blue"],
    ["골드코팅", "TiN"],
    ["블랙코팅", "TiAlN"],
    ["실버코팅", "Bright"],
    ["무코팅", "Uncoated"],
    ["비코팅", "Uncoated"],
    ["다이아몬드코팅", "Diamond"],
    ["TiAlN", "TiAlN"],
    ["AlCrN", "AlCrN"],
    ["DLC", "DLC"],
  ])("parseAnswerToFilter('coating', %j).rawValue → %j", (answer, expected) => {
    expect(parseRaw("coating", answer)).toBe(expected)
  })
})

// ===========================================================================
// 2. ToolSubtype alias canonicalization (20 cases)
// ===========================================================================
describe("toolSubtype alias canonicalization", () => {
  it.each([
    // Korean aliases
    ["코너레디우스", "Radius"],
    ["코너 레디우스", "Radius"],
    ["황삭", "Roughing"],
    ["볼", "Ball"],
    ["볼엔드밀", "Ball"],         // includes 볼
    ["스퀘어", "Square"],
    ["테이퍼", "Taper"],
    ["챔퍼", "Chamfer"],
    ["하이피드", "High-Feed"],
    ["라디우스", "Radius"],
    // English aliases
    ["Square", "Square"],
    ["Ball", "Ball"],
    ["Radius", "Radius"],
    ["Roughing", "Roughing"],
    ["Taper", "Taper"],
    ["Chamfer", "Chamfer"],
    ["rough", "Roughing"],
    // Case variations
    ["square", "Square"],
    ["ball", "Ball"],
    ["ROUGHING", "Roughing"],
  ])("canonicalize(%j) → %j", (input, expected) => {
    expect(canonicalize("toolSubtype", input)).toBe(expected)
  })

  // Through parseAnswerToFilter
  it.each([
    ["코너레디우스", "Radius"],
    ["황삭", "Roughing"],
    ["볼", "Ball"],
    ["스퀘어", "Square"],
    ["테이퍼", "Taper"],
    ["챔퍼", "Chamfer"],
    ["하이피드", "High-Feed"],
    ["Square", "Square"],
    ["Ball", "Ball"],
  ])("parseAnswerToFilter('toolSubtype', %j).rawValue → %j", (answer, expected) => {
    expect(parseRaw("toolSubtype", answer)).toBe(expected)
  })
})

// ===========================================================================
// 3. Inch diameter conversion (14 cases)
// ===========================================================================
describe("inch diameter conversion", () => {
  // canonicalizeRawValue on diameterMm should convert fractional inches to mm
  it.each([
    ['3/8"', 9.525],
    ['1/2"', 12.7],
    ['3/4"', 19.05],
    ['1/4"', 6.35],
    ['1"', 25.4],
    ['1-1/2"', 38.1],
    ["1/4 inch", 6.35],
    ["3/8 inch", 9.525],
    ['1/8"', 3.175],
    ['5/16"', 7.9375],
    // Whole inches
    ['2"', 50.8],
    ['2 inch', 50.8],
  ])("canonicalize diameterMm(%j) → %s mm", (input, expectedMm) => {
    const result = canonicalize("diameterMm", input)
    expect(result).toBeCloseTo(expectedMm, 3)
  })

  // Regular mm values should pass through unchanged
  it.each([
    ["10mm", 10],
    ["6.35", 6.35],
    ["25", 25],
    ["12.7mm", 12.7],
  ])("parseAnswerToFilter('diameterMm', %j).rawValue → %s", (answer, expected) => {
    expect(parseRaw("diameterMm", answer)).toBeCloseTo(expected, 3)
  })

  // diameterRefine should also support inch conversion
  it("diameterRefine also converts inches", () => {
    expect(canonicalize("diameterRefine", '3/8"')).toBeCloseTo(9.525, 3)
    expect(canonicalize("diameterRefine", '1/2"')).toBeCloseTo(12.7, 3)
  })
})

// ===========================================================================
// 4. FluteCount parsing (10 cases)
// ===========================================================================
describe("fluteCount parsing", () => {
  it.each([
    ["2날", 2],
    ["3날", 3],
    ["4날", 4],
    ["6날", 6],
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["6", 6],
    ["2플루트", 2],
    ["4플루트", 4],
  ])("parseAnswerToFilter('fluteCount', %j).rawValue → %s", (answer, expected) => {
    expect(parseRaw("fluteCount", answer)).toBe(expected)
  })

  it("fluteCount display value includes unit", () => {
    const filter = parseAnswerToFilter("fluteCount", "4날")
    expect(filter?.value).toBe("4날")
  })

  it("fluteCount op is eq", () => {
    const filter = parseAnswerToFilter("fluteCount", "4")
    expect(filter?.op).toBe("eq")
  })
})

// ===========================================================================
// 5. Numeric fields parsing (24 cases)
// ===========================================================================
describe("numeric field parsing", () => {
  describe("lengthOfCutMm", () => {
    it.each([
      ["25mm", 25],
      ["25", 25],
      ["30.5mm", 30.5],
      ["30.5", 30.5],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("lengthOfCutMm", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes mm unit", () => {
      expect(parseValue("lengthOfCutMm", "25")).toBe("25mm")
    })
  })

  describe("overallLengthMm", () => {
    it.each([
      ["75mm", 75],
      ["75", 75],
      ["100", 100],
      ["150.5mm", 150.5],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("overallLengthMm", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes mm unit", () => {
      expect(parseValue("overallLengthMm", "75")).toBe("75mm")
    })
  })

  describe("shankDiameterMm", () => {
    it.each([
      ["10mm", 10],
      ["10", 10],
      ["6", 6],
      ["12.5mm", 12.5],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("shankDiameterMm", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes mm unit", () => {
      expect(parseValue("shankDiameterMm", "10")).toBe("10mm")
    })
  })

  describe("helixAngleDeg", () => {
    it.each([
      ["45", 45],
      ["45도", 45],
      ["30", 30],
      ["35.5", 35.5],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("helixAngleDeg", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes degree unit", () => {
      expect(parseValue("helixAngleDeg", "45")).toBe("45°")
    })
  })

  describe("ballRadiusMm", () => {
    it.each([
      ["5mm", 5],
      ["5", 5],
      ["3", 3],
      ["2.5mm", 2.5],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("ballRadiusMm", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes mm unit", () => {
      expect(parseValue("ballRadiusMm", "5")).toBe("5mm")
    })
  })

  describe("taperAngleDeg", () => {
    it.each([
      ["3", 3],
      ["5", 5],
      ["1.5", 1.5],
      ["10도", 10],
    ])("parse %j → %s", (answer, expected) => {
      expect(parseRaw("taperAngleDeg", answer)).toBeCloseTo(expected, 3)
    })

    it("display value includes degree unit", () => {
      expect(parseValue("taperAngleDeg", "3")).toBe("3°")
    })
  })
})

// ===========================================================================
// 6. Country uppercase normalization (8 cases)
// ===========================================================================
describe("country canonicalization — MV region codes (KOREA/AMERICA/ASIA/EUROPE)", () => {
  // MV catalog_app.product_recommendation_mv.country_codes stores region names,
  // not ISO alpha-3. See filter-field-registry.ts country.canonicalizeRawValue.
  it.each([
    ["kr", "KOREA"],
    ["us", "AMERICA"],
    ["jp", "ASIA"],
    ["cn", "ASIA"],
    ["de", "EUROPE"],
    ["Kr", "KOREA"],
    ["uS", "AMERICA"],
    // Region passthrough
    ["KOREA", "KOREA"],
    ["ASIA", "ASIA"],
    // Korean names
    ["한국", "KOREA"],
    ["대한민국", "KOREA"],
    ["미국", "AMERICA"],
    ["일본", "ASIA"],
    ["중국", "ASIA"],
    ["독일", "EUROPE"],
    ["영국", "EUROPE"],
    ["프랑스", "EUROPE"],
    ["이탈리아", "EUROPE"],
    ["터키", "EUROPE"],
    ["체코", "EUROPE"],
    // English names
    ["Japan", "ASIA"],
    ["Germany", "EUROPE"],
    ["China", "ASIA"],
    ["Korea", "KOREA"],
  ])("canonicalize country(%j) → %j", (input, expected) => {
    expect(canonicalize("country", input)).toBe(expected)
  })

  it.each([
    ["kr", "KOREA"],
    ["us", "AMERICA"],
    ["KOREA", "KOREA"],
    ["한국", "KOREA"],
    ["Japan", "ASIA"],
    ["독일", "EUROPE"],
  ])("parseAnswerToFilter('country', %j).rawValue → %j", (answer, expected) => {
    expect(parseRaw("country", answer)).toBe(expected)
  })
})

// ===========================================================================
// 7. String fields passthrough (15 cases)
// ===========================================================================
describe("string field passthrough", () => {
  describe("workPieceName", () => {
    it.each([
      ["알루미늄", "알루미늄"],
      ["고경도강", "고경도강"],
      ["스테인리스", "stainless"],  // canonicalized to English
      ["탄소강", "탄소강"],
      ["주철", "주철"],
    ])("parse %j → %j", (answer, expected) => {
      expect(parseRaw("workPieceName", answer)).toBe(expected)
    })
  })

  describe("seriesName", () => {
    it.each([
      "V7 PLUS",
      "4G MILL",
      "X5070",
    ])("parse %j → same string", (answer) => {
      expect(parseRaw("seriesName", answer)).toBe(answer)
    })
  })

  describe("brand", () => {
    it.each([
      "ALU-POWER HPC",
      "TANK-POWER",
      "YG-1",
    ])("parse %j → same string", (answer) => {
      expect(parseRaw("brand", answer)).toBe(answer)
    })
  })

  describe("cuttingType", () => {
    it.each([
      "Side_Milling",
      "Slotting",
      "Profiling",
      "Drilling",
    ])("parse %j → same string", (answer) => {
      expect(parseRaw("cuttingType", answer)).toBe(answer)
    })
  })
})

// ===========================================================================
// 8. Skip tokens return null (6 cases)
// ===========================================================================
describe("skip tokens return null", () => {
  it.each([
    "상관없음",
    "상관 없음",
    "모름",
    "skip",
    "SKIP",
    "Skip",
  ])("parseAnswerToFilter('coating', %j) → null", (answer) => {
    const filter = parseAnswerToFilter("coating", answer)
    expect(filter).toBeNull()
  })
})

// ===========================================================================
// 9. Unknown fields return null
// ===========================================================================
describe("unknown field returns null", () => {
  it("nonexistent field returns null", () => {
    expect(parseAnswerToFilter("nonExistentField", "anything")).toBeNull()
  })

  it("empty string field returns null", () => {
    expect(parseAnswerToFilter("", "anything")).toBeNull()
  })
})

// ===========================================================================
// 10. Empty / whitespace answers return null
// ===========================================================================
describe("empty answers return null", () => {
  it.each([
    "",
    "   ",
    " \t\n ",
  ])("parseAnswerToFilter('coating', %j) → null", (answer) => {
    const filter = parseAnswerToFilter("coating", answer)
    expect(filter).toBeNull()
  })
})

// ===========================================================================
// 11. Filter structure correctness
// ===========================================================================
describe("filter structure correctness", () => {
  it("coating filter has correct field and op", () => {
    const filter = parseAnswerToFilter("coating", "TiAlN")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("coating")
    expect(filter!.op).toBe("includes")
    expect(filter!.appliedAt).toBe(0)
  })

  it("diameterMm filter has correct field and op", () => {
    const filter = parseAnswerToFilter("diameterMm", "10")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("diameterMm")
    expect(filter!.op).toBe("eq")
  })

  it("diameterRefine canonicalField maps to diameterMm", () => {
    const filter = parseAnswerToFilter("diameterRefine", "10")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("diameterMm")
    expect(filter!.op).toBe("eq")
    expect(filter!.rawValue).toBe(10)
  })

  it("toolSubtype filter has includes op", () => {
    const filter = parseAnswerToFilter("toolSubtype", "Square")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("toolSubtype")
    expect(filter!.op).toBe("includes")
  })

  it("country filter has includes op", () => {
    const filter = parseAnswerToFilter("country", "KOR")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("country")
    expect(filter!.op).toBe("includes")
  })

  it("cuttingType filter has eq op and strict_identifier matchPolicy", () => {
    const def = getFilterFieldDefinition("cuttingType")
    expect(def?.matchPolicy).toBe("strict_identifier")
    expect(def?.op).toBe("eq")
  })

  it("seriesName has strict_identifier matchPolicy", () => {
    const def = getFilterFieldDefinition("seriesName")
    expect(def?.matchPolicy).toBe("strict_identifier")
  })
})

// ===========================================================================
// 12. Multi-value parsing (coating with separator)
// ===========================================================================
describe("multi-value parsing", () => {
  it("comma-separated coating values", () => {
    const filter = parseAnswerToFilter("coating", "블루코팅, 골드코팅")
    expect(filter).not.toBeNull()
    const raw = filter!.rawValue
    expect(Array.isArray(raw)).toBe(true)
    expect(raw).toContain("Blue")
    expect(raw).toContain("TiN")
  })

  it("slash-separated toolSubtype values", () => {
    const filter = parseAnswerToFilter("toolSubtype", "볼/스퀘어")
    expect(filter).not.toBeNull()
    const raw = filter!.rawValue
    expect(Array.isArray(raw)).toBe(true)
    expect(raw).toContain("Ball")
    expect(raw).toContain("Square")
  })

  it("또는 separator for fluteCount", () => {
    const filter = parseAnswerToFilter("fluteCount", "2 또는 4")
    expect(filter).not.toBeNull()
    const raw = filter!.rawValue
    expect(Array.isArray(raw)).toBe(true)
    expect(raw).toContain(2)
    expect(raw).toContain(4)
  })
})

// ===========================================================================
// 13. getFilterFieldDefinition returns correct structure
// ===========================================================================
describe("getFilterFieldDefinition returns correct structure", () => {
  it.each([
    "diameterMm",
    "diameterRefine",
    "coating",
    "toolSubtype",
    "fluteCount",
    "country",
    "workPieceName",
    "seriesName",
    "brand",
    "cuttingType",
    "lengthOfCutMm",
    "overallLengthMm",
    "shankDiameterMm",
    "helixAngleDeg",
    "ballRadiusMm",
    "taperAngleDeg",
    "coolantHole",
  ])("definition for %j exists", (field) => {
    const def = getFilterFieldDefinition(field)
    expect(def).not.toBeNull()
    expect(def!.field).toBe(field)
    expect(["string", "number", "boolean"]).toContain(def!.kind)
    expect(["eq", "includes", "range"]).toContain(def!.op)
  })

  it("unknown field returns null", () => {
    expect(getFilterFieldDefinition("doesNotExist")).toBeNull()
  })
})

// ===========================================================================
// 14. Boolean field (coolantHole) parsing
// ===========================================================================
describe("coolantHole boolean parsing", () => {
  it.each([
    ["있음", true],
    ["유", true],
    ["true", true],
    ["yes", true],
    ["없음", false],
    ["무", false],
    ["false", false],
    ["no", false],
  ])("parse %j → %s", (answer, expected) => {
    const filter = parseAnswerToFilter("coolantHole", answer)
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(expected)
  })
})

// ===========================================================================
// 15. Edge cases — answer with count suffix stripped
// ===========================================================================
describe("answer with count suffix stripped", () => {
  it("strips (123개) suffix from answer", () => {
    const filter = parseAnswerToFilter("coating", "TiAlN (45개)")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe("TiAlN")
  })

  it("strips — description suffix from answer", () => {
    const filter = parseAnswerToFilter("toolSubtype", "Square — 평탄한 바닥면")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe("Square")
  })
})

// ===========================================================================
// 16. Numeric with unit suffix in display
// ===========================================================================
describe("numeric display values include units", () => {
  it("diameterMm shows mm unit", () => {
    const filter = parseAnswerToFilter("diameterMm", "10")
    expect(filter?.value).toBe("10mm")
  })

  it("shankDiameterMm shows mm unit", () => {
    const filter = parseAnswerToFilter("shankDiameterMm", "6")
    expect(filter?.value).toBe("6mm")
  })

  it("helixAngleDeg shows degree unit", () => {
    const filter = parseAnswerToFilter("helixAngleDeg", "45")
    expect(filter?.value).toBe("45°")
  })

  it("taperAngleDeg shows degree unit", () => {
    const filter = parseAnswerToFilter("taperAngleDeg", "3")
    expect(filter?.value).toBe("3°")
  })

  it("ballRadiusMm shows mm unit", () => {
    const filter = parseAnswerToFilter("ballRadiusMm", "5")
    expect(filter?.value).toBe("5mm")
  })
})

// ===========================================================================
// 17. Coating — edge: empty or whitespace-only canonicalization
// ===========================================================================
describe("coating edge cases", () => {
  it("empty string returns null", () => {
    expect(canonicalize("coating", "")).toBeNull()
  })

  it("whitespace-only returns null", () => {
    expect(canonicalize("coating", "   ")).toBeNull()
  })
})

// ===========================================================================
// 18. ToolSubtype — edge: empty or whitespace-only canonicalization
// ===========================================================================
describe("toolSubtype edge cases", () => {
  it("empty string returns null", () => {
    expect(canonicalize("toolSubtype", "")).toBeNull()
  })

  it("whitespace-only returns null", () => {
    expect(canonicalize("toolSubtype", "   ")).toBeNull()
  })

  it("unknown subtype passes through", () => {
    expect(canonicalize("toolSubtype", "CustomType")).toBe("CustomType")
  })
})

// ===========================================================================
// 19. Inch diameter — edge: no inch indicator stays as number
// ===========================================================================
describe("diameter edge cases", () => {
  it("plain number stays numeric", () => {
    const filter = parseAnswerToFilter("diameterMm", "10")
    expect(filter?.rawValue).toBe(10)
  })

  it("number with mm suffix extracts correctly", () => {
    const filter = parseAnswerToFilter("diameterMm", "10mm")
    expect(filter?.rawValue).toBe(10)
  })

  it("non-numeric string for number field returns null", () => {
    const filter = parseAnswerToFilter("diameterMm", "abc")
    expect(filter).toBeNull()
  })
})

// ===========================================================================
// 20. material / toolMaterial string fields
// ===========================================================================
describe("additional string fields", () => {
  it("material parses answer", () => {
    const filter = parseAnswerToFilter("material", "Steel")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe("Steel")
    expect(filter!.field).toBe("material")
  })

  it("toolMaterial parses answer", () => {
    const filter = parseAnswerToFilter("toolMaterial", "초경")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe("초경")
    expect(filter!.field).toBe("toolMaterial")
  })

  it("toolType parses answer", () => {
    const filter = parseAnswerToFilter("toolType", "Endmill")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe("Endmill")
    expect(filter!.field).toBe("toolType")
  })
})

// ===========================================================================
// 21. Parsing robustness: special characters in values (10 cases)
// ===========================================================================
describe("parsing robustness — special characters in values", () => {
  it("coating 'TiAlN' straight pass", () => {
    expect(parseRaw("coating", "TiAlN")).toBe("TiAlN")
  })

  it("coating with hyphen 'Ti-Al-N' dehyphenated", () => {
    expect(canonicalize("coating", "Ti-Al-N")).toBe("TiAlN")
  })

  it("coating with hyphen 'Al-Cr-N' dehyphenated", () => {
    expect(canonicalize("coating", "Al-Cr-N")).toBe("AlCrN")
  })

  it("toolSubtype 'Square' canonical", () => {
    expect(canonicalize("toolSubtype", "Square")).toBe("Square")
  })

  it("toolSubtype 'Ball' canonical", () => {
    expect(canonicalize("toolSubtype", "Ball")).toBe("Ball")
  })

  it("toolSubtype 'Corner Radius' from 코너레디우스", () => {
    expect(canonicalize("toolSubtype", "코너레디우스")).toBe("Radius")
  })

  it("toolSubtype 'Roughing' from '러핑'", () => {
    expect(canonicalize("toolSubtype", "러핑")).toBe("Roughing")
  })

  it("material with Korean particle '알루미늄으로' still parses", () => {
    const filter = parseAnswerToFilter("material", "알루미늄으로")
    expect(filter).not.toBeNull()
    // After strip, should get clean value
    expect(filter!.rawValue).toBeTruthy()
  })

  it("workPieceName '스텐' → stainless", () => {
    expect(canonicalize("workPieceName", "스텐")).toBe("stainless")
  })

  it("workPieceName '스테인리스' → stainless", () => {
    expect(canonicalize("workPieceName", "스테인리스")).toBe("stainless")
  })
})

// ===========================================================================
// 22. fluteCount field alias variations (10 cases)
// ===========================================================================
describe("fluteCount alias handling", () => {
  it("'2날' → 2", () => {
    expect(parseRaw("fluteCount", "2날")).toBe(2)
  })

  it("'4' → 4", () => {
    expect(parseRaw("fluteCount", "4")).toBe(4)
  })

  it("'two flute' → 2 (English word number)", () => {
    expect(parseRaw("fluteCount", "two flute")).toBe(2)
  })

  it("'four flute' → 4", () => {
    expect(parseRaw("fluteCount", "four flute")).toBe(4)
  })

  it("'날 2개' reversed Korean → 2", () => {
    expect(parseRaw("fluteCount", "날 2개")).toBe(2)
  })

  it("'날 6개' → 6", () => {
    expect(parseRaw("fluteCount", "날 6개")).toBe(6)
  })

  it("'six flute' → 6", () => {
    expect(parseRaw("fluteCount", "six flute")).toBe(6)
  })

  it("'three flute' → 3", () => {
    expect(parseRaw("fluteCount", "three flute")).toBe(3)
  })

  it("'10' → 10", () => {
    expect(parseRaw("fluteCount", "10")).toBe(10)
  })

  it("'날수 4' with leading alias → 4", () => {
    expect(parseRaw("fluteCount", "날수 4")).toBe(4)
  })
})

// ===========================================================================
// 23. Numeric edge cases: 0mm, negative, large diameter (10 cases)
// ===========================================================================
describe("numeric edge cases for diameterMm", () => {
  it("0 → 0", () => {
    expect(parseRaw("diameterMm", "0")).toBe(0)
  })

  it("0mm → 0", () => {
    expect(parseRaw("diameterMm", "0mm")).toBe(0)
  })

  it("0.5mm → 0.5", () => {
    expect(parseRaw("diameterMm", "0.5mm")).toBe(0.5)
  })

  it("-1mm → -1 (negative accepted by parser)", () => {
    expect(parseRaw("diameterMm", "-1mm")).toBe(-1)
  })

  it("999mm → 999", () => {
    expect(parseRaw("diameterMm", "999mm")).toBe(999)
  })

  it("100 → 100", () => {
    expect(parseRaw("diameterMm", "100")).toBe(100)
  })

  it("0.01mm → 0.01", () => {
    expect(parseRaw("diameterMm", "0.01mm")).toBe(0.01)
  })

  it("50.123mm → 50.123", () => {
    expect(parseRaw("diameterMm", "50.123mm")).toBe(50.123)
  })

  it("약 10mm (approximate prefix stripped) → 10", () => {
    expect(parseRaw("diameterMm", "약 10mm")).toBe(10)
  })

  it("10mm쯤 (approximate suffix stripped) → 10", () => {
    expect(parseRaw("diameterMm", "10mm쯤")).toBe(10)
  })
})

// ===========================================================================
// 24. Boolean field: coolantHole true/false/있음/없음 (10 cases)
// ===========================================================================
describe("coolantHole boolean parsing", () => {
  it("'true' → true", () => {
    expect(parseRaw("coolantHole", "true")).toBe(true)
  })

  it("'false' → false", () => {
    expect(parseRaw("coolantHole", "false")).toBe(false)
  })

  it("'있음' → true", () => {
    expect(parseRaw("coolantHole", "있음")).toBe(true)
  })

  it("'없음' → false", () => {
    expect(parseRaw("coolantHole", "없음")).toBe(false)
  })

  it("'yes' → true", () => {
    expect(parseRaw("coolantHole", "yes")).toBe(true)
  })

  it("'no' → false", () => {
    expect(parseRaw("coolantHole", "no")).toBe(false)
  })

  it("'유' → true", () => {
    expect(parseRaw("coolantHole", "유")).toBe(true)
  })

  it("'무' → false", () => {
    expect(parseRaw("coolantHole", "무")).toBe(false)
  })

  it("'Y' parsed as truthy", () => {
    expect(parseRaw("coolantHole", "Y")).toBe(true)
  })

  it("'N' parsed as falsy", () => {
    expect(parseRaw("coolantHole", "N")).toBe(false)
  })
})

// ===========================================================================
// 25. Concurrent filter + revision in same test (5 cases)
// ===========================================================================
describe("concurrent filter and revision scenarios", () => {
  it("parse coating then immediately parse different coating", () => {
    const f1 = parseAnswerToFilter("coating", "TiAlN")
    const f2 = parseAnswerToFilter("coating", "AlCrN")
    expect(f1!.rawValue).toBe("TiAlN")
    expect(f2!.rawValue).toBe("AlCrN")
  })

  it("parse diameterMm and fluteCount simultaneously", () => {
    const dia = parseAnswerToFilter("diameterMm", "10mm")
    const flute = parseAnswerToFilter("fluteCount", "4날")
    expect(dia!.rawValue).toBe(10)
    expect(flute!.rawValue).toBe(4)
  })

  it("parse all major fields in one burst", () => {
    const results = {
      dia: parseAnswerToFilter("diameterMm", "8mm"),
      coat: parseAnswerToFilter("coating", "DLC"),
      flute: parseAnswerToFilter("fluteCount", "2날"),
      sub: parseAnswerToFilter("toolSubtype", "Ball"),
      mat: parseAnswerToFilter("material", "알루미늄"),
    }
    expect(results.dia!.rawValue).toBe(8)
    expect(results.coat!.rawValue).toBe("DLC")
    expect(results.flute!.rawValue).toBe(2)
    expect(results.sub!.rawValue).toBe("Ball")
    expect(results.mat!.rawValue).toBe("알루미늄")
  })

  it("parse same value for two different numeric fields", () => {
    const dia = parseAnswerToFilter("diameterMm", "10")
    const loc = parseAnswerToFilter("lengthOfCutMm", "10")
    expect(dia!.field).toBe("diameterMm")
    expect(loc!.field).toBe("lengthOfCutMm")
    expect(dia!.rawValue).toBe(10)
    expect(loc!.rawValue).toBe(10)
  })

  it("parse coolantHole boolean alongside numeric field", () => {
    const cool = parseAnswerToFilter("coolantHole", "있음")
    const dia = parseAnswerToFilter("diameterMm", "12mm")
    expect(cool!.rawValue).toBe(true)
    expect(dia!.rawValue).toBe(12)
  })
})

// ===========================================================================
// 26. Fractional inch parsing for diameterMm (5 cases)
// ===========================================================================
describe("fractional inch parsing", () => {
  it("3/8 inch → ~9.525mm", () => {
    const f = parseAnswerToFilter("diameterMm", '3/8"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(9.525, 2)
  })

  it("1/2 inch → ~12.7mm", () => {
    const f = parseAnswerToFilter("diameterMm", '1/2"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(12.7, 2)
  })

  it("1/4 inch → ~6.35mm", () => {
    const f = parseAnswerToFilter("diameterMm", '1/4 inch')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(6.35, 2)
  })

  it("1 inch → 25.4mm", () => {
    const f = parseAnswerToFilter("diameterMm", '1"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(25.4, 2)
  })

  it("1-1/2 inch → ~38.1mm", () => {
    const f = parseAnswerToFilter("diameterMm", '1-1/2"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(38.1, 2)
  })
})
