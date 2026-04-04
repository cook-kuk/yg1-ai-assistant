/**
 * Round 29 — SCR few-shot 예시와 일치하는 deterministic 검증
 *
 * SCR 프롬프트의 모든 few-shot 예시가 실제로 올바른 필터를 생성하는지 확인
 */
import { describe, expect, it } from "vitest"
import {
  buildAppliedFilterFromValue,
  applyFilterToRecommendationInput,
  parseFieldAnswerToFilter,
} from "@/lib/recommendation/shared/filter-field-registry"
import { validateAction, validateAndCleanResult } from "@/lib/recommendation/core/single-call-router"
import { matchMaterial } from "@/lib/recommendation/shared/patterns"
import type { RecommendationInput } from "@/lib/recommendation/domain/types"

function makeBase(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput
}

describe("SCR few-shot 기본 필터 검증", () => {
  it.each([
    // 구리 계열
    ["workPieceName", "구리", "구리"],
    ["workPieceName", "동", "구리"],
    ["workPieceName", "copper", "구리"],
    // 알루미늄
    ["workPieceName", "알루미늄", "알루미늄"],
    ["workPieceName", "aluminum", "알루미늄"],
    // 스테인리스
    ["workPieceName", "스테인리스", expect.stringMatching(/stainless|스테인리스/i)],
    ["workPieceName", "SUS304", "SUS304"],
    // 고경도강
    ["workPieceName", "고경도강", "고경도강"],
    // 탄소강
    ["workPieceName", "탄소강", "탄소강"],
  ])("workPieceName '%s'='%s' → value contains expected", (field, input, expected) => {
    const f = parseFieldAnswerToFilter(field, input)
    expect(f).not.toBeNull()
    if (typeof expected === "string") {
      expect(f!.value).toBe(expected)
    }
  })

  it.each([
    ["toolSubtype", "Square", "Square"],
    ["toolSubtype", "Ball", "Ball"],
    ["toolSubtype", "Radius", "Radius"],
    ["toolSubtype", "Roughing", "Roughing"],
    ["toolSubtype", "Taper", "Taper"],
    ["toolSubtype", "Chamfer", "Chamfer"],
    ["toolSubtype", "High-Feed", "High-Feed"],
    ["toolSubtype", "스퀘어", "Square"],
    ["toolSubtype", "볼", "Ball"],
    ["toolSubtype", "래디우스", "Radius"],
    ["toolSubtype", "황삭", "Roughing"],
    ["toolSubtype", "사각", "Square"],
    ["toolSubtype", "평날", "Square"],
  ])("toolSubtype '%s'='%s' → '%s'", (field, input, expected) => {
    const f = buildAppliedFilterFromValue(field, input)
    expect(f?.rawValue).toBe(expected)
  })

  it.each([
    ["coating", "TiAlN", "TiAlN"],
    ["coating", "AlCrN", "AlCrN"],
    ["coating", "DLC", "DLC"],
    ["coating", "Uncoated", "Uncoated"],
    ["coating", "무코팅", "Uncoated"],
    ["coating", "비코팅", "Uncoated"],
    ["coating", "무코닝", "Uncoated"],
  ])("coating '%s'='%s' → '%s'", (field, input, expected) => {
    const f = buildAppliedFilterFromValue(field, input)
    expect(f?.rawValue).toBe(expected)
  })

  it.each([
    ["fluteCount", 2, 2],
    ["fluteCount", 3, 3],
    ["fluteCount", 4, 4],
    ["fluteCount", 6, 6],
    ["fluteCount", "두날", 2],
    ["fluteCount", "세날", 3],
    ["fluteCount", "네날", 4],
  ])("fluteCount '%s'=%s → %d", (field, input, expected) => {
    const f = buildAppliedFilterFromValue(field, input)
    expect(f?.rawValue).toBe(expected)
  })

  it.each([
    ["diameterMm", 10, 10],
    ["diameterMm", "10mm", 10],
    ["diameterMm", "파이10", 10],
    ["diameterMm", "10파이", 10],
    ["diameterMm", "Φ10", 10],
    ["diameterMm", "열미리", 10],
  ])("diameterMm '%s'=%s → %d", (field, input, expected) => {
    const f = buildAppliedFilterFromValue(field, input)
    expect(f?.rawValue).toBe(expected)
  })
})

describe("SCR few-shot 복합 필터 체인", () => {
  it("'4날 TiAlN Square' → 3 필터", () => {
    const base = makeBase()
    const f1 = buildAppliedFilterFromValue("fluteCount", 4)!
    const f2 = buildAppliedFilterFromValue("coating", "TiAlN")!
    const f3 = buildAppliedFilterFromValue("toolSubtype", "Square")!
    let input = applyFilterToRecommendationInput(base, f1)
    input = applyFilterToRecommendationInput(input, f2)
    input = applyFilterToRecommendationInput(input, f3)
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.toolSubtype).toBe("Square")
  })

  it("'구리 스퀘어 2날 10mm' → 4 필터", () => {
    const base = makeBase()
    const filters = [
      buildAppliedFilterFromValue("workPieceName", "구리")!,
      buildAppliedFilterFromValue("toolSubtype", "Square")!,
      buildAppliedFilterFromValue("fluteCount", 2)!,
      buildAppliedFilterFromValue("diameterMm", 10)!,
    ]
    let input = base
    for (const f of filters) input = applyFilterToRecommendationInput(input, f)
    expect(input.workPieceName).toBe("구리")
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(2)
    expect(input.diameterMm).toBe(10)
  })

  it("'3날 무코팅에 스퀘어' → 3 필터", () => {
    const base = makeBase()
    const f1 = buildAppliedFilterFromValue("fluteCount", 3)!
    const f2 = buildAppliedFilterFromValue("coating", "Uncoated")!
    const f3 = buildAppliedFilterFromValue("toolSubtype", "Square")!
    let input = applyFilterToRecommendationInput(base, f1)
    input = applyFilterToRecommendationInput(input, f2)
    input = applyFilterToRecommendationInput(input, f3)
    expect(input.flutePreference).toBe(3)
    expect(input.coatingPreference).toBe("Uncoated")
    expect(input.toolSubtype).toBe("Square")
  })
})

describe("SCR action validation — 모든 타입", () => {
  it.each([
    "apply_filter", "remove_filter", "replace_filter",
    "show_recommendation", "compare", "answer", "skip", "reset", "go_back",
  ])("action type '%s' → valid", (type) => {
    expect(validateAction({ type })).toBe(true)
  })

  it("invalid type → false", () => {
    expect(validateAction({ type: "INVALID" })).toBe(false)
    expect(validateAction(null)).toBe(false)
    expect(validateAction({})).toBe(false)
  })
})

describe("소재 matchMaterial 전체 검증", () => {
  it.each([
    ["알루미늄 가공", "알루미늄"],
    ["SUS304 소재", "스테인리스"],
    ["S45C 가공", "탄소강"],
    ["HRC55 경화강", "고경도강"],
    ["인코넬 718", "인코넬"],
    ["구리 전용", "구리"],
    ["주철 가공", "주철"],
    ["티타늄 소재", "티타늄"],
    ["초내열합금", "인코넬"],
  ])("matchMaterial('%s') → '%s'", (text, expected) => {
    expect(matchMaterial(text)).toBe(expected)
  })
})
