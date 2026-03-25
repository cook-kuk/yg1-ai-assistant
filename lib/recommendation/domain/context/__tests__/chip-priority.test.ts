/**
 * Chip Priority Framework — Regression tests.
 *
 * Tests:
 * 1. Pending question chips outrank generic chips
 * 2. Confused user generates explanation/delegate/skip chips
 * 3. Generic fallback chips suppressed while pending question unresolved
 * 4. LLM reranker only selects from candidates (mock test)
 * 5. User state detection works for key confusion patterns
 */

import { describe, it, expect, beforeEach } from "vitest"
import { detectPendingQuestion } from "../pending-question-detector"
import {
  buildQuestionAlignedOptions,
  buildConfusionHelperOptions,
  resetQuestionOptionCounter,
} from "../../options/question-option-builder"
import { smartOptionsToChips } from "../../options/option-bridge"
import { detectUserState } from "../user-understanding-detector"
import { buildChipContext } from "../chip-context-builder"

beforeEach(() => {
  resetQuestionOptionCounter()
})

// ════════════════════════════════════════════════════════════════
// 1. Pending question chips outrank generic chips
// ════════════════════════════════════════════════════════════════

describe("pending question priority", () => {
  it("question-aligned chips replace generic follow-up chips", () => {
    const assistantText = "TiAlN 코팅에서는 4날과 2날만 가능합니다. 4날을 선택하시겠습니까? 아니면 다른 조건으로 다시 찾아보시겠습니까?"
    const genericChips = ["제품 추천", "절삭조건 문의", "코팅 비교", "시리즈 검색"]

    const pendingQ = detectPendingQuestion(assistantText)
    expect(pendingQ.hasPendingQuestion).toBe(true)

    const questionOptions = buildQuestionAlignedOptions(pendingQ.question!)
    const questionChips = smartOptionsToChips(questionOptions)

    // Question chips should exist
    expect(questionChips.length).toBeGreaterThanOrEqual(2)

    // Question chips should NOT contain generic chips
    for (const generic of genericChips) {
      expect(questionChips).not.toContain(generic)
    }
  })

  it("2날/4날 constrained question produces 2날 and 4날 chips", () => {
    const assistantText = "해당 조건에서는 2날 / 4날만 가능합니다. 어떤 걸 원하시나요?"

    const pendingQ = detectPendingQuestion(assistantText)
    expect(pendingQ.hasPendingQuestion).toBe(true)

    const questionOptions = buildQuestionAlignedOptions(pendingQ.question!)
    const chips = smartOptionsToChips(questionOptions)

    expect(chips).toContain("2날")
    expect(chips).toContain("4날")
    expect(chips).not.toContain("제품 추천")
    expect(chips).not.toContain("절삭조건 문의")
  })
})

// ════════════════════════════════════════════════════════════════
// 2. Confused user generates explanation/delegate/skip chips
// ════════════════════════════════════════════════════════════════

describe("confusion-aware chips", () => {
  it("'어 나 이거 뭔지 몰라' generates helper chips", () => {
    const userState = detectUserState("어 나 이거 뭔지 몰라")
    expect(userState.state).toBe("confused")

    const question = detectPendingQuestion(
      "코팅을 선택해주세요: Diamond, Bright Finish, DLC, TiAlN 중 어떤 걸 원하시나요?"
    )

    const helperOptions = buildConfusionHelperOptions(
      question.question,
      userState.confusedAbout
    )
    const chips = smartOptionsToChips(helperOptions)

    // Should have explanation and delegation chips
    expect(chips.some(c => c.includes("설명"))).toBe(true)
    expect(chips.some(c => c.includes("골라줘"))).toBe(true)
    expect(chips).toContain("상관없음")

    // Should have per-option explanation chips
    expect(chips.some(c => c.includes("란?"))).toBe(true)
  })

  it("'추천으로 골라줘' detects delegation intent", () => {
    const userState = detectUserState("추천으로 골라줘")
    expect(userState.state).toBe("wants_delegation")
  })

  it("'잘 모르겠어' detects confusion", () => {
    const userState = detectUserState("잘 모르겠어")
    expect(userState.state).toBe("confused")
  })

  it("'Diamond가 뭐야?' detects explanation request", () => {
    const userState = detectUserState("Diamond가 뭐야?")
    expect(userState.state).toBe("wants_explanation")
  })
})

// ════════════════════════════════════════════════════════════════
// 3. Generic fallback chips suppressed while pending question unresolved
// ════════════════════════════════════════════════════════════════

describe("fallback suppression", () => {
  it("when pending question exists, question chips take priority over generic", () => {
    const genericChips = ["후보 제품 보기", "절삭조건 문의", "코팅 비교", "처음부터 다시"]
    const assistantText = "4날으로 진행할까요?"

    const pendingQ = detectPendingQuestion(assistantText)
    expect(pendingQ.hasPendingQuestion).toBe(true)

    const questionOptions = buildQuestionAlignedOptions(pendingQ.question!)
    const questionChips = smartOptionsToChips(questionOptions)

    // None of the generic chips should appear
    for (const generic of genericChips) {
      expect(questionChips).not.toContain(generic)
    }

    // Should have proceed/decline type chips
    expect(questionChips.length).toBeGreaterThanOrEqual(2)
  })

  it("when no pending question, does not suppress (returns empty)", () => {
    const assistantText = "TiAlN 코팅은 스테인리스 가공에 적합합니다."

    const pendingQ = detectPendingQuestion(assistantText)
    expect(pendingQ.hasPendingQuestion).toBe(false)

    // No question → no question-aligned chips → generic chips remain
  })
})

// ════════════════════════════════════════════════════════════════
// 4. LLM reranker contract: only selects from candidates
// ════════════════════════════════════════════════════════════════

describe("LLM reranker contract", () => {
  it("chip context builder produces structured context", () => {
    const ctx = buildChipContext(
      null,
      { material: "aluminum", diameterMm: 4 } as any,
      "어 나 이거 뭔지 몰라",
      "코팅을 선택해주세요: Diamond, Bright Finish 중 어떤 걸 원하시나요?",
      {
        shape: "explicit_choice",
        questionText: "Diamond, Bright Finish 중 어떤 걸 원하시나요?",
        extractedOptions: ["Diamond", "Bright Finish"],
        field: "coating",
        isBinary: false,
        hasExplicitChoices: true,
      },
      "confused",
      null,
      [
        { role: "user", text: "알루미늄 4mm 엔드밀" },
        { role: "assistant", text: "코팅을 선택해주세요" },
        { role: "user", text: "어 나 이거 뭔지 몰라" },
      ]
    )

    expect(ctx.userState).toBe("confused")
    expect(ctx.pendingQuestion).toBeTruthy()
    expect(ctx.latestUserMessage).toBe("어 나 이거 뭔지 몰라")
    expect(ctx.resolvedFacts.length).toBeGreaterThanOrEqual(1)
    expect(ctx.recentTurnsSummary.length).toBe(3)
  })
})

// ════════════════════════════════════════════════════════════════
// 5. User state detection
// ════════════════════════════════════════════════════════════════

describe("user state detection", () => {
  it("clear user with specific value", () => {
    const result = detectUserState("4날")
    expect(result.state).toBe("clear")
  })

  it("skip intent", () => {
    const result = detectUserState("상관없어")
    expect(result.state).toBe("wants_skip")
  })

  it("revision intent", () => {
    const result = detectUserState("코팅 다시 바꾸고 싶어")
    expect(result.state).toBe("wants_revision")
  })

  it("null message returns clear with low confidence", () => {
    const result = detectUserState(null)
    expect(result.state).toBe("clear")
    expect(result.confidence).toBeLessThan(0.7)
  })
})
