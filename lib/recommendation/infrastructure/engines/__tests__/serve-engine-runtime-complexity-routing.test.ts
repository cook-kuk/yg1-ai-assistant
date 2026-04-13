import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  resolveMultiStageQueryMock,
  routeSingleCallMock,
  naturalLanguageToFiltersMock,
  naturalLanguageToFiltersStreamingMock,
  naturalLanguageToQuerySpecMock,
  findMatchingToolMock,
  forgeAndExecuteMock,
  executeRegistryToolMock,
} = vi.hoisted(() => ({
  resolveMultiStageQueryMock: vi.fn(),
  routeSingleCallMock: vi.fn(),
  naturalLanguageToFiltersMock: vi.fn(),
  naturalLanguageToFiltersStreamingMock: vi.fn(),
  naturalLanguageToQuerySpecMock: vi.fn(),
  findMatchingToolMock: vi.fn(),
  forgeAndExecuteMock: vi.fn(),
  executeRegistryToolMock: vi.fn(),
}))

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags")
  return {
    ...actual,
    isSingleCallRouterEnabled: () => true,
  }
})

vi.mock("@/lib/recommendation/core/knowledge-graph", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/knowledge-graph")>("@/lib/recommendation/core/knowledge-graph")
  return {
    ...actual,
    tryKGDecision: () => ({ decision: null, confidence: 0, source: "none", reason: "mocked" }),
  }
})

vi.mock("@/lib/recommendation/core/deterministic-scr", () => ({
  parseDeterministic: () => [],
}))

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

vi.mock("@/lib/recommendation/core/query-planner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/query-planner")>("@/lib/recommendation/core/query-planner")
  return {
    ...actual,
    naturalLanguageToQuerySpec: naturalLanguageToQuerySpecMock,
  }
})

vi.mock("@/lib/recommendation/core/tool-registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/tool-registry")>("@/lib/recommendation/core/tool-registry")
  return {
    ...actual,
    findMatchingTool: findMatchingToolMock,
  }
})

vi.mock("@/lib/recommendation/core/tool-forge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/tool-forge")>("@/lib/recommendation/core/tool-forge")
  return {
    ...actual,
    forgeAndExecute: forgeAndExecuteMock,
    executeRegistryTool: executeRegistryToolMock,
  }
})

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { applyThinkingFieldsToPayload, handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration complexity routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as { __yg1ProductDbPool?: object }).__yg1ProductDbPool = {}
    resolveMultiStageQueryMock.mockResolvedValue({
      source: "stage1",
      filters: [
        { field: "diameterMm", op: "gte", value: 10, rawValue: "10", appliedAt: 2 },
      ],
      sort: null,
      routeHint: "show_recommendation",
      intent: "continue_narrowing",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0.99,
      unresolvedTokens: [],
      reasoning: "deterministic diameter filter",
      clarification: null,
      validation: null,
    })
    routeSingleCallMock.mockResolvedValue({
      actions: [{ type: "show_recommendation" }],
      answer: "should-not-run",
      reasoning: "should-not-run",
    })
    naturalLanguageToFiltersMock.mockResolvedValue({
      filters: [],
      reasoning: "should-not-run",
    })
    naturalLanguageToFiltersStreamingMock.mockResolvedValue({
      filters: [],
      reasoning: "should-not-run",
    })
    naturalLanguageToQuerySpecMock.mockResolvedValue({
      spec: {
        intent: "narrow",
        navigation: "none",
        constraints: [],
        reasoning: "no-op",
      },
      raw: "{}",
      latencyMs: 1,
    })
    findMatchingToolMock.mockResolvedValue(null)
    forgeAndExecuteMock.mockResolvedValue({
      success: false,
      rows: [],
      tool: null,
      attempts: [],
      totalDurationMs: 1,
    })
    executeRegistryToolMock.mockResolvedValue({ rows: [] })
  })

  afterEach(() => {
    delete (globalThis as { __yg1ProductDbPool?: object }).__yg1ProductDbPool
  })

  it("keeps fast-path numeric filters off the legacy LLM fallback pipeline", async () => {
    const prevState = buildSessionState({
      candidateCount: 24,
      appliedFilters: [
        { field: "toolType", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        toolType: "Milling",
      } as any,
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      currentMode: "question",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "10mm 이상" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any
    const engineState = body.sessionState ?? body.session?.engineState ?? null

    expect(resolveMultiStageQueryMock).toHaveBeenCalledTimes(1)
    expect(routeSingleCallMock).not.toHaveBeenCalled()
    expect(naturalLanguageToFiltersMock).not.toHaveBeenCalled()
    expect(naturalLanguageToFiltersStreamingMock).not.toHaveBeenCalled()
    expect(body.reasoningVisibility ?? engineState?.reasoningVisibility ?? null).toBe("hidden")
    expect(engineState?.thinkingProcess ?? body.thinkingProcess ?? null).toBeNull()
    expect(engineState?.thinkingDeep ?? body.thinkingDeep ?? null).toBeNull()
  })

  it("keeps normal-path compound requests off legacy fallback and tool forge", async () => {
    resolveMultiStageQueryMock.mockResolvedValue({
      source: "none",
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "none",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: [],
      reasoning: "no-op",
      clarification: null,
      validation: null,
    })

    const prevState = buildSessionState({
      candidateCount: 24,
      appliedFilters: [
        { field: "toolType", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        toolType: "Milling",
      } as any,
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      currentMode: "question",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "4날 Square 추천" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any
    expect(body.error).toBeUndefined()
    expect(routeSingleCallMock).not.toHaveBeenCalled()
    expect(findMatchingToolMock).not.toHaveBeenCalled()
    expect(forgeAndExecuteMock).not.toHaveBeenCalled()
  })

  it("keeps deep-path legacy fallback available", async () => {
    resolveMultiStageQueryMock.mockResolvedValue({
      source: "none",
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "none",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: [],
      reasoning: "no-op",
      clarification: null,
      validation: null,
    })

    const prevState = buildSessionState({
      candidateCount: 24,
      appliedFilters: [
        { field: "toolType", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        toolType: "Milling",
      } as any,
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      currentMode: "question",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "multiple helix 있는 거" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(routeSingleCallMock).toHaveBeenCalledTimes(1)
  })

  it("keeps UI reasoning state hidden when visibility is hidden", () => {
    const payload = applyThinkingFieldsToPayload(
      {
        thinkingProcess: "stale",
        thinkingDeep: "stale-deep",
        session: {
          engineState: {
            thinkingProcess: "stale",
            thinkingDeep: "stale-deep",
          },
        },
      },
      { thinkingProcess: "new simple", thinkingDeep: "new deep" },
      "hidden",
    ) as any

    expect(payload.reasoningVisibility).toBe("hidden")
    expect(payload.thinkingProcess).toBeNull()
    expect(payload.thinkingDeep).toBeNull()
    expect(payload.session.engineState.reasoningVisibility).toBe("hidden")
    expect(payload.session.engineState.thinkingProcess).toBeNull()
    expect(payload.session.engineState.thinkingDeep).toBeNull()
  })

  it("preserves simple and full reasoning payloads when visibility allows them", () => {
    const simplePayload = applyThinkingFieldsToPayload(
      { session: { engineState: {} } },
      { thinkingProcess: "simple trace", thinkingDeep: null },
      "simple",
    ) as any
    const fullPayload = applyThinkingFieldsToPayload(
      { session: { engineState: {} } },
      { thinkingProcess: null, thinkingDeep: "deep trace" },
      "full",
    ) as any

    expect(simplePayload.reasoningVisibility).toBe("simple")
    expect(simplePayload.thinkingProcess).toBe("simple trace")
    expect(simplePayload.thinkingDeep ?? null).toBeNull()
    expect(simplePayload.session.engineState.reasoningVisibility).toBe("simple")

    expect(fullPayload.reasoningVisibility).toBe("full")
    expect(fullPayload.thinkingProcess ?? null).toBeNull()
    expect(fullPayload.thinkingDeep).toBe("deep trace")
    expect(fullPayload.session.engineState.reasoningVisibility).toBe("full")
  })
})
