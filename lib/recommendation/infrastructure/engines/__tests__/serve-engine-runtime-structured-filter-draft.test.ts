import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  naturalLanguageToQuerySpecMock,
  resolveMultiStageQueryMock,
  routeSingleCallMock,
} = vi.hoisted(() => ({
  naturalLanguageToQuerySpecMock: vi.fn(),
  resolveMultiStageQueryMock: vi.fn(),
  routeSingleCallMock: vi.fn(),
}))

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

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration structured filter draft bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveMultiStageQueryMock.mockResolvedValue({
      source: "none",
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "narrow",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: [],
      reasoning: "no-op",
      clarification: null,
    })
    routeSingleCallMock.mockResolvedValue({
      actions: [{ type: "show_recommendation" }],
      answer: "",
      reasoning: "should-not-run",
    })
  })

  it("asks clarification before execution when the draft detects a tool-family domain lock", async () => {
    naturalLanguageToQuerySpecMock.mockResolvedValue({
      spec: {
        intent: "narrow",
        navigation: "none",
        constraints: [
          { field: "toolFamily", op: "eq", value: "Tap", display: "공구 타입: Tap" },
        ],
      },
      raw: "{}",
      latencyMs: 1,
    })

    const prevState = buildSessionState({
      candidateCount: 42,
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
      [{ role: "user", text: "이번엔 탭으로 볼래" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.text).toContain("새 작업")
    expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
    expect(body.session?.engineState?.displayedChips).toEqual(
      expect.arrayContaining(["새 작업으로", "기존 조건 수정", "직접 입력"]),
    )
    expect(routeSingleCallMock).not.toHaveBeenCalled()
  })
})
