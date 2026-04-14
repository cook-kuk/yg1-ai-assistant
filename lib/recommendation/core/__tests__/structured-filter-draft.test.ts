import { describe, expect, it } from "vitest"

import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { QuerySpec } from "../query-spec"
import {
  buildStructuredFilterDraft,
  interpretStructuredFilterDraft,
  validateStructuredFilterDraft,
} from "../structured-filter-draft"

function createMockProvider(responseText: string): LLMProvider {
  return {
    available: () => true,
    complete: async () => responseText,
    completeWithTools: async () => ({ text: null, toolUse: null }),
  }
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "draft-test",
    candidateCount: 128,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      toolType: "Milling",
    },
    turnCount: 2,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    ...overrides,
  } as ExplorationSessionState
}

describe("structured filter draft", () => {
  it("classifies a first-turn request as new and normalizes filters", async () => {
    const provider = createMockProvider(JSON.stringify({
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "toolSubtype", op: "eq", value: "Square", display: "형상: Square" },
        { field: "fluteCount", op: "eq", value: 4, display: "날수: 4날" },
      ],
    }))

    const result = await interpretStructuredFilterDraft({
      userMessage: "스퀘어 4날로 찾아줘",
      sessionState: null,
      provider,
    })

    expect(result.mode).toBe("new")
    expect(result.intent).toBe("narrow")
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0].field).toBe("toolSubtype")
    expect(result.filters[1].field).toBe("fluteCount")
    expect(result.needsClarification).toBe(false)
  })

  it("keeps follow-up narrowing in refine mode when session truth already exists", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "coating", op: "neq", value: "TiAlN", display: "코팅: TiAlN 제외" },
      ],
    }

    const result = buildStructuredFilterDraft({
      userMessage: "TiAlN 말고",
      sessionState: makeState({
        appliedFilters: [
          { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 },
        ],
        displayedCandidates: [{ rank: 1, productCode: "A", displayCode: "A", displayLabel: null, brand: null, seriesName: null, seriesIconUrl: null, diameterMm: null, fluteCount: null, coating: null, toolMaterial: null, shankDiameterMm: null, lengthOfCutMm: null, overallLengthMm: null, helixAngleDeg: null, description: null, featureText: null, materialTags: [], score: 0, scoreBreakdown: null, matchStatus: "exact", stockStatus: "", totalStock: null, inventorySnapshotDate: null, inventoryLocations: [], hasEvidence: false, bestCondition: null }],
      }),
      spec,
    })

    expect(result.mode).toBe("refine")
    expect(result.filters).toEqual([
      expect.objectContaining({ field: "coating", op: "neq", rawValue: "TiAlN" }),
    ])
    expect(result.needsClarification).toBe(false)
  })

  it("switches to repair mode and asks clarification for repair-only signals", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [],
    }

    const result = buildStructuredFilterDraft({
      userMessage: "그거 말고",
      sessionState: makeState({
        appliedFilters: [
          { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 },
          { field: "coating", op: "eq", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 },
        ],
      }),
      spec,
    })

    expect(result.mode).toBe("repair")
    expect(result.needsClarification).toBe(true)
    expect(result.clarificationQuestion).toContain("직접 입력")
    expect(result.clarificationQuestion).toContain("TiAlN")
  })

  it("rejects range operators on non-numeric fields", () => {
    const validation = validateStructuredFilterDraft(
      {
        mode: "refine",
        intent: "narrow",
        filters: [
          { field: "coating", op: "gte", value: "코팅: TiAlN 이상", rawValue: "TiAlN" },
        ],
      },
      {
        userMessage: "코팅 TiAlN 이상",
        sessionState: makeState(),
      },
    )

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toContain("range_op_requires_number:coating")
  })

  it("asks clarification when the request tries to cross tool-family domains inside an active session", () => {
    const spec: QuerySpec = {
      intent: "narrow",
      navigation: "none",
      constraints: [
        { field: "toolFamily", op: "eq", value: "Tap", display: "공구 타입: Tap" },
      ],
    }

    const result = buildStructuredFilterDraft({
      userMessage: "이번엔 탭으로 볼래",
      sessionState: makeState({
        appliedFilters: [
          { field: "toolType", op: "eq", value: "Milling", rawValue: "Milling", appliedAt: 1 },
        ],
      }),
      spec,
    })

    expect(result.mode).toBe("refine")
    expect(result.needsClarification).toBe(true)
    expect(result.clarificationQuestion).toContain("새 작업")
  })

  it("does not force clarification for pure side questions", () => {
    const spec: QuerySpec = {
      intent: "question",
      navigation: "none",
      constraints: [],
      questionText: "TiAlN이 뭐야?",
    }

    const result = buildStructuredFilterDraft({
      userMessage: "TiAlN이 뭐야?",
      sessionState: makeState(),
      spec,
    })

    expect(result.needsClarification).toBe(false)
    expect(result.intent).toBe("question")
    expect(result.confidence).toBeGreaterThan(0.5)
  })
})
