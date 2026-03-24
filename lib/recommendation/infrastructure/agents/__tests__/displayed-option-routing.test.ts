import { describe, expect, it } from "vitest"

import { orchestrateTurn, orchestrateTurnWithTools } from "../orchestrator"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { TurnContext } from "../types"

function makeSessionState(): ExplorationSessionState {
  return {
    sessionId: "routing-test",
    candidateCount: 30,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
    turnCount: 2,
    lastAskedField: "coating",
    displayedCandidates: [],
    displayedChips: ["2날 (30개)", "4날 (12개)", "상관없음"],
    displayedOptions: [
      { index: 1, label: "2날 (30개)", field: "fluteCount", value: "2날", count: 30 },
      { index: 2, label: "4날 (12개)", field: "fluteCount", value: "4날", count: 12 },
      { index: 3, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
    ],
  }
}

function makeTurnContext(userMessage: string): TurnContext {
  return {
    userMessage,
    intakeForm: {} as any,
    sessionState: makeSessionState(),
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
    candidateCount: 30,
    displayedProducts: [],
    currentCandidates: [],
  }
}

const noLlmProvider = {
  available: () => false,
  complete: async () => {
    throw new Error("LLM should not be called")
  },
  completeWithTools: async () => {
    throw new Error("LLM should not be called")
  },
} as any

describe("displayed option routing", () => {
  it("uses the displayed option field for numbered selections even when lastAskedField is stale", async () => {
    const result = await orchestrateTurn(makeTurnContext("1번"), noLlmProvider)

    expect(result.action.type).toBe("continue_narrowing")
    if (result.action.type !== "continue_narrowing") {
      throw new Error("expected continue_narrowing")
    }

    expect(result.action.filter.field).toBe("fluteCount")
    expect(result.action.filter.rawValue).toBe(2)
    expect(result.action.filter.value).toContain("2")
  })

  it("overrides wrong tool fields with the currently displayed option selection", async () => {
    const provider = {
      available: () => true,
      complete: async () => {
        throw new Error("complete should not be called")
      },
      completeWithTools: async () => ({
        text: null,
        toolUse: {
          toolName: "apply_filter",
          input: {
            field: "coating",
            value: "2날 (30개)",
            display_value: "2날 (30개)",
          },
        },
      }),
    } as any

    const result = await orchestrateTurnWithTools(makeTurnContext("2날 (30개)"), provider)

    expect(result.action.type).toBe("continue_narrowing")
    if (result.action.type !== "continue_narrowing") {
      throw new Error("expected continue_narrowing")
    }

    expect(result.action.filter.field).toBe("fluteCount")
    expect(result.action.filter.rawValue).toBe(2)
    expect(result.action.filter.value).toContain("2")
  })
})
