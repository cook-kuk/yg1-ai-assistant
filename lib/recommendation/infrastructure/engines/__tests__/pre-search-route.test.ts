import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { classifyPreSearchRoute } from "@/lib/recommendation/infrastructure/engines/pre-search-route"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-session",
    candidateCount: 25,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {} as any,
    turnCount: 3,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: "workPieceName",
    ...overrides,
  }
}

const unavailableProvider = {
  available: () => false,
  complete: vi.fn(),
  completeWithTools: vi.fn(),
} as any

describe("classifyPreSearchRoute", () => {
  it("routes first-turn taxonomy explanation questions to general_knowledge before search", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      null,
      unavailableProvider,
    )

    expect(result.kind).toBe("general_knowledge")
    expect(result.reason).toBe("taxonomy_knowledge")
  })

  it("routes taxonomy explanation questions to general_knowledge before search", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      makeState(),
      unavailableProvider,
    )

    expect(result.kind).toBe("general_knowledge")
    expect(result.reason).toBe("taxonomy_knowledge")
  })

  it("routes explicit product info questions to direct_lookup", async () => {
    const result = await classifyPreSearchRoute(
      "GYG02100 스펙 알려줘",
      makeState(),
      unavailableProvider,
    )

    expect(result.kind).toBe("direct_lookup")
    expect(result.reason).toContain("query_target:product_info")
  })

  it("keeps recommendation narrowing answers in recommendation_action", async () => {
    const result = await classifyPreSearchRoute(
      "알루미늄으로 해줘",
      makeState({
        displayedChips: ["알루미늄", "스테인리스", "상관없음"],
        lastAskedField: "material",
      }),
      unavailableProvider,
    )

    expect(result.kind).toBe("recommendation_action")
  })
})
