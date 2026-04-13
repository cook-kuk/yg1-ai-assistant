import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: vi.fn(async () => ({
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
      reasoning: "noop",
      clarification: null,
    })),
  }
})

vi.mock("@/lib/recommendation/infrastructure/llm/recommendation-llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/infrastructure/llm/recommendation-llm")>("@/lib/recommendation/infrastructure/llm/recommendation-llm")
  return {
    ...actual,
    getProvider: () => ({
      available: () => true,
      complete: async (_systemPrompt: string, _messages: Array<{ role: string; content: string }>, _maxTokens?: number, _model?: string, agentName?: string) => {
        if (agentName === "turn-repair") {
          return JSON.stringify({ clarified: "", explanation: null })
        }
        if (agentName === "turn-orchestrator") {
          return JSON.stringify({
            decision: "use_state_options",
            confidence: 0.93,
            reasoning: "repair turn should reuse the currently shown toolSubtype options",
            targetField: "toolSubtype",
            excludedValue: "Square",
          })
        }
        return "{}"
      },
    }),
  }
})

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration repair clarification arbiter", () => {
  it("reuses current state options for deictic repair turns instead of generic repair chips", async () => {
    const prevState = buildSessionState({
      candidateCount: 5,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Carbon Steels", rawValue: "Carbon Steels", appliedAt: 0 },
        { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 },
      ] as any,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        workPieceName: "Carbon Steels",
        toolSubtype: "Square",
      } as any,
      turnCount: 2,
      displayedCandidates: [] as any,
      displayedChips: ["Square (2개)", "Ball (2개)", "Radius (1개)"],
      displayedOptions: [
        { index: 1, label: "Square (2개)", field: "toolSubtype", value: "Square", count: 2 },
        { index: 2, label: "Ball (2개)", field: "toolSubtype", value: "Ball", count: 2 },
        { index: 3, label: "Radius (1개)", field: "toolSubtype", value: "Radius", count: 1 },
      ],
      currentMode: "question",
      lastAskedField: "toolSubtype",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "그거 말고 더 무난한 거" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.chips).toEqual(expect.arrayContaining(["Ball (2개)", "Radius (1개)", "직접 입력"]))
    expect(body.chips).not.toEqual(expect.arrayContaining(["Square 말고"]))
    expect(body.session?.engineState?.displayedOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "toolSubtype", value: "Ball" }),
      expect.objectContaining({ field: "toolSubtype", value: "Radius" }),
    ]))
  })
})
