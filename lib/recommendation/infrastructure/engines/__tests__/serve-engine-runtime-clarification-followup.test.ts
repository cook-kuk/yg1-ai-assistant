import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/recommendation/core/multi-stage-query-resolver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/recommendation/core/multi-stage-query-resolver")>("@/lib/recommendation/core/multi-stage-query-resolver")
  return {
    ...actual,
    resolveMultiStageQuery: vi.fn(async () => ({
      source: "clarification",
      filters: [],
      sort: null,
      routeHint: "none",
      intent: "ask_clarification",
      clearOtherFilters: false,
      removeFields: [],
      followUpFilter: null,
      confidence: 0,
      unresolvedTokens: ["ambiguous"],
      reasoning: "need follow-up clarification",
      clarification: {
        question: "어느 재질을 제외할지 조금만 더 구체적으로 알려주세요.",
        chips: ["티타늄 제외", "스테인리스 제외", "직접 입력"],
        askedField: "workPieceName",
      },
    })),
  }
})

it("uses repair-mode clarification for frustration-only correction signals", async () => {
  const prevState = buildSessionState({
    candidateCount: 12,
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 1 },
      { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 2 },
    ] as any,
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      flutePreference: 2,
      toolSubtype: "Square",
    } as any,
    turnCount: 2,
    displayedCandidates: [],
    displayedChips: ["2날", "Square"],
    displayedOptions: [],
    currentMode: "question",
  })

  const response = await handleServeExploration(
    createServeRuntimeDependencies(),
    INITIAL_INTAKE_FORM,
    [{ role: "user", text: "진짜 너 말 안듣는다" }],
    prevState,
    null,
    "ko",
    null,
  )

  const body = await response.json() as any

  expect(body.error).toBeUndefined()
  expect(body.purpose).toBe("question")
  expect(body.text).toContain("현재는")
  expect(body.text).toContain("형상=Square")
  expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
  expect(body.session?.engineState?.displayedChips).toEqual(expect.arrayContaining(["Square 말고", "2날 말고", "직접 입력"]))
})

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

describe("handleServeExploration follow-up clarification bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a clarification response on follow-up turns without crashing requestPreparation wiring", async () => {
    const prevState = buildSessionState({
      candidateCount: 24,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
      },
      turnCount: 1,
      lastAskedField: "workPieceName",
      displayedCandidates: [],
      displayedChips: ["티타늄", "스테인리스"],
      displayedOptions: [],
      currentMode: "question",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "그거 말고" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.text).toContain("구체적으로")
    expect(body.requestPreparation).toBeTruthy()
    expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
    expect(body.session?.engineState?.displayedChips).toEqual(expect.arrayContaining(["직접 입력"]))
  })
})
