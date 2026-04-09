/**
 * Filter replacement, OR splitting, and dependency clearing tests.
 * No LLM calls — purely deterministic unit tests.
 *
 * Coverage:
 * 1. OR value separation via MULTI_VALUE_SEPARATOR_PATTERN (15+ cases)
 * 2. Material dependency clearing via applyFilterToInput (10+ cases)
 * 3. replaceFieldFilter scenarios (20+ cases)
 * 4. Input field mapping via applyFilterToInput (15+ cases)
 */

import { describe, expect, it } from "vitest"

import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import {
  buildAppliedFilterFromValue,
  parseFieldAnswerToFilter,
} from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function makeBaseInput(): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    diameterMm: 10,
    material: "일반강",
    operationType: "Side Cutting",
    toolType: "엔드밀",
  }
}

function af(
  field: string,
  op: string,
  value: string,
  rawValue: string | number | boolean | Array<string | number | boolean>,
  appliedAt = 0
): AppliedFilter {
  return { field, op, value, rawValue, appliedAt } as AppliedFilter
}

// ═══════════════════════════════════════════════════════════
//  1. OR value separation (MULTI_VALUE_SEPARATOR_PATTERN)
// ═══════════════════════════════════════════════════════════

describe("OR value separation — multi-value splitting", () => {
  // buildAppliedFilterFromValue internally calls splitRawStringValues
  // which uses MULTI_VALUE_SEPARATOR_PATTERN

  it("splits '또는' separator: 'TiAlN 또는 AlCrN' → 2 values", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN 또는 AlCrN")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toEqual(["TiAlN", "AlCrN"])
  })

  it("splits comma separator: 'Square, Radius' → 2 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square, Radius")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits '아니면' separator: '2날 아니면 4날' → 2 values", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "2날 아니면 4날")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toEqual([2, 4])
  })

  it("splits slash separator: 'Ball/Radius' → 2 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Ball/Radius")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits pipe separator: 'TiAlN|AlCrN' → 2 values", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN|AlCrN")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toEqual(["TiAlN", "AlCrN"])
  })

  it("splits '과' separator: 'Square과 Radius' → 2 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square과 Radius")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits '와' separator: 'Ball와 Square' → 2 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Ball와 Square")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits '이나' separator: 'ALU-CUT이나 ALU-POWER' → 2 values", () => {
    const f = buildAppliedFilterFromValue("brand", "ALU-CUT이나 ALU-POWER")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits ' or ' separator: 'TiAlN or AlCrN' → 2 values", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN or AlCrN")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toEqual(["TiAlN", "AlCrN"])
  })

  it("splits ' and ' separator: 'Square and Ball' → 2 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square and Ball")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("splits triple comma values: 'Square, Ball, Radius' → 3 values", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square, Ball, Radius")
    expect(f).not.toBeNull()
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(3)
  })

  it("single value passes through: 'TiAlN' → 1 value (string)", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("TiAlN")
  })

  it("single value passes through: 'Square' → 1 value (string)", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "Square")
    expect(f).not.toBeNull()
    expect(typeof f!.rawValue).toBe("string")
  })

  it("single numeric value passes through: '4' → 1 number", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "4")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(4)
  })

  it("numeric split: '2, 4' → [2, 4]", () => {
    const f = buildAppliedFilterFromValue("fluteCount", "2, 4")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toEqual([2, 4])
  })

  it("deduplicates identical values: 'TiAlN, TiAlN' → 1 value", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN, TiAlN")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("TiAlN")
  })
})

// ═══════════════════════════════════════════════════════════
//  2. Material dependency clearing
// ═══════════════════════════════════════════════════════════

describe("Material dependency clearing — applyFilterToInput", () => {
  it("material change clears workPieceName", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("알루미늄")
    expect(result.workPieceName).toBeUndefined()
  })

  it("material change preserves diameterMm", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.diameterMm).toBe(10)
  })

  it("material change preserves flutePreference", () => {
    const input = { ...makeBaseInput(), flutePreference: 4, workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.flutePreference).toBe(4)
  })

  it("material change preserves coatingPreference", () => {
    const input = { ...makeBaseInput(), coatingPreference: "TiAlN", workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.coatingPreference).toBe("TiAlN")
  })

  it("material change preserves operationType", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.operationType).toBe("Side Cutting")
  })

  it("material change preserves toolType", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.toolType).toBe("엔드밀")
  })

  it("same material re-applied within same ISO group preserves workPieceName", () => {
    // SCM440 은 탄소강(P) 그룹. material '일반강' 도 탄소강(P) → ISO 교집합 존재 →
    // production 은 stale workPieceName 보존 (사용자 의도와 모순 없음).
    const input = { ...makeBaseInput(), workPieceName: "SCM440" }
    const filter = af("material", "eq", "일반강", "일반강")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("일반강")
    expect(result.workPieceName).toBe("SCM440")
  })

  it("workPieceName change does NOT clear material", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("workPieceName", "includes", "SCM440", "SCM440")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("일반강")
    expect(result.workPieceName).toBe("SCM440")
  })

  it("toolType change does NOT clear workPieceName", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("toolType", "includes", "드릴", "드릴")
    const result = applyFilterToInput(input, filter)
    expect(result.workPieceName).toBe("SUS304")
  })

  it("coating change does NOT clear workPieceName", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("coating", "includes", "TiAlN", "TiAlN")
    const result = applyFilterToInput(input, filter)
    expect(result.workPieceName).toBe("SUS304")
  })

  it("material skip clears both material and workPieceName", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "skip", "상관없음", "skip")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBeUndefined()
    expect(result.workPieceName).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
//  3. replaceFieldFilter scenarios
// ═══════════════════════════════════════════════════════════

describe("replaceFieldFilter — field replacement logic", () => {
  it("same field replacement: coating TiAlN → AlCrN", () => {
    const base = makeBaseInput()
    const existing = [af("coating", "includes", "TiAlN", "TiAlN")]
    const next = af("coating", "includes", "AlCrN", "AlCrN")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].rawValue).toBe("AlCrN")
    expect(result.nextInput.coatingPreference).toBe("AlCrN")
  })

  it("same field 3x chain: 2날→4날→6날", () => {
    const base = makeBaseInput()
    const step1 = [af("fluteCount", "eq", "2날", 2)]
    const step1Next = af("fluteCount", "eq", "4날", 4)
    const r1 = replaceFieldFilter(base, step1, step1Next, applyFilterToInput)
    expect(r1.nextInput.flutePreference).toBe(4)

    const step2Next = af("fluteCount", "eq", "6날", 6)
    const r2 = replaceFieldFilter(base, r1.nextFilters, step2Next, applyFilterToInput)
    expect(r2.replacedExisting).toBe(true)
    expect(r2.nextInput.flutePreference).toBe(6)
    expect(r2.nextFilters).toHaveLength(1)
  })

  it("skip to value: 상관없음→Ball", () => {
    const base = makeBaseInput()
    const existing = [af("toolSubtype", "skip", "상관없음", "skip")]
    const next = af("toolSubtype", "includes", "Ball", "Ball")
    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBe("Ball")
  })

  it("value to skip: Ball→상관없음", () => {
    const base = makeBaseInput()
    const existing = [af("toolSubtype", "includes", "Ball", "Ball")]
    const next = af("toolSubtype", "skip", "상관없음", "skip")
    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBeUndefined()
  })

  it("different field: replace coating while keeping fluteCount", () => {
    const base = makeBaseInput()
    const existing = [
      af("fluteCount", "eq", "4날", 4),
      af("coating", "includes", "TiAlN", "TiAlN"),
    ]
    const next = af("coating", "includes", "AlCrN", "AlCrN")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(2)
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.coatingPreference).toBe("AlCrN")
  })

  it("5 filters, replace middle one", () => {
    const base = makeBaseInput()
    const existing = [
      af("fluteCount", "eq", "4날", 4),
      af("coating", "includes", "TiAlN", "TiAlN"),
      af("toolSubtype", "includes", "Square", "Square"),
      af("brand", "includes", "V7 PLUS", "V7 PLUS"),
      af("seriesName", "includes", "V7 PLUS", "V7 PLUS"),
    ]
    const next = af("toolSubtype", "includes", "Ball", "Ball")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(5)
    expect(result.nextInput.toolSubtype).toBe("Ball")
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.coatingPreference).toBe("TiAlN")
  })

  it("6 filters, replace first and last sequentially", () => {
    const base = makeBaseInput()
    const existing = [
      af("fluteCount", "eq", "2날", 2),
      af("coating", "includes", "TiAlN", "TiAlN"),
      af("toolSubtype", "includes", "Square", "Square"),
      af("brand", "includes", "V7 PLUS", "V7 PLUS"),
      af("seriesName", "includes", "V7 PLUS", "V7 PLUS"),
      af("helixAngleDeg", "eq", "30°", 30),
    ]

    // Replace first
    const r1 = replaceFieldFilter(base, existing, af("fluteCount", "eq", "6날", 6), applyFilterToInput)
    expect(r1.nextInput.flutePreference).toBe(6)

    // Replace last
    const r2 = replaceFieldFilter(base, r1.nextFilters, af("helixAngleDeg", "eq", "45°", 45), applyFilterToInput)
    expect(r2.nextInput.helixAngleDeg).toBe(45)
    expect(r2.nextInput.flutePreference).toBe(6)
    expect(r2.nextFilters).toHaveLength(6)
  })

  it("new field (not existing): adds instead of replaces", () => {
    const base = makeBaseInput()
    const existing = [af("fluteCount", "eq", "4날", 4)]
    const next = af("coating", "includes", "TiAlN", "TiAlN")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(false)
    expect(result.nextFilters).toHaveLength(2)
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.coatingPreference).toBe("TiAlN")
  })

  it("replace diameter: 10mm→12mm", () => {
    const base = makeBaseInput()
    const existing = [af("diameterMm", "eq", "10mm", 10)]
    const next = af("diameterMm", "eq", "12mm", 12)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.diameterMm).toBe(12)
  })

  it("replace lengthOfCutMm: 25→30", () => {
    const base = makeBaseInput()
    const existing = [af("lengthOfCutMm", "eq", "25mm", 25)]
    const next = af("lengthOfCutMm", "eq", "30mm", 30)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.lengthOfCutMm).toBe(30)
  })

  it("replace shankDiameterMm: 10→8", () => {
    const base = makeBaseInput()
    const existing = [af("shankDiameterMm", "eq", "10mm", 10)]
    const next = af("shankDiameterMm", "eq", "8mm", 8)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.shankDiameterMm).toBe(8)
  })

  it("replace helixAngleDeg: 30→45", () => {
    const base = makeBaseInput()
    const existing = [af("helixAngleDeg", "eq", "30°", 30)]
    const next = af("helixAngleDeg", "eq", "45°", 45)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.helixAngleDeg).toBe(45)
  })

  it("replace overallLengthMm: 75→100", () => {
    const base = makeBaseInput()
    const existing = [af("overallLengthMm", "eq", "75mm", 75)]
    const next = af("overallLengthMm", "eq", "100mm", 100)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.overallLengthMm).toBe(100)
  })

  it("replace ballRadiusMm: 5→3", () => {
    const base = makeBaseInput()
    const existing = [af("ballRadiusMm", "eq", "5mm", 5)]
    const next = af("ballRadiusMm", "eq", "3mm", 3)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.ballRadiusMm).toBe(3)
  })

  it("replace taperAngleDeg: 3→5", () => {
    const base = makeBaseInput()
    const existing = [af("taperAngleDeg", "eq", "3°", 3)]
    const next = af("taperAngleDeg", "eq", "5°", 5)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.taperAngleDeg).toBe(5)
  })

  it("replace brand: ALU-POWER → V7 PLUS", () => {
    const base = makeBaseInput()
    const existing = [af("brand", "includes", "ALU-POWER", "ALU-POWER")]
    const next = af("brand", "includes", "V7 PLUS", "V7 PLUS")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.brand).toBe("V7 PLUS")
  })

  it("replace seriesName: V7 PLUS → X5070", () => {
    const base = makeBaseInput()
    const existing = [af("seriesName", "includes", "V7 PLUS", "V7 PLUS")]
    const next = af("seriesName", "includes", "X5070", "X5070")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.seriesName).toBe("X5070")
  })

  it("diameterRefine replaces diameterMm (canonical field mapping)", () => {
    const base = makeBaseInput()
    const existing = [af("diameterMm", "eq", "10mm", 10)]
    const next = af("diameterRefine", "eq", "8mm", 8)

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.diameterMm).toBe(8)
  })

  it("empty filters array → adds new filter", () => {
    const base = makeBaseInput()
    const next = af("fluteCount", "eq", "4날", 4)

    const result = replaceFieldFilter(base, [], next, applyFilterToInput)
    expect(result.replacedExisting).toBe(false)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextInput.flutePreference).toBe(4)
  })

  it("replace material clears workPieceName from rebuilt input", () => {
    const base = { ...makeBaseInput(), workPieceName: "SUS304" }
    const existing = [af("material", "eq", "일반강", "일반강")]
    const next = af("material", "eq", "알루미늄", "알루미늄")

    const result = replaceFieldFilter(base, existing, next, applyFilterToInput)
    expect(result.nextInput.material).toBe("알루미늄")
    expect(result.nextInput.workPieceName).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
//  4. Input field mapping — applyFilterToInput per field
// ═══════════════════════════════════════════════════════════

describe("Input field mapping — applyFilterToInput per field", () => {
  it("fluteCount → flutePreference", () => {
    const input = makeBaseInput()
    const filter = af("fluteCount", "eq", "4날", 4)
    const result = applyFilterToInput(input, filter)
    expect(result.flutePreference).toBe(4)
  })

  it("coating → coatingPreference", () => {
    const input = makeBaseInput()
    const filter = af("coating", "includes", "TiAlN", "TiAlN")
    const result = applyFilterToInput(input, filter)
    expect(result.coatingPreference).toBe("TiAlN")
  })

  it("toolSubtype → toolSubtype", () => {
    const input = makeBaseInput()
    const filter = af("toolSubtype", "includes", "Ball", "Ball")
    const result = applyFilterToInput(input, filter)
    expect(result.toolSubtype).toBe("Ball")
  })

  it("cuttingType → operationType", () => {
    const input = makeBaseInput()
    const filter = af("cuttingType", "eq", "Slotting", "Slotting")
    const result = applyFilterToInput(input, filter)
    expect(result.operationType).toBe("Slotting")
  })

  it("brand → brand", () => {
    const input = makeBaseInput()
    const filter = af("brand", "includes", "ALU-POWER HPC", "ALU-POWER HPC")
    const result = applyFilterToInput(input, filter)
    expect(result.brand).toBe("ALU-POWER HPC")
  })

  it("country → country (raw filter, applyFilterToInput stores as-is)", () => {
    const input = makeBaseInput()
    const filter = af("country", "includes", "KOR", "KOR")
    const result = applyFilterToInput(input, filter)
    // applyFilterToInput 은 canonical 화 하지 않고 raw rawValue 를 그대로 저장.
    // canonical 변환은 parseAnswerToFilter / buildAppliedFilterFromValue 진입점에서 발생.
    expect(result.country).toBe("KOR")
  })

  it("diameterMm → diameterMm", () => {
    const input = makeBaseInput()
    const filter = af("diameterMm", "eq", "12mm", 12)
    const result = applyFilterToInput(input, filter)
    expect(result.diameterMm).toBe(12)
  })

  it("lengthOfCutMm → lengthOfCutMm", () => {
    const input = makeBaseInput()
    const filter = af("lengthOfCutMm", "eq", "25mm", 25)
    const result = applyFilterToInput(input, filter)
    expect(result.lengthOfCutMm).toBe(25)
  })

  it("overallLengthMm → overallLengthMm", () => {
    const input = makeBaseInput()
    const filter = af("overallLengthMm", "eq", "75mm", 75)
    const result = applyFilterToInput(input, filter)
    expect(result.overallLengthMm).toBe(75)
  })

  it("shankDiameterMm → shankDiameterMm", () => {
    const input = makeBaseInput()
    const filter = af("shankDiameterMm", "eq", "10mm", 10)
    const result = applyFilterToInput(input, filter)
    expect(result.shankDiameterMm).toBe(10)
  })

  it("helixAngleDeg → helixAngleDeg", () => {
    const input = makeBaseInput()
    const filter = af("helixAngleDeg", "eq", "45°", 45)
    const result = applyFilterToInput(input, filter)
    expect(result.helixAngleDeg).toBe(45)
  })

  it("ballRadiusMm → ballRadiusMm", () => {
    const input = makeBaseInput()
    const filter = af("ballRadiusMm", "eq", "5mm", 5)
    const result = applyFilterToInput(input, filter)
    expect(result.ballRadiusMm).toBe(5)
  })

  it("taperAngleDeg → taperAngleDeg", () => {
    const input = makeBaseInput()
    const filter = af("taperAngleDeg", "eq", "3°", 3)
    const result = applyFilterToInput(input, filter)
    expect(result.taperAngleDeg).toBe(3)
  })

  it("seriesName → seriesName", () => {
    const input = makeBaseInput()
    const filter = af("seriesName", "includes", "V7 PLUS", "V7 PLUS")
    const result = applyFilterToInput(input, filter)
    expect(result.seriesName).toBe("V7 PLUS")
  })

  it("toolMaterial → toolMaterial", () => {
    const input = makeBaseInput()
    const filter = af("toolMaterial", "includes", "초경", "초경")
    const result = applyFilterToInput(input, filter)
    expect(result.toolMaterial).toBe("초경")
  })

  it("material → material (clears workPieceName when ISO group differs)", () => {
    // SUS304 는 스테인리스(M). 새 material '알루미늄' 은 N → 다른 그룹 → 클리어.
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "알루미늄", "알루미늄")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("알루미늄")
    expect(result.workPieceName).toBeUndefined()
  })

  it("workPieceName → workPieceName", () => {
    const input = makeBaseInput()
    const filter = af("workPieceName", "includes", "SCM440", "SCM440")
    const result = applyFilterToInput(input, filter)
    expect(result.workPieceName).toBe("SCM440")
  })

  it("toolType → toolType", () => {
    const input = makeBaseInput()
    const filter = af("toolType", "includes", "Solid", "Solid")
    const result = applyFilterToInput(input, filter)
    expect(result.toolType).toBe("Solid")
  })

  it("skip op clears the field", () => {
    const input = { ...makeBaseInput(), flutePreference: 4 }
    const filter = af("fluteCount", "skip", "상관없음", "skip")
    const result = applyFilterToInput(input, filter)
    expect(result.flutePreference).toBeUndefined()
  })

  it("skip rawValue clears the field", () => {
    const input = { ...makeBaseInput(), coatingPreference: "TiAlN" }
    const filter = af("coating", "includes", "상관없음", "skip")
    const result = applyFilterToInput(input, filter)
    expect(result.coatingPreference).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
//  5. parseFieldAnswerToFilter edge cases (bonus coverage)
// ═══════════════════════════════════════════════════════════

describe("parseFieldAnswerToFilter — edge cases", () => {
  it("strips count suffix: 'Square (3개)' → Square", () => {
    const f = parseFieldAnswerToFilter("toolSubtype", "Square (3개)")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Square")
  })

  it("returns null for skip tokens: '상관없음'", () => {
    const f = parseFieldAnswerToFilter("coating", "상관없음")
    expect(f).toBeNull()
  })

  it("returns null for 'skip'", () => {
    const f = parseFieldAnswerToFilter("fluteCount", "skip")
    expect(f).toBeNull()
  })

  it("returns null for empty string", () => {
    const f = parseFieldAnswerToFilter("coating", "")
    expect(f).toBeNull()
  })

  it("returns null for unknown field", () => {
    const f = parseFieldAnswerToFilter("nonExistentField", "value")
    expect(f).toBeNull()
  })

  it("handles leading/trailing whitespace", () => {
    const f = parseFieldAnswerToFilter("coating", "  TiAlN  ")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("TiAlN")
  })
})

// ═══════════════════════════════════════════════════════════
//  5. Creative combination tests (50 cases)
//     - Multi-filter apply + change
//     - 5 filters → remove 3
//     - Skip all → revise one
//     - diameterRefine chain
//     - material → workPieceName dependency
// ═══════════════════════════════════════════════════════════

describe("creative combination: 2 filters applied → change both → verify both changed", () => {
  it("coating + fluteCount → replace both", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    let input = base

    // Apply coating=TiAlN
    const f1 = af("coating", "includes", "TiAlN", "TiAlN", 1)
    const r1 = replaceFieldFilter(input, filters, f1, applyFilterToInput)
    filters = r1.nextFilters
    input = r1.nextInput

    // Apply fluteCount=2
    const f2 = af("fluteCount", "eq", "2날", 2, 2)
    const r2 = replaceFieldFilter(input, filters, f2, applyFilterToInput)
    filters = r2.nextFilters
    input = r2.nextInput

    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.flutePreference).toBe(2)

    // Change coating → AlCrN
    const f3 = af("coating", "includes", "AlCrN", "AlCrN", 3)
    const r3 = replaceFieldFilter(base, filters, f3, applyFilterToInput)
    filters = r3.nextFilters
    input = r3.nextInput

    // Change fluteCount → 4
    const f4 = af("fluteCount", "eq", "4날", 4, 4)
    const r4 = replaceFieldFilter(base, filters, f4, applyFilterToInput)
    filters = r4.nextFilters
    input = r4.nextInput

    expect(r3.replacedExisting).toBe(true)
    expect(r4.replacedExisting).toBe(true)
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.flutePreference).toBe(4)
    expect(filters.length).toBe(2)
  })

  it("diameterMm + coating → replace both simultaneously", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const f1 = af("diameterMm", "eq", "10mm", 10, 1)
    const r1 = replaceFieldFilter(base, filters, f1, applyFilterToInput)
    filters = r1.nextFilters

    const f2 = af("coating", "includes", "DLC", "DLC", 2)
    const r2 = replaceFieldFilter(base, filters, f2, applyFilterToInput)
    filters = r2.nextFilters

    // Replace diameter
    const f3 = af("diameterMm", "eq", "8mm", 8, 3)
    const r3 = replaceFieldFilter(base, filters, f3, applyFilterToInput)
    filters = r3.nextFilters

    // Replace coating
    const f4 = af("coating", "includes", "TiN", "TiN", 4)
    const r4 = replaceFieldFilter(base, filters, f4, applyFilterToInput)
    filters = r4.nextFilters

    expect(r4.nextInput.diameterMm).toBe(8)
    expect(r4.nextInput.coatingPreference).toBe("TiN")
  })

  it("material + toolSubtype → replace both", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const f1 = af("material", "eq", "일반강", "일반강", 1)
    const r1 = replaceFieldFilter(base, filters, f1, applyFilterToInput)
    filters = r1.nextFilters

    const f2 = af("toolSubtype", "includes", "Square", "Square", 2)
    const r2 = replaceFieldFilter(base, filters, f2, applyFilterToInput)
    filters = r2.nextFilters

    const f3 = af("material", "eq", "스테인리스강", "스테인리스강", 3)
    const r3 = replaceFieldFilter(base, filters, f3, applyFilterToInput)
    filters = r3.nextFilters

    const f4 = af("toolSubtype", "includes", "Ball", "Ball", 4)
    const r4 = replaceFieldFilter(base, filters, f4, applyFilterToInput)
    filters = r4.nextFilters

    expect(r4.nextInput.material).toBe("스테인리스강")
    expect(r4.nextInput.toolSubtype).toBe("Ball")
    expect(filters.length).toBe(2)
  })
})

describe("creative combination: 5 filters → remove 3 → verify 2 remain", () => {
  it("apply 5 filters then skip 3 of them", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    let input = base

    // Apply 5 filters
    const f1 = af("coating", "includes", "TiAlN", "TiAlN", 1)
    const f2 = af("fluteCount", "eq", "4날", 4, 2)
    const f3 = af("toolSubtype", "includes", "Square", "Square", 3)
    const f4 = af("lengthOfCutMm", "eq", "20mm", 20, 4)
    const f5 = af("helixAngleDeg", "eq", "35°", 35, 5)

    for (const f of [f1, f2, f3, f4, f5]) {
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
      input = r.nextInput
    }
    expect(filters.length).toBe(5)

    // Skip 3 (coating, toolSubtype, helixAngleDeg)
    const skip1: AppliedFilter = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 6 }
    const skip2: AppliedFilter = { field: "toolSubtype", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 7 }
    const skip3: AppliedFilter = { field: "helixAngleDeg", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 8 }

    for (const s of [skip1, skip2, skip3]) {
      const r = replaceFieldFilter(base, filters, s, applyFilterToInput)
      filters = r.nextFilters
      input = r.nextInput
    }

    // Should have 5 filters (3 skipped + 2 real)
    expect(filters.length).toBe(5)
    // Real values remain
    expect(input.flutePreference).toBe(4)
    expect(input.lengthOfCutMm).toBe(20)
    // Skipped values cleared
    expect(input.coatingPreference).toBeUndefined()
    expect(input.toolSubtype).toBeUndefined()
    expect(input.helixAngleDeg).toBeUndefined()
  })

  it("apply 5 numeric filters, remove 3 via skip, remaining 2 persist", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const f1 = af("diameterMm", "eq", "10mm", 10, 1)
    const f2 = af("fluteCount", "eq", "2날", 2, 2)
    const f3 = af("lengthOfCutMm", "eq", "15mm", 15, 3)
    const f4 = af("overallLengthMm", "eq", "75mm", 75, 4)
    const f5 = af("helixAngleDeg", "eq", "30°", 30, 5)

    for (const f of [f1, f2, f3, f4, f5]) {
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
    }

    // Remove diameter, LOC, helix
    const skips = [
      { field: "diameterMm", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 6 } as AppliedFilter,
      { field: "lengthOfCutMm", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 7 } as AppliedFilter,
      { field: "helixAngleDeg", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 8 } as AppliedFilter,
    ]
    for (const s of skips) {
      const r = replaceFieldFilter(base, filters, s, applyFilterToInput)
      filters = r.nextFilters
    }

    const finalInput = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(finalInput.flutePreference).toBe(2)
    expect(finalInput.overallLengthMm).toBe(75)
    expect(finalInput.diameterMm).toBeUndefined()
    expect(finalInput.lengthOfCutMm).toBeUndefined()
    expect(finalInput.helixAngleDeg).toBeUndefined()
  })
})

describe("creative combination: skip all fields → revise one → verify only that one set", () => {
  it("skip coating, fluteCount, toolSubtype then revise fluteCount only", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    // Skip all three
    const skipCoating: AppliedFilter = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 }
    const skipFlute: AppliedFilter = { field: "fluteCount", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 2 }
    const skipSubtype: AppliedFilter = { field: "toolSubtype", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 3 }

    for (const s of [skipCoating, skipFlute, skipSubtype]) {
      const r = replaceFieldFilter(base, filters, s, applyFilterToInput)
      filters = r.nextFilters
    }

    let input = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(input.coatingPreference).toBeUndefined()
    expect(input.flutePreference).toBeUndefined()
    expect(input.toolSubtype).toBeUndefined()

    // Now revise fluteCount to 4
    const reviseFlute = af("fluteCount", "eq", "4날", 4, 4)
    const r = replaceFieldFilter(base, filters, reviseFlute, applyFilterToInput)
    filters = r.nextFilters
    input = r.nextInput

    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBeUndefined()
    expect(input.toolSubtype).toBeUndefined()
  })

  it("skip all 4 fields → revise diameter only → others remain cleared", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const skips = [
      { field: "diameterMm", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 } as AppliedFilter,
      { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 2 } as AppliedFilter,
      { field: "fluteCount", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 3 } as AppliedFilter,
      { field: "toolSubtype", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 4 } as AppliedFilter,
    ]
    for (const s of skips) {
      const r = replaceFieldFilter(base, filters, s, applyFilterToInput)
      filters = r.nextFilters
    }

    const reviseDia = af("diameterMm", "eq", "6mm", 6, 5)
    const r = replaceFieldFilter(base, filters, reviseDia, applyFilterToInput)

    expect(r.nextInput.diameterMm).toBe(6)
    expect(r.nextInput.coatingPreference).toBeUndefined()
    expect(r.nextInput.flutePreference).toBeUndefined()
    expect(r.nextInput.toolSubtype).toBeUndefined()
  })
})

describe("creative combination: diameterRefine chain — 5 consecutive changes", () => {
  it("10 → 9.95 → 10.05 → 8 → 12", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const diameters = [10, 9.95, 10.05, 8, 12]
    for (let i = 0; i < diameters.length; i++) {
      const f = af("diameterRefine", "eq", `${diameters[i]}mm`, diameters[i], i + 1)
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters

      // Each step should have exactly 1 filter
      expect(filters.length).toBe(1)
      expect(r.nextInput.diameterMm).toBe(diameters[i])
      if (i > 0) expect(r.replacedExisting).toBe(true)
    }
  })

  it("chain: 6 → 6.5 → 5 → 5.5 → 20", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    for (const dia of [6, 6.5, 5, 5.5, 20]) {
      const f = af("diameterRefine", "eq", `${dia}mm`, dia, Date.now())
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
      expect(r.nextInput.diameterMm).toBe(dia)
    }
    expect(filters.length).toBe(1)
  })

  it("diameterMm then diameterRefine replaces it (canonical field match)", () => {
    const base = makeBaseInput()
    const f1 = af("diameterMm", "eq", "10mm", 10, 1)
    const r1 = replaceFieldFilter(base, [], f1, applyFilterToInput)

    const f2 = af("diameterRefine", "eq", "8mm", 8, 2)
    const r2 = replaceFieldFilter(base, r1.nextFilters, f2, applyFilterToInput)

    expect(r2.replacedExisting).toBe(true)
    expect(r2.nextInput.diameterMm).toBe(8)
    expect(r2.nextFilters.length).toBe(1)
  })

  it("alternating diameterMm and diameterRefine 4 times", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    const sequence = [
      { field: "diameterMm", val: 10 },
      { field: "diameterRefine", val: 9 },
      { field: "diameterMm", val: 11 },
      { field: "diameterRefine", val: 12 },
    ] as const

    for (let i = 0; i < sequence.length; i++) {
      const { field, val } = sequence[i]
      const f = af(field, "eq", `${val}mm`, val, i + 1)
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
      expect(r.nextInput.diameterMm).toBe(val)
    }
    expect(filters.length).toBe(1)
  })
})

describe("creative combination: material change → workPieceName clear → re-add → material change", () => {
  it("material change clears workPieceName, re-add workPieceName, then material change again clears it", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    let input = base

    // Set workPieceName
    const wp1 = af("workPieceName", "includes", "ADC12", "ADC12", 1)
    let r = replaceFieldFilter(base, filters, wp1, applyFilterToInput)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")

    // Change material → should clear workPieceName
    const mat1 = af("material", "eq", "주철", "주철", 2)
    r = replaceFieldFilter(base, filters, mat1, applyFilterToInput)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("주철")
    expect(input.workPieceName).toBeUndefined()

    // Re-add workPieceName
    const wp2 = af("workPieceName", "includes", "FC300", "FC300", 3)
    r = replaceFieldFilter(base, filters, wp2, applyFilterToInput)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.workPieceName).toBe("FC300")

    // Change material again → should clear workPieceName again
    const mat2 = af("material", "eq", "알루미늄", "알루미늄", 4)
    r = replaceFieldFilter(base, filters, mat2, applyFilterToInput)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("알루미늄")
    expect(input.workPieceName).toBeUndefined()
  })

  it("3 cycles of material + workPieceName dependency clearing", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const cycles = [
      { material: "일반강", wp: "SCM440" },
      { material: "스테인리스강", wp: "SUS304" },
      { material: "알루미늄", wp: "A7075" },
    ]

    for (const cycle of cycles) {
      const matF = af("material", "eq", cycle.material, cycle.material, Date.now())
      let r = replaceFieldFilter(base, filters, matF, applyFilterToInput)
      filters = r.nextFilters
      // workPieceName should be cleared after material change
      expect(r.nextInput.workPieceName).toBeUndefined()

      const wpF = af("workPieceName", "includes", cycle.wp, cycle.wp, Date.now())
      r = replaceFieldFilter(base, filters, wpF, applyFilterToInput)
      filters = r.nextFilters
      expect(r.nextInput.workPieceName).toBe(cycle.wp)
      expect(r.nextInput.material).toBe(cycle.material)
    }
  })
})

describe("creative: multi-field stress — apply 8 filters sequentially", () => {
  it("apply all 8 different fields and verify final state", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    let input = base

    const sequence: AppliedFilter[] = [
      af("diameterMm", "eq", "10mm", 10, 1),
      af("coating", "includes", "TiAlN", "TiAlN", 2),
      af("fluteCount", "eq", "4날", 4, 3),
      af("toolSubtype", "includes", "Ball", "Ball", 4),
      af("lengthOfCutMm", "eq", "20mm", 20, 5),
      af("overallLengthMm", "eq", "75mm", 75, 6),
      af("helixAngleDeg", "eq", "35°", 35, 7),
      af("material", "eq", "주철", "주철", 8),
    ]

    for (const f of sequence) {
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
      input = r.nextInput
    }

    expect(filters.length).toBe(8)
    expect(input.diameterMm).toBe(10)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.flutePreference).toBe(4)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.lengthOfCutMm).toBe(20)
    expect(input.overallLengthMm).toBe(75)
    expect(input.helixAngleDeg).toBe(35)
    expect(input.material).toBe("주철")
  })

  it("apply 8 filters then replace all 8 with new values", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    const original: AppliedFilter[] = [
      af("diameterMm", "eq", "10mm", 10, 1),
      af("coating", "includes", "TiAlN", "TiAlN", 2),
      af("fluteCount", "eq", "4날", 4, 3),
      af("toolSubtype", "includes", "Ball", "Ball", 4),
      af("lengthOfCutMm", "eq", "20mm", 20, 5),
      af("overallLengthMm", "eq", "75mm", 75, 6),
      af("helixAngleDeg", "eq", "35°", 35, 7),
      af("material", "eq", "주철", "주철", 8),
    ]

    for (const f of original) {
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
    }

    // Replace all with new values
    const replacements: AppliedFilter[] = [
      af("diameterMm", "eq", "6mm", 6, 9),
      af("coating", "includes", "AlCrN", "AlCrN", 10),
      af("fluteCount", "eq", "2날", 2, 11),
      af("toolSubtype", "includes", "Square", "Square", 12),
      af("lengthOfCutMm", "eq", "15mm", 15, 13),
      af("overallLengthMm", "eq", "50mm", 50, 14),
      af("helixAngleDeg", "eq", "45°", 45, 15),
      af("material", "eq", "알루미늄", "알루미늄", 16),
    ]

    for (const f of replacements) {
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
      expect(r.replacedExisting).toBe(true)
    }

    const finalInput = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(filters.length).toBe(8)
    expect(finalInput.diameterMm).toBe(6)
    expect(finalInput.coatingPreference).toBe("AlCrN")
    expect(finalInput.flutePreference).toBe(2)
    expect(finalInput.toolSubtype).toBe("Square")
    expect(finalInput.lengthOfCutMm).toBe(15)
    expect(finalInput.overallLengthMm).toBe(50)
    expect(finalInput.helixAngleDeg).toBe(45)
    expect(finalInput.material).toBe("알루미늄")
  })
})

describe("creative: rapid-fire same field replacement — 10 consecutive values", () => {
  it("coating changed 10 times — only last value survives", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    const coatings = ["TiAlN", "AlCrN", "DLC", "TiN", "TiCN", "Blue", "Black", "Diamond", "Bright", "Uncoated"]

    for (let i = 0; i < coatings.length; i++) {
      const f = af("coating", "includes", coatings[i], coatings[i], i + 1)
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
    }

    expect(filters.length).toBe(1)
    const finalInput = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(finalInput.coatingPreference).toBe("Uncoated")
  })

  it("fluteCount changed 6 times", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []
    const fluteCounts = [2, 3, 4, 6, 8, 2]

    for (let i = 0; i < fluteCounts.length; i++) {
      const f = af("fluteCount", "eq", `${fluteCounts[i]}날`, fluteCounts[i], i + 1)
      const r = replaceFieldFilter(base, filters, f, applyFilterToInput)
      filters = r.nextFilters
    }

    expect(filters.length).toBe(1)
    const finalInput = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(finalInput.flutePreference).toBe(2)
  })
})

describe("creative: interleaved add-and-skip pattern", () => {
  it("add A, add B, skip A, add C, skip B → only C remains active", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    // Add coating
    let r = replaceFieldFilter(base, filters, af("coating", "includes", "TiAlN", "TiAlN", 1), applyFilterToInput)
    filters = r.nextFilters

    // Add fluteCount
    r = replaceFieldFilter(base, filters, af("fluteCount", "eq", "4날", 4, 2), applyFilterToInput)
    filters = r.nextFilters

    // Skip coating
    r = replaceFieldFilter(base, filters, { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 3 } as AppliedFilter, applyFilterToInput)
    filters = r.nextFilters

    // Add toolSubtype
    r = replaceFieldFilter(base, filters, af("toolSubtype", "includes", "Ball", "Ball", 4), applyFilterToInput)
    filters = r.nextFilters

    // Skip fluteCount
    r = replaceFieldFilter(base, filters, { field: "fluteCount", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 5 } as AppliedFilter, applyFilterToInput)
    filters = r.nextFilters

    const finalInput = filters.reduce((inp, f) => applyFilterToInput(inp, f), base)
    expect(finalInput.coatingPreference).toBeUndefined()
    expect(finalInput.flutePreference).toBeUndefined()
    expect(finalInput.toolSubtype).toBe("Ball")
  })

  it("skip then immediately un-skip (replace skip with real value)", () => {
    const base = makeBaseInput()
    let filters: AppliedFilter[] = []

    // Apply real value
    let r = replaceFieldFilter(base, filters, af("coating", "includes", "TiAlN", "TiAlN", 1), applyFilterToInput)
    filters = r.nextFilters

    // Skip it
    r = replaceFieldFilter(base, filters, { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 2 } as AppliedFilter, applyFilterToInput)
    filters = r.nextFilters
    expect(r.nextInput.coatingPreference).toBeUndefined()

    // Immediately un-skip by applying new value
    r = replaceFieldFilter(base, filters, af("coating", "includes", "AlCrN", "AlCrN", 3), applyFilterToInput)
    filters = r.nextFilters
    expect(r.nextInput.coatingPreference).toBe("AlCrN")
    expect(r.replacedExisting).toBe(true)
  })
})

describe("creative: buildAppliedFilterFromValue edge cases", () => {
  it("TiAlN/AlCrN — slash separated coating", () => {
    const f = buildAppliedFilterFromValue("coating", "TiAlN/AlCrN")
    expect(f).not.toBeNull()
    // Slash is a multi-value separator
    expect(Array.isArray(f!.rawValue)).toBe(true)
    expect((f!.rawValue as string[]).length).toBe(2)
  })

  it("coolantHole with '있음'", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "있음")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(true)
  })

  it("coolantHole with '없음'", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "없음")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(false)
  })

  it("coolantHole with true", () => {
    const f = buildAppliedFilterFromValue("coolantHole", true)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(true)
  })

  it("coolantHole with false", () => {
    const f = buildAppliedFilterFromValue("coolantHole", false)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(false)
  })

  it("coolantHole with 'yes'", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "yes")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(true)
  })

  it("coolantHole with 'no'", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "no")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(false)
  })

  it("diameterMm with 0 returns filter with 0", () => {
    const f = buildAppliedFilterFromValue("diameterMm", 0)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(0)
  })

  it("diameterMm with 999 returns filter with 999", () => {
    const f = buildAppliedFilterFromValue("diameterMm", 999)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(999)
  })

  it("diameterMm with negative value -1 extracts -1", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "-1mm")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(-1)
  })
})

describe("creative: parseFieldAnswerToFilter field name variations", () => {
  it("fluteCount from '2날'", () => {
    const f = parseFieldAnswerToFilter("fluteCount", "2날")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(2)
  })

  it("fluteCount from 'four flute'", () => {
    const f = parseFieldAnswerToFilter("fluteCount", "four flute")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(4)
  })

  it("fluteCount from '날 3개'", () => {
    const f = parseFieldAnswerToFilter("fluteCount", "날 3개")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(3)
  })

  it("fluteCount from 'flute 6'", () => {
    const f = parseFieldAnswerToFilter("fluteCount", "flute 6")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(6)
  })

  it("diameterMm from '파이10'", () => {
    const f = parseFieldAnswerToFilter("diameterMm", "파이10")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(10)
  })

  it("diameterMm from 'φ6.5mm'", () => {
    const f = parseFieldAnswerToFilter("diameterMm", "φ6.5mm")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(6.5)
  })

  it("coating from '블루코팅' → Blue", () => {
    const f = parseFieldAnswerToFilter("coating", "블루코팅")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Blue")
  })

  it("toolSubtype from '스퀘어' → Square", () => {
    const f = parseFieldAnswerToFilter("toolSubtype", "스퀘어")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Square")
  })

  it("toolSubtype from '황삭' → Roughing", () => {
    const f = parseFieldAnswerToFilter("toolSubtype", "황삭")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("Roughing")
  })

  it("material via parseFieldAnswerToFilter('material', '주철')", () => {
    const f = parseFieldAnswerToFilter("material", "주철")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("주철")
  })
})

// Production canonical 은 region 단위 (KOREA / AMERICA / ASIA / EUROPE).
// MV.country_codes 가 region 으로 저장되도록 변경된 후 stale 했던 테스트 갱신.
describe("creative: country canonicalization", () => {
  it.each([
    ["한국", "KOREA"],
    ["korea", "KOREA"],
    ["미국", "AMERICA"],
    ["usa", "AMERICA"],
    ["일본", "ASIA"],   // 한국 외 아시아 → ASIA region
    ["독일", "EUROPE"],
    ["germany", "EUROPE"],
  ])("buildAppliedFilterFromValue('country', %j) rawValue → %j", (input, expected) => {
    const f = buildAppliedFilterFromValue("country", input)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(expected)
  })

  it("region '아시아' → ASIA region (직접 입력)", () => {
    const f = buildAppliedFilterFromValue("country", "아시아")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe("ASIA")
  })
})
