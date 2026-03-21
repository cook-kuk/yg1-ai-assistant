/**
 * Pending Question Detector + Question-Aligned Option Builder — Tests.
 *
 * Tests:
 * 1. Binary question detection ("4날을 선택하시겠습니까?")
 * 2. "A? 아니면 B?" two-option detection
 * 3. Constrained options detection ("2날/4날")
 * 4. Revise-or-continue detection
 * 5. Question-aligned chips override generic chips
 * 6. No false positive on non-question text
 */

import { describe, it, expect, beforeEach } from "vitest"
import { detectPendingQuestion } from "../pending-question-detector"
import { buildQuestionAlignedOptions, resetQuestionOptionCounter } from "../../options/question-option-builder"
import { smartOptionsToChips, smartOptionsToDisplayedOptions } from "../../options/option-bridge"

beforeEach(() => {
  resetQuestionOptionCounter()
})

// ════════════════════════════════════════════════════════════════
// 1. Binary question detection
// ════════════════════════════════════════════════════════════════

describe("binary question detection", () => {
  it("detects '4날을 선택하시겠습니까?' as binary question", () => {
    const result = detectPendingQuestion(
      "TiAlN 코팅에는 4날과 2날만 있습니다. 4날을 선택하시겠습니까?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    expect(["binary_yes_no", "binary_proceed"]).toContain(result.question!.shape)
    expect(result.question!.isBinary).toBe(true)
    expect(result.question!.extractedOptions).toContain("4날")
  })

  it("detects '진행할까요?' as binary proceed", () => {
    const result = detectPendingQuestion(
      "4날으로 진행할까요?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    expect(result.question!.shape).toBe("binary_proceed")
    expect(result.question!.isBinary).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// 2. "A? 아니면 B?" detection
// ════════════════════════════════════════════════════════════════

describe("A-or-B question detection", () => {
  it("detects '4날을 선택하시겠습니까? 아니면 다른 조건으로 다시 찾아보시겠습니까?'", () => {
    const result = detectPendingQuestion(
      "4날을 선택하시겠습니까? 아니면 다른 조건으로 다시 찾아보시겠습니까?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    expect(result.question!.extractedOptions.length).toBe(2)
    expect(result.question!.hasExplicitChoices).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// 3. Constrained options
// ════════════════════════════════════════════════════════════════

describe("constrained options detection", () => {
  it("detects '2날 / 4날' as constrained options", () => {
    const result = detectPendingQuestion(
      "해당 조건에서는 2날 / 4날만 가능합니다. 어떤 걸 원하시나요?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    expect(result.question!.shape).toBe("constrained_options")
    expect(result.question!.extractedOptions).toContain("2날")
    expect(result.question!.extractedOptions).toContain("4날")
  })
})

// ════════════════════════════════════════════════════════════════
// 4. Revise-or-continue
// ════════════════════════════════════════════════════════════════

describe("revise-or-continue detection", () => {
  it("detects '다른 조건으로 다시 찾아보시겠어요?' as revise_or_continue", () => {
    const result = detectPendingQuestion(
      "현재 조건에서 추천 가능한 제품이 3개 있습니다. 다른 조건으로 다시 찾아보시겠어요?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    expect(result.question!.shape).toBe("revise_or_continue")
  })
})

// ════════════════════════════════════════════════════════════════
// 5. Question-aligned chips override generic chips
// ════════════════════════════════════════════════════════════════

describe("question-aligned chip generation", () => {
  it("generates question-aligned chips for binary proceed question", () => {
    const result = detectPendingQuestion(
      "4날을 선택하시겠습니까? 아니면 다른 조건으로 다시 찾아보시겠습니까?"
    )

    expect(result.hasPendingQuestion).toBe(true)
    const options = buildQuestionAlignedOptions(result.question!)
    const chips = smartOptionsToChips(options)
    const displayed = smartOptionsToDisplayedOptions(options)

    // Should have question-specific chips, not generic ones
    expect(chips.length).toBeGreaterThanOrEqual(2)

    // Should NOT contain generic chips
    expect(chips).not.toContain("제품 추천")
    expect(chips).not.toContain("절삭조건 문의")
    expect(chips).not.toContain("코팅 비교")
    expect(chips).not.toContain("시리즈 검색")

    // Displayed options should be synchronized
    for (const opt of displayed) {
      expect(chips).toContain(opt.label)
    }
  })

  it("generates constrained option chips for flute count question", () => {
    const result = detectPendingQuestion(
      "해당 조건에서는 2날 / 4날만 가능합니다. 어떤 걸 원하시나요?"
    )

    const options = buildQuestionAlignedOptions(result.question!)
    const chips = smartOptionsToChips(options)

    expect(chips).toContain("2날")
    expect(chips).toContain("4날")
    expect(chips).toContain("상관없음")

    // Should NOT have generic action chips
    expect(chips).not.toContain("제품 추천")
  })

  it("generates revise-or-continue chips", () => {
    const result = detectPendingQuestion(
      "현재 조건에서 추천 가능한 제품이 3개 있습니다. 다른 조건으로 다시 찾아보시겠어요?"
    )

    const options = buildQuestionAlignedOptions(result.question!)
    const chips = smartOptionsToChips(options)

    expect(chips).toContain("현재 조건 유지")
    expect(chips).toContain("다른 조건으로 다시 보기")
  })
})

// ════════════════════════════════════════════════════════════════
// 6. No false positive on non-question text
// ════════════════════════════════════════════════════════════════

describe("no false positives", () => {
  it("does not detect a question in plain statement text", () => {
    const result = detectPendingQuestion(
      "TiAlN 코팅은 스테인리스 가공에 적합한 코팅입니다. 경도와 내열성이 우수합니다."
    )

    expect(result.hasPendingQuestion).toBe(false)
  })

  it("does not detect a question in recommendation summary", () => {
    const result = detectPendingQuestion(
      "추천 제품: CE480 (4날, DLC 코팅, φ4mm). 점수 85점으로 정확 매칭입니다."
    )

    expect(result.hasPendingQuestion).toBe(false)
  })
})
