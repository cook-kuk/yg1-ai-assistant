import { beforeEach, describe, expect, it, vi } from "vitest"

import { buildSessionState } from "@/lib/recommendation/domain/session-manager"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import { INITIAL_INTAKE_FORM } from "@/lib/types/intake"
import { handleServeExploration } from "../serve-engine-runtime"

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
        question: "\uC5B4\uB5A4 \uC18C\uC7AC\uB97C \uC81C\uC678\uD560\uC9C0 \uC870\uAE08\uB9CC \uB354 \uAD6C\uCCB4\uC801\uC73C\uB85C \uC54C\uB824\uC8FC\uC138\uC694.",
        chips: [
          "\uD2F0\uD0C0\uB284 \uC81C\uC678",
          "\uC2A4\uD14C\uC778\uB9AC\uC2A4 \uC81C\uC678",
          "\uC9C1\uC811 \uC785\uB825",
        ],
        askedField: "workPieceName",
      },
    })),
  }
})

it("uses repair-mode clarification for frustration-only correction signals", async () => {
  const prevState = buildSessionState({
    candidateCount: 12,
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "2-flute", rawValue: 2, appliedAt: 1 },
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
    displayedChips: ["2-flute", "Square"],
    displayedOptions: [],
    currentMode: "question",
  })

  const response = await handleServeExploration(
    createServeRuntimeDependencies(),
    INITIAL_INTAKE_FORM,
    [{ role: "user", text: "\uC9C4\uC9DC \uB108 \uB9D0 \uC548 \uB4E3\uB294\uB2E4" }],
    prevState,
    null,
    "ko",
    null,
  )

  const body = await response.json() as any

  expect(body.error).toBeUndefined()
  expect(body.purpose).toBe("question")
  expect(body.text).toContain("Square")
  expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
  expect(body.session?.engineState?.displayedChips).toEqual(
    expect.arrayContaining(["Square \uB9D0\uACE0", "2\ub0a0 \uB9D0\uACE0", "\uC9C1\uC811 \uC785\uB825"]),
  )
})

it("uses repair-mode clarification for deictic alternative follow-ups with no concrete target", async () => {
  const prevState = buildSessionState({
    candidateCount: 12,
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "2-flute", rawValue: 2, appliedAt: 1 },
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
    displayedChips: ["2-flute", "Square"],
    displayedOptions: [],
    currentMode: "question",
  })

  const response = await handleServeExploration(
    createServeRuntimeDependencies(),
    INITIAL_INTAKE_FORM,
    [{ role: "user", text: "\uADF8\uAC70 \uB9D0\uACE0 \uB354 \uBB34\uB09C\uD55C \uAC70" }],
    prevState,
    null,
    "ko",
    null,
  )

  const body = await response.json() as any

  expect(body.error).toBeUndefined()
  expect(body.purpose).toBe("question")
  expect(body.text).toContain("Square")
  expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
  expect(body.session?.engineState?.displayedChips).toEqual(
    expect.arrayContaining(["Square \uB9D0\uACE0", "2\ub0a0 \uB9D0\uACE0", "\uC9C1\uC811 \uC785\uB825"]),
  )
})

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
      displayedChips: ["\uD2F0\uD0C0\uB284", "\uC2A4\uD14C\uC778\uB9AC\uC2A4"],
      displayedOptions: [],
      currentMode: "question",
    })

    const response = await handleServeExploration(
      createServeRuntimeDependencies(),
      INITIAL_INTAKE_FORM,
      [{ role: "user", text: "\uADF8\uAC70 \uB9D0\uACE0" }],
      prevState,
      null,
      "ko",
      null,
    )

    const body = await response.json() as any

    expect(body.error).toBeUndefined()
    expect(body.purpose).toBe("question")
    expect(body.text.length).toBeGreaterThan(0)
    expect(body.requestPreparation).toBeTruthy()
    expect(body.session?.engineState?.lastAction).toBe("ask_clarification")
    expect(body.session?.engineState?.displayedChips).toEqual(
      expect.arrayContaining(["\uC9C1\uC811 \uC785\uB825"]),
    )
  })
})
