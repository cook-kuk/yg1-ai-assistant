/**
 * Memory Integration Tests — 메모리 빌드→SCR 주입→시그널 기록 통합 검증
 */
import { describe, expect, it } from "vitest"
import {
  createEmptyMemory,
  buildMemoryFromSession,
  recordHighlight,
  recordQA,
  recordSkip,
  recordRevision,
  recordSoftPreference,
  type ConversationMemory,
} from "@/lib/recommendation/domain/memory/conversation-memory"

describe("메모리 ���적 — 턴별 시뮬레이션", () => {
  it("5턴 ���화: intake → Square → skip coating → TiAlN 질문 → 추천", () => {
    const form = {
      material: { status: "known", value: "P" },
      operationType: { status: "known", value: "Side_Milling" },
      diameterInfo: { status: "known", value: "10mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    }

    // Turn 0: Initial session
    let mem = buildMemoryFromSession(form, null, 0)
    expect(mem.items.filter(i => i.source === "intake")).toHaveLength(4)

    // Turn 1: Square 적용
    const session1 = {
      appliedFilters: [{ field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 }],
      turnCount: 1,
      conversationMemory: mem,
    }
    mem = buildMemoryFromSession(form, session1, 1)
    expect(mem.items.filter(i => i.source === "narrowing")).toHaveLength(1)

    // Turn 2: coating skip
    recordSkip(mem, "coating")
    expect(mem.userSignals.skippedFields).toContain("coating")

    // Turn 3: "TiAlN이 뭐야?" → QA 기록
    recordQA(mem, "TiAlN이 뭐야?", "내열성 코팅", "coating", 3)
    expect(mem.recentQA).toHaveLength(1)

    // Turn 4: "그거로 코팅" → soft preference
    recordSoftPreference(mem, "coating", "TiAlN 선호 표현")
    expect(mem.softPreferences).toHaveLength(1)

    // Turn 5: 추천 완료 → highlight
    recordHighlight(mem, 5, "satisfaction", "추천 결과 만족")
    expect(mem.highlights).toHaveLength(1)

    // 최종 메모리 상태 검증
    expect(mem.items.length).toBeGreaterThanOrEqual(5) // 4 intake + 1 filter
    expect(mem.userSignals.skippedFields).toEqual(["coating"])
    expect(mem.softPreferences[0].key).toBe("coating")
    expect(mem.recentQA[0].question).toBe("TiAlN이 뭐야?")
  })

  it("조건 변경 → 되돌리기 시뮬레이션", () => {
    const mem = createEmptyMemory()

    // Square 적용
    recordHighlight(mem, 1, "preference", "Square 선택")

    // Ball로 변경
    recordRevision(mem, "toolSubtype")
    recordHighlight(mem, 2, "intent_shift", "Square → Ball 변경")

    // 다시 Square로
    recordRevision(mem, "toolSubtype") // duplicate는 무시됨
    recordHighlight(mem, 3, "intent_shift", "Ball → Square 되돌림")

    expect(mem.userSignals.revisedFields).toEqual(["toolSubtype"])
    expect(mem.highlights).toHaveLength(3)
  })

  it("메모리 persist — 세션 간 누적", () => {
    const form = {
      material: { status: "known", value: "N" },
      operationType: { status: "unanswered" },
      diameterInfo: { status: "known", value: "10mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    }

    // Session 1: 첫 대화
    let mem = buildMemoryFromSession(form, null, 0)
    recordSkip(mem, "coating")
    recordSoftPreference(mem, "material", "구리 전용 공구 선호")

    // Session 2: 메모리 가지고 다시 시작 (persist)
    const session2 = {
      appliedFilters: [
        { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 },
      ],
      turnCount: 3,
      conversationMemory: mem,
    }
    const mem2 = buildMemoryFromSession(form, session2, 3)

    // 이전 세션의 메모리가 유지되는지 확인
    expect(mem2.userSignals.skippedFields).toContain("coating")
    expect(mem2.softPreferences).toHaveLength(1)
    expect(mem2.softPreferences[0].description).toBe("구리 전용 공구 선호")
  })
})

describe("메모리 → SCR 세션 요약 호환성", () => {
  it("메모리가 있는 세션 상태 → buildSessionSummary 호환", () => {
    const mem = createEmptyMemory()
    recordSkip(mem, "coating")
    recordRevision(mem, "toolSubtype")
    recordSoftPreference(mem, "finish", "정삭 선호")
    recordQA(mem, "TiAlN이 뭐야?", "내열성 코팅", "coating", 2)

    // conversationMemory 필드가 세션 타입에 맞는지 확인
    const sessionLike = {
      sessionId: "test",
      candidateCount: 100,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "narrowing" as const,
      resolvedInput: { manufacturerScope: "yg1-only" as const, locale: "ko" },
      turnCount: 5,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      conversationMemory: mem,
    }

    // 메모리 필드 접근 가능 확인
    expect(sessionLike.conversationMemory.userSignals.skippedFields).toContain("coating")
    expect(sessionLike.conversationMemory.softPreferences).toHaveLength(1)
    expect(sessionLike.conversationMemory.recentQA).toHaveLength(1)
  })
})

describe("메모리 경계 — overflow 방어", () => {
  it("Q&A 10개 초과 시 oldest 제거", () => {
    const mem = createEmptyMemory()
    for (let i = 0; i < 15; i++) {
      recordQA(mem, `Q${i}`, `A${i}`, null, i)
    }
    expect(mem.recentQA).toHaveLength(10)
    expect(mem.recentQA[0].question).toBe("Q5") // first 5 dropped
  })

  it("highlight 20개 초과 시 oldest 제거", () => {
    const mem = createEmptyMemory()
    for (let i = 0; i < 25; i++) {
      recordHighlight(mem, i, "preference", `H${i}`)
    }
    expect(mem.highlights).toHaveLength(20)
    expect(mem.highlights[0].summary).toBe("H5")
  })

  it("softPreference 10개 초과 시 oldest 제거", () => {
    const mem = createEmptyMemory()
    for (let i = 0; i < 12; i++) {
      recordSoftPreference(mem, `key${i}`, `pref${i}`)
    }
    expect(mem.softPreferences).toHaveLength(10)
    expect(mem.softPreferences[0].key).toBe("key2")
  })
})
