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

function makePrevState(): ExplorationSessionState {
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
    displayedProducts: [makeSnapshot(1, "E5D7004010", "DLC"), makeSnapshot(2, "E5D7004020", "TiAlN")],
    displayedCandidates: [makeSnapshot(1, "E5D7004010", "DLC"), makeSnapshot(2, "E5D7004020", "TiAlN")],
    displayedChips: ["DLC (1개)", "TiAlN (1개)", "상관없음"],
    displayedOptions: [
      { index: 1, label: "DLC (1개)", field: "coating", value: "DLC", count: 1 },
      { index: 2, label: "TiAlN (1개)", field: "coating", value: "TiAlN", count: 1 },
    ],
    lastAction: "continue_narrowing",
    currentMode: "question",
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
  country: { status: "known", value: "KR" },
} as unknown as ProductIntakeForm

const orchResult: OrchestratorResult = {
  action: { type: "explain_product", target: "DLC가 뭐야?" },
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
        handleContextualNarrowingQuestion: vi.fn(async () => "DLC는 알루미늄 가공에서 자주 쓰는 코팅입니다."),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "DLC가 뭐야?" },
      orchResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "DLC가 뭐야?" },
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
    const inventoryChips = ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => ({
          text: "E5D7004010의 재고 데이터입니다.",
          chips: inventoryChips,
        })),
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
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "E5D7004010 재고 알려줘" },
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
    expect(body.chips).not.toContain("DLC (1개)")
    expect(body.chips).not.toContain("TiAlN (1개)")
    // Must contain handler-provided follow-up chips
    expect(body.chips).toEqual(inventoryChips)
    // displayedOptions must be derived from reply chips, not stale
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
    expect(body.sessionState.displayedOptions.length).toBe(inventoryChips.length)
  })

  it("replaces stale narrowing chips with handler chips for brand reference replies", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const brandChips = ["HRC 조건 추가", "다른 ISO 보기", "추천 제품 보기"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => ({
          text: "reference brand 기준표입니다.",
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
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "ISO H 브랜드 기준표 보여줘" },
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
    expect(body.chips).not.toContain("DLC (1개)")
    expect(body.sessionState.displayedOptions.every((o: { field: string }) => o.field === "_action")).toBe(true)
  })

  it("replaces stale narrowing chips with handler chips for cutting condition replies", async () => {
    const prevState = makePrevState()
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const cuttingChips = ["다른 소재 조건도 보여줘", "추천 제품 보기", "처음부터 다시"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => ({
          text: "E5D7004010 절삭조건입니다.",
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
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "E5D7004010 절삭조건 알려줘" },
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
    expect(body.chips).not.toContain("DLC (1개)")
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
    const chips = ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"]
    const options = buildReplyDisplayedOptions(chips)

    expect(options).toHaveLength(3)
    expect(options[0]).toEqual({ index: 1, label: "다른 제품 재고", field: "_action", value: "다른 제품 재고", count: 0 })
    expect(options[1]).toEqual({ index: 2, label: "추천 제품 보기", field: "_action", value: "추천 제품 보기", count: 0 })
    expect(options[2]).toEqual({ index: 3, label: "처음부터 다시", field: "_action", value: "처음부터 다시", count: 0 })
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
      pendingQuestion: "코팅을 선택해주세요.",
      displayedOptionsSnapshot: [
        { index: 1, label: "DLC (1개)", field: "coating", value: "DLC", count: 1 },
        { index: 2, label: "TiAlN (1개)", field: "coating", value: "TiAlN", count: 1 },
      ],
      displayedChipsSnapshot: ["DLC (1개)", "TiAlN (1개)", "상관없음"],
      reason: "side_question",
    }
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat: vi.fn(async () => ({
          text: "익산 공장은 충남에 위치해 있습니다.",
          chips: ["처음부터 다시"],
        })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "answer_general", message: "익산 공장 정보줘" } as any,
      orchResult: { ...orchResult, action: { type: "answer_general" as const, message: "익산 공장 정보줘" } },
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "익산 공장 정보줘" },
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
    expect(body.chips).toEqual(["DLC (1개)", "TiAlN (1개)", "상관없음"])
    expect(body.sessionState.displayedOptions).toEqual([
      { index: 1, label: "DLC (1개)", field: "coating", value: "DLC", count: 1 },
      { index: 2, label: "TiAlN (1개)", field: "coating", value: "TiAlN", count: 1 },
    ])
    // Purpose should be "question" to resume narrowing
    expect(body.purpose).toBe("question")
    // The answer text should include a resume prompt
    expect(body.text).toContain("다시 제품 추천으로 돌아갈게요")
    // The pending field should be restored
    expect(body.sessionState.lastAskedField).toBe("coating")
    // suspendedFlow should be cleared
    expect(body.sessionState.suspendedFlow).toBeNull()
  })

  it("does NOT trigger suspend for question-assist (DLC가 뭐야?)", async () => {
    const prevState = makePrevState()
    // No suspendedFlow set — question-assist should not create one
    const candidates = [makeCandidate(1, "E5D7004010", "DLC"), makeCandidate(2, "E5D7004020", "TiAlN")]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => "DLC는 알루미늄 가공에서 자주 쓰는 코팅입니다."),
        handleGeneralChat: vi.fn(async () => ({ text: "unused", chips: [] })),
        jsonRecommendationResponse: (params) =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "DLC가 뭐야?" },
      orchResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "DLC가 뭐야?" },
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
    expect(body.text).not.toContain("다시 제품 추천으로 돌아갈게요")
    // suspendedFlow should not be set (it was never suspended)
    expect(body.sessionState.suspendedFlow).toBeNull()
  })

  it("restores pendingField on resume even through inventory reply path", async () => {
    const prevState = makePrevState()
    prevState.suspendedFlow = {
      pendingField: "coating",
      pendingQuestion: "코팅을 선택해주세요.",
      displayedOptionsSnapshot: [
        { index: 1, label: "DLC (1개)", field: "coating", value: "DLC", count: 1 },
      ],
      displayedChipsSnapshot: ["DLC (1개)", "상관없음"],
      reason: "side_question",
    }
    const candidates = [makeCandidate(1, "E5D7004010", "DLC")]
    const inventoryChips = ["다른 제품 재고", "추천 제품 보기"]

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => ({
          text: "E5D7004010의 재고입니다.",
          chips: inventoryChips,
        })),
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
        { role: "ai", text: "코팅을 선택해주세요." },
        { role: "user", text: "E5D7004010 재고 알려줘" },
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
    expect(body.chips).toEqual(["DLC (1개)", "상관없음"])
    expect(body.sessionState.lastAskedField).toBe("coating")
    expect(body.text).toContain("다시 제품 추천으로 돌아갈게요")
    expect(body.sessionState.suspendedFlow).toBeNull()
  })
})
