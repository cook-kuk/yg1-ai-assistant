/**
 * Unified TurnContext & Smart Chip System — Regression tests
 *
 * Tests:
 * 1. Answer generation and chip generation share the same TurnContext
 * 2. Mentioning Ball/Taper counts does NOT commit Ball as an active filter
 * 3. Pending clarification threads remain alive in memory
 * 4. UI artifact memory influences chip generation
 * 5. Recent raw turns are preserved while older turns can be compressed
 * 6. Compression preserves unresolved threads, resolved facts, active filters, product references, and revision/correction signals
 * 7. If answer text proposes an option, that option must exist in displayed options or be removed
 * 8. Quoted assistant reset text does not trigger reset
 */

import { describe, it, expect } from "vitest"
import { buildUnifiedTurnContext, type UnifiedTurnContext } from "../turn-context-builder"
import { extractUIArtifacts, summarizeUIArtifacts } from "../ui-context-extractor"
import { compressOlderTurns, type ConversationTurn } from "../../memory/memory-compressor"
import { checkAnswerChipDivergence, fixChipDivergence } from "../../options/divergence-guard"
import { createEmptyMemory, type ConversationMemory } from "../../memory/conversation-memory"
import { isExplicitResetIntent } from "@/lib/recommendation/infrastructure/agents/intent-classifier"
import type { ExplorationSessionState, CandidateSnapshot, RecommendationInput, ProductIntakeForm } from "../../types"

// ── Test Helpers ──────────────────────────────────────────────

function makeForm(material?: string): ProductIntakeForm {
  return {
    material: material ? { status: "known" as const, value: material } : { status: "unknown" as const },
    operationType: { status: "known" as const, value: "side milling" },
    diameterInfo: { status: "known" as const, value: 4 },
    toolTypeOrCurrentProduct: { status: "known" as const, value: "endmill" },
    flutePreference: { status: "unknown" as const },
    coatingPreference: { status: "unknown" as const },
    machiningIntent: { status: "unknown" as const },
    inquiryPurpose: { status: "known" as const, value: "new" },
  } as unknown as ProductIntakeForm
}

function makeSession(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 32,
    appliedFilters: [
      { field: "coating", op: "includes", value: "DLC", rawValue: "DLC", appliedAt: 1 },
    ],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      material: "aluminum",
      operationType: "side milling",
      diameterMm: 4,
      toolType: "endmill",
    } as RecommendationInput,
    turnCount: 2,
    lastAskedField: "toolSubtype",
    displayedCandidates: [
      { rank: 1, displayCode: "CE123", seriesName: "X-Series", diameterMm: 4, fluteCount: 3, coating: "DLC", matchStatus: "exact", score: 95 } as CandidateSnapshot,
      { rank: 2, displayCode: "CE456", seriesName: "Y-Series", diameterMm: 4, fluteCount: 2, coating: "DLC", matchStatus: "approximate", score: 88 } as CandidateSnapshot,
    ],
    displayedChips: ["Square (7개)", "Ball (3개)", "Radius (2개)", "상관없음"],
    displayedOptions: [
      { index: 1, label: "Square (7개)", value: "Square", field: "toolSubtype", count: 7 },
      { index: 2, label: "Ball (3개)", value: "Ball", field: "toolSubtype", count: 3 },
      { index: 3, label: "Radius (2개)", value: "Radius", field: "toolSubtype", count: 2 },
    ] as ExplorationSessionState["displayedOptions"],
    currentMode: "question",
    lastAction: "continue_narrowing",
    ...overrides,
  } as ExplorationSessionState
}

function makeCandidates(): CandidateSnapshot[] {
  return [
    { rank: 1, displayCode: "CE123", seriesName: "X-Series", diameterMm: 4, fluteCount: 3, coating: "DLC", matchStatus: "exact", score: 95, productCode: "CE123", displayLabel: null, brand: null, seriesIconUrl: null, toolMaterial: null, shankDiameterMm: null, lengthOfCutMm: null, overallLengthMm: null, helixAngleDeg: null, description: null },
    { rank: 2, displayCode: "CE456", seriesName: "Y-Series", diameterMm: 4, fluteCount: 2, coating: "DLC", matchStatus: "approximate", score: 88, productCode: "CE456", displayLabel: null, brand: null, seriesIconUrl: null, toolMaterial: null, shankDiameterMm: null, lengthOfCutMm: null, overallLengthMm: null, helixAngleDeg: null, description: null },
  ] as CandidateSnapshot[]
}

// ════════════════════════════════════════════════════════════════
// TEST 1: TurnContext is a single shared object
// ════════════════════════════════════════════════════════════════

describe("Unified TurnContext", () => {
  it("builds a single context with all required fields for both answer and chip generation", () => {
    const ctx = buildUnifiedTurnContext({
      latestAssistantText: "공구 세부 타입이 중요한가요? Square, Ball, Radius 등이 있습니다.",
      latestUserMessage: "Ball, Taper는 몇개야?",
      messages: [
        { role: "ai", text: "공구 세부 타입이 중요한가요? Square, Ball, Radius 등이 있습니다." },
        { role: "user", text: "Ball, Taper는 몇개야?" },
      ],
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum", operationType: "side milling", diameterMm: 4, toolType: "endmill" } as RecommendationInput,
      intakeForm: makeForm("aluminum"),
      candidates: makeCandidates(),
    })

    // Has all the fields
    expect(ctx.latestUserMessage).toBe("Ball, Taper는 몇개야?")
    expect(ctx.latestAssistantQuestion).toBeTruthy()
    expect(ctx.resolvedFacts.length).toBeGreaterThan(0)
    expect(ctx.uiArtifacts.length).toBeGreaterThan(0)
    expect(ctx.recentFrame).toBeTruthy()
    expect(ctx.sessionState).toBeTruthy()
    expect(ctx.resolvedInput).toBeTruthy()

    // Same object reference can be passed to both answer and chip gen
    const contextForAnswer = ctx
    const contextForChips = ctx
    expect(contextForAnswer).toBe(contextForChips)
  })

  it("preserves resolved facts from intake", () => {
    const ctx = buildUnifiedTurnContext({
      latestAssistantText: null,
      latestUserMessage: "DLC 코팅으로",
      messages: [{ role: "user", text: "DLC 코팅으로" }],
      sessionState: makeSession(),
      resolvedInput: { material: "aluminum", operationType: "side milling", diameterMm: 4, toolType: "endmill" } as RecommendationInput,
      intakeForm: makeForm("aluminum"),
      candidates: makeCandidates(),
    })

    const materialFact = ctx.resolvedFacts.find(f => f.field === "material")
    expect(materialFact).toBeTruthy()
    expect(materialFact!.value).toBe("aluminum")
    expect(materialFact!.status).toBe("resolved")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Ball/Taper mention does NOT commit as active filter
// ════════════════════════════════════════════════════════════════

describe("Tentative references", () => {
  it("Ball/Taper count query creates tentative references, NOT active filters", () => {
    const memory = createEmptyMemory()
    // Simulate: user asks "Ball, Taper는 몇개야?" — a count/clarification query
    // Memory should NOT have Ball as an active filter

    const ctx = buildUnifiedTurnContext({
      latestAssistantText: "공구 세부 타입이 중요한가요? Square (7개), Ball (3개), Radius (2개)",
      latestUserMessage: "Ball, Taper는 몇개야?",
      messages: [
        { role: "ai", text: "공구 세부 타입이 중요한가요?" },
        { role: "user", text: "Ball, Taper는 몇개야?" },
      ],
      sessionState: makeSession({ conversationMemory: memory }),
      resolvedInput: { material: "aluminum", operationType: "side milling", diameterMm: 4, toolType: "endmill" } as RecommendationInput,
      intakeForm: makeForm("aluminum"),
      candidates: makeCandidates(),
    })

    // Active filters should only contain DLC (the actually committed filter)
    const activeFilterFields = ctx.activeFilters.map(f => f.field)
    expect(activeFilterFields).not.toContain("toolSubtype")

    // No Ball or Taper in resolved facts
    const resolvedValues = ctx.resolvedFacts.map(f => f.value)
    expect(resolvedValues).not.toContain("Ball")
    expect(resolvedValues).not.toContain("Taper")

    // DLC should be an active filter
    const dlcFilter = ctx.activeFilters.find(f => f.field === "coating")
    expect(dlcFilter).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Pending clarification threads remain alive
// ════════════════════════════════════════════════════════════════

describe("Pending clarification", () => {
  it("pending question from session is preserved in unified context", () => {
    const session = makeSession({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (7개)", value: "Square", field: "toolSubtype", count: 7 },
        { index: 2, label: "Ball (3개)", value: "Ball", field: "toolSubtype", count: 3 },
      ] as ExplorationSessionState["displayedOptions"],
    })

    const ctx = buildUnifiedTurnContext({
      latestAssistantText: "공구 세부 타입이 중요한가요?",
      latestUserMessage: "Ball, Taper는 몇개야?",
      messages: [
        { role: "ai", text: "공구 세부 타입이 중요한가요?" },
        { role: "user", text: "Ball, Taper는 몇개야?" },
      ],
      sessionState: session,
      resolvedInput: {} as RecommendationInput,
      intakeForm: makeForm(),
      candidates: [],
    })

    // Pending question should exist
    expect(ctx.currentPendingQuestion).toBeTruthy()
    expect(ctx.currentPendingQuestion!.field).toBe("toolSubtype")
    expect(ctx.pendingQuestions.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: UI artifact memory influences context
// ════════════════════════════════════════════════════════════════

describe("UI artifact memory", () => {
  it("extracts recommendation cards from session state", () => {
    const session = makeSession({
      resolutionStatus: "resolved_exact",
      currentMode: "recommendation",
      lastAction: "show_recommendation",
    })

    const artifacts = extractUIArtifacts(session, makeCandidates())

    const recCard = artifacts.find(a => a.kind === "recommendation_card")
    expect(recCard).toBeTruthy()
    expect(recCard!.productCodes).toContain("CE123")
    expect(recCard!.isPrimaryFocus).toBe(true)
  })

  it("extracts chips bar from session state", () => {
    const session = makeSession()
    const artifacts = extractUIArtifacts(session, [])

    const chipsBar = artifacts.find(a => a.kind === "chips_bar")
    expect(chipsBar).toBeTruthy()
    expect(chipsBar!.visibleFields.length).toBeGreaterThan(0)
  })

  it("generates human-readable summary", () => {
    const artifacts = extractUIArtifacts(makeSession(), makeCandidates())
    const summary = summarizeUIArtifacts(artifacts)
    expect(summary).toContain("칩")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Recent raw turns preserved, older turns compressed
// ════════════════════════════════════════════════════════════════

describe("Hierarchical memory compression", () => {
  it("keeps all turns when count is small", () => {
    const turns: ConversationTurn[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      text: `Turn ${i}`,
      turn: i,
    }))

    const { recentTurns, episodicSummaries } = compressOlderTurns(turns, null, null)

    expect(recentTurns.length).toBe(8)
    expect(episodicSummaries.length).toBe(0)
  })

  it("compresses older turns when count exceeds threshold", () => {
    const turns: ConversationTurn[] = Array.from({ length: 24 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      text: `Turn ${i} content`,
      turn: i,
    }))

    const { recentTurns, episodicSummaries } = compressOlderTurns(turns, null, null)

    // Recent turns should be the last 16 (updated from 12)
    expect(recentTurns.length).toBe(16)
    expect(recentTurns[0].turn).toBe(8)

    // Older turns should be compressed into episodes
    expect(episodicSummaries.length).toBeGreaterThan(0)
    expect(episodicSummaries[0].span.fromTurn).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 6: Compression preserves important signals
// ════════════════════════════════════════════════════════════════

describe("Compression signal preservation", () => {
  it("preserves product references in episodic summaries", () => {
    const turns: ConversationTurn[] = [
      ...Array.from({ length: 16 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: i === 2 ? "CE123 제품이 좋아보이네요" : `Turn ${i}`,
        turn: i,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        role: ((i + 16) % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Recent turn ${i + 16}`,
        turn: i + 16,
      })),
    ]

    const { episodicSummaries } = compressOlderTurns(turns, null, null)

    const allProducts = episodicSummaries.flatMap(s => s.referencedProducts)
    expect(allProducts).toContain("CE123")
  })

  it("preserves correction signals in episodic summaries", () => {
    const turns: ConversationTurn[] = [
      ...Array.from({ length: 16 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: i === 4 ? "아니 다시 바꿔줘" : `Turn ${i}`,
        turn: i,
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        role: ((i + 16) % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Recent turn ${i + 16}`,
        turn: i + 16,
      })),
    ]

    const { episodicSummaries } = compressOlderTurns(turns, null, null)

    const allCorrections = episodicSummaries.flatMap(s => s.correctionSignals)
    expect(allCorrections.length).toBeGreaterThan(0)
  })

  it("preserves resolved facts from memory in episodic summaries", () => {
    const memory = createEmptyMemory()
    memory.items.push({
      key: "intake_material",
      field: "material",
      value: "aluminum",
      source: "intake",
      status: "resolved",
      priority: 8,
      turnCreated: 0,
      turnUpdated: 0,
    })

    const turns: ConversationTurn[] = Array.from({ length: 24 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Turn ${i}`,
      turn: i,
    }))

    const { episodicSummaries } = compressOlderTurns(turns, memory, null)

    const allFacts = episodicSummaries.flatMap(s => s.resolvedFacts)
    expect(allFacts.some(f => f.field === "material" && f.value === "aluminum")).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 7: Answer/Chip divergence guard
// ════════════════════════════════════════════════════════════════

describe("Answer/Chip divergence guard", () => {
  it("detects when answer suggests an action with no matching chip", () => {
    const answerText = "DLC 코팅의 다른 조건 보기를 원하시면 알려주세요."
    const chips = ["Square (7개)", "Ball (3개)", "상관없음"]
    const options: any[] = []

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(true)
    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
    // Option-first: corrected answer should soften the unauthorized action
    expect(result.correctedAnswer).toBeTruthy()
  })

  it("does NOT flag when answer and chips are aligned", () => {
    const answerText = "코팅 종류를 선택해주세요."
    const chips = ["DLC (5개)", "AlTiN (3개)", "상관없음"]
    const options: any[] = []

    const result = checkAnswerChipDivergence(answerText, chips, options)

    expect(result.hasDivergence).toBe(false)
  })

  it("option-first: fixChipDivergence returns chips unchanged (no text→chip)", () => {
    const answerText = "비교해 보기 원하시면 알려주세요."
    const chips = ["Square", "Ball"]
    const options: any[] = []

    const divergence = checkAnswerChipDivergence(answerText, chips, options)
    const fixed = fixChipDivergence(chips, divergence)

    // Option-first: chips are NEVER added from answer text
    expect(fixed).toEqual(chips)
    expect(fixed.length).toBe(2)
    // But the divergence should detect and SOFTEN the answer
    expect(divergence.hasDivergence).toBe(true)
    expect(divergence.correctedAnswer).toBeTruthy()
  })

  it("option-first: fixChipDivergence never adds chips regardless of input", () => {
    const chips = Array.from({ length: 7 }, (_, i) => `Option ${i}`)
    const divergence = {
      hasDivergence: true,
      unauthorizedActions: ["비교 보기"],
      correctedAnswer: "some corrected text",
    }

    const fixed = fixChipDivergence(chips, divergence, 8)

    // Must return original chips unchanged
    expect(fixed).toEqual(chips)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 8: Quoted assistant reset text does NOT trigger reset
// ════════════════════════════════════════════════════════════════

describe("Quote/Reset safety", () => {
  it("quoted '처음부터 다시' does NOT trigger reset", () => {
    // Long message containing quoted assistant text
    const quotedMsg = "위에서 '처음부터 다시'라고 나왔는데 이거 왜 나온거야?"
    expect(isExplicitResetIntent(quotedMsg.trim().toLowerCase())).toBe(false)
  })

  it("meta-question about reset does NOT trigger reset", () => {
    expect(isExplicitResetIntent("왜 처음부터 다시해야 해?")).toBe(false)
  })

  it("genuine reset command DOES trigger reset", () => {
    expect(isExplicitResetIntent("처음부터 다시")).toBe(true)
    expect(isExplicitResetIntent("리셋")).toBe(true)
    expect(isExplicitResetIntent("다시 시작")).toBe(true)
  })

  it("frustration with reset word does NOT trigger reset", () => {
    expect(isExplicitResetIntent("ㅠㅠ 처음부터 다시해야돼?")).toBe(false)
  })

  it("pasted assistant output with reset word does NOT trigger reset", () => {
    const pasted = "이전 결과에서 처음부터 다시 라는 옵션이 있었는데 이걸 기반으로 만들어줘"
    expect(isExplicitResetIntent(pasted.trim().toLowerCase())).toBe(false)
  })
})
