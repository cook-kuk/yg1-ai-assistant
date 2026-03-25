import { describe, it, expect } from "vitest"
import { validateSurfaceV2 } from "../response-validator"
import type { LlmTurnDecision } from "../types"

function makeDecision(overrides: Partial<LlmTurnDecision> = {}): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
    actionInterpretation: { type: "continue_narrowing", rationale: "test", confidence: 0.9 },
    answerIntent: { topic: "narrowing", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    uiPlan: { optionMode: "question_options" },
    answerDraft: "테스트 답변",
    ...overrides,
  }
}

describe("validateSurfaceV2", () => {
  it("removes stale field options and rebuilds chips on field mismatch", () => {
    const decision = makeDecision({
      nextQuestion: { field: "material", suggestedOptions: [], allowSkip: false },
    })
    const surface = {
      answer: "소재를 선택해주세요.",
      displayedOptions: [
        { label: "스틸", field: "material", value: "steel" },
        { label: "TiAlN", field: "coating", value: "tialn" },  // wrong field
        { label: "처음부터 다시", field: "_action", value: "_reset" },
      ],
      chips: ["스틸", "TiAlN", "처음부터 다시"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.warnings.some(w => w.includes("Field mismatch"))).toBe(true)
    expect(result.rewrites).toContain("removed_stale_field_options")
    expect(result.displayedOptions).toHaveLength(2) // steel + _action
    expect(result.chips).toEqual(["스틸", "처음부터 다시"])
  })

  it("adds fallback chips when surface is empty and mode expects options", () => {
    const decision = makeDecision({ uiPlan: { optionMode: "question_options" } })
    const surface = { answer: "무엇을 도와드릴까요?", displayedOptions: [], chips: [] }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.rewrites).toContain("added_fallback_chips")
    expect(result.displayedOptions).toHaveLength(1)
    expect(result.displayedOptions[0].label).toBe("처음부터 다시")
    expect(result.displayedOptions[0].index).toBe(1)
    expect(result.displayedOptions[0].count).toBe(0)
    expect(result.chips).toEqual(["처음부터 다시"])
  })

  it("does not add fallback chips when optionMode is none", () => {
    const decision = makeDecision({ uiPlan: { optionMode: "none" } })
    const surface = { answer: "안녕하세요.", displayedOptions: [], chips: [] }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.rewrites).not.toContain("added_fallback_chips")
    expect(result.displayedOptions).toHaveLength(0)
    expect(result.chips).toHaveLength(0)
  })

  it("warns on company info leakage in recommendation topic", () => {
    const decision = makeDecision({
      answerIntent: { topic: "recommendation", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    })
    const surface = {
      answer: "YG-1은 1981년에 설립된 회사입니다.",
      displayedOptions: [{ label: "옵션1", field: "material", value: "v1" }],
      chips: ["옵션1"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.warnings).toContain("Company info leakage in recommendation answer")
  })

  it("does not warn on company info for non-recommendation topics", () => {
    const decision = makeDecision({
      answerIntent: { topic: "general", needsGroundedFact: false, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    })
    const surface = {
      answer: "YG-1은 1981년에 설립된 회사입니다.",
      displayedOptions: [{ label: "옵션1", field: "material", value: "v1" }],
      chips: ["옵션1"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.warnings).not.toContain("Company info leakage in recommendation answer")
  })

  it("appends disclaimer for ungrounded facts with definitive claims", () => {
    const decision = makeDecision({
      answerIntent: { topic: "narrowing", needsGroundedFact: true, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    })
    const surface = {
      answer: "이 제품은 최고 경도를 가지고 있습니다.\n다음 선택을 해주세요.",
      displayedOptions: [{ label: "옵션", field: "f", value: "v" }],
      chips: ["옵션"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.rewrites).toContain("added_ungrounded_disclaimer")
    expect(result.answer).toContain("확인된 근거 없이 생성된 내용")
    expect(result.answer).toContain("032-526-0909")
  })

  it("does not add disclaimer when grounded facts are available", () => {
    const decision = makeDecision({
      answerIntent: { topic: "narrowing", needsGroundedFact: true, shouldUseCurrentResultContext: false, shouldResumePendingQuestion: false },
    })
    const surface = {
      answer: "이 제품은 최고 경도를 가지고 있습니다.\n다음을 선택해주세요.",
      displayedOptions: [{ label: "옵션", field: "f", value: "v" }],
      chips: ["옵션"],
    }

    const result = validateSurfaceV2(surface, decision, true)

    expect(result.rewrites).not.toContain("added_ungrounded_disclaimer")
  })

  it("removes fake citations from answer", () => {
    const decision = makeDecision()
    const surface = {
      answer: "공식 정보 기반 AI 추론에 따르면, 이 제품이 적합합니다. 공개 정보 참고.",
      displayedOptions: [{ label: "옵션", field: "f", value: "v" }],
      chips: ["옵션"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.rewrites).toContain("removed_fake_citations")
    expect(result.answer).not.toContain("공식 정보 기반 AI 추론")
    expect(result.answer).not.toContain("공개 정보 참고")
  })

  it("passes clean surface with valid=true", () => {
    const decision = makeDecision({
      nextQuestion: { field: "material", suggestedOptions: [], allowSkip: false },
    })
    const surface = {
      answer: "소재를 선택해주세요.",
      displayedOptions: [
        { label: "스틸", field: "material", value: "steel" },
        { label: "알루미늄", field: "material", value: "aluminum" },
      ],
      chips: ["스틸", "알루미늄"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.rewrites).toHaveLength(0)
    expect(result.answer).toBe("소재를 선택해주세요.")
  })

  it("chips always match displayedOptions after validation", () => {
    const decision = makeDecision({
      nextQuestion: { field: "diameter", suggestedOptions: [], allowSkip: false },
    })
    const surface = {
      answer: "직경을 선택해주세요.",
      displayedOptions: [
        { label: "6mm", field: "diameter", value: "6" },
        { label: "TiAlN", field: "coating", value: "tialn" },  // stale
        { label: "10mm", field: "diameter", value: "10" },
      ],
      chips: ["6mm", "TiAlN", "10mm"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    // After removing stale options, chips must match remaining displayedOptions
    const chipSet = new Set(result.chips)
    const labelSet = new Set(result.displayedOptions.map(o => o.label))
    expect(chipSet).toEqual(labelSet)
  })

  it("normalizes displayedOptions to include index and count defaults", () => {
    const decision = makeDecision()
    const surface = {
      answer: "테스트",
      displayedOptions: [
        { label: "옵션1", field: "material", value: "steel" },
        { label: "옵션2", field: "_action", value: "_reset" },
      ],
      chips: ["옵션1", "옵션2"],
    }

    const result = validateSurfaceV2(surface, decision, false)

    expect(result.displayedOptions).toEqual([
      { index: 1, label: "옵션1", field: "material", value: "steel", count: 0 },
      { index: 2, label: "옵션2", field: "_action", value: "_reset", count: 0 },
    ])
  })
})
