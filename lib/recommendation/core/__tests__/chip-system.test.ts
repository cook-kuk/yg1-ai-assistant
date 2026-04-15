import { describe, it, expect, vi } from "vitest"
import {
  deriveChips,
  toChipState,
  compareChips,
  safeApplyChips,
  type ChipState,
  type RenderedChip,
} from "../chip-system"

// ── Helper: minimal ChipState ──

function makeChipState(overrides: Partial<ChipState> = {}): ChipState {
  return {
    currentMode: "narrowing",
    candidateCount: 100,
    appliedFilters: [],
    lastAskedField: null,
    turnCount: 1,
    resolutionStatus: null,
    displayedCandidateCount: 0,
    hasHistory: false,
    ...overrides,
  }
}

// ── deriveChips — narrowing phase ──

describe("deriveChips — narrowing phase", () => {
  it("returns chips when in narrowing phase (turnCount > 0)", () => {
    const chips = deriveChips(makeChipState())
    expect(chips.length).toBeGreaterThan(0)
  })

  it("returns no chips on turnCount=0 (not yet narrowing)", () => {
    const chips = deriveChips(makeChipState({ turnCount: 0 }))
    expect(chips).toHaveLength(0)
  })

  it("includes view_products when candidateCount > 50", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 100 }))
    expect(chips.some(c => c.key === "view_products")).toBe(true)
  })

  it("includes confirm_recommend when candidateCount <= 50", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 30 }))
    expect(chips.some(c => c.key === "confirm_recommend")).toBe(true)
  })

  it("includes confirm_recommend for any positive candidateCount (LLM decides pruning)", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 100 }))
    expect(chips.some(c => c.key === "confirm_recommend")).toBe(true)
  })

  it("excludes confirm_recommend when there are no candidates", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 0 }))
    expect(chips.some(c => c.key === "confirm_recommend")).toBe(false)
  })

  it("includes select_material when no material filter applied", () => {
    const chips = deriveChips(makeChipState())
    expect(chips.some(c => c.key === "select_material")).toBe(true)
  })

  it("excludes select_material when material filter already applied", () => {
    const chips = deriveChips(makeChipState({
      appliedFilters: [{ field: "material", op: "eq", value: "Steel" }],
    }))
    expect(chips.some(c => c.key === "select_material")).toBe(false)
  })

  it("includes select_flute_count regardless of candidateCount (LLM prunes downstream)", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 15 }), "ko", 10)
    expect(chips.some(c => c.key === "select_flute_count")).toBe(true)
  })

  it("excludes select_flute_count when fluteCount filter already applied", () => {
    const chips = deriveChips(makeChipState({
      candidateCount: 100,
      appliedFilters: [{ field: "fluteCount", op: "eq", value: "4" }],
    }), "ko", 10)
    expect(chips.some(c => c.key === "select_flute_count")).toBe(false)
  })

  it("includes select_coating regardless of candidateCount (LLM prunes downstream)", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 5 }), "ko", 10)
    expect(chips.some(c => c.key === "select_coating")).toBe(true)
  })

  it("includes skip_field when lastAskedField is set", () => {
    const chips = deriveChips(makeChipState({ lastAskedField: "material" }), "ko", 10)
    expect(chips.some(c => c.key === "skip_field")).toBe(true)
  })

  it("excludes skip_field when lastAskedField is null", () => {
    const chips = deriveChips(makeChipState({ lastAskedField: null }), "ko", 10)
    expect(chips.some(c => c.key === "skip_field")).toBe(false)
  })

  it("skips filter fields that have op='skip'", () => {
    // A filter with op "skip" should not count as "has filter"
    const chips = deriveChips(makeChipState({
      appliedFilters: [{ field: "material", op: "skip" }],
    }))
    expect(chips.some(c => c.key === "select_material")).toBe(true)
  })
})

// ── deriveChips — recommendation phase ──

describe("deriveChips — recommendation phase", () => {
  const recState = makeChipState({
    currentMode: "recommendation",
    turnCount: 3,
    displayedCandidateCount: 5,
    appliedFilters: [{ field: "material", op: "eq", value: "Steel" }],
  })

  it("includes show_cutting_condition", () => {
    const chips = deriveChips(recState, "ko", 10)
    expect(chips.some(c => c.key === "show_cutting_condition")).toBe(true)
  })

  it("includes compare_top when displayedCandidateCount >= 2", () => {
    const chips = deriveChips(recState, "ko", 10)
    expect(chips.some(c => c.key === "compare_top")).toBe(true)
  })

  it("excludes compare_top when displayedCandidateCount < 2", () => {
    const chips = deriveChips({ ...recState, displayedCandidateCount: 1 }, "ko", 10)
    expect(chips.some(c => c.key === "compare_top")).toBe(false)
  })

  it("includes change_diameter", () => {
    const chips = deriveChips(recState, "ko", 10)
    expect(chips.some(c => c.key === "change_diameter")).toBe(true)
  })

  it("includes change_condition when filters exist", () => {
    const chips = deriveChips(recState, "ko", 10)
    expect(chips.some(c => c.key === "change_condition")).toBe(true)
  })

  it("excludes change_condition when no filters", () => {
    const chips = deriveChips({ ...recState, appliedFilters: [] }, "ko", 10)
    expect(chips.some(c => c.key === "change_condition")).toBe(false)
  })

  it("does NOT include narrowing-only chips like select_material", () => {
    const chips = deriveChips(recState, "ko", 10)
    expect(chips.some(c => c.key === "select_material")).toBe(false)
  })

  it("resolvedStatus 'resolved_exact' triggers recommendation phase", () => {
    const state = makeChipState({
      currentMode: "narrowing",
      resolutionStatus: "resolved_exact",
      turnCount: 2,
      displayedCandidateCount: 3,
    })
    const chips = deriveChips(state, "ko", 10)
    expect(chips.some(c => c.key === "show_cutting_condition")).toBe(true)
  })
})

// ── deriveChips — navigation chips ──

describe("deriveChips — navigation", () => {
  it("includes go_back when hasHistory and filters exist", () => {
    const chips = deriveChips(makeChipState({
      hasHistory: true,
      appliedFilters: [{ field: "material", op: "eq" }],
    }), "ko", 10)
    expect(chips.some(c => c.key === "go_back")).toBe(true)
  })

  it("excludes go_back when no history", () => {
    const chips = deriveChips(makeChipState({ hasHistory: false }), "ko", 10)
    expect(chips.some(c => c.key === "go_back")).toBe(false)
  })

  it("includes reset when turnCount > 0", () => {
    const chips = deriveChips(makeChipState({ turnCount: 1 }), "ko", 10)
    expect(chips.some(c => c.key === "reset")).toBe(true)
  })

  it("excludes reset when turnCount = 0", () => {
    const chips = deriveChips(makeChipState({ turnCount: 0 }), "ko", 10)
    expect(chips.some(c => c.key === "reset")).toBe(false)
  })
})

// ── deriveChips — locale ──

describe("deriveChips — locale", () => {
  it("returns Korean labels by default", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 30 }))
    const confirm = chips.find(c => c.key === "confirm_recommend")
    expect(confirm?.label).toBe("이 조건으로 추천")
  })

  it("returns English labels when locale is 'en'", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 30 }), "en")
    const confirm = chips.find(c => c.key === "confirm_recommend")
    expect(confirm?.label).toBe("Recommend with these")
  })
})

// ── deriveChips — maxChips ──

describe("deriveChips — maxChips limit", () => {
  it("limits output to maxChips", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 100 }), "ko", 3)
    expect(chips.length).toBeLessThanOrEqual(3)
  })

  it("defaults to 6 chips max", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 100 }))
    expect(chips.length).toBeLessThanOrEqual(6)
  })
})

// ── deriveChips — priority ordering ──

describe("deriveChips — priority ordering", () => {
  it("returns chips sorted by priority (lower number first)", () => {
    const chips = deriveChips(makeChipState({ candidateCount: 30 }), "ko", 10)
    // confirm_recommend (priority 5) should come before select_material (priority 10)
    const confirmIdx = chips.findIndex(c => c.key === "confirm_recommend")
    const materialIdx = chips.findIndex(c => c.key === "select_material")
    if (confirmIdx >= 0 && materialIdx >= 0) {
      expect(confirmIdx).toBeLessThan(materialIdx)
    }
  })
})

// ── deriveChips — dynamic chips (candidateDistribution) ──

describe("deriveChips — dynamic chips", () => {
  it("generates dynamic chips from candidateDistribution", () => {
    const chips = deriveChips(makeChipState({
      candidateDistribution: [
        { field: "endType", value: "Radius", count: 204 },
        { field: "endType", value: "Square", count: 189 },
      ],
    }))
    expect(chips.some(c => c.key.startsWith("narrow_"))).toBe(true)
    expect(chips.some(c => c.label.includes("Radius"))).toBe(true)
  })

  it("dynamic chips appear before static chips", () => {
    const chips = deriveChips(makeChipState({
      candidateDistribution: [
        { field: "endType", value: "Ball", count: 50 },
      ],
    }), "ko", 10)
    expect(chips[0].key).toContain("narrow_")
  })

  it("limits dynamic chips to top 4 by count", () => {
    const chips = deriveChips(makeChipState({
      candidateDistribution: [
        { field: "f", value: "A", count: 100 },
        { field: "f", value: "B", count: 90 },
        { field: "f", value: "C", count: 80 },
        { field: "f", value: "D", count: 70 },
        { field: "f", value: "E", count: 60 },
      ],
    }), "ko", 10)
    const dynamicChips = chips.filter(c => c.key.startsWith("narrow_"))
    expect(dynamicChips.length).toBeLessThanOrEqual(4)
  })

  it("dynamic chips include count with Korean suffix", () => {
    const chips = deriveChips(makeChipState({
      candidateDistribution: [{ field: "f", value: "X", count: 42 }],
    }), "ko")
    const dynamic = chips.find(c => c.key.startsWith("narrow_"))
    expect(dynamic?.label).toContain("42개")
  })

  it("dynamic chips use no suffix in English", () => {
    const chips = deriveChips(makeChipState({
      candidateDistribution: [{ field: "f", value: "X", count: 42 }],
    }), "en")
    const dynamic = chips.find(c => c.key.startsWith("narrow_"))
    expect(dynamic?.label).toBe("X (42)")
  })

  it("no dynamic chips in recommendation phase", () => {
    const chips = deriveChips(makeChipState({
      currentMode: "recommendation",
      candidateDistribution: [{ field: "f", value: "A", count: 100 }],
    }), "ko", 10)
    expect(chips.some(c => c.key.startsWith("narrow_"))).toBe(false)
  })

  it("no dynamic chips when candidateDistribution is empty", () => {
    const chips = deriveChips(makeChipState({ candidateDistribution: [] }))
    expect(chips.every(c => !c.key.startsWith("narrow_"))).toBe(true)
  })
})

// ── toChipState ──

describe("toChipState", () => {
  it("converts full state to ChipState", () => {
    const result = toChipState({
      currentMode: "narrowing",
      candidateCount: 50,
      appliedFilters: [{ field: "material", op: "eq", value: "Steel" }],
      lastAskedField: "diameterMm",
      turnCount: 3,
      resolutionStatus: null,
      displayedCandidates: [{}, {}, {}] as any,
      narrowingHistory: [{}] as any,
    })
    expect(result.currentMode).toBe("narrowing")
    expect(result.candidateCount).toBe(50)
    expect(result.appliedFilters).toHaveLength(1)
    expect(result.lastAskedField).toBe("diameterMm")
    expect(result.turnCount).toBe(3)
    expect(result.displayedCandidateCount).toBe(3)
    expect(result.hasHistory).toBe(true)
  })

  it("handles null input", () => {
    const result = toChipState(null)
    expect(result.currentMode).toBeNull()
    expect(result.candidateCount).toBe(0)
    expect(result.appliedFilters).toHaveLength(0)
    expect(result.turnCount).toBe(0)
    expect(result.hasHistory).toBe(false)
  })

  it("handles undefined optional fields", () => {
    const result = toChipState({})
    expect(result.currentMode).toBeNull()
    expect(result.candidateCount).toBe(0)
    expect(result.displayedCandidateCount).toBe(0)
    expect(result.hasHistory).toBe(false)
  })

  it("preserves candidateDistribution", () => {
    const dist = [{ field: "f", value: "v", count: 10 }]
    const result = toChipState({ candidateDistribution: dist })
    expect(result.candidateDistribution).toBe(dist)
  })
})

// ── compareChips ──

describe("compareChips", () => {
  it("reports match when old and new have same labels", () => {
    const old = ["A", "B"]
    const newChips: RenderedChip[] = [
      { key: "a", label: "A", type: "primary" },
      { key: "b", label: "B", type: "filter" },
    ]
    const result = compareChips(old, newChips)
    expect(result.match).toBe(true)
    expect(result.onlyInOld).toHaveLength(0)
    expect(result.onlyInNew).toHaveLength(0)
    expect(result.common).toEqual(["A", "B"])
  })

  it("detects chips only in old", () => {
    const result = compareChips(["A", "B", "C"], [{ key: "a", label: "A", type: "primary" }])
    expect(result.match).toBe(false)
    expect(result.onlyInOld).toEqual(["B", "C"])
  })

  it("detects chips only in new", () => {
    const result = compareChips(["A"], [
      { key: "a", label: "A", type: "primary" },
      { key: "b", label: "B", type: "filter" },
    ])
    expect(result.match).toBe(false)
    expect(result.onlyInNew).toEqual(["B"])
  })

  it("reports counts correctly", () => {
    const result = compareChips(["X", "Y"], [{ key: "z", label: "Z", type: "info" }])
    expect(result.oldCount).toBe(2)
    expect(result.newCount).toBe(1)
  })

  it("handles empty inputs", () => {
    const result = compareChips([], [])
    expect(result.match).toBe(true)
    expect(result.common).toHaveLength(0)
  })

  it("trims whitespace in old chip labels", () => {
    const result = compareChips(["  A  "], [{ key: "a", label: "A", type: "primary" }])
    expect(result.match).toBe(true)
  })
})

// ── safeApplyChips ──

describe("safeApplyChips", () => {
  const oldChips = ["Old A", "Old B"]

  it("returns old chips when useNewSystem is false", () => {
    const result = safeApplyChips(oldChips, [{ key: "a", label: "New A", type: "primary" }], false)
    expect(result).toEqual(oldChips)
  })

  it("returns new chip labels when useNewSystem is true", () => {
    const newChips: RenderedChip[] = [{ key: "a", label: "New A", type: "primary" }]
    const result = safeApplyChips(oldChips, newChips, true)
    expect(result).toEqual(["New A"])
  })

  it("falls back to old chips when new chips are empty", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const result = safeApplyChips(oldChips, [], true)
    expect(result).toEqual(oldChips)
    spy.mockRestore()
  })

  it("falls back to old chips when new chips exceed 10", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const tooMany: RenderedChip[] = Array.from({ length: 11 }, (_, i) => ({
      key: `k${i}`, label: `L${i}`, type: "primary" as const,
    }))
    const result = safeApplyChips(oldChips, tooMany, true)
    expect(result).toEqual(oldChips)
    spy.mockRestore()
  })

  it("accepts exactly 10 new chips", () => {
    const ten: RenderedChip[] = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`, label: `L${i}`, type: "primary" as const,
    }))
    const result = safeApplyChips(oldChips, ten, true)
    expect(result).toHaveLength(10)
  })
})
