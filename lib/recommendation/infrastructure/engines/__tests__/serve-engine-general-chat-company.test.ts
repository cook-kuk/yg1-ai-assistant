import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { handleServeGeneralChatAction } from "../serve-engine-general-chat"

import type { OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type {
  CandidateSnapshot,
  ExplorationSessionState,
  ProductIntakeForm,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

function makeSnapshot(): CandidateSnapshot {
  return {
    rank: 1,
    productCode: "E5D7004010",
    displayCode: "E5D7004010",
    displayLabel: "E5D7004010",
    brand: "YG-1",
    seriesName: "E5D70",
    seriesIconUrl: null,
    diameterMm: 8,
    fluteCount: 3,
    coating: "DLC",
    toolMaterial: "Carbide",
    shankDiameterMm: 8,
    lengthOfCutMm: 20,
    overallLengthMm: 60,
    helixAngleDeg: 45,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 98,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "instock",
    totalStock: 12,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: true,
    bestCondition: null,
  }
}

function makeCandidate(): ScoredProduct {
  return {
    product: {
      normalizedCode: "E5D7004010",
      displayCode: "E5D7004010",
      brand: "YG-1",
      seriesName: "E5D70",
      seriesIconUrl: null,
      diameterMm: 8,
      fluteCount: 3,
      coating: "DLC",
      toolMaterial: "Carbide",
      shankDiameterMm: 8,
      lengthOfCutMm: 20,
      overallLengthMm: 60,
      helixAngleDeg: 45,
      description: null,
      featureText: null,
      materialTags: ["N"],
    },
    score: 98,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "instock",
    totalStock: 12,
    inventory: [],
  } as unknown as ScoredProduct
}

function makePrevState(): ExplorationSessionState {
  const snapshot = makeSnapshot()
  return {
    sessionId: "session-company-reply",
    candidateCount: 406,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      material: "Aluminum",
      diameterMm: 8,
      operationType: "Side_Milling",
      toolType: "Milling",
      manufacturerScope: "yg1-only",
      locale: "ko",
    },
    turnCount: 1,
    lastAskedField: "workPieceName",
    displayedProducts: [snapshot],
    displayedCandidates: [snapshot],
    displayedChips: ["연질", "주조 합금", "단조 합금", "상관없음"],
    displayedOptions: [
      { index: 1, label: "연질", field: "workPieceName", value: "연질", count: 0 },
      { index: 2, label: "주조 합금", field: "workPieceName", value: "주조 합금", count: 0 },
    ],
    lastAction: "continue_narrowing",
    currentMode: "question",
  }
}

const form: ProductIntakeForm = {
  material: { status: "known", value: "알루미늄" },
  operationType: { status: "known", value: "Side_Milling" },
  diameterInfo: { status: "known", value: "8" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  coating: { status: "unknown" },
  flute: { status: "unknown" },
  length: { status: "unknown" },
  machine: { status: "unknown" },
  country: { status: "known", value: "KR" },
} as unknown as ProductIntakeForm

describe("serve engine general chat company replies", () => {
  it("answers office questions from deterministic knowledge and preserves the pending recommendation UI", async () => {
    const prevState = makePrevState()
    const handleGeneralChat = vi.fn(async () => ({ text: "unused", chips: [] }))

    const response = await handleServeGeneralChatAction({
      deps: {
        buildCandidateSnapshot: () => prevState.displayedCandidates,
        handleDirectInventoryQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: params =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "부산영업소에 대해서 알려줘" },
      orchResult: {
        action: { type: "explain_product", target: "부산영업소에 대해서 알려줘" },
        reasoning: "test",
        agentsInvoked: [],
        escalatedToOpus: false,
      } satisfies OrchestratorResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "알루미늄 세부 종류를 알려주시겠어요?" },
        { role: "user", text: "부산영업소에 대해서 알려줘" },
      ],
      prevState,
      filters: [],
      narrowingHistory: [],
      currentInput: prevState.resolvedInput,
      candidates: [makeCandidate()],
      evidenceMap: new Map(),
      turnCount: 2,
    })

    const body = await response.json()

    expect(body.text).toContain("부산영업소")
    expect(body.text).toContain("051-314-0985")
    expect(body.sessionState.currentMode).toBe("question")
    expect(body.sessionState.lastAskedField).toBe("workPieceName")
    expect(body.chips).toEqual(prevState.displayedChips)
    expect(body.sessionState.displayedOptions).toEqual(prevState.displayedOptions)
    expect(handleGeneralChat).not.toHaveBeenCalled()
  })
})
