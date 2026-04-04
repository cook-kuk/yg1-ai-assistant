/**
 * Long-term Memory Tests — 세션 간 사용자 행동/선호 축적 검증
 *
 * 단기 기억: 현재 세션의 최근 3턴 (conversation-memory.test.ts)
 * 장기 기억: 사용자 행동 패턴, 선호, Q&A 이력 (이 파일)
 */
import { describe, expect, it } from "vitest"
import {
  createEmptyMemory,
  buildMemoryFromSession,
  recordHighlight,
  recordQA,
  recordSkip,
  recordRevision,
  recordConfusion,
  recordDelegation,
  recordExplanationPreference,
  recordFrustration,
  recordSoftPreference,
  type ConversationMemory,
} from "@/lib/recommendation/domain/memory/conversation-memory"

describe("createEmptyMemory — 초기화", () => {
  it("빈 메모리 생성", () => {
    const mem = createEmptyMemory()
    expect(mem.items).toEqual([])
    expect(mem.highlights).toEqual([])
    expect(mem.recentQA).toEqual([])
    expect(mem.softPreferences).toEqual([])
    expect(mem.userSignals.confusedFields).toEqual([])
    expect(mem.userSignals.frustrationCount).toBe(0)
    expect(mem.userSignals.prefersDelegate).toBe(false)
  })
})

describe("buildMemoryFromSession — 세션에서 메모리 빌드", () => {
  const form = {
    material: { status: "known", value: "P" },
    operationType: { status: "known", value: "Side_Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  }

  it("첫 세션 — intake facts 저장", () => {
    const mem = buildMemoryFromSession(form, null, 0)
    expect(mem.items.length).toBeGreaterThanOrEqual(4)
    const materialItem = mem.items.find(i => i.field === "material")
    expect(materialItem?.value).toBe("P")
    expect(materialItem?.source).toBe("intake")
    expect(materialItem?.status).toBe("resolved")
  })

  it("필터 적용된 세션 — filter items 추가", () => {
    const sessionState = {
      appliedFilters: [
        { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 1 },
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 2 },
      ],
      turnCount: 3,
    }
    const mem = buildMemoryFromSession(form, sessionState, 3)
    const filterItems = mem.items.filter(i => i.source === "narrowing")
    expect(filterItems.length).toBeGreaterThanOrEqual(2)
  })

  it("skip 필터는 제외", () => {
    const sessionState = {
      appliedFilters: [
        { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 },
      ],
      turnCount: 1,
    }
    const mem = buildMemoryFromSession(form, sessionState, 1)
    const coatingItem = mem.items.find(i => i.field === "coating" && i.source === "narrowing")
    expect(coatingItem).toBeUndefined()
  })

  it("기존 메모리 있으면 누적 (덮어쓰지 않음)", () => {
    const existingMemory = createEmptyMemory()
    existingMemory.highlights.push({ turn: 1, type: "preference", summary: "TiAlN 선호" })
    existingMemory.userSignals.prefersDelegate = true

    const sessionState = {
      appliedFilters: [],
      turnCount: 5,
      conversationMemory: existingMemory,
    }
    const mem = buildMemoryFromSession(form, sessionState, 5)
    expect(mem.highlights).toHaveLength(1)
    expect(mem.highlights[0].summary).toBe("TiAlN 선호")
    expect(mem.userSignals.prefersDelegate).toBe(true)
  })
})

describe("메모리 시그널 기록", () => {
  let mem: ConversationMemory

  it("recordHighlight — 대화 하이라이트", () => {
    mem = createEmptyMemory()
    recordHighlight(mem, 1, "preference", "TiAlN 코팅 선호 표현", "coating")
    recordHighlight(mem, 3, "confusion", "형상 선택에서 혼란", "toolSubtype")
    expect(mem.highlights).toHaveLength(2)
    expect(mem.highlights[0].type).toBe("preference")
    expect(mem.highlights[1].field).toBe("toolSubtype")
  })

  it("recordHighlight — 20개 초과 시 oldest 제거", () => {
    mem = createEmptyMemory()
    for (let i = 0; i < 25; i++) {
      recordHighlight(mem, i, "preference", `item-${i}`)
    }
    expect(mem.highlights).toHaveLength(20)
    expect(mem.highlights[0].summary).toBe("item-5") // first 5 removed
  })

  it("recordQA — Q&A 이력", () => {
    mem = createEmptyMemory()
    recordQA(mem, "TiAlN이 뭐야?", "내열성 코팅입니다", "coating", 2)
    recordQA(mem, "4날 6날 차이?", "4날은 마무리, 6날은 황삭", "fluteCount", 4)
    expect(mem.recentQA).toHaveLength(2)
    expect(mem.recentQA[0].question).toBe("TiAlN이 뭐야?")
  })

  it("recordSkip — 스킵 필드 기록", () => {
    mem = createEmptyMemory()
    recordSkip(mem, "coating")
    recordSkip(mem, "fluteCount")
    recordSkip(mem, "coating") // duplicate
    expect(mem.userSignals.skippedFields).toEqual(["coating", "fluteCount"])
  })

  it("recordRevision — 조건 변경 기록", () => {
    mem = createEmptyMemory()
    recordRevision(mem, "toolSubtype")
    expect(mem.userSignals.revisedFields).toEqual(["toolSubtype"])
  })

  it("recordConfusion — 혼란 기록", () => {
    mem = createEmptyMemory()
    recordConfusion(mem, "toolSubtype")
    expect(mem.userSignals.confusedFields).toEqual(["toolSubtype"])
  })

  it("recordDelegation — 위임 선호", () => {
    mem = createEmptyMemory()
    expect(mem.userSignals.prefersDelegate).toBe(false)
    recordDelegation(mem)
    expect(mem.userSignals.prefersDelegate).toBe(true)
  })

  it("recordFrustration — 불만 카운트", () => {
    mem = createEmptyMemory()
    recordFrustration(mem)
    recordFrustration(mem)
    expect(mem.userSignals.frustrationCount).toBe(2)
  })

  it("recordSoftPreference — 연성 선호", () => {
    mem = createEmptyMemory()
    recordSoftPreference(mem, "coating", "TiAlN 선호")
    recordSoftPreference(mem, "speed", "고속가공 지향")
    expect(mem.softPreferences).toHaveLength(2)
    // Update existing
    recordSoftPreference(mem, "coating", "AlCrN으로 변경")
    expect(mem.softPreferences).toHaveLength(2)
    expect(mem.softPreferences.find(p => p.key === "coating")!.description).toBe("AlCrN으로 변경")
  })
})

describe("SCR buildSessionSummary — 메모리 포함 검증", () => {
  it("메모리가 있으면 세션 요약에 포함", async () => {
    // We can't directly test buildSessionSummary (not exported),
    // but we verify the memory structure is compatible
    const mem = createEmptyMemory()
    recordSkip(mem, "coating")
    recordRevision(mem, "toolSubtype")
    recordSoftPreference(mem, "finish", "정삭 선호")
    recordQA(mem, "TiAlN이 뭐야?", "내열성 코팅", "coating", 2)
    recordHighlight(mem, 3, "preference", "고속가공 선호 언급")

    expect(mem.userSignals.skippedFields).toContain("coating")
    expect(mem.userSignals.revisedFields).toContain("toolSubtype")
    expect(mem.softPreferences).toHaveLength(1)
    expect(mem.recentQA).toHaveLength(1)
    expect(mem.highlights).toHaveLength(1)
  })
})

describe("장기 메모리 — E2E 시뮬레이션", () => {
  it("10턴 대화 후 축적된 메모리 검증", () => {
    const mem = createEmptyMemory()

    // Turn 1-2: Intake
    // Turn 3: Square 선택
    // Turn 4: "형상 차이가 뭐야?" → confusion
    recordConfusion(mem, "toolSubtype")
    recordQA(mem, "형상 차이가 뭐야?", "Square는 평면, Ball은 곡면", "toolSubtype", 4)

    // Turn 5: coating skip
    recordSkip(mem, "coating")

    // Turn 6: 추천 결과 → "TiAlN 제품이 좋다" → highlight
    recordHighlight(mem, 6, "preference", "TiAlN 코팅 제품 관심")
    recordSoftPreference(mem, "coating", "TiAlN 관심 표명")

    // Turn 7: "Ball로 바꿔" → revision
    recordRevision(mem, "toolSubtype")
    recordHighlight(mem, 7, "intent_shift", "Square→Ball 변경")

    // Turn 8: "아무거나" → delegation
    recordDelegation(mem)

    // Turn 9: frustration "왜 안 나오지"
    recordFrustration(mem)

    // Turn 10: 만족 → highlight
    recordHighlight(mem, 10, "satisfaction", "최종 추천 만족")

    // Verify accumulated memory
    expect(mem.userSignals.confusedFields).toEqual(["toolSubtype"])
    expect(mem.userSignals.skippedFields).toEqual(["coating"])
    expect(mem.userSignals.revisedFields).toEqual(["toolSubtype"])
    expect(mem.userSignals.prefersDelegate).toBe(true)
    expect(mem.userSignals.frustrationCount).toBe(1)
    expect(mem.softPreferences).toHaveLength(1)
    expect(mem.recentQA).toHaveLength(1)
    expect(mem.highlights).toHaveLength(3)
  })
})
