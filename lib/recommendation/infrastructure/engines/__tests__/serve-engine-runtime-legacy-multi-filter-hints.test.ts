import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  naturalLanguageToQuerySpecMock,
  naturalLanguageToFiltersMock,
  naturalLanguageToFiltersStreamingMock,
  resolveMultiStageQueryMock,
  routeSingleCallMock,
  runHybridRetrievalMock,
} = vi.hoisted(() => ({
  naturalLanguageToQuerySpecMock: vi.fn(),
  naturalLanguageToFiltersMock: vi.fn(),
  naturalLanguageToFiltersStreamingMock: vi.fn(),
  resolveMultiStageQueryMock: vi.fn(),
  routeSingleCallMock: vi.fn(),
  runHybridRetrievalMock: vi.fn(),
}))

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags")
  return {
    ...actual,
    shouldUseV2ForPhase: () => false,
    isSingleCallRouterEnabled: () => true,
  }
})

vi.mock("@/lib/recommendation/core/query-planner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/query-planner")>("@/lib/recommendation/core/query-planner")
  return {
    ...actual,
    naturalLanguageToQuerySpec: naturalLanguageToQuerySpecMock,
  }
})

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: resolveMultiStageQueryMock,
  }
})

vi.mock("@/lib/recommendation/core/single-call-router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/single-call-router")>("@/lib/recommendation/core/single-call-router")
  return {
    ...actual,
    routeSingleCall: routeSingleCallMock,
  }
})

vi.mock("@/lib/recommendation/core/sql-agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/sql-agent")>("@/lib/recommendation/core/sql-agent")
  return {
    ...actual,
    naturalLanguageToFilters: naturalLanguageToFiltersMock,
    naturalLanguageToFiltersStreaming: naturalLanguageToFiltersStreamingMock,
  }
})

vi.mock("@/lib/recommendation/core/knowledge-graph", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/knowledge-graph")>("@/lib/recommendation/core/knowledge-graph")
  return {
    ...actual,
    tryKGDecision: () => ({ decision: null, confidence: 0, source: "none", reason: "mocked" }),
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
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration legacy multi-filter hints", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    resolveMultiStageQueryMock.mockResolvedValue({
      source: "none",
      action: "execute",
      filters: [],
      concepts: [],
      sort: null,
      routeHint: "none",
      intent: "none",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: ["4날", "TiAlN", "Square"],
      reasoning: "no terminal semantic resolution",
      clarification: null,
      validation: null,
    })

    routeSingleCallMock.mockResolvedValue({
      actions: [],
      answer: "",
      reasoning: "no-op",
    })

    naturalLanguageToQuerySpecMock.mockResolvedValue({
      spec: {
        intent: "narrow",
        navigation: "none",
        constraints: [],
        sort: null,
        reasoning: "no-op",
      },
      raw: "{}",
      latencyMs: 1,
    })

    naturalLanguageToFiltersMock.mockResolvedValue({
      filters: [],
      reasoning: "no-op",
    })

    naturalLanguageToFiltersStreamingMock.mockResolvedValue({
      filters: [],
      reasoning: "no-op",
    })

    runHybridRetrievalMock.mockResolvedValue({
      candidates: [],
      evidenceMap: new Map(),
      totalConsidered: 0,
    })
  })

  it("does not early-commit partial deterministic hints when the holistic resolver is non-terminal", async () => {
    const prevState = buildSessionState({
      candidateCount: 24,
      appliedFilters: [
        buildAppliedFilterFromValue("machiningCategory", "Milling", 1)!,
        buildAppliedFilterFromValue("diameterMm", 10, 1)!,
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        machiningCategory: "Milling",
        diameterMm: 10,
      } as any,
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
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
    const appliedFilters =
      body.appliedFilters
      ?? body.sessionState?.appliedFilters
      ?? body.session?.publicState?.appliedFilters
      ?? body.session?.engineState?.appliedFilters
      ?? []

    expect(resolveMultiStageQueryMock).toHaveBeenCalledTimes(1)
    expect(appliedFilters).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "machiningCategory", rawValue: "Milling" }),
      expect.objectContaining({ field: "diameterMm", rawValue: 10 }),
    ]))
    expect(appliedFilters).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ field: "fluteCount" }),
      expect.objectContaining({ field: "toolSubtype" }),
      expect.objectContaining({ field: "coating" }),
    ]))
  })
})
