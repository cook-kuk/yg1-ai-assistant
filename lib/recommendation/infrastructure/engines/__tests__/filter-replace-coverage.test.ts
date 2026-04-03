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

  it("same material re-applied still clears workPieceName", () => {
    const input = { ...makeBaseInput(), workPieceName: "SCM440" }
    const filter = af("material", "eq", "일반강", "일반강")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("일반강")
    expect(result.workPieceName).toBeUndefined()
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

  it("country → country (uppercase)", () => {
    const input = makeBaseInput()
    const filter = af("country", "includes", "KOR", "KOR")
    const result = applyFilterToInput(input, filter)
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

  it("material → material (and clears workPieceName)", () => {
    const input = { ...makeBaseInput(), workPieceName: "SUS304" }
    const filter = af("material", "eq", "스테인리스", "스테인리스")
    const result = applyFilterToInput(input, filter)
    expect(result.material).toBe("스테인리스")
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
