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
    displayedChips: ["?怨쀬춳", "雅뚯눘????룻닊", "??β???룻닊", "?怨???곸벉"],
    displayedOptions: [
      { index: 1, label: "?怨쀬춳", field: "workPieceName", value: "?怨쀬춳", count: 0 },
      { index: 2, label: "雅뚯눘????룻닊", field: "workPieceName", value: "雅뚯눘????룻닊", count: 0 },
    ],
    lastAction: "continue_narrowing",
    currentMode: "question",
  }
}

const form: ProductIntakeForm = {
  material: { status: "known", value: "Aluminum" },
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
        handleDirectEntityProfileQuestion: vi.fn(async () => null),
        handleDirectBrandReferenceQuestion: vi.fn(async () => null),
        handleDirectCuttingConditionQuestion: vi.fn(async () => null),
        handleContextualNarrowingQuestion: vi.fn(async () => null),
        handleGeneralChat,
        jsonRecommendationResponse: params =>
          new Response(JSON.stringify(params), { headers: { "content-type": "application/json" } }),
      },
      action: { type: "explain_product", target: "\uBD80\uC0B0\uC601\uC5C5\uC18C\uC5D0 \uB300\uD574\uC11C \uC54C\uB824\uC918" },
      orchResult: {
        action: { type: "explain_product", target: "\uBD80\uC0B0\uC601\uC5C5\uC18C\uC5D0 \uB300\uD574\uC11C \uC54C\uB824\uC918" },
        reasoning: "test",
        agentsInvoked: [],
        escalatedToOpus: false,
      } satisfies OrchestratorResult,
      provider: { available: () => false } as any,
      form,
      messages: [
        { role: "ai", text: "???펷沃섎챶???紐? ?ル굝履잏몴????젻雅뚯눘苑??" },
        { role: "user", text: "\uBD80\uC0B0\uC601\uC5C5\uC18C\uC5D0 \uB300\uD574\uC11C \uC54C\uB824\uC918" },
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

    expect(body.text).toContain("\uBD80\uC0B0\uC601\uC5C5\uC18C")
    expect(body.text).toContain("051-314-0985")
    expect(body.sessionState.currentMode).toBe("question")
    expect(body.sessionState.lastAskedField).toBe("workPieceName")
    expect(body.chips).toEqual(prevState.displayedChips)
    expect(body.sessionState.displayedOptions).toEqual(prevState.displayedOptions)
    expect(handleGeneralChat).not.toHaveBeenCalled()
  })
})
