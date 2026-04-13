import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  resolveMultiStageQueryMock,
  runHybridRetrievalMock,
} = vi.hoisted(() => ({
  resolveMultiStageQueryMock: vi.fn(),
  runHybridRetrievalMock: vi.fn(),
}))

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: resolveMultiStageQueryMock,
  }
})

vi.mock("@/lib/recommendation/domain/recommendation-domain", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/domain/recommendation-domain")>("@/lib/recommendation/domain/recommendation-domain")
  return {
    ...actual,
    runHybridRetrieval: runHybridRetrievalMock,
  }
})

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

function makeCandidate(productCode: string) {
  return {
    product: {
      normalizedCode: productCode,
      displayCode: productCode,
      brand: "YG-1",
      id: productCode,
      manufacturer: "YG-1",
      sourcePriority: 1,
      sourceType: "smart-catalog",
      rawSourceFile: "test.json",
      rawSourceSheet: null,
      seriesName: "TEST",
      productName: productCode,
      toolType: "End Mill",
      diameterMm: 10,
      diameterInch: null,
      fluteCount: 4,
      coating: "TiAlN",
      toolSubtype: "Square",
      toolMaterial: "Carbide",
      shankDiameterMm: 10,
      shankType: "Plain",
      lengthOfCutMm: null,
      overallLengthMm: null,
      helixAngleDeg: null,
      coolantHole: null,
      ballRadiusMm: null,
      taperAngleDeg: null,
      pointAngleDeg: null,
      threadPitchMm: null,
      description: null,
      featureText: null,
      applicationShapes: [],
      materialTags: ["P"],
      country: null,
      seriesIconUrl: null,
      materialRatingScore: null,
      workpieceMatched: false,
      sourceConfidence: "high",
      dataCompletenessScore: 1,
      evidenceRefs: [],
    } as any,
    score: 91,
    scoreBreakdown: null,
    matchedFields: [],
    matchStatus: "exact",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  }
}

describe("handleServeExploration pending-selection holistic fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    resolveMultiStageQueryMock.mockResolvedValue({
      source: "stage2",
      filters: [
        buildAppliedFilterFromValue("fluteCount", 4, 3),
        buildAppliedFilterFromValue("coating", "TiAlN", 3),
        buildAppliedFilterFromValue("toolSubtype", "Square", 3),
      ].filter(Boolean),
      sort: null,
      routeHint: "show_recommendation",
      intent: "show_recommendation",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0.96,
      unresolvedTokens: [],
      reasoning: "resolved all filter-bearing terms holistically",
      clarification: null,
    })

    runHybridRetrievalMock.mockResolvedValue({
      candidates: [makeCandidate("TEST-001")],
      evidenceMap: new Map(),
      totalConsidered: 1,
    })
  })

  it("routes mixed pending replies through multi-stage and applies all resolved filters", async () => {
    const prevState = buildSessionState({
      candidateCount: 9828,
      appliedFilters: [
        buildAppliedFilterFromValue("diameterMm", 10, 1)!,
        buildAppliedFilterFromValue("machiningCategory", "Milling", 1)!,
        { field: "toolSubtype", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 2 } as any,
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        diameterMm: 10,
        machiningCategory: "Milling",
      } as any,
      turnCount: 2,
      lastAskedField: "fluteCount",
      displayedCandidates: [],
      displayedChips: ["2날", "4날", "3날", "상관없음"],
      displayedOptions: [
        { index: 1, label: "2날", field: "fluteCount", value: "2날", count: 240 },
        { index: 2, label: "4날", field: "fluteCount", value: "4날", count: 120 },
        { index: 3, label: "3날", field: "fluteCount", value: "3날", count: 80 },
        { index: 4, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
      ],
      currentMode: "question",
    })

    const deps = createServeRuntimeDependencies()
    const buildTerminalResponse = vi.fn(async (
      _form: any,
      _candidates: any,
      _evidenceMap: any,
      totalCandidateCount: number,
      _pagination: any,
      _displayCandidates: any,
      _displayEvidenceMap: any,
      input: any,
      _history: any,
      filters: any,
    ) => new Response(JSON.stringify({
      totalCandidateCount,
      resolvedInput: input,
      appliedFilters: filters,
    }), {
      headers: { "content-type": "application/json" },
    }))

    deps.buildQuestionResponse = buildTerminalResponse as any
    deps.buildRecommendationResponse = buildTerminalResponse as any

    const response = await handleServeExploration(
      deps,
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "4날 TiAlN Square 추천해줘" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(resolveMultiStageQueryMock).toHaveBeenCalledTimes(1)
    const resolverArgs = resolveMultiStageQueryMock.mock.calls[0][0]
    expect(resolverArgs.pendingField).toBe("fluteCount")
    expect(resolverArgs.requestPreparationSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fluteCount" }),
      expect.objectContaining({ field: "coating", value: "TiAlN" }),
    ]))
    expect(resolverArgs.recognizedEntities).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "coating", value: "TiAlN" }),
      expect.objectContaining({ field: "toolSubtype", value: "Square" }),
    ]))

    expect(body.appliedFilters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
      expect.objectContaining({ field: "machiningCategory", rawValue: "Milling" }),
      expect.objectContaining({ field: "fluteCount", rawValue: 4 }),
      expect.objectContaining({ field: "coating", rawValue: "TiAlN" }),
      expect.objectContaining({ field: "toolSubtype", rawValue: "Square" }),
    ]))
    expect(body.appliedFilters).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ field: "toolSubtype", op: "skip" })]),
    )
  })
})
