import { describe, expect, it } from "vitest"

import { buildQuestionResponseOptionState } from "../serve-engine-option-first"

describe("buildQuestionResponseOptionState", () => {
  it("keeps question-aligned options for delegation-style skip replies", async () => {
    const displayedOptions = [
      { index: 1, label: "DLC (12개)", field: "coating", value: "DLC", count: 12 },
      { index: 2, label: "AlTiN (9개)", field: "coating", value: "AlTiN", count: 9 },
      { index: 3, label: "상관없음", field: "coating", value: "skip", count: 0 },
    ]

    const result = await buildQuestionResponseOptionState({
      chips: displayedOptions.map(option => option.label),
      question: {
        questionText: "코팅 종류 선호가 있으신가요?",
        chips: displayedOptions.map(option => option.label),
        field: "coating",
      },
      displayedOptions,
      sessionState: {
        lastAskedField: "coating",
        displayedCandidates: [],
      } as any,
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
      } as any,
      userMessage: "아무거나 괜찮은 걸로 추천해주세요",
      responseText: "다음 조건을 선택해주세요.",
      messages: [],
      provider: { available: () => false } as any,
    })

    expect(result.chips).toEqual(displayedOptions.map(option => option.label))
    expect(result.displayedOptions).toEqual(displayedOptions)
    expect(result.chips).not.toContain("추천으로 골라줘")
    expect(result.chips).not.toContain("쉽게 설명해줘")
  })
})
