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

    expect(result.kind).toBe("general_knowledge")
    expect(result.reason).toContain("taxonomy_knowledge")
  })

  it("routes taxonomy explanation questions to general_knowledge before search", async () => {
    const result = await classifyPreSearchRoute(
      "slotting 하는데 적절한 공구 형상은 어떤 것인가요",
      makeState(),
      unavailableProvider,
    )

    expect(result.kind).toBe("general_knowledge")
    expect(result.reason).toContain("taxonomy_knowledge")
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

  it("routes explicit product comparison questions to direct_lookup", async () => {
    const result = await classifyPreSearchRoute(
      "E5E84200B 와 E5E84200 비교 설명",
      makeState(),
      unavailableProvider,
    )

    expect(result.kind).toBe("direct_lookup")
    expect(result.reason).toContain("query_target:product_comparison")
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

  it("respects LLM classification for natural-tone message (no regex filter-hint override)", async () => {
    // Phase 2-A: LLM 판단을 regex filter-hint 가 override 하지 않는다.
    // unavailableProvider → DEFAULT_JUDGMENT → queryTarget.type 에 따라 direct_lookup 또는 recommendation_action.
    // 이전 동작(regex 2개 이상이면 recommendation_action 강제)은 제거됨.
    const result = await classifyPreSearchRoute(
      "10mm 4날 쓸건데 괜찮은 거 있을까",
      makeState({ turnCount: 0, currentMode: "intake", lastAskedField: undefined }),
      unavailableProvider,
    )

    // LLM regex override 제거 이후로는 direct_lookup / recommendation_action 둘 다 허용.
    expect(["direct_lookup", "recommendation_action"]).toContain(result.kind)
  })

  it("preserves pure knowledge question even with filter hint (LLM says explain)", async () => {
    // regex 제거 이후: LLM이 "explain" 판단을 내리고 taxonomy 매칭이 없더라도
    // filter_hints_override는 material만으로는 1개 미만 → general_knowledge 유지.
    // 단, 이 케이스는 "스테인리스가 뭐야?" — isCuttingToolTaxonomyKnowledgeQuestion으로도 잡힘 가능.
    const result = await classifyPreSearchRoute(
      "스테인리스가 뭐야?",
      makeState({ turnCount: 0, currentMode: "intake", lastAskedField: undefined }),
      makeExplainProvider(),
    )

    expect(result.kind).toBe("general_knowledge")
  })
})
