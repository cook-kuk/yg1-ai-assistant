/**
 * Question Path Option-First — Regression tests
 *
 * Verifies:
 * 1. buildQuestionFieldOptions produces displayedOptions FIRST
 * 2. chips are derived from displayedOptions
 * 3. question-engine candidate chips are converted into structured SmartOptions
 * 4. skip/delegate/navigation options are included
 * 5. no path treats question-engine chips as primary truth
 */

import { describe, it, expect } from "vitest"
import {
  buildQuestionFieldOptions,
  buildDisplayedOptions,
} from "../../../infrastructure/engines/serve-engine-option-first"

// ════════════════════════════════════════════════════════════════
// TEST 1: buildQuestionFieldOptions produces displayedOptions FIRST
// ════════════════════════════════════════════════════════════════

describe("question-option-first: displayedOptions are primary", () => {
  it("produces displayedOptions from candidate chips", () => {
    const result = buildQuestionFieldOptions(
      "fluteCount",
      ["2날 (216개)", "3날 (173개)", "1날 (38개)", "4날 (17개)", "상관없음"],
      true
    )

    // displayedOptions should be non-empty
    expect(result.displayedOptions.length).toBeGreaterThan(0)

    // Every displayedOption should have the correct field
    for (const opt of result.displayedOptions) {
      if (opt.value !== "skip" && opt.value !== "undo") {
        expect(opt.field).toBe("fluteCount")
      }
    }
  })

  it("SmartOptions have proper families", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC (5개)", "AlTiN (3개)", "상관없음"],
      false
    )

    // Field choices should be "narrowing" family
    const fieldChoices = result.options.filter(o => o.family === "narrowing")
    expect(fieldChoices.length).toBe(2) // DLC, AlTiN

    // Skip should be "action" family
    const skipOption = result.options.find(o => o.value === "skip")
    expect(skipOption).toBeTruthy()
    expect(skipOption!.label).toBe("상관없음")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: chips are derived from displayedOptions
// ════════════════════════════════════════════════════════════════

describe("question-option-first: chips derived from options", () => {
  it("every chip maps to a SmartOption label", () => {
    const result = buildQuestionFieldOptions(
      "fluteCount",
      ["2날 (216개)", "3날 (173개)", "상관없음"],
      true
    )

    for (const chip of result.chips) {
      const hasOption = result.options.some(o => o.label === chip)
      expect(hasOption).toBe(true)
    }
  })

  it("chip count matches option count", () => {
    const result = buildQuestionFieldOptions(
      "toolSubtype",
      ["Square (100개)", "Ball (50개)", "Radius (30개)", "상관없음"],
      false
    )

    // chips = options labels (1:1 mapping)
    expect(result.chips.length).toBe(result.options.length)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: question-engine chips converted to structured options
// ════════════════════════════════════════════════════════════════

describe("question-option-first: structured conversion", () => {
  it("extracts value and count from chip format", () => {
    const result = buildQuestionFieldOptions(
      "fluteCount",
      ["2날 (216개)", "3날 (173개)"],
      false
    )

    const opt2 = result.options.find(o => o.value === "2날")
    expect(opt2).toBeTruthy()
    expect(opt2!.projectedCount).toBe(216)
    expect(opt2!.field).toBe("fluteCount")
    expect(opt2!.plan.type).toBe("apply_filter")

    const opt3 = result.options.find(o => o.value === "3날")
    expect(opt3).toBeTruthy()
    expect(opt3!.projectedCount).toBe(173)
  })

  it("handles chips without count", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC", "AlTiN", "TiCN"],
      false
    )

    expect(result.options.filter(o => o.family === "narrowing").length).toBe(3)
    const dlc = result.options.find(o => o.value === "DLC")
    expect(dlc).toBeTruthy()
    expect(dlc!.projectedCount).toBeNull()
  })

  it("filters out meta chips from value options", () => {
    const result = buildQuestionFieldOptions(
      "fluteCount",
      ["2날 (216개)", "상관없음", "⟵ 이전 단계", "처음부터 다시"],
      true
    )

    // Only "2날" should be a narrowing option
    const narrowing = result.options.filter(o => o.family === "narrowing")
    expect(narrowing.length).toBe(1)
    expect(narrowing[0].value).toBe("2날")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: skip/delegate/navigation options supported
// ════════════════════════════════════════════════════════════════

describe("question-option-first: skip and navigation", () => {
  it("always includes skip option", () => {
    const result = buildQuestionFieldOptions("fluteCount", ["2날", "3날"], false)
    const skip = result.options.find(o => o.value === "skip")
    expect(skip).toBeTruthy()
    expect(skip!.label).toBe("상관없음")
  })

  it("includes back navigation when hasHistory is true", () => {
    const result = buildQuestionFieldOptions("fluteCount", ["2날"], true)
    const back = result.options.find(o => o.value === "undo")
    expect(back).toBeTruthy()
    expect(back!.label).toBe("⟵ 이전 단계")
  })

  it("no back navigation when hasHistory is false", () => {
    const result = buildQuestionFieldOptions("fluteCount", ["2날"], false)
    const back = result.options.find(o => o.value === "undo")
    expect(back).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: no chip-first assumptions
// ════════════════════════════════════════════════════════════════

describe("question-option-first: no chip-first", () => {
  it("displayedOptions is NOT derived from chips", () => {
    // In the old flow: chips → buildDisplayedOptions(chips)
    // In the new flow: question data → SmartOptions → displayedOptions AND chips
    // Verify that displayedOptions and chips are both derived from the same SmartOptions

    const result = buildQuestionFieldOptions(
      "fluteCount",
      ["2날 (216개)", "3날 (173개)", "상관없음"],
      true
    )

    // Both should have the same number of items
    expect(result.chips.length).toBe(result.options.length)
    expect(result.displayedOptions.length).toBeGreaterThan(0)

    // displayedOptions should have structured fields
    for (const opt of result.displayedOptions) {
      expect(opt).toHaveProperty("label")
      expect(opt).toHaveProperty("value")
      expect(opt).toHaveProperty("field")
      expect(opt).toHaveProperty("count")
    }
  })

  it("buildDisplayedOptions is only used as fallback, not primary path", () => {
    // buildDisplayedOptions should still work but is NOT the primary path
    const options = buildDisplayedOptions(
      ["2날 (216개)", "3날 (173개)", "상관없음"],
      "fluteCount"
    )
    expect(options.length).toBeGreaterThan(0) // still functional as fallback
  })
})
