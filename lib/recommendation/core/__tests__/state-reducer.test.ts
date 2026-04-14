import { describe, it, expect } from "vitest"
import {
  reduce,
  compareReducerVsActual,
  dryRunReduce,
  type ReducerAction,
  type ReducerResult,
} from "../state-reducer"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ── Helper: minimal valid state ──

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "unresolved",
    resolvedInput: {} as any,
    turnCount: 0,
    currentMode: "narrowing",
    lastAskedField: null,
    lastAction: undefined,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  } as ExplorationSessionState
}

// ── narrow ──

describe("reduce — narrow", () => {
  it("appends filter and increments turnCount", () => {
    const prev = makeState({ turnCount: 2, appliedFilters: [{ field: "material", op: "eq", value: "Steel" }] as any })
    const action: ReducerAction = {
      type: "narrow",
      filter: { field: "diameterMm", op: "eq", value: "10" } as any,
      candidateCountAfter: 30,
      resolvedInput: { material: "Steel", diameterMm: 10 } as any,
    }
    const { nextState, mutations } = reduce(prev, action)

    expect(nextState.appliedFilters).toHaveLength(2)
    expect(nextState.turnCount).toBe(3)
    expect(nextState.candidateCount).toBe(30)
    expect(nextState.lastAction).toBe("continue_narrowing")
  })

  it("preserves currentMode from previous state", () => {
    const prev = makeState({ currentMode: "narrowing" })
    const { nextState } = reduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Steel" } as any,
      candidateCountAfter: 50,
      resolvedInput: {} as any,
    })
    expect(nextState.currentMode).toBe("narrowing")
  })

  it("defaults to 'narrowing' when currentMode is null", () => {
    const prev = makeState({ currentMode: null as any })
    const { nextState } = reduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Steel" } as any,
      candidateCountAfter: 50,
      resolvedInput: {} as any,
    })
    expect(nextState.currentMode).toBe("narrowing")
  })

  it("preserves lastAskedField from previous state", () => {
    const prev = makeState({ lastAskedField: "diameterMm" })
    const { nextState } = reduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Steel" } as any,
      candidateCountAfter: 50,
      resolvedInput: {} as any,
    })
    expect(nextState.lastAskedField).toBe("diameterMm")
  })

  it("records mutations for appliedFilters, turnCount, candidateCount", () => {
    const prev = makeState({ candidateCount: 200 })
    const { mutations } = reduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Steel" } as any,
      candidateCountAfter: 80,
      resolvedInput: {} as any,
    })
    const fields = mutations.map(m => m.field)
    expect(fields).toContain("appliedFilters")
    expect(fields).toContain("turnCount")
    expect(fields).toContain("candidateCount")
  })

  it("stores resolvedInput from action", () => {
    const input = { material: "Aluminum" } as any
    const { nextState } = reduce(makeState(), {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Aluminum" } as any,
      candidateCountAfter: 60,
      resolvedInput: input,
    })
    expect(nextState.resolvedInput).toBe(input)
  })
})

// ── skip_field ──

describe("reduce — skip_field", () => {
  it("increments turnCount and clears lastAskedField", () => {
    const prev = makeState({ turnCount: 3, lastAskedField: "coating" })
    const { nextState } = reduce(prev, { type: "skip_field", field: "coating" })
    expect(nextState.turnCount).toBe(4)
    expect(nextState.lastAskedField).toBeNull()
    expect(nextState.lastAction).toBe("skip_field")
  })

  it("records turnCount and lastAskedField mutations", () => {
    const prev = makeState({ lastAskedField: "material" })
    const { mutations } = reduce(prev, { type: "skip_field", field: "material" })
    expect(mutations).toHaveLength(2)
  })
})

// ── recommend ──

describe("reduce — recommend", () => {
  it("sets mode to recommendation and stores displayedCandidates", () => {
    const candidates = [{ id: "p1" }, { id: "p2" }] as any
    const prev = makeState({ currentMode: "narrowing" })
    const { nextState } = reduce(prev, {
      type: "recommend",
      candidateCountAfter: 2,
      displayedCandidates: candidates,
    })
    expect(nextState.currentMode).toBe("recommendation")
    expect(nextState.candidateCount).toBe(2)
    expect(nextState.displayedCandidates).toBe(candidates)
    expect(nextState.lastAction).toBe("show_recommendation")
  })

  it("increments turnCount", () => {
    const prev = makeState({ turnCount: 5 })
    const { nextState } = reduce(prev, {
      type: "recommend",
      candidateCountAfter: 3,
      displayedCandidates: [],
    })
    expect(nextState.turnCount).toBe(6)
  })

  it("records currentMode and candidateCount mutations", () => {
    const prev = makeState({ currentMode: "narrowing", candidateCount: 100 })
    const { mutations } = reduce(prev, {
      type: "recommend",
      candidateCountAfter: 5,
      displayedCandidates: [],
    })
    expect(mutations.some(m => m.field === "currentMode")).toBe(true)
    expect(mutations.some(m => m.field === "candidateCount")).toBe(true)
  })
})

// ── ask_question ──

describe("reduce — ask_question", () => {
  it("sets lastAskedField and increments turnCount", () => {
    const prev = makeState({ turnCount: 1, lastAskedField: undefined })
    const { nextState } = reduce(prev, { type: "ask_question", field: "material" })
    expect(nextState.turnCount).toBe(2)
    expect(nextState.lastAskedField).toBe("material")
    expect(nextState.lastAction).toBe("ask_question")
  })

  it("records lastAskedField mutation with before/after", () => {
    const prev = makeState({ lastAskedField: "coating" })
    const { mutations } = reduce(prev, { type: "ask_question", field: "diameterMm" })
    expect(mutations[0]).toEqual({ field: "lastAskedField", before: "coating", after: "diameterMm" })
  })
})

// ── compare ──

describe("reduce — compare", () => {
  it("increments turnCount and sets lastAction", () => {
    const prev = makeState({ turnCount: 4 })
    const { nextState } = reduce(prev, { type: "compare" })
    expect(nextState.turnCount).toBe(5)
    expect(nextState.lastAction).toBe("compare_products")
  })

  it("has no mutations", () => {
    const { mutations } = reduce(makeState(), { type: "compare" })
    expect(mutations).toHaveLength(0)
  })
})

// ── show_info ──

describe("reduce — show_info", () => {
  it("increments turnCount and sets lastAction", () => {
    const prev = makeState({ turnCount: 2 })
    const { nextState } = reduce(prev, { type: "show_info", infoType: "cutting_condition" })
    expect(nextState.turnCount).toBe(3)
    expect(nextState.lastAction).toBe("show_info")
  })

  it("has no mutations", () => {
    const { mutations } = reduce(makeState(), { type: "show_info", infoType: "spec" })
    expect(mutations).toHaveLength(0)
  })
})

// ── general_chat ──

describe("reduce — general_chat", () => {
  it("increments turnCount and sets lastAction to answer_general", () => {
    const prev = makeState({ turnCount: 0 })
    const { nextState } = reduce(prev, { type: "general_chat" })
    expect(nextState.turnCount).toBe(1)
    expect(nextState.lastAction).toBe("answer_general")
  })

  it("has no mutations", () => {
    const { mutations } = reduce(makeState(), { type: "general_chat" })
    expect(mutations).toHaveLength(0)
  })
})

// ── reset ──

describe("reduce — reset", () => {
  it("returns placeholder empty state", () => {
    const { nextState } = reduce(makeState({ turnCount: 10 }), { type: "reset" })
    // reset returns empty placeholder
    expect(nextState).toBeDefined()
  })

  it("records wildcard mutation", () => {
    const { mutations } = reduce(makeState(), { type: "reset" })
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toEqual({ field: "*", before: "all", after: "reset" })
  })
})

// ── go_back ──

describe("reduce — go_back", () => {
  it("replaces appliedFilters and candidateCount", () => {
    const prev = makeState({
      appliedFilters: [
        { field: "material", op: "eq", value: "Steel" },
        { field: "diameterMm", op: "eq", value: "10" },
      ] as any,
      candidateCount: 30,
    })
    const remaining = [{ field: "material", op: "eq", value: "Steel" }] as any
    const { nextState } = reduce(prev, {
      type: "go_back",
      candidateCountAfter: 80,
      remainingFilters: remaining,
    })
    expect(nextState.appliedFilters).toHaveLength(1)
    expect(nextState.candidateCount).toBe(80)
    expect(nextState.lastAction).toBe("go_back")
  })

  it("records appliedFilters and candidateCount mutations", () => {
    const prev = makeState({ appliedFilters: [{ field: "a", op: "eq" }] as any, candidateCount: 50 })
    const { mutations } = reduce(prev, {
      type: "go_back",
      candidateCountAfter: 100,
      remainingFilters: [],
    })
    expect(mutations).toHaveLength(2)
    expect(mutations[0].field).toBe("appliedFilters")
    expect(mutations[1].field).toBe("candidateCount")
  })
})

// ── stock_filter ──

describe("reduce — stock_filter", () => {
  it("updates candidateCount and sets lastAction", () => {
    const prev = makeState({ candidateCount: 50 })
    const { nextState } = reduce(prev, { type: "stock_filter", candidateCountAfter: 12 })
    expect(nextState.candidateCount).toBe(12)
    expect(nextState.lastAction).toBe("filter_by_stock")
  })

  it("records candidateCount mutation", () => {
    const prev = makeState({ candidateCount: 100 })
    const { mutations } = reduce(prev, { type: "stock_filter", candidateCountAfter: 25 })
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toEqual({ field: "candidateCount", before: 100, after: 25 })
  })
})

// ── passthrough ──

describe("reduce — passthrough", () => {
  it("applies candidateCount override", () => {
    const prev = makeState({ candidateCount: 200 })
    const { nextState, mutations } = reduce(prev, {
      type: "passthrough",
      overrides: { candidateCount: 50 },
    })
    expect(nextState.candidateCount).toBe(50)
    expect(mutations).toHaveLength(1)
  })

  it("applies multiple overrides", () => {
    const prev = makeState({ turnCount: 1, currentMode: "narrowing" as any, lastAction: undefined })
    const { nextState, mutations } = reduce(prev, {
      type: "passthrough",
      overrides: { turnCount: 5, currentMode: "recommendation", lastAction: "show_recommendation" },
    })
    expect(nextState.turnCount).toBe(5)
    expect(nextState.currentMode).toBe("recommendation")
    expect(nextState.lastAction).toBe("show_recommendation")
    expect(mutations).toHaveLength(3)
  })

  it("applies lastAskedField override", () => {
    const prev = makeState({ lastAskedField: "material" })
    const { nextState } = reduce(prev, {
      type: "passthrough",
      overrides: { lastAskedField: "diameterMm" },
    })
    expect(nextState.lastAskedField).toBe("diameterMm")
  })

  it("no-ops with empty overrides", () => {
    const prev = makeState()
    const { nextState, mutations } = reduce(prev, { type: "passthrough", overrides: {} })
    expect(mutations).toHaveLength(0)
    expect(nextState.candidateCount).toBe(prev.candidateCount)
  })
})

// ── compareReducerVsActual ──

describe("compareReducerVsActual", () => {
  it("reports match when states are identical", () => {
    const state = makeState({ candidateCount: 10, turnCount: 3, currentMode: "narrowing" as any })
    const result = compareReducerVsActual(state, state)
    expect(result.match).toBe(true)
    expect(result.differences).toHaveLength(0)
  })

  it("detects candidateCount difference", () => {
    const a = makeState({ candidateCount: 10 })
    const b = makeState({ candidateCount: 20 })
    const result = compareReducerVsActual(a, b)
    expect(result.match).toBe(false)
    expect(result.differences.some(d => d.field === "candidateCount")).toBe(true)
  })

  it("detects multiple differences", () => {
    const a = makeState({ candidateCount: 10, turnCount: 1, currentMode: "narrowing" as any })
    const b = makeState({ candidateCount: 20, turnCount: 5, currentMode: "recommendation" as any })
    const result = compareReducerVsActual(a, b)
    expect(result.match).toBe(false)
    expect(result.differences.length).toBeGreaterThanOrEqual(3)
  })

  it("compares filterCount (appliedFilters.length)", () => {
    const a = makeState({ appliedFilters: [{ field: "a", op: "eq" }] as any })
    const b = makeState({ appliedFilters: [] })
    const result = compareReducerVsActual(a, b)
    expect(result.differences.some(d => d.field === "filterCount")).toBe(true)
  })
})

// ── dryRunReduce ──

describe("dryRunReduce", () => {
  it("returns mutations and nextStateSummary", () => {
    const prev = makeState({ candidateCount: 100, turnCount: 2 })
    const result = dryRunReduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "Steel" } as any,
      candidateCountAfter: 40,
      resolvedInput: {} as any,
    })
    expect(result.mutations.length).toBeGreaterThan(0)
    expect(result.nextStateSummary.candidateCount).toBe(40)
    expect(result.nextStateSummary.turnCount).toBe(3)
    expect(result.nextStateSummary.lastAction).toBe("continue_narrowing")
  })

  it("returns filterCount in summary", () => {
    const prev = makeState({ appliedFilters: [] })
    const result = dryRunReduce(prev, {
      type: "narrow",
      filter: { field: "material", op: "eq", value: "X" } as any,
      candidateCountAfter: 10,
      resolvedInput: {} as any,
    })
    expect(result.nextStateSummary.filterCount).toBe(1)
  })
})
