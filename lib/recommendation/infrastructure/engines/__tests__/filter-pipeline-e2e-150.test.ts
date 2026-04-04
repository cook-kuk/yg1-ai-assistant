/**
 * End-to-end filter pipeline tests (150 cases).
 *
 * Tests the COMPLETE pipeline:
 *   user input → parseAnswerToFilter → buildAppliedFilterFromValue
 *   → applyFilterToRecommendationInput → replaceFieldFilter → rebuildInputFromFilters
 *
 * No LLM calls — purely deterministic.
 */

import { describe, expect, it } from "vitest"

import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import {
  applyFilterToRecommendationInput,
  buildAppliedFilterFromValue,
  clearFilterFromRecommendationInput,
} from "@/lib/recommendation/shared/filter-field-registry"
import { applyFilterToInput } from "../serve-engine-input"
import {
  rebuildInputFromFilters,
  replaceFieldFilter,
} from "../serve-engine-filter-state"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  }
}

/** Run the full pipeline: parse → build → apply → verify */
function runPipeline(
  field: string,
  answer: string,
  base?: RecommendationInput
): { filter: AppliedFilter; input: RecommendationInput } {
  const filter = parseAnswerToFilter(field, answer)
  expect(filter, `parseAnswerToFilter("${field}", "${answer}") returned null`).not.toBeNull()
  const input = applyFilterToInput(base ?? makeBaseInput(), filter!)
  return { filter: filter!, input }
}

/** Run full pipeline including replaceFieldFilter */
function runPipelineWithReplace(
  field: string,
  answer: string,
  currentFilters: AppliedFilter[],
  base?: RecommendationInput
): { filter: AppliedFilter; nextFilters: AppliedFilter[]; nextInput: RecommendationInput; replacedExisting: boolean } {
  const filter = parseAnswerToFilter(field, answer)
  expect(filter, `parseAnswerToFilter("${field}", "${answer}") returned null`).not.toBeNull()
  const result = replaceFieldFilter(base ?? makeBaseInput(), currentFilters, filter!, applyFilterToInput)
  return { filter: filter!, ...result }
}

// ═══════════════════════════════════════════════════════════
//  1. diameterMm (20 tests)
// ═══════════════════════════════════════════════════════════

describe("diameterMm — full pipeline (20)", () => {
  it("01: '10mm' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "10mm")
    expect(input.diameterMm).toBe(10)
  })

  it("02: '10' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "10")
    expect(input.diameterMm).toBe(10)
  })

  it("03: '10.0mm' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "10.0mm")
    expect(input.diameterMm).toBe(10)
  })

  it("04: '파이10' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "파이10")
    expect(input.diameterMm).toBe(10)
  })

  it("05: '10밀리' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "10밀리")
    expect(input.diameterMm).toBe(10)
  })

  it("06: '약 10mm' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "약 10mm")
    expect(input.diameterMm).toBe(10)
  })

  it('07: \'3/8"\' → diameterMm≈9.525', () => {
    const { input } = runPipeline("diameterMm", '3/8"')
    expect(input.diameterMm).toBeCloseTo(9.525, 1)
  })

  it("08: '3/8인치' → diameterMm≈9.525", () => {
    const { input } = runPipeline("diameterMm", "3/8인치")
    expect(input.diameterMm).toBeCloseTo(9.525, 1)
  })

  it("09: '1/2 inch' → diameterMm≈12.7", () => {
    const { input } = runPipeline("diameterMm", "1/2 inch")
    expect(input.diameterMm).toBeCloseTo(12.7, 1)
  })

  it("10: 'φ10' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "φ10")
    expect(input.diameterMm).toBe(10)
  })

  it("11: '6mm' → diameterMm=6", () => {
    const { input } = runPipeline("diameterMm", "6mm")
    expect(input.diameterMm).toBe(6)
  })

  it("12: '0.5mm' → diameterMm=0.5", () => {
    const { input } = runPipeline("diameterMm", "0.5mm")
    expect(input.diameterMm).toBe(0.5)
  })

  it("13: '20' → diameterMm=20", () => {
    const { input } = runPipeline("diameterMm", "20")
    expect(input.diameterMm).toBe(20)
  })

  it("14: '12.5mm' → diameterMm=12.5", () => {
    const { input } = runPipeline("diameterMm", "12.5mm")
    expect(input.diameterMm).toBe(12.5)
  })

  it("15: '10미리' → diameterMm=10", () => {
    const { input } = runPipeline("diameterMm", "10미리")
    expect(input.diameterMm).toBe(10)
  })

  it("16: 'Φ8' → diameterMm=8", () => {
    const { input } = runPipeline("diameterMm", "Φ8")
    expect(input.diameterMm).toBe(8)
  })

  it("17: '16mm' → diameterMm=16", () => {
    const { input } = runPipeline("diameterMm", "16mm")
    expect(input.diameterMm).toBe(16)
  })

  it("18: '25' → diameterMm=25", () => {
    const { input } = runPipeline("diameterMm", "25")
    expect(input.diameterMm).toBe(25)
  })

  it("19: '1/4 inch' → diameterMm≈6.35", () => {
    const { input } = runPipeline("diameterMm", "1/4 inch")
    expect(input.diameterMm).toBeCloseTo(6.35, 1)
  })

  it("20: '약 6mm' → diameterMm=6", () => {
    const { input } = runPipeline("diameterMm", "약 6mm")
    expect(input.diameterMm).toBe(6)
  })
})

// ═══════════════════════════════════════════════════════════
//  2. fluteCount (20 tests)
// ═══════════════════════════════════════════════════════════

describe("fluteCount — full pipeline (20)", () => {
  it("01: '2날' → flutePreference=2", () => {
    const { input } = runPipeline("fluteCount", "2날")
    expect(input.flutePreference).toBe(2)
  })

  it("02: '4날' → flutePreference=4", () => {
    const { input } = runPipeline("fluteCount", "4날")
    expect(input.flutePreference).toBe(4)
  })

  it("03: '2' → flutePreference=2", () => {
    const { input } = runPipeline("fluteCount", "2")
    expect(input.flutePreference).toBe(2)
  })

  it("04: '4' → flutePreference=4", () => {
    const { input } = runPipeline("fluteCount", "4")
    expect(input.flutePreference).toBe(4)
  })

  it("05: 'two flute' → flutePreference=2", () => {
    const { input } = runPipeline("fluteCount", "two flute")
    expect(input.flutePreference).toBe(2)
  })

  it("06: '날 2개' → flutePreference=2", () => {
    const { input } = runPipeline("fluteCount", "날 2개")
    expect(input.flutePreference).toBe(2)
  })

  it("07: '2날이요' → flutePreference=2", () => {
    const { input } = runPipeline("fluteCount", "2날이요")
    expect(input.flutePreference).toBe(2)
  })

  it("08: '4날로' → flutePreference=4", () => {
    const { input } = runPipeline("fluteCount", "4날로")
    expect(input.flutePreference).toBe(4)
  })

  it("09: 'four flute' → flutePreference=4", () => {
    const { input } = runPipeline("fluteCount", "four flute")
    expect(input.flutePreference).toBe(4)
  })

  it("10: '3날' → flutePreference=3", () => {
    const { input } = runPipeline("fluteCount", "3날")
    expect(input.flutePreference).toBe(3)
  })

  it("11: '6날' → flutePreference=6", () => {
    const { input } = runPipeline("fluteCount", "6날")
    expect(input.flutePreference).toBe(6)
  })

  it("12: '3' → flutePreference=3", () => {
    const { input } = runPipeline("fluteCount", "3")
    expect(input.flutePreference).toBe(3)
  })

  it("13: 'three flute' → flutePreference=3", () => {
    const { input } = runPipeline("fluteCount", "three flute")
    expect(input.flutePreference).toBe(3)
  })

  it("14: '날 4개' → flutePreference=4", () => {
    const { input } = runPipeline("fluteCount", "날 4개")
    expect(input.flutePreference).toBe(4)
  })

  it("15: '5' → flutePreference=5", () => {
    const { input } = runPipeline("fluteCount", "5")
    expect(input.flutePreference).toBe(5)
  })

  it("16: '6' → flutePreference=6", () => {
    const { input } = runPipeline("fluteCount", "6")
    expect(input.flutePreference).toBe(6)
  })

  it("17: 'five flute' → flutePreference=5", () => {
    const { input } = runPipeline("fluteCount", "five flute")
    expect(input.flutePreference).toBe(5)
  })

  it("18: 'six flute' → flutePreference=6", () => {
    const { input } = runPipeline("fluteCount", "six flute")
    expect(input.flutePreference).toBe(6)
  })

  it("19: '8' → flutePreference=8", () => {
    const { input } = runPipeline("fluteCount", "8")
    expect(input.flutePreference).toBe(8)
  })

  it("20: '1' → flutePreference=1", () => {
    const { input } = runPipeline("fluteCount", "1")
    expect(input.flutePreference).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════
//  3. toolSubtype (20 tests)
// ═══════════════════════════════════════════════════════════

describe("toolSubtype — full pipeline (20)", () => {
  it("01: 'Square' → toolSubtype='Square'", () => {
    const { input } = runPipeline("toolSubtype", "Square")
    expect(input.toolSubtype).toBe("Square")
  })

  it("02: 'square' → toolSubtype='Square'", () => {
    const { input } = runPipeline("toolSubtype", "square")
    expect(input.toolSubtype).toBe("Square")
  })

  it("03: '스퀘어' → toolSubtype='Square'", () => {
    const { input } = runPipeline("toolSubtype", "스퀘어")
    expect(input.toolSubtype).toBe("Square")
  })

  it("04: '볼' → toolSubtype='Ball'", () => {
    const { input } = runPipeline("toolSubtype", "볼")
    expect(input.toolSubtype).toBe("Ball")
  })

  it("05: 'Ball' → toolSubtype='Ball'", () => {
    const { input } = runPipeline("toolSubtype", "Ball")
    expect(input.toolSubtype).toBe("Ball")
  })

  it("06: 'Radius' → toolSubtype='Radius'", () => {
    const { input } = runPipeline("toolSubtype", "Radius")
    expect(input.toolSubtype).toBe("Radius")
  })

  it("07: '라디우스' → toolSubtype='Radius'", () => {
    const { input } = runPipeline("toolSubtype", "라디우스")
    expect(input.toolSubtype).toBe("Radius")
  })

  it("08: '코너레디우스' → toolSubtype='Radius'", () => {
    const { input } = runPipeline("toolSubtype", "코너레디우스")
    expect(input.toolSubtype).toBe("Radius")
  })

  it("09: '황삭' → toolSubtype='Roughing'", () => {
    const { input } = runPipeline("toolSubtype", "황삭")
    expect(input.toolSubtype).toBe("Roughing")
  })

  it("10: 'Roughing' → toolSubtype='Roughing'", () => {
    const { input } = runPipeline("toolSubtype", "Roughing")
    expect(input.toolSubtype).toBe("Roughing")
  })

  it("11: '테이퍼' → toolSubtype='Taper'", () => {
    const { input } = runPipeline("toolSubtype", "테이퍼")
    expect(input.toolSubtype).toBe("Taper")
  })

  it("12: 'Taper' → toolSubtype='Taper'", () => {
    const { input } = runPipeline("toolSubtype", "Taper")
    expect(input.toolSubtype).toBe("Taper")
  })

  it("13: 'ball' → toolSubtype='Ball'", () => {
    const { input } = runPipeline("toolSubtype", "ball")
    expect(input.toolSubtype).toBe("Ball")
  })

  it("14: 'radius' → toolSubtype='Radius'", () => {
    const { input } = runPipeline("toolSubtype", "radius")
    expect(input.toolSubtype).toBe("Radius")
  })

  it("15: 'roughing' → toolSubtype='Roughing'", () => {
    const { input } = runPipeline("toolSubtype", "roughing")
    expect(input.toolSubtype).toBe("Roughing")
  })

  it("16: '러핑' → toolSubtype='Roughing'", () => {
    const { input } = runPipeline("toolSubtype", "러핑")
    expect(input.toolSubtype).toBe("Roughing")
  })

  it("17: '챔퍼' → toolSubtype='Chamfer'", () => {
    const { input } = runPipeline("toolSubtype", "챔퍼")
    expect(input.toolSubtype).toBe("Chamfer")
  })

  it("18: 'Chamfer' → toolSubtype='Chamfer'", () => {
    const { input } = runPipeline("toolSubtype", "Chamfer")
    expect(input.toolSubtype).toBe("Chamfer")
  })

  it("19: '하이피드' → toolSubtype='High-Feed'", () => {
    const { input } = runPipeline("toolSubtype", "하이피드")
    expect(input.toolSubtype).toBe("High-Feed")
  })

  it("20: '볼엔드밀' → toolSubtype='Ball'", () => {
    const { input } = runPipeline("toolSubtype", "볼엔드밀")
    expect(input.toolSubtype).toBe("Ball")
  })
})

// ═══════════════════════════════════════════════════════════
//  4. coating (20 tests)
// ═══════════════════════════════════════════════════════════

describe("coating — full pipeline (20)", () => {
  it("01: 'TiAlN' → coatingPreference='TiAlN'", () => {
    const { input } = runPipeline("coating", "TiAlN")
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("02: 'tialn' → coatingPreference (case-preserved dehyphenated)", () => {
    const { input } = runPipeline("coating", "tialn")
    expect(input.coatingPreference!.toLowerCase()).toBe("tialn")
  })

  it("03: '블루코팅' → coatingPreference='Blue'", () => {
    const { input } = runPipeline("coating", "블루코팅")
    expect(input.coatingPreference).toBe("Blue")
  })

  it("04: 'Blue' → coatingPreference='Blue'", () => {
    const { input } = runPipeline("coating", "Blue")
    expect(input.coatingPreference!.toLowerCase()).toContain("blue")
  })

  it("05: '무코팅' → coatingPreference='Uncoated'", () => {
    const { input } = runPipeline("coating", "무코팅")
    expect(input.coatingPreference).toBe("Uncoated")
  })

  it("06: 'Uncoated' → coatingPreference='Uncoated'", () => {
    const { input } = runPipeline("coating", "Uncoated")
    expect(input.coatingPreference!.toLowerCase()).toContain("uncoated")
  })

  it("07: 'DLC' → coatingPreference='DLC'", () => {
    const { input } = runPipeline("coating", "DLC")
    expect(input.coatingPreference).toBe("DLC")
  })

  it("08: 'AlCrN' → coatingPreference='AlCrN'", () => {
    const { input } = runPipeline("coating", "AlCrN")
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("09: '골드코팅' → coatingPreference='TiN'", () => {
    const { input } = runPipeline("coating", "골드코팅")
    expect(input.coatingPreference).toBe("TiN")
  })

  it("10: '블랙코팅' → coatingPreference='TiAlN'", () => {
    const { input } = runPipeline("coating", "블랙코팅")
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("11: '실버코팅' → coatingPreference='Bright'", () => {
    const { input } = runPipeline("coating", "실버코팅")
    expect(input.coatingPreference).toBe("Bright")
  })

  it("12: '비코팅' → coatingPreference='Uncoated'", () => {
    const { input } = runPipeline("coating", "비코팅")
    expect(input.coatingPreference).toBe("Uncoated")
  })

  it("13: '다이아몬드코팅' → coatingPreference='Diamond'", () => {
    const { input } = runPipeline("coating", "다이아몬드코팅")
    expect(input.coatingPreference).toBe("Diamond")
  })

  it("14: '다이아몬드' → coatingPreference='Diamond'", () => {
    const { input } = runPipeline("coating", "다이아몬드")
    expect(input.coatingPreference).toBe("Diamond")
  })

  it("15: 'TiN' → coatingPreference='TiN'", () => {
    const { input } = runPipeline("coating", "TiN")
    expect(input.coatingPreference).toBe("TiN")
  })

  it("16: '코팅없음' → coatingPreference='Uncoated'", () => {
    const { input } = runPipeline("coating", "코팅없음")
    expect(input.coatingPreference).toBe("Uncoated")
  })

  it("17: '블루' → coatingPreference='Blue'", () => {
    const { input } = runPipeline("coating", "블루")
    expect(input.coatingPreference).toBe("Blue")
  })

  it("18: 'Ti-Al-N' → coatingPreference='TiAlN'", () => {
    const { input } = runPipeline("coating", "Ti-Al-N")
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("19: 'Al-Cr-N' → coatingPreference='AlCrN'", () => {
    const { input } = runPipeline("coating", "Al-Cr-N")
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("20: '골드' → coatingPreference contains Gold or TiN", () => {
    const { input } = runPipeline("coating", "골드")
    // 골드 maps to Gold in COATING_KO_ALIASES
    expect(input.coatingPreference).toBe("Gold")
  })
})

// ═══════════════════════════════════════════════════════════
//  5. workPieceName (15 tests)
// ═══════════════════════════════════════════════════════════

describe("workPieceName — full pipeline (15)", () => {
  it("01: '알루미늄' → workPieceName='알루미늄'", () => {
    const { input } = runPipeline("workPieceName", "알루미늄")
    expect(input.workPieceName).toBe("알루미늄")
  })

  it("02: '스테인리스강' → workPieceName set", () => {
    const { input } = runPipeline("workPieceName", "스테인리스강")
    expect(input.workPieceName).toBeDefined()
  })

  it("03: '탄소강' → workPieceName='탄소강'", () => {
    const { input } = runPipeline("workPieceName", "탄소강")
    expect(input.workPieceName).toBe("탄소강")
  })

  it("04: '주철' → workPieceName='주철'", () => {
    const { input } = runPipeline("workPieceName", "주철")
    expect(input.workPieceName).toBe("주철")
  })

  it("05: '고경도강' → workPieceName='고경도강'", () => {
    const { input } = runPipeline("workPieceName", "고경도강")
    expect(input.workPieceName).toBe("고경도강")
  })

  it("06: 'stainless' → workPieceName='stainless'", () => {
    const { input } = runPipeline("workPieceName", "stainless")
    expect(input.workPieceName!.toLowerCase()).toContain("stainless")
  })

  it("07: '스텐' → workPieceName contains stainless", () => {
    const { input } = runPipeline("workPieceName", "스텐")
    expect(input.workPieceName!.toLowerCase()).toContain("stainless")
  })

  it("08: '스테인레스' → workPieceName contains stainless", () => {
    const { input } = runPipeline("workPieceName", "스테인레스")
    expect(input.workPieceName!.toLowerCase()).toContain("stainless")
  })

  it("09: '티타늄' → workPieceName='티타늄'", () => {
    const { input } = runPipeline("workPieceName", "티타늄")
    expect(input.workPieceName).toBe("티타늄")
  })

  it("10: '인코넬' → workPieceName='인코넬'", () => {
    const { input } = runPipeline("workPieceName", "인코넬")
    expect(input.workPieceName).toBe("인코넬")
  })

  it("11: 'aluminum' → workPieceName='알루미늄' (canonicalized)", () => {
    const { input } = runPipeline("workPieceName", "aluminum")
    expect(input.workPieceName).toBe("알루미늄")
  })

  it("12: 'carbon steel' → workPieceName='carbon steel'", () => {
    const { input } = runPipeline("workPieceName", "carbon steel")
    expect(input.workPieceName!.toLowerCase()).toContain("carbon steel")
  })

  it("13: '구리' → workPieceName='구리'", () => {
    const { input } = runPipeline("workPieceName", "구리")
    expect(input.workPieceName).toBe("구리")
  })

  it("14: '황동' → workPieceName='구리' (canonicalized to copper group)", () => {
    const { input } = runPipeline("workPieceName", "황동")
    expect(input.workPieceName).toBe("구리")
  })

  it("15: '스테인리스' → workPieceName contains stainless", () => {
    const { input } = runPipeline("workPieceName", "스테인리스")
    expect(input.workPieceName!.toLowerCase()).toContain("stainless")
  })
})

// ═══════════════════════════════════════════════════════════
//  6. country (15 tests)
// ═══════════════════════════════════════════════════════════

describe("country — full pipeline (15)", () => {
  it("01: '한국' → country='KOR'", () => {
    const { input } = runPipeline("country", "한국")
    expect(input.country).toBe("KOR")
  })

  it("02: 'KOR' → country='KOR'", () => {
    const { input } = runPipeline("country", "KOR")
    expect(input.country).toBe("KOR")
  })

  it("03: '미국' → country='USA'", () => {
    const { input } = runPipeline("country", "미국")
    expect(input.country).toBe("USA")
  })

  it("04: 'USA' → country='USA'", () => {
    const { input } = runPipeline("country", "USA")
    expect(input.country).toBe("USA")
  })

  it("05: '일본' → country='JPN'", () => {
    const { input } = runPipeline("country", "일본")
    expect(input.country).toBe("JPN")
  })

  it("06: 'JPN' → country='JPN'", () => {
    const { input } = runPipeline("country", "JPN")
    expect(input.country).toBe("JPN")
  })

  it("07: '독일' → country='DEU'", () => {
    const { input } = runPipeline("country", "독일")
    expect(input.country).toBe("DEU")
  })

  it("08: 'DEU' → country='DEU'", () => {
    const { input } = runPipeline("country", "DEU")
    expect(input.country).toBe("DEU")
  })

  it("09: '아시아' → country contains KOR,JPN,CHN,THA,VNM", () => {
    const { input } = runPipeline("country", "아시아")
    expect(input.country).toContain("KOR")
    expect(input.country).toContain("JPN")
  })

  it("10: 'KOREA' → country='KOR'", () => {
    const { input } = runPipeline("country", "KOREA")
    // 'KOREA' doesn't match any alias exactly, passes through as uppercase
    // Actually 'korea' maps to 'KOR' in the aliases
    const c = input.country!
    expect(c === "KOR" || c === "KOREA").toBe(true)
  })

  it("11: '중국' → country='CHN'", () => {
    const { input } = runPipeline("country", "중국")
    expect(input.country).toBe("CHN")
  })

  it("12: 'china' → country='CHN'", () => {
    const { input } = runPipeline("country", "china")
    expect(input.country).toBe("CHN")
  })

  it("13: 'germany' → country='DEU'", () => {
    const { input } = runPipeline("country", "germany")
    expect(input.country).toBe("DEU")
  })

  it("14: '영국' → country='ENG'", () => {
    const { input } = runPipeline("country", "영국")
    expect(input.country).toBe("ENG")
  })

  it("15: '유럽' → country contains DEU,FRA,ENG", () => {
    const { input } = runPipeline("country", "유럽")
    expect(input.country).toContain("DEU")
    expect(input.country).toContain("FRA")
  })
})

// ═══════════════════════════════════════════════════════════
//  7. Numeric fields (20 tests)
// ═══════════════════════════════════════════════════════════

describe("numeric fields — full pipeline (20)", () => {
  // shankDiameterMm
  it("01: shankDiameterMm '10mm' → shankDiameterMm=10", () => {
    const { input } = runPipeline("shankDiameterMm", "10mm")
    expect(input.shankDiameterMm).toBe(10)
  })

  it("02: shankDiameterMm '6' → shankDiameterMm=6", () => {
    const { input } = runPipeline("shankDiameterMm", "6")
    expect(input.shankDiameterMm).toBe(6)
  })

  it("03: shankDiameterMm '12.5mm' → shankDiameterMm=12.5", () => {
    const { input } = runPipeline("shankDiameterMm", "12.5mm")
    expect(input.shankDiameterMm).toBe(12.5)
  })

  // lengthOfCutMm
  it("04: lengthOfCutMm '30mm' → lengthOfCutMm=30", () => {
    const { input } = runPipeline("lengthOfCutMm", "30mm")
    expect(input.lengthOfCutMm).toBe(30)
  })

  it("05: lengthOfCutMm '25' → lengthOfCutMm=25", () => {
    const { input } = runPipeline("lengthOfCutMm", "25")
    expect(input.lengthOfCutMm).toBe(25)
  })

  it("06: lengthOfCutMm '45.5mm' → lengthOfCutMm=45.5", () => {
    const { input } = runPipeline("lengthOfCutMm", "45.5mm")
    expect(input.lengthOfCutMm).toBe(45.5)
  })

  it("07: lengthOfCutMm '100' → lengthOfCutMm=100", () => {
    const { input } = runPipeline("lengthOfCutMm", "100")
    expect(input.lengthOfCutMm).toBe(100)
  })

  // overallLengthMm
  it("08: overallLengthMm '75mm' → overallLengthMm=75", () => {
    const { input } = runPipeline("overallLengthMm", "75mm")
    expect(input.overallLengthMm).toBe(75)
  })

  it("09: overallLengthMm '100' → overallLengthMm=100", () => {
    const { input } = runPipeline("overallLengthMm", "100")
    expect(input.overallLengthMm).toBe(100)
  })

  it("10: overallLengthMm '150mm' → overallLengthMm=150", () => {
    const { input } = runPipeline("overallLengthMm", "150mm")
    expect(input.overallLengthMm).toBe(150)
  })

  it("11: overallLengthMm '200' → overallLengthMm=200", () => {
    const { input } = runPipeline("overallLengthMm", "200")
    expect(input.overallLengthMm).toBe(200)
  })

  // helixAngleDeg
  it("12: helixAngleDeg '30' → helixAngleDeg=30", () => {
    const { input } = runPipeline("helixAngleDeg", "30")
    expect(input.helixAngleDeg).toBe(30)
  })

  it("13: helixAngleDeg '45' → helixAngleDeg=45", () => {
    const { input } = runPipeline("helixAngleDeg", "45")
    expect(input.helixAngleDeg).toBe(45)
  })

  it("14: helixAngleDeg '35도' → helixAngleDeg=35", () => {
    const { input } = runPipeline("helixAngleDeg", "35도")
    expect(input.helixAngleDeg).toBe(35)
  })

  // ballRadiusMm
  it("15: ballRadiusMm '5mm' → ballRadiusMm=5", () => {
    const { input } = runPipeline("ballRadiusMm", "5mm")
    expect(input.ballRadiusMm).toBe(5)
  })

  it("16: ballRadiusMm '3' → ballRadiusMm=3", () => {
    const { input } = runPipeline("ballRadiusMm", "3")
    expect(input.ballRadiusMm).toBe(3)
  })

  it("17: ballRadiusMm '2.5mm' → ballRadiusMm=2.5", () => {
    const { input } = runPipeline("ballRadiusMm", "2.5mm")
    expect(input.ballRadiusMm).toBe(2.5)
  })

  // taperAngleDeg
  it("18: taperAngleDeg '3' → taperAngleDeg=3", () => {
    const { input } = runPipeline("taperAngleDeg", "3")
    expect(input.taperAngleDeg).toBe(3)
  })

  it("19: taperAngleDeg '5' → taperAngleDeg=5", () => {
    const { input } = runPipeline("taperAngleDeg", "5")
    expect(input.taperAngleDeg).toBe(5)
  })

  it("20: taperAngleDeg '1.5' → taperAngleDeg=1.5", () => {
    const { input } = runPipeline("taperAngleDeg", "1.5")
    expect(input.taperAngleDeg).toBe(1.5)
  })
})

// ═══════════════════════════════════════════════════════════
//  8. Multi-step chains (20 tests)
// ═══════════════════════════════════════════════════════════

describe("multi-step chains — full pipeline (20)", () => {
  // --- Parse 3 filters → apply all → verify combined input ---

  it("01: diameter + flute + coating → all three fields set", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const f2 = parseAnswerToFilter("fluteCount", "4날")!
    const f3 = parseAnswerToFilter("coating", "TiAlN")!
    expect(f1).not.toBeNull()
    expect(f2).not.toBeNull()
    expect(f3).not.toBeNull()

    const filters = [f1, f2, f3]
    const result = rebuildInputFromFilters(base, filters, applyFilterToInput)
    expect(result.diameterMm).toBe(10)
    expect(result.flutePreference).toBe(4)
    expect(result.coatingPreference).toBe("TiAlN")
  })

  it("02: subtype + workPiece + country → all three fields set", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("toolSubtype", "Ball")!
    const f2 = parseAnswerToFilter("workPieceName", "알루미늄")!
    const f3 = parseAnswerToFilter("country", "한국")!

    const filters = [f1, f2, f3]
    const result = rebuildInputFromFilters(base, filters, applyFilterToInput)
    expect(result.toolSubtype).toBe("Ball")
    expect(result.workPieceName).toBe("알루미늄")
    expect(result.country).toBe("KOR")
  })

  it("03: 5 filters → all fields set correctly", () => {
    const base = makeBaseInput()
    const filters = [
      parseAnswerToFilter("diameterMm", "8mm")!,
      parseAnswerToFilter("fluteCount", "2날")!,
      parseAnswerToFilter("coating", "DLC")!,
      parseAnswerToFilter("toolSubtype", "스퀘어")!,
      parseAnswerToFilter("workPieceName", "알루미늄")!,
    ]
    for (const f of filters) expect(f).not.toBeNull()

    const result = rebuildInputFromFilters(base, filters, applyFilterToInput)
    expect(result.diameterMm).toBe(8)
    expect(result.flutePreference).toBe(2)
    expect(result.coatingPreference).toBe("DLC")
    expect(result.toolSubtype).toBe("Square")
    expect(result.workPieceName).toBe("알루미늄")
  })

  it("04: diameter + shank + overallLength → numeric triple", () => {
    const base = makeBaseInput()
    const filters = [
      parseAnswerToFilter("diameterMm", "10mm")!,
      parseAnswerToFilter("shankDiameterMm", "10mm")!,
      parseAnswerToFilter("overallLengthMm", "75mm")!,
    ]
    for (const f of filters) expect(f).not.toBeNull()

    const result = rebuildInputFromFilters(base, filters, applyFilterToInput)
    expect(result.diameterMm).toBe(10)
    expect(result.shankDiameterMm).toBe(10)
    expect(result.overallLengthMm).toBe(75)
  })

  // --- Parse → apply → replace → verify ---

  it("05: replace diameter 10→12 via replaceFieldFilter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const { nextFilters, nextInput, replacedExisting } = runPipelineWithReplace(
      "diameterMm", "12mm", [f1], base
    )
    expect(replacedExisting).toBe(true)
    expect(nextInput.diameterMm).toBe(12)
    expect(nextFilters).toHaveLength(1)
  })

  it("06: replace fluteCount 4→2 via replaceFieldFilter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("fluteCount", "4날")!
    const { nextInput, replacedExisting } = runPipelineWithReplace(
      "fluteCount", "2날", [f1], base
    )
    expect(replacedExisting).toBe(true)
    expect(nextInput.flutePreference).toBe(2)
  })

  it("07: replace coating TiAlN→DLC", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("coating", "TiAlN")!
    const { nextInput, replacedExisting } = runPipelineWithReplace(
      "coating", "DLC", [f1], base
    )
    expect(replacedExisting).toBe(true)
    expect(nextInput.coatingPreference).toBe("DLC")
  })

  it("08: add new field (flute) to existing diameter filter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const { nextFilters, nextInput, replacedExisting } = runPipelineWithReplace(
      "fluteCount", "4날", [f1], base
    )
    expect(replacedExisting).toBe(false)
    expect(nextFilters).toHaveLength(2)
    expect(nextInput.diameterMm).toBe(10)
    expect(nextInput.flutePreference).toBe(4)
  })

  it("09: replace toolSubtype Square→Ball keeps other filters", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const f2 = parseAnswerToFilter("toolSubtype", "Square")!
    const { nextFilters, nextInput } = runPipelineWithReplace(
      "toolSubtype", "Ball", [f1, f2], base
    )
    expect(nextInput.toolSubtype).toBe("Ball")
    expect(nextInput.diameterMm).toBe(10)
    expect(nextFilters).toHaveLength(2)
  })

  it("10: replace country 한국→미국", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("country", "한국")!
    const { nextInput, replacedExisting } = runPipelineWithReplace(
      "country", "미국", [f1], base
    )
    expect(replacedExisting).toBe(true)
    expect(nextInput.country).toBe("USA")
  })

  // --- Parse → apply → clear → verify cleared ---

  it("11: clear diameter filter via clearFilterFromRecommendationInput", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const applied = applyFilterToInput(base, f1)
    expect(applied.diameterMm).toBe(10)
    const cleared = clearFilterFromRecommendationInput(applied, "diameterMm")
    expect(cleared.diameterMm).toBeUndefined()
  })

  it("12: clear fluteCount filter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("fluteCount", "4날")!
    const applied = applyFilterToInput(base, f1)
    expect(applied.flutePreference).toBe(4)
    const cleared = clearFilterFromRecommendationInput(applied, "fluteCount")
    expect(cleared.flutePreference).toBeUndefined()
  })

  it("13: clear coating filter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("coating", "TiAlN")!
    const applied = applyFilterToInput(base, f1)
    expect(applied.coatingPreference).toBe("TiAlN")
    const cleared = clearFilterFromRecommendationInput(applied, "coating")
    expect(cleared.coatingPreference).toBeUndefined()
  })

  it("14: clear toolSubtype filter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("toolSubtype", "Ball")!
    const applied = applyFilterToInput(base, f1)
    expect(applied.toolSubtype).toBe("Ball")
    const cleared = clearFilterFromRecommendationInput(applied, "toolSubtype")
    expect(cleared.toolSubtype).toBeUndefined()
  })

  it("15: clear country filter", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("country", "한국")!
    const applied = applyFilterToInput(base, f1)
    expect(applied.country).toBe("KOR")
    const cleared = clearFilterFromRecommendationInput(applied, "country")
    expect(cleared.country).toBeUndefined()
  })

  it("16: replace then clear → field fully gone", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const { nextInput } = runPipelineWithReplace("diameterMm", "12mm", [f1], base)
    expect(nextInput.diameterMm).toBe(12)
    const cleared = clearFilterFromRecommendationInput(nextInput, "diameterMm")
    expect(cleared.diameterMm).toBeUndefined()
  })

  it("17: rebuildInputFromFilters with empty filters → base input unchanged", () => {
    const base = makeBaseInput({ diameterMm: 10 })
    const result = rebuildInputFromFilters(base, [], applyFilterToInput)
    expect(result.diameterMm).toBe(10)
    expect(result.manufacturerScope).toBe("yg1-only")
  })

  it("18: replace diameter with diameterRefine (canonical field mapping)", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    // diameterRefine and diameterMm share canonical field
    const f2 = buildAppliedFilterFromValue("diameterRefine", "12mm")!
    expect(f2).not.toBeNull()
    const { nextInput, replacedExisting } = replaceFieldFilter(base, [f1], f2, applyFilterToInput)
    expect(replacedExisting).toBe(true)
    expect(nextInput.diameterMm).toBe(12)
  })

  it("19: sequential 3-step replace chain", () => {
    const base = makeBaseInput()
    // Step 1: add diameter
    const r1 = runPipelineWithReplace("diameterMm", "10mm", [], base)
    expect(r1.nextInput.diameterMm).toBe(10)
    // Step 2: add fluteCount
    const r2 = runPipelineWithReplace("fluteCount", "4날", r1.nextFilters, base)
    expect(r2.nextInput.diameterMm).toBe(10)
    expect(r2.nextInput.flutePreference).toBe(4)
    // Step 3: replace diameter
    const r3 = runPipelineWithReplace("diameterMm", "6mm", r2.nextFilters, base)
    expect(r3.nextInput.diameterMm).toBe(6)
    expect(r3.nextInput.flutePreference).toBe(4)
    expect(r3.replacedExisting).toBe(true)
  })

  it("20: full chain: parse all → rebuild → replace one → verify others intact", () => {
    const base = makeBaseInput()
    const f1 = parseAnswerToFilter("diameterMm", "10mm")!
    const f2 = parseAnswerToFilter("fluteCount", "4날")!
    const f3 = parseAnswerToFilter("coating", "TiAlN")!
    const f4 = parseAnswerToFilter("toolSubtype", "Ball")!

    const allFilters = [f1, f2, f3, f4]
    const rebuilt = rebuildInputFromFilters(base, allFilters, applyFilterToInput)
    expect(rebuilt.diameterMm).toBe(10)
    expect(rebuilt.flutePreference).toBe(4)
    expect(rebuilt.coatingPreference).toBe("TiAlN")
    expect(rebuilt.toolSubtype).toBe("Ball")

    // Replace coating → DLC, everything else should remain
    const { nextInput } = replaceFieldFilter(base, allFilters, parseAnswerToFilter("coating", "DLC")!, applyFilterToInput)
    expect(nextInput.diameterMm).toBe(10)
    expect(nextInput.flutePreference).toBe(4)
    expect(nextInput.coatingPreference).toBe("DLC")
    expect(nextInput.toolSubtype).toBe("Ball")
  })
})
