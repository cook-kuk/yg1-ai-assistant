import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { handleServeGeneralChatAction } from "../serve-engine-general-chat"

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
})
