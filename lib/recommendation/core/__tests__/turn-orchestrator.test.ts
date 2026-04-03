import { describe, it, expect, vi } from "vitest"

// Hoist mock to prevent actual DB calls in orchestrateTurnV2 integration tests
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

function makeMockProvider(response?: string): LLMProvider {
  return {
    available: () => response != null,
    complete: vi.fn().mockResolvedValue(response ?? ""),
    completeWithTools: vi.fn().mockResolvedValue({ text: null, toolUse: null }),
  }
}

// ── createInitialSessionState ──────────────────────────────

describe("createInitialSessionState", () => {
  it("returns intake phase with empty constraints", () => {
    const state = createInitialSessionState()
    expect(state.journeyPhase).toBe("intake")
    expect(state.constraints).toEqual({ base: {}, refinements: {} })
    expect(state.turnCount).toBe(0)
  })

  it("starts with no pending question or action", () => {
    const state = createInitialSessionState()
    expect(state.pendingQuestion).toBeNull()
    expect(state.pendingAction).toBeNull()
  })

  it("starts with no revision history", () => {
    const state = createInitialSessionState()
    expect(state.revisionNodes).toEqual([])
    expect(state.currentRevisionId).toBeNull()
  })

  it("starts with sideThreadActive=false", () => {
    const state = createInitialSessionState()
    expect(state.sideThreadActive).toBe(false)
  })

  it("starts with no result context", () => {
    const state = createInitialSessionState()
    expect(state.resultContext).toBeNull()
  })
})

// ── applyStateTransition ───────────────────────────────────

describe("applyStateTransition", () => {
  describe("turn counting and phase", () => {
    it("increments turnCount by 1", () => {
      const state = makeState({ turnCount: 3 })
      const decision = makeDecision()
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(4)
    })

    it("updates journeyPhase from decision", () => {
      const state = makeState({ journeyPhase: "intake" })
      const decision = makeDecision({
        phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.95 },
      })
      const next = applyStateTransition(state, decision)
      expect(next.journeyPhase).toBe("results_displayed")
    })
  })

  describe("continue_narrowing", () => {
    it("records a no_op revision node", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "continue_narrowing", rationale: "", confidence: 0.8 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(1)
      expect(next.revisionNodes[0].action.type).toBe("no_op")
    })

    it("preserves existing constraints", () => {
      const state = makeState({ constraints: { base: { material: "steel" }, refinements: {} } })
      const decision = makeDecision({ actionInterpretation: { type: "continue_narrowing", rationale: "", confidence: 0.8 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("steel")
    })
  })

  describe("replace_slot", () => {
    it("records a no_op revision node (placeholder)", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "replace_slot", rationale: "", confidence: 0.8 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(1)
      expect(next.revisionNodes[0].action.type).toBe("no_op")
    })
  })

  describe("show_recommendation", () => {
    it("records a no_op revision node", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "show_recommendation", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(1)
    })
  })

  describe("go_back", () => {
    it("reverts to previous revision constraints", () => {
      const prevConstraints = { base: { material: "aluminum" }, refinements: {} }
      const revNode: RevisionNode = {
        revisionId: "rev-1",
        parentRevisionId: null,
        action: { type: "set_base_constraint", field: "material", oldValue: null, newValue: "steel" },
        constraintsBefore: prevConstraints,
        constraintsAfter: { base: { material: "steel" }, refinements: {} },
        candidateCountBefore: 0,
        candidateCountAfter: null,
        timestamp: Date.now(),
      }
      const state = makeState({
        constraints: { base: { material: "steel" }, refinements: {} },
        revisionNodes: [revNode],
        currentRevisionId: "rev-1",
      })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("aluminum")
      expect(next.revisionNodes.length).toBe(0)
      expect(next.currentRevisionId).toBeNull()
    })

    it("clears pending question", () => {
      const revNode: RevisionNode = {
        revisionId: "rev-1",
        parentRevisionId: null,
        action: { type: "no_op", field: null, oldValue: null, newValue: null },
        constraintsBefore: { base: {}, refinements: {} },
        constraintsAfter: { base: {}, refinements: {} },
        candidateCountBefore: 0,
        candidateCountAfter: null,
        timestamp: Date.now(),
      }
      const state = makeState({
        pendingQuestion: makePendingQuestion(),
        revisionNodes: [revNode],
        currentRevisionId: "rev-1",
      })
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.pendingQuestion).toBeNull()
    })

    it("is a no-op when no revision history exists", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "go_back", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      // Should just clear pendingQuestion (which is already null)
      expect(next.revisionNodes).toEqual([])
      expect(next.pendingQuestion).toBeNull()
    })
  })

  describe("compare_products", () => {
    it("records a no_op revision node", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "compare_products", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(1)
    })
  })

  describe("answer_general", () => {
    it("activates side thread", () => {
      const state = makeState({ sideThreadActive: false })
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.sideThreadActive).toBe(true)
    })

    it("does not add revision nodes", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(0)
    })
  })

  describe("redirect_off_topic", () => {
    it("makes no state changes beyond turn increment", () => {
      const state = makeState({ turnCount: 5 })
      const decision = makeDecision({ actionInterpretation: { type: "redirect_off_topic", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(6)
      expect(next.revisionNodes.length).toBe(0)
    })
  })

  describe("reset_session", () => {
    it("resets to initial state but preserves turnCount", () => {
      const state = makeState({
        turnCount: 7,
        constraints: { base: { material: "steel", diameter: 10 }, refinements: { coating: "AlTiN" } },
        journeyPhase: "results_displayed",
      })
      const decision = makeDecision({ actionInterpretation: { type: "reset_session", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.turnCount).toBe(8) // 7 + 1 from increment, then reset preserves the incremented value
      expect(next.journeyPhase).toBe("intake")
      expect(next.constraints).toEqual({ base: {}, refinements: {} })
      expect(next.resultContext).toBeNull()
    })
  })

  describe("skip_field", () => {
    it("clears pending question", () => {
      const state = makeState({ pendingQuestion: makePendingQuestion() })
      const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.pendingQuestion).toBeNull()
    })
  })

  describe("ask_clarification", () => {
    it("makes no constraint changes", () => {
      const state = makeState({ constraints: { base: { material: "steel" }, refinements: {} } })
      const decision = makeDecision({ actionInterpretation: { type: "ask_clarification", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.constraints.base.material).toBe("steel")
      expect(next.revisionNodes.length).toBe(0)
    })
  })

  describe("refine_current_results", () => {
    it("records an apply_refinement revision node", () => {
      const state = makeState()
      const decision = makeDecision({ actionInterpretation: { type: "refine_current_results", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.revisionNodes.length).toBe(1)
      expect(next.revisionNodes[0].action.type).toBe("apply_refinement")
    })
  })

  describe("side thread deactivation", () => {
    it("deactivates side thread when action is not answer_general", () => {
      const state = makeState({ sideThreadActive: true })
      const decision = makeDecision({ actionInterpretation: { type: "continue_narrowing", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.sideThreadActive).toBe(false)
    })

    it("keeps side thread active when action is answer_general", () => {
      const state = makeState({ sideThreadActive: true })
      const decision = makeDecision({ actionInterpretation: { type: "answer_general", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.sideThreadActive).toBe(true)
    })

    it("does not activate side thread for non-general actions when already inactive", () => {
      const state = makeState({ sideThreadActive: false })
      const decision = makeDecision({ actionInterpretation: { type: "skip_field", rationale: "", confidence: 0.9 } })
      const next = applyStateTransition(state, decision)
      expect(next.sideThreadActive).toBe(false)
    })
  })
})

// ── buildSurface ───────────────────────────────────────────

describe("buildSurface", () => {
  describe("side thread resume", () => {
    it("appends resume prompt when side thread active with pending question", () => {
      const state = makeState({
        sideThreadActive: true,
        pendingQuestion: makePendingQuestion("coating"),
      })
      const decision = makeDecision({ answerDraft: "엔드밀은 회전 절삭 공구입니다." })
      const surface = buildSurface(decision, state)

      expect(surface.answer).toContain("엔드밀은 회전 절삭 공구입니다.")
      expect(surface.answer).toContain("다시 제품 추천으로 돌아갈게요")
      expect(surface.answer).toContain("코팅을 선택해주세요")
    })

    it("uses pending question options as chips in resume", () => {
      const state = makeState({
        sideThreadActive: true,
        pendingQuestion: makePendingQuestion("coating"),
      })
      const decision = makeDecision({ answerDraft: "답변" })
      const surface = buildSurface(decision, state)
      expect(surface.chips).toContain("AlTiN")
      expect(surface.chips).toContain("TiAlN")
    })
  })

  describe("question_options mode", () => {
    it("builds options from nextQuestion", () => {
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
      expect(surface.displayedOptions[0].field).toBe("material")
      expect(surface.displayedOptions[0].label).toBe("Steel")
    })

    it("appends skip option when allowSkip is true", () => {
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
      const skipOpt = surface.displayedOptions[surface.displayedOptions.length - 1]
      expect(skipOpt.label).toBe("상관없음")
      expect(skipOpt.value).toBe("skip")
    })

    it("does not append skip option when allowSkip is false", () => {
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

    it("returns empty options when no nextQuestion provided", () => {
      const decision = makeDecision({ uiPlan: { optionMode: "question_options" } })
      // No nextQuestion → empty displayedOptions (unless suggestedChips fallback kicks in)
      delete decision.nextQuestion
      delete decision.suggestedChips
      const surface = buildSurface(decision, makeState())
      // Validator fallback may add a chip, but displayedOptions built here should be empty pre-validation
      expect(surface.displayedOptions).toHaveLength(0)
    })
  })

  describe("result_followups mode", () => {
    it("uses LLM suggestedChips when available (>= 2)", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: [
          { label: "3날로 좁히기", type: "filter" },
          { label: "코팅별 비교", type: "action" },
          { label: "조건 변경", type: "navigation" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.length).toBe(3)
      expect(surface.displayedOptions[0].field).toBe("_filter")
      expect(surface.displayedOptions[1].field).toBe("_action")
      expect(surface.displayedOptions[2].field).toBe("_control")
    })

    it("filters out unfilterable chips (RPM, etc.)", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: [
          { label: "RPM 추천", type: "action" },
          { label: "3날로 좁히기", type: "filter" },
          { label: "가격 비교", type: "action" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      // RPM and 가격 should be filtered
      expect(surface.displayedOptions.length).toBe(1)
      expect(surface.displayedOptions[0].label).toBe("3날로 좁히기")
    })

    it("falls back to data-driven chips when no suggestedChips", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 3, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "TiAlN", hasInventory: false } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        // No suggestedChips → fallback
      })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      // Should have at least some chips derived from candidate data
      expect(surface.displayedOptions.length).toBeGreaterThan(0)
    })

    it("generates flute comparison chip when multiple flute counts exist", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 3, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      const fluteChip = surface.displayedOptions.find(o => o.label.includes("날수별"))
      expect(fluteChip).toBeDefined()
    })

    it("generates coating comparison chip when multiple coatings exist", () => {
      const candidates = [
        makeCandidate("A1", 0.95, { keySpecs: { flute: 4, coating: "AlTiN", hasInventory: true } }),
        makeCandidate("A2", 0.90, { keySpecs: { flute: 4, coating: "TiAlN", hasInventory: true } }),
      ]
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      const coatingChip = surface.displayedOptions.find(o => o.label.includes("코팅별"))
      expect(coatingChip).toBeDefined()
    })

    it("limits fallback chips to 6", () => {
      const candidates = Array.from({ length: 10 }, (_, i) =>
        makeCandidate(`P${i}`, 0.9 - i * 0.01, {
          keySpecs: { flute: i % 3 + 2, coating: i % 2 ? "AlTiN" : "TiAlN", hasInventory: true },
        })
      )
      const state = makeState({ resultContext: makeResultContext(candidates) })
      const decision = makeDecision({ uiPlan: { optionMode: "result_followups" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions.length).toBeLessThanOrEqual(6)
    })

    it("limits suggestedChips to 8", () => {
      const chips = Array.from({ length: 12 }, (_, i) => ({
        label: `칩 ${i + 1}`, type: "action" as const,
      }))
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        suggestedChips: chips,
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.length).toBeLessThanOrEqual(8)
    })
  })

  describe("none mode", () => {
    it("returns empty options when mode is none", () => {
      const decision = makeDecision({ uiPlan: { optionMode: "none" } })
      delete decision.suggestedChips
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions).toHaveLength(0)
      expect(surface.chips).toHaveLength(0)
    })
  })

  describe("suggestedChips fallback", () => {
    it("converts suggestedChips to displayedOptions when empty", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        suggestedChips: [
          { label: "도움말", type: "action" },
          { label: "뒤로가기", type: "navigation" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.length).toBe(2)
      expect(surface.displayedOptions[0].label).toBe("도움말")
      expect(surface.displayedOptions[0].field).toBe("_action")
      expect(surface.displayedOptions[1].field).toBe("_control")
    })

    it("maps option type chips to nextQuestion field when available", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        nextQuestion: { field: "coating", suggestedOptions: [], allowSkip: true },
        suggestedChips: [
          { label: "AlTiN", type: "option" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions[0].field).toBe("coating")
    })

    it("maps option type chips to _action when no nextQuestion", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        suggestedChips: [
          { label: "선택", type: "option" },
        ],
      })
      delete decision.nextQuestion
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions[0].field).toBe("_action")
    })

    it("filters unfilterable chips in fallback path", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        suggestedChips: [
          { label: "이송속도 확인", type: "action" },
          { label: "유효한 칩", type: "action" },
        ],
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.displayedOptions.length).toBe(1)
      expect(surface.displayedOptions[0].label).toBe("유효한 칩")
    })
  })

  describe("chips-from-displayedOptions contract", () => {
    it("chips array always matches displayedOptions labels", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "material",
          suggestedOptions: [
            { label: "Steel", value: "steel" },
            { label: "Aluminum", value: "aluminum" },
          ],
          allowSkip: true,
        },
      })
      const surface = buildSurface(decision, makeState())
      expect(surface.chips).toEqual(surface.displayedOptions.map(o => o.label))
    })
  })

  describe("answer passthrough", () => {
    it("passes answerDraft as answer", () => {
      const decision = makeDecision({ answerDraft: "직경 10mm 엔드밀을 추천드립니다." })
      const surface = buildSurface(decision, makeState())
      expect(surface.answer).toBe("직경 10mm 엔드밀을 추천드립니다.")
    })
  })
})

// ── orchestrateTurnV2 (integration, mocked LLM) ───────────

describe("orchestrateTurnV2", () => {
  it("returns a valid TurnResult with fallback when provider unavailable", async () => {
    const state = createInitialSessionState()
    const provider = makeMockProvider() // unavailable
    const result = await orchestrateTurnV2("안녕하세요", state, provider)

    expect(result.answer).toBeDefined()
    expect(result.sessionState).toBeDefined()
    expect(result.trace).toBeDefined()
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("increments turnCount in returned state", async () => {
    const state = makeState({ turnCount: 2 })
    const provider = makeMockProvider()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(result.sessionState.turnCount).toBe(3)
  })

  it("uses LLM decision when provider is available and returns valid JSON", async () => {
    const llmResponse = JSON.stringify({
      phaseInterpretation: { currentPhase: "results_displayed", confidence: 0.95 },
      actionInterpretation: { type: "show_recommendation", rationale: "enough constraints", confidence: 0.9 },
      answerIntent: { topic: "recommendation", needsGroundedFact: true, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
      uiPlan: { optionMode: "result_followups" },
      suggestedChips: [
        { label: "추천 근거", type: "action" },
        { label: "조건 변경", type: "navigation" },
      ],
      answerDraft: "추천 결과를 보여드리겠습니다.",
    })
    const provider = makeMockProvider(llmResponse)

    const state = makeState({ constraints: { base: { material: "steel", diameter: 10 }, refinements: {} } })
    const result = await orchestrateTurnV2("추천해줘", state, provider)

    expect(result.trace.phase).toBe("results_displayed")
    expect(result.trace.action).toBe("show_recommendation")
  })

  it("falls back gracefully when LLM returns invalid JSON", async () => {
    const provider = makeMockProvider("This is not JSON at all")
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)

    // Should use fallback decision
    expect(result.trace.action).toBe("continue_narrowing")
    expect(result.trace.confidence).toBe(0.5)
  })

  it("falls back gracefully when LLM returns markdown-wrapped JSON", async () => {
    const llmResponse = "```json\n" + JSON.stringify({
      phaseInterpretation: { currentPhase: "narrowing", confidence: 0.8 },
      actionInterpretation: { type: "ask_clarification", rationale: "unclear", confidence: 0.7 },
      answerIntent: { topic: "clarification", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
      uiPlan: { optionMode: "question_options" },
      answerDraft: "좀 더 구체적으로 말씀해주시겠어요?",
    }) + "\n```"
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("음...", state, provider)

    // Should parse successfully despite markdown fences
    expect(result.trace.action).toBe("ask_clarification")
  })

  it("trace includes searchExecuted flag", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(typeof result.trace.searchExecuted).toBe("boolean")
  })

  it("trace includes validated flag", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(typeof result.trace.validated).toBe("boolean")
  })

  it("passes recentTurns to snapshot builder", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const recentTurns = [
      { role: "user" as const, text: "이전 질문" },
      { role: "assistant" as const, text: "이전 답변" },
    ]
    const result = await orchestrateTurnV2("후속 질문", state, provider, recentTurns)
    expect(result).toBeDefined()
  })

  it("chips and displayedOptions are always arrays", async () => {
    const provider = makeMockProvider()
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("테스트", state, provider)
    expect(Array.isArray(result.chips)).toBe(true)
    expect(Array.isArray(result.displayedOptions)).toBe(true)
  })

  it("searchPayload is null when search was not executed", async () => {
    // answer_general should not trigger search
    const llmResponse = JSON.stringify({
      phaseInterpretation: { currentPhase: "narrowing", confidence: 0.8 },
      actionInterpretation: { type: "answer_general", rationale: "general question", confidence: 0.85 },
      answerIntent: { topic: "general", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
      uiPlan: { optionMode: "none" },
      answerDraft: "엔드밀은 밀링 가공에 사용되는 절삭 공구입니다.",
    })
    const provider = makeMockProvider(llmResponse)
    const state = createInitialSessionState()
    const result = await orchestrateTurnV2("엔드밀이 뭐야?", state, provider)
    expect(result.searchPayload).toBeNull()
  })
})
