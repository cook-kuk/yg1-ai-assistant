/**
 * Smart Option Engine — Targeted tests for performance behavior.
 *
 * Tests:
 * 1. option planner returns structured SmartOptions with stable ids and executable plans
 * 2. repair ranking prefers useful repair options over reset in a conflict scenario
 * 3. portfolio rerank avoids 4 nearly identical options
 * 4. response mapping keeps chips and structured options synchronized
 * 5. reset does not trigger from quoted/meta option text
 */

import { describe, it, expect, beforeEach } from "vitest"
import { planOptions } from "../option-planner"
import { simulateOptions } from "../option-simulator"
import { rankOptions } from "../option-ranker"
import { buildPortfolio } from "../option-portfolio"
import { generateSmartOptions, resetOptionCounter } from "../index"
import { smartOptionsToDisplayedOptions, smartOptionsToChips } from "../option-bridge"
import type { SmartOption, OptionPlannerContext } from "../types"

beforeEach(() => {
  resetOptionCounter()
})

// ════════════════════════════════════════════════════════════════
// 1. Option planner returns structured SmartOptions
// ════════════════════════════════════════════════════════════════

describe("option planner", () => {
  it("returns narrowing options with stable ids and executable plans", () => {
    const ctx: OptionPlannerContext = {
      mode: "narrowing",
      candidateCount: 50,
      appliedFilters: [],
      resolvedInput: { material: "aluminum" },
      lastAskedField: "coating",
      candidateFieldValues: new Map([
        ["coating", new Map([["AlTiN", 20], ["DLC", 15], ["TiAlN", 10], ["무코팅", 5]])],
        ["fluteCount", new Map([["2", 25], ["4", 20], ["3", 5]])],
      ]),
    }

    const options = planOptions(ctx)

    expect(options.length).toBeGreaterThan(0)

    // Every option has stable id, family, and plan
    for (const opt of options) {
      expect(opt.id).toBeTruthy()
      expect(opt.family).toBeTruthy()
      expect(opt.plan).toBeTruthy()
      expect(opt.plan.type).toBeTruthy()
      expect(Array.isArray(opt.plan.patches)).toBe(true)
    }

    // Ids are unique
    const ids = options.map(o => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("generates repair options for conflict scenarios", () => {
    const ctx: OptionPlannerContext = {
      mode: "repair",
      candidateCount: 15,
      appliedFilters: [
        { field: "coating", op: "includes", value: "DLC", rawValue: "DLC" },
        { field: "fluteCount", op: "eq", value: "1날", rawValue: 1 },
      ],
      resolvedInput: { material: "aluminum" },
      conflictField: "material",
      conflictValue: "stainless",
      candidateFieldValues: new Map([
        ["coating", new Map([["AlTiN", 10], ["DLC", 3]])],
      ]),
    }

    const options = planOptions(ctx)

    // Should have repair options and a reset option
    const repairOptions = options.filter(o => o.family === "repair")
    const resetOptions = options.filter(o => o.family === "reset")

    expect(repairOptions.length).toBeGreaterThanOrEqual(1)
    expect(resetOptions.length).toBe(1)

    // Repair options should preserve context
    for (const opt of repairOptions) {
      expect(opt.preservesContext).toBe(true)
      expect(opt.destructive).toBe(false)
    }

    // Reset should be destructive
    expect(resetOptions[0].destructive).toBe(true)
  })

  it("generates post-recommendation action options", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [
        { field: "material", op: "eq", value: "aluminum", rawValue: "aluminum" },
      ],
      resolvedInput: { material: "aluminum", diameterMm: 10 },
      topCandidates: [
        { displayCode: "CE480", seriesName: "CE480", coating: "DLC", fluteCount: 3, diameterMm: 10, score: 85, matchStatus: "exact" },
        { displayCode: "CE481", seriesName: "CE481", coating: "AlTiN", fluteCount: 4, diameterMm: 10, score: 78, matchStatus: "exact" },
      ],
    }

    const options = planOptions(ctx)

    expect(options.length).toBeGreaterThanOrEqual(3)

    // Should have action, explore, and reset families
    const families = new Set(options.map(o => o.family))
    expect(families.has("action")).toBe(true)
    expect(families.has("reset")).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// 2. Repair ranking prefers useful repair over reset
// ════════════════════════════════════════════════════════════════

describe("repair ranking", () => {
  it("ranks repair options above reset in conflict scenario", () => {
    const repairOption: SmartOption = {
      id: "repair_1",
      family: "repair",
      label: "코팅 변경 후 스테인리스 적용",
      subtitle: "코팅 교체",
      field: "material",
      value: "stainless",
      projectedCount: 8,
      projectedDelta: -7,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: { type: "replace_filter", patches: [{ op: "remove", field: "coating", value: "DLC" }, { op: "add", field: "material", value: "stainless" }] },
    }

    const resetOption: SmartOption = {
      id: "reset_1",
      family: "reset",
      label: "처음부터 다시",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: false,
      destructive: true,
      recommended: false,
      priorityScore: 0,
      plan: { type: "reset_session", patches: [] },
    }

    const ranked = rankOptions([resetOption, repairOption], {
      candidateCount: 15,
      filterCount: 2,
      hasRecommendation: true,
    })

    // Repair should rank above reset
    expect(ranked[0].family).toBe("repair")
    expect(ranked[0].priorityScore).toBeGreaterThan(ranked[1].priorityScore)

    // Repair should be marked recommended
    expect(ranked[0].recommended).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// 3. Portfolio rerank avoids 4 nearly identical options
// ════════════════════════════════════════════════════════════════

describe("portfolio rerank", () => {
  it("avoids showing 4 options with the same field and family", () => {
    const options: SmartOption[] = [
      makeOption("n1", "narrowing", "coating", "AlTiN", 0.9),
      makeOption("n2", "narrowing", "coating", "DLC", 0.85),
      makeOption("n3", "narrowing", "coating", "TiAlN", 0.8),
      makeOption("n4", "narrowing", "coating", "무코팅", 0.75),
      makeOption("a1", "action", undefined, "compare", 0.7),
      makeOption("e1", "explore", "diameterMm", "other_diameter", 0.6),
      makeOption("r1", "reset", undefined, undefined, 0.1),
    ]

    const portfolio = buildPortfolio(options)

    expect(portfolio.length).toBeLessThanOrEqual(4)

    // Should NOT have all 4 coating options
    const coatingOptions = portfolio.filter(o => o.field === "coating" && o.family === "narrowing")
    expect(coatingOptions.length).toBeLessThanOrEqual(1)

    // Should have diverse families
    const families = new Set(portfolio.map(o => o.family))
    expect(families.size).toBeGreaterThanOrEqual(2)
  })

  it("includes at most 1 reset option", () => {
    const options: SmartOption[] = [
      makeOption("n1", "narrowing", "fluteCount", "4", 0.9),
      makeOption("a1", "action", undefined, "compare", 0.8),
      makeOption("e1", "explore", "coating", "explore_coating", 0.7),
      makeOption("r1", "reset", undefined, undefined, 0.1),
    ]

    const portfolio = buildPortfolio(options)

    const resetCount = portfolio.filter(o => o.family === "reset").length
    expect(resetCount).toBeLessThanOrEqual(1)
  })
})

// ════════════════════════════════════════════════════════════════
// 4. Response mapping keeps chips and structured options synchronized
// ════════════════════════════════════════════════════════════════

describe("response mapping synchronization", () => {
  it("smartOptionsToChips and smartOptionsToDisplayedOptions are synchronized", () => {
    const options: SmartOption[] = [
      makeOption("n1", "narrowing", "coating", "AlTiN", 0.9),
      makeOption("a1", "action", undefined, "compare", 0.8),
      makeOption("e1", "explore", "diameterMm", "other", 0.7),
      makeOption("r1", "reset", undefined, undefined, 0.1),
    ]

    const chips = smartOptionsToChips(options)
    const displayed = smartOptionsToDisplayedOptions(options)

    // Chips include all options (including reset)
    expect(chips.length).toBe(options.length)

    // Displayed options exclude reset
    expect(displayed.length).toBe(options.length - 1)

    // Every displayed option label should appear in chips
    for (const opt of displayed) {
      expect(chips).toContain(opt.label)
    }

    // Displayed options should have sequential indices
    for (let i = 0; i < displayed.length; i++) {
      expect(displayed[i].index).toBe(i + 1)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// 5. Reset does not trigger from quoted/meta option text
// ════════════════════════════════════════════════════════════════

describe("reset safety", () => {
  it("reset options are only generated explicitly, not from option text matching", () => {
    // In narrowing mode, no reset options should be generated
    const ctx: OptionPlannerContext = {
      mode: "narrowing",
      candidateCount: 30,
      appliedFilters: [],
      resolvedInput: {},
      candidateFieldValues: new Map([
        ["coating", new Map([["AlTiN", 15], ["DLC", 10], ["처음부터 다시", 5]])],
      ]),
    }

    const options = planOptions(ctx)

    // Narrowing options should not produce reset family options
    const resetOptions = options.filter(o => o.family === "reset")
    expect(resetOptions.length).toBe(0)

    // Even if a candidate value happens to contain reset-like text
    const resetLikeOptions = options.filter(o =>
      o.label.includes("처음부터 다시") && o.family !== "narrowing"
    )
    expect(resetLikeOptions.length).toBe(0)
  })

  it("post-recommendation reset is always last in ranking", () => {
    const ctx: OptionPlannerContext = {
      mode: "recommended",
      candidateCount: 5,
      appliedFilters: [
        { field: "material", op: "eq", value: "aluminum", rawValue: "aluminum" },
      ],
      resolvedInput: {},
      topCandidates: [
        { displayCode: "CE480", seriesName: "CE480", coating: "DLC", fluteCount: 3, diameterMm: 10, score: 85, matchStatus: "exact" },
      ],
    }

    const options = planOptions(ctx)
    const ranked = rankOptions(options, {
      candidateCount: 5,
      filterCount: 1,
      hasRecommendation: true,
    })

    // Reset should be at the end
    const resetIdx = ranked.findIndex(o => o.family === "reset")
    if (resetIdx >= 0) {
      expect(resetIdx).toBe(ranked.length - 1)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// Full pipeline integration
// ════════════════════════════════════════════════════════════════

describe("full pipeline", () => {
  it("generateSmartOptions produces a balanced portfolio", () => {
    const fieldValues = new Map([
      ["coating", new Map([["AlTiN", 20], ["DLC", 15], ["TiAlN", 10]])],
      ["fluteCount", new Map([["2", 25], ["4", 15], ["3", 5]])],
      ["seriesName", new Map([["CE480", 12], ["GNX", 18], ["SEM", 15]])],
    ])

    const result = generateSmartOptions({
      plannerCtx: {
        mode: "narrowing",
        candidateCount: 45,
        appliedFilters: [],
        resolvedInput: { material: "aluminum" },
        lastAskedField: "coating",
        candidateFieldValues: fieldValues,
      },
      simulatorCtx: {
        candidateCount: 45,
        appliedFilters: [],
        candidateFieldValues: fieldValues,
      },
      rankerCtx: {
        candidateCount: 45,
        filterCount: 0,
        hasRecommendation: false,
      },
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(4)

    // All have scored priorities
    for (const opt of result) {
      expect(opt.priorityScore).toBeGreaterThanOrEqual(0)
      expect(opt.id).toBeTruthy()
      expect(opt.plan).toBeTruthy()
    }
  })
})

// ════════════════════════════════════════════════════════════════
// HELPER
// ════════════════════════════════════════════════════════════════

function makeOption(
  id: string,
  family: SmartOption["family"],
  field: string | undefined,
  value: string | undefined,
  score: number
): SmartOption {
  return {
    id,
    family,
    label: `${family}: ${value ?? "action"}`,
    field,
    value,
    projectedCount: 10,
    projectedDelta: -5,
    preservesContext: family !== "reset",
    destructive: family === "reset",
    recommended: false,
    priorityScore: score,
    plan: {
      type: family === "reset" ? "reset_session" : "apply_filter",
      patches: field ? [{ op: "add", field, value: value ?? "" }] : [],
    },
  }
}
