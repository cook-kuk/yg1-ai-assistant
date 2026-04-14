import { describe, expect, it } from "vitest"

import { resolvePendingQuestionReply, resolveExplicitRevisionRequest } from "../serve-engine-runtime"
import { applyFilterToRecommendationInput, buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput, DisplayedOption } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "conv-sim",
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

function doReplace(base: RecommendationInput, filters: AppliedFilter[], next: AppliedFilter) {
  return replaceFieldFilter(base, filters, next, applyFilterToRecommendationInput)
}

// ═══════════════════════════════════════════════════════════════
// Scenario 1: Milling 기본 추천 흐름
// ═══════════════════════════════════════════════════════════════
describe("Scenario 1: Milling 기본 추천 흐름", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []
  let state = makeState()

  it("S1-T01: intake — diameterMm 10 설정", () => {
    const f = makeFilter("diameterMm", 10, 1)
    filters = [f]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
    state = makeState({ resolvedInput: input, appliedFilters: filters, turnCount: 1 })
  })

  it("S1-T02: toolSubtype → Square 선택", () => {
    state = makeState({ ...state, lastAskedField: "toolSubtype", displayedOptions: makeOptions("toolSubtype", [
      { label: "Square (50개)", value: "Square", count: 50 },
      { label: "Ball (30개)", value: "Ball", count: 30 },
    ]) })
    const res = resolvePendingQuestionReply(state, "Square")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.toolSubtype).toBe("Square")
    }
  })

  it("S1-T03: fluteCount → 4날 선택", () => {
    state = makeState({ ...state, resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 3,
      displayedOptions: makeOptions("fluteCount", [
        { label: "2날 (20개)", value: "2", count: 20 },
        { label: "4날 (30개)", value: "4", count: 30 },
      ]) })
    const res = resolvePendingQuestionReply(state, "4날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.flutePreference).toBe(4)
    }
  })

  it("S1-T04: coating → TiAlN 선택", () => {
    state = makeState({ ...state, resolvedInput: input, appliedFilters: filters, lastAskedField: "coating", turnCount: 4,
      displayedOptions: makeOptions("coating", [
        { label: "TiAlN (40개)", value: "TiAlN", count: 40 },
        { label: "AlCrN (10개)", value: "AlCrN", count: 10 },
      ]) })
    const res = resolvePendingQuestionReply(state, "TiAlN")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.coatingPreference).toBe("TiAlN")
    }
  })

  it("S1-T05: 추천 완료 후 resolved 상태 — pending 없음", () => {
    state = makeState({ ...state, resolvedInput: input, appliedFilters: filters, resolutionStatus: "resolved_exact", lastAskedField: undefined, turnCount: 5 })
    const res = resolvePendingQuestionReply(state, "비교해줘")
    expect(res.kind).toBe("none")
  })

  it("S1-T06: 비교 요청 → side question 아님 (resolved 상태)", () => {
    // resolved 상태에서는 pending 없으므로 none
    const res = resolvePendingQuestionReply(state, "1번이랑 2번 비교해줘")
    expect(res.kind).toBe("none")
  })

  it("S1-T07: 직경 변경 → 12mm로 교체", () => {
    const newF = makeFilter("diameterMm", 12, 7)
    const r = doReplace(makeBaseInput(), filters, newF)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.diameterMm).toBe(12)
    // toolSubtype, fluteCount, coating 유지
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S1-T08: material → 일반강 추가", () => {
    const f = makeFilter("material", "일반강", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("일반강")
    expect(r.replacedExisting).toBe(false)
  })

  it("S1-T09: cuttingType skip", () => {
    const f = makeSkipFilter("cuttingType", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.operationType).toBeUndefined()
  })

  it("S1-T10: 최종 상태 — 모든 필터 누적 확인", () => {
    expect(filters.length).toBeGreaterThanOrEqual(5)
    expect(input.diameterMm).toBe(12)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("일반강")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 2: Holemaking 기본 흐름
// ═══════════════════════════════════════════════════════════════
describe("Scenario 2: Holemaking 기본 추천 흐름", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []
  let state = makeState()

  it("S2-T01: diameterMm 6.5 설정", () => {
    const f = makeFilter("diameterMm", 6.5, 1)
    filters = [f]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(6.5)
  })

  it("S2-T02: material → 스테인리스", () => {
    const f = makeFilter("material", "스테인리스", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("스테인리스")
  })

  it("S2-T03: fluteCount → 2날", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 3,
      displayedOptions: makeOptions("fluteCount", [
        { label: "2날", value: "2", count: 15 },
        { label: "3날", value: "3", count: 10 },
      ]) })
    const res = resolvePendingQuestionReply(state, "2날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.flutePreference).toBe(2)
    }
  })

  it("S2-T04: coating → AlCrN", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "coating", turnCount: 4,
      displayedOptions: makeOptions("coating", [
        { label: "AlCrN", value: "AlCrN", count: 8 },
      ]) })
    const res = resolvePendingQuestionReply(state, "AlCrN")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.coatingPreference).toBe("AlCrN")
    }
  })

  it("S2-T05: coolantHole → true", () => {
    const f = buildAppliedFilterFromValue("coolantHole", "true", 5)
    expect(f).not.toBeNull()
    if (f) {
      const r = doReplace(makeBaseInput(), filters, f)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.coolantHole).toBe(true)
    }
  })

  it("S2-T06: toolSubtype skip", () => {
    const f = makeSkipFilter("toolSubtype", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.toolSubtype).toBeUndefined()
  })

  it("S2-T07: diameterMm 변경 → 7.0", () => {
    const newF = makeFilter("diameterMm", 7.0, 7)
    const r = doReplace(makeBaseInput(), filters, newF)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.diameterMm).toBe(7)
    expect(input.material).toBe("스테인리스")
  })

  it("S2-T08: material 변경 → 알루미늄", () => {
    const f = makeFilter("material", "알루미늄", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("알루미늄")
  })

  it("S2-T09: workPieceName → ADC12 추가", () => {
    const f = makeFilter("workPieceName", "ADC12", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S2-T10: 최종 상태 검증", () => {
    expect(input.diameterMm).toBe(7)
    expect(input.material).toBe("알루미늄")
    expect(input.workPieceName).toBe("ADC12")
    expect(input.flutePreference).toBe(2)
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.coolantHole).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 3: Threading 기본 흐름 — 대직경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 3: Threading 기본 흐름 — 대직경", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []
  let state = makeState()

  it("S3-T01: diameterMm 20 설정", () => {
    const f = makeFilter("diameterMm", 20, 1)
    filters = [f]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(20)
  })

  it("S3-T02: material → 주철", () => {
    const f = makeFilter("material", "주철", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("주철")
  })

  it("S3-T03: toolSubtype → Radius 선택", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "toolSubtype", turnCount: 3,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Radius (20개)", value: "Radius", count: 20 },
        { label: "Square (15개)", value: "Square", count: 15 },
      ]) })
    const res = resolvePendingQuestionReply(state, "Radius")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.toolSubtype).toBe("Radius")
    }
  })

  it("S3-T04: fluteCount → 6날", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 4,
      displayedOptions: makeOptions("fluteCount", [{ label: "6날", value: "6", count: 5 }]) })
    const res = resolvePendingQuestionReply(state, "6날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.flutePreference).toBe(6)
    }
  })

  it("S3-T05: coating skip", () => {
    const f = makeSkipFilter("coating", 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S3-T06: cuttingType → roughing", () => {
    const f = makeFilter("cuttingType", "roughing", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.operationType).toBe("roughing")
  })

  it("S3-T07: resolved 상태 진입", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, resolutionStatus: "resolved_exact", turnCount: 7 })
    const res = resolvePendingQuestionReply(state, "ok")
    expect(res.kind).toBe("none")
  })

  it("S3-T08: 직경 변경 16mm", () => {
    const f = makeFilter("diameterMm", 16, 8)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.diameterMm).toBe(16)
    expect(input.toolSubtype).toBe("Radius")
  })

  it("S3-T09: fluteCount 변경 → 4날", () => {
    const f = makeFilter("fluteCount", 4, 9)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S3-T10: 최종 — 직경16, Radius, 4날, roughing, 주철", () => {
    expect(input.diameterMm).toBe(16)
    expect(input.toolSubtype).toBe("Radius")
    expect(input.flutePreference).toBe(4)
    expect(input.operationType).toBe("roughing")
    expect(input.material).toBe("주철")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 4: 소직경 Milling 기본 흐름
// ═══════════════════════════════════════════════════════════════
describe("Scenario 4: 소직경 Milling 기본 흐름", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []
  let state = makeState()

  it("S4-T01: diameterMm 1.5 설정", () => {
    const f = makeFilter("diameterMm", 1.5, 1)
    filters = [f]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(1.5)
  })

  it("S4-T02: material → 고경도강", () => {
    const f = makeFilter("material", "고경도강", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("고경도강")
  })

  it("S4-T03: toolSubtype → Ball", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "toolSubtype", turnCount: 3,
      displayedOptions: makeOptions("toolSubtype", [{ label: "Ball (40개)", value: "Ball", count: 40 }]) })
    const res = resolvePendingQuestionReply(state, "Ball")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.toolSubtype).toBe("Ball")
    }
  })

  it("S4-T04: fluteCount → 2날", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 4,
      displayedOptions: makeOptions("fluteCount", [{ label: "2날", value: "2", count: 25 }]) })
    const res = resolvePendingQuestionReply(state, "2날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.flutePreference).toBe(2)
    }
  })

  it("S4-T05: coating → DLC", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "coating", turnCount: 5,
      displayedOptions: makeOptions("coating", [{ label: "DLC", value: "DLC", count: 5 }]) })
    const res = resolvePendingQuestionReply(state, "DLC")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
      expect(input.coatingPreference).toBe("DLC")
    }
  })

  it("S4-T06: resolved 진입", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, resolutionStatus: "resolved_exact", turnCount: 6 })
    expect(resolvePendingQuestionReply(state, "ok").kind).toBe("none")
  })

  it("S4-T07: 직경 변경 → 2.0", () => {
    const f = makeFilter("diameterMm", 2.0, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.diameterMm).toBe(2)
    expect(input.toolSubtype).toBe("Ball")
  })

  it("S4-T08: coating 변경 → Bright", () => {
    const f = makeFilter("coating", "Bright", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.coatingPreference).toBe("Bright")
  })

  it("S4-T09: cuttingType → finishing", () => {
    const f = makeFilter("cuttingType", "finishing", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.operationType).toBe("finishing")
  })

  it("S4-T10: 최종 — 2mm, Ball, 2날, Bright, finishing, 고경도강", () => {
    expect(input.diameterMm).toBe(2)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(2)
    expect(input.coatingPreference).toBe("Bright")
    expect(input.operationType).toBe("finishing")
    expect(input.material).toBe("고경도강")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 5: 인치 입력 + 다양한 시작
// ═══════════════════════════════════════════════════════════════
describe("Scenario 5: 인치 직경 + 다양한 흐름", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []
  let state = makeState()

  it("S5-T01: diameterMm 8 설정", () => {
    const f = makeFilter("diameterMm", 8, 1)
    filters = [f]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(8)
  })

  it("S5-T02: material → 탄소강", () => {
    const f = makeFilter("material", "탄소강", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.material).toBe("탄소강")
  })

  it("S5-T03: toolSubtype → Square", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "toolSubtype", turnCount: 3,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 60 },
        { label: "Radius", value: "Radius", count: 30 },
      ]) })
    const res = resolvePendingQuestionReply(state, "Square")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
    }
    expect(input.toolSubtype).toBe("Square")
  })

  it("S5-T04: fluteCount → 3날", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 4,
      displayedOptions: makeOptions("fluteCount", [{ label: "3날", value: "3", count: 12 }]) })
    const res = resolvePendingQuestionReply(state, "3")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters
      input = r.nextInput
    }
    expect(input.flutePreference).toBe(3)
  })

  it("S5-T05: coating skip", () => {
    const f = makeSkipFilter("coating", 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S5-T06: resolved 상태", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, resolutionStatus: "resolved_exact", turnCount: 6 })
    expect(resolvePendingQuestionReply(state, "좋아").kind).toBe("none")
  })

  it("S5-T07: toolSubtype 변경 → Radius", () => {
    const f = makeFilter("toolSubtype", "Radius", 7)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.toolSubtype).toBe("Radius")
    expect(input.flutePreference).toBe(3)
  })

  it("S5-T08: fluteCount 변경 → 4날", () => {
    const f = makeFilter("fluteCount", 4, 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S5-T09: coating 추가 → TiAlN", () => {
    const f = makeFilter("coating", "TiAlN", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters
    input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S5-T10: 최종 — 8mm, Radius, 4날, TiAlN, 탄소강", () => {
    expect(input.diameterMm).toBe(8)
    expect(input.toolSubtype).toBe("Radius")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("탄소강")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 6: 조건 변경 폭풍 — toolSubtype 연쇄
// ═══════════════════════════════════════════════════════════════
describe("Scenario 6: toolSubtype 연쇄 변경", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S6-T01: Square 설정", () => {
    const f = makeFilter("toolSubtype", "Square", 1)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
  })

  it("S6-T02: Square → Ball", () => {
    const f = makeFilter("toolSubtype", "Ball", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
  })

  it("S6-T03: Ball → Radius", () => {
    const f = makeFilter("toolSubtype", "Radius", 3)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Radius")
  })

  it("S6-T04: 직경도 동시에 변경 → 8", () => {
    const f = makeFilter("diameterMm", 8, 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(8)
    expect(input.toolSubtype).toBe("Radius")
  })

  it("S6-T05: Radius → Square 복귀", () => {
    const f = makeFilter("toolSubtype", "Square", 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
    expect(input.diameterMm).toBe(8)
  })

  it("S6-T06: fluteCount 추가 2날", () => {
    const f = makeFilter("fluteCount", 2, 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S6-T07: fluteCount → 4날", () => {
    const f = makeFilter("fluteCount", 4, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S6-T08: fluteCount → 6날", () => {
    const f = makeFilter("fluteCount", 6, 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(6)
  })

  it("S6-T09: toolSubtype → Ball 다시", () => {
    const f = makeFilter("toolSubtype", "Ball", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(6)
  })

  it("S6-T10: 최종 — 8mm, Ball, 6날", () => {
    expect(input.diameterMm).toBe(8)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(6)
    expect(filters.filter(f => f.field === "toolSubtype").length).toBe(1) // 중복 없이 교체됨
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 7: coating 연쇄 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 7: coating 연쇄 변경", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S7-T01: TiAlN 설정", () => {
    const f = makeFilter("coating", "TiAlN", 1)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S7-T02: → AlCrN", () => {
    const f = makeFilter("coating", "AlCrN", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("S7-T03: → DLC", () => {
    const f = makeFilter("coating", "DLC", 3)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("DLC")
  })

  it("S7-T04: → Bright", () => {
    const f = makeFilter("coating", "Bright", 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("Bright")
  })

  it("S7-T05: → TiAlN 복귀", () => {
    const f = makeFilter("coating", "TiAlN", 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S7-T06: fluteCount 추가 4날", () => {
    const f = makeFilter("fluteCount", 4, 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S7-T07: coating → AlCrN (fluteCount 유지)", () => {
    const f = makeFilter("coating", "AlCrN", 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.flutePreference).toBe(4)
  })

  it("S7-T08: material 추가 → 일반강", () => {
    const f = makeFilter("material", "일반강", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("S7-T09: coating → DLC (material 유지)", () => {
    const f = makeFilter("coating", "DLC", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("DLC")
    expect(input.material).toBe("일반강")
  })

  it("S7-T10: 최종 — coating 단일 필터만 존재", () => {
    const coatingFilters = filters.filter(f => f.field === "coating")
    expect(coatingFilters.length).toBe(1)
    expect(coatingFilters[0].rawValue).toBe("DLC")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 8: 직경 연쇄 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 8: 직경 연쇄 변경", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S8-T01: 10mm 설정", () => {
    const f = makeFilter("diameterMm", 10, 1)
    filters = [f]; input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
  })

  it("S8-T02: → 8mm", () => {
    const f = makeFilter("diameterMm", 8, 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(8)
  })

  it("S8-T03: → 12mm", () => {
    const f = makeFilter("diameterMm", 12, 3)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(12)
  })

  it("S8-T04: → 6mm", () => {
    const f = makeFilter("diameterMm", 6, 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(6)
  })

  it("S8-T05: → 10mm 복귀", () => {
    const f = makeFilter("diameterMm", 10, 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10)
  })

  it("S8-T06: toolSubtype 추가 Square", () => {
    const f = makeFilter("toolSubtype", "Square", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
    expect(input.diameterMm).toBe(10)
  })

  it("S8-T07: 직경 → 14mm (toolSubtype 유지)", () => {
    const f = makeFilter("diameterMm", 14, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(14)
    expect(input.toolSubtype).toBe("Square")
  })

  it("S8-T08: fluteCount 추가 4날", () => {
    const f = makeFilter("fluteCount", 4, 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S8-T09: 직경 → 3mm (모든 다른 필터 유지)", () => {
    const f = makeFilter("diameterMm", 3, 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(3)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
  })

  it("S8-T10: diameterMm 필터 1개만 존재", () => {
    const diamFilters = filters.filter(f => f.field === "diameterMm")
    expect(diamFilters.length).toBe(1)
    expect(diamFilters[0].rawValue).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 9: fluteCount 연쇄 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 9: fluteCount 연쇄 변경", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S9-T01: 2날 설정", () => {
    const f = makeFilter("fluteCount", 2, 1)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S9-T02: → 4날", () => {
    const f = makeFilter("fluteCount", 4, 2)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S9-T03: → 6날", () => {
    const f = makeFilter("fluteCount", 6, 3)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(6)
  })

  it("S9-T04: → 3날", () => {
    const f = makeFilter("fluteCount", 3, 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(3)
  })

  it("S9-T05: → 2날 복귀", () => {
    const f = makeFilter("fluteCount", 2, 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S9-T06: coating 추가 TiAlN", () => {
    const f = makeFilter("coating", "TiAlN", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S9-T07: fluteCount → 5날 (coating 유지)", () => {
    const f = makeFilter("fluteCount", 5, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(5)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S9-T08: material 추가 → 스테인리스", () => {
    const f = makeFilter("material", "스테인리스", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("스테인리스")
  })

  it("S9-T09: fluteCount → 4날 (다른 모두 유지)", () => {
    const f = makeFilter("fluteCount", 4, 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("스테인리스")
    expect(input.diameterMm).toBe(10)
  })

  it("S9-T10: fluteCount 필터 1개만", () => {
    expect(filters.filter(f => f.field === "fluteCount").length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 10: 복합 변경 — 매 턴 2개씩
// ═══════════════════════════════════════════════════════════════
describe("Scenario 10: 복합 조건 변경", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S10-T01: diameterMm 10 + material 일반강 동시", () => {
    filters = [makeFilter("diameterMm", 10, 1), makeFilter("material", "일반강", 1)]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
    expect(input.material).toBe("일반강")
  })

  it("S10-T02: toolSubtype Square + fluteCount 4날 동시", () => {
    let f = makeFilter("toolSubtype", "Square", 2)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("fluteCount", 4, 2)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
  })

  it("S10-T03: diameter 변경 8 + toolSubtype Ball", () => {
    let f = makeFilter("diameterMm", 8, 3)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("toolSubtype", "Ball", 3)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(8)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(4) // 유지
  })

  it("S10-T04: coating TiAlN + cuttingType roughing", () => {
    let f = makeFilter("coating", "TiAlN", 4)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("cuttingType", "roughing", 4)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.operationType).toBe("roughing")
  })

  it("S10-T05: diameter 12 + material 스테인리스", () => {
    let f = makeFilter("diameterMm", 12, 5)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("material", "스테인리스", 5)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(12)
    expect(input.material).toBe("스테인리스")
  })

  it("S10-T06: toolSubtype → Radius + fluteCount → 2날", () => {
    let f = makeFilter("toolSubtype", "Radius", 6)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("fluteCount", 2, 6)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Radius")
    expect(input.flutePreference).toBe(2)
  })

  it("S10-T07: coating → AlCrN + cuttingType → finishing", () => {
    let f = makeFilter("coating", "AlCrN", 7)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("cuttingType", "finishing", 7)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.operationType).toBe("finishing")
  })

  it("S10-T08: diameter → 6 + toolSubtype → Square", () => {
    let f = makeFilter("diameterMm", 6, 8)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("toolSubtype", "Square", 8)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(6)
    expect(input.toolSubtype).toBe("Square")
  })

  it("S10-T09: material → 알루미늄 + fluteCount → 3날", () => {
    let f = makeFilter("material", "알루미늄", 9)
    let r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    f = makeFilter("fluteCount", 3, 9)
    r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
    expect(input.flutePreference).toBe(3)
  })

  it("S10-T10: 필터 중복 없음 확인", () => {
    const fieldCounts = new Map<string, number>()
    for (const f of filters) {
      fieldCounts.set(f.field, (fieldCounts.get(f.field) ?? 0) + 1)
    }
    for (const [field, count] of fieldCounts) {
      expect(count, `${field} should have exactly 1 filter`).toBe(1)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 11: side question 삽입 — 질문 감지
// ═══════════════════════════════════════════════════════════════
describe("Scenario 11: side question 삽입 — 질문 감지", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]
  let state = makeState({ resolvedInput: input, appliedFilters: filters })

  it("S11-T01: toolSubtype 질문 중 '이게 뭐야?' → side_question", () => {
    state = makeState({ ...state, lastAskedField: "toolSubtype", turnCount: 1,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 50 },
        { label: "Ball", value: "Ball", count: 30 },
      ]) })
    const res = resolvePendingQuestionReply(state, "이게 뭐야?")
    expect(res.kind).toBe("side_question")
  })

  it("S11-T02: side question 후 Square 답변 → resolved", () => {
    const res = resolvePendingQuestionReply(state, "Square")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.toolSubtype).toBe("Square")
  })

  it("S11-T03: fluteCount 질문 중 '설명해줘' → side_question", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 3,
      displayedOptions: makeOptions("fluteCount", [
        { label: "2날", value: "2", count: 20 },
        { label: "4날", value: "4", count: 30 },
      ]) })
    const res = resolvePendingQuestionReply(state, "날수 차이가 뭐야")
    expect(res.kind).toBe("side_question")
  })

  it("S11-T04: side question 후 4날 답변 → resolved", () => {
    const res = resolvePendingQuestionReply(state, "4날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.flutePreference).toBe(4)
  })

  it("S11-T05: coating 질문 → 정상 TiAlN 답변", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "coating", turnCount: 5,
      displayedOptions: makeOptions("coating", [
        { label: "TiAlN", value: "TiAlN", count: 25 },
      ]) })
    const res = resolvePendingQuestionReply(state, "TiAlN")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
  })

  it("S11-T06: 필터 보존 확인 — side question이 필터 손상 안 함", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S11-T07: material 질문 중 '재고 있어?' → side_question", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "material", turnCount: 7,
      displayedOptions: makeOptions("material", [
        { label: "일반강", value: "일반강", count: 20 },
        { label: "스테인리스", value: "스테인리스", count: 15 },
      ]) })
    const res = resolvePendingQuestionReply(state, "재고 있어?")
    expect(res.kind).toBe("side_question")
  })

  it("S11-T08: side question 후 일반강 답변", () => {
    const res = resolvePendingQuestionReply(state, "일반강")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.material).toBe("일반강")
  })

  it("S11-T09: '가격이 얼마야' → side_question", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "workPieceName", turnCount: 9,
      displayedOptions: [] })
    const res = resolvePendingQuestionReply(state, "가격 알려줘")
    expect(res.kind).toBe("side_question")
  })

  it("S11-T10: 모든 필터 보존 최종 확인", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("일반강")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 12: side question — 물음표 감지
// ═══════════════════════════════════════════════════════════════
describe("Scenario 12: 물음표 기반 side question 감지", () => {
  let state = makeState({ lastAskedField: "coating", turnCount: 1,
    displayedOptions: makeOptions("coating", [
      { label: "TiAlN", value: "TiAlN", count: 40 },
      { label: "AlCrN", value: "AlCrN", count: 20 },
    ]) })

  it("S12-T01: '코팅이 뭔가요?' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "코팅이 뭔가요?").kind).toBe("side_question")
  })

  it("S12-T02: '어떤 게 좋아요?' → side_question (물음표)", () => {
    expect(resolvePendingQuestionReply(state, "어떤 게 좋아요?").kind).toBe("side_question")
  })

  it("S12-T03: 'TiAlN이 뭐야?' → side_question (물음표)", () => {
    expect(resolvePendingQuestionReply(state, "TiAlN이 뭐야?").kind).toBe("side_question")
  })

  it("S12-T04: 'TiAlN' → resolved (물음표 없음)", () => {
    const res = resolvePendingQuestionReply(state, "TiAlN")
    expect(res.kind).toBe("resolved")
  })

  it("S12-T05: 'AlCrN' → resolved", () => {
    const res = resolvePendingQuestionReply(state, "AlCrN")
    expect(res.kind).toBe("resolved")
  })

  it("S12-T06: 빈 문자열 → none", () => {
    expect(resolvePendingQuestionReply(state, "").kind).toBe("none")
  })

  it("S12-T07: null → none", () => {
    expect(resolvePendingQuestionReply(state, null).kind).toBe("none")
  })

  it("S12-T08: '비교해줘' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "비교해줘").kind).toBe("side_question")
  })

  it("S12-T09: sessionState null → none", () => {
    expect(resolvePendingQuestionReply(null, "TiAlN").kind).toBe("none")
  })

  it("S12-T10: resolved 상태 → none", () => {
    const resolvedState = makeState({ ...state, resolutionStatus: "resolved_exact" })
    expect(resolvePendingQuestionReply(resolvedState, "TiAlN").kind).toBe("none")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 13: side question — 긴 텍스트 감지
// ═══════════════════════════════════════════════════════════════
describe("Scenario 13: 긴 텍스트 unresolved 감지", () => {
  const state = makeState({ lastAskedField: "toolSubtype", turnCount: 1,
    displayedOptions: makeOptions("toolSubtype", [{ label: "Square", value: "Square", count: 50 }]) })

  it("S13-T01: 81자 이상 텍스트 → unresolved", () => {
    const longText = "이 공구는 어떤 소재에 적합한지 그리고 가공 조건은 어떻게 되는지 자세하게 알려주세요 부탁드립니다 정말로 궁금합니다 제발요 상세히 부탁해요 급해요 빨리 좀 알려주세요요"
    expect(longText.length).toBeGreaterThan(80)
    const res = resolvePendingQuestionReply(state, longText)
    expect(res.kind).toBe("unresolved")
  })

  it("S13-T02: 정확히 80자 이하 → 처리 가능", () => {
    const text = "Square"
    expect(text.length).toBeLessThanOrEqual(80)
    expect(resolvePendingQuestionReply(state, text).kind).toBe("resolved")
  })

  it("S13-T03: 제품 코드 + 추가 텍스트 → side_question", () => {
    const res = resolvePendingQuestionReply(state, "G8A59080의 재고 수")
    expect(res.kind).toBe("side_question")
  })

  it("S13-T04: 제품 코드만 → 처리 시도 (side_question 아님)", () => {
    // 제품 코드만 있으면 side_question이 아닌 다른 결과
    const res = resolvePendingQuestionReply(state, "G8A59080")
    expect(res.kind).not.toBe("side_question")
  })

  it("S13-T05: '추천해줘' → resolved (위임 표현 → skip)", () => {
    const res = resolvePendingQuestionReply(state, "추천해줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      expect(res.filter.op).toBe("skip")
    }
  })

  it("S13-T06: '알아서 해줘' → resolved (위임)", () => {
    const res = resolvePendingQuestionReply(state, "알아서 해줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      expect(res.filter.op).toBe("skip")
    }
  })

  it("S13-T07: '아무거나 한개 골라줘' → resolved (위임)", () => {
    const res = resolvePendingQuestionReply(state, "아무거나 한개 골라줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      expect(res.filter.op).toBe("skip")
    }
  })

  it("S13-T08: '종류가 뭐가 있어' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "종류가 뭐가 있어").kind).toBe("side_question")
  })

  it("S13-T09: '처음부터 다시' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "처음부터 다시").kind).toBe("side_question")
  })

  it("S13-T10: '회사 정보' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "회사 정보 알려줘").kind).toBe("side_question")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 14: side question 후 흐름 복귀
// ═══════════════════════════════════════════════════════════════
describe("Scenario 14: side question 연속 후 흐름 복귀", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]
  let state = makeState()

  it("S14-T01: toolSubtype 질문 시작", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "toolSubtype", turnCount: 1,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 50 },
        { label: "Ball", value: "Ball", count: 30 },
      ]) })
    expect(state.lastAskedField).toBe("toolSubtype")
  })

  it("S14-T02: side question 1 — '뭐가 달라?'", () => {
    expect(resolvePendingQuestionReply(state, "뭐가 달라?").kind).toBe("side_question")
  })

  it("S14-T03: side question 2 — '어디서 쓰여?'", () => {
    expect(resolvePendingQuestionReply(state, "어디서 쓰여?").kind).toBe("side_question")
  })

  it("S14-T04: side question 3 — '카탈로그 있어?'", () => {
    expect(resolvePendingQuestionReply(state, "카탈로그 있어?").kind).toBe("side_question")
  })

  it("S14-T05: 답변 — 'Square' → resolved", () => {
    const res = resolvePendingQuestionReply(state, "Square")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.toolSubtype).toBe("Square")
  })

  it("S14-T06: fluteCount 질문", () => {
    state = makeState({ resolvedInput: input, appliedFilters: filters, lastAskedField: "fluteCount", turnCount: 6,
      displayedOptions: makeOptions("fluteCount", [{ label: "4날", value: "4", count: 25 }]) })
    expect(state.lastAskedField).toBe("fluteCount")
  })

  it("S14-T07: side question — '납기 어때?'", () => {
    expect(resolvePendingQuestionReply(state, "납기 어때?").kind).toBe("side_question")
  })

  it("S14-T08: 답변 — '4날' → resolved", () => {
    const res = resolvePendingQuestionReply(state, "4날")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.flutePreference).toBe(4)
  })

  it("S14-T09: 모든 필터 보존", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
  })

  it("S14-T10: filters 배열 정합성", () => {
    expect(filters.some(f => f.field === "diameterMm")).toBe(true)
    expect(filters.some(f => f.field === "toolSubtype")).toBe(true)
    expect(filters.some(f => f.field === "fluteCount")).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 15: side question 다양한 패턴
// ═══════════════════════════════════════════════════════════════
describe("Scenario 15: side question 다양한 패턴", () => {
  const state = makeState({ lastAskedField: "fluteCount", turnCount: 1,
    displayedOptions: makeOptions("fluteCount", [
      { label: "2날", value: "2", count: 20 },
      { label: "4날", value: "4", count: 30 },
    ]) })

  it("S15-T01: '영업소 번호' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "영업소 번호 알려줘").kind).toBe("side_question")
  })

  it("S15-T02: '해외 공장' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "해외 공장 어디야").kind).toBe("side_question")
  })

  it("S15-T03: '배송 기간' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "배송 기간 알려줘").kind).toBe("side_question")
  })

  it("S15-T04: 'lead time' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "lead time 알려줘").kind).toBe("side_question")
  })

  it("S15-T05: '결과 보여줘' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "결과 보여줘").kind).toBe("side_question")
  })

  it("S15-T06: '이전 단계로' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "이전 단계로").kind).toBe("side_question")
  })

  it("S15-T07: '적합한 거 알려줘' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "적합한 거 알려줘").kind).toBe("side_question")
  })

  it("S15-T08: '스펙 알려줘' → side_question", () => {
    expect(resolvePendingQuestionReply(state, "스펙 알려줘").kind).toBe("side_question")
  })

  it("S15-T09: '2날' → resolved (정상 답변)", () => {
    expect(resolvePendingQuestionReply(state, "2날").kind).toBe("resolved")
  })

  it("S15-T10: '4날' → resolved (정상 답변)", () => {
    expect(resolvePendingQuestionReply(state, "4날").kind).toBe("resolved")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 16: 전체 skip → 되돌리기
// ═══════════════════════════════════════════════════════════════
describe("Scenario 16: 전체 skip 후 하나씩 값 지정", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S16-T01: toolSubtype skip", () => {
    const f = makeSkipFilter("toolSubtype", 1)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBeUndefined()
  })

  it("S16-T02: fluteCount skip", () => {
    const f = makeSkipFilter("fluteCount", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBeUndefined()
  })

  it("S16-T03: coating skip", () => {
    const f = makeSkipFilter("coating", 3)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S16-T04: material skip", () => {
    const f = makeSkipFilter("material", 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBeUndefined()
  })

  it("S16-T05: 모든 skip 적용 후 diameterMm만 유지", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBeUndefined()
    expect(input.flutePreference).toBeUndefined()
    expect(input.coatingPreference).toBeUndefined()
    expect(input.material).toBeUndefined()
  })

  it("S16-T06: toolSubtype skip → Square로 변경", () => {
    const f = makeFilter("toolSubtype", "Square", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
  })

  it("S16-T07: fluteCount skip → 4날로 변경", () => {
    const f = makeFilter("fluteCount", 4, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S16-T08: coating skip → TiAlN으로 변경", () => {
    const f = makeFilter("coating", "TiAlN", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S16-T09: material skip → 일반강으로 변경", () => {
    const f = makeFilter("material", "일반강", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
  })

  it("S16-T10: 최종 — 모든 skip 교체됨", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("일반강")
    // skip 필터는 모두 교체되어 남아있지 않아야 함
    const skipFilters = filters.filter(f => f.op === "skip")
    expect(skipFilters.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 17: skip 교차 패턴
// ═══════════════════════════════════════════════════════════════
describe("Scenario 17: skip ↔ 값 교차 패턴", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S17-T01: toolSubtype → Square", () => {
    const f = makeFilter("toolSubtype", "Square", 1)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
  })

  it("S17-T02: toolSubtype → skip (Square 제거)", () => {
    const f = makeSkipFilter("toolSubtype", 2)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBeUndefined()
  })

  it("S17-T03: toolSubtype → Ball (skip 교체)", () => {
    const f = makeFilter("toolSubtype", "Ball", 3)
    const r = doReplace(makeBaseInput(), filters, f)
    expect(r.replacedExisting).toBe(true)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
  })

  it("S17-T04: fluteCount → 4날", () => {
    const f = makeFilter("fluteCount", 4, 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S17-T05: fluteCount → skip", () => {
    const f = makeSkipFilter("fluteCount", 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBeUndefined()
  })

  it("S17-T06: fluteCount → 2날 (skip 교체)", () => {
    const f = makeFilter("fluteCount", 2, 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S17-T07: coating → TiAlN", () => {
    const f = makeFilter("coating", "TiAlN", 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S17-T08: coating → skip", () => {
    const f = makeSkipFilter("coating", 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S17-T09: coating → AlCrN", () => {
    const f = makeFilter("coating", "AlCrN", 9)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("S17-T10: 최종 — skip 없이 모든 값 설정됨", () => {
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(2)
    expect(input.coatingPreference).toBe("AlCrN")
    const skipFilters = filters.filter(f => f.op === "skip")
    expect(skipFilters.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 18: skip via 위임 표현 (pending question)
// ═══════════════════════════════════════════════════════════════
describe("Scenario 18: 위임 표현으로 skip 처리", () => {
  const makeFieldState = (field: string) => makeState({
    lastAskedField: field, turnCount: 1,
    displayedOptions: makeOptions(field, [{ label: "opt1", value: "opt1", count: 10 }]),
  })

  it("S18-T01: toolSubtype — '추천해줘' → skip", () => {
    const res = resolvePendingQuestionReply(makeFieldState("toolSubtype"), "추천해줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") expect(res.filter.op).toBe("skip")
  })

  it("S18-T02: fluteCount — '골라줘' → skip", () => {
    const res = resolvePendingQuestionReply(makeFieldState("fluteCount"), "골라줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") expect(res.filter.op).toBe("skip")
  })

  it("S18-T03: coating — '알아서 해줘' → skip", () => {
    const res = resolvePendingQuestionReply(makeFieldState("coating"), "알아서 해줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") expect(res.filter.op).toBe("skip")
  })

  it("S18-T04: material — '너가 골라줘' → skip", () => {
    const res = resolvePendingQuestionReply(makeFieldState("material"), "너가 골라줘")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") expect(res.filter.op).toBe("skip")
  })

  it("S18-T05: '아무거나 한개' → skip", () => {
    const res = resolvePendingQuestionReply(makeFieldState("toolSubtype"), "아무거나 한개")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") expect(res.filter.op).toBe("skip")
  })

  it("S18-T06: skip 필터를 적용하면 해당 input 필드 클리어", () => {
    const skipF = makeSkipFilter("toolSubtype", 1)
    const input = applyFilterToRecommendationInput(makeBaseInput({ toolSubtype: "Square" }), skipF)
    expect(input.toolSubtype).toBeUndefined()
  })

  it("S18-T07: skip 필터 fluteCount 적용", () => {
    const skipF = makeSkipFilter("fluteCount", 1)
    const input = applyFilterToRecommendationInput(makeBaseInput({ flutePreference: 4 }), skipF)
    expect(input.flutePreference).toBeUndefined()
  })

  it("S18-T08: skip 필터 coating 적용", () => {
    const skipF = makeSkipFilter("coating", 1)
    const input = applyFilterToRecommendationInput(makeBaseInput({ coatingPreference: "TiAlN" }), skipF)
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S18-T09: skip 필터 material 적용", () => {
    const skipF = makeSkipFilter("material", 1)
    const input = applyFilterToRecommendationInput(makeBaseInput({ material: "일반강" }), skipF)
    expect(input.material).toBeUndefined()
  })

  it("S18-T10: skip은 다른 필드에 영향 없음", () => {
    const base = makeBaseInput({ diameterMm: 10, toolSubtype: "Square", flutePreference: 4 })
    const input = applyFilterToRecommendationInput(base, makeSkipFilter("toolSubtype", 1))
    expect(input.diameterMm).toBe(10)
    expect(input.flutePreference).toBe(4)
    expect(input.toolSubtype).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 19: skip 후 diameterRefine 활용
// ═══════════════════════════════════════════════════════════════
describe("Scenario 19: skip 후 diameterRefine 교체", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S19-T01: diameterMm 10 설정", () => {
    filters = [makeFilter("diameterMm", 10, 1)]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
  })

  it("S19-T02: toolSubtype skip", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("toolSubtype", 2))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S19-T03: fluteCount skip", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("fluteCount", 3))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S19-T04: diameterRefine → 9.95", () => {
    const f = makeFilter("diameterRefine", 9.95, 4)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(9.95)
  })

  it("S19-T05: diameterRefine → 10.05", () => {
    const f = makeFilter("diameterRefine", 10.05, 5)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10.05)
  })

  it("S19-T06: toolSubtype skip → Ball 지정", () => {
    const f = makeFilter("toolSubtype", "Ball", 6)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
    expect(input.diameterMm).toBe(10.05)
  })

  it("S19-T07: fluteCount skip → 2날 지정", () => {
    const f = makeFilter("fluteCount", 2, 7)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S19-T08: diameterRefine → 10.0 (원래 직경 복귀)", () => {
    const f = makeFilter("diameterRefine", 10.0, 8)
    const r = doReplace(makeBaseInput(), filters, f)
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10)
  })

  it("S19-T09: toolSubtype + fluteCount 유지 확인", () => {
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(2)
  })

  it("S19-T10: diameterMm 필터 교체 정합성", () => {
    // diameterRefine은 diameterMm의 canonical이므로 하나만 있어야
    const diamFilters = filters.filter(f => f.field === "diameterMm" || f.field === "diameterRefine")
    expect(diamFilters.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 20: 복합 skip + 되돌리기
// ═══════════════════════════════════════════════════════════════
describe("Scenario 20: 복합 skip + 값 복원", () => {
  let input = makeBaseInput({ diameterMm: 12 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 12, 0)]

  it("S20-T01: toolSubtype → Square", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 1))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
  })

  it("S20-T02: fluteCount → 4날", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 4, 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S20-T03: coating → TiAlN", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "TiAlN", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S20-T04: toolSubtype → skip", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("toolSubtype", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBeUndefined()
    expect(input.flutePreference).toBe(4) // 다른 필드 유지
  })

  it("S20-T05: fluteCount → skip", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("fluteCount", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBeUndefined()
    expect(input.coatingPreference).toBe("TiAlN") // 유지
  })

  it("S20-T06: toolSubtype → Radius (skip 복원)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Radius", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Radius")
  })

  it("S20-T07: fluteCount → 6날 (skip 복원)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 6, 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(6)
  })

  it("S20-T08: coating → skip 후 → DLC", () => {
    let r = doReplace(makeBaseInput(), filters, makeSkipFilter("coating", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
    r = doReplace(makeBaseInput(), filters, makeFilter("coating", "DLC", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("DLC")
  })

  it("S20-T09: 최종 — 모든 skip 복원됨", () => {
    expect(input.toolSubtype).toBe("Radius")
    expect(input.flutePreference).toBe(6)
    expect(input.coatingPreference).toBe("DLC")
    expect(input.diameterMm).toBe(12)
  })

  it("S20-T10: skip 필터 잔여 없음", () => {
    expect(filters.filter(f => f.op === "skip").length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 21: 알루미늄+ADC12 → 주철 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 21: material 변경 시 workPieceName 독립성", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S21-T01: material → 알루미늄", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "알루미늄", 1))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
  })

  it("S21-T02: workPieceName → ADC12", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "ADC12", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S21-T03: toolSubtype → Square (material/workPieceName 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
    expect(input.workPieceName).toBe("ADC12")
    expect(input.toolSubtype).toBe("Square")
  })

  it("S21-T04: material → 주철 변경 (workPieceName은 필터 교체로 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "주철", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("주철")
    // workPieceName 필터는 여전히 filters에 있음
    expect(filters.some(f => f.field === "workPieceName")).toBe(true)
  })

  it("S21-T05: workPieceName 수동 클리어 (skip)", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("workPieceName", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBeUndefined()
    expect(input.material).toBe("주철")
  })

  it("S21-T06: workPieceName → FC250 (주철 하위)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "FC250", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("FC250")
  })

  it("S21-T07: 다른 필드 유지 확인", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
  })

  it("S21-T08: material → 스테인리스 변경", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "스테인리스", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("스테인리스")
  })

  it("S21-T09: workPieceName → SUS304", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "SUS304", 9))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("SUS304")
  })

  it("S21-T10: 최종 — 스테인리스 + SUS304 + Square", () => {
    expect(input.material).toBe("스테인리스")
    expect(input.workPieceName).toBe("SUS304")
    expect(input.toolSubtype).toBe("Square")
    expect(input.diameterMm).toBe(10)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 22: material 연쇄 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 22: material 연쇄 변경 — 다른 필터 유지", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S22-T01: toolSubtype → Square", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 1))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S22-T02: fluteCount → 4날", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 4, 2))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S22-T03: material → 일반강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "일반강", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
  })

  it("S22-T04: material → 스테인리스 (toolSubtype/fluteCount 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "스테인리스", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("스테인리스")
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
  })

  it("S22-T05: material → 탄소강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "탄소강", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("탄소강")
  })

  it("S22-T06: material → 고경도강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "고경도강", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("고경도강")
  })

  it("S22-T07: material → 알루미늄", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "알루미늄", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
  })

  it("S22-T08: 모든 변경 후 toolSubtype 유지", () => {
    expect(input.toolSubtype).toBe("Square")
  })

  it("S22-T09: 모든 변경 후 fluteCount 유지", () => {
    expect(input.flutePreference).toBe(4)
  })

  it("S22-T10: material 필터 1개만 존재", () => {
    expect(filters.filter(f => f.field === "material").length).toBe(1)
    expect(filters.filter(f => f.field === "material")[0].rawValue).toBe("알루미늄")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 23: workPieceName 연쇄 변경 (material 유지)
// ═══════════════════════════════════════════════════════════════
describe("Scenario 23: workPieceName 연쇄 변경", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0), makeFilter("material", "알루미늄", 0)]

  it("S23-T01: workPieceName → ADC12", () => {
    input = applyChain(makeBaseInput(), filters)
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "ADC12", 1))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S23-T02: → A5052", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "A5052", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("A5052")
  })

  it("S23-T03: → A7075", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "A7075", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("A7075")
  })

  it("S23-T04: material 유지 확인", () => {
    expect(input.material).toBe("알루미늄")
  })

  it("S23-T05: diameterMm 유지 확인", () => {
    expect(input.diameterMm).toBe(10)
  })

  it("S23-T06: workPieceName skip → 클리어", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("workPieceName", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBeUndefined()
    expect(input.material).toBe("알루미늄")
  })

  it("S23-T07: workPieceName → ADC12 다시", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "ADC12", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S23-T08: toolSubtype 추가 — workPieceName 유지", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S23-T09: coating 추가 — workPieceName 유지", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "DLC", 9))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("ADC12")
  })

  it("S23-T10: workPieceName 필터 1개만", () => {
    expect(filters.filter(f => f.field === "workPieceName").length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 24: material + workPieceName 동시 관리
// ═══════════════════════════════════════════════════════════════
describe("Scenario 24: material + workPieceName 동시 관리", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S24-T01: diameterMm 12 설정", () => {
    filters = [makeFilter("diameterMm", 12, 1)]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(12)
  })

  it("S24-T02: material → 일반강, workPieceName → S45C", () => {
    let r = doReplace(makeBaseInput(), filters, makeFilter("material", "일반강", 2))
    filters = r.nextFilters; input = r.nextInput
    r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "S45C", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
    expect(input.workPieceName).toBe("S45C")
  })

  it("S24-T03: material → 스테인리스, workPieceName 유지 (필터 레벨)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "스테인리스", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("스테인리스")
    expect(filters.some(f => f.field === "workPieceName")).toBe(true)
  })

  it("S24-T04: workPieceName → SUS316", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "SUS316", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("SUS316")
  })

  it("S24-T05: material → 주철, workPieceName skip", () => {
    let r = doReplace(makeBaseInput(), filters, makeFilter("material", "주철", 5))
    filters = r.nextFilters; input = r.nextInput
    r = doReplace(makeBaseInput(), filters, makeSkipFilter("workPieceName", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("주철")
    expect(input.workPieceName).toBeUndefined()
  })

  it("S24-T06: workPieceName → FC200", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "FC200", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("FC200")
  })

  it("S24-T07: material → 고경도강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "고경도강", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("고경도강")
  })

  it("S24-T08: workPieceName → SKD11", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "SKD11", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.workPieceName).toBe("SKD11")
  })

  it("S24-T09: material → 탄소강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "탄소강", 9))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("탄소강")
  })

  it("S24-T10: 최종 — material/workPieceName 각 1개씩", () => {
    expect(filters.filter(f => f.field === "material").length).toBe(1)
    expect(filters.filter(f => f.field === "workPieceName").length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 25: material 변경 후 다른 필드 보존 집중 테스트
// ═══════════════════════════════════════════════════════════════
describe("Scenario 25: material 변경 시 비관련 필드 보존", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S25-T01: 초기 5개 필터 설정", () => {
    filters = [
      makeFilter("diameterMm", 10, 1),
      makeFilter("toolSubtype", "Square", 1),
      makeFilter("fluteCount", 4, 1),
      makeFilter("coating", "TiAlN", 1),
      makeFilter("material", "일반강", 1),
    ]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.material).toBe("일반강")
  })

  it("S25-T02: material → 스테인리스 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "스테인리스", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("스테인리스")
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S25-T03: material → 주철 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "주철", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("주철")
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S25-T04: material → 알루미늄 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "알루미늄", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
  })

  it("S25-T05: material → 고경도강 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "고경도강", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("고경도강")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S25-T06: material → 탄소강 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "탄소강", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("탄소강")
    expect(input.diameterMm).toBe(10)
  })

  it("S25-T07: material → 티타늄 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "티타늄", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("티타늄")
    expect(input.toolSubtype).toBe("Square")
  })

  it("S25-T08: material → 일반강 복귀 (나머지 4개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "일반강", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S25-T09: material 필터 1개만 존재", () => {
    expect(filters.filter(f => f.field === "material").length).toBe(1)
  })

  it("S25-T10: 총 필터 5개 정확히", () => {
    expect(filters.length).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 26: 10개 필터 동시 적용 후 변경
// ═══════════════════════════════════════════════════════════════
describe("Scenario 26: 10개 필터 동시 적용 후 하나씩 변경", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S26-T01: 6개 필터 초기 설정", () => {
    filters = [
      makeFilter("diameterMm", 10, 1),
      makeFilter("toolSubtype", "Square", 1),
      makeFilter("fluteCount", 4, 1),
      makeFilter("coating", "TiAlN", 1),
      makeFilter("material", "일반강", 1),
      makeFilter("cuttingType", "roughing", 1),
    ]
    input = applyChain(makeBaseInput(), filters)
    expect(filters.length).toBe(6)
  })

  it("S26-T02: workPieceName + coolantHole 추가", () => {
    let r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "S45C", 2))
    filters = r.nextFilters; input = r.nextInput
    const ch = buildAppliedFilterFromValue("coolantHole", "true", 2)
    if (ch) {
      r = doReplace(makeBaseInput(), filters, ch)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(filters.length).toBe(8)
  })

  it("S26-T03: diameterMm 변경 → 12 (7개 유지)", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterMm", 12, 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(12)
    expect(filters.length).toBe(8) // 교체이므로 수 동일
  })

  it("S26-T04: toolSubtype 변경 → Ball", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Ball", 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
    expect(input.diameterMm).toBe(12)
  })

  it("S26-T05: fluteCount 변경 → 2날", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 2, 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(2)
  })

  it("S26-T06: coating 변경 → AlCrN", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "AlCrN", 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("S26-T07: material 변경 → 알루미늄", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "알루미늄", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("알루미늄")
  })

  it("S26-T08: cuttingType 변경 → finishing", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("cuttingType", "finishing", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.operationType).toBe("finishing")
  })

  it("S26-T09: 필터 수 동일 (8개)", () => {
    expect(filters.length).toBe(8)
  })

  it("S26-T10: 최종 값 전부 확인", () => {
    expect(input.diameterMm).toBe(12)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(2)
    expect(input.coatingPreference).toBe("AlCrN")
    expect(input.material).toBe("알루미늄")
    expect(input.operationType).toBe("finishing")
    // material setInput clears workPieceName — 알루미늄 교체 시 S45C 클리어됨
    expect(input.workPieceName).toBeUndefined()
    expect(input.coolantHole).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 27: diameterRefine 5번 연속 교체
// ═══════════════════════════════════════════════════════════════
describe("Scenario 27: diameterRefine 연속 교체", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S27-T01: diameterMm 10 초기 설정", () => {
    filters = [makeFilter("diameterMm", 10, 1)]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
  })

  it("S27-T02: toolSubtype + fluteCount 추가", () => {
    let r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 2))
    filters = r.nextFilters; input = r.nextInput
    r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 4, 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
  })

  it("S27-T03: diameterRefine → 9.95", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterRefine", 9.95, 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(9.95)
    expect(input.toolSubtype).toBe("Square")
  })

  it("S27-T04: diameterRefine → 10.05", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterRefine", 10.05, 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10.05)
  })

  it("S27-T05: diameterRefine → 9.922", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterRefine", 9.922, 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(9.922)
  })

  it("S27-T06: diameterRefine → 10.1", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterRefine", 10.1, 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10.1)
  })

  it("S27-T07: diameterRefine → 10.0 복귀", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterRefine", 10.0, 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(10)
  })

  it("S27-T08: 모든 교체 후 toolSubtype 유지", () => {
    expect(input.toolSubtype).toBe("Square")
  })

  it("S27-T09: 모든 교체 후 fluteCount 유지", () => {
    expect(input.flutePreference).toBe(4)
  })

  it("S27-T10: diameterMm 관련 필터 1개만", () => {
    const diamFilters = filters.filter(f => f.field === "diameterMm" || f.field === "diameterRefine")
    expect(diamFilters.length).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 28: 0건 복구 시나리오 (필터 조합)
// ═══════════════════════════════════════════════════════════════
describe("Scenario 28: 0건 복구 — 필터 제거 후 재시도", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S28-T01: 4개 필터 설정", () => {
    filters = [
      makeFilter("diameterMm", 10, 1),
      makeFilter("toolSubtype", "Square", 1),
      makeFilter("fluteCount", 6, 1),
      makeFilter("coating", "DLC", 1),
    ]
    input = applyChain(makeBaseInput(), filters)
    expect(filters.length).toBe(4)
  })

  it("S28-T02: 0건 발생 가정 — coating 제거 (skip)", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("coating", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBeUndefined()
  })

  it("S28-T03: 여전히 0건 — fluteCount 제거 (skip)", () => {
    const r = doReplace(makeBaseInput(), filters, makeSkipFilter("fluteCount", 3))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBeUndefined()
  })

  it("S28-T04: 이제 후보 있음 — fluteCount → 4날 재시도", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 4, 4))
    filters = r.nextFilters; input = r.nextInput
    expect(input.flutePreference).toBe(4)
  })

  it("S28-T05: coating → TiAlN 재시도", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "TiAlN", 5))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("TiAlN")
  })

  it("S28-T06: 다시 0건 — diameterMm 변경 → 12", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("diameterMm", 12, 6))
    filters = r.nextFilters; input = r.nextInput
    expect(input.diameterMm).toBe(12)
  })

  it("S28-T07: 여전히 0건 — toolSubtype 변경 → Ball", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Ball", 7))
    filters = r.nextFilters; input = r.nextInput
    expect(input.toolSubtype).toBe("Ball")
  })

  it("S28-T08: 복구 후 coating 변경 → AlCrN", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "AlCrN", 8))
    filters = r.nextFilters; input = r.nextInput
    expect(input.coatingPreference).toBe("AlCrN")
  })

  it("S28-T09: 최종 필터 수 확인 (skip 제거됨)", () => {
    const skipFilters = filters.filter(f => f.op === "skip")
    expect(skipFilters.length).toBe(0)
  })

  it("S28-T10: 최종 값 확인", () => {
    expect(input.diameterMm).toBe(12)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("AlCrN")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 29: 극한 — 모든 필드 한 바퀴
// ═══════════════════════════════════════════════════════════════
describe("Scenario 29: 모든 주요 필드 한 바퀴 변경", () => {
  let input = makeBaseInput()
  let filters: AppliedFilter[] = []

  it("S29-T01: diameterMm 10", () => {
    filters = [makeFilter("diameterMm", 10, 1)]
    input = applyChain(makeBaseInput(), filters)
    expect(input.diameterMm).toBe(10)
  })

  it("S29-T02: material 일반강", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("material", "일반강", 2))
    filters = r.nextFilters; input = r.nextInput
    expect(input.material).toBe("일반강")
  })

  it("S29-T03: toolSubtype Square", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("toolSubtype", "Square", 3))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S29-T04: fluteCount 4", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("fluteCount", 4, 4))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S29-T05: coating TiAlN", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("coating", "TiAlN", 5))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S29-T06: cuttingType roughing", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("cuttingType", "roughing", 6))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S29-T07: workPieceName S45C", () => {
    const r = doReplace(makeBaseInput(), filters, makeFilter("workPieceName", "S45C", 7))
    filters = r.nextFilters; input = r.nextInput
  })

  it("S29-T08: coolantHole true", () => {
    const ch = buildAppliedFilterFromValue("coolantHole", "true", 8)
    if (ch) {
      const r = doReplace(makeBaseInput(), filters, ch)
      filters = r.nextFilters; input = r.nextInput
    }
    expect(input.coolantHole).toBe(true)
  })

  it("S29-T09: 전체 8개 필터 확인", () => {
    expect(filters.length).toBe(8)
  })

  it("S29-T10: 모든 값 정합성 확인", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.material).toBe("일반강")
    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(input.operationType).toBe("roughing")
    expect(input.workPieceName).toBe("S45C")
    expect(input.coolantHole).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 30: 극한 — revision signal 감지
// ═══════════════════════════════════════════════════════════════
describe("Scenario 30: revision signal 감지 + 필터 상태 관리", () => {
  let input = makeBaseInput({ diameterMm: 10 })
  let filters: AppliedFilter[] = [makeFilter("diameterMm", 10, 0)]

  it("S30-T01: toolSubtype 질문 중 '말고' 포함 → unresolved (revision signal)", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "toolSubtype", turnCount: 1,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 50 },
        { label: "Ball", value: "Ball", count: 30 },
      ]),
    })
    const res = resolvePendingQuestionReply(state, "Square 말고 Ball로")
    // "말고" = revision signal → unresolved (deferred to revision resolver)
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T02: '변경해줘' → unresolved (revision signal)", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "coating", turnCount: 2,
      displayedOptions: makeOptions("coating", [{ label: "TiAlN", value: "TiAlN", count: 40 }]),
    })
    const res = resolvePendingQuestionReply(state, "코팅 변경해줘")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T03: '바꿔줘' → unresolved", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "fluteCount", turnCount: 3,
      displayedOptions: makeOptions("fluteCount", [{ label: "4날", value: "4", count: 25 }]),
    })
    const res = resolvePendingQuestionReply(state, "날수 바꿔줘")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T04: '대신' 포함 → unresolved", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "toolSubtype", turnCount: 4,
      displayedOptions: makeOptions("toolSubtype", [{ label: "Square", value: "Square", count: 50 }]),
    })
    const res = resolvePendingQuestionReply(state, "Square 대신 Ball")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T05: 'switch to' → unresolved", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "coating", turnCount: 5,
      displayedOptions: makeOptions("coating", [{ label: "AlCrN", value: "AlCrN", count: 20 }]),
    })
    const res = resolvePendingQuestionReply(state, "switch to AlCrN")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T06: 'change to' → unresolved", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "material", turnCount: 6,
      displayedOptions: makeOptions("material", [{ label: "스테인리스", value: "스테인리스", count: 15 }]),
    })
    const res = resolvePendingQuestionReply(state, "change to 스테인리스")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T07: 'ㄴㄴ' → unresolved (revision signal)", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "toolSubtype", turnCount: 7,
      displayedOptions: makeOptions("toolSubtype", [{ label: "Square", value: "Square", count: 50 }]),
    })
    const res = resolvePendingQuestionReply(state, "ㄴㄴ Ball로")
    expect(res.kind).toBe("unresolved")
  })

  it("S30-T08: revision 아닌 정상 답변은 resolved", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "toolSubtype", turnCount: 8,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 50 },
        { label: "Ball", value: "Ball", count: 30 },
      ]),
    })
    const res = resolvePendingQuestionReply(state, "Ball")
    expect(res.kind).toBe("resolved")
  })

  it("S30-T09: resolved filter 적용", () => {
    const state = makeState({
      resolvedInput: input, appliedFilters: filters,
      lastAskedField: "toolSubtype", turnCount: 9,
      displayedOptions: makeOptions("toolSubtype", [
        { label: "Square", value: "Square", count: 50 },
      ]),
    })
    const res = resolvePendingQuestionReply(state, "Square")
    expect(res.kind).toBe("resolved")
    if (res.kind === "resolved") {
      const r = doReplace(makeBaseInput(), filters, res.filter)
      filters = r.nextFilters; input = r.nextInput
      expect(input.toolSubtype).toBe("Square")
    }
  })

  it("S30-T10: 최종 — 필터 정합성 확인", () => {
    expect(input.diameterMm).toBe(10)
    expect(input.toolSubtype).toBe("Square")
    expect(filters.length).toBe(2)
  })
})
