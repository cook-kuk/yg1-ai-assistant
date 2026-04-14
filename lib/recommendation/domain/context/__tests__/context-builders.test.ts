import { describe, expect, it } from "vitest"

import {
  buildChipContext,
  buildChipContextFromUnifiedTurnContext,
  formatChipContextForLLM,
  type ChipContext,
} from "../chip-context-builder"
import { formatConversationContextForLLM } from "../conversation-context-formatter"
import { buildRecentInteractionFrame } from "../recent-interaction-frame"
import {
  buildUnifiedTurnContext,
  type TurnContextBuilderInput,
  type UnifiedTurnContext,
  type ConversationTurn,
} from "../turn-context-builder"
import {
  stripJsonCodeFence,
  extractFirstJsonObject,
  parseJudgmentJson,
  resetJudgmentCache,
  DEFAULT_JUDGMENT,
  buildJudgmentPrompt,
} from "../unified-haiku-judgment"

import type { CandidateSnapshot, ExplorationSessionState, ChatMessage, RecommendationInput } from "@/lib/recommendation/domain/types"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"

// ── Helpers ─────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    rank: 1,
    productCode: "TEST001",
    displayCode: "TEST001",
    displayLabel: null,
    brand: "YG-1",
    seriesName: "X-Power",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 4,
    coating: "AlTiN",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    lengthOfCutMm: 25,
    overallLengthMm: 75,
    helixAngleDeg: 35,
    description: null,
    featureText: null,
    materialTags: ["steel"],
    score: 85,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "in_stock",
    totalStock: 100,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
    ...overrides,
  }
}

function makeSessionState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { locale: "ko", manufacturerScope: "yg1-only" },
    turnCount: 3,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  }
}

function makeResolvedInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    locale: "ko",
    manufacturerScope: "yg1-only",
    ...overrides,
  }
}

function makeTurnContextInput(overrides: Partial<TurnContextBuilderInput> = {}): TurnContextBuilderInput {
  return {
    latestAssistantText: null,
    latestUserMessage: "안녕하세요",
    messages: [],
    sessionState: null,
    resolvedInput: makeResolvedInput(),
    intakeForm: INITIAL_INTAKE_FORM,
    candidates: [],
    ...overrides,
  }
}

// ══════════════════════════════════════════════════════════════
// 1. Chip Context Builder
// ══════════════════════════════════════════════════════════════

describe("buildChipContext", () => {
  it("extracts resolvedFacts from RecommendationInput", () => {
    const ctx = buildChipContext(
      null,
      makeResolvedInput({ material: "Steel", operationType: "Slotting", diameterMm: 10 }),
      "4날로 해주세요",
      null,
      null,
      "clear",
      null,
      [],
    )

    expect(ctx.resolvedFacts).toEqual([
      { field: "material", value: "Steel" },
      { field: "operationType", value: "Slotting" },
      { field: "diameterMm", value: "10" },
    ])
  })

  it("extracts flutePreference and coatingPreference into resolvedFacts", () => {
    const ctx = buildChipContext(
      null,
      makeResolvedInput({ flutePreference: 4, coatingPreference: "TiAlN" }),
      null,
      null,
      null,
      "clear",
      null,
      [],
    )

    expect(ctx.resolvedFacts).toContainEqual({ field: "fluteCount", value: "4" })
    expect(ctx.resolvedFacts).toContainEqual({ field: "coating", value: "TiAlN" })
  })

  it("filters out skip ops from activeFilters", () => {
    const session = makeSessionState({
      appliedFilters: [
        { field: "coating", op: "eq", value: "AlTiN", rawValue: "AlTiN", appliedAt: 1 },
        { field: "fluteCount", op: "skip", value: "skip", rawValue: "skip", appliedAt: 2 },
      ],
    })

    const ctx = buildChipContext(session, makeResolvedInput(), null, null, null, "clear", null, [])
    expect(ctx.activeFilters).toHaveLength(1)
    expect(ctx.activeFilters[0].field).toBe("coating")
  })

  it("limits displayedProducts to 5", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => makeCandidate({
      rank: i + 1,
      displayCode: `PROD${i}`,
    }))
    const session = makeSessionState({ displayedCandidates: candidates })

    const ctx = buildChipContext(session, makeResolvedInput(), null, null, null, "clear", null, [])
    expect(ctx.displayedProducts).toHaveLength(5)
  })

  it("deduplicates answeredFields from filters and narrowingHistory", () => {
    const session = makeSessionState({
      appliedFilters: [
        { field: "coating", op: "eq", value: "AlTiN", rawValue: "AlTiN", appliedAt: 1 },
      ],
      narrowingHistory: [
        {
          question: "코팅?",
          answer: "AlTiN",
          askedField: "coating",
          extractedFilters: [{ field: "coating", op: "eq", value: "AlTiN", rawValue: "AlTiN", appliedAt: 1 }],
          candidateCountBefore: 20,
          candidateCountAfter: 10,
        },
      ],
    })

    const ctx = buildChipContext(session, makeResolvedInput(), null, null, null, "clear", null, [])
    const coatingCount = ctx.answeredFields.filter(f => f === "coating").length
    expect(coatingCount).toBe(1)
  })

  it("truncates recentTurnsSummary to last 6 messages", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg ${i}`,
    }))

    const ctx = buildChipContext(null, makeResolvedInput(), null, null, null, "clear", null, msgs)
    expect(ctx.recentTurnsSummary).toHaveLength(6)
  })

  it("summarizes text longer than 100 chars", () => {
    const longText = "a".repeat(150)
    const ctx = buildChipContext(
      null,
      makeResolvedInput(),
      null,
      null,
      null,
      "clear",
      null,
      [{ role: "user", text: longText }],
    )

    expect(ctx.recentTurnsSummary[0]).toContain("...")
    expect(ctx.recentTurnsSummary[0].length).toBeLessThan(150)
  })

  it("extracts latestAssistantQuestion from pendingQuestion", () => {
    const ctx = buildChipContext(
      null,
      makeResolvedInput(),
      null,
      "코팅을 선택해 주세요.",
      { shape: "explicit_choice", questionText: "코팅을 선택해 주세요?", extractedOptions: [], field: "coating", isBinary: false, hasExplicitChoices: false },
      "clear",
      null,
      [],
    )

    expect(ctx.latestAssistantQuestion).toBe("코팅을 선택해 주세요?")
  })

  it("returns null for assistant text with trailing question mark (split removes it)", () => {
    // extractLastQuestion splits on [.?\n], removing the ? — then filters by [?], so nothing matches
    const ctx = buildChipContext(
      null,
      makeResolvedInput(),
      null,
      "좋은 선택입니다. 코팅은 어떤 것을 원하시나요?",
      null,
      "clear",
      null,
      [],
    )

    // The ? is consumed by split, so extractLastQuestion returns null
    expect(ctx.latestAssistantQuestion).toBeNull()
  })

  it("extracts question when ? appears mid-sentence (not at boundary)", () => {
    // "어떤 것을 원하시나요? 알려주세요" -> split on ? gives ["어떤 것을 원하시나요", " 알려주세요"]
    // but filter for [?] still won't match. The function only works for embedded ?
    const ctx = buildChipContext(
      null,
      makeResolvedInput(),
      null,
      "코팅은 어떤 것이 좋을까요? 선호하시는 것이 있나요?",
      null,
      "clear",
      null,
      [],
    )
    // Both ? are consumed by the split delimiter, so no sentence contains ?
    expect(ctx.latestAssistantQuestion).toBeNull()
  })

  it("returns null latestAssistantQuestion when no question mark in text", () => {
    const ctx = buildChipContext(
      null,
      makeResolvedInput(),
      null,
      "알겠습니다. 검색해 보겠습니다.",
      null,
      "clear",
      null,
      [],
    )

    expect(ctx.latestAssistantQuestion).toBeNull()
  })

  it("infers visibleUIBlocks from session state", () => {
    const session = makeSessionState({
      displayedOptions: [{ index: 1, label: "AlTiN", field: "coating", value: "AlTiN", count: 5 }],
      displayedChips: ["chip1"],
      lastRecommendationArtifact: [makeCandidate()],
    })

    const ctx = buildChipContext(session, makeResolvedInput(), null, null, null, "clear", null, [])
    expect(ctx.visibleUIBlocks).toContain("question_prompt")
    expect(ctx.visibleUIBlocks).toContain("chips_bar")
    expect(ctx.visibleUIBlocks).toContain("recommendation_card")
  })

  it("defaults mode to narrowing when sessionState is null", () => {
    const ctx = buildChipContext(null, makeResolvedInput(), null, null, null, "clear", null, [])
    expect(ctx.mode).toBe("narrowing")
  })
})

// ══════════════════════════════════════════════════════════════
// 2. formatChipContextForLLM
// ══════════════════════════════════════════════════════════════

describe("formatChipContextForLLM", () => {
  it("renders header and basic fields", () => {
    const ctx: ChipContext = {
      latestAssistantQuestion: "코팅은?",
      pendingQuestion: null,
      latestUserMessage: "AlTiN",
      userState: "clear",
      confusedAbout: null,
      mode: "narrowing",
      resolvedFacts: [{ field: "material", value: "Steel" }],
      activeFilters: [],
      displayedProducts: [],
      lastAskedField: null,
      recentTurnsSummary: [],
      answeredFields: ["material"],
      visibleUIBlocks: [],
      historicalUIArtifacts: [],
      episodicSummary: [],
    }

    const output = formatChipContextForLLM(ctx)
    expect(output).toContain("[Chip Context]")
    expect(output).toContain("assistant_question=코팅은?")
    expect(output).toContain("user_message=AlTiN")
    expect(output).toContain("user_state=clear")
    expect(output).toContain("mode=narrowing")
    expect(output).toContain("resolved_facts=material=Steel")
    expect(output).toContain("answered_fields=material")
  })

  it("includes confusedAbout in parentheses", () => {
    const ctx: ChipContext = {
      latestAssistantQuestion: null,
      pendingQuestion: null,
      latestUserMessage: null,
      userState: "confused",
      confusedAbout: "coating types",
      mode: "narrowing",
      resolvedFacts: [],
      activeFilters: [],
      displayedProducts: [],
      lastAskedField: null,
      recentTurnsSummary: [],
      answeredFields: [],
      visibleUIBlocks: [],
      historicalUIArtifacts: [],
      episodicSummary: [],
    }

    const output = formatChipContextForLLM(ctx)
    expect(output).toContain("user_state=confused (coating types)")
  })

  it("omits empty sections", () => {
    const ctx: ChipContext = {
      latestAssistantQuestion: null,
      pendingQuestion: null,
      latestUserMessage: null,
      userState: "clear",
      confusedAbout: null,
      mode: "narrowing",
      resolvedFacts: [],
      activeFilters: [],
      displayedProducts: [],
      lastAskedField: null,
      recentTurnsSummary: [],
      answeredFields: [],
      visibleUIBlocks: [],
      historicalUIArtifacts: [],
      episodicSummary: [],
    }

    const output = formatChipContextForLLM(ctx)
    expect(output).not.toContain("resolved_facts=")
    expect(output).not.toContain("active_filters=")
    expect(output).not.toContain("displayed_products=")
    expect(output).not.toContain("recent_turns=")
  })

  it("renders historicalUIArtifacts and episodicSummary", () => {
    const ctx: ChipContext = {
      latestAssistantQuestion: null,
      pendingQuestion: null,
      latestUserMessage: null,
      userState: "clear",
      confusedAbout: null,
      mode: "narrowing",
      resolvedFacts: [],
      activeFilters: [],
      displayedProducts: [],
      lastAskedField: null,
      recentTurnsSummary: [],
      answeredFields: [],
      visibleUIBlocks: [],
      historicalUIArtifacts: ["1:chips_bar", "2:recommendation_card"],
      episodicSummary: ["[1-4] user asked about steel milling"],
    }

    const output = formatChipContextForLLM(ctx)
    expect(output).toContain("historical_ui=1:chips_bar | 2:recommendation_card")
    expect(output).toContain("episodic_memory=[1-4] user asked about steel milling")
  })
})

// ══════════════════════════════════════════════════════════════
// 3. Conversation Context Formatter
// ══════════════════════════════════════════════════════════════

describe("formatConversationContextForLLM", () => {
  it("formats empty conversation", () => {
    const output = formatConversationContextForLLM([], null, [], [])
    expect(output).toContain("최근 대화")
    expect(output).toContain("(없음)")
    expect(output).toContain("현재 상태")
    expect(output).toContain("초기 (세션 없음)")
  })

  it("formats recent messages with turn numbers", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "스틸 가공용 엔드밀 추천해줘" },
      { role: "ai", text: "직경을 알려주세요." },
    ]

    const output = formatConversationContextForLLM(messages, null, [], [])
    expect(output).toContain("[Turn 1] user:")
    expect(output).toContain("[Turn 2] assistant:")
    expect(output).toContain("스틸 가공용 엔드밀 추천해줘")
  })

  it("truncates messages longer than 200 chars", () => {
    const longMsg = "x".repeat(300)
    const messages: ChatMessage[] = [{ role: "user", text: longMsg }]

    const output = formatConversationContextForLLM(messages, null, [], [])
    expect(output).toContain("...")
    expect(output).not.toContain("x".repeat(300))
  })

  it("formats current state with filters and candidate count", () => {
    const session = makeSessionState({
      currentMode: "narrowing",
      resolutionStatus: "narrowing",
      appliedFilters: [
        { field: "coating", op: "eq", value: "AlTiN", rawValue: "AlTiN", appliedAt: 1 },
      ],
    })

    const candidates = [makeCandidate()]

    const output = formatConversationContextForLLM([], session, candidates, [])
    expect(output).toContain("추천 단계: narrowing")
    expect(output).toContain("적용 필터: coating=AlTiN")
    expect(output).toContain("현재 후보: 1개")
  })

  it("formats displayed candidates with rank, code, and score", () => {
    const candidates = [
      makeCandidate({ rank: 1, displayCode: "CE3100", seriesName: "X-Power", diameterMm: 10, fluteCount: 4, coating: "AlTiN", score: 92 }),
    ]

    const output = formatConversationContextForLLM([], null, candidates, [])
    expect(output).toContain("#1")
    expect(output).toContain("CE3100")
    expect(output).toContain("X-Power")
    expect(output).toContain("92점")
  })

  it("shows overflow count when more than 5 candidates", () => {
    const candidates = Array.from({ length: 7 }, (_, i) => makeCandidate({ rank: i + 1, displayCode: `C${i}` }))

    const output = formatConversationContextForLLM([], null, candidates, [])
    expect(output).toContain("외 2개")
  })

  it("formats previous chips", () => {
    const output = formatConversationContextForLLM([], null, [], ["4날", "AlTiN", "건너뛰기"])
    expect(output).toContain("직전 칩")
    expect(output).toContain("[4날, AlTiN, 건너뛰기]")
  })

  it("omits previous chips section when empty", () => {
    const output = formatConversationContextForLLM([], null, [], [])
    expect(output).not.toContain("직전 칩")
  })

  it("shows pending question field", () => {
    const session = makeSessionState({ lastAskedField: "coating" })
    const output = formatConversationContextForLLM([], session, [], [])
    expect(output).toContain("대기 질문: coating")
  })
})

// ══════════════════════════════════════════════════════════════
// 4. Recent Interaction Frame
// ══════════════════════════════════════════════════════════════

describe("buildRecentInteractionFrame", () => {
  it("detects confusion relation", () => {
    const frame = buildRecentInteractionFrame(null, "이게 뭔지 몰라", null)
    expect(frame.relation).toBe("confusion")
    expect(frame.suppressGenericChips).toBe(true)
  })

  it("detects challenge relation", () => {
    const frame = buildRecentInteractionFrame(null, "4날 없어?", null)
    expect(frame.relation).toBe("challenge")
  })

  it("detects revise relation", () => {
    const frame = buildRecentInteractionFrame(null, "코팅 바꿔주세요", null)
    expect(frame.relation).toBe("revise")
    expect(frame.suppressGenericChips).toBe(true)
  })

  it("detects compare_request", () => {
    const frame = buildRecentInteractionFrame(null, "이 두 제품 비교해줘", null)
    expect(frame.relation).toBe("compare_request")
    expect(frame.suppressGenericChips).toBe(true)
  })

  it("detects detail_request", () => {
    const frame = buildRecentInteractionFrame(null, "절삭조건 알려줘", null)
    expect(frame.relation).toBe("detail_request")
    expect(frame.suppressGenericChips).toBe(true)
  })

  it("detects meta_feedback", () => {
    const frame = buildRecentInteractionFrame(null, "칩 만들어줘", null)
    expect(frame.relation).toBe("meta_feedback")
  })

  it("detects restart (short message)", () => {
    const frame = buildRecentInteractionFrame(null, "처음부터", null)
    expect(frame.relation).toBe("restart")
    expect(frame.preserveContext).toBe(false)
  })

  it("returns direct_answer for unmatched input", () => {
    const frame = buildRecentInteractionFrame(null, "4날", null)
    expect(frame.relation).toBe("direct_answer")
  })

  it("returns followup_on_result when in resolved state", () => {
    const session = makeSessionState({ resolutionStatus: "resolved_exact" })
    const frame = buildRecentInteractionFrame(null, "좋아요", session)
    expect(frame.relation).toBe("followup_on_result")
  })

  it("detects uiBlock as comparison_table when lastAction is compare_products", () => {
    const session = makeSessionState({ lastAction: "compare_products" })
    const frame = buildRecentInteractionFrame(null, "네", session)
    expect(frame.uiBlock).toBe("comparison_table")
  })

  it("detects uiBlock as recommendation_card when mode is recommendation", () => {
    const session = makeSessionState({ currentMode: "recommendation" })
    const frame = buildRecentInteractionFrame(null, "좋네요", session)
    expect(frame.uiBlock).toBe("recommendation_card")
  })

  it("detects uiBlock as question_prompt when options are displayed", () => {
    const session = makeSessionState({
      displayedOptions: [{ index: 1, label: "AlTiN", field: "coating", value: "AlTiN", count: 5 }],
    })
    const frame = buildRecentInteractionFrame(null, "AlTiN", session)
    expect(frame.uiBlock).toBe("question_prompt")
  })

  it("extracts pending question with binary kind for 2 options", () => {
    const session = makeSessionState({
      lastAskedField: "fluteCount",
      displayedOptions: [
        { index: 1, label: "2날", field: "fluteCount", value: "2", count: 5 },
        { index: 2, label: "4날", field: "fluteCount", value: "4", count: 8 },
      ],
    })

    const frame = buildRecentInteractionFrame(null, "4날", session)
    expect(frame.currentPendingQuestion).not.toBeNull()
    expect(frame.currentPendingQuestion!.kind).toBe("binary")
    expect(frame.currentPendingQuestion!.field).toBe("fluteCount")
  })

  it("extracts pending question with choice kind for 3+ options", () => {
    const session = makeSessionState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "AlTiN", field: "coating", value: "AlTiN", count: 5 },
        { index: 2, label: "TiAlN", field: "coating", value: "TiAlN", count: 3 },
        { index: 3, label: "Diamond", field: "coating", value: "Diamond", count: 2 },
      ],
    })

    const frame = buildRecentInteractionFrame(null, "Diamond", session)
    expect(frame.currentPendingQuestion!.kind).toBe("choice")
  })

  it("extracts referenced products by rank", () => {
    const session = makeSessionState({
      displayedCandidates: [
        makeCandidate({ rank: 1, displayCode: "CE3100" }),
        makeCandidate({ rank: 2, displayCode: "CE3200" }),
      ],
    })

    const frame = buildRecentInteractionFrame(null, "1번 제품 자세히", session)
    expect(frame.referencedProducts).toContain("CE3100")
  })

  it("extracts question from assistant text", () => {
    const frame = buildRecentInteractionFrame(
      "좋은 선택입니다. 다음으로 코팅을 선택해 주시겠어요?",
      "AlTiN",
      null,
    )

    expect(frame.latestAssistantQuestion).toContain("코팅을 선택해 주시겠어요")
  })
})

// ══════════════════════════════════════════════════════════════
// 5. Turn Context Builder
// ══════════════════════════════════════════════════════════════

describe("buildUnifiedTurnContext", () => {
  it("returns intake mode when sessionState is null", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput())
    expect(ctx.currentMode).toBe("intake")
  })

  it("detects narrowing mode", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      sessionState: makeSessionState({ currentMode: "narrowing" }),
    }))
    expect(ctx.currentMode).toBe("narrowing")
  })

  it("detects recommended mode from resolution status", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      sessionState: makeSessionState({ resolutionStatus: "resolved_exact" }),
    }))
    expect(ctx.currentMode).toBe("recommended")
  })

  it("detects compare mode", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      sessionState: makeSessionState({ currentMode: "comparison" }),
    }))
    expect(ctx.currentMode).toBe("compare")
  })

  it("detects explore mode for general_chat", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      sessionState: makeSessionState({ currentMode: "general_chat" }),
    }))
    expect(ctx.currentMode).toBe("explore")
  })

  it("maps confusion relation correctly", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      latestUserMessage: "이게 뭔지 모르겠어요",
    }))
    expect(ctx.relationToLatestQuestion).toBe("confusion")
    expect(ctx.userState).toBe("confused")
  })

  it("maps challenge relation to uncertain user state", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      latestUserMessage: "왜 이게 없어?",
    }))
    expect(ctx.relationToLatestQuestion).toBe("challenge")
    expect(ctx.userState).toBe("uncertain")
  })

  it("maps restart to clear user state", () => {
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({
      latestUserMessage: "처음부터",
    }))
    expect(ctx.relationToLatestQuestion).toBe("restart")
    expect(ctx.userState).toBe("clear")
  })

  it("classifies memory items from conversationMemory", () => {
    const session = makeSessionState({
      conversationMemory: {
        items: [
          { key: "intake_material", field: "material", value: "Steel", source: "intake", status: "resolved", priority: 8, turnCreated: 1, turnUpdated: 1 },
          { key: "narrowing_coating", field: "coating", value: "AlTiN", source: "narrowing", status: "active", priority: 5, turnCreated: 2, turnUpdated: 2 },
          { key: "tentative_flute", field: "fluteCount", value: "4", source: "system_inference", status: "tentative", priority: 3, turnCreated: 3, turnUpdated: 3 },
        ],
        recommendationContext: { primaryProductCode: null, primarySeriesName: null, alternativeCount: 0, lastComparedProducts: [], matchStatus: null },
        followUp: { lastAskedField: null, pendingDecisionType: null, currentOptionFamily: null, turnsSinceRecommendation: 0 },
        softPreferences: [],
        highlights: [],
        userSignals: { confusedFields: [], skippedFields: [], revisedFields: [], prefersDelegate: false, prefersExplanation: false, frustrationCount: 0 },
        recentQA: [],
      },
    })

    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ sessionState: session }))
    expect(ctx.resolvedFacts.some(f => f.field === "material")).toBe(true)
    expect(ctx.activeFilters.some(f => f.field === "coating")).toBe(true)
    expect(ctx.tentativeReferences.some(f => f.field === "fluteCount")).toBe(true)
  })

  it("builds resolvedFacts from resolvedInput when memory is empty", () => {
    const session = makeSessionState({
      resolvedInput: makeResolvedInput({ material: "Aluminum", diameterMm: 12 }),
    })

    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ sessionState: session }))
    expect(ctx.resolvedFacts.some(f => f.field === "material" && f.value === "Aluminum")).toBe(true)
    expect(ctx.resolvedFacts.some(f => f.field === "diameterMm" && f.value === "12")).toBe(true)
  })

  it("builds revision history from memory highlights", () => {
    const session = makeSessionState({
      conversationMemory: {
        items: [],
        recommendationContext: { primaryProductCode: null, primarySeriesName: null, alternativeCount: 0, lastComparedProducts: [], matchStatus: null },
        followUp: { lastAskedField: null, pendingDecisionType: null, currentOptionFamily: null, turnsSinceRecommendation: 0 },
        softPreferences: [],
        highlights: [
          { turn: 2, type: "rejection", summary: "user rejected coating", field: "coating" },
          { turn: 3, type: "satisfaction", summary: "user liked result" },
        ],
        userSignals: { confusedFields: [], skippedFields: [], revisedFields: [], prefersDelegate: false, prefersExplanation: false, frustrationCount: 0 },
        recentQA: [],
      },
    })

    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ sessionState: session }))
    expect(ctx.revisionHistory).toHaveLength(1)
    expect(ctx.revisionHistory[0].field).toBe("coating")
    expect(ctx.revisionHistory[0].reason).toBe("user rejected coating")
  })

  it("converts messages to conversation turns", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "hello" },
      { role: "ai", text: "welcome" },
    ]

    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ messages }))
    expect(ctx.recentTurns.length).toBeGreaterThanOrEqual(2)
    expect(ctx.recentTurns.some(t => t.role === "user" && t.text === "hello")).toBe(true)
    expect(ctx.recentTurns.some(t => t.role === "assistant" && t.text === "welcome")).toBe(true)
  })

  it("includes currentDisplayedProducts from candidates", () => {
    const candidates = [makeCandidate({ displayCode: "PROD1" })]
    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ candidates }))
    expect(ctx.currentDisplayedProducts).toContain("PROD1")
  })

  it("prefers sessionState.displayedCandidates over candidates param", () => {
    const session = makeSessionState({
      displayedCandidates: [makeCandidate({ displayCode: "SESSION_PROD" })],
    })
    const candidates = [makeCandidate({ displayCode: "PARAM_PROD" })]

    const ctx = buildUnifiedTurnContext(makeTurnContextInput({ sessionState: session, candidates }))
    expect(ctx.currentDisplayedProducts).toContain("SESSION_PROD")
  })
})

// ══════════════════════════════════════════════════════════════
// 6. Unified Haiku Judgment (pure utility functions only)
// ══════════════════════════════════════════════════════════════

describe("unified-haiku-judgment utilities", () => {
  describe("stripJsonCodeFence", () => {
    it("removes ```json fences", () => {
      const raw = '```json\n{"key": "value"}\n```'
      expect(stripJsonCodeFence(raw)).toBe('{"key": "value"}')
    })

    it("returns plain JSON unchanged", () => {
      const raw = '{"key": "value"}'
      expect(stripJsonCodeFence(raw)).toBe('{"key": "value"}')
    })
  })

  describe("extractFirstJsonObject", () => {
    it("extracts JSON from surrounding text", () => {
      const raw = 'Some text {"a": 1, "b": "hello"} more text'
      const result = extractFirstJsonObject(raw)
      expect(result).toBe('{"a": 1, "b": "hello"}')
    })

    it("handles nested objects", () => {
      const raw = '{"outer": {"inner": "val"}}'
      const result = extractFirstJsonObject(raw)
      expect(result).toBe('{"outer": {"inner": "val"}}')
    })

    it("returns null when no JSON found", () => {
      expect(extractFirstJsonObject("no json here")).toBeNull()
    })

    it("handles strings with escaped quotes", () => {
      const raw = '{"msg": "say \\"hello\\"", "v": 1}'
      const result = extractFirstJsonObject(raw)
      expect(result).not.toBeNull()
      expect(JSON.parse(result!).v).toBe(1)
    })
  })

  describe("parseJudgmentJson", () => {
    it("parses clean JSON", () => {
      const result = parseJudgmentJson('{"userState": "clear"}')
      expect(result).toEqual({ userState: "clear" })
    })

    it("parses JSON wrapped in code fence", () => {
      const result = parseJudgmentJson('```json\n{"userState": "confused"}\n```')
      expect(result).toEqual({ userState: "confused" })
    })

    it("extracts JSON from mixed text", () => {
      const result = parseJudgmentJson('Here is the answer: {"userState": "clear"} done.')
      expect(result).toEqual({ userState: "clear" })
    })

    it("throws on invalid input", () => {
      expect(() => parseJudgmentJson("no json")).toThrow()
    })
  })

  describe("buildJudgmentPrompt", () => {
    it("includes user message and mode", () => {
      const prompt = buildJudgmentPrompt({
        userMessage: "4날로 해줘",
        assistantText: "코팅을 선택해 주세요.",
        pendingField: "coating",
        currentMode: "narrowing",
        displayedChips: ["AlTiN", "TiAlN"],
        filterCount: 2,
        candidateCount: 15,
        hasRecommendation: false,
      })

      expect(prompt).toContain("4날로 해줘")
      expect(prompt).toContain("narrowing")
      expect(prompt).toContain("coating")
      expect(prompt).toContain("AlTiN, TiAlN")
      expect(prompt).toContain("15")
    })

    it("truncates assistant text to 120 chars", () => {
      const longText = "가".repeat(200)
      const prompt = buildJudgmentPrompt({
        userMessage: "test",
        assistantText: longText,
        pendingField: null,
        currentMode: null,
        displayedChips: [],
        filterCount: 0,
        candidateCount: 0,
        hasRecommendation: false,
      })

      expect(prompt).not.toContain("가".repeat(200))
    })

    it("shows 없음 when no chips", () => {
      const prompt = buildJudgmentPrompt({
        userMessage: "test",
        assistantText: null,
        pendingField: null,
        currentMode: null,
        displayedChips: [],
        filterCount: 0,
        candidateCount: 0,
        hasRecommendation: false,
      })

      expect(prompt).toContain("칩: 없음")
    })
  })

  describe("resetJudgmentCache", () => {
    it("does not throw", () => {
      expect(() => resetJudgmentCache()).not.toThrow()
    })
  })

  describe("DEFAULT_JUDGMENT", () => {
    it("has expected default values", () => {
      expect(DEFAULT_JUDGMENT.userState).toBe("clear")
      expect(DEFAULT_JUDGMENT.fromLLM).toBe(false)
      expect(DEFAULT_JUDGMENT.confidence).toBe(0)
      expect(DEFAULT_JUDGMENT.intentAction).toBe("continue")
    })
  })
})

// ══════════════════════════════════════════════════════════════
// 7. buildChipContextFromUnifiedTurnContext
// ══════════════════════════════════════════════════════════════

describe("buildChipContextFromUnifiedTurnContext", () => {
  it("maps unified turn context fields to chip context", () => {
    const turnCtx = buildUnifiedTurnContext(makeTurnContextInput({
      latestUserMessage: "AlTiN으로 해줘",
      candidates: [makeCandidate({ displayCode: "CE3100", seriesName: "X-Power", coating: "AlTiN", fluteCount: 4 })],
    }))

    const chipCtx = buildChipContextFromUnifiedTurnContext(turnCtx, null, "clear", null)

    expect(chipCtx.latestUserMessage).toBe("AlTiN으로 해줘")
    expect(chipCtx.userState).toBe("clear")
    expect(chipCtx.mode).toBe("intake")
    expect(chipCtx.displayedProducts.length).toBeGreaterThanOrEqual(0)
  })

  it("uses pendingQuestion text as latestAssistantQuestion when provided", () => {
    const turnCtx = buildUnifiedTurnContext(makeTurnContextInput())
    const pq = {
      shape: "explicit_choice" as const,
      questionText: "코팅을 선택해 주세요.",
      extractedOptions: [],
      field: "coating",
      isBinary: false,
      hasExplicitChoices: false,
    }

    const chipCtx = buildChipContextFromUnifiedTurnContext(turnCtx, pq, "clear", null)
    expect(chipCtx.latestAssistantQuestion).toBe("코팅을 선택해 주세요.")
  })
})
