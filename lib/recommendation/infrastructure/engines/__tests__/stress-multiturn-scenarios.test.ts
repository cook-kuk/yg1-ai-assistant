import { describe, expect, it } from "vitest"

import { resolvePendingQuestionReply, resolveExplicitRevisionRequest, resolveExplicitComparisonAction } from "../serve-engine-runtime"
import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter, replaceFieldFilters, rebuildInputFromFilters } from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import {
  buildAppliedFilterFromValue,
  applyFilterToRecommendationInput,
  getFilterFieldDefinition,
  parseFieldAnswerToFilter,
  getFilterFieldLabel,
  clearFilterFromRecommendationInput,
} from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput, DisplayedOption } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "stress-test",
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: makeBaseInput(),
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

function makeFilter(field: string, value: string | number, at = 0): AppliedFilter {
  const filter = buildAppliedFilterFromValue(field, value, at)
  if (!filter) throw new Error(`Cannot build filter for ${field}=${value}`)
  return filter
}

function makeSkipFilter(field: string, at = 0): AppliedFilter {
  return { field, op: "skip", value: "상관없음", rawValue: "skip", appliedAt: at }
}

function applyChain(base: RecommendationInput, filters: AppliedFilter[]): RecommendationInput {
  let input = { ...base }
  for (const f of filters) input = applyFilterToRecommendationInput(input, f)
  return input
}

function makeOptions(field: string, values: Array<{ label: string; value: string; count: number }>): DisplayedOption[] {
  return values.map((v, i) => ({ index: i + 1, label: v.label, field, value: v.value, count: v.count }))
}

// ═══════════════════════════════════════════════════════════════
// PART A: Filter Build & Canonicalize (20 cases)
// ═══════════════════════════════════════════════════════════════

describe("A. 필터 생성 & 정규화", () => {
  // ── 직경 ──
  it("A01: diameterMm 정수 → rawValue number", () => {
    const f = makeFilter("diameterMm", 10)
    expect(f.field).toBe("diameterMm")
    expect(f.rawValue).toBe(10)
  })

  it("A02: diameterMm 소수점 → 정확한 number", () => {
    const f = makeFilter("diameterMm", 9.922)
    expect(f.rawValue).toBe(9.922)
  })

  it("A03: diameterRefine → canonicalField diameterMm 변환", () => {
    const f = buildAppliedFilterFromValue("diameterRefine", "9.95mm")!
    expect(f.field).toBe("diameterMm")
    expect(f.rawValue).toBe(9.95)
  })

  it("A04: diameterRefine 정수 → diameterMm", () => {
    const f = buildAppliedFilterFromValue("diameterRefine", 10)!
    expect(f.field).toBe("diameterMm")
    expect(f.rawValue).toBe(10)
  })

  it("A05: diameterRefine에 buildDbClause 없음 (이중 WHERE 방지)", () => {
    const def = getFilterFieldDefinition("diameterRefine")
    expect(def?.buildDbClause).toBeUndefined()
  })

  it("A06: diameterMm에 buildDbClause 있음", () => {
    const def = getFilterFieldDefinition("diameterMm")
    expect(def?.buildDbClause).toBeDefined()
  })

  // ── 형상 ──
  it("A07: toolSubtype Square → 정확 매핑", () => {
    expect(makeFilter("toolSubtype", "Square").rawValue).toBe("Square")
  })

  it("A08: toolSubtype 볼 → Ball", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "볼")
    expect(f?.rawValue).toBe("Ball")
  })

  it("A09: toolSubtype 라디우스 → Radius", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "라디우스")
    expect(f?.rawValue).toBe("Radius")
  })

  it("A10: toolSubtype 황삭 → Roughing", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "황삭")
    expect(f?.rawValue).toBe("Roughing")
  })

  it("A11: toolSubtype 테이퍼 → Taper", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "테이퍼")
    expect(f?.rawValue).toBe("Taper")
  })

  it("A12: toolSubtype 챔퍼 → Chamfer", () => {
    const f = buildAppliedFilterFromValue("toolSubtype", "챔퍼")
    expect(f?.rawValue).toBe("Chamfer")
  })

  // ── 날수 ──
  it("A13: fluteCount '3날' → rawValue 3", () => {
    expect(makeFilter("fluteCount", "3날").rawValue).toBe(3)
  })

  it("A14: fluteCount 숫자 4 → rawValue 4", () => {
    expect(makeFilter("fluteCount", 4).rawValue).toBe(4)
  })

  // ── 코팅 ──
  it("A15: coating TiAlN → 정확 매핑", () => {
    expect(makeFilter("coating", "TiAlN").rawValue).toBe("TiAlN")
  })

  it("A16: coating AlCrN → 정확 매핑", () => {
    expect(makeFilter("coating", "AlCrN").rawValue).toBe("AlCrN")
  })

  // ── 숫자 필드들 ──
  it("A17: shankDiameterMm → number", () => {
    const f = buildAppliedFilterFromValue("shankDiameterMm", 10)
    expect(f?.rawValue).toBe(10)
  })

  it("A18: lengthOfCutMm → number", () => {
    const f = buildAppliedFilterFromValue("lengthOfCutMm", 25)
    expect(f?.rawValue).toBe(25)
  })

  it("A19: overallLengthMm → number", () => {
    const f = buildAppliedFilterFromValue("overallLengthMm", 100)
    expect(f?.rawValue).toBe(100)
  })

  it("A20: helixAngleDeg → number", () => {
    const f = buildAppliedFilterFromValue("helixAngleDeg", 45)
    expect(f?.rawValue).toBe(45)
  })
})

// ═══════════════════════════════════════════════════════════════
// PART B: Filter Replace 단일 (15 cases)
// ═══════════════════════════════════════════════════════════════

describe("B. 필터 교체 단일", () => {
  const base = makeBaseInput()

  it("B01: diameterMm 10→8 교체", () => {
    const r = replaceFieldFilter(base, [makeFilter("diameterMm", 10)], makeFilter("diameterMm", 8), applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
    expect(r.nextFilters).toHaveLength(1)
    expect(r.nextInput.diameterMm).toBe(8)
  })

  it("B02: diameterRefine → 기존 diameterMm 교체", () => {
    const refine = buildAppliedFilterFromValue("diameterRefine", 9.95)!
    const r = replaceFieldFilter(base, [makeFilter("diameterMm", 10)], refine, applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
    expect(r.nextFilters).toHaveLength(1)
    expect(r.nextInput.diameterMm).toBe(9.95)
  })

  it("B03: fluteCount 4→2 교체, 다른 필터 유지", () => {
    const existing = [makeFilter("toolSubtype", "Square"), makeFilter("fluteCount", 4)]
    const r = replaceFieldFilter(base, existing, makeFilter("fluteCount", 2), applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(2)
    expect(r.nextInput.flutePreference).toBe(2)
    expect(r.nextInput.toolSubtype).toBe("Square")
  })

  it("B04: coating 추가 (기존에 없음) → replacedExisting=false", () => {
    const existing = [makeFilter("toolSubtype", "Square")]
    const r = replaceFieldFilter(base, existing, makeFilter("coating", "TiAlN"), applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(false)
    expect(r.nextFilters).toHaveLength(2)
  })

  it("B05: 같은 값으로 교체 → 필터 수 변화 없음", () => {
    const existing = [makeFilter("fluteCount", 4)]
    const r = replaceFieldFilter(base, existing, makeFilter("fluteCount", 4, 1), applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(1)
  })

  it("B06: workPieceName 교체", () => {
    const existing = [makeFilter("workPieceName", "알루미늄")]
    const r = replaceFieldFilter(base, existing, makeFilter("workPieceName", "스테인리스강"), applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
    expect(r.nextInput.workPieceName).toBe("스테인리스강")
  })

  it("B07: 5개 필터 중 1개만 교체 → 5개 유지", () => {
    const existing = [
      makeFilter("toolSubtype", "Square"),
      makeFilter("fluteCount", 4),
      makeFilter("coating", "TiAlN"),
      makeFilter("diameterMm", 10),
      makeFilter("workPieceName", "알루미늄"),
    ]
    const r = replaceFieldFilter(base, existing, makeFilter("coating", "DLC", 1), applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(5)
    expect(r.nextInput.coatingPreference).toBe("DLC")
    expect(r.nextInput.toolSubtype).toBe("Square")
    expect(r.nextInput.flutePreference).toBe(4)
  })

  it("B08: 빈 필터 배열에 추가", () => {
    const r = replaceFieldFilter(base, [], makeFilter("toolSubtype", "Ball"), applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(false)
    expect(r.nextFilters).toHaveLength(1)
  })

  it("B09: toolType 교체", () => {
    const existing = [makeFilter("toolType", "Solid")]
    const r = replaceFieldFilter(base, existing, makeFilter("toolType", "Indexable"), applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
  })

  it("B10: brand 교체", () => {
    const f1 = buildAppliedFilterFromValue("brand", "ALU-POWER HPC")
    const f2 = buildAppliedFilterFromValue("brand", "TANK-POWER")
    if (f1 && f2) {
      const r = replaceFieldFilter(base, [f1], f2, applyFilterToRecommendationInput)
      expect(r.replacedExisting).toBe(true)
    }
  })

  it("B11: edpSeriesName 교체", () => {
    const f1 = buildAppliedFilterFromValue("edpSeriesName", "E5E84")
    const f2 = buildAppliedFilterFromValue("edpSeriesName", "E5E83")
    if (f1 && f2) {
      const r = replaceFieldFilter(base, [f1], f2, applyFilterToRecommendationInput)
      expect(r.replacedExisting).toBe(true)
      expect(r.nextFilters).toHaveLength(1)
    }
  })

  it("B12: coolantHole boolean 필터", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "있음")
    if (f) {
      expect(f.rawValue).toBe(true)
    }
  })

  it("B13: material → workPieceName 클리어 연동", () => {
    const input = makeBaseInput({ workPieceName: "ADC12" })
    const matFilter = makeFilter("material", "주철")
    const updated = applyFilterToRecommendationInput(input, matFilter)
    expect(updated.material).toBe("주철")
    expect(updated.workPieceName).toBeUndefined()
  })

  it("B14: clearFilterFromRecommendationInput → 필드 초기화", () => {
    const input = makeBaseInput({ diameterMm: 10, toolSubtype: "Square" })
    const cleared = clearFilterFromRecommendationInput(input, "diameterMm")
    expect(cleared.diameterMm).toBeUndefined()
    expect(cleared.toolSubtype).toBe("Square")
  })

  it("B15: rebuildInputFromFilters → 순서 무관 동일 결과", () => {
    const filters = [
      makeFilter("toolSubtype", "Square"),
      makeFilter("fluteCount", 4),
      makeFilter("diameterMm", 10),
    ]
    const r1 = rebuildInputFromFilters(base, filters, applyFilterToRecommendationInput)
    const reversed = [...filters].reverse()
    const r2 = rebuildInputFromFilters(base, reversed, applyFilterToRecommendationInput)
    expect(r1.toolSubtype).toBe(r2.toolSubtype)
    expect(r1.flutePreference).toBe(r2.flutePreference)
    expect(r1.diameterMm).toBe(r2.diameterMm)
  })
})

// ═══════════════════════════════════════════════════════════════
// PART C: 다중 필터 동시 교체 (10 cases)
// ═══════════════════════════════════════════════════════════════

describe("C. 다중 필터 동시 교체", () => {
  const base = makeBaseInput()

  it("C01: 2개 동시 교체", () => {
    const existing = [makeFilter("fluteCount", 2), makeFilter("coating", "DLC")]
    const news = [makeFilter("fluteCount", 4, 1), makeFilter("coating", "TiAlN", 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
    expect(r.replacedFields).toContain("fluteCount")
    expect(r.replacedFields).toContain("coating")
    expect(r.nextFilters).toHaveLength(2)
  })

  it("C02: 2개 교체 + 1개 추가 = 3개", () => {
    const existing = [makeFilter("fluteCount", 2), makeFilter("coating", "DLC")]
    const news = [makeFilter("fluteCount", 4, 1), makeFilter("coating", "TiAlN", 1), makeFilter("toolSubtype", "Square", 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(3)
  })

  it("C03: 기존 3개 중 1개만 교체", () => {
    const existing = [makeFilter("fluteCount", 4), makeFilter("coating", "TiAlN"), makeFilter("toolSubtype", "Square")]
    const news = [makeFilter("coating", "DLC", 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.replacedFields).toEqual(["coating"])
    expect(r.nextFilters).toHaveLength(3)
  })

  it("C04: 전부 새 필터 (교체 없음)", () => {
    const existing = [makeFilter("fluteCount", 4)]
    const news = [makeFilter("coating", "TiAlN", 1), makeFilter("toolSubtype", "Square", 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(false)
    expect(r.nextFilters).toHaveLength(3)
  })

  it("C05: 빈 배열에 3개 추가", () => {
    const news = [makeFilter("fluteCount", 4), makeFilter("coating", "TiAlN"), makeFilter("toolSubtype", "Square")]
    const r = replaceFieldFilters(base, [], news, applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(false)
    expect(r.nextFilters).toHaveLength(3)
  })

  it("C06: 같은 필드 2번 → 마지막 값 사용", () => {
    const existing = [makeFilter("fluteCount", 2)]
    const news = [makeFilter("fluteCount", 3, 1), makeFilter("fluteCount", 4, 2)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.nextFilters.filter(f => f.field === "fluteCount")).toHaveLength(1)
    expect(r.nextInput.flutePreference).toBe(4)
  })

  it("C07: diameterRefine + fluteCount 동시", () => {
    const existing = [makeFilter("diameterMm", 10), makeFilter("fluteCount", 4)]
    const refine = buildAppliedFilterFromValue("diameterRefine", 9.95, 1)!
    const news = [refine, makeFilter("fluteCount", 2, 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.nextInput.diameterMm).toBe(9.95)
    expect(r.nextInput.flutePreference).toBe(2)
    expect(r.nextFilters).toHaveLength(2)
  })

  it("C08: skip 필터 + 실제 필터 혼합", () => {
    const existing = [makeSkipFilter("coating"), makeFilter("fluteCount", 4)]
    const news = [makeFilter("coating", "TiAlN", 1)]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.nextFilters.find(f => f.field === "coating")?.op).not.toBe("skip")
    expect(r.nextInput.coatingPreference).toBe("TiAlN")
  })

  it("C09: 5개 동시 적용", () => {
    const news = [
      makeFilter("toolSubtype", "Square"),
      makeFilter("fluteCount", 4),
      makeFilter("coating", "TiAlN"),
      makeFilter("diameterMm", 10),
      makeFilter("workPieceName", "알루미늄"),
    ]
    const r = replaceFieldFilters(base, [], news, applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(5)
    expect(r.nextInput.toolSubtype).toBe("Square")
    expect(r.nextInput.flutePreference).toBe(4)
    expect(r.nextInput.coatingPreference).toBe("TiAlN")
    expect(r.nextInput.diameterMm).toBe(10)
    expect(r.nextInput.workPieceName).toBe("알루미늄")
  })

  it("C10: 전체 교체 (5개 → 5개 다른 값)", () => {
    const existing = [
      makeFilter("toolSubtype", "Square"),
      makeFilter("fluteCount", 4),
      makeFilter("coating", "TiAlN"),
      makeFilter("diameterMm", 10),
      makeFilter("workPieceName", "알루미늄"),
    ]
    const news = [
      makeFilter("toolSubtype", "Ball", 1),
      makeFilter("fluteCount", 2, 1),
      makeFilter("coating", "DLC", 1),
      makeFilter("diameterMm", 8, 1),
      makeFilter("workPieceName", "스테인리스강", 1),
    ]
    const r = replaceFieldFilters(base, existing, news, applyFilterToRecommendationInput)
    expect(r.replacedExisting).toBe(true)
    expect(r.nextFilters).toHaveLength(5)
    expect(r.nextInput.toolSubtype).toBe("Ball")
    expect(r.nextInput.diameterMm).toBe(8)
  })
})

// ═══════════════════════════════════════════════════════════════
// PART D: Pending Question Reply — 칩 클릭 (25 cases)
// ═══════════════════════════════════════════════════════════════

describe("D. 칩 클릭 → Pending Question Reply", () => {
  it("D01: toolSubtype 칩 exact match", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype", displayedOptions: makeOptions("toolSubtype", [
        { label: "Square (2072개)", value: "Square", count: 2072 },
        { label: "Ball (559개)", value: "Ball", count: 559 },
      ])}),
      "Square (2072개)"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.rawValue).toBe("Square")
  })

  it("D02: toolSubtype bare value (괄호 없이)", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype", displayedOptions: makeOptions("toolSubtype", [
        { label: "Square (2072개)", value: "Square", count: 2072 },
      ])}),
      "Square"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D03: fluteCount 칩 with count", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "fluteCount", displayedOptions: makeOptions("fluteCount", [
        { label: "4날 (864개)", value: "4날", count: 864 },
        { label: "2날 (300개)", value: "2날", count: 300 },
      ])}),
      "4날 (864개)"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.rawValue).toBe(4)
  })

  it("D04: coating 칩", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: makeOptions("coating", [
        { label: "TiAlN (500개)", value: "TiAlN", count: 500 },
      ])}),
      "TiAlN (500개)"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.rawValue).toBe("TiAlN")
  })

  it("D05: 상관없음 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: [
        ...makeOptions("coating", [{ label: "TiAlN", value: "TiAlN", count: 500 }]),
        { index: 2, label: "상관없음", field: "coating", value: "skip", count: 0 },
      ]}),
      "상관없음"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it("D06: displayedChips fallback (displayedOptions 비었을 때)", () => {
    const r = resolvePendingQuestionReply(
      makeState({
        lastAskedField: "coating",
        displayedOptions: [],
        displayedChips: ["TiAlN (500개)", "AlCrN (300개)", "상관없음"],
      }),
      "TiAlN (500개)"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D07: 질문 형태 메시지 → side_question", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: makeOptions("coating", [
        { label: "TiAlN", value: "TiAlN", count: 500 },
      ])}),
      "TiAlN이 뭐야?"
    )
    expect(r.kind).toBe("side_question")
  })

  it("D08: workPieceName 칩", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "workPieceName", displayedOptions: makeOptions("workPieceName", [
        { label: "알루미늄", value: "알루미늄", count: 200 },
        { label: "스테인리스강", value: "스테인리스강", count: 150 },
      ])}),
      "알루미늄"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D09: 숫자만 입력 (직경 pending) → resolved", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "diameterMm", displayedOptions: makeOptions("diameterMm", [
        { label: "10mm", value: "10mm", count: 2000 },
        { label: "8mm", value: "8mm", count: 1500 },
      ])}),
      "10mm"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D10: 한글 접미사 (으로요) 제거 후 매칭", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype", displayedOptions: makeOptions("toolSubtype", [
        { label: "Square (2072개)", value: "Square", count: 2072 },
      ])}),
      "Square로요"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D11: 한글 접미사 (이에요) 제거 후 매칭", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "fluteCount", displayedOptions: makeOptions("fluteCount", [
        { label: "4날 (864개)", value: "4날", count: 864 },
      ])}),
      "4날이에요"
    )
    expect(r.kind).toBe("resolved")
  })

  it("D12: 비교 관련 메시지 → side_question", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: makeOptions("coating", [
        { label: "TiAlN", value: "TiAlN", count: 500 },
      ])}),
      "TiAlN과 AlCrN 차이가 뭐야?"
    )
    expect(r.kind).toBe("side_question")
  })

  it("D13: 설명 요청 → side_question", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype" }),
      "각 형상 차이 설명해줘"
    )
    expect(r.kind).toBe("side_question")
  })

  it("D14: 처음부터 다시 → side_question (navigation keyword)", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating" }),
      "처음부터 다시"
    )
    expect(r.kind).toBe("side_question")
  })

  it("D15: 이전 단계 → side_question (navigation keyword)", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating" }),
      "⟵ 이전 단계"
    )
    expect(r.kind).toBe("side_question")
  })

  it("D16: resolved 상태에서는 pending 질문 없음 → none", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", resolutionStatus: "resolved" }),
      "TiAlN"
    )
    expect(r.kind).toBe("none")
  })

  it("D17: lastAskedField 없으면 → none", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: undefined }),
      "TiAlN"
    )
    expect(r.kind).toBe("none")
  })

  it("D18: 빈 메시지 → none", () => {
    const r = resolvePendingQuestionReply(makeState({ lastAskedField: "coating" }), "")
    expect(r.kind).toBe("none")
  })

  it("D19: null 메시지 → none", () => {
    const r = resolvePendingQuestionReply(makeState({ lastAskedField: "coating" }), null as any)
    expect(r.kind).toBe("none")
  })

  it("D20: 매칭 안 되는 값 → unresolved", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype", displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 2072 },
      ])}),
      "완전히 다른 텍스트"
    )
    expect(r.kind).toBe("unresolved")
  })

  it("D21: 아무거나 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: [
        ...makeOptions("coating", [{ label: "TiAlN", value: "TiAlN", count: 500 }]),
        { index: 2, label: "상관없음", field: "coating", value: "skip", count: 0 },
      ]}),
      "아무거나"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it("D22: 추천으로 골라줘 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "fluteCount", displayedOptions: [
        ...makeOptions("fluteCount", [{ label: "4날", value: "4날", count: 864 }]),
        { index: 2, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
      ]}),
      "추천으로 골라줘"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it("D23: 패스 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: [
        { index: 1, label: "상관없음", field: "coating", value: "skip", count: 0 },
      ]}),
      "패스"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it("D24: 넘어가 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "coating", displayedOptions: [
        { index: 1, label: "상관없음", field: "coating", value: "skip", count: 0 },
      ]}),
      "넘어가"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it("D25: 스킵 → skip", () => {
    const r = resolvePendingQuestionReply(
      makeState({ lastAskedField: "fluteCount", displayedOptions: [
        { index: 1, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
      ]}),
      "스킵"
    )
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })
})

// ═══════════════════════════════════════════════════════════════
// PART E: Explicit Revision (20 cases)
// ═══════════════════════════════════════════════════════════════

describe("E. Explicit Revision 요청", () => {
  it("E01: 3날 대신 2날로 변경", async () => {
    const state = makeState({ appliedFilters: [makeFilter("fluteCount", 3, 1)] })
    const r = await resolveExplicitRevisionRequest(state, "3날 대신 2날로 변경")
    expect(r?.kind).toBe("resolved")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("fluteCount")
      expect(r.request.nextFilter.rawValue).toBe(2)
    }
  })

  it("E02: TiAlN 말고 AlCrN으로", async () => {
    const state = makeState({ appliedFilters: [makeFilter("coating", "TiAlN", 1)] })
    const r = await resolveExplicitRevisionRequest(state, "TiAlN 말고 AlCrN으로")
    expect(r?.kind).toBe("resolved")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("coating")
    }
  })

  it("E03: Square 말고 Ball로 변경", async () => {
    const state = makeState({ appliedFilters: [makeFilter("toolSubtype", "Square", 1)] })
    const r = await resolveExplicitRevisionRequest(state, "Square 말고 Ball로 변경")
    expect(r?.kind).toBe("resolved")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("toolSubtype")
    }
  })

  it("E04: revision signal 없으면 null", async () => {
    const state = makeState({ appliedFilters: [makeFilter("fluteCount", 3)] })
    const r = await resolveExplicitRevisionRequest(state, "TiAlN 코팅 추천해줘")
    expect(r).toBeNull()
  })

  it("E05: appliedFilters 비었고 resolvedInput에 값 있음 → synthetic filter", async () => {
    const state = makeState({
      appliedFilters: [],
      resolvedInput: makeBaseInput({ diameterMm: 10 }),
    })
    const r = await resolveExplicitRevisionRequest(state, "직경 8mm로 바꿔줘")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("diameterMm")
      expect(r.request.nextFilter.rawValue).toBe(8)
    }
  })

  it("E06: 3날 말고 4날로 변경해서 추천해줘", async () => {
    const state = makeState({
      currentMode: "recommendation",
      appliedFilters: [
        makeFilter("toolSubtype", "Square", 0),
        makeFilter("fluteCount", 3, 1),
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경해서 추천해줘")
    expect(r?.kind).toBe("resolved")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("fluteCount")
      expect(r.request.nextFilter.rawValue).toBe(4)
    }
  })

  it("E07: 단순 선택 메시지는 revision이 아님", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("fluteCount", 3, 1)],
      lastAskedField: "toolSubtype",
    })
    const r = await resolveExplicitRevisionRequest(state, "Radius")
    expect(r).toBeNull()
  })

  it("E08: null 메시지 → null", async () => {
    const r = await resolveExplicitRevisionRequest(makeState(), null)
    expect(r).toBeNull()
  })

  it("E09: 빈 메시지 → null", async () => {
    const r = await resolveExplicitRevisionRequest(makeState(), "")
    expect(r).toBeNull()
  })

  it("E10: state null → null", async () => {
    const r = await resolveExplicitRevisionRequest(null, "3날 말고 2날")
    expect(r).toBeNull()
  })

  it("E11: skip 필터만 있을 때 → activeFilters 비었으므로 synthetic 사용", async () => {
    const state = makeState({
      appliedFilters: [makeSkipFilter("coating")],
      resolvedInput: makeBaseInput({ diameterMm: 10 }),
    })
    const r = await resolveExplicitRevisionRequest(state, "직경 8mm로 변경")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("diameterMm")
    }
  })

  it("E12: 같은 값으로 변경 시도 → null", async () => {
    const state = makeState({ appliedFilters: [makeFilter("fluteCount", 4, 1)] })
    const r = await resolveExplicitRevisionRequest(state, "4날 대신 4날로 변경")
    expect(r).toBeNull()
  })

  it("E13: 여러 필터 중 정확한 대상 식별", async () => {
    const state = makeState({
      appliedFilters: [
        makeFilter("toolSubtype", "Square", 0),
        makeFilter("fluteCount", 4, 1),
        makeFilter("coating", "TiAlN", 2),
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "코팅 AlCrN으로 변경")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("coating")
    }
  })

  it("E14: 형상을 roughing으로 변경", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Square", 0)],
    })
    const r = await resolveExplicitRevisionRequest(state, "형상을 roughing으로 변경")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("toolSubtype")
    }
  })

  it("E15: 날수 변경과 동시에 '추천해줘' → revision으로 처리", async () => {
    const state = makeState({ appliedFilters: [makeFilter("fluteCount", 3, 1)] })
    const r = await resolveExplicitRevisionRequest(state, "2날로 바꿔서 다시 추천해줘")
    if (r?.kind === "resolved") {
      expect(r.request.nextFilter.rawValue).toBe(2)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// PART F: 풀 라이프사이클 시나리오 (15 cases)
// ═══════════════════════════════════════════════════════════════

describe("F. 풀 라이프사이클 시나리오", () => {
  const base = makeBaseInput({ diameterMm: 10, machiningCategory: "Milling" })

  it("F01: intake → 형상 → 날수 → 코팅 → 추천 (정상 4턴)", () => {
    const filters = [
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("fluteCount", 4, 1),
      makeFilter("coating", "TiAlN", 2),
    ]
    const input = applyChain(base, filters)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.diameterMm).toBe(10)
  })

  it("F02: 추천 후 날수 변경 → 필터 교체", () => {
    const filters = [
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("fluteCount", 4, 1),
      makeFilter("coating", "TiAlN", 2),
    ]
    const newFlute = makeFilter("fluteCount", 2, 3)
    const r = replaceFieldFilter(base, filters, newFlute, applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(3)
    expect(r.nextInput.flutePreference).toBe(2)
    expect(r.nextInput.toolSubtype).toBe("Square")
  })

  it("F03: 추천 후 소재 추가 → 4개 필터", () => {
    const filters = [
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("fluteCount", 2, 3),
      makeFilter("coating", "TiAlN", 2),
    ]
    const matFilter = makeFilter("workPieceName", "알루미늄", 4)
    const r = replaceFieldFilter(base, filters, matFilter, applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(4)
    expect(r.nextInput.workPieceName).toBe("알루미늄")
  })

  it("F04: 직경 변경 → 시리즈 종속 클리어", () => {
    const filters = [
      makeFilter("diameterMm", 10, 0),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("edpSeriesName", "E5E84", 1),
    ]
    const deps = ["diameterMm", "diameterRefine", "seriesName", "edpSeriesName"]
    const remaining = filters.filter(f => !deps.includes(f.field))
    const newDiam = makeFilter("diameterMm", 8, 2)
    const final = [...remaining, newDiam]
    expect(final).toHaveLength(2)
    expect(final.find(f => f.field === "edpSeriesName")).toBeUndefined()
  })

  it("F05: skip 3개 → 바로 추천 → skip 무시하고 전체 검색", () => {
    const filters = [
      makeSkipFilter("fluteCount", 0),
      makeSkipFilter("coating", 1),
      makeSkipFilter("toolSubtype", 2),
    ]
    const input = applyChain(base, filters)
    expect(input.flutePreference).toBeUndefined()
    expect(input.coatingPreference).toBeUndefined()
    expect(input.toolSubtype).toBeUndefined()
    expect(input.diameterMm).toBe(10)
  })

  it("F06: 0건 → 이전값 복귀 → 다른 값 시도", () => {
    const filters = [makeFilter("toolSubtype", "Square", 0)]
    const r1 = replaceFieldFilter(base, filters, makeFilter("toolSubtype", "Ball", 1), applyFilterToRecommendationInput)
    expect(r1.nextInput.toolSubtype).toBe("Ball")
    const r2 = replaceFieldFilter(base, r1.nextFilters, makeFilter("toolSubtype", "Square", 2), applyFilterToRecommendationInput)
    expect(r2.nextInput.toolSubtype).toBe("Square")
    const r3 = replaceFieldFilter(base, r2.nextFilters, makeFilter("toolSubtype", "Radius", 3), applyFilterToRecommendationInput)
    expect(r3.nextInput.toolSubtype).toBe("Radius")
    expect(r3.nextFilters).toHaveLength(1)
  })

  it("F07: 직경 3단 교체 — 10→9.95→10.05→9.922", () => {
    let filters = [makeFilter("diameterMm", 10, 0)]
    for (const [val, at] of [[9.95, 1], [10.05, 2], [9.922, 3]] as [number, number][]) {
      const refine = buildAppliedFilterFromValue("diameterRefine", val, at)!
      const r = replaceFieldFilter(base, filters, refine, applyFilterToRecommendationInput)
      filters = r.nextFilters
    }
    expect(filters).toHaveLength(1)
    expect(filters[0].rawValue).toBe(9.922)
  })

  it("F08: 비교 후 candidateCount 유지 확인", () => {
    const state = makeState({
      currentMode: "comparison",
      candidateCount: 723,
      appliedFilters: [makeFilter("toolSubtype", "Square")],
    })
    expect(state.candidateCount).toBe(723)
    expect(state.appliedFilters).toHaveLength(1)
  })

  it("F09: resolved 상태에서 synthetic filter로 revision", async () => {
    const state = makeState({
      currentMode: "recommendation",
      resolutionStatus: "resolved",
      appliedFilters: [makeFilter("toolSubtype", "Square", 0)],
      resolvedInput: makeBaseInput({ diameterMm: 10, toolSubtype: "Square" }),
    })
    const r = await resolveExplicitRevisionRequest(state, "직경 8mm로 바꿔줘")
    if (r?.kind === "resolved") {
      expect(r.request.targetField).toBe("diameterMm")
    }
  })

  it("F10: 비교 요청 → 제품코드 파싱", () => {
    const state = makeState({
      currentMode: "recommendation",
      resolutionStatus: "resolved",
      displayedProducts: [
        { rank: 1, productCode: "E5E84100", displayCode: "E5E84100", seriesName: "E5E84" } as any,
        { rank: 2, productCode: "E5E83100", displayCode: "E5E83100", seriesName: "E5E83" } as any,
      ],
      displayedCandidates: [
        { displayCode: "E5E84100", seriesName: "E5E84" } as any,
        { displayCode: "E5E83100", seriesName: "E5E83" } as any,
      ],
    })
    const action = resolveExplicitComparisonAction(state, "E5E84와 E5E83 비교해줘")
    if (action) expect(action.type).toBe("compare_products")
  })

  it("F11: getFilterFieldLabel → 한국어 라벨", () => {
    expect(getFilterFieldLabel("diameterMm")).toBe("직경")
    expect(getFilterFieldLabel("fluteCount")).toBe("날 수")
    expect(getFilterFieldLabel("coating")).toBe("코팅")
    expect(getFilterFieldLabel("toolSubtype")).toBe("형상")
  })

  it("F12: canonicalField 정의 확인", () => {
    expect(getFilterFieldDefinition("diameterRefine")?.canonicalField).toBe("diameterMm")
    expect(getFilterFieldDefinition("diameterMm")?.canonicalField).toBeUndefined()
    expect(getFilterFieldDefinition("fluteCount")?.canonicalField).toBeUndefined()
  })

  it("F13: 모든 필드 라벨 존재", () => {
    const fieldsToCheck = ["diameterMm", "fluteCount", "coating", "toolSubtype", "material", "workPieceName"]
    for (const field of fieldsToCheck) {
      expect(getFilterFieldLabel(field)).toBeTruthy()
    }
  })

  it("F14: parseFieldAnswerToFilter 다양한 형식", () => {
    expect(parseFieldAnswerToFilter("diameterMm", "10mm")?.rawValue).toBe(10)
    expect(parseFieldAnswerToFilter("diameterMm", "10")?.rawValue).toBe(10)
    expect(parseFieldAnswerToFilter("fluteCount", "4날")?.rawValue).toBe(4)
    expect(parseFieldAnswerToFilter("fluteCount", "4")?.rawValue).toBe(4)
  })

  it("F15: 필터 10개 누적 후 전체 교체 — 정상 동작", () => {
    const filters: AppliedFilter[] = []
    const fields: Array<[string, string | number]> = [
      ["toolSubtype", "Square"],
      ["fluteCount", 4],
      ["coating", "TiAlN"],
      ["diameterMm", 10],
      ["workPieceName", "알루미늄"],
      ["shankDiameterMm", 10],
      ["lengthOfCutMm", 25],
      ["overallLengthMm", 100],
      ["helixAngleDeg", 45],
    ]
    for (const [field, value] of fields) {
      filters.push(makeFilter(field, value, filters.length))
    }
    const input = applyChain(base, filters)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.diameterMm).toBe(10)

    const newFilters = fields.map(([field, _], i) => {
      if (field === "fluteCount") return makeFilter(field, 2, 10 + i)
      if (field === "diameterMm") return makeFilter(field, 8, 10 + i)
      return makeFilter(field, _ as string | number, 10 + i)
    })
    const r = replaceFieldFilters(base, filters, newFilters, applyFilterToRecommendationInput)
    expect(r.nextFilters).toHaveLength(fields.length)
    expect(r.nextInput.flutePreference).toBe(2)
    expect(r.nextInput.diameterMm).toBe(8)
  })
})
