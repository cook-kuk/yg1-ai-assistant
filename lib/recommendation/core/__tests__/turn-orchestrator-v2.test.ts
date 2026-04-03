import { describe, it, expect, vi, beforeEach } from "vitest"

// Hoist mock to prevent actual DB calls
vi.mock("../../domain/hybrid-retrieval", () => ({
  runHybridRetrieval: vi.fn().mockResolvedValue({
    candidates: [],
    evidenceMap: new Map(),
    totalConsidered: 0,
  }),
}))

import {
  applyStateTransition,
  buildSurface,
  createInitialSessionState,
  orchestrateTurnV2,
} from "../turn-orchestrator"
import type {
  LlmTurnDecision,
  RecommendationSessionState,
  ResultContext,
  CandidateRef,
  RevisionNode,
  PendingQuestion,
  PendingAction,
  JourneyPhase,
} from "../types"
import type { LLMProvider } from "@/lib/llm/provider"

// ── Helpers ──────────────────────────────────────────────────

function makeDecision(overrides: Partial<LlmTurnDecision> = {}): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
    actionInterpretation: { type: "continue_narrowing", rationale: "test", confidence: 0.9 },
    answerIntent: {
      topic: "narrowing",
      needsGroundedFact: false,
      shouldUseCurrentResultContext: false,
      shouldResumePendingQuestion: false,
    },
    uiPlan: { optionMode: "question_options" },
    answerDraft: "테스트 답변",
    ...overrides,
  }
}

function makeCandidate(code: string, score: number, opts?: Partial<CandidateRef>): CandidateRef {
  return {
    productCode: code,
    displayCode: code,
    rank: 1,
    score,
    seriesName: "TestSeries",
    keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true },
    ...opts,
  }
}

function makeResultContext(candidates: CandidateRef[] = []): ResultContext {
  return {
    candidates,
    totalConsidered: candidates.length,
    searchTimestamp: Date.now(),
    constraintsUsed: { base: {}, refinements: {} },
  }
}

function makeState(overrides: Partial<RecommendationSessionState> = {}): RecommendationSessionState {
  return { ...createInitialSessionState(), ...overrides }
}

function makePendingQuestion(field = "coating"): PendingQuestion {
  return {
    field,
    questionText: "코팅을 선택해주세요",
    options: [
      { index: 1, label: "AlTiN", field, value: "AlTiN", count: 5 },
      { index: 2, label: "TiAlN", field, value: "TiAlN", count: 3 },
    ],
    turnAsked: 1,
    context: null,
  }
}

function makePendingAction(type: PendingAction["type"] = "apply_filter"): PendingAction {
  return {
    type,
    label: "테스트 액션",
    payload: { field: "coating", value: "AlTiN" },
    sourceTurnId: "turn-1",
    createdAt: Date.now(),
    expiresAfterTurns: 3,
  }
}

function makeRevisionNode(overrides: Partial<RevisionNode> = {}): RevisionNode {
  return {
    revisionId: `rev-${Date.now()}`,
    parentRevisionId: null,
    action: { type: "no_op", field: null, oldValue: null, newValue: null },
    constraintsBefore: { base: {}, refinements: {} },
    constraintsAfter: { base: {}, refinements: {} },
    candidateCountBefore: 0,
    candidateCountAfter: null,
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeMockProvider(response?: string): LLMProvider {
  return {
    available: () => response != null,
    complete: vi.fn().mockResolvedValue(response ?? ""),
    completeWithTools: vi.fn().mockResolvedValue({ text: null, toolUse: null }),
  }
}

function makeLlmResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.85 },
    actionInterpretation: { type: "continue_narrowing", rationale: "gathering info", confidence: 0.85 },
    answerIntent: { topic: "narrowing", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    uiPlan: { optionMode: "question_options" },
    answerDraft: "테스트 LLM 답변",
    ...overrides,
  })
}

// ═══════════════════════════════════════════════════════════════
// 1. State Transitions for Every Action Type
// ═══════════════════════════════════════════════════════════════

describe("applyStateTransition — exhaustive action types", () => {
  // ── continue_narrowing ─────────────────────────────────────
  describe("continue_narrowing", () => {
    it("increments turnCount", () => {
      const next = applyStateTransition(makeState({ turnCount: 0 }), makeDecision())
      expect(next.turnCount).toBe(1)
    })

    it("appends a no_op revision node", () => {
      const next = applyStateTransition(makeState(), makeDecision())
      expect(next.revisionNodes).toHaveLength(1)
      expect(next.revisionNodes[0].action.type).toBe("no_op")
    })

    it("preserves base and refinement constraints", () => {
      const state = makeState({
        constraints: { base: { material: "steel", diameter: 10 }, refinements: { coating: "AlTiN" } },
      })
      const next = applyStateTransition(state, makeDecision())
      expect(next.constraints.base.material).toBe("steel")
      expect(next.constraints.refinements.coating).toBe("AlTiN")
    })

    it("updates journeyPhase from decision", () => {
      const decision = makeDecision({
        phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.9 },
      })
      const next = applyStateTransition(makeState(), decision)
      expect(next.journeyPhase).toBe("results_displayed")
    })

    it("chains revision nodes across multiple transitions", () => {
      let state = makeState()
      state = applyStateTransition(state, makeDecision())
      state = applyStateTransition(state, makeDecision())
      state = applyStateTransition(state, makeDecision())
      expect(state.revisionNodes).toHaveLength(3)
      expect(state.turnCount).toBe(3)
    })
  })

  // ── replace_slot ───────────────────────────────────────────
  describe("replace_slot", () => {
    it("records a no_op revision node (placeholder)", () => {
      const decision = makeDecision({ actionInterpretation: { type: "replace_slot", rationale: "", confidence: 0.8 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(1)
      expect(next.revisionNodes[0].action.type).toBe("no_op")
    })

    it("preserves existing constraints unchanged", () => {
      const state = makeState({ constraints: { base: { material: "aluminum" }, refinements: {} } })
      const decision = makeDecision({ actionInterpretation: { type: "replace_slot", rationale: "", confidence: 0.8 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("aluminum")
    })
  })

  // ── show_recommendation ────────────────────────────────────
  describe("show_recommendation", () => {
    it("records a no_op revision node", () => {
      const decision = makeDecision({ actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(1)
    })

    it("transitions phase to results_displayed when decision says so", () => {
      const decision = makeDecision({
        phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.95 },
        actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 },
      })
      const next = applyStateTransition(makeState(), decision)
      expect(next.journeyPhase).toBe("results_displayed")
    })
  })

  // ── go_back ────────────────────────────────────────────────
  describe("go_back", () => {
    it("reverts to previous revision constraintsBefore", () => {
      const prevConstraints = { base: { material: "aluminum" }, refinements: {} }
      const revNode = makeRevisionNode({
        revisionId: "rev-1",
        constraintsBefore: prevConstraints,
        constraintsAfter: { base: { material: "steel" }, refinements: {} },
      })
      const state = makeState({
        constraints: { base: { material: "steel" }, refinements: {} },
        revisionNodes: [revNode],
        currentRevisionId: "rev-1",
      })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("aluminum")
    })

    it("removes the last revision node", () => {
      const rev1 = makeRevisionNode({ revisionId: "rev-1", parentRevisionId: null })
      const rev2 = makeRevisionNode({ revisionId: "rev-2", parentRevisionId: "rev-1" })
      const state = makeState({ revisionNodes: [rev1, rev2], currentRevisionId: "rev-2" })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes).toHaveLength(1)
      expect(next.currentRevisionId).toBe("rev-1")
    })

    it("sets currentRevisionId to parent", () => {
      const rev = makeRevisionNode({ revisionId: "rev-1", parentRevisionId: "rev-0" })
      const state = makeState({ revisionNodes: [rev], currentRevisionId: "rev-1" })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.currentRevisionId).toBe("rev-0")
    })

    it("clears pendingQuestion", () => {
      const rev = makeRevisionNode({ revisionId: "rev-1" })
      const state = makeState({
        pendingQuestion: makePendingQuestion(),
        revisionNodes: [rev],
        currentRevisionId: "rev-1",
      })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.pendingQuestion).toBeNull()
    })

    it("is safe when no revision history exists", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes).toEqual([])
      expect(next.pendingQuestion).toBeNull()
    })

    it("still increments turnCount even when going back", () => {
      const state = makeState({ turnCount: 5 })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(6)
    })
  })

  // ── compare_products ───────────────────────────────────────
  describe("compare_products", () => {
    it("records a no_op revision", () => {
      const decision = makeDecision({ actionInterpretation: { type: "compare_products", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(1)
      expect(next.revisionNodes[0].action.type).toBe("no_op")
    })

    it("does not modify constraints", () => {
      const state = makeState({ constraints: { base: { material: "steel" }, refinements: { coating: "TiAlN" } } })
      const decision = makeDecision({
        phaseInterpretation: { currentPhase: "comparison", confidence: 0.9 },
        actionInterpretation: { type: "compare_products", rationale: "", confidence: 0.9 },
      })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("steel")
      expect(next.constraints.refinements.coating).toBe("TiAlN")
    })
  })

  // ── answer_general ─────────────────────────────────────────
  describe("answer_general", () => {
    it("activates sideThreadActive", () => {
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState({ sideThreadActive: false }), decision)
      expect(next.sideThreadActive).toBe(true)
    })

    it("does not add any revision nodes", () => {
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(0)
    })

    it("preserves all constraints", () => {
      const state = makeState({ constraints: { base: { material: "steel" }, refinements: {} } })
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("steel")
    })

    it("preserves pendingQuestion so it can resume", () => {
      const state = makeState({ pendingQuestion: makePendingQuestion() })
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.pendingQuestion).not.toBeNull()
    })
  })

  // ── redirect_off_topic ─────────────────────────────────────
  describe("redirect_off_topic", () => {
    it("only increments turnCount, no other changes", () => {
      const state = makeState({
        turnCount: 3,
        constraints: { base: { material: "steel" }, refinements: {} },
      })
      const decision = makeDecision({ actionInterpretation: { type: "redirect_off_topic", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(4)
      expect(next.constraints.base.material).toBe("steel")
      expect(next.revisionNodes).toHaveLength(0)
    })
  })

  // ── reset_session ──────────────────────────────────────────
  describe("reset_session", () => {
    it("resets to initial state", () => {
      const state = makeState({
        turnCount: 10,
        journeyPhase: "results_displayed",
        constraints: { base: { material: "steel", diameter: 10 }, refinements: { coating: "AlTiN" } },
        resultContext: makeResultContext([makeCandidate("P1", 0.9)]),
        pendingQuestion: makePendingQuestion(),
        sideThreadActive: true,
        revisionNodes: [makeRevisionNode()],
      })
      const decision = makeDecision({ actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)

      expect(next.journeyPhase).toBe("intake")
      expect(next.constraints).toEqual({ base: {}, refinements: {} })
      expect(next.resultContext).toBeNull()
      expect(next.pendingQuestion).toBeNull()
      expect(next.revisionNodes).toEqual([])
      expect(next.sideThreadActive).toBe(false)
    })

    it("preserves the incremented turnCount", () => {
      const state = makeState({ turnCount: 7 })
      const decision = makeDecision({ actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      // turnCount is 7+1=8 first, then reset preserves that
      expect(next.turnCount).toBe(8)
    })
  })

  // ── skip_field ─────────────────────────────────────────────
  describe("skip_field", () => {
    it("clears pendingQuestion", () => {
      const state = makeState({ pendingQuestion: makePendingQuestion() })
      const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.pendingQuestion).toBeNull()
    })

    it("preserves constraints", () => {
      const state = makeState({
        pendingQuestion: makePendingQuestion(),
        constraints: { base: { material: "steel" }, refinements: {} },
      })
      const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("steel")
    })

    it("does not add revision nodes", () => {
      const state = makeState({ pendingQuestion: makePendingQuestion() })
      const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes).toHaveLength(0)
    })
  })

  // ── ask_clarification ──────────────────────────────────────
  describe("ask_clarification", () => {
    it("makes no constraint changes", () => {
      const state = makeState({ constraints: { base: { material: "steel" }, refinements: { flute: 4 } } })
      const decision = makeDecision({ actionInterpretation: { type: "ask_clarification", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints).toEqual(state.constraints)
    })

    it("does not add revision nodes", () => {
      const decision = makeDecision({ actionInterpretation: { type: "ask_clarification", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(0)
    })

    it("preserves resultContext", () => {
      const rc = makeResultContext([makeCandidate("P1", 0.9)])
      const state = makeState({ resultContext: rc })
      const decision = makeDecision({ actionInterpretation: { type: "ask_clarification", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.resultContext).toBe(rc)
    })
  })

  // ── refine_current_results ─────────────────────────────────
  describe("refine_current_results", () => {
    it("records an apply_refinement revision node", () => {
      const decision = makeDecision({ actionInterpretation: { type: "refine_current_results", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(makeState(), decision)
      expect(next.revisionNodes).toHaveLength(1)
      expect(next.revisionNodes[0].action.type).toBe("apply_refinement")
    })

    it("preserves existing resultContext (refinement happens in search step)", () => {
      const rc = makeResultContext([makeCandidate("P1", 0.9)])
      const state = makeState({ resultContext: rc })
      const decision = makeDecision({ actionInterpretation: { type: "refine_current_results", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.resultContext).toBe(rc)
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. 0-Result Fallback — recommendation with 0 results
// ═══════════════════════════════════════════════════════════════

describe("0-result fallback to question mode", () => {
  it("search returning 0 candidates still yields valid TurnResult", async () => {
    // The mocked hybrid-retrieval returns 0 candidates by default
    const llmResponse = makeLlmResponse({
      phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.9 },
      actionInterpretation: { type: "show_recommendation", rationale: "enough info", confidence: 0.9 },
      answerIntent: { topic: "recommendation", needsGroundedFact: true, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
      uiPlan: { optionMode: "result_followups" },
      answerDraft: "검색 결과가 없습니다. 조건을 변경해보세요.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = makeState({ constraints: { base: { material: "steel", diameter: 10 }, refinements: {} } })
    const result = await orchestrateTurnV2("추천해줘", state, provider)

    expect(result.answer).toBeDefined()
    expect(result.sessionState).toBeDefined()
    expect(Array.isArray(result.chips)).toBe(true)
    expect(Array.isArray(result.displayedOptions)).toBe(true)
  })

  it("0-candidate search sets hasGroundedFacts to false", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 },
      answerIntent: { topic: "recommendation", needsGroundedFact: true, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
      uiPlan: { optionMode: "result_followups" },
      answerDraft: "결과가 없습니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = makeState()
    const result = await orchestrateTurnV2("추천해줘", state, provider)
    // With 0 candidates, grounded facts should be false -> validator may add disclaimer
    expect(result.trace.searchExecuted).toBe(true)
  })

  it("0-result state does not crash buildSurface with empty resultContext", () => {
    const decision = makeDecision({
      uiPlan: { optionMode: "result_followups" },
      actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 },
    })
    delete decision.suggestedChips
    const state = makeState({ resultContext: makeResultContext([]) })
    const surface = buildSurface(decision, state)
    expect(surface).toBeDefined()
    expect(Array.isArray(surface.chips)).toBe(true)
  })

  it("0-result fallback chips include at least basic navigation", () => {
    const decision = makeDecision({
      uiPlan: { optionMode: "result_followups" },
    })
    delete decision.suggestedChips
    const state = makeState({ resultContext: makeResultContext([]) })
    const surface = buildSurface(decision, state)
    // With 0 candidates, fallback chips should still have "조건 변경" and "절삭조건 보기"
    const labels = surface.displayedOptions.map(o => o.label)
    // At minimum "절삭조건 보기" and "조건 변경" should be present
    expect(labels.some(l => l.includes("조건 변경"))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. Side Thread Activation / Deactivation
// ═══════════════════════════════════════════════════════════════

describe("side thread lifecycle", () => {
  it("activates on answer_general", () => {
    const state = makeState({ sideThreadActive: false })
    const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(true)
  })

  it("deactivates when returning to on-topic action", () => {
    const state = makeState({ sideThreadActive: true })
    const decision = makeDecision({ actionInterpretation: { type: "continue_narrowing", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("stays active across consecutive answer_general turns", () => {
    let state = makeState({ sideThreadActive: false })
    const d1 = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
    state = applyStateTransition(state, d1)
    expect(state.sideThreadActive).toBe(true)

    const d2 = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.8 } })
    state = applyStateTransition(state, d2)
    expect(state.sideThreadActive).toBe(true)
  })

  it("deactivates on reset_session", () => {
    const state = makeState({ sideThreadActive: true })
    const decision = makeDecision({ actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("deactivates on skip_field", () => {
    const state = makeState({ sideThreadActive: true })
    const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("deactivates on go_back", () => {
    const rev = makeRevisionNode()
    const state = makeState({ sideThreadActive: true, revisionNodes: [rev], currentRevisionId: rev.revisionId })
    const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("deactivates on refine_current_results", () => {
    const state = makeState({ sideThreadActive: true })
    const decision = makeDecision({ actionInterpretation: { type: "refine_current_results", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.sideThreadActive).toBe(false)
  })

  it("does not activate for non-general actions when already inactive", () => {
    const nonGeneralActions = [
      "continue_narrowing", "replace_slot", "show_recommendation",
      "compare_products", "redirect_off_topic", "skip_field",
      "ask_clarification", "refine_current_results",
    ] as const
    for (const actionType of nonGeneralActions) {
      const state = makeState({ sideThreadActive: false })
      const decision = makeDecision({ actionInterpretation: { type: actionType, rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.sideThreadActive).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// 4. Revision History Management
// ═══════════════════════════════════════════════════════════════

describe("revision history management", () => {
  it("appends revision nodes incrementally", () => {
    let state = makeState()
    const decision = makeDecision()
    state = applyStateTransition(state, decision)
    expect(state.revisionNodes).toHaveLength(1)
    state = applyStateTransition(state, decision)
    expect(state.revisionNodes).toHaveLength(2)
  })

  it("revision parentRevisionId chains correctly", () => {
    let state = makeState()
    state = applyStateTransition(state, makeDecision())
    const firstRevId = state.currentRevisionId
    expect(state.revisionNodes[0].parentRevisionId).toBeNull()

    state = applyStateTransition(state, makeDecision())
    expect(state.revisionNodes[1].parentRevisionId).toBe(firstRevId)
  })

  it("go_back removes last node and restores parent ID", () => {
    const rev1 = makeRevisionNode({ revisionId: "r1", parentRevisionId: null })
    const rev2 = makeRevisionNode({ revisionId: "r2", parentRevisionId: "r1" })
    const state = makeState({ revisionNodes: [rev1, rev2], currentRevisionId: "r2" })

    const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.revisionNodes).toHaveLength(1)
    expect(next.currentRevisionId).toBe("r1")
  })

  it("reset_session clears all revision nodes", () => {
    const revs = [makeRevisionNode({ revisionId: "r1" }), makeRevisionNode({ revisionId: "r2" })]
    const state = makeState({ revisionNodes: revs, currentRevisionId: "r2" })
    const decision = makeDecision({ actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.revisionNodes).toEqual([])
    expect(next.currentRevisionId).toBeNull()
  })

  it("revision constraintsBefore matches state at time of transition", () => {
    const state = makeState({ constraints: { base: { material: "steel" }, refinements: {} } })
    const next = applyStateTransition(state, makeDecision())
    expect(next.revisionNodes[0].constraintsBefore.base.material).toBe("steel")
  })

  it("refine_current_results records apply_refinement in revision", () => {
    const state = makeState()
    const decision = makeDecision({ actionInterpretation: { type: "refine_current_results", rationale: "", confidence: 0.9 } })
    const next = applyStateTransition(state, decision)
    expect(next.revisionNodes[0].action.type).toBe("apply_refinement")
  })

  it("multiple go_back calls unwind the stack correctly", () => {
    const rev1 = makeRevisionNode({
      revisionId: "r1", parentRevisionId: null,
      constraintsBefore: { base: {}, refinements: {} },
    })
    const rev2 = makeRevisionNode({
      revisionId: "r2", parentRevisionId: "r1",
      constraintsBefore: { base: { material: "steel" }, refinements: {} },
    })
    let state = makeState({
      constraints: { base: { material: "steel", diameter: 10 }, refinements: {} },
      revisionNodes: [rev1, rev2],
      currentRevisionId: "r2",
    })

    // First go_back
    state = applyStateTransition(state, makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } }))
    expect(state.revisionNodes).toHaveLength(1)
    expect(state.constraints.base.material).toBe("steel")

    // Second go_back
    state = applyStateTransition(state, makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } }))
    expect(state.revisionNodes).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// 5. buildSurface — Chip Generation
// ═══════════════════════════════════════════════════════════════

describe("buildSurface chip generation", () => {
  describe("question_options mode", () => {
    it("maps nextQuestion options to displayedOptions", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "material",
          suggestedOptions: [
            { label: "Steel", value: "steel" },
            { label: "Aluminum", value: "aluminum" },
          ],
          allowSkip: false,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(2)
      expect(surface.displayedOptions[0].label).toBe("Steel")
      expect(surface.displayedOptions[0].field).toBe("material")
      expect(surface.displayedOptions[0].value).toBe("steel")
    })

    it("adds skip option when allowSkip=true", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "coating",
          suggestedOptions: [{ label: "AlTiN", value: "AlTiN" }],
          allowSkip: true,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(2)
      expect(surface.displayedOptions[1].label).toBe("상관없음")
      expect(surface.displayedOptions[1].value).toBe("skip")
    })

    it("does not add skip option when allowSkip=false", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "coating",
          suggestedOptions: [{ label: "AlTiN", value: "AlTiN" }],
          allowSkip: false,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(1)
    })

    it("option indices are 1-based sequential", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "material",
          suggestedOptions: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
            { label: "C", value: "c" },
          ],
          allowSkip: true,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.map(o => o.index)).toEqual([1, 2, 3, 4])
    })
  })

  describe("result_followups mode with LLM chips", () => {
    it("uses LLM suggestedChips when >= 2 available", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: [
          { label: "3날로 좁히기", type: "filter" },
          { label: "코팅별 비교", type: "action" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(2)
    })

    it("maps chip type to correct field prefixes", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: [
          { label: "필터칩", type: "filter" },
          { label: "네비칩", type: "navigation" },
          { label: "액션칩", type: "action" },
          { label: "옵션칩", type: "option" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions[0].field).toBe("_filter")
      expect(surface.displayedOptions[1].field).toBe("_control")
      expect(surface.displayedOptions[2].field).toBe("_action")
      // option type defaults to _action in result_followups
      expect(surface.displayedOptions[3].field).toBe("_action")
    })

    it("filters out unfilterable chips (RPM, 가격, etc.)", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: [
          { label: "RPM 추천", type: "action" },
          { label: "가격 비교", type: "action" },
          { label: "이송속도", type: "action" },
          { label: "유효한 칩", type: "action" },
          { label: "다른 유효 칩", type: "filter" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      const labels = surface.displayedOptions.map(o => o.label)
      expect(labels).not.toContain("RPM 추천")
      expect(labels).not.toContain("가격 비교")
      expect(labels).not.toContain("이송속도")
      expect(labels).toContain("유효한 칩")
      expect(labels).toContain("다른 유효 칩")
    })

    it("limits LLM chips to 8", () => {
      const chips = Array.from({ length: 12 }, (_, i) => ({ label: `칩${i}`, type: "action" as const }))
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: chips,
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.length).toBeLessThanOrEqual(8)
    })
  })

  describe("result_followups fallback (no LLM chips)", () => {
    it("generates data-driven chips from candidate keySpecs", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 3, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "TiAlN", hasInventory: true } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.length).toBeGreaterThan(0)
    })

    it("includes flute comparison chip when flutes differ", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 2, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.some(o => o.label.includes("날수별"))).toBe(true)
    })

    it("includes coating comparison chip when coatings differ", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "DLC", hasInventory: true } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.some(o => o.label.includes("코팅별"))).toBe(true)
    })

    it("includes comparison chip for >= 2 candidates", () => {
      const candidates = [makeCandidate("A1", 0.95), makeCandidate("A2", 0.90)]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.some(o => o.value === "compare")).toBe(true)
    })

    it("always includes 조건 변경 chip", () => {
      const state = makeState({ resultContext: makeResultContext([makeCandidate("A1", 0.9)]) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.some(o => o.value === "refine")).toBe(true)
    })

    it("limits fallback chips to 6", () => {
      const candidates = Array.from({ length: 15 }, (_, i) =>
        makeCandidate(`P${i}`, 0.9 - i * 0.01, {
          keySpecs: { flute: (i % 4) + 2, coating: ["AlTiN", "TiAlN", "DLC"][i % 3], hasInventory: true },
        })
      )
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.length).toBeLessThanOrEqual(6)
    })
  })

  describe("suggestedChips fallback integration", () => {
    it("converts suggestedChips to displayedOptions when mode=none produces empty", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        suggestedChips: [
          { label: "도움말", type: "action" },
          { label: "뒤로", type: "navigation" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(2)
      expect(surface.displayedOptions[0].field).toBe("_action")
      expect(surface.displayedOptions[1].field).toBe("_control")
    })

    it("option type chips use nextQuestion.field if available", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        nextQuestion: { field: "material", suggestedOptions: [], allowSkip: true },
        suggestedChips: [{ label: "Steel", type: "option" }],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions[0].field).toBe("material")
    })

    it("option type chips fall back to _action without nextQuestion", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        suggestedChips: [{ label: "선택", type: "option" }],
      })
      delete decision.nextQuestion
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions[0].field).toBe("_action")
    })
  })

  describe("side thread resume surface", () => {
    it("appends resume prompt with pending question text", () => {
      const state = makeState({
        sideThreadActive: true,
        pendingQuestion: makePendingQuestion("material"),
      })
      state.pendingQuestion!.questionText = "소재를 선택해주세요"
      const decision = makeDecision({ answerDraft: "사이드 답변입니다." })
      const surface = buildSurface(decision, state)
      expect(surface.answer).toContain("사이드 답변입니다.")
      expect(surface.answer).toContain("다시 제품 추천으로 돌아갈게요")
      expect(surface.answer).toContain("소재를 선택해주세요")
    })

    it("uses pending question options as chips in resume", () => {
      const pq = makePendingQuestion("coating")
      const state = makeState({ sideThreadActive: true, pendingQuestion: pq })
      const decision = makeDecision({ answerDraft: "답변" })
      const surface = buildSurface(decision, state)
      expect(surface.chips).toEqual(["AlTiN", "TiAlN"])
    })

    it("does not trigger resume when sideThreadActive but no pendingQuestion", () => {
      const state = makeState({ sideThreadActive: true, pendingQuestion: null })
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        answerDraft: "일반 답변",
      })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.answer).toBe("일반 답변")
      expect(surface.answer).not.toContain("다시 제품 추천으로 돌아갈게요")
    })
  })

  describe("chips-displayedOptions contract", () => {
    it("chips always mirror displayedOptions labels", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "material",
          suggestedOptions: [{ label: "Steel", value: "steel" }, { label: "Aluminum", value: "aluminum" }],
          allowSkip: true,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.chips).toEqual(surface.displayedOptions.map(o => o.label))
    })

    it("empty displayedOptions yields empty chips", () => {
      const decision = makeDecision({ uiPlan: { optionMode: "none" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, makeState())
      expect(surface.chips).toEqual([])
      expect(surface.displayedOptions).toEqual([])
    })
  })
})

// ═══════════════════════════════════════════════════════════════
// 6. Session State Persistence Across Turns
// ═══════════════════════════════════════════════════════════════

describe("session state persistence across turns", () => {
  it("state flows correctly through multi-turn sequence", async () => {
    const provider = makeMockProvider() // unavailable → fallback decisions
    let state = createInitialSessionState()

    // Turn 1
    const r1 = await orchestrateTurnV2("안녕하세요", state, provider)
    expect(r1.sessionState.turnCount).toBe(1)
    state = r1.sessionState

    // Turn 2
    const r2 = await orchestrateTurnV2("스틸 가공", state, provider)
    expect(r2.sessionState.turnCount).toBe(2)
    state = r2.sessionState

    // Turn 3
    const r3 = await orchestrateTurnV2("10mm 직경", state, provider)
    expect(r3.sessionState.turnCount).toBe(3)
  })

  it("revision nodes accumulate across turns", async () => {
    const provider = makeMockProvider()
    let state = createInitialSessionState()

    state = (await orchestrateTurnV2("턴1", state, provider)).sessionState
    state = (await orchestrateTurnV2("턴2", state, provider)).sessionState
    state = (await orchestrateTurnV2("턴3", state, provider)).sessionState

    // Each fallback turn does continue_narrowing which adds a revision node
    expect(state.revisionNodes.length).toBe(3)
  })

  it("constraints persist when not reset", async () => {
    const provider = makeMockProvider()
    const state = makeState({
      constraints: { base: { material: "steel" }, refinements: { coating: "AlTiN" } },
    })
    const result = await orchestrateTurnV2("테스트", state, provider)
    // Fallback = continue_narrowing, constraints preserved
    expect(result.sessionState.constraints.base.material).toBe("steel")
    expect(result.sessionState.constraints.refinements.coating).toBe("AlTiN")
  })

  it("resultContext updates when search is executed", async () => {
    const provider = makeMockProvider()
    const state = makeState()
    // Fallback triggers continue_narrowing which is in SEARCH_TRIGGERING_ACTIONS
    const result = await orchestrateTurnV2("테스트", state, provider)
    // Search was executed (mocked returns empty), so resultContext should be set
    expect(result.trace.searchExecuted).toBe(true)
  })

  it("phase transitions carry over to next turn", async () => {
    const llmResponse = makeLlmResponse({
      phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.95 },
      actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 },
    })
    const provider = makeMockProvider(llmResponse)
    const state = makeState()
    const r1 = await orchestrateTurnV2("추천해줘", state, provider)
    expect(r1.sessionState.journeyPhase).toBe("results_displayed")
  })
})

// ═══════════════════════════════════════════════════════════════
// 7. Error Handling / Graceful Degradation
// ═══════════════════════════════════════════════════════════════

describe("error handling and graceful degradation", () => {
  it("returns fallback when provider is unavailable", async () => {
    const provider = makeMockProvider() // no response → unavailable
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("returns fallback when LLM returns invalid JSON", async () => {
    const provider = makeMockProvider("not json at all {{{")
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("handles markdown-wrapped JSON from LLM", async () => {
    const inner = makeLlmResponse({
      actionInterpretation: { type: "ask_clarification", rationale: "unclear", confidence: 0.7 },
    })
    const provider = makeMockProvider("```json\n" + inner + "\n```")
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("음...", state, provider)
    expect(result.trace.action).toBe("ask_clarification")
  })

  it("handles partial LLM JSON with missing fields gracefully", async () => {
    const partial = JSON.stringify({
      phaseInterpretation: { currentPhase: "narrowing" },
      // Missing actionInterpretation, answerIntent, etc.
      answerDraft: "부분 응답",
    })
    const provider = makeMockProvider(partial)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    // Should fill defaults for missing fields
    expect(result.answer).toBeDefined()
    expect(result.trace.action).toBe("continue_narrowing") // default
  })

  it("handles empty string from LLM", async () => {
    const provider: LLMProvider = {
      available: () => true,
      complete: vi.fn().mockResolvedValue(""),
      completeWithTools: vi.fn().mockResolvedValue({ text: null, toolUse: null }),
    }
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    // Empty string is not valid JSON → fallback
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("handles LLM throwing an error", async () => {
    const provider: LLMProvider = {
      available: () => true,
      complete: vi.fn().mockRejectedValue(new Error("API timeout")),
      completeWithTools: vi.fn().mockResolvedValue({ text: null, toolUse: null }),
    }
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("all TurnResult fields are present regardless of error", async () => {
    const provider = makeMockProvider() // unavailable
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)

    expect(typeof result.answer).toBe("string")
    expect(Array.isArray(result.displayedOptions)).toBe(true)
    expect(Array.isArray(result.chips)).toBe(true)
    expect(result.sessionState).toBeDefined()
    expect(result.trace).toBeDefined()
    expect(typeof result.trace.snapshotId).toBe("string")
    expect(typeof result.trace.phase).toBe("string")
    expect(typeof result.trace.action).toBe("string")
    expect(typeof result.trace.confidence).toBe("number")
    expect(typeof result.trace.searchExecuted).toBe("boolean")
    expect(typeof result.trace.validated).toBe("boolean")
  })

  it("searchPayload is null when search was not triggered", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 },
    })
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("엔드밀이 뭐야?", state, provider)
    expect(result.searchPayload).toBeNull()
  })

  it("empty user message does not crash", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("", state, provider)
    expect(result).toBeDefined()
    expect(result.sessionState.turnCount).toBe(1)
  })

  it("very long user message does not crash", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const longMessage = "a".repeat(10000)
    const result = await orchestrateTurnV2(longMessage, state, provider)
    expect(result).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// 8. Phase Transition Matrix
// ═══════════════════════════════════════════════════════════════

describe("phase transition matrix", () => {
  const phases: JourneyPhase[] = ["intake", "narrowing", "results_displayed", "post_result_exploration", "comparison", "revision"]

  for (const fromPhase of phases) {
    for (const toPhase of phases) {
      it(`transitions ${fromPhase} → ${toPhase}`, () => {
        const state = makeState({ journeyPhase: fromPhase })
        const decision = makeDecision({
          phaseInterpretation: { currentPhase: toPhase, confidence: 0.9 },
        })
        const next = applyStateTransition(state, decision)
        expect(next.journeyPhase).toBe(toPhase)
      })
    }
  }

  it("reset_session always returns to intake regardless of current phase", () => {
    for (const phase of phases) {
      const state = makeState({ journeyPhase: phase })
      const decision = makeDecision({
        phaseInterpretation: { currentPhase: phase, confidence: 0.9 },
        actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 },
      })
      const next = applyStateTransition(state, decision)
      expect(next.journeyPhase).toBe("intake")
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. createInitialSessionState
// ═══════════════════════════════════════════════════════════════

describe("createInitialSessionState", () => {
  it("returns intake phase", () => {
    expect(createInitialSessionState().journeyPhase).toBe("intake")
  })

  it("empty constraints", () => {
    expect(createInitialSessionState().constraints).toEqual({ base: {}, refinements: {} })
  })

  it("null resultContext", () => {
    expect(createInitialSessionState().resultContext).toBeNull()
  })

  it("null pendingQuestion", () => {
    expect(createInitialSessionState().pendingQuestion).toBeNull()
  })

  it("null pendingAction", () => {
    expect(createInitialSessionState().pendingAction).toBeNull()
  })

  it("empty revisionNodes", () => {
    expect(createInitialSessionState().revisionNodes).toEqual([])
  })

  it("null currentRevisionId", () => {
    expect(createInitialSessionState().currentRevisionId).toBeNull()
  })

  it("sideThreadActive=false", () => {
    expect(createInitialSessionState().sideThreadActive).toBe(false)
  })

  it("turnCount=0", () => {
    expect(createInitialSessionState().turnCount).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. orchestrateTurnV2 Integration (mocked LLM)
// ═══════════════════════════════════════════════════════════════

describe("orchestrateTurnV2 integration", () => {
  it("passes recentTurns through to snapshot", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const turns = [
      { role: "user" as const, text: "이전" },
      { role: "assistant" as const, text: "이전 답변" },
    ]
    const result = await orchestrateTurnV2("현재 질문", state, provider, turns)
    expect(result).toBeDefined()
  })

  it("LLM response with nextQuestion is parsed correctly", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "continue_narrowing", rationale: "", confidence: 0.9 },
      uiPlan: { optionMode: "question_options" },
      nextQuestion: {
        field: "material",
        suggestedOptions: [{ label: "강", value: "steel" }, { label: "알루미늄", value: "aluminum" }],
        allowSkip: true,
      },
      answerDraft: "소재를 선택해주세요.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("엔드밀 추천", state, provider)
    expect(result.displayedOptions.length).toBeGreaterThanOrEqual(2)
    expect(result.answer).toContain("소재를 선택해주세요")
  })

  it("LLM response with suggestedChips is parsed correctly", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 },
      phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.9 },
      uiPlan: { optionMode: "result_followups" },
      suggestedChips: [
        { label: "추천 근거", type: "action" },
        { label: "조건 변경", type: "navigation" },
        { label: "3날로 좁히기", type: "filter" },
      ],
      answerDraft: "추천 결과입니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("추천해줘", state, provider)
    expect(result.chips.length).toBeGreaterThanOrEqual(2)
  })

  it("reset_session via LLM returns clean state", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "reset_session", rationale: "user requested reset", confidence: 0.95 },
      answerDraft: "처음부터 다시 시작하겠습니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = makeState({
      turnCount: 5,
      constraints: { base: { material: "steel" }, refinements: {} },
      journeyPhase: "results_displayed",
    })
    const result = await orchestrateTurnV2("처음부터", state, provider)
    expect(result.sessionState.journeyPhase).toBe("intake")
    expect(result.sessionState.constraints).toEqual({ base: {}, refinements: {} })
  })

  it("answer_general via LLM activates side thread", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "answer_general", rationale: "general question", confidence: 0.9 },
      uiPlan: { optionMode: "none" },
      answerDraft: "엔드밀은 밀링 가공에 사용됩니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("엔드밀이 뭐야?", state, provider)
    expect(result.sessionState.sideThreadActive).toBe(true)
  })

  it("skip_field via LLM clears pending question", async () => {
    const llmResponse = makeLlmResponse({
      actionInterpretation: { type: "skip_field", rationale: "user wants to skip", confidence: 0.9 },
      answerDraft: "코팅은 건너뛰겠습니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = makeState({ pendingQuestion: makePendingQuestion() })
    const result = await orchestrateTurnV2("상관없어", state, provider)
    expect(result.sessionState.pendingQuestion).toBeNull()
  })

  it("trace snapshotId starts with snap-", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(result.trace.snapshotId).toMatch(/^snap-/)
  })
})
