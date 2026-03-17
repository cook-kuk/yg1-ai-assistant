/**
 * Intent Classifier — Regression Tests
 *
 * Tests deterministic pattern matching for all intent types.
 * Uses a mock provider that throws (forcing deterministic path).
 */

import { describe, it, expect } from "vitest"
import { classifyIntent } from "../intent-classifier"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { LLMProvider } from "@/lib/llm/provider"

// Mock provider that always throws (force deterministic classification)
const mockProvider: LLMProvider = {
  available: () => false,
  complete: async () => { throw new Error("mock provider") },
  completeWithTools: async () => { throw new Error("mock provider") },
} as unknown as LLMProvider

function makeSessionState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "ses-test",
    candidateCount: 50,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { locale: "en", manufacturerScope: "yg1-only" },
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  }
}

describe("Intent Classifier — Slot Replacement", () => {
  it("detects '4mm로 바꿔줘' with existing diameter filter as CHANGE_SINGLE_VALUED_SLOT", async () => {
    const state = makeSessionState({
      appliedFilters: [{ field: "diameterMm", op: "eq", value: "2mm", rawValue: 2, appliedAt: 0 }],
    })
    const result = await classifyIntent("4mm로 바꿔줘", state, mockProvider)
    expect(result.intent).toBe("CHANGE_SINGLE_VALUED_SLOT")
  })

  it("detects '직경 변경해줘' with existing diameter filter", async () => {
    const state = makeSessionState({
      appliedFilters: [{ field: "diameterMm", op: "eq", value: "2mm", rawValue: 2, appliedAt: 0 }],
    })
    const result = await classifyIntent("직경 변경해줘", state, mockProvider)
    expect(result.intent).toBe("CHANGE_SINGLE_VALUED_SLOT")
  })

  it("detects implicit diameter replacement '6mm' when diameter filter already exists", async () => {
    const state = makeSessionState({
      appliedFilters: [{ field: "diameterMm", op: "eq", value: "2mm", rawValue: 2, appliedAt: 0 }],
    })
    const result = await classifyIntent("6mm", state, mockProvider)
    expect(result.intent).toBe("CHANGE_SINGLE_VALUED_SLOT")
    expect(result.extractedValue).toBe("6mm")
  })

  it("detects implicit flute replacement '2날' when fluteCount filter already exists", async () => {
    const state = makeSessionState({
      appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 }],
    })
    const result = await classifyIntent("2날", state, mockProvider)
    expect(result.intent).toBe("CHANGE_SINGLE_VALUED_SLOT")
    expect(result.extractedValue).toBe("2날")
  })

  it("does NOT trigger replacement when no filter exists for the field", async () => {
    const state = makeSessionState({ appliedFilters: [] })
    const result = await classifyIntent("4mm", state, mockProvider)
    expect(result.intent).not.toBe("CHANGE_SINGLE_VALUED_SLOT")
  })
})

describe("Intent Classifier — Side Conversation", () => {
  it("classifies '힘들어' as SIDE_CONVERSATION", async () => {
    const result = await classifyIntent("힘들어", null, mockProvider)
    expect(result.intent).toBe("SIDE_CONVERSATION")
  })

  it("classifies '감사합니다' as SIDE_CONVERSATION", async () => {
    const result = await classifyIntent("감사합니다", null, mockProvider)
    expect(result.intent).toBe("SIDE_CONVERSATION")
  })

  it("classifies '나랑 얘기 좀 할래?' as SIDE_CONVERSATION", async () => {
    const result = await classifyIntent("나랑 얘기 좀 할래?", null, mockProvider)
    expect(result.intent).toBe("SIDE_CONVERSATION")
  })
})

describe("Intent Classifier — Simple Math", () => {
  it("classifies '1+1' as SIMPLE_MATH", async () => {
    const result = await classifyIntent("1+1", null, mockProvider)
    expect(result.intent).toBe("SIMPLE_MATH")
  })

  it("classifies '3 × 7' as SIMPLE_MATH", async () => {
    const result = await classifyIntent("3 × 7", null, mockProvider)
    expect(result.intent).toBe("SIMPLE_MATH")
  })
})

describe("Intent Classifier — Meta Conversation", () => {
  it("classifies '넌 뭐야?' as META_CONVERSATION", async () => {
    const result = await classifyIntent("넌 뭐야?", null, mockProvider)
    expect(result.intent).toBe("META_CONVERSATION")
  })

  it("classifies '갑자기 왜 추천해?' as META_CONVERSATION", async () => {
    const result = await classifyIntent("갑자기 왜 추천해?", null, mockProvider)
    expect(result.intent).toBe("META_CONVERSATION")
  })
})

describe("Intent Classifier — Scope Confirmation", () => {
  it("classifies '지금 Square만 보여주는 거 맞아?' as ASK_SCOPE_CONFIRMATION", async () => {
    const state = makeSessionState({
      appliedFilters: [{ field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 }],
    })
    const result = await classifyIntent("지금 Square만 보여주는 거 맞아?", state, mockProvider)
    expect(result.intent).toBe("ASK_SCOPE_CONFIRMATION")
  })

  it("classifies '이거 지금 그 조건에 해당하는 것들이야?' as ASK_SCOPE_CONFIRMATION", async () => {
    const state = makeSessionState()
    const result = await classifyIntent("이거 지금 그 조건에 해당하는 것들이야?", state, mockProvider)
    expect(result.intent).toBe("ASK_SCOPE_CONFIRMATION")
  })
})

describe("Intent Classifier — Return to Recommendation", () => {
  it("classifies '다시 추천 이어가자' when overlay is active", async () => {
    const state = makeSessionState({ overlayMode: "side_conversation" })
    const result = await classifyIntent("다시 추천 이어가자", state, mockProvider)
    expect(result.intent).toBe("RETURN_TO_ACTIVE_RECOMMENDATION")
  })

  it("does NOT trigger return when overlay is NOT active", async () => {
    const state = makeSessionState({ overlayMode: null })
    const result = await classifyIntent("다시 추천 이어가자", state, mockProvider)
    // Without overlay mode, "다시" triggers RESET_SESSION pattern
    expect(result.intent).not.toBe("RETURN_TO_ACTIVE_RECOMMENDATION")
  })
})

describe("Intent Classifier — Comparison Follow-up", () => {
  it("classifies '그 중에서 뭐가 나아?' with persisted comparison scope", async () => {
    const state = makeSessionState({
      lastComparedProductCodes: ["GEE001", "GEE002"],
    })
    const result = await classifyIntent("그 중에서 뭐가 나아?", state, mockProvider)
    expect(result.intent).toBe("ASK_COMPARISON")
    expect(result.extractedValue).toBe("GEE001,GEE002")
  })

  it("does NOT use persisted scope when no comparison was done", async () => {
    const state = makeSessionState({ lastComparedProductCodes: undefined })
    const result = await classifyIntent("그 중에서 뭐가 나아?", state, mockProvider)
    // Without comparison scope, "뭐가 나" matches EXPLAIN pattern, not COMPARISON
    // The key point: it should NOT inject specific product codes
    expect(result.extractedValue ?? "").not.toContain("GEE001")
  })
})

describe("Intent Classifier — Existing Patterns Preserved", () => {
  it("still classifies '처음부터 다시' as RESET_SESSION", async () => {
    const result = await classifyIntent("처음부터 다시", null, mockProvider)
    expect(result.intent).toBe("RESET_SESSION")
  })

  it("still classifies '추천해주세요' as ASK_RECOMMENDATION", async () => {
    const result = await classifyIntent("추천해주세요", null, mockProvider)
    expect(result.intent).toBe("ASK_RECOMMENDATION")
  })

  it("still classifies numbered option with session", async () => {
    const state = makeSessionState({
      displayedOptions: [
        { index: 1, label: "Square (26개)", field: "toolSubtype", value: "Square", count: 26 },
        { index: 2, label: "Ball (14개)", field: "toolSubtype", value: "Ball", count: 14 },
      ],
    })
    const result = await classifyIntent("1번", state, mockProvider)
    expect(result.intent).toBe("SELECT_OPTION")
    expect(result.extractedValue).toBe("Square")
  })
})
