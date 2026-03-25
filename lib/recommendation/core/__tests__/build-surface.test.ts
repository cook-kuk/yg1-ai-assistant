import { describe, it, expect } from "vitest"
import { buildSurface } from "../turn-orchestrator"
import { createInitialSessionState } from "../turn-orchestrator"
import type { LlmTurnDecision } from "../types"

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

describe("buildSurface", () => {
  const state = createInitialSessionState()

  describe("question_options mode", () => {
    it("creates field-bound options from nextQuestion", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "coating",
          suggestedOptions: [
            { label: "AlTiN", value: "AlTiN" },
            { label: "TiAlN", value: "TiAlN" },
            { label: "Diamond", value: "Diamond" },
          ],
          allowSkip: false,
        },
      })

      const surface = buildSurface(decision, state)

      expect(surface.displayedOptions).toHaveLength(3)
      expect(surface.displayedOptions[0]).toEqual({
        index: 1,
        label: "AlTiN",
        field: "coating",
        value: "AlTiN",
        count: 0,
      })
      expect(surface.displayedOptions[1].index).toBe(2)
      expect(surface.displayedOptions[2].index).toBe(3)
      // All options should be bound to the same field
      for (const opt of surface.displayedOptions) {
        expect(opt.field).toBe("coating")
      }
    })

    it("appends skip option when allowSkip is true", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "fluteCount",
          suggestedOptions: [
            { label: "2날", value: "2" },
            { label: "4날", value: "4" },
          ],
          allowSkip: true,
        },
      })

      const surface = buildSurface(decision, state)

      expect(surface.displayedOptions).toHaveLength(3)
      const skipOpt = surface.displayedOptions[2]
      expect(skipOpt.label).toBe("상관없음")
      expect(skipOpt.field).toBe("fluteCount")
      expect(skipOpt.value).toBe("skip")
      expect(skipOpt.index).toBe(3)
    })

    it("returns empty options when nextQuestion is missing", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        // no nextQuestion
      })

      const surface = buildSurface(decision, state)
      expect(surface.displayedOptions).toHaveLength(0)
    })
  })

  describe("result_followups mode", () => {
    it("creates action options for post-result exploration", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
        answerDraft: "추천 결과입니다.",
      })

      const surface = buildSurface(decision, state)

      expect(surface.displayedOptions).toHaveLength(3)
      expect(surface.displayedOptions[0]).toEqual({
        index: 1,
        label: "왜 이 제품을 추천했나요?",
        field: "_action",
        value: "explain",
        count: 0,
      })
      expect(surface.displayedOptions[1]).toEqual({
        index: 2,
        label: "절삭조건 알려줘",
        field: "_action",
        value: "cutting_conditions",
        count: 0,
      })
      expect(surface.displayedOptions[2]).toEqual({
        index: 3,
        label: "대체 후보 비교하기",
        field: "_action",
        value: "compare",
        count: 0,
      })
    })
  })

  describe("none mode", () => {
    it("creates empty displayedOptions and chips", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
        answerDraft: "일반 응답입니다.",
      })

      const surface = buildSurface(decision, state)

      expect(surface.displayedOptions).toHaveLength(0)
      expect(surface.chips).toHaveLength(0)
      expect(surface.answer).toBe("일반 응답입니다.")
    })
  })

  describe("chips always match displayedOptions labels", () => {
    it("chips match for question_options", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "question_options" },
        nextQuestion: {
          field: "material",
          suggestedOptions: [
            { label: "초경", value: "carbide" },
            { label: "HSS", value: "hss" },
          ],
          allowSkip: true,
        },
      })

      const surface = buildSurface(decision, state)
      expect(surface.chips).toEqual(surface.displayedOptions.map((o) => o.label))
      expect(surface.chips).toEqual(["초경", "HSS", "상관없음"])
    })

    it("chips match for result_followups", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "result_followups" },
      })

      const surface = buildSurface(decision, state)
      expect(surface.chips).toEqual(surface.displayedOptions.map((o) => o.label))
    })

    it("chips match for none mode (both empty)", () => {
      const decision = makeDecision({
        uiPlan: { optionMode: "none" },
      })

      const surface = buildSurface(decision, state)
      expect(surface.chips).toEqual([])
      expect(surface.displayedOptions).toEqual([])
      expect(surface.chips).toEqual(surface.displayedOptions.map((o) => o.label))
    })
  })

  it("uses answerDraft as the answer text", () => {
    const decision = makeDecision({ answerDraft: "커스텀 답변입니다." })
    const surface = buildSurface(decision, state)
    expect(surface.answer).toBe("커스텀 답변입니다.")
  })
})
