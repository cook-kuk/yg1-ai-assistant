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
  describe("phantom categorical filter guard", () => {
    it("drops brand filter when value is not in user message (ONLY ONE hallucination)", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "brand", "value": "ONLY ONE" }],
        "confidence": 0.9,
        "reasoning": "phantom"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "너 이름은?",
        sessionState: makeState(),
        provider,
      })

      expect(result).toBeNull()
    })

    it("drops seriesName filter when value is not in user message (상관없음 hallucination)", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "seriesName", "value": "상관없음" }],
        "confidence": 0.9,
        "reasoning": "phantom"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "오호 추천해줘",
        sessionState: makeState(),
        provider,
      })

      expect(result).toBeNull()
    })

    it("drops country filter when value is not in user message", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "country", "value": "Korea" }],
        "confidence": 0.9,
        "reasoning": "phantom"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "안녕하세요",
        sessionState: makeState(),
        provider,
      })

      expect(result).toBeNull()
    })

    it("keeps brand filter when value literally appears in user message", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "brand", "value": "ONLY ONE" }],
        "confidence": 0.9,
        "reasoning": "legit"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "ONLY ONE 브랜드만 보여줘",
        sessionState: makeState(),
        provider,
      })

      expect(result).not.toBeNull()
      if (result?.action.type !== "continue_narrowing") {
        throw new Error("expected continue_narrowing")
      }
      expect(result.action.filter.field).toBe("brand")
    })

    it("matches brand value case-insensitively and ignores spacing", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "brand", "value": "ONLY ONE" }],
        "confidence": 0.9,
        "reasoning": "legit"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "onlyone 으로만 줘",
        sessionState: makeState(),
        provider,
      })

      expect(result).not.toBeNull()
    })

    it("drops phantom brand but promotes legit toolSubtype filter to action", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [
          { "field": "brand", "value": "ONLY ONE" },
          { "field": "toolSubtype", "value": "Square" }
        ],
        "confidence": 0.9,
        "reasoning": "mixed"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "square 형상으로",
        sessionState: makeState(),
        provider,
      })

      expect(result).not.toBeNull()
      if (result?.action.type !== "continue_narrowing") {
        throw new Error("expected continue_narrowing")
      }
      expect(result.action.filter.field).toBe("toolSubtype")
      expect(result.extraFilters).toEqual([])
    })

    it("drops brand value when only matched as prefix of product code (word boundary)", async () => {
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "brand", "value": "GMG" }],
        "confidence": 0.9,
        "reasoning": "phantom from product code"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "GMG55100 이랑 GMG40100의 차이가 뭐야?",
        sessionState: makeState(),
        provider,
      })

      expect(result).toBeNull()
    })

    it("does not apply substring guard to non-categorical fields like toolMaterial", async () => {
      // Korean transliteration must still work for material/shape
      const provider = createMockProvider(`{
        "action": "continue_narrowing",
        "filters": [{ "field": "toolMaterial", "value": "Carbide" }],
        "confidence": 0.9,
        "reasoning": "한글 음역"
      }`)

      const result = await extractSemanticTurnDecision({
        userMessage: "카바이드로 줘",
        sessionState: makeState(),
        provider,
      })

      expect(result).not.toBeNull()
    })
  })

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
