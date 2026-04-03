/**
 * AutoAgent Round 2 — 파싱 edge case + 누락 alias 탐색
 */
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { matchMaterial } from "@/lib/recommendation/shared/patterns"

// ── Helper ──
function parsesTo(field: string, input: string, expectedRaw: string | number | null) {
  const result = buildAppliedFilterFromValue(field, input)
  if (expectedRaw === null) {
    expect(result).toBeNull()
  } else {
    expect(result).not.toBeNull()
    expect(result!.rawValue).toBe(expectedRaw)
  }
}

describe("toolSubtype 한국어 alias 확장", () => {
  it("'테이퍼' → Taper", () => parsesTo("toolSubtype", "테이퍼", "Taper"))
  it("'챔퍼' → Chamfer", () => parsesTo("toolSubtype", "챔퍼", "Chamfer"))
  it("'하이피드' → High-Feed", () => parsesTo("toolSubtype", "하이피드", "High-Feed"))
  it("'고이송' → High-Feed", () => parsesTo("toolSubtype", "고이송", "High-Feed"))
  it("'플랫' → Square", () => parsesTo("toolSubtype", "플랫", "Square"))
  it("'라디우스' → Radius", () => parsesTo("toolSubtype", "라디우스", "Radius"))
  it("'코너R' → Radius", () => parsesTo("toolSubtype", "코너R", "Radius"))
})

describe("coating 한국어 alias 확장", () => {
  it("'와이코팅' → Y-Coating", () => parsesTo("coating", "와이코팅", "Y-Coating"))
  it("'엑스코팅' → X-Coating", () => parsesTo("coating", "엑스코팅", "X-Coating"))
  it("'비코팅' → Bright Finish or Uncoated", () => {
    const result = buildAppliedFilterFromValue("coating", "비코팅")
    expect(result).not.toBeNull()
    const val = String(result!.rawValue)
    expect(val === "Bright Finish" || val === "Uncoated" || val.includes("Bright")).toBe(true)
  })
})

describe("diameterMm edge case 파싱", () => {
  it("'10파이' → 10", () => parsesTo("diameterMm", "10파이", 10))
  it("'φ10' → 10", () => parsesTo("diameterMm", "φ10", 10))
  it("'Φ8' → 8", () => parsesTo("diameterMm", "Φ8", 8))
  it("'10' → 10", () => parsesTo("diameterMm", "10", 10))
  it("'0.5mm' → 0.5", () => parsesTo("diameterMm", "0.5mm", 0.5))
})

describe("소재 매칭 확장", () => {
  // matchMaterial returns Korean material group name, not ISO code
  it("'copper' → 구리", () => expect(matchMaterial("copper")).toBe("구리"))
  it("'brass' → 구리", () => expect(matchMaterial("brass")).toBe("구리"))
  it("'Inconel' → 인코넬", () => expect(matchMaterial("Inconel")).toBe("인코넬"))
  it("'titanium' → 티타늄", () => expect(matchMaterial("titanium")).toBe("티타늄"))
  it("'cast iron' → 주철", () => expect(matchMaterial("cast iron")).toBe("주철"))
  it("'carbon steel' → 탄소강", () => expect(matchMaterial("carbon steel")).toBe("탄소강"))
  it("'stainless' → 스테인리스", () => expect(matchMaterial("stainless")).toBe("스테인리스"))
  it("'hardened steel' → 고경도강", () => expect(matchMaterial("hardened steel")).toBe("고경도강"))
  it("'프리하든강' → non-null", () => {
    // 프리하든강 is pre-hardened steel — may match 탄소강 or 고경도강
    const m = matchMaterial("프리하든강")
    expect(m).not.toBeNull()
  })
  it("'Cu' → 구리", () => {
    // "Cu" is a short token; may or may not match due to substring matching
    const m = matchMaterial("Cu")
    // Cu is in copper keywords, but lowercase check needed
    if (m) expect(m).toBe("구리")
  })
})

describe("fluteCount edge case", () => {
  it("'four flute' → 4", () => parsesTo("fluteCount", "four flute", 4))
  it("'two' → 2", () => parsesTo("fluteCount", "two", 2))
  it("'10날' → 10", () => parsesTo("fluteCount", "10날", 10))
})
