import { describe, it, expect } from "vitest"
import {
  applyStateTransition,
  buildSurface,
  createInitialSessionState,
} from "../turn-orchestrator"
import type {
  LlmTurnDecision,
  RecommendationSessionState,
  PendingQuestion,
  ResultContext,
} from "../types"

function makeDecision(
  overrides: Partial<LlmTurnDecision> = {}
): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
    actionInterpretation: {
      type: "continue_narrowing",
      rationale: "test",
      confidence: 0.9,
    },
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

function makeSideQuestionDecision(
  overrides: Partial<LlmTurnDecision> = {}
): LlmTurnDecision {
  return makeDecision({
    actionInterpretation: {
      type: "answer_general",
      rationale: "side question",
      confidence: 0.9,
    },
    uiPlan: { optionMode: "none" },
    answerDraft: "YG-1은 1981년에 설립되었습니다.",
    ...overrides,
  })
}

const samplePendingQuestion: PendingQuestion = {
  field: "coating",
  questionText: "어떤 코팅을 원하시나요?",
  options: [
    { index: 1, label: "AlTiN", field: "coating", value: "AlTiN", count: 0 },
    { index: 2, label: "TiAlN", field: "coating", value: "TiAlN", count: 0 },
    { index: 3, label: "상관없음", field: "coating", value: "skip", count: 0 },
  ],
  turnAsked: 3,
  context: null,
}

const sampleResultContext: ResultContext = {
  candidates: [
    {
      productCode: "ABC-123",
      displayCode: "ABC-123",
      rank: 1,
      score: 0.95,
      seriesName: "V7",
    },
  ],
  totalConsidered: 50,
  searchTimestamp: Date.now(),
  constraintsUsed: {
    base: { diameter: 10, material: "steel" },
    refinements: {},
  },
}

function makeStateWithConstraints(): RecommendationSessionState {
  return {
    ...createInitialSessionState(),
    journeyPhase: "narrowing",
    constraints: {
      base: { diameter: 10, material: "steel" },
      refinements: { fluteCount: 4 },
    },
    pendingQuestion: samplePendingQuestion,
    resultContext: sampleResultContext,
    turnCount: 3,
  }
}

describe("Side question isolation", () => {
  describe("applyStateTransition — answer_general", () => {
    it("preserves constraints", () => {
      const state = makeStateWithConstraints()
      const decision = makeSideQuestionDecision()

      const next = applyStateTransition(state, decision)

      expect(next.constraints).toEqual(state.constraints)
    })

    it("preserves pendingQuestion", () => {
      const state = makeStateWithConstraints()
      const decision = makeSideQuestionDecision()

      const next = applyStateTransition(state, decision)

      expect(next.pendingQuestion).toEqual(samplePendingQuestion)
    })

    it("preserves resultContext", () => {
      const state = makeStateWithConstraints()
      const decision = makeSideQuestionDecision()

      const next = applyStateTransition(state, decision)

      expect(next.resultContext).toEqual(sampleResultContext)
    })

    it("sets sideThreadActive to true", () => {
      const state = makeStateWithConstraints()
      const decision = makeSideQuestionDecision()

      const next = applyStateTransition(state, decision)

      expect(next.sideThreadActive).toBe(true)
    })
  })

  describe("applyStateTransition — non-side action deactivates sideThread", () => {
    it("deactivates sideThread on continue_narrowing", () => {
      const state = {
        ...makeStateWithConstraints(),
        sideThreadActive: true,
      }
      const decision = makeDecision({
        actionInterpretation: {
          type: "continue_narrowing",
          rationale: "resume",
          confidence: 0.9,
        },
      })

      const next = applyStateTransition(state, decision)

      expect(next.sideThreadActive).toBe(false)
    })

    it("keeps sideThread active for consecutive answer_general", () => {
      const state = {
        ...makeStateWithConstraints(),
        sideThreadActive: true,
      }
      const decision = makeSideQuestionDecision()

      const next = applyStateTransition(state, decision)

      expect(next.sideThreadActive).toBe(true)
    })
  })

  describe("buildSurface — side thread resume", () => {
    it("includes resume prompt text when sideThread + pendingQuestion", () => {
      const state: RecommendationSessionState = {
        ...makeStateWithConstraints(),
        sideThreadActive: true,
      }
      const decision = makeSideQuestionDecision()

      const surface = buildSurface(decision, state)

      expect(surface.answer).toContain("다시 제품 추천으로 돌아갈게요")
      expect(surface.answer).toContain(samplePendingQuestion.questionText)
    })

    it("includes side answer text in response", () => {
      const state: RecommendationSessionState = {
        ...makeStateWithConstraints(),
        sideThreadActive: true,
      }
      const decision = makeSideQuestionDecision({
        answerDraft: "YG-1은 인천 본사입니다.",
      })

      const surface = buildSurface(decision, state)

      expect(surface.answer).toContain("YG-1은 인천 본사입니다.")
    })

    it("restores pending question options as chips", () => {
      const state: RecommendationSessionState = {
        ...makeStateWithConstraints(),
        sideThreadActive: true,
      }
      const decision = makeSideQuestionDecision()

      const surface = buildSurface(decision, state)

      expect(surface.chips).toEqual(["AlTiN", "TiAlN", "상관없음"])
      expect(surface.displayedOptions).toEqual(samplePendingQuestion.options)
    })

    it("falls through to normal surface when no pendingQuestion", () => {
      const state: RecommendationSessionState = {
        ...createInitialSessionState(),
        sideThreadActive: true,
        pendingQuestion: null,
      }
      const decision = makeSideQuestionDecision()

      const surface = buildSurface(decision, state)

      // Should NOT contain resume prompt — falls through to normal path
      expect(surface.answer).not.toContain("다시 제품 추천으로 돌아갈게요")
      expect(surface.answer).toBe(decision.answerDraft)
    })
  })
})
