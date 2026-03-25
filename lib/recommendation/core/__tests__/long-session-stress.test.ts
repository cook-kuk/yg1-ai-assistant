import { describe, it, expect } from "vitest"
import { orchestrateTurnV2, createInitialSessionState } from "../turn-orchestrator"
import { convertToV2State, convertFromV2State } from "../state-adapter"

const stub = { available: () => false, complete: async () => "" } as any

describe("Long Session Stress Test (30 turns)", () => {
  it("handles 30 consecutive turns without crash or memory growth", async () => {
    let state = createInitialSessionState()
    const inputs = [
      "알루미늄 10mm side milling",   // 1: intake
      "비철금속",                      // 2: narrowing
      "Radius",                       // 3: narrowing
      "3날",                          // 4: narrowing
      "추천해줘",                      // 5: show recommendation
      "왜 이 제품?",                   // 6: explain
      "재고 확인",                     // 7: post-result
      "사우디 지점 알려줘",             // 8: side question
      "추천 이어가기",                  // 9: resume
      "1번이랑 2번 비교",              // 10: compare
      "절삭조건 알려줘",               // 11: cutting condition
      "다른 직경으로",                  // 12: refine
      "이전으로",                      // 13: back
      "코팅 차이 뭐야?",              // 14: explain
      "DLC 코팅으로",                  // 15: filter
      "재고 있는 것만",                // 16: stock filter
      "처음부터 다시",                  // 17: reset
      "탄소강 8mm 추천",               // 18: new intake
      "일반강",                        // 19: narrowing
      "Square",                       // 20: narrowing
      "4날",                          // 21: narrowing
      "추천해줘",                      // 22: recommendation
      "이 제품 스펙 알려줘",            // 23: product info
      "GMG31 시리즈 정보",             // 24: series lookup
      "GMG30이랑 비교",                // 25: compare
      "본사 전화번호",                  // 26: side question
      "더 좋은 거 없어?",              // 27: refine
      "이걸로 할게",                   // 28: confirm
      "감사합니다",                    // 29: closing
      "ㅇㅇ",                         // 30: informal
    ]

    const turnCounts: number[] = []
    const revisionNodeCounts: number[] = []

    for (let i = 0; i < inputs.length; i++) {
      const result = await orchestrateTurnV2(inputs[i], state, stub)

      // Basic invariants
      expect(result.sessionState.turnCount).toBe(i + 1)
      expect(result.answer).toBeDefined()
      expect(typeof result.answer).toBe("string")

      turnCounts.push(result.sessionState.turnCount)
      revisionNodeCounts.push(result.sessionState.revisionNodes.length)
      state = result.sessionState
    }

    // turnCount should be monotonically increasing
    for (let i = 1; i < turnCounts.length; i++) {
      expect(turnCounts[i]).toBe(turnCounts[i-1] + 1)
    }

    // Revision nodes should not grow unboundedly (max ~30)
    expect(state.revisionNodes.length).toBeLessThanOrEqual(30)

    // Final state should be valid
    expect(state.turnCount).toBe(30)
  })
})

describe("State Adapter Deep Consistency", () => {
  it("round-trip preserves all filter fields", () => {
    const filters = [
      { field: "material", op: "eq", value: "Aluminum", rawValue: "Aluminum", appliedAt: 1 },
      { field: "diameterMm", op: "eq", value: "10", rawValue: 10, appliedAt: 2 },
      { field: "fluteCount", op: "eq", value: "3", rawValue: "3", appliedAt: 3 },
      { field: "coating", op: "eq", value: "DLC", rawValue: "DLC", appliedAt: 4 },
      { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 5 },
    ]

    const legacy = {
      sessionId: "test",
      candidateCount: 50,
      appliedFilters: filters,
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 5,
      currentMode: "question",
      displayedProducts: [],
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
    } as any

    const v2 = convertToV2State(legacy)
    const roundTrip = convertFromV2State(v2, legacy)

    // Every original filter field should still be present
    for (const filter of filters) {
      const found = roundTrip.appliedFilters.some(f =>
        f.field === filter.field && String(f.value) === String(filter.value)
      )
      expect(found).toBe(true)
    }
  })

  it("null legacy state produces clean initial V2 state", () => {
    const v2 = convertToV2State(null)
    expect(v2.journeyPhase).toBe("intake")
    expect(v2.turnCount).toBe(0)
    expect(v2.constraints.base).toEqual({})
    expect(v2.constraints.refinements).toEqual({})
    expect(v2.resultContext).toBeNull()
    expect(v2.pendingQuestion).toBeNull()
    expect(v2.sideThreadActive).toBe(false)
  })

  it("V2 state with results maps to recommendation mode", () => {
    const legacy = {
      sessionId: "test",
      candidateCount: 10,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_exact",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 5,
      currentMode: "recommendation",
      displayedProducts: [],
      displayedCandidates: [
        { rank: 1, productCode: "TEST001", displayCode: "TEST001", score: 90, seriesName: "TEST" }
      ],
      displayedChips: [],
      displayedOptions: [],
    } as any

    const v2 = convertToV2State(legacy)
    expect(v2.journeyPhase).toBe("results_displayed")
    expect(v2.resultContext).not.toBeNull()
    expect(v2.resultContext!.candidates.length).toBe(1)
  })

  it("suspended flow maps to sideThreadActive", () => {
    const legacy = {
      sessionId: "test",
      candidateCount: 0,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "broad",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 3,
      currentMode: "question",
      displayedProducts: [],
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      suspendedFlow: { pendingField: "coating", pendingQuestion: "코팅을 선택하세요" },
    } as any

    const v2 = convertToV2State(legacy)
    expect(v2.sideThreadActive).toBe(true)
  })
})
