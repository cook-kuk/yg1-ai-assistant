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

function makeJudgmentProvider(overrides: Record<string, unknown> = {}) {
  const base = {
    userState: "clear",
    confusedAbout: null,
    messageKind: "direct_command",
    frameRelation: "direct_answer",
    intentShift: "none",
    domainRelevance: "product_query",
    intentAction: "explain",
    questionShape: "none",
    extractedAnswer: null,
    signalStrength: "moderate",
    isQuotedText: false,
    ...overrides,
  }
  return {
    available: () => true,
    complete: vi.fn().mockResolvedValue(JSON.stringify(base)),
    completeWithTools: vi.fn(),
  } as any
}

describe("classifyPreSearchRoute", () => {
  it("routes explain intent on product_query to general_knowledge", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      null,
      makeJudgmentProvider({ intentAction: "explain", domainRelevance: "product_query", userState: "wants_explanation" }),
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("product_query/explain")
  })

  it("routes compare intent on product_query to general_knowledge", async () => {
    const result = await classifyPreSearchRoute(
      "E5E84200B 와 E5E84200 비교 설명",
      makeState(),
      makeJudgmentProvider({ intentAction: "compare", domainRelevance: "product_query" }),
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("product_query/compare")
  })

  it("routes greeting to general_knowledge", async () => {
    const result = await classifyPreSearchRoute(
      "안녕",
      makeState(),
      makeJudgmentProvider({ intentAction: "continue", domainRelevance: "greeting" }),
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("greeting")
  })

  it("routes company_query to general_knowledge", async () => {
    const result = await classifyPreSearchRoute(
      "YG-1 본사 어디야?",
      makeState(),
      makeJudgmentProvider({ intentAction: "explain", domainRelevance: "company_query" }),
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("company_query")
  })

  it("routes off_topic to general_knowledge", async () => {
    const result = await classifyPreSearchRoute(
      "오늘 날씨 어때",
      makeState(),
      makeJudgmentProvider({ intentAction: "off_topic", domainRelevance: "off_topic" }),
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("off_topic")
  })

  it("passes through recommendation/narrowing messages (returns null)", async () => {
    // 추천/필터 의도로 보이는 메시지는 pre-search 가 판단하지 않고
    // downstream unified judgment + filter resolver 로 넘긴다.
    const result = await classifyPreSearchRoute(
      "알루미늄으로 해줘",
      makeState({
        displayedChips: ["알루미늄", "스테인리스", "상관없음"],
        lastAskedField: "material",
      }),
      makeJudgmentProvider({ intentAction: "ask_recommendation", domainRelevance: "product_query" }),
    )

    expect(result).toBeNull()
  })

  it("passes through select_option on product_query (no knowledge intent → null)", async () => {
    const result = await classifyPreSearchRoute(
      "10mm 4날 쓸건데 괜찮은 거 있을까",
      makeState({ turnCount: 0, currentMode: "intake", lastAskedField: undefined }),
      makeJudgmentProvider({ intentAction: "select_option", domainRelevance: "product_query" }),
    )

    expect(result).toBeNull()
  })

  it("returns null when LLM provider unavailable (DEFAULT_JUDGMENT → narrowing)", async () => {
    // provider.available()=false → DEFAULT_JUDGMENT (intentAction=continue, domainRelevance=narrowing_response)
    // → 정보 조회 조건 전부 false → pass-through.
    const result = await classifyPreSearchRoute(
      "알루미늄으로 해줘",
      makeState(),
      unavailableProvider,
    )

    expect(result).toBeNull()
  })
})
