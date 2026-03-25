/**
 * Phase 5 — Conversational Intelligence Tests
 *
 * Covers:
 *  1. extractSuggestedChips (LLM chip extraction & validation)
 *  2. buildFinalChipsFromLLM (dedup, fallback, filter validation, sorting, limits)
 *  3. formatConversationContextForLLM (structured context for LLM)
 *  4. response-validator dedup (near-duplicate chip removal)
 */

import { describe, it, expect } from "vitest"
import {
  extractSuggestedChips,
  buildFinalChipsFromLLM,
} from "../options/llm-chip-pipeline"
import type { LlmSuggestedChip } from "../options/llm-chip-pipeline"
import { formatConversationContextForLLM } from "../context/conversation-context-formatter"
import { validateSurfaceV2 } from "../../core/response-validator"
import type { CandidateSnapshot, ExplorationSessionState } from "../types"
import type { LlmTurnDecision } from "../../core/types"

// ── Mock Factories ──────────────────────────────────────────

function makeCandidateSnapshot(
  overrides: Partial<CandidateSnapshot> = {},
): CandidateSnapshot {
  return {
    rank: 1,
    productCode: "E5D7004010",
    displayCode: "E5D7004010",
    displayLabel: "4날 스퀘어 엔드밀",
    brand: "YG-1",
    seriesName: "ALU-POWER",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 3,
    coating: "AlTiN",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    lengthOfCutMm: 22,
    overallLengthMm: 72,
    helixAngleDeg: 45,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 92,
    matchStatus: "good_match" as const,
    totalStock: 100,
    stockStatus: "instock",
    ...overrides,
  }
}

function makeSessionState(
  overrides: Partial<ExplorationSessionState> = {},
): ExplorationSessionState {
  return {
    sessionId: "test",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
    turnCount: 3,
    lastAction: "continue_narrowing",
    currentMode: "question",
    displayedProducts: [],
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    lastAskedField: undefined,
    suspendedFlow: undefined,
    ...overrides,
  } as ExplorationSessionState
}

// ── 1. extractSuggestedChips ────────────────────────────────

describe("extractSuggestedChips", () => {
  it("returns empty array for missing suggestedChips", () => {
    expect(extractSuggestedChips({})).toEqual([])
  })

  it("returns empty array for null suggestedChips", () => {
    expect(extractSuggestedChips({ suggestedChips: null })).toEqual([])
  })

  it("returns empty array for non-array suggestedChips", () => {
    expect(extractSuggestedChips({ suggestedChips: "not an array" })).toEqual(
      [],
    )
    expect(extractSuggestedChips({ suggestedChips: 42 })).toEqual([])
    expect(
      extractSuggestedChips({ suggestedChips: { label: "x", type: "option" } }),
    ).toEqual([])
  })

  it("extracts valid chips with label and type", () => {
    const result = extractSuggestedChips({
      suggestedChips: [
        { label: "3날", type: "filter" },
        { label: "재고 있음", type: "filter" },
        { label: "추천 보기", type: "action" },
      ],
    })
    expect(result).toEqual([
      { label: "3날", type: "filter" },
      { label: "재고 있음", type: "filter" },
      { label: "추천 보기", type: "action" },
    ])
  })

  it("filters out chips with empty labels", () => {
    const result = extractSuggestedChips({
      suggestedChips: [
        { label: "", type: "option" },
        { label: "  ", type: "option" },
        { label: "유효한 칩", type: "option" },
      ],
    })
    expect(result).toEqual([{ label: "유효한 칩", type: "option" }])
  })

  it("filters out chips with labels > 20 chars", () => {
    const longLabel = "이것은이십자를초과하는매우긴레이블텍스트입니다"
    expect(longLabel.length).toBeGreaterThan(20)

    const result = extractSuggestedChips({
      suggestedChips: [
        { label: longLabel, type: "option" },
        { label: "짧은 칩", type: "option" },
      ],
    })
    expect(result).toEqual([{ label: "짧은 칩", type: "option" }])
  })

  it("filters out chips with invalid type", () => {
    const result = extractSuggestedChips({
      suggestedChips: [
        { label: "유효", type: "option" },
        { label: "잘못된타입", type: "unknown" },
        { label: "타입없음" },
        { label: "빈타입", type: "" },
      ],
    })
    expect(result).toEqual([{ label: "유효", type: "option" }])
  })

  it("limits to 10 chips max", () => {
    const chips = Array.from({ length: 15 }, (_, i) => ({
      label: `칩${i + 1}`,
      type: "option",
    }))

    const result = extractSuggestedChips({ suggestedChips: chips })
    expect(result).toHaveLength(10)
    expect(result[0].label).toBe("칩1")
    expect(result[9].label).toBe("칩10")
  })
})

// ── 2. buildFinalChipsFromLLM ───────────────────────────────

describe("buildFinalChipsFromLLM", () => {
  const defaultCandidates = [
    makeCandidateSnapshot({ rank: 1, fluteCount: 3, coating: "AlTiN" }),
    makeCandidateSnapshot({
      rank: 2,
      fluteCount: 4,
      coating: "DLC",
      displayCode: "E5D7004020",
    }),
  ]

  it("deduplicates against previous chips", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "3날", type: "filter" },
      { label: "추천 보기", type: "action" },
      { label: "새 칩", type: "option" },
    ]
    const previousChips = ["3날", "추천 보기"]

    const result = buildFinalChipsFromLLM(
      llmChips,
      makeSessionState(),
      defaultCandidates,
      previousChips,
    )
    // "3날" and "추천 보기" should be removed since they were in previousChips
    expect(result.chips).toContain("새 칩")
    expect(result.chips).not.toContain("3날")
    expect(result.chips).not.toContain("추천 보기")
  })

  it('adds "상관없음" and "← 이전" during narrowing (lastAskedField set)', () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "AlTiN", type: "option" },
    ]
    const session = makeSessionState({ lastAskedField: "coating" })

    const result = buildFinalChipsFromLLM(
      llmChips,
      session,
      defaultCandidates,
      [],
    )
    expect(result.chips).toContain("상관없음")
    expect(result.chips).toContain("← 이전")
  })

  it('adds "추천 이어가기" when suspendedFlow exists', () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "일반 질문", type: "action" },
    ]
    const session = makeSessionState({
      suspendedFlow: {
        pendingField: "coating",
        pendingQuestion: "코팅을 선택해주세요",
        displayedOptionsSnapshot: [],
      },
    })

    const result = buildFinalChipsFromLLM(
      llmChips,
      session,
      defaultCandidates,
      [],
    )
    expect(result.chips).toContain("추천 이어가기")
  })

  it("validates filter chips against candidate values", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "3날", type: "filter" }, // fluteCount=3 exists in candidates
      { label: "5날", type: "filter" }, // fluteCount=5 does NOT exist
    ]

    const result = buildFinalChipsFromLLM(
      llmChips,
      makeSessionState(),
      defaultCandidates,
      [],
    )
    expect(result.chips).toContain("3날")
    expect(result.chips).not.toContain("5날")
  })

  it("sorts by type priority (option > filter > action > navigation)", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "← 돌아가기", type: "navigation" },
      { label: "추천 보기", type: "action" },
      { label: "3날", type: "filter" },
      { label: "AlTiN", type: "option" },
    ]

    const result = buildFinalChipsFromLLM(
      llmChips,
      makeSessionState(),
      defaultCandidates,
      [],
    )

    const labels = result.chips
    const optionIdx = labels.indexOf("AlTiN")
    const filterIdx = labels.indexOf("3날")
    const actionIdx = labels.indexOf("추천 보기")
    const navIdx = labels.indexOf("← 돌아가기")

    expect(optionIdx).toBeLessThan(filterIdx)
    expect(filterIdx).toBeLessThan(actionIdx)
    expect(actionIdx).toBeLessThan(navIdx)
  })

  it("limits to 10 chips", () => {
    const llmChips: LlmSuggestedChip[] = Array.from(
      { length: 12 },
      (_, i) => ({
        label: `옵션${i + 1}`,
        type: "option" as const,
      }),
    )

    const result = buildFinalChipsFromLLM(
      llmChips,
      makeSessionState(),
      defaultCandidates,
      [],
    )
    expect(result.chips.length).toBeLessThanOrEqual(10)
    expect(result.displayedOptions.length).toBeLessThanOrEqual(10)
  })

  it("returns matching displayedOptions and chips arrays", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "3날", type: "filter" },
      { label: "추천 보기", type: "action" },
    ]

    const result = buildFinalChipsFromLLM(
      llmChips,
      makeSessionState(),
      defaultCandidates,
      [],
    )

    // chips should match displayedOptions labels
    expect(result.chips).toEqual(result.displayedOptions.map((o) => o.label))
    // displayedOptions should have proper structure
    for (const opt of result.displayedOptions) {
      expect(opt).toHaveProperty("index")
      expect(opt).toHaveProperty("label")
      expect(opt).toHaveProperty("field")
      expect(opt).toHaveProperty("value")
      expect(opt).toHaveProperty("count")
    }
  })
})

// ── 3. formatConversationContextForLLM ──────────────────────

describe("formatConversationContextForLLM", () => {
  it("formats recent messages into structured text", () => {
    const messages = [
      { role: "user" as const, text: "엔드밀 추천해주세요" },
      { role: "ai" as const, text: "어떤 소재를 가공하시나요?" },
      { role: "user" as const, text: "알루미늄입니다" },
    ]

    const result = formatConversationContextForLLM(
      messages,
      makeSessionState(),
      [],
      [],
    )

    expect(result).toContain("## 최근 대화")
    expect(result).toContain("엔드밀 추천해주세요")
    expect(result).toContain("어떤 소재를 가공하시나요?")
    expect(result).toContain("알루미늄입니다")
    expect(result).toContain("[Turn 1]")
    expect(result).toContain("user:")
    expect(result).toContain("assistant:")
  })

  it("includes current state section with filters and candidate count", () => {
    const session = makeSessionState({
      appliedFilters: [
        { field: "coating", op: "eq", value: "AlTiN" },
        { field: "fluteCount", op: "eq", value: "4" },
      ] as any,
      candidateCount: 15,
      currentMode: "question",
      resolutionStatus: "broad",
    })

    const result = formatConversationContextForLLM([], session, [], [])

    expect(result).toContain("## 현재 상태")
    expect(result).toContain("coating=AlTiN")
    expect(result).toContain("fluteCount=4")
    expect(result).toContain("question")
  })

  it("includes displayed candidates with specs", () => {
    const candidates = [
      makeCandidateSnapshot({
        rank: 1,
        displayCode: "E5D7004010",
        seriesName: "ALU-POWER",
        diameterMm: 10,
        fluteCount: 3,
        coating: "AlTiN",
        score: 92,
      }),
      makeCandidateSnapshot({
        rank: 2,
        displayCode: "E5D7004020",
        seriesName: "V7-PLUS",
        diameterMm: 12,
        fluteCount: 4,
        coating: "DLC",
        score: 88,
      }),
    ]

    const result = formatConversationContextForLLM(
      [],
      makeSessionState(),
      candidates,
      [],
    )

    expect(result).toContain("## 현재 표시된 제품")
    expect(result).toContain("#1")
    expect(result).toContain("E5D7004010")
    expect(result).toContain("ALU-POWER")
    expect(result).toContain("92점")
    expect(result).toContain("#2")
    expect(result).toContain("E5D7004020")
  })

  it("includes previous chips section", () => {
    const previousChips = ["3날", "4날", "재고 있음"]

    const result = formatConversationContextForLLM(
      [],
      makeSessionState(),
      [],
      previousChips,
    )

    expect(result).toContain("## 직전 칩")
    expect(result).toContain("3날")
    expect(result).toContain("4날")
    expect(result).toContain("재고 있음")
  })

  it("handles empty messages gracefully", () => {
    const result = formatConversationContextForLLM(
      [],
      makeSessionState(),
      [],
      [],
    )

    expect(result).toContain("## 최근 대화")
    expect(result).toContain("(없음)")
  })

  it("handles null sessionState", () => {
    const result = formatConversationContextForLLM([], null, [], [])

    expect(result).toContain("## 현재 상태")
    expect(result).toContain("초기 (세션 없음)")
  })
})

// ── 4. response-validator dedup ─────────────────────────────

describe("response-validator dedup", () => {
  function makeMinimalDecision(
    overrides: Partial<LlmTurnDecision> = {},
  ): LlmTurnDecision {
    return {
      phaseInterpretation: { currentPhase: "narrowing", confidence: 0.9 },
      actionInterpretation: {
        type: "continue_narrowing",
        confidence: 0.9,
      },
      answerIntent: {
        topic: "narrowing",
        needsGroundedFact: false,
      },
      nextQuestion: null,
      uiPlan: {
        optionMode: "chips",
        showProducts: false,
      },
      ...overrides,
    } as LlmTurnDecision
  }

  it("removes near-duplicate chips (same label ignoring whitespace/case)", () => {
    const surface = {
      answer: "추천 결과입니다.",
      displayedOptions: [
        { label: "3날", field: "fluteCount", value: "3" },
        { label: " 3날", field: "fluteCount", value: "3" },
        { label: "3 날", field: "fluteCount", value: "3" },
        { label: "4날", field: "fluteCount", value: "4" },
        { label: "4날", field: "fluteCount", value: "4" },
      ],
      chips: ["3날", " 3날", "3 날", "4날", "4날"],
    }

    const result = validateSurfaceV2(surface, makeMinimalDecision(), false)

    // After dedup, should only have unique normalized labels
    expect(result.chips).toContain("3날")
    expect(result.chips).toContain("4날")
    // Count: "3날", " 3날", "3 날" all normalize to "3날" -> only 1
    // "4날" x2 -> only 1
    expect(result.chips).toHaveLength(2)
    expect(result.displayedOptions).toHaveLength(2)
    expect(result.rewrites).toContain("deduped_llm_chips")
  })

  it("does not flag dedup when no duplicates exist", () => {
    const surface = {
      answer: "추천 결과입니다.",
      displayedOptions: [
        { label: "3날", field: "fluteCount", value: "3" },
        { label: "4날", field: "fluteCount", value: "4" },
      ],
      chips: ["3날", "4날"],
    }

    const result = validateSurfaceV2(surface, makeMinimalDecision(), false)

    expect(result.chips).toHaveLength(2)
    expect(result.rewrites).not.toContain("deduped_llm_chips")
  })
})
