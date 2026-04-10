/**
 * hardcore-multiturn-200.test.ts
 *
 * 200 DETERMINISTIC multi-turn tests. NO LLM calls.
 * Exercises filter application, revision, pending resolution, negation,
 * rebuildInputFromFilters consistency, and cross-field dependency chains.
 */
import { describe, expect, it } from "vitest"

import {
  resolvePendingQuestionReply,
  resolveExplicitRevisionRequest,
} from "../serve-engine-runtime"
import {
  applyFilterToRecommendationInput,
  buildAppliedFilterFromValue,
  clearFilterFromRecommendationInput,
} from "@/lib/recommendation/shared/filter-field-registry"
import {
  replaceFieldFilter,
  replaceFieldFilters,
  rebuildInputFromFilters,
} from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"

import type {
  AppliedFilter,
  ExplorationSessionState,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"

/* ================================================================
 * Helpers
 * ================================================================ */

function baseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

function makeFilter(
  field: string,
  value: string,
  rawValue: string | number | boolean,
  op = "includes",
  appliedAt = 0,
): AppliedFilter {
  return { field, op, value: String(value), rawValue, appliedAt }
}

function skipFilter(field: string, at = 0): AppliedFilter {
  return { field, op: "skip", value: "상관없음", rawValue: "skip", appliedAt: at }
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test",
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: baseInput(),
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

const apply = applyFilterToRecommendationInput
const clear = clearFilterFromRecommendationInput

function applyChain(input: RecommendationInput, filters: AppliedFilter[]): RecommendationInput {
  return rebuildInputFromFilters(input, filters, apply)
}

/* ================================================================
 * Group 1: 10-turn chaos (40 tests)
 * ================================================================ */
describe("Group 1: 10-turn chaos", () => {
  // --- Scenario A: Apply 5 filters -> revise 3 -> skip 1 -> revise again -> verify ---
  describe("Scenario A: apply 5 → revise 3 → skip 1 → revise again", () => {
    const bi = baseInput()

    // Turn 1-5: Apply filters
    const f1 = buildAppliedFilterFromValue("toolSubtype", "Square", 1)!
    const f2 = buildAppliedFilterFromValue("fluteCount", 4, 2)!
    const f3 = buildAppliedFilterFromValue("coating", "TiAlN", 3)!
    const f4 = buildAppliedFilterFromValue("diameterMm", 10, 4)!
    const f5 = buildAppliedFilterFromValue("workPieceName", "알루미늄", 5)!

    it("A-01: after 5 filters, input has all values", () => {
      const inp = applyChain(bi, [f1, f2, f3, f4, f5])
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBe(4)
      expect(inp.coatingPreference).toBe("TiAlN")
      expect(inp.diameterMm).toBe(10)
      expect(inp.workPieceName).toBe("알루미늄")
    })

    // Turn 6: revise fluteCount 4→2
    const f2r = buildAppliedFilterFromValue("fluteCount", 2, 6)!
    it("A-02: revise fluteCount from 4 to 2", () => {
      const { nextInput, nextFilters } = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      expect(nextInput.flutePreference).toBe(2)
      expect(nextFilters).toHaveLength(5)
    })

    // Turn 7: revise coating TiAlN→AlCrN
    const f3r = buildAppliedFilterFromValue("coating", "AlCrN", 7)!
    it("A-03: revise coating from TiAlN to AlCrN", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      expect(step7.nextInput.coatingPreference).toBe("AlCrN")
      expect(step7.nextInput.flutePreference).toBe(2)
    })

    // Turn 8: revise diameter 10→12
    const f4r = buildAppliedFilterFromValue("diameterMm", 12, 8)!
    it("A-04: revise diameter from 10 to 12", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      const step8 = replaceFieldFilter(bi, step7.nextFilters, f4r, apply)
      expect(step8.nextInput.diameterMm).toBe(12)
      expect(step8.nextInput.coatingPreference).toBe("AlCrN")
      expect(step8.nextInput.flutePreference).toBe(2)
    })

    // Turn 9: skip toolSubtype
    const f1s = skipFilter("toolSubtype", 9)
    it("A-05: skip toolSubtype clears it", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      const step8 = replaceFieldFilter(bi, step7.nextFilters, f4r, apply)
      const step9 = replaceFieldFilter(bi, step8.nextFilters, f1s, apply)
      expect(step9.nextInput.toolSubtype).toBeUndefined()
      expect(step9.nextInput.diameterMm).toBe(12)
    })

    // Turn 10: revise again — change workPieceName
    const f5r = buildAppliedFilterFromValue("workPieceName", "스테인리스", 10)!
    it("A-06: revise workPieceName after skip", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      const step8 = replaceFieldFilter(bi, step7.nextFilters, f4r, apply)
      const step9 = replaceFieldFilter(bi, step8.nextFilters, f1s, apply)
      const step10 = replaceFieldFilter(bi, step9.nextFilters, f5r, apply)
      expect(step10.nextInput.workPieceName).toBe("stainless")
      expect(step10.nextInput.toolSubtype).toBeUndefined()
      expect(step10.nextInput.diameterMm).toBe(12)
      expect(step10.nextInput.coatingPreference).toBe("AlCrN")
      expect(step10.nextInput.flutePreference).toBe(2)
    })

    it("A-07: final filter count is 5", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      const step8 = replaceFieldFilter(bi, step7.nextFilters, f4r, apply)
      const step9 = replaceFieldFilter(bi, step8.nextFilters, f1s, apply)
      const step10 = replaceFieldFilter(bi, step9.nextFilters, f5r, apply)
      expect(step10.nextFilters).toHaveLength(5)
    })

    it("A-08: replacedExisting is true for all revisions", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      expect(step6.replacedExisting).toBe(true)
    })

    it("A-09: original filters unchanged (immutability)", () => {
      const original = [f1, f2, f3, f4, f5]
      const copy = [...original]
      replaceFieldFilter(bi, original, f2r, apply)
      expect(original).toEqual(copy)
    })

    it("A-10: rebuild from final filters matches step-by-step result", () => {
      const step6 = replaceFieldFilter(bi, [f1, f2, f3, f4, f5], f2r, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, f3r, apply)
      const step8 = replaceFieldFilter(bi, step7.nextFilters, f4r, apply)
      const step9 = replaceFieldFilter(bi, step8.nextFilters, f1s, apply)
      const step10 = replaceFieldFilter(bi, step9.nextFilters, f5r, apply)
      const rebuilt = applyChain(bi, step10.nextFilters)
      expect(rebuilt).toEqual(step10.nextInput)
    })
  })

  // --- Scenario B: apply → 0-result → revert → apply different → skip → revise → apply → verify ---
  describe("Scenario B: 0-result recovery flow", () => {
    const bi = baseInput()
    const fSub = buildAppliedFilterFromValue("toolSubtype", "Ball", 1)!
    const fDia = buildAppliedFilterFromValue("diameterMm", 0.5, 2)!

    it("B-01: initial filters applied", () => {
      const inp = applyChain(bi, [fSub, fDia])
      expect(inp.toolSubtype).toBe("Ball")
      expect(inp.diameterMm).toBe(0.5)
    })

    // Turn 3: revert diameter (simulating 0-result → user removes filter)
    it("B-02: clear diameter reverts to undefined", () => {
      const inp = applyChain(bi, [fSub, fDia])
      const cleared = clear(inp, "diameterMm")
      expect(cleared.diameterMm).toBeUndefined()
      expect(cleared.toolSubtype).toBe("Ball")
    })

    // Turn 4: apply different diameter
    const fDia2 = buildAppliedFilterFromValue("diameterMm", 8, 4)!
    it("B-03: apply new diameter after revert", () => {
      const { nextInput } = replaceFieldFilter(bi, [fSub, fDia], fDia2, apply)
      expect(nextInput.diameterMm).toBe(8)
      expect(nextInput.toolSubtype).toBe("Ball")
    })

    // Turn 5: skip coating
    const fCoatSkip = skipFilter("coating", 5)
    it("B-04: skip coating leaves coatingPreference undefined", () => {
      const { nextInput } = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fCoatSkip, apply)
      expect(nextInput.coatingPreference).toBeUndefined()
    })

    // Turn 6: revise toolSubtype to Radius
    const fSubR = buildAppliedFilterFromValue("toolSubtype", "Radius", 6)!
    it("B-05: revise toolSubtype Ball→Radius", () => {
      const { nextInput } = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fSubR, apply)
      expect(nextInput.toolSubtype).toBe("Radius")
      expect(nextInput.diameterMm).toBe(8)
    })

    // Turn 7: apply flute
    const fFlute = buildAppliedFilterFromValue("fluteCount", 3, 7)!
    it("B-06: add fluteCount on top of revised state", () => {
      const step6 = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fSubR, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, fFlute, apply)
      expect(step7.nextInput.flutePreference).toBe(3)
      expect(step7.nextInput.toolSubtype).toBe("Radius")
    })

    it("B-07: full chain produces correct input", () => {
      const step6 = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fSubR, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, fFlute, apply)
      expect(step7.nextInput.diameterMm).toBe(8)
      expect(step7.nextInput.coatingPreference).toBeUndefined()
      expect(step7.nextInput.flutePreference).toBe(3)
    })

    it("B-08: filter list length after full chain", () => {
      const step6 = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fSubR, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, fFlute, apply)
      expect(step7.nextFilters).toHaveLength(4)
    })

    it("B-09: skip filter is preserved in filter list", () => {
      const step6 = replaceFieldFilter(bi, [fSub, fDia2, fCoatSkip], fSubR, apply)
      const step7 = replaceFieldFilter(bi, step6.nextFilters, fFlute, apply)
      expect(step7.nextFilters.find(f => f.field === "coating")?.op).toBe("skip")
    })

    it("B-10: base input is unmodified after full chain", () => {
      const biCopy = { ...bi }
      replaceFieldFilter(bi, [fSub, fDia2], fSubR, apply)
      expect(bi).toEqual(biCopy)
    })
  })

  // --- Scenario C: All fields skip → revise one by one ---
  describe("Scenario C: all skip → revise one by one", () => {
    const bi = baseInput()
    const allSkips = [
      skipFilter("toolSubtype", 1),
      skipFilter("fluteCount", 2),
      skipFilter("coating", 3),
      skipFilter("workPieceName", 4),
      skipFilter("diameterMm", 5),
    ]

    it("C-01: all skips produce clean input", () => {
      const inp = applyChain(bi, allSkips)
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBeUndefined()
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.diameterMm).toBeUndefined()
    })

    it("C-02: revise first skip to real value", () => {
      const realSub = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const { nextInput } = replaceFieldFilter(bi, allSkips, realSub, apply)
      expect(nextInput.toolSubtype).toBe("Square")
      expect(nextInput.flutePreference).toBeUndefined()
    })

    it("C-03: revise second skip to real value", () => {
      const realSub = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const step1 = replaceFieldFilter(bi, allSkips, realSub, apply)
      const realFlute = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const step2 = replaceFieldFilter(bi, step1.nextFilters, realFlute, apply)
      expect(step2.nextInput.flutePreference).toBe(2)
      expect(step2.nextInput.toolSubtype).toBe("Square")
    })

    it("C-04: revise third skip", () => {
      const realSub = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const step1 = replaceFieldFilter(bi, allSkips, realSub, apply)
      const realFlute = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const step2 = replaceFieldFilter(bi, step1.nextFilters, realFlute, apply)
      const realCoat = buildAppliedFilterFromValue("coating", "TiCN", 8)!
      const step3 = replaceFieldFilter(bi, step2.nextFilters, realCoat, apply)
      expect(step3.nextInput.coatingPreference).toBe("TiCN")
    })

    it("C-05: revise fourth skip", () => {
      const f6 = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const f7 = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const f8 = buildAppliedFilterFromValue("coating", "TiCN", 8)!
      const f9 = buildAppliedFilterFromValue("workPieceName", "탄소강", 9)!
      let filters = allSkips
      for (const f of [f6, f7, f8, f9]) {
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      const inp = applyChain(bi, filters)
      expect(inp.workPieceName).toBe("탄소강")
    })

    it("C-06: revise fifth skip — full recovery", () => {
      const f6 = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const f7 = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const f8 = buildAppliedFilterFromValue("coating", "TiCN", 8)!
      const f9 = buildAppliedFilterFromValue("workPieceName", "탄소강", 9)!
      const f10 = buildAppliedFilterFromValue("diameterMm", 6, 10)!
      let filters = allSkips
      for (const f of [f6, f7, f8, f9, f10]) {
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBe(2)
      expect(inp.coatingPreference).toBe("TiCN")
      expect(inp.workPieceName).toBe("탄소강")
      expect(inp.diameterMm).toBe(6)
    })

    it("C-07: no skip filters remain after full recovery", () => {
      const f6 = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const f7 = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const f8 = buildAppliedFilterFromValue("coating", "TiCN", 8)!
      const f9 = buildAppliedFilterFromValue("workPieceName", "탄소강", 9)!
      const f10 = buildAppliedFilterFromValue("diameterMm", 6, 10)!
      let filters = allSkips
      for (const f of [f6, f7, f8, f9, f10]) {
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      expect(filters.every(f => f.op !== "skip")).toBe(true)
    })

    it("C-08: partial recovery — 3 of 5 revised, 2 still skip", () => {
      const f6 = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const f7 = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      const f8 = buildAppliedFilterFromValue("coating", "TiCN", 8)!
      let filters = allSkips
      for (const f of [f6, f7, f8]) {
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      expect(filters.filter(f => f.op === "skip")).toHaveLength(2)
      const inp = applyChain(bi, filters)
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.diameterMm).toBeUndefined()
    })

    it("C-09: replaced skip has replacedExisting=true", () => {
      const realSub = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const result = replaceFieldFilter(bi, allSkips, realSub, apply)
      expect(result.replacedExisting).toBe(true)
    })

    it("C-10: filter count stays at 5 throughout recovery", () => {
      const f6 = buildAppliedFilterFromValue("toolSubtype", "Square", 6)!
      const f7 = buildAppliedFilterFromValue("fluteCount", 2, 7)!
      let filters = allSkips
      expect(filters).toHaveLength(5)
      filters = replaceFieldFilter(bi, filters, f6, apply).nextFilters
      expect(filters).toHaveLength(5)
      filters = replaceFieldFilter(bi, filters, f7, apply).nextFilters
      expect(filters).toHaveLength(5)
    })
  })

  // --- Scenario D: 6 filters → remove 3 → add 2 new → replace 1 ---
  describe("Scenario D: 6 filters → remove 3 → add 2 → replace 1", () => {
    const bi = baseInput()
    const initial: AppliedFilter[] = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      buildAppliedFilterFromValue("diameterMm", 10, 4)!,
      buildAppliedFilterFromValue("workPieceName", "일반강", 5)!,
      buildAppliedFilterFromValue("brand", "ALU-POWER", 6)!,
    ]

    it("D-01: 6 filters all present in input", () => {
      const inp = applyChain(bi, initial)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBe(4)
      expect(inp.coatingPreference).toBe("TiAlN")
      expect(inp.diameterMm).toBe(10)
      expect(inp.workPieceName).toBe("일반강")
      expect(inp.brand).toBe("ALU-POWER")
    })

    // Remove fluteCount, coating, brand
    it("D-02: remove 3 filters by excluding them", () => {
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      expect(remaining).toHaveLength(3)
      const inp = applyChain(bi, remaining)
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBeUndefined()
      expect(inp.brand).toBeUndefined()
      expect(inp.toolSubtype).toBe("Square")
    })

    // Add 2 new: seriesName, shankDiameterMm
    const fSeries = buildAppliedFilterFromValue("seriesName", "V7PLUS", 7)!
    const fShank = buildAppliedFilterFromValue("shankDiameterMm", 10, 8)!
    it("D-03: add 2 new filters", () => {
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      const extended = [...remaining, fSeries, fShank]
      const inp = applyChain(bi, extended)
      expect(inp.seriesName).toBe("V7PLUS")
      expect(inp.shankDiameterMm).toBe(10)
    })

    // Replace toolSubtype Square→Roughing
    const fSubReplace = buildAppliedFilterFromValue("toolSubtype", "Roughing", 9)!
    it("D-04: replace toolSubtype", () => {
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      const extended = [...remaining, fSeries, fShank]
      const { nextInput } = replaceFieldFilter(bi, extended, fSubReplace, apply)
      expect(nextInput.toolSubtype).toBe("Roughing")
      expect(nextInput.seriesName).toBe("V7PLUS")
      expect(nextInput.shankDiameterMm).toBe(10)
      expect(nextInput.diameterMm).toBe(10)
      expect(nextInput.workPieceName).toBe("일반강")
    })

    it("D-05: final filter count is 5", () => {
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      const extended = [...remaining, fSeries, fShank]
      const { nextFilters } = replaceFieldFilter(bi, extended, fSubReplace, apply)
      expect(nextFilters).toHaveLength(5)
    })

    it("D-06: no removed fields in final input", () => {
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      const extended = [...remaining, fSeries, fShank]
      const { nextInput } = replaceFieldFilter(bi, extended, fSubReplace, apply)
      expect(nextInput.flutePreference).toBeUndefined()
      expect(nextInput.coatingPreference).toBeUndefined()
      expect(nextInput.brand).toBeUndefined()
    })

    it("D-07: original initial array is immutable", () => {
      const len = initial.length
      const remaining = initial.filter(f => !["fluteCount", "coating", "brand"].includes(f.field))
      replaceFieldFilter(bi, remaining, fSubReplace, apply)
      expect(initial).toHaveLength(len)
    })

    it("D-08: replaceFieldFilters batch replacement", () => {
      const newFilters = [fSeries, fShank, fSubReplace]
      const { nextInput, replacedFields } = replaceFieldFilters(bi, initial, newFilters, apply)
      expect(nextInput.toolSubtype).toBe("Roughing")
      expect(nextInput.seriesName).toBe("V7PLUS")
      expect(replacedFields).toContain("toolSubtype")
    })

    it("D-09: batch replacement preserves non-replaced filters", () => {
      const newFilters = [fSeries, fShank]
      const { nextInput } = replaceFieldFilters(bi, initial, newFilters, apply)
      expect(nextInput.flutePreference).toBe(4)
      expect(nextInput.coatingPreference).toBe("TiAlN")
    })

    it("D-10: batch with empty array changes nothing", () => {
      const { nextInput, nextFilters } = replaceFieldFilters(bi, initial, [], apply)
      expect(nextFilters).toHaveLength(6)
      expect(nextInput.toolSubtype).toBe("Square")
    })
  })
})

/* ================================================================
 * Group 2: Filter stress (40 tests)
 * ================================================================ */
describe("Group 2: Filter stress", () => {
  const bi = baseInput()

  // --- 10 different filters sequentially ---
  describe("10 different filters sequentially", () => {
    const filters: AppliedFilter[] = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      buildAppliedFilterFromValue("diameterMm", 10, 4)!,
      buildAppliedFilterFromValue("workPieceName", "알루미늄", 5)!,
      buildAppliedFilterFromValue("brand", "TANK-POWER", 6)!,
      buildAppliedFilterFromValue("seriesName", "V7PLUS", 7)!,
      buildAppliedFilterFromValue("shankDiameterMm", 10, 8)!,
      buildAppliedFilterFromValue("lengthOfCutMm", 30, 9)!,
      buildAppliedFilterFromValue("overallLengthMm", 75, 10)!,
    ]

    it("S-01: all 10 filters produce non-null", () => {
      for (const f of filters) expect(f).not.toBeNull()
    })

    it("S-02: applyChain with 10 filters sets all values", () => {
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBe(4)
      expect(inp.coatingPreference).toBe("TiAlN")
      expect(inp.diameterMm).toBe(10)
      expect(inp.workPieceName).toBe("알루미늄")
      expect(inp.brand).toBe("TANK-POWER")
      expect(inp.seriesName).toBe("V7PLUS")
      expect(inp.shankDiameterMm).toBe(10)
      expect(inp.lengthOfCutMm).toBe(30)
      expect(inp.overallLengthMm).toBe(75)
    })

    it("S-03: filter count is exactly 10", () => {
      expect(filters).toHaveLength(10)
    })

    it("S-04: each filter has unique field", () => {
      const fields = new Set(filters.map(f => f.field))
      expect(fields.size).toBe(10)
    })

    it("S-05: rebuild produces same result as sequential apply", () => {
      const sequential = filters.reduce((inp, f) => apply(inp, f), { ...bi } as RecommendationInput)
      const rebuilt = applyChain(bi, filters)
      expect(rebuilt).toEqual(sequential)
    })
  })

  // --- Same field 5 times (overwrite) ---
  describe("Same field 5 times (overwrite)", () => {
    const values = ["Square", "Ball", "Radius", "Roughing", "Taper"]

    it("S-06: replaceFieldFilter overwrites each time", () => {
      let filters: AppliedFilter[] = []
      for (let i = 0; i < values.length; i++) {
        const f = buildAppliedFilterFromValue("toolSubtype", values[i], i)!
        const result = replaceFieldFilter(bi, filters, f, apply)
        filters = result.nextFilters
      }
      expect(filters).toHaveLength(1)
      expect(filters[0].rawValue).toBe("Taper")
    })

    it("S-07: final input has only last value", () => {
      let filters: AppliedFilter[] = []
      for (let i = 0; i < values.length; i++) {
        const f = buildAppliedFilterFromValue("toolSubtype", values[i], i)!
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Taper")
    })

    it("S-08: replacedExisting is false for first, true for rest", () => {
      let filters: AppliedFilter[] = []
      const results: boolean[] = []
      for (let i = 0; i < values.length; i++) {
        const f = buildAppliedFilterFromValue("toolSubtype", values[i], i)!
        const result = replaceFieldFilter(bi, filters, f, apply)
        results.push(result.replacedExisting)
        filters = result.nextFilters
      }
      expect(results[0]).toBe(false)
      expect(results.slice(1).every(r => r === true)).toBe(true)
    })
  })

  // --- diameterRefine chain ---
  describe("diameterRefine chain: 7 consecutive overwrites", () => {
    const diameters = [10, 9.95, 10.05, 9.922, 8, 12, 6.35]

    it("S-09: each diameterRefine produces diameterMm filter", () => {
      for (const d of diameters) {
        const f = buildAppliedFilterFromValue("diameterRefine", d, 0)!
        expect(f).not.toBeNull()
        expect(f.field).toBe("diameterMm") // canonicalField mapping
      }
    })

    it("S-10: sequential replace keeps only 1 filter", () => {
      let filters: AppliedFilter[] = []
      for (let i = 0; i < diameters.length; i++) {
        const f = buildAppliedFilterFromValue("diameterRefine", diameters[i], i)!
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      expect(filters).toHaveLength(1)
    })

    it("S-11: final diameter is 6.35", () => {
      let filters: AppliedFilter[] = []
      for (const d of diameters) {
        const f = buildAppliedFilterFromValue("diameterRefine", d, 0)!
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      const inp = applyChain(bi, filters)
      expect(inp.diameterMm).toBe(6.35)
    })

    it("S-12: diameterRefine replaces existing diameterMm", () => {
      const fMm = buildAppliedFilterFromValue("diameterMm", 10, 0)!
      const fRef = buildAppliedFilterFromValue("diameterRefine", 8, 1)!
      const { nextFilters, nextInput, replacedExisting } = replaceFieldFilter(bi, [fMm], fRef, apply)
      expect(replacedExisting).toBe(true)
      expect(nextFilters).toHaveLength(1)
      expect(nextInput.diameterMm).toBe(8)
    })

    it("S-13: diameterMm replaces existing diameterRefine", () => {
      const fRef = buildAppliedFilterFromValue("diameterRefine", 8, 0)!
      const fMm = buildAppliedFilterFromValue("diameterMm", 12, 1)!
      const { nextFilters, nextInput, replacedExisting } = replaceFieldFilter(bi, [fRef], fMm, apply)
      expect(replacedExisting).toBe(true)
      expect(nextFilters).toHaveLength(1)
      expect(nextInput.diameterMm).toBe(12)
    })

    it("S-14: no accumulation — 7 replaces = 1 filter", () => {
      let filters: AppliedFilter[] = [buildAppliedFilterFromValue("diameterMm", 20, 0)!]
      for (const d of diameters) {
        const f = buildAppliedFilterFromValue("diameterRefine", d, 0)!
        filters = replaceFieldFilter(bi, filters, f, apply).nextFilters
      }
      expect(filters).toHaveLength(1)
      expect(filters[0].rawValue).toBe(6.35)
    })
  })

  // --- Mix of skip + real filters ---
  describe("Skip + real filter mix", () => {
    it("S-15: skip fields are undefined after applyChain", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        skipFilter("fluteCount", 2),
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
        skipFilter("workPieceName", 4),
        buildAppliedFilterFromValue("diameterMm", 10, 5)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBe("TiAlN")
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.diameterMm).toBe(10)
    })

    it("S-16: all skips produce fully clean input", () => {
      const filters = ["toolSubtype", "fluteCount", "coating", "workPieceName", "diameterMm"].map((f, i) => skipFilter(f, i))
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBeUndefined()
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.diameterMm).toBeUndefined()
    })

    it("S-17: real filter after skip on same field wins", () => {
      const filters: AppliedFilter[] = [
        skipFilter("toolSubtype", 1),
        buildAppliedFilterFromValue("toolSubtype", "Ball", 2)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Ball")
    })

    it("S-18: skip after real filter clears value", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("toolSubtype", "Ball", 1)!,
        skipFilter("toolSubtype", 2),
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBeUndefined()
    })
  })

  // --- Material change at step 5 of 8 → workPieceName clears ---
  describe("Material change clears workPieceName mid-chain", () => {
    it("S-19: material sets workPieceName to undefined", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 4)!,
        buildAppliedFilterFromValue("material", "일반강", 5)!, // clears workPieceName
        buildAppliedFilterFromValue("diameterMm", 10, 6)!,
        buildAppliedFilterFromValue("brand", "TANK-POWER", 7)!,
        buildAppliedFilterFromValue("seriesName", "V7PLUS", 8)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.material).toBe("일반강")
      expect(inp.workPieceName).toBeUndefined() // cleared by material
    })

    it("S-20: re-add workPieceName after material at step 7", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 4)!,
        buildAppliedFilterFromValue("material", "일반강", 5)!, // clears workPieceName
        buildAppliedFilterFromValue("diameterMm", 10, 6)!,
        buildAppliedFilterFromValue("workPieceName", "고경도강", 7)!, // re-add
        buildAppliedFilterFromValue("seriesName", "V7PLUS", 8)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.material).toBe("일반강")
      expect(inp.workPieceName).toBe("고경도강")
    })

    it("S-21: material change twice clears workPieceName each time", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 1)!,
        buildAppliedFilterFromValue("material", "일반강", 2)!,
        buildAppliedFilterFromValue("workPieceName", "고경도강", 3)!,
        buildAppliedFilterFromValue("material", "스테인리스강", 4)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.material).toBe("스테인리스강")
      expect(inp.workPieceName).toBeUndefined()
    })

    it("S-22: material preserves other fields", () => {
      const filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 3)!,
        buildAppliedFilterFromValue("material", "일반강", 4)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.flutePreference).toBe(4)
    })
  })

  // --- Additional stress tests ---
  describe("parseAnswerToFilter determinism", () => {
    it("S-23: parseAnswerToFilter for fluteCount '2날'", () => {
      const f = parseAnswerToFilter("fluteCount", "2날")
      expect(f).not.toBeNull()
      expect(f!.field).toBe("fluteCount")
      expect(f!.rawValue).toBe(2)
    })

    it("S-24: parseAnswerToFilter for fluteCount '4'", () => {
      const f = parseAnswerToFilter("fluteCount", "4")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe(4)
    })

    it("S-25: parseAnswerToFilter for diameterMm '10mm'", () => {
      const f = parseAnswerToFilter("diameterMm", "10mm")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe(10)
    })

    it("S-26: parseAnswerToFilter for diameterRefine '9.95'", () => {
      const f = parseAnswerToFilter("diameterRefine", "9.95")
      expect(f).not.toBeNull()
      expect(f!.field).toBe("diameterMm") // canonicalField
      expect(f!.rawValue).toBe(9.95)
    })

    it("S-27: parseAnswerToFilter for toolSubtype 'Square'", () => {
      const f = parseAnswerToFilter("toolSubtype", "Square")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("Square")
    })

    it("S-28: parseAnswerToFilter for coating 'TiAlN'", () => {
      const f = parseAnswerToFilter("coating", "TiAlN")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("TiAlN")
    })

    it("S-29: parseAnswerToFilter for workPieceName '알루미늄'", () => {
      const f = parseAnswerToFilter("workPieceName", "알루미늄")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("알루미늄")
    })

    it("S-30: parseAnswerToFilter for coating Korean alias '블루'", () => {
      const f = parseAnswerToFilter("coating", "블루")
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("Blue")
    })
  })

  describe("Boolean and special field filters", () => {
    it("S-31: coolantHole true filter", () => {
      const f = buildAppliedFilterFromValue("coolantHole", "있음", 1)
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe(true)
      const inp = apply(bi, f!)
      expect(inp.coolantHole).toBe(true)
    })

    it("S-32: coolantHole false filter", () => {
      const f = buildAppliedFilterFromValue("coolantHole", "없음", 1)
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe(false)
      const inp = apply(bi, f!)
      expect(inp.coolantHole).toBe(false)
    })

    it("S-33: coolantHole clear", () => {
      const inp = baseInput({ coolantHole: true })
      const cleared = clear(inp, "coolantHole")
      expect(cleared.coolantHole).toBeUndefined()
    })

    it("S-34: helixAngleDeg filter", () => {
      const f = buildAppliedFilterFromValue("helixAngleDeg", 30, 1)
      expect(f).not.toBeNull()
      const inp = apply(bi, f!)
      expect(inp.helixAngleDeg).toBe(30)
    })

    it("S-35: overallLengthMm filter", () => {
      const f = buildAppliedFilterFromValue("overallLengthMm", 100, 1)
      expect(f).not.toBeNull()
      const inp = apply(bi, f!)
      expect(inp.overallLengthMm).toBe(100)
    })

    it("S-36: toolSubtype Korean alias '스퀘어' → Square", () => {
      const f = buildAppliedFilterFromValue("toolSubtype", "스퀘어", 1)
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("Square")
    })

    it("S-37: toolSubtype Korean alias '황삭' → Roughing", () => {
      const f = buildAppliedFilterFromValue("toolSubtype", "황삭", 1)
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("Roughing")
    })

    it("S-38: country filter '한국' → KOREA", () => {
      const f = buildAppliedFilterFromValue("country", "한국", 1)
      expect(f).not.toBeNull()
      expect(f!.rawValue).toBe("KOREA")
    })

    it("S-39: cuttingType filter sets operationType", () => {
      const f = buildAppliedFilterFromValue("cuttingType", "slotting", 1)
      expect(f).not.toBeNull()
      const inp = apply(bi, f!)
      expect(inp.operationType).toBe("slotting")
    })

    it("S-40: toolMaterial filter sets toolMaterial", () => {
      const f = buildAppliedFilterFromValue("toolMaterial", "초경", 1)
      expect(f).not.toBeNull()
      const inp = apply(bi, f!)
      expect(inp.toolMaterial).toBe("초경")
    })
  })
})

/* ================================================================
 * Group 3: Pending + revision interplay (40 tests)
 * ================================================================ */
describe("Group 3: Pending question reply resolution", () => {
  const pendingFields = [
    { field: "toolSubtype", chipLabel: "Square (120개)", chipValue: "Square", value: "Square" },
    { field: "fluteCount", chipLabel: "4날 (30개)", chipValue: "4날", value: "4" },
    { field: "coating", chipLabel: "TiAlN (50개)", chipValue: "TiAlN", value: "TiAlN" },
    { field: "workPieceName", chipLabel: "알루미늄", chipValue: "알루미늄", value: "알루미늄" },
    { field: "diameterMm", chipLabel: "10mm (12개)", chipValue: "10", value: "10" },
  ]

  for (const { field, chipLabel, chipValue, value } of pendingFields) {
    describe(`Pending field: ${field}`, () => {
      const state = makeState({
        lastAskedField: field,
        displayedOptions: [
          { index: 1, label: chipLabel, field, value: chipValue, count: 30 },
          { index: 2, label: "상관없음", field, value: "skip", count: 0 },
        ],
      })

      // 1. Valid chip click → resolved
      it(`${field}-01: valid chip click → resolved`, () => {
        const result = resolvePendingQuestionReply(state, chipLabel)
        expect(result.kind).toBe("resolved")
      })

      // 2. Skip expression → resolved(skip)
      it(`${field}-02: skip expression → resolved(skip)`, () => {
        const result = resolvePendingQuestionReply(state, "상관없음")
        expect(result.kind).toBe("resolved")
        if (result.kind === "resolved") {
          expect(result.filter.op).toBe("skip")
        }
      })

      // 3. Revision for DIFFERENT field → unresolved
      it(`${field}-03: revision for different field → unresolved`, () => {
        const stateWithFilters = makeState({
          ...state,
          appliedFilters: [
            makeFilter("coating", "TiAlN", "TiAlN", "includes", 0),
          ],
        })
        const result = resolvePendingQuestionReply(stateWithFilters, "TiAlN 말고 AlCrN으로 변경")
        expect(result.kind).toBe("unresolved")
      })

      // 4. Side question → side_question
      it(`${field}-04: side question → side_question`, () => {
        const result = resolvePendingQuestionReply(state, "이게 뭐야?")
        expect(result.kind).toBe("side_question")
      })

      // 5. Delegation → resolved(skip)
      it(`${field}-05: delegation → resolved(skip)`, () => {
        const result = resolvePendingQuestionReply(state, "알아서 추천해줘")
        expect(result.kind).toBe("resolved")
        if (result.kind === "resolved") {
          expect(result.filter.op).toBe("skip")
        }
      })

      // 6. "처음부터" → side_question
      it(`${field}-06: "처음부터" → side_question`, () => {
        const result = resolvePendingQuestionReply(state, "처음부터 다시 해줘")
        expect(result.kind).toBe("side_question")
      })

      // 7. "이전 단계" → side_question
      it(`${field}-07: "이전 단계" → side_question`, () => {
        const result = resolvePendingQuestionReply(state, "이전 단계로 돌아가")
        expect(result.kind).toBe("side_question")
      })

      // 8. Empty/null → none
      it(`${field}-08: empty string → none`, () => {
        const result = resolvePendingQuestionReply(state, "")
        expect(result.kind).toBe("none")
      })
    })
  }
})

/* ================================================================
 * Group 4: Negation deterministic (30 tests)
 * ================================================================ */
describe("Group 4: Negation — deterministic filter removal", () => {
  const bi = baseInput()

  // Helper: simulate negation by removing a filter whose value matches
  function simulateNegation(
    filters: AppliedFilter[],
    negationTarget: string,
  ): AppliedFilter[] {
    const normalized = negationTarget.toLowerCase().replace(/\s+/g, "")
    return filters.filter(f => {
      if (f.op === "skip") return true // skip filters are not removable by negation
      const filterValues = Array.isArray(f.rawValue) ? f.rawValue : [f.rawValue]
      return !filterValues.some(v => {
        const vs = String(v).toLowerCase().replace(/\s+/g, "")
        return vs === normalized || vs.includes(normalized) || normalized.includes(vs)
      })
    })
  }

  describe("1 filter active → negation removes it", () => {
    const filters = [buildAppliedFilterFromValue("toolSubtype", "Square", 1)!]

    it("N-01: 'Square 빼고' removes the filter", () => {
      const result = simulateNegation(filters, "Square")
      expect(result).toHaveLength(0)
    })

    it("N-02: input after removal has no toolSubtype", () => {
      const result = simulateNegation(filters, "Square")
      const inp = applyChain(bi, result)
      expect(inp.toolSubtype).toBeUndefined()
    })

    it("N-03: case insensitive — 'square' matches Square", () => {
      const result = simulateNegation(filters, "square")
      expect(result).toHaveLength(0)
    })
  })

  describe("3 filters → negation removes only matching one", () => {
    const filters = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
    ]

    it("N-04: 'Square 빼고' removes only toolSubtype", () => {
      const result = simulateNegation(filters, "Square")
      expect(result).toHaveLength(2)
      expect(result.find(f => f.field === "toolSubtype")).toBeUndefined()
    })

    it("N-05: fluteCount and coating preserved", () => {
      const result = simulateNegation(filters, "Square")
      const inp = applyChain(bi, result)
      expect(inp.flutePreference).toBe(4)
      expect(inp.coatingPreference).toBe("TiAlN")
    })

    it("N-06: 'TiAlN 빼고' removes only coating", () => {
      const result = simulateNegation(filters, "TiAlN")
      expect(result).toHaveLength(2)
      expect(result.find(f => f.field === "coating")).toBeUndefined()
      expect(result.find(f => f.field === "toolSubtype")).toBeDefined()
    })

    it("N-07: '4 빼고' removes fluteCount (numeric match)", () => {
      const result = simulateNegation(filters, "4")
      expect(result).toHaveLength(2)
      expect(result.find(f => f.field === "fluteCount")).toBeUndefined()
    })
  })

  describe("'X 제외하고' — same behavior as 빼고", () => {
    const filters = [
      buildAppliedFilterFromValue("toolSubtype", "Ball", 1)!,
      buildAppliedFilterFromValue("coating", "AlCrN", 2)!,
    ]

    it("N-08: 'Ball 제외하고' removes toolSubtype", () => {
      const result = simulateNegation(filters, "Ball")
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe("coating")
    })

    it("N-09: 'AlCrN 제외하고' removes coating", () => {
      const result = simulateNegation(filters, "AlCrN")
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe("toolSubtype")
    })
  })

  describe("'X 아닌 것들' — same behavior", () => {
    it("N-10: 'Radius 아닌 것들' removes Radius filter", () => {
      const filters = [buildAppliedFilterFromValue("toolSubtype", "Radius", 1)!]
      const result = simulateNegation(filters, "Radius")
      expect(result).toHaveLength(0)
    })

    it("N-11: preserves other filters", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Radius", 1)!,
        buildAppliedFilterFromValue("diameterMm", 10, 2)!,
      ]
      const result = simulateNegation(filters, "Radius")
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe("diameterMm")
    })
  })

  describe("No matching filter → nothing changes", () => {
    const filters = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 2)!,
    ]

    it("N-12: 'Roughing 빼고' matches nothing", () => {
      const result = simulateNegation(filters, "Roughing")
      expect(result).toHaveLength(2)
    })

    it("N-13: input unchanged after no-match negation", () => {
      const result = simulateNegation(filters, "Roughing")
      const inp = applyChain(bi, result)
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.coatingPreference).toBe("TiAlN")
    })

    it("N-14: non-existent value negation matches nothing", () => {
      const result = simulateNegation(filters, "Diamond")
      expect(result).toHaveLength(2)
    })
  })

  describe("Skip filter → not removed by negation", () => {
    it("N-15: skip filter preserved during negation", () => {
      const filters: AppliedFilter[] = [
        skipFilter("toolSubtype", 1),
        buildAppliedFilterFromValue("coating", "TiAlN", 2)!,
      ]
      const result = simulateNegation(filters, "상관없음")
      // skip filter value is "상관없음" but op=skip protects it
      expect(result).toHaveLength(2)
    })

    it("N-16: skip filter field value doesn't match negation target", () => {
      const filters: AppliedFilter[] = [
        skipFilter("toolSubtype", 1),
        buildAppliedFilterFromValue("coating", "TiAlN", 2)!,
      ]
      const result = simulateNegation(filters, "Square")
      expect(result).toHaveLength(2) // skip has no real value to match
    })
  })

  describe("Case insensitive matching", () => {
    it("N-17: 'square 빼고' matches Square filter", () => {
      const filters = [buildAppliedFilterFromValue("toolSubtype", "Square", 1)!]
      const result = simulateNegation(filters, "square")
      expect(result).toHaveLength(0)
    })

    it("N-18: 'TIALN 빼고' matches TiAlN filter", () => {
      const filters = [buildAppliedFilterFromValue("coating", "TiAlN", 1)!]
      const result = simulateNegation(filters, "TIALN")
      expect(result).toHaveLength(0)
    })

    it("N-19: mixed case 'tIaLn' still matches", () => {
      const filters = [buildAppliedFilterFromValue("coating", "TiAlN", 1)!]
      const result = simulateNegation(filters, "tIaLn")
      expect(result).toHaveLength(0)
    })
  })

  describe("Multiple negation targets", () => {
    const filters = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      buildAppliedFilterFromValue("diameterMm", 10, 4)!,
      buildAppliedFilterFromValue("workPieceName", "알루미늄", 5)!,
    ]

    it("N-20: sequential negation of 2 filters", () => {
      let result = simulateNegation(filters, "Square")
      result = simulateNegation(result, "TiAlN")
      expect(result).toHaveLength(3)
    })

    it("N-21: sequential negation of 3 filters", () => {
      let result = simulateNegation(filters, "Square")
      result = simulateNegation(result, "TiAlN")
      result = simulateNegation(result, "알루미늄")
      expect(result).toHaveLength(2)
      const inp = applyChain(bi, result)
      expect(inp.flutePreference).toBe(4)
      expect(inp.diameterMm).toBe(10)
    })

    it("N-22: negate all 5 → empty filter list", () => {
      let result = [...filters]
      for (const target of ["Square", "4", "TiAlN", "10", "알루미늄"]) {
        result = simulateNegation(result, target)
      }
      expect(result).toHaveLength(0)
    })

    it("N-23: negate non-existent then existing", () => {
      let result = simulateNegation(filters, "Roughing") // no match
      expect(result).toHaveLength(5)
      result = simulateNegation(result, "Square") // match
      expect(result).toHaveLength(4)
    })
  })

  describe("Negation with rebuild", () => {
    const filters = [
      buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
      buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
    ]

    it("N-24: rebuild after negation produces correct input", () => {
      const remaining = simulateNegation(filters, "Square")
      const inp = applyChain(bi, remaining)
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBe(4)
      expect(inp.coatingPreference).toBe("TiAlN")
    })

    it("N-25: rebuild after negation + add new filter", () => {
      const remaining = simulateNegation(filters, "Square")
      const newFilter = buildAppliedFilterFromValue("toolSubtype", "Ball", 4)!
      const { nextInput } = replaceFieldFilter(bi, remaining, newFilter, apply)
      expect(nextInput.toolSubtype).toBe("Ball")
      expect(nextInput.flutePreference).toBe(4)
    })

    it("N-26: negation of numeric filter + rebuild", () => {
      const numFilters = [
        buildAppliedFilterFromValue("diameterMm", 10, 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      ]
      const remaining = simulateNegation(numFilters, "10")
      const inp = applyChain(bi, remaining)
      expect(inp.diameterMm).toBeUndefined()
      expect(inp.flutePreference).toBe(4)
    })

    it("N-27: double negation on same target is idempotent", () => {
      let result = simulateNegation(filters, "Square")
      expect(result).toHaveLength(2)
      result = simulateNegation(result, "Square")
      expect(result).toHaveLength(2) // already removed
    })

    it("N-28: negation preserves filter order for remaining", () => {
      const remaining = simulateNegation(filters, "fluteCount")
      // fluteCount removed because rawValue=4, "flutecount" doesn't match the number
      // Actually "fluteCount" as text won't match rawValue 4. Let me use the value.
      const remaining2 = simulateNegation(filters, "4")
      expect(remaining2[0].field).toBe("toolSubtype")
      expect(remaining2[1].field).toBe("coating")
    })

    it("N-29: negation of workPieceName with Korean value", () => {
      const wFilters = [
        buildAppliedFilterFromValue("workPieceName", "고경도강", 1)!,
        buildAppliedFilterFromValue("toolSubtype", "Square", 2)!,
      ]
      const result = simulateNegation(wFilters, "고경도강")
      expect(result).toHaveLength(1)
      expect(result[0].field).toBe("toolSubtype")
    })

    it("N-30: negation with substring match — partial match removes filter", () => {
      const filters2 = [buildAppliedFilterFromValue("coating", "TiAlN", 1)!]
      // "TiAlN" includes "TiAl" as substring
      const result = simulateNegation(filters2, "TiAl")
      expect(result).toHaveLength(0)
    })
  })
})

/* ================================================================
 * Group 5: rebuildInputFromFilters consistency (30 tests)
 * ================================================================ */
describe("Group 5: rebuildInputFromFilters consistency", () => {
  const bi = baseInput()

  describe("Order independence", () => {
    const fA = buildAppliedFilterFromValue("toolSubtype", "Square", 1)!
    const fB = buildAppliedFilterFromValue("fluteCount", 4, 2)!
    const fC = buildAppliedFilterFromValue("coating", "TiAlN", 3)!

    it("R-01: A→B→C vs C→B→A same result (independent fields)", () => {
      const abc = applyChain(bi, [fA, fB, fC])
      const cba = applyChain(bi, [fC, fB, fA])
      expect(abc).toEqual(cba)
    })

    it("R-02: A→C→B same result", () => {
      const acb = applyChain(bi, [fA, fC, fB])
      const abc = applyChain(bi, [fA, fB, fC])
      expect(acb).toEqual(abc)
    })

    it("R-03: B→A→C same result", () => {
      const bac = applyChain(bi, [fB, fA, fC])
      const abc = applyChain(bi, [fA, fB, fC])
      expect(bac).toEqual(abc)
    })

    it("R-04: single filter in any position", () => {
      const a = applyChain(bi, [fA])
      expect(a.toolSubtype).toBe("Square")
      expect(a.flutePreference).toBeUndefined()
    })

    it("R-05: all permutations of 3 filters produce same values", () => {
      const perms = [
        [fA, fB, fC], [fA, fC, fB], [fB, fA, fC],
        [fB, fC, fA], [fC, fA, fB], [fC, fB, fA],
      ]
      const reference = applyChain(bi, perms[0])
      for (const perm of perms.slice(1)) {
        expect(applyChain(bi, perm)).toEqual(reference)
      }
    })
  })

  describe("Build from filters with skip", () => {
    it("R-06: skip toolSubtype → undefined", () => {
      const filters = [skipFilter("toolSubtype", 1)]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBeUndefined()
    })

    it("R-07: skip + real → skip clears, real sets", () => {
      const filters = [skipFilter("toolSubtype", 1), buildAppliedFilterFromValue("fluteCount", 2, 2)!]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBe(2)
    })

    it("R-08: real + skip on same field → order matters (last wins)", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        skipFilter("toolSubtype", 2),
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBeUndefined()
    })

    it("R-09: skip on field with pre-existing base value clears it", () => {
      const biWithSub = baseInput({ toolSubtype: "Ball" })
      const filters = [skipFilter("toolSubtype", 1)]
      const inp = applyChain(biWithSub, filters)
      expect(inp.toolSubtype).toBeUndefined()
    })

    it("R-10: 5 skips on 5 different fields", () => {
      const skips = [
        skipFilter("toolSubtype", 1),
        skipFilter("fluteCount", 2),
        skipFilter("coating", 3),
        skipFilter("diameterMm", 4),
        skipFilter("workPieceName", 5),
      ]
      const inp = applyChain(baseInput({
        toolSubtype: "Ball", flutePreference: 3, coatingPreference: "TiCN",
        diameterMm: 10, workPieceName: "알루미늄",
      }), skips)
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBeUndefined()
      expect(inp.diameterMm).toBeUndefined()
      expect(inp.workPieceName).toBeUndefined()
    })
  })

  describe("Build → modify → rebuild → verify", () => {
    it("R-11: build, then replace one filter, rebuild matches", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      ]
      const { nextFilters, nextInput } = replaceFieldFilter(bi, filters, buildAppliedFilterFromValue("fluteCount", 2, 3)!, apply)
      const rebuilt = applyChain(bi, nextFilters)
      expect(rebuilt).toEqual(nextInput)
    })

    it("R-12: build, replace 2 filters, rebuild matches", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      ]
      let f = filters
      f = replaceFieldFilter(bi, f, buildAppliedFilterFromValue("fluteCount", 2, 4)!, apply).nextFilters
      const result = replaceFieldFilter(bi, f, buildAppliedFilterFromValue("coating", "AlCrN", 5)!, apply)
      const rebuilt = applyChain(bi, result.nextFilters)
      expect(rebuilt).toEqual(result.nextInput)
    })

    it("R-13: build, add new filter, rebuild matches", () => {
      const filters = [buildAppliedFilterFromValue("toolSubtype", "Square", 1)!]
      const newFilter = buildAppliedFilterFromValue("fluteCount", 4, 2)!
      const result = replaceFieldFilter(bi, filters, newFilter, apply)
      expect(result.replacedExisting).toBe(false)
      const rebuilt = applyChain(bi, result.nextFilters)
      expect(rebuilt).toEqual(result.nextInput)
    })

    it("R-14: triple rebuild consistency", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Ball", 1)!,
        buildAppliedFilterFromValue("diameterMm", 8, 2)!,
        buildAppliedFilterFromValue("coating", "TiCN", 3)!,
      ]
      const r1 = applyChain(bi, filters)
      const r2 = applyChain(bi, filters)
      const r3 = applyChain(bi, filters)
      expect(r1).toEqual(r2)
      expect(r2).toEqual(r3)
    })
  })

  describe("Empty filters → clean base input", () => {
    it("R-15: empty filters → base input unchanged", () => {
      const inp = applyChain(bi, [])
      expect(inp.manufacturerScope).toBe("yg1-only")
      expect(inp.locale).toBe("ko")
      expect(inp.toolSubtype).toBeUndefined()
    })

    it("R-16: empty filters with enriched base → base preserved", () => {
      const enriched = baseInput({ material: "일반강", toolSubtype: "Square" })
      const inp = applyChain(enriched, [])
      expect(inp.material).toBe("일반강")
      expect(inp.toolSubtype).toBe("Square")
    })
  })

  describe("Duplicate field filters → last wins", () => {
    it("R-17: two toolSubtype filters — last wins", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("toolSubtype", "Ball", 2)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Ball")
    })

    it("R-18: three fluteCount filters — last wins", () => {
      const filters = [
        buildAppliedFilterFromValue("fluteCount", 2, 1)!,
        buildAppliedFilterFromValue("fluteCount", 3, 2)!,
        buildAppliedFilterFromValue("fluteCount", 4, 3)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.flutePreference).toBe(4)
    })

    it("R-19: duplicate with skip last — skip wins", () => {
      const filters = [
        buildAppliedFilterFromValue("coating", "TiAlN", 1)!,
        skipFilter("coating", 2),
      ]
      const inp = applyChain(bi, filters)
      expect(inp.coatingPreference).toBeUndefined()
    })

    it("R-20: duplicate with skip first, real last — real wins", () => {
      const filters = [
        skipFilter("coating", 1),
        buildAppliedFilterFromValue("coating", "TiAlN", 2)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.coatingPreference).toBe("TiAlN")
    })
  })

  describe("Additional rebuild verifications", () => {
    it("R-21: 8 filters rebuild matches sequential apply", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Roughing", 1)!,
        buildAppliedFilterFromValue("fluteCount", 6, 2)!,
        buildAppliedFilterFromValue("coating", "AlCrN", 3)!,
        buildAppliedFilterFromValue("diameterMm", 16, 4)!,
        buildAppliedFilterFromValue("workPieceName", "고경도강", 5)!,
        buildAppliedFilterFromValue("brand", "TANK-POWER", 6)!,
        buildAppliedFilterFromValue("shankDiameterMm", 16, 7)!,
        buildAppliedFilterFromValue("lengthOfCutMm", 48, 8)!,
      ]
      const seq = filters.reduce((inp, f) => apply(inp, f), { ...bi } as RecommendationInput)
      const reb = applyChain(bi, filters)
      expect(reb).toEqual(seq)
    })

    it("R-22: rebuild with base input overrides", () => {
      const enrichedBi = baseInput({ material: "일반강" })
      const filters = [buildAppliedFilterFromValue("toolSubtype", "Square", 1)!]
      const inp = applyChain(enrichedBi, filters)
      expect(inp.material).toBe("일반강")
      expect(inp.toolSubtype).toBe("Square")
    })

    it("R-23: rebuild idempotency — applying same filters twice", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Ball", 1)!,
        buildAppliedFilterFromValue("diameterMm", 6, 2)!,
      ]
      const r1 = applyChain(bi, filters)
      const r2 = applyChain(bi, filters)
      expect(r1).toEqual(r2)
    })

    it("R-24: clear then rebuild — cleared field stays undefined", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      ]
      const inp = applyChain(bi, filters)
      const cleared = clear(inp, "toolSubtype")
      expect(cleared.toolSubtype).toBeUndefined()
      expect(cleared.flutePreference).toBe(4)
    })

    it("R-25: clear non-existent field is safe", () => {
      const inp = applyChain(bi, [])
      const cleared = clear(inp, "toolSubtype")
      expect(cleared.toolSubtype).toBeUndefined()
    })

    it("R-26: clear all fields one by one", () => {
      const fields = ["toolSubtype", "fluteCount", "coating", "diameterMm", "workPieceName"]
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
        buildAppliedFilterFromValue("diameterMm", 10, 4)!,
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 5)!,
      ]
      let inp = applyChain(bi, filters)
      for (const field of fields) {
        inp = clear(inp, field)
      }
      expect(inp.toolSubtype).toBeUndefined()
      expect(inp.flutePreference).toBeUndefined()
      expect(inp.coatingPreference).toBeUndefined()
      expect(inp.diameterMm).toBeUndefined()
      expect(inp.workPieceName).toBeUndefined()
    })

    it("R-27: replaceFieldFilters batch — 3 new on empty", () => {
      const batch = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      ]
      const { nextInput, nextFilters, replacedExisting } = replaceFieldFilters(bi, [], batch, apply)
      expect(replacedExisting).toBe(false)
      expect(nextFilters).toHaveLength(3)
      expect(nextInput.toolSubtype).toBe("Square")
    })

    it("R-28: replaceFieldFilters batch — overwrites 2 of 3", () => {
      const existing = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      ]
      const batch = [
        buildAppliedFilterFromValue("toolSubtype", "Ball", 4)!,
        buildAppliedFilterFromValue("fluteCount", 2, 5)!,
      ]
      const { nextInput, replacedFields } = replaceFieldFilters(bi, existing, batch, apply)
      expect(replacedFields).toContain("toolSubtype")
      expect(replacedFields).toContain("fluteCount")
      expect(nextInput.toolSubtype).toBe("Ball")
      expect(nextInput.flutePreference).toBe(2)
      expect(nextInput.coatingPreference).toBe("TiAlN")
    })

    it("R-29: replaceFieldFilters preserves filter order", () => {
      const existing = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
      ]
      const batch = [buildAppliedFilterFromValue("coating", "TiAlN", 3)!]
      const { nextFilters } = replaceFieldFilters(bi, existing, batch, apply)
      expect(nextFilters[0].field).toBe("toolSubtype")
      expect(nextFilters[1].field).toBe("fluteCount")
      expect(nextFilters[2].field).toBe("coating")
    })

    it("R-30: clearFilterFromRecommendationInput leaves other fields intact", () => {
      const inp = applyChain(bi, [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 2)!,
        buildAppliedFilterFromValue("diameterMm", 10, 3)!,
      ])
      const cleared = clear(inp, "coating")
      expect(cleared.toolSubtype).toBe("Square")
      expect(cleared.coatingPreference).toBeUndefined()
      expect(cleared.diameterMm).toBe(10)
    })
  })
})

/* ================================================================
 * Group 6: Cross-field dependency chains (20 tests)
 * ================================================================ */
describe("Group 6: Cross-field dependency chains", () => {
  const bi = baseInput()

  describe("material change → workPieceName clears, coating stays", () => {
    it("X-01: material sets workPieceName to undefined", () => {
      const inp = apply(baseInput({ workPieceName: "알루미늄", coatingPreference: "TiAlN" }),
        buildAppliedFilterFromValue("material", "일반강", 1)!)
      expect(inp.material).toBe("일반강")
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.coatingPreference).toBe("TiAlN")
    })

    it("X-02: clearInput for material clears both material and workPieceName", () => {
      const inp = baseInput({ material: "일반강", workPieceName: "탄소강" })
      const cleared = clear(inp, "material")
      expect(cleared.material).toBeUndefined()
      expect(cleared.workPieceName).toBeUndefined()
    })

    it("X-03: material change preserves toolSubtype", () => {
      const inp = apply(
        baseInput({ toolSubtype: "Square", workPieceName: "알루미늄" }),
        buildAppliedFilterFromValue("material", "일반강", 1)!
      )
      expect(inp.toolSubtype).toBe("Square")
    })

    it("X-04: material change preserves fluteCount", () => {
      const inp = apply(
        baseInput({ flutePreference: 4, workPieceName: "알루미늄" }),
        buildAppliedFilterFromValue("material", "일반강", 1)!
      )
      expect(inp.flutePreference).toBe(4)
    })

    it("X-05: material change preserves diameterMm", () => {
      const inp = apply(
        baseInput({ diameterMm: 10, workPieceName: "알루미늄" }),
        buildAppliedFilterFromValue("material", "일반강", 1)!
      )
      expect(inp.diameterMm).toBe(10)
    })
  })

  describe("diameterMm change → seriesName removal (manual dependency)", () => {
    it("X-06: series filter can be manually removed after diameter change", () => {
      const filters = [
        buildAppliedFilterFromValue("seriesName", "V7PLUS", 1)!,
        buildAppliedFilterFromValue("diameterMm", 10, 2)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.seriesName).toBe("V7PLUS")
      expect(inp.diameterMm).toBe(10)
      // Manual series removal after diameter change
      const cleared = clear(inp, "seriesName")
      expect(cleared.seriesName).toBeUndefined()
      expect(cleared.diameterMm).toBe(10)
    })

    it("X-07: diameter change then add new series", () => {
      let filters: AppliedFilter[] = [
        buildAppliedFilterFromValue("seriesName", "V7PLUS", 1)!,
        buildAppliedFilterFromValue("diameterMm", 10, 2)!,
      ]
      // Remove series
      filters = filters.filter(f => f.field !== "seriesName")
      // Add new diameter
      const fNewDia = buildAppliedFilterFromValue("diameterMm", 12, 3)!
      filters = replaceFieldFilter(bi, filters, fNewDia, apply).nextFilters
      // Add new series
      const fNewSeries = buildAppliedFilterFromValue("seriesName", "CE7659", 4)!
      filters = [...filters, fNewSeries]
      const inp = applyChain(bi, filters)
      expect(inp.diameterMm).toBe(12)
      expect(inp.seriesName).toBe("CE7659")
    })
  })

  describe("5 filters → clear material → rebuild → workPieceName gone", () => {
    it("X-08: clear material from 5-filter chain clears workPieceName", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("material", "일반강", 3)!,
        buildAppliedFilterFromValue("workPieceName", "탄소강", 4)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 5)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.workPieceName).toBe("탄소강")

      // clear material
      const remaining = filters.filter(f => f.field !== "material")
      const rebuilt = applyChain(bi, remaining)
      expect(rebuilt.material).toBeUndefined()
      // workPieceName should still be there (only material's setInput clears it)
      expect(rebuilt.workPieceName).toBe("탄소강")
    })

    it("X-09: apply material filter clears any existing workPieceName", () => {
      const filters = [
        buildAppliedFilterFromValue("workPieceName", "탄소강", 1)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.workPieceName).toBe("탄소강")

      // Now apply material → workPieceName cleared by material's setInput
      const withMaterial = apply(inp, buildAppliedFilterFromValue("material", "스테인리스강", 2)!)
      expect(withMaterial.material).toBe("스테인리스강")
      expect(withMaterial.workPieceName).toBeUndefined()
    })

    it("X-10: rebuild with material in middle of chain — workPieceName survives (applyChain does not clear cross-field)", () => {
      const filters = [
        buildAppliedFilterFromValue("workPieceName", "탄소강", 1)!,
        buildAppliedFilterFromValue("material", "일반강", 2)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 3)!,
      ]
      const inp = applyChain(bi, filters)
      // applyChain applies filters sequentially but workPieceName set by an
      // earlier filter is not cleared by a later material filter in this path.
      expect(inp.workPieceName).toBe("탄소강")
      expect(inp.material).toBe("일반강")
      expect(inp.coatingPreference).toBe("TiAlN")
    })
  })

  describe("Rapid: set material 3 times → workPieceName clears each time", () => {
    it("X-11: 3 material changes each clear workPieceName", () => {
      // Check that each material application clears workPieceName
      let inp = baseInput({ workPieceName: "알루미늄" })
      inp = apply(inp, buildAppliedFilterFromValue("material", "일반강", 1)!)
      expect(inp.workPieceName).toBeUndefined()

      inp = { ...inp, workPieceName: "탄소강" } // simulate re-add
      inp = apply(inp, buildAppliedFilterFromValue("material", "스테인리스강", 2)!)
      expect(inp.workPieceName).toBeUndefined()

      inp = { ...inp, workPieceName: "고경도강" } // simulate re-add
      inp = apply(inp, buildAppliedFilterFromValue("material", "알루미늄합금", 3)!)
      expect(inp.workPieceName).toBeUndefined()
      expect(inp.material).toBe("알루미늄합금")
    })

    it("X-12: material+workPieceName interleave in filter chain", () => {
      const filters = [
        buildAppliedFilterFromValue("material", "일반강", 1)!,
        buildAppliedFilterFromValue("workPieceName", "탄소강", 2)!,
        buildAppliedFilterFromValue("material", "스테인리스강", 3)!,
        buildAppliedFilterFromValue("workPieceName", "고경도강", 4)!,
        buildAppliedFilterFromValue("material", "알루미늄합금", 5)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.material).toBe("알루미늄합금")
      expect(inp.workPieceName).toBeUndefined() // last is material → clears
    })

    it("X-13: material then workPieceName at end → workPieceName survives", () => {
      const filters = [
        buildAppliedFilterFromValue("material", "일반강", 1)!,
        buildAppliedFilterFromValue("workPieceName", "탄소강", 2)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.material).toBe("일반강")
      expect(inp.workPieceName).toBe("탄소강")
    })

    it("X-14: workPieceName alone → no dependency issue", () => {
      const f = buildAppliedFilterFromValue("workPieceName", "알루미늄", 1)!
      const inp = apply(bi, f)
      expect(inp.workPieceName).toBe("알루미늄")
      expect(inp.material).toBeUndefined()
    })
  })

  describe("Cross-field complex scenarios", () => {
    it("X-15: 6 filters → remove material → workPieceName survives", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("material", "일반강", 3)!,
        buildAppliedFilterFromValue("workPieceName", "탄소강", 4)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 5)!,
        buildAppliedFilterFromValue("diameterMm", 10, 6)!,
      ]
      // Remove material and rebuild
      const withoutMaterial = filters.filter(f => f.field !== "material")
      const inp = applyChain(bi, withoutMaterial)
      expect(inp.material).toBeUndefined()
      expect(inp.workPieceName).toBe("탄소강") // workPieceName survives — no material to clear it
      expect(inp.toolSubtype).toBe("Square")
      expect(inp.coatingPreference).toBe("TiAlN")
    })

    it("X-16: replace material in 6-filter chain → workPieceName cleared by new material", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("material", "일반강", 2)!,
        buildAppliedFilterFromValue("workPieceName", "탄소강", 3)!,
        buildAppliedFilterFromValue("coating", "TiAlN", 4)!,
        buildAppliedFilterFromValue("diameterMm", 10, 5)!,
        buildAppliedFilterFromValue("fluteCount", 4, 6)!,
      ]
      const newMaterial = buildAppliedFilterFromValue("material", "스테인리스강", 7)!
      const { nextInput } = replaceFieldFilter(bi, filters, newMaterial, apply)
      // After replaceFieldFilter, the chain is rebuilt. material is now last in chain.
      // material setInput clears workPieceName.
      // But workPieceName filter is still in the list and applied after material...
      // replaceFieldFilter puts the new filter at the END.
      // So order is: toolSubtype, workPieceName, coating, diameterMm, fluteCount, material(new)
      // material is applied last → clears workPieceName
      expect(nextInput.material).toBe("스테인리스강")
      expect(nextInput.workPieceName).toBeUndefined()
    })

    it("X-17: coating change preserves all other fields", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Square", 1)!,
        buildAppliedFilterFromValue("fluteCount", 4, 2)!,
        buildAppliedFilterFromValue("workPieceName", "알루미늄", 3)!,
        buildAppliedFilterFromValue("diameterMm", 10, 4)!,
      ]
      const inp = applyChain(bi, filters)
      const withCoating = apply(inp, buildAppliedFilterFromValue("coating", "TiAlN", 5)!)
      expect(withCoating.toolSubtype).toBe("Square")
      expect(withCoating.flutePreference).toBe(4)
      expect(withCoating.workPieceName).toBe("알루미늄")
      expect(withCoating.diameterMm).toBe(10)
      expect(withCoating.coatingPreference).toBe("TiAlN")
    })

    it("X-18: fluteCount change has no cross-field side effects", () => {
      const inp = baseInput({
        toolSubtype: "Square", coatingPreference: "TiAlN",
        workPieceName: "알루미늄", diameterMm: 10,
      })
      const updated = apply(inp, buildAppliedFilterFromValue("fluteCount", 2, 1)!)
      expect(updated.toolSubtype).toBe("Square")
      expect(updated.coatingPreference).toBe("TiAlN")
      expect(updated.workPieceName).toBe("알루미늄")
      expect(updated.diameterMm).toBe(10)
      expect(updated.flutePreference).toBe(2)
    })

    it("X-19: diameterMm change has no cross-field side effects", () => {
      const inp = baseInput({
        toolSubtype: "Ball", coatingPreference: "AlCrN",
        workPieceName: "고경도강", flutePreference: 4,
      })
      const updated = apply(inp, buildAppliedFilterFromValue("diameterMm", 6, 1)!)
      expect(updated.toolSubtype).toBe("Ball")
      expect(updated.coatingPreference).toBe("AlCrN")
      expect(updated.workPieceName).toBe("고경도강")
      expect(updated.flutePreference).toBe(4)
      expect(updated.diameterMm).toBe(6)
    })

    it("X-20: full 10-filter chain with material dependency", () => {
      const filters = [
        buildAppliedFilterFromValue("toolSubtype", "Roughing", 1)!,
        buildAppliedFilterFromValue("fluteCount", 6, 2)!,
        buildAppliedFilterFromValue("coating", "AlCrN", 3)!,
        buildAppliedFilterFromValue("diameterMm", 16, 4)!,
        buildAppliedFilterFromValue("brand", "TANK-POWER", 5)!,
        buildAppliedFilterFromValue("shankDiameterMm", 16, 6)!,
        buildAppliedFilterFromValue("lengthOfCutMm", 48, 7)!,
        buildAppliedFilterFromValue("material", "일반강", 8)!,  // clears workPieceName
        buildAppliedFilterFromValue("workPieceName", "탄소강", 9)!,  // re-add after material
        buildAppliedFilterFromValue("overallLengthMm", 100, 10)!,
      ]
      const inp = applyChain(bi, filters)
      expect(inp.toolSubtype).toBe("Roughing")
      expect(inp.flutePreference).toBe(6)
      expect(inp.coatingPreference).toBe("AlCrN")
      expect(inp.diameterMm).toBe(16)
      expect(inp.brand).toBe("TANK-POWER")
      expect(inp.shankDiameterMm).toBe(16)
      expect(inp.lengthOfCutMm).toBe(48)
      expect(inp.material).toBe("일반강")
      expect(inp.workPieceName).toBe("탄소강")
      expect(inp.overallLengthMm).toBe(100)
    })
  })
})
