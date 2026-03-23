/**
 * Question Assist Mode — Regression tests
 *
 * Tests:
 * 1. Explanation request keeps the original pending question alive
 * 2. Novice/help message does not reset the flow
 * 3. "상관없음" after explanation of a pending field skips that same field
 * 4. "추천으로 골라줘" after explanation is interpreted relative to the active field
 * 5. General-chat/onboarding fallback is suppressed when a real pending question exists
 * 6. Answer and chip generation stay aligned for question assist mode
 */

import { describe, it, expect } from "vitest"
import { classifyIntent, isExplicitResetIntent } from "@/lib/recommendation/infrastructure/agents/intent-classifier"
import { detectUserState } from "../user-understanding-detector"
import { buildConfusionHelperOptions, buildQuestionAlignedOptions } from "../../options/question-option-builder"
import type { ExplorationSessionState, RecommendationInput, DisplayedOption } from "../../types"

// ── Test Helpers ──────────────────────────────────────────────

function makeNarrowingSession(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-qa",
    candidateCount: 32,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      material: "aluminum",
      operationType: "side milling",
      diameterMm: 4,
      toolType: "endmill",
    } as RecommendationInput,
    turnCount: 1,
    lastAskedField: "coating",
    displayedCandidates: [],
    displayedChips: ["DLC (5개)", "AlTiN (3개)", "상관없음"],
    displayedOptions: [
      { index: 1, label: "DLC (5개)", value: "DLC", field: "coating", count: 5 },
      { index: 2, label: "AlTiN (3개)", value: "AlTiN", field: "coating", count: 3 },
    ] as DisplayedOption[],
    currentMode: "question",
    lastAction: "continue_narrowing",
    ...overrides,
  } as ExplorationSessionState
}

// Mock LLM provider (deterministic path only)
const mockProvider = {
  available: () => false,
  complete: async () => "{}",
  completeWithTools: async () => ({ text: null, toolUse: null }),
} as any

// ════════════════════════════════════════════════════════════════
// TEST 1: Explanation keeps pending question alive
// ════════════════════════════════════════════════════════════════

describe("Question assist: explanation preserves pending question", () => {
  it("confusion message is classified as ASK_EXPLANATION, not generic chat", async () => {
    const session = makeNarrowingSession()
    const result = await classifyIntent("응 저게 뭐야 나는 신입사원이야 ㅠㅠ", session, mockProvider)

    // Should NOT be OUT_OF_SCOPE or START_NEW_TOPIC
    expect(result.intent).not.toBe("OUT_OF_SCOPE")
    expect(result.intent).not.toBe("START_NEW_TOPIC")
    // Should be explanation-related
    expect(["ASK_EXPLANATION", "SELECT_OPTION"]).toContain(result.intent)
  })

  it("'잘 모르겠어' during coating question is detected as confusion", () => {
    const result = detectUserState("잘 모르겠어", "coating")
    expect(result.state).toBe("confused")
  })

  it("'설명해줘' during coating question is detected as wants_explanation", () => {
    const result = detectUserState("설명해줘", "coating")
    expect(result.state).toBe("wants_explanation")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Novice/help does not reset flow
// ════════════════════════════════════════════════════════════════

describe("Question assist: novice mode preserves flow", () => {
  it("'나 신입이라 모르겠어' classified as ASK_EXPLANATION with pending field", async () => {
    const session = makeNarrowingSession()
    const result = await classifyIntent("나 신입이라 모르겠어", session, mockProvider)

    expect(result.intent).toBe("ASK_EXPLANATION")
    // Should NOT reset or go to generic chat
    expect(result.intent).not.toBe("RESET_SESSION")
    expect(result.intent).not.toBe("START_NEW_TOPIC")
  })

  it("'처음이라 하나도 몰라' is novice signal, not reset", async () => {
    const session = makeNarrowingSession()
    const result = await classifyIntent("처음이라 하나도 몰라", session, mockProvider)

    // Must NOT be RESET_SESSION
    expect(result.intent).not.toBe("RESET_SESSION")
  })

  it("novice message does NOT trigger explicit reset", () => {
    expect(isExplicitResetIntent("나 신입이라 하나도 몰라")).toBe(false)
    expect(isExplicitResetIntent("처음이라 잘 모르겠어")).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: "상관없음" after explanation skips the same field
// ════════════════════════════════════════════════════════════════

describe("Question assist: field-bound skip after explanation", () => {
  it("'상관없음' with pending coating field classified as SELECT_OPTION", async () => {
    // Simulate: after explanation, session still has lastAskedField="coating"
    const sessionAfterExplanation = makeNarrowingSession({
      lastAskedField: "coating",
      currentMode: "question",
      lastAction: "explain_product",
    })

    const result = await classifyIntent("상관없음", sessionAfterExplanation, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })

  it("'모름' with pending coating field classified as skip", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "coating",
      lastAction: "explain_product",
    })

    const result = await classifyIntent("모름", session, mockProvider)
    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })

  it("'아무거나' with pending field treated as skip", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "fluteCount",
      lastAction: "explain_product",
    })

    const result = await classifyIntent("아무거나", session, mockProvider)
    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: "추천으로 골라줘" interpreted relative to active field
// ════════════════════════════════════════════════════════════════

describe("Question assist: field-bound delegate", () => {
  it("'추천으로 골라줘' with pending coating field → SELECT_OPTION skip", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "coating",
      lastAction: "explain_product",
    })

    const result = await classifyIntent("추천으로 골라줘", session, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
    expect(result.reasoning).toContain("delegate")
  })

  it("'무난한 걸로' with pending field → delegate skip", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "fluteCount",
    })

    const result = await classifyIntent("무난한 걸로", session, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })

  it("'네가 정해줘' with pending field → delegate skip", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "coating",
    })

    const result = await classifyIntent("네가 정해줘", session, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: General-chat fallback suppressed when pending question
// ════════════════════════════════════════════════════════════════

describe("Question assist: suppress general-chat fallback", () => {
  it("skip patterns are caught BEFORE LLM routing when field is pending", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "toolSubtype",
      currentMode: "general_chat",  // Simulate: mode was changed after explanation
      lastAction: "answer_general",
    })

    // Even with general_chat mode, skip should still be caught
    const result = await classifyIntent("상관없음", session, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })

  it("delegation is caught even when mode is general_chat", async () => {
    const session = makeNarrowingSession({
      lastAskedField: "coating",
      currentMode: "general_chat",
      lastAction: "answer_general",
    })

    const result = await classifyIntent("알아서 골라줘", session, mockProvider)

    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("상관없음")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 6: Helper chips stay field-aligned
// ════════════════════════════════════════════════════════════════

describe("Question assist: chip alignment", () => {
  it("confusion helper chips include skip option bound to pending field", () => {
    const pendingQuestion = {
      shape: "constrained_options" as const,
      questionText: "코팅 종류 선호가 있으신가요?",
      extractedOptions: ["DLC", "AlTiN"],
      field: "coating",
      isBinary: false,
      hasExplicitChoices: true,
    }

    const helpers = buildConfusionHelperOptions(pendingQuestion, null)

    // Must have skip option with field bound to "coating"
    const skipOpt = helpers.find(h => h.value === "skip")
    expect(skipOpt).toBeTruthy()
    expect(skipOpt!.plan.patches).toContainEqual(
      expect.objectContaining({ field: "coating", value: "skip" })
    )

    // Must have explain and delegate options
    expect(helpers.some(h => h.label === "쉽게 설명해줘")).toBe(true)
    expect(helpers.some(h => h.label === "추천으로 골라줘")).toBe(true)
  })

  it("merged chips include both helpers AND original field options", () => {
    const pendingQuestion = {
      shape: "constrained_options" as const,
      questionText: "코팅 종류 선호가 있으신가요?",
      extractedOptions: ["DLC", "AlTiN"],
      field: "coating",
      isBinary: false,
      hasExplicitChoices: true,
    }

    const helpers = buildConfusionHelperOptions(pendingQuestion, null)
    const fieldOptions = buildQuestionAlignedOptions(pendingQuestion)
    const merged = [...helpers, ...fieldOptions]

    // Should have helpers
    expect(merged.some(o => o.label === "쉽게 설명해줘")).toBe(true)
    expect(merged.some(o => o.label === "추천으로 골라줘")).toBe(true)

    // Should ALSO have original field values
    expect(merged.some(o => o.value === "DLC")).toBe(true)
    expect(merged.some(o => o.value === "AlTiN")).toBe(true)
  })
})
