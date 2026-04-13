import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { routeSingleCallMock } = vi.hoisted(() => ({
  routeSingleCallMock: vi.fn(async () => ({
    actions: [{ type: "answer", message: "LLM deferred negation" }],
    answer: "LLM deferred negation",
    reasoning: "scr:no_negation_fallback",
  })),
}))

vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>("@/lib/feature-flags")
  return {
    ...actual,
    isSingleCallRouterEnabled: () => true,
  }
})

vi.mock("@/lib/recommendation/core/edit-intent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/edit-intent")>("@/lib/recommendation/core/edit-intent")
  return {
    ...actual,
    hasEditSignal: () => false,
    parseEditIntent: () => null,
    shouldExecuteEditIntentDeterministically: () => false,
  }
})

vi.mock("@/lib/recommendation/core/knowledge-graph", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/knowledge-graph")>("@/lib/recommendation/core/knowledge-graph")
  return {
    ...actual,
    tryKGDecision: () => ({ decision: null, confidence: 0, source: "none", reason: "mocked" }),
  }
})

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: vi.fn(async () => ({
      source: "none",
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "refine_recommendation",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: [],
      reasoning: "noop",
      clarification: null,
    })),
  }
})

vi.mock("@/lib/recommendation/core/single-call-router", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/single-call-router")>("@/lib/recommendation/core/single-call-router")
  return {
    ...actual,
    routeSingleCall: routeSingleCallMock,
  }
})

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration negation fallback removal", () => {
  it("does not materialize deterministic neq filters and reaches SCR instead", async () => {
    routeSingleCallMock.mockClear()

    const prevState = buildSessionState({
      candidateCount: 12,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Carbon Steels", rawValue: "Carbon Steels", appliedAt: 1 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        workPieceName: "Carbon Steels",
      } as any,
      turnCount: 2,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      currentMode: "recommendation",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "Y코팅 말고 추천해줘" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any
    const engineState = body.sessionState ?? body.session?.engineState ?? null

    expect(routeSingleCallMock).toHaveBeenCalledTimes(1)
    expect(engineState).toBeTruthy()
    expect(engineState.appliedFilters).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ field: "coating", op: "neq" })]),
    )
  })
})
