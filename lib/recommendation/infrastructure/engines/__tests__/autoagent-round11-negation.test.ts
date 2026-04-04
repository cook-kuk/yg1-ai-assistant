/**
 * Round 11 — 부정/제외, 조건 변경, skip, show_recommendation 시나리오 (25개)
 *
 * SCR의 validateAndCleanResult + 실제 action type 검증
 */
import { describe, expect, it } from "vitest"
import {
  validateAndCleanResult,
  extractJsonFromResponse,
  validateAction,
} from "@/lib/recommendation/core/single-call-router"
import {
  buildAppliedFilterFromValue,
  applyFilterToRecommendationInput,
} from "@/lib/recommendation/shared/filter-field-registry"
import type { RecommendationInput } from "@/lib/recommendation/domain/types"

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput
}

describe("부정/제외 action 검증", () => {
  it("remove_filter는 field만 필요", () => {
    const action = { type: "remove_filter", field: "toolSubtype" }
    expect(validateAction(action)).toBe(true)
  })

  it("apply_filter with neq op 유효", () => {
    const action = { type: "apply_filter", field: "toolSubtype", value: "Ball", op: "neq" }
    expect(validateAction(action)).toBe(true)
  })

  it("remove_filter field 없으면 유효하지만 런타임에서 스킵", () => {
    const action = { type: "remove_filter" }
    expect(validateAction(action)).toBe(true) // type만 있으면 valid
  })
})

describe("조건 변경 (replace_filter) 검증", () => {
  it("replace_filter는 field, from, to 필요", () => {
    const action = { type: "replace_filter", field: "toolSubtype", from: "Square", to: "Ball" }
    expect(validateAction(action)).toBe(true)
  })

  it("replace_filter fluteCount 숫자", () => {
    const action = { type: "replace_filter", field: "fluteCount", from: "4", to: 6 }
    expect(validateAction(action)).toBe(true)
  })
})

describe("skip / reset / go_back 검증", () => {
  it("skip action 유효", () => {
    expect(validateAction({ type: "skip" })).toBe(true)
    expect(validateAction({ type: "skip", field: "coating" })).toBe(true)
  })

  it("reset action 유효", () => {
    expect(validateAction({ type: "reset" })).toBe(true)
  })

  it("go_back action 유효", () => {
    expect(validateAction({ type: "go_back" })).toBe(true)
  })

  it("show_recommendation action 유효", () => {
    expect(validateAction({ type: "show_recommendation" })).toBe(true)
  })
})

describe("compare action 검증", () => {
  it("compare with targets", () => {
    const action = { type: "compare", targets: ["SEME71", "SEME72"] }
    expect(validateAction(action)).toBe(true)
  })
})

describe("answer action 검증 (필터 안 바뀌어야 함)", () => {
  it("answer with message", () => {
    const action = { type: "answer", message: "TiAlN은 내열성 코팅입니다." }
    expect(validateAction(action)).toBe(true)
  })
})

describe("복합 SCR 응답 검증", () => {
  it("3개 필터 + reasoning → validated", () => {
    const raw = {
      actions: [
        { type: "apply_filter", field: "fluteCount", value: 4, op: "eq" },
        { type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" },
        { type: "apply_filter", field: "toolSubtype", value: "Square", op: "eq" },
      ],
      answer: "",
      reasoning: "3 filters",
    }
    const result = validateAndCleanResult(raw)
    expect(result.actions).toHaveLength(3)
    expect(result.actions[0].type).toBe("apply_filter")
    expect(result.actions[0].field).toBe("fluteCount")
  })

  it("mixed valid/invalid actions → only valid kept", () => {
    const raw = {
      actions: [
        { type: "apply_filter", field: "fluteCount", value: 4, op: "eq" },
        { type: "INVALID_TYPE", field: "x" },
        { type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" },
      ],
      answer: "",
      reasoning: "",
    }
    const result = validateAndCleanResult(raw)
    expect(result.actions).toHaveLength(2)
  })

  it("null actions → empty", () => {
    const result = validateAndCleanResult({ actions: null, answer: "test" })
    expect(result.actions).toHaveLength(0)
    expect(result.answer).toBe("test")
  })

  it("apply + remove in same message", () => {
    const raw = {
      actions: [
        { type: "remove_filter", field: "toolSubtype" },
        { type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" },
      ],
      answer: "",
      reasoning: "remove Square, add TiAlN",
    }
    const result = validateAndCleanResult(raw)
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0].type).toBe("remove_filter")
    expect(result.actions[1].type).toBe("apply_filter")
  })
})

describe("extractJsonFromResponse edge cases", () => {
  it("JSON in triple backtick", () => {
    const text = 'Here is the result:\n```json\n{"actions":[],"answer":"test","reasoning":""}\n```'
    const parsed = extractJsonFromResponse(text)
    expect(parsed).not.toBeNull()
    expect((parsed as any).answer).toBe("test")
  })

  it("JSON with leading text", () => {
    const text = 'Sure! {"actions":[{"type":"skip"}],"answer":"","reasoning":"skip"}'
    const parsed = extractJsonFromResponse(text)
    expect(parsed).not.toBeNull()
    expect((parsed as any).actions).toHaveLength(1)
  })

  it("completely invalid → null", () => {
    expect(extractJsonFromResponse("not json at all")).toBeNull()
    expect(extractJsonFromResponse("")).toBeNull()
  })
})

describe("필터 체인 + 교체 시뮬레이션", () => {
  it("Square 적용 → Ball로 교체 → input 반영", () => {
    const base = makeBaseInput()
    const sq = buildAppliedFilterFromValue("toolSubtype", "Square")!
    let input = applyFilterToRecommendationInput(base, sq)
    expect(input.toolSubtype).toBe("Square")

    const ball = buildAppliedFilterFromValue("toolSubtype", "Ball")!
    input = applyFilterToRecommendationInput(input, ball)
    expect(input.toolSubtype).toBe("Ball")
  })

  it("4날 적용 → 6날로 교체", () => {
    const base = makeBaseInput()
    const f4 = buildAppliedFilterFromValue("fluteCount", 4)!
    let input = applyFilterToRecommendationInput(base, f4)
    expect(input.flutePreference).toBe(4)

    const f6 = buildAppliedFilterFromValue("fluteCount", 6)!
    input = applyFilterToRecommendationInput(input, f6)
    expect(input.flutePreference).toBe(6)
  })

  it("TiAlN 적용 → AlCrN으로 교체", () => {
    const base = makeBaseInput()
    const t1 = buildAppliedFilterFromValue("coating", "TiAlN")!
    let input = applyFilterToRecommendationInput(base, t1)
    expect(input.coatingPreference).toBe("TiAlN")

    const t2 = buildAppliedFilterFromValue("coating", "AlCrN")!
    input = applyFilterToRecommendationInput(input, t2)
    expect(input.coatingPreference).toBe("AlCrN")
  })
})
