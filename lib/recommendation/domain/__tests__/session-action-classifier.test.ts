import { describe, it, expect } from "vitest"
import {
  classifySessionAction,
  detectFilterIntent,
  isInSessionFollowUp,
  detectTargetScope,
} from "../session-action-classifier"

// ── Helper to build filters ──
function filters(...pairs: [string, string][]): { field: string; value: string; op: string }[] {
  return pairs.map(([field, value]) => ({ field, value, op: "eq" }))
}

describe("detectFilterIntent", () => {
  it("detects replace when same field already filtered — '4날로 바꿔줘'", () => {
    const result = detectFilterIntent("4날로 바꿔줘", filters(["fluteCount", "2"]))
    expect(result.mode).toBe("replace")
    expect(result.field).toBe("fluteCount")
    expect(result.value).toBe("4")
  })

  it("detects replace when toolSubtype changes — '볼 말고 스퀘어'", () => {
    const result = detectFilterIntent("볼 말고 스퀘어", filters(["toolSubtype", "Ball"]))
    expect(result.mode).toBe("replace")
    expect(result.field).toBe("toolSubtype")
    expect(result.value).toBe("스퀘어")
  })

  it("detects remove — '코팅 필터 빼줘'", () => {
    const result = detectFilterIntent("코팅 필터 빼줘", filters(["coating", "AlTiN"]))
    expect(result.mode).toBe("remove")
    expect(result.field).toBe("coating")
  })

  it("detects add when field not yet filtered — '직경 10 이상만'", () => {
    const result = detectFilterIntent("직경 10 이상만", [])
    expect(result.mode).toBe("add")
    expect(result.field).toBe("diameterMm")
    expect(result.value).toBe("10")
  })

  it("detects implicit replace — existing flute=2, user says '4날'", () => {
    const result = detectFilterIntent("4날", filters(["fluteCount", "2"]))
    expect(result.mode).toBe("replace")
    expect(result.field).toBe("fluteCount")
    expect(result.value).toBe("4")
  })

  it("does not detect filter for unrelated message", () => {
    const result = detectFilterIntent("오늘 날씨 어때", [])
    expect(result.mode).toBe("none")
  })

  it("detects replace for material change — '알루미늄 말고 스테인리스'", () => {
    const result = detectFilterIntent("소재 스테인리스로 바꿔줘", filters(["material", "알루미늄"]))
    expect(result.mode).toBe("replace")
    expect(result.field).toBe("material")
  })

  it("contradictory filters are replaced, not stacked", () => {
    const result = detectFilterIntent("코팅 DLC로", filters(["coating", "AlTiN"]))
    expect(result.mode).toBe("replace")
    expect(result.field).toBe("coating")
  })
})

describe("isInSessionFollowUp", () => {
  it.each([
    "이 중에 재고 되는 거",
    "이거 절삭조건은?",
    "왜 이걸 추천했어?",
    "지금 필터 뭐 걸려 있어?",
    "아까 거 다시",
    "현재 재고 상태",
  ])("returns true for in-session message: '%s'", (msg) => {
    expect(isInSessionFollowUp(msg)).toBe(true)
  })

  it.each([
    "오늘 날씨 어때",
    "점심 뭐 먹을까",
    "뉴스 알려줘",
  ])("returns false for off-topic message: '%s'", (msg) => {
    expect(isInSessionFollowUp(msg)).toBe(false)
  })
})

describe("detectTargetScope", () => {
  it("detects displayed scope", () => {
    expect(detectTargetScope("이 중에 재고 되는 거")).toBe("displayed")
    expect(detectTargetScope("지금 보이는 것 중에")).toBe("displayed")
  })

  it("detects broader pool scope", () => {
    expect(detectTargetScope("전체에서 재고 많은 걸로")).toBe("broader_pool")
    expect(detectTargetScope("이것 말고 다른 거")).toBe("broader_pool")
  })

  it("defaults to session scope", () => {
    expect(detectTargetScope("코팅 뭐가 있어?")).toBe("session")
  })
})

describe("classifySessionAction", () => {
  it("classifies filter replacement — existing flute=2, '4날로 바꿔줘'", () => {
    const result = classifySessionAction(
      "4날로 바꿔줘",
      filters(["fluteCount", "2"]),
      true, false, null
    )
    expect(result.action).toBe("replace_filter")
    expect(result.targetField).toBe("fluteCount")
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it("classifies filter removal — '코팅 필터 빼줘'", () => {
    const result = classifySessionAction(
      "코팅 필터 빼줘",
      filters(["coating", "AlTiN"]),
      true, false, null
    )
    expect(result.action).toBe("remove_filter")
    expect(result.targetField).toBe("coating")
  })

  it("classifies in-session follow-up, not START_NEW_TOPIC — '이 중에 재고 되는 거'", () => {
    const result = classifySessionAction(
      "이 중에 재고 되는 거",
      filters(["fluteCount", "4"]),
      true, false, null
    )
    expect(result.action).not.toBe("out_of_session")
    expect(["query_current_results", "ask_in_context"]).toContain(result.action)
  })

  it("classifies broader pool query — '전체에서 재고 많은 걸로'", () => {
    const result = classifySessionAction(
      "전체에서 재고 많은 걸로 다시 보여줘",
      filters(["material", "탄소강"]),
      true, false, null
    )
    expect(result.action).toBe("ask_broader_pool")
  })

  it("classifies state summary — '지금 필터 뭐 걸려 있어?'", () => {
    const result = classifySessionAction(
      "지금 필터 뭐 걸려 있어?",
      filters(["fluteCount", "4"]),
      true, false, null
    )
    expect(result.action).toBe("summarize_state")
  })

  it("no displayedOptions but parses filter — '직경 10 이상만'", () => {
    const result = classifySessionAction(
      "직경 10 이상만",
      [], // no existing filters
      false, false, null
    )
    expect(result.action).toBe("add_filter")
    expect(result.targetField).toBe("diameterMm")
  })

  it("treats pending question answer as continue_narrowing", () => {
    const result = classifySessionAction(
      "AlTiN",
      filters(["fluteCount", "4"]),
      false, true, "coating"
    )
    expect(result.action).toBe("continue_narrowing")
    expect(result.targetField).toBe("coating")
  })

  it("prefers safe clarification over new topic when uncertain", () => {
    const result = classifySessionAction(
      "음... 그거",
      filters(["fluteCount", "4"]),
      true, true, "coating"
    )
    // Should stay in session, not go to out_of_session
    expect(result.action).not.toBe("out_of_session")
  })

  it("detects reset — '처음부터 다시'", () => {
    const result = classifySessionAction(
      "처음부터 다시",
      filters(["fluteCount", "4"], ["material", "탄소강"]),
      true, false, null
    )
    expect(result.action).toBe("reset_filters")
  })

  it("does not lose context after narrowing — '아까 거 다시'", () => {
    const result = classifySessionAction(
      "아까 거 다시",
      filters(["fluteCount", "4"]),
      true, false, null
    )
    expect(result.action).not.toBe("out_of_session")
    expect(["query_current_results", "ask_in_context"]).toContain(result.action)
  })
})
