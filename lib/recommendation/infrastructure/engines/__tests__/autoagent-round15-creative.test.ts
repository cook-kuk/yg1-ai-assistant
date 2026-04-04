/**
 * Round 15 — 창의적 시나리오 테스트 (30개)
 *
 * 실제 피드백 + E2E 시나리오에서 발견된 엣지 케이스
 */
import { describe, expect, it } from "vitest"
import {
  buildAppliedFilterFromValue,
  applyFilterToRecommendationInput,
  parseFieldAnswerToFilter,
} from "@/lib/recommendation/shared/filter-field-registry"
import {
  validateAndCleanResult,
  extractJsonFromResponse,
} from "@/lib/recommendation/core/single-call-router"
import { matchMaterial } from "@/lib/recommendation/shared/patterns"
import type { RecommendationInput } from "@/lib/recommendation/domain/types"

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput
}

describe("소재 matchMaterial — 구체 강종", () => {
  it.each([
    ["SUS304 가공", "스테인리스"],
    ["SUS316L 황삭", "스테인리스"],
    ["S45C 가공", "탄소강"],
    ["SCM440 소재", "탄소강"],
    ["인코넬 718", "인코넬"],
    ["내열합금 가공", "인코넬"],
    ["Titanium 가공", "티타늄"],
    ["Al 소재", "알루미늄"],
    ["구리 가공", "구리"],
  ])("'%s' → %s", (text, expected) => {
    expect(matchMaterial(text)).toBe(expected)
  })
})

describe("직경 인치→mm 변환", () => {
  it("1/2인치 → 12.7mm", () => {
    const f = buildAppliedFilterFromValue("diameterMm", '1/2"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(12.7, 0)
  })

  it("3/8인치 → 9.525mm", () => {
    const f = buildAppliedFilterFromValue("diameterMm", '3/8"')
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(9.525, 0)
  })

  it("1/4 inch → 6.35mm", () => {
    const f = buildAppliedFilterFromValue("diameterMm", "1/4 inch")
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBeCloseTo(6.35, 0)
  })
})

describe("코팅 변주", () => {
  it.each([
    ["TiAlN", "TiAlN"],
    ["AlCrN", "AlCrN"],
    ["DLC", "DLC"],
    ["무코팅", "Uncoated"],
    ["비코팅", "Uncoated"],
  ])("coating '%s' → '%s'", (input, expected) => {
    const f = buildAppliedFilterFromValue("coating", input)
    expect(f).not.toBeNull()
    expect(f!.rawValue).toBe(expected)
  })
})

describe("복합 필터 체인 — 5필터 한번에", () => {
  it("탄소강 + 4날 + Square + TiAlN + 10mm", () => {
    const base = makeBaseInput()
    const filters = [
      buildAppliedFilterFromValue("workPieceName", "탄소강")!,
      buildAppliedFilterFromValue("fluteCount", 4)!,
      buildAppliedFilterFromValue("toolSubtype", "Square")!,
      buildAppliedFilterFromValue("coating", "TiAlN")!,
      buildAppliedFilterFromValue("diameterMm", 10)!,
    ]
    expect(filters.every(f => f != null)).toBe(true)

    let input = base
    for (const f of filters) input = applyFilterToRecommendationInput(input, f)

    expect(input.workPieceName).toBeTruthy()
    expect(input.flutePreference).toBe(4)
    expect(input.toolSubtype).toBe("Square")
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.diameterMm).toBe(10)
  })

  it("스테인리스 + 6날 + Roughing + AlCrN + 8mm", () => {
    const base = makeBaseInput()
    const filters = [
      parseFieldAnswerToFilter("workPieceName", "스테인리스")!,
      buildAppliedFilterFromValue("fluteCount", 6)!,
      buildAppliedFilterFromValue("toolSubtype", "Roughing")!,
      buildAppliedFilterFromValue("coating", "AlCrN")!,
      buildAppliedFilterFromValue("diameterMm", 8)!,
    ]
    expect(filters.every(f => f != null)).toBe(true)

    let input = base
    for (const f of filters) input = applyFilterToRecommendationInput(input, f)

    expect(input.flutePreference).toBe(6)
    expect(input.toolSubtype).toBe("Roughing")
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.diameterMm).toBe(8)
  })
})

describe("SCR JSON 파싱 — 실전 LLM 응답 형식", () => {
  it("markdown 감싼 JSON", () => {
    const text = "Here is my analysis:\n```json\n{\"actions\":[{\"type\":\"apply_filter\",\"field\":\"fluteCount\",\"value\":4,\"op\":\"eq\"}],\"answer\":\"\",\"reasoning\":\"flute count\"}\n```\nLet me know if you need more."
    const parsed = extractJsonFromResponse(text)
    expect(parsed).not.toBeNull()
    const result = validateAndCleanResult(parsed)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].value).toBe(4)
  })

  it("한국어 reasoning 포함", () => {
    const text = '{"actions":[{"type":"skip"}],"answer":"","reasoning":"사용자가 스킵 요청"}'
    const parsed = extractJsonFromResponse(text)
    const result = validateAndCleanResult(parsed)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].type).toBe("skip")
    expect(result.reasoning).toBe("사용자가 스킵 요청")
  })

  it("5개 필터 복합 응답", () => {
    const raw = {
      actions: [
        { type: "apply_filter", field: "workPieceName", value: "탄소강", op: "eq" },
        { type: "apply_filter", field: "diameterMm", value: 10, op: "eq" },
        { type: "apply_filter", field: "fluteCount", value: 4, op: "eq" },
        { type: "apply_filter", field: "toolSubtype", value: "Square", op: "eq" },
        { type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" },
      ],
      answer: "",
      reasoning: "5 filters",
    }
    const result = validateAndCleanResult(raw)
    expect(result.actions).toHaveLength(5)
    expect(result.actions.every(a => a.type === "apply_filter")).toBe(true)
  })
})

describe("workPieceName DB 정규화 — 구체 강종 유지", () => {
  it("SUS304 → display 유지, DB에서 Stainless 매핑", () => {
    const f = buildAppliedFilterFromValue("workPieceName", "SUS304")
    expect(f).not.toBeNull()
    // display 레벨에서는 원본 유지 (SUS304)
    expect(f!.value).toBe("SUS304")
  })

  it("S45C → display 유지", () => {
    const f = buildAppliedFilterFromValue("workPieceName", "S45C")
    expect(f).not.toBeNull()
    expect(f!.value).toBe("S45C")
  })

  it("SKD11 → display 유지", () => {
    const f = buildAppliedFilterFromValue("workPieceName", "SKD11")
    expect(f).not.toBeNull()
    expect(f!.value).toBe("SKD11")
  })
})
