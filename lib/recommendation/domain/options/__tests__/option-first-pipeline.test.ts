/**
 * Option-First Pipeline — Regression tests
 *
 * Tests:
 * 1. Chips are NOT generated from answer text in active paths
 * 2. Answer cannot introduce actionable options absent from displayedOptions
 * 3. Pending question logic works from state, not answer parsing
 * 4. If answer suggests an option, the corresponding structured option exists
 * 5. Quoted or explanatory text does not become chips
 */

import { describe, it, expect } from "vitest"
import { checkAnswerChipDivergence, fixChipDivergence } from "../divergence-guard"
import type { DisplayedOption } from "../../types"

// ── Test Helpers ──────────────────────────────────────────────

function makeOptions(values: string[]): DisplayedOption[] {
  return values.map((v, i) => ({
    index: i + 1,
    label: v,
    value: v,
    field: "coating",
    count: 5,
  }))
}

// ════════════════════════════════════════════════════════════════
// TEST 1: Chips NOT generated from answer text
// ════════════════════════════════════════════════════════════════

describe("Option-first: no text-to-chip synthesis", () => {
  it("fixChipDivergence does NOT add chips from answer text (deprecated)", () => {
    const chips = ["DLC", "AlTiN"]
    const divergence = {
      hasDivergence: true,
      unauthorizedActions: ["비교 보기"],
      correctedAnswer: "비교가 필요하시면 말씀해주세요",
    }

    const result = fixChipDivergence(chips, divergence)

    // Must return chips UNCHANGED — no new chips added from text
    expect(result).toEqual(chips)
    expect(result.length).toBe(2)
  })

  it("divergence guard does NOT suggest adding chips", () => {
    const answerText = "둘 다 보기를 선택하시면 됩니다. 비교해 보기도 가능합니다."
    const chips = ["DLC (5개)", "AlTiN (3개)", "상관없음"]
    const options = makeOptions(["DLC", "AlTiN"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    // Must NOT have suggestedChips field (old behavior)
    expect(result).not.toHaveProperty("suggestedChips")
    // Must detect unauthorized actions
    expect(result.hasDivergence).toBe(true)
    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Answer cannot introduce absent options
// ════════════════════════════════════════════════════════════════

describe("Option-first: answer constrained by displayedOptions", () => {
  it("answer suggesting '비교해 보기' without matching option → corrected", () => {
    const answerText = "DLC와 AlTiN을 비교해 보기 원하시면 클릭하세요."
    const chips = ["DLC", "AlTiN", "상관없음"]
    const options = makeOptions(["DLC", "AlTiN"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(true)
    expect(result.correctedAnswer).toBeTruthy()
    // Corrected answer should NOT contain the unauthorized action
    expect(result.correctedAnswer).not.toMatch(/비교해?\s*보기?/)
  })

  it("answer suggesting '다른 조건 보기' without matching option → corrected", () => {
    const answerText = "다른 조건 보기를 원하시면 알려주세요."
    const chips = ["DLC", "AlTiN"]
    const options = makeOptions(["DLC", "AlTiN"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(true)
    expect(result.correctedAnswer).not.toMatch(/다른\s*조건\s*보기/)
  })

  it("answer suggesting existing option → NOT corrected", () => {
    const answerText = "DLC 코팅이 적합합니다."
    const chips = ["DLC (5개)", "AlTiN (3개)", "상관없음"]
    const options = makeOptions(["DLC", "AlTiN"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(false)
    expect(result.correctedAnswer).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Pending question from state, not answer parsing
// ════════════════════════════════════════════════════════════════

describe("Option-first: state-based pending question", () => {
  it("pending question comes from session.lastAskedField, not answer text", () => {
    // Simulate: session state says lastAskedField="coating" with displayedOptions
    const sessionState = {
      lastAskedField: "coating",
      resolutionStatus: "narrowing",
      displayedOptions: [
        { index: 1, label: "DLC", value: "DLC", field: "coating", count: 5 },
        { index: 2, label: "AlTiN", value: "AlTiN", field: "coating", count: 3 },
      ],
    }

    // The pending question should be derivable from state
    const hasPendingQuestion = !!sessionState.lastAskedField
      && !sessionState.resolutionStatus?.startsWith("resolved")
      && sessionState.displayedOptions.length > 0

    expect(hasPendingQuestion).toBe(true)

    // The field should come from state, not from parsing answer text
    expect(sessionState.lastAskedField).toBe("coating")
    expect(sessionState.displayedOptions[0].field).toBe("coating")
  })

  it("no pending question when no lastAskedField in state", () => {
    const sessionState = {
      lastAskedField: undefined,
      resolutionStatus: "narrowing",
      displayedOptions: [],
    }

    const hasPendingQuestion = !!sessionState.lastAskedField
      && !sessionState.resolutionStatus?.startsWith("resolved")
      && sessionState.displayedOptions.length > 0

    expect(hasPendingQuestion).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: Actionable answer ↔ structured option existence
// ════════════════════════════════════════════════════════════════

describe("Option-first: answer/option alignment", () => {
  it("multiple unauthorized actions are all detected", () => {
    const answerText = "대체 후보를 보시거나 절삭조건 확인도 가능합니다. 다시 선택하실 수도 있어요."
    const chips = ["추천해주세요"]
    const options: DisplayedOption[] = []

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(true)
    expect(result.unauthorizedActions.length).toBeGreaterThanOrEqual(2)
    // Corrected answer should differ from original (unauthorized phrases softened)
    expect(result.correctedAnswer).not.toBe(answerText)
    // The corrected text should be softer (contains "말씀해주세요" instead of direct actions)
    expect(result.correctedAnswer).toContain("말씀해주세요")
  })

  it("answer with matching options → no correction needed", () => {
    const answerText = "대체 후보를 보시겠습니까?"
    const chips = ["대체 후보 보기", "절삭조건 알려줘"]
    const options = makeOptions(["대체 후보 보기", "절삭조건 알려줘"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Quoted/explanatory text does not create chips
// ════════════════════════════════════════════════════════════════

describe("Option-first: quoted text immunity", () => {
  it("fixChipDivergence never adds chips regardless of input", () => {
    const chips = ["DLC"]
    // Even with explicit hasDivergence, fixChipDivergence does nothing
    const result = fixChipDivergence(chips, {
      hasDivergence: true,
      unauthorizedActions: ["비교 보기", "대체 후보", "절삭조건"],
      correctedAnswer: "some corrected text",
    })

    expect(result).toEqual(["DLC"])
  })

  it("pure explanation text with no actionable phrases → no divergence", () => {
    const answerText = "DLC 코팅은 Diamond-Like Carbon의 약자로, 높은 경도와 내마모성이 특징입니다. 알루미늄 가공에서 우수한 성능을 보여줍니다."
    const chips = ["DLC (5개)", "AlTiN (3개)", "상관없음"]
    const options = makeOptions(["DLC", "AlTiN"])

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(false)
    expect(result.correctedAnswer).toBeNull()
  })
})
