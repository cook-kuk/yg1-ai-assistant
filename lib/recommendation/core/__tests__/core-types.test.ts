import { describe, it, expect } from "vitest"
import { createInitialSessionState, orchestrateTurnV2 } from "../turn-orchestrator"
import {
  setBaseConstraint,
  replaceBaseConstraint,
  applyRefinement,
  removeRefinement,
  createRevisionNode,
} from "../constraint-helpers"
import type { RecommendationSessionState, ResolvedAction } from "../types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

// Stub LLM provider for testing
const stubProvider: LLMProvider = {
  complete: async () => "",
  completeWithTools: async () => ({ text: null, toolUse: null }),
  available: () => true,
}

describe("createInitialSessionState", () => {
  it("returns a valid initial state with all required fields", () => {
    const state = createInitialSessionState()

    expect(state.journeyPhase).toBe("intake")
    expect(state.constraints).toEqual({ base: {}, refinements: {} })
    expect(state.resultContext).toBeNull()
    expect(state.pendingQuestion).toBeNull()
    expect(state.pendingAction).toBeNull()
    expect(state.revisionNodes).toEqual([])
    expect(state.currentRevisionId).toBeNull()
    expect(state.sideThreadActive).toBe(false)
    expect(state.turnCount).toBe(0)
  })

  it("returns a new object each time (no shared references)", () => {
    const a = createInitialSessionState()
    const b = createInitialSessionState()
    expect(a).not.toBe(b)
    expect(a.constraints).not.toBe(b.constraints)
  })
})

describe("setBaseConstraint", () => {
  it("adds a field to base constraints", () => {
    const state = createInitialSessionState()
    const next = setBaseConstraint(state, "diameter", 10)

    expect(next.constraints.base["diameter"]).toBe(10)
  })

  it("does not overwrite an existing base constraint", () => {
    const state = createInitialSessionState()
    const withDiameter = setBaseConstraint(state, "diameter", 10)
    const attempted = setBaseConstraint(withDiameter, "diameter", 20)

    expect(attempted.constraints.base["diameter"]).toBe(10)
  })

  it("does not mutate the original state", () => {
    const state = createInitialSessionState()
    setBaseConstraint(state, "material", "carbide")

    expect(state.constraints.base["material"]).toBeUndefined()
  })
})

describe("replaceBaseConstraint", () => {
  it("replaces an existing base constraint", () => {
    const state = createInitialSessionState()
    const withDiameter = setBaseConstraint(state, "diameter", 10)
    const replaced = replaceBaseConstraint(withDiameter, "diameter", 20)

    expect(replaced.constraints.base["diameter"]).toBe(20)
  })

  it("sets a new field if it does not exist", () => {
    const state = createInitialSessionState()
    const next = replaceBaseConstraint(state, "coating", "AlTiN")

    expect(next.constraints.base["coating"]).toBe("AlTiN")
  })
})

describe("applyRefinement", () => {
  it("adds a refinement constraint", () => {
    const state = createInitialSessionState()
    const next = applyRefinement(state, "fluteCount", 4)

    expect(next.constraints.refinements["fluteCount"]).toBe(4)
  })

  it("overwrites an existing refinement", () => {
    const state = createInitialSessionState()
    const a = applyRefinement(state, "fluteCount", 4)
    const b = applyRefinement(a, "fluteCount", 6)

    expect(b.constraints.refinements["fluteCount"]).toBe(6)
  })
})

describe("removeRefinement", () => {
  it("removes an existing refinement", () => {
    const state = createInitialSessionState()
    const withRefinement = applyRefinement(state, "coating", "Diamond")
    const removed = removeRefinement(withRefinement, "coating")

    expect(removed.constraints.refinements["coating"]).toBeUndefined()
  })

  it("returns the same state if field does not exist", () => {
    const state = createInitialSessionState()
    const result = removeRefinement(state, "nonexistent")

    expect(result).toBe(state)
  })
})

describe("createRevisionNode", () => {
  it("creates a node with correct parentRevisionId (null for first)", () => {
    const state = createInitialSessionState()
    const action: ResolvedAction = {
      type: "set_base_constraint",
      field: "diameter",
      oldValue: null,
      newValue: 10,
    }
    const next = createRevisionNode(state, action)

    expect(next.revisionNodes).toHaveLength(1)
    expect(next.revisionNodes[0].parentRevisionId).toBeNull()
    expect(next.revisionNodes[0].action).toEqual(action)
    expect(next.currentRevisionId).toBe(next.revisionNodes[0].revisionId)
  })

  it("chains revision nodes with correct parent references", () => {
    const state = createInitialSessionState()
    const action1: ResolvedAction = {
      type: "set_base_constraint",
      field: "diameter",
      oldValue: null,
      newValue: 10,
    }
    const action2: ResolvedAction = {
      type: "apply_refinement",
      field: "coating",
      oldValue: null,
      newValue: "AlTiN",
    }

    const afterFirst = createRevisionNode(state, action1)
    const afterSecond = createRevisionNode(afterFirst, action2)

    expect(afterSecond.revisionNodes).toHaveLength(2)
    expect(afterSecond.revisionNodes[1].parentRevisionId).toBe(afterFirst.currentRevisionId)
  })

  it("applies the action to constraints", () => {
    const state = createInitialSessionState()
    const action: ResolvedAction = {
      type: "apply_refinement",
      field: "fluteCount",
      oldValue: null,
      newValue: 4,
    }
    const next = createRevisionNode(state, action)

    expect(next.constraints.refinements["fluteCount"]).toBe(4)
  })
})

describe("orchestrateTurnV2", () => {
  it("completes a turn without error using stub LLM", async () => {
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("I need a 10mm endmill", state, stubProvider)

    expect(result.answer).toBeDefined()
    expect(result.chips).toBeInstanceOf(Array)
    expect(result.displayedOptions).toBeInstanceOf(Array)
    expect(result.sessionState).toBeDefined()
    expect(result.sessionState.turnCount).toBe(1)
    expect(result.trace).toBeDefined()
    expect(result.trace.snapshotId).toMatch(/^snap-/)
  })

  it("increments turnCount on each call", async () => {
    const state = createInitialSessionState()
    const r1 = await orchestrateTurnV2("hello", state, stubProvider)
    const r2 = await orchestrateTurnV2("10mm", r1.sessionState, stubProvider)

    expect(r1.sessionState.turnCount).toBe(1)
    expect(r2.sessionState.turnCount).toBe(2)
  })
})

describe("surface contract", () => {
  it("chips derive from displayedOptions (empty case)", async () => {
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("hello", state, stubProvider)

    // Every chip must correspond to a displayedOption label
    for (const chip of result.chips) {
      expect(result.displayedOptions.some((opt) => opt.label === chip)).toBe(true)
    }

    // In the stub, both should be empty
    expect(result.chips).toHaveLength(0)
    expect(result.displayedOptions).toHaveLength(0)
  })
})
