import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  handleServeGeneralChatAction,
  resolveReplyUiStrategy,
  buildReplyDisplayedOptions,
} from "../serve-engine-general-chat"

import type { OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type {
  AppliedFilter,
  CandidateSnapshot,
  ExplorationSessionState,
  NarrowingTurn,
  ProductIntakeForm,
  ScoredProduct,
  SeriesGroup,
} from "@/lib/recommendation/domain/types"

function makeCandidate(rank: number, code: string, coating: string): ScoredProduct {
  return {
    product: {
      normalizedCode: code,
      displayCode: code,
      brand: "YG-1",
      seriesName: "E5D70",
      seriesIconUrl: null,
      diameterMm: 4,
      fluteCount: 2,
      coating,
      toolMaterial: "Carbide",
      shankDiameterMm: 4,
      lengthOfCutMm: 10,
      overallLengthMm: 60,
      helixAngleDeg: 45,
      description: null,
      featureText: null,
      materialTags: ["N"],
    },
    score: 100 - rank,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "instock",
    totalStock: 10,
    inventory: [],
  } as unknown as ScoredProduct
}

function makeSnapshot(rank: number, code: string, coating: string): CandidateSnapshot {
  return {
    rank,
    productCode: code,
    displayCode: code,
    displayLabel: code,
    brand: "YG-1",
    seriesName: "E5D70",
    seriesIconUrl: null,
    diameterMm: 4,
    fluteCount: 2,
    coating,
    toolMaterial: "Carbide",
    shankDiameterMm: 4,
    lengthOfCutMm: 10,
    overallLengthMm: 60,
    helixAngleDeg: 45,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 100 - rank,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "instock",
    totalStock: 10,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: true,
    bestCondition: null,
  }
}

function makeSeriesGroup(
  seriesName: string,
  materialRating: "EXCELLENT" | "GOOD" | "NULL",
  members: CandidateSnapshot[],
): SeriesGroup {
  const materialRatingScore = materialRating === "EXCELLENT" ? 3 : materialRating === "GOOD" ? 2 : 1

  return {
    seriesKey: seriesName,
    seriesName,
    seriesIconUrl: null,
    description: null,
    candidateCount: members.length,
    topScore: members[0]?.score ?? 0,
    materialRating,
    materialRatingScore,
    members,
  }
}

function makePrevState(): ExplorationSessionState {
  const first = makeSnapshot(1, "E5D7004010", "DLC")
  const second = makeSnapshot(2, "E5D7004020", "TiAlN")

  return {
    sessionId: "ses-general-chat",
    candidateCount: 2,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      material: "Aluminum",
      diameterMm: 4,
      manufacturerScope: "yg1-only",
      locale: "ko",
    },
    turnCount: 1,
    lastAskedField: "coating",
    displayedProducts: [first, second],
    displayedCandidates: [first, second],
    displayedSeriesGroups: [
      makeSeriesGroup("X-Power", "EXCELLENT", [first]),
      makeSeriesGroup("Alu-Power", "GOOD", [second]),
      makeSeriesGroup("Tank-Power", "NULL", [second]),
    ],
    displayedChips: ["DLC (1)", "TiAlN (1)", "No preference"],
    displayedOptions: [
      { index: 1, label: "DLC (1??", field: "coating", value: "DLC", count: 1 },
      { index: 2, label: "TiAlN (1??", field: "coating", value: "TiAlN", count: 1 },
    ],
    lastAction: "continue_narrowing",
    currentMode: "question",
    lastRecommendationArtifact: [first, second],
  }
}

const form: ProductIntakeForm = {
  material: { status: "known", value: "Aluminum" },
  operationType: { status: "unknown" },
  diameterInfo: { status: "known", value: "4" },
  toolTypeOrCurrentProduct: { status: "unknown" },
  coating: { status: "unknown" },
  flute: { status: "unknown" },
  length: { status: "unknown" },
  machine: { status: "unknown" },
  country: { status: "known", value: "KOR" },
} as unknown as ProductIntakeForm

const orchResult: OrchestratorResult = {
  action: { type: "explain_product", target: "DLC코팅이란 무엇인가요?" },
  reasoning: "test",
  agentsInvoked: [],
  escalatedToOpus: false,
}

describe("handleServeGeneralChatAction", () => {
  it("preserves question assist mode for pending-field explanations", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]
    const filters: AppliedFilter[] = []
    const narrowingHistory: NarrowingTurn[] = []

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => "DLC코팅은 다이아몬드 유사 탄소 코팅으로, 알루미늄 및 비철금속 가공에 적합합니다."),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "DLC코팅이란 무엇인가요?" },
      orchResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "DLC코팅이란 무엇인가요?" },
      ],
      prevState,
      filters,
      narrowingHistory,
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 1,
    })

    const body = await response.json()

    expect(body.purpose).toBe("question")
    expect(body.sessionState.currentMode).toBe("question")
    expect(body.sessionState.lastAskedField).toBe("coating")
    expect(body.sessionState.displayedOptions.some((option: { field: string }) => option.field === "coating")).toBe(true)
    expect(body.meta.orchestratorResult.action).toBe("explain_product")
  })

  it("replaces stale narrowing chips with handler chips for inventory replies", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]
    const inventoryChips = ["Other stock", "Show recommendations", "Restart"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => ({
          text: "E5D7004010 제품의 재고가 확인되었습니다",
          chips: inventoryChips,
        })),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "E5D7004010 stock info" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    // Must NOT contain stale coating narrowing chips
    expect(body.chips).not.toContain("DLC (1??")
    expect(body.chips).not.toContain("TiAlN (1??")
    // Must contain handler-provided follow-up chips
    expect(body.chips).toEqual(inventoryChips)
    // displayedOptions must be derived from reply chips, not stale
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
    expect(body.sessionState.displayedOptions.length).toBe(inventoryChips.length)
  })

  it("replaces stale narrowing chips with handler chips for brand reference replies", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const brandChips = ["Add HRC filter", "Show other ISO", "Show recommendations"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => ({
          text: "reference brand 시리즈의 제품 정보를 확인했습니다",
          chips: brandChips,
        })),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "Show ISO H brand reference" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(body.chips).toEqual(brandChips)
    expect(body.chips).not.toContain("DLC (1??")
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
  })

  it("replaces stale narrowing chips with handler chips for cutting condition replies", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const cuttingChips = ["More cutting conditions", "Show recommendations", "Restart"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => ({
          text: "E5D7004010 제품의 절삭조건을 알려드리겠습니다.",
          chips: cuttingChips,
        })),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "E5D7004010 cutting condition" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(body.chips).toEqual(cuttingChips)
    expect(body.chips).not.toContain("DLC (1??")
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
  })

  it("answers material rating legend questions from displayed series groups without dropping recommendation state", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]
    const handleGeneralChat = vi.fn(async () => ({ text: "unused", chips: [] }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "추천 결과를 보여드렸습니다." },
        { role: "user", text: "What does Excellent rating mean?" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(handleGeneralChat).not.toHaveBeenCalled()
    expect(body.purpose).toBe("general_chat")
    expect(body.sessionState.currentMode).toBe("general_chat")
    expect(body.text).toContain("EXCELLENT")
    expect(body.text).toContain("GOOD")
    expect(body.sessionState.candidateCount).toBe(prevState.candidateCount)
    expect(body.sessionState.displayedProducts).toEqual(prevState.displayedProducts)
    expect(body.sessionState.displayedSeriesGroups).toEqual(prevState.displayedSeriesGroups)
    expect(body.sessionState.lastRecommendationArtifact).toEqual(prevState.lastRecommendationArtifact)
    expect(body.candidateSnapshot).toEqual(prevState.lastRecommendationArtifact)
    expect(body.chips).toContain("직접 입력")
  })

  it("answers material rating legend questions even when no series groups are displayed yet", async () => {
    const prevState = {
      ...makePrevState(),
      displayedSeriesGroups: [],
    }
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]
    const handleGeneralChat = vi.fn(async () => ({ text: "unused", chips: [] }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "user", text: "What does Excellent rating mean?" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 1,
    })

    const body = await response.json()

    expect(handleGeneralChat).not.toHaveBeenCalled()
    expect(body.purpose).toBe("general_chat")
    expect(body.text).toContain("Excellent")
    expect(body.text).toContain("Good")
    expect(body.text).toContain("전용")
    expect(body.text).toContain("범용")
    expect(body.sessionState.displayedProducts).toEqual(prevState.displayedProducts)
    expect(body.chips).toContain("직접 입력")
  })

  it("returns deterministic clarification for broad RPM questions instead of generic general chat", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]
    const handleGeneralChat = vi.fn(async () => ({ text: "unused", chips: [] }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "추천 결과를 보여드렸습니다." },
        { role: "user", text: "RPM 12000 이상만 보여줘" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(handleGeneralChat).not.toHaveBeenCalled()
    expect(body.purpose).toBe("question")
    expect(body.sessionState.currentMode).toBe("question")
    expect(body.text).toContain("12000")
    expect(body.text).toContain("Aluminum")
    expect(body.sessionState.candidateCount).toBe(prevState.candidateCount)
    expect(body.sessionState.displayedProducts).toEqual(prevState.displayedProducts)
    expect(body.sessionState.displayedSeriesGroups).toEqual(prevState.displayedSeriesGroups)
    expect(body.sessionState.lastRecommendationArtifact).toEqual(prevState.lastRecommendationArtifact)
    expect(body.chips).toContain("직접 입력")
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
  })
})

describe("resolveReplyUiStrategy", () => {
  it("returns replace_with_reply_options for inventory_reply", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy("inventory_reply", prevState)).toBe("replace_with_reply_options")
  })

  it("returns replace_with_reply_options for brand_reference", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy("brand_reference", prevState)).toBe("replace_with_reply_options")
  })

  it("returns replace_with_reply_options for cutting_conditions", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy("cutting_conditions", prevState)).toBe("replace_with_reply_options")
  })

  it("returns preserve_existing_question_options for question_assist with pending field", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy("question_assist", prevState)).toBe("preserve_existing_question_options")
  })

  it("returns clear_options for question_assist when resolved", () => {
    const prevState = { ...makePrevState(), resolutionStatus: "resolved_exact" as const }
    expect(resolveReplyUiStrategy("question_assist", prevState)).toBe("clear_options")
  })

  it("returns clear_options for unknown relation", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy("something_else", prevState)).toBe("clear_options")
  })

  it("returns clear_options for null relation", () => {
    const prevState = makePrevState()
    expect(resolveReplyUiStrategy(null, prevState)).toBe("clear_options")
  })
})

describe("buildReplyDisplayedOptions", () => {
  it("converts chip labels to _action DisplayedOptions", () => {
    const chips = ["Other stock", "Show recommendations", "Restart"]
    const options = buildReplyDisplayedOptions(chips)

    expect(options).toHaveLength(3)
    expect(options[0]).toEqual({ index: 1, label: "Other stock", field: "_action", value: "Other stock", count: 0 })
    expect(options[1]).toEqual({ index: 2, label: "Show recommendations", field: "_action", value: "Show recommendations", count: 0 })
    expect(options[2]).toEqual({ index: 3, label: "Restart", field: "_action", value: "Restart", count: 0 })
  })

  it("returns empty array for empty chips", () => {
    expect(buildReplyDisplayedOptions([])).toEqual([])
  })

  it("all options have field=_action", () => {
    const options = buildReplyDisplayedOptions(["a", "b"])
    expect(options.every(o => o.field === "_action")).toBe(true)
  })
})

describe("side question suspend/resume", () => {
  it("restores suspended flow options and chips after side question answer", async () => {
    const prevState = makePrevState()
    // Simulate a suspended flow (set by runtime before dispatching)
    prevState.suspendedFlow = {
      pendingField: "coating",
      pendingQuestion: "코팅 종류를 선택해주세요.",
      displayedOptionsSnapshot: [
        { index: 1, label: "DLC (1??", field: "coating", value: "DLC", count: 1 },
        { index: 2, label: "TiAlN (1??", field: "coating", value: "TiAlN", count: 1 },
      ],
      displayedChipsSnapshot: ["DLC (1)", "TiAlN (1)", "No preference"],
      reason: "side_question",
    }
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({
          text: "Factory info response.",
          chips: ["Restart"],
        })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "Factory info" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "Factory info" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "Factory info" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    // Chips and options should be restored from the suspended flow
    expect(body.chips).toEqual(["DLC (1)", "TiAlN (1)", "No preference"])
    expect(body.sessionState.displayedOptions).toEqual([
      { index: 1, label: "DLC (1??", field: "coating", value: "DLC", count: 1 },
      { index: 2, label: "TiAlN (1??", field: "coating", value: "TiAlN", count: 1 },
    ])
    // Purpose should be "question" to resume narrowing
    expect(body.purpose).toBe("question")
    // The answer text should include a resume prompt
    expect(body.text.length).toBeGreaterThan(0)
    // The pending field should be restored
    expect(body.sessionState.lastAskedField).toBe("coating")
    // suspendedFlow should be cleared
    expect(body.sessionState.suspendedFlow).toBeNull()
  })

  it("does NOT trigger suspend for question-assist (DLC코팅이란 무엇인가요?)", async () => {
    const prevState = makePrevState()
    // No suspendedFlow set ??question-assist should not create one
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => "DLC코팅은 다이아몬드 유사 탄소 코팅으로, 알루미늄 및 비철금속 가공에 적합합니다."),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "DLC코팅이란 무엇인가요?" },
      orchResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "DLC코팅이란 무엇인가요?" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 1,
    })

    const body = await response.json()

    // Question-assist should preserve question mode and pending field
    expect(body.purpose).toBe("question")
    expect(body.sessionState.currentMode).toBe("question")
    expect(body.sessionState.lastAskedField).toBe("coating")
    // Should NOT contain resume prompt text
    expect(body.text).toContain("DLC")
    // suspendedFlow should not be set (it was never suspended)
    expect(body.sessionState.suspendedFlow).toBeNull()
  })

  it("restores pendingField on resume even through inventory reply path", async () => {
    const prevState = makePrevState()
    prevState.suspendedFlow = {
      pendingField: "coating",
      pendingQuestion: "코팅 종류를 선택해주세요.",
      displayedOptionsSnapshot: [
        { index: 1, label: "DLC (1??", field: "coating", value: "DLC", count: 1 },
      ],
      displayedChipsSnapshot: ["DLC (1)", "No preference"],
      reason: "side_question",
    }
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const inventoryChips = ["Other stock", "Show recommendations"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => ({
          text: "E5D7004010 stock reply.",
          chips: inventoryChips,
        })),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅 종류를 선택해주세요." },
        { role: "user", text: "E5D7004010 stock info" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    // Suspended flow should override the inventory chips
    expect(body.chips).toEqual(["DLC (1)", "No preference"])
    expect(body.sessionState.lastAskedField).toBe("coating")
    expect(body.text.length).toBeGreaterThan(0)
    expect(body.sessionState.suspendedFlow).toBeNull()
  })

  it("ignores pre-generated text for knowledge questions and delegates to general chat handler", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const handleGeneralChat = vi.fn(async () => ({
      text: "웹 검색 기반 설명",
      chips: [],
    }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "라우터 사전 생성 답변", preGenerated: true },
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "라우터 사전 생성 답변", preGenerated: true } },
      provider: { available: () => true } as any,
      form,
      messages: [
        { role: "ai", text: "무엇을 도와드릴까요?" },
        { role: "user", text: "Slot 가공할 때 ball 엔드밀이 좋아? 어떤 날 형상이 좋아?" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(handleGeneralChat).toHaveBeenCalledOnce()
    expect(body.text).toContain("웹 검색 기반 설명")
  })

  it("keeps pre-generated text for simple smalltalk", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const handleGeneralChat = vi.fn(async () => ({
      text: "일반 채팅 핸들러 응답",
      chips: [],
    }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "안녕하세요!", preGenerated: true },
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "안녕하세요!", preGenerated: true } },
      provider: { available: () => true } as any,
      form,
      messages: [
        { role: "ai", text: "무엇을 도와드릴까요?" },
        { role: "user", text: "안녕" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates,
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(handleGeneralChat).not.toHaveBeenCalled()
    expect(body.text).toContain("안녕하세요!")
  })
})

