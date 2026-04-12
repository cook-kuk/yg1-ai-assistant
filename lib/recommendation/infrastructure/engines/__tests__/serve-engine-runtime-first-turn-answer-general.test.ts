import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { handleServeGeneralChatActionMock } = vi.hoisted(() => ({
  handleServeGeneralChatActionMock: vi.fn(async (params: any) =>
    new Response(
      JSON.stringify({
        purpose: "general_chat",
        text: `handled:${params.action.type}`,
        sessionState: params.prevState,
      }),
      { headers: { "content-type": "application/json" } },
    )
  ),
}))

vi.mock("../serve-engine-general-chat", async () => {
  const actual = await vi.importActual<typeof import("../serve-engine-general-chat")>("../serve-engine-general-chat")
  return {
    ...actual,
    handleServeGeneralChatAction: handleServeGeneralChatActionMock,
  }
})

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: vi.fn(async () => ({
      source: "stage2",
      filters: [],
      sort: null,
      routeHint: "ui_question",
      intent: "answer_general",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0.95,
      unresolvedTokens: [],
      reasoning: "ui question",
      clarification: null,
    })),
  }
})

import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration first-turn answer_general bridge", () => {
  beforeEach(() => {
    handleServeGeneralChatActionMock.mockClear()
  })

  it("dispatches a terminal first-turn resolver answer to general chat", async () => {
    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "옆에 Excellent 의 의미는 뭔가요?" }],
      null,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(handleServeGeneralChatActionMock).toHaveBeenCalledTimes(1)
    const call = handleServeGeneralChatActionMock.mock.calls[0][0]
    expect(call.action.type).toBe("answer_general")
    expect(call.prevState).toBeTruthy()
    expect(call.prevState.currentMode).toBe("question")
    expect(body.purpose).toBe("general_chat")
    expect(body.text).toBe("handled:answer_general")
  })
})
