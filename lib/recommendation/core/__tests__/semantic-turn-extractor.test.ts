import { describe, expect, it } from "vitest"

import { extractSemanticTurnDecision } from "../semantic-turn-extractor"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function createMockProvider(responseText: string): LLMProvider {
  return {
    available: () => true,
    complete: async () => responseText,
    completeWithTools: async () => ({ text: null, toolUse: null }),
  }
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "semantic-test",
    candidateCount: 5725,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "S",
      toolType: "Milling",
    },
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: ["Square (3291개)", "Radius (1764개)", "Ball (469개)"],
    displayedOptions: [
      { index: 1, label: "Square (3291개)", field: "toolSubtype", value: "Square", count: 3291 },
      { index: 2, label: "Radius (1764개)", field: "toolSubtype", value: "Radius", count: 1764 },
    ],
    currentMode: "question",
    lastAskedField: "toolSubtype",
    ...overrides,
  } as ExplorationSessionState
}

describe("extractSemanticTurnDecision", () => {
  it("merges same-field semantic filters into one multi-value filter", async () => {
    const provider = createMockProvider(`{
      "action": "continue_narrowing",
      "filters": [
        { "field": "toolSubtype", "value": "Square" },
        { "field": "toolSubtype", "value": "Radius" }
      ],
      "confidence": 0.91,
      "reasoning": "pending field answer"
    }`)

    const result = await extractSemanticTurnDecision({
      userMessage: "square과 radius",
      sessionState: makeState(),
      provider,
    })

    expect(result).not.toBeNull()
    expect(result?.action.type).toBe("continue_narrowing")
    if (result?.action.type !== "continue_narrowing") {
      throw new Error("expected continue_narrowing")
    }
    expect(result.action.filter.field).toBe("toolSubtype")
    expect(result.action.filter.rawValue).toEqual(["Square", "Radius"])
    expect(result.action.filter.value).toBe("Square, Radius")
    expect(result.extraFilters).toEqual([])
  })
})
