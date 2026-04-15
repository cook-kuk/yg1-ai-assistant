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

// LLM가 "explain" 판단을 내리는 mock — regex 제거 이후 지식질문 라우팅은 LLM 몫
function makeExplainProvider() {
  return {
    available: () => true,
    complete: vi.fn().mockResolvedValue(JSON.stringify({
      userState: "wants_explanation",
      confusedAbout: null,
      messageKind: "clarification_request",
      frameRelation: "detail_request",
      intentShift: "explain_request",
      domainRelevance: "product_query",
      intentAction: "explain",
      questionShape: "none",
      extractedAnswer: null,
      signalStrength: "moderate",
      isQuotedText: false,
    })),
    completeWithTools: vi.fn(),
  } as any
}

describe("classifyPreSearchRoute", () => {
  it("routes first-turn taxonomy explanation questions to general_knowledge before search", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      null,
      unavailableProvider,
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("taxonomy_knowledge")
  })

  it("routes taxonomy explanation questions to general_knowledge before search", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      makeState(),
      unavailableProvider,
    )

    expect(result?.kind).toBe("general_knowledge")
    expect(result?.reason).toContain("taxonomy_knowledge")
  })

  it("routes explicit product info questions to direct_lookup", async () => {
    const result = await classifyPreSearchRoute(
      "GYG02100 스펙 알려줘",
      makeState(),
      unavailableProvider,
    )

    expect(result?.kind).toBe("direct_lookup")
    expect(result?.reason).toContain("query_target:product_info")
  })

  it("routes explicit product comparison questions to direct_lookup", async () => {
    const result = await classifyPreSearchRoute(
      "E5E84200B 와 E5E84200 비교 설명",
      makeState(),
      unavailableProvider,
    )

    expect(result?.kind).toBe("direct_lookup")
    expect(result?.reason).toContain("query_target:product_comparison")
  })

  it("passes through recommendation/narrowing messages (returns null)", async () => {
    // recommendation_action 분기 제거 이후: 추천/필터 의도로 보이는 메시지는
    // pre-search 가 판단하지 않고 downstream unified judgment + filter resolver 로 넘긴다.
    const result = await classifyPreSearchRoute(
      "알루미늄으로 해줘",
      makeState({
        displayedChips: ["알루미늄", "스테인리스", "상관없음"],
        lastAskedField: "material",
      }),
      unavailableProvider,
    )

    expect(result).toBeNull()
  })

  it("passes through natural-tone message with filter hints (no regex override)", async () => {
    // pre-search 는 "이건 추천이다" 를 강제하지 않음 — LLM 판단 존중.
    // direct_lookup 이 아니면 null 반환하여 downstream resolver 로 넘김.
    const result = await classifyPreSearchRoute(
      "10mm 4날 쓸건데 괜찮은 거 있을까",
      makeState({ turnCount: 0, currentMode: "intake", lastAskedField: undefined }),
      unavailableProvider,
    )

    // direct_lookup 가능 또는 null (pass-through).
    expect(result === null || result.kind === "direct_lookup").toBe(true)
  })

  it("preserves pure knowledge question even with filter hint (LLM says explain)", async () => {
    const result = await classifyPreSearchRoute(
      "스테인리스가 뭐야?",
      makeState({ turnCount: 0, currentMode: "intake", lastAskedField: undefined }),
      makeExplainProvider(),
    )

    expect(result?.kind).toBe("general_knowledge")
  })
})
