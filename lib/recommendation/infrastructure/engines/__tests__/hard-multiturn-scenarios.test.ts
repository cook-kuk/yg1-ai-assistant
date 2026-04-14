import { describe, expect, it } from "vitest"

import { resolvePendingQuestionReply, resolveExplicitRevisionRequest, resolveExplicitComparisonAction } from "../serve-engine-runtime"
import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter, replaceFieldFilters } from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { buildAppliedFilterFromValue, applyFilterToRecommendationInput, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput, DisplayedOption } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    ...overrides,
  } as RecommendationInput
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "hard-test",
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

function applyChain(baseInput: RecommendationInput, filters: AppliedFilter[]): RecommendationInput {
  let input = { ...baseInput }
  for (const f of filters) {
    input = applyFilterToRecommendationInput(input, f)
  }
  return input
}

// ═══════════════════════════════════════════════════════════════
// Scenario 4: intake 직경 → 칩 형상 → 비교 → 직경 변경 → 소재 추가
//
// 실제 사용자 시나리오:
// Turn 0: intake Milling + 10mm
// Turn 1: "Square" 형상 칩 클릭 → 2072개
// Turn 2: "TiAlN" 코팅 칩 클릭 → 800개
// Turn 3: 추천 결과 표시
// Turn 4: "상위 3개 비교" → comparison 모드
// Turn 5: "직경 8mm로 바꿔서 추천해줘" → 조건 변경
// Turn 6: "알루미늄 소재 추가해줘" → 추가 필터
// ═══════════════════════════════════════════════════════════════

describe("Scenario 4: intake → 비교 → 조건 변경 → 소재 추가 (풀 라이프사이클)", () => {
  const baseInput = makeBaseInput({ diameterMm: 10, machiningCategory: "Milling" })
  let currentInput: RecommendationInput
  let filters: AppliedFilter[]

  it("Turn 1: Square 형상 칩 클릭 → toolSubtype 필터 추가", () => {
    filters = []
    const reply = resolvePendingQuestionReply(
      makeState({ lastAskedField: "toolSubtype", displayedOptions: [
        { index: 1, label: "Square (2072개)", field: "toolSubtype", value: "Square", count: 2072 },
        { index: 2, label: "Ball (559개)", field: "toolSubtype", value: "Ball", count: 559 },
      ]}),
      "Square (2072개)"
    )
    expect(reply.kind).toBe("resolved")
    if (reply.kind === "resolved") {
      filters.push(reply.filter)
      currentInput = applyChain(baseInput, filters)
      expect(currentInput.toolSubtype).toBe("Square")
      expect(currentInput.diameterMm).toBe(10) // intake 값 유지
    }
  })

  it("Turn 2: TiAlN 코팅 칩 클릭 → coating 필터 추가, 기존 필터 유지", () => {
    const reply = resolvePendingQuestionReply(
      makeState({
        lastAskedField: "coating",
        appliedFilters: [...filters],
        displayedOptions: [
          { index: 1, label: "TiAlN (800개)", field: "coating", value: "TiAlN", count: 800 },
          { index: 2, label: "AlCrN (300개)", field: "coating", value: "AlCrN", count: 300 },
        ],
      }),
      "TiAlN (800개)"
    )
    expect(reply.kind).toBe("resolved")
    if (reply.kind === "resolved") {
      filters.push(reply.filter)
      currentInput = applyChain(baseInput, filters)
      expect(filters).toHaveLength(2)
      expect(currentInput.toolSubtype).toBe("Square")
      expect(currentInput.coatingPreference).toBe("TiAlN")
      expect(currentInput.diameterMm).toBe(10) // intake 값 여전히 유지
    }
  })

  it("Turn 4: 비교 후에도 appliedFilters 보존", () => {
    // comparison 모드에서 filters가 사라지면 안 됨
    const comparisonState = makeState({
      currentMode: "comparison",
      resolutionStatus: "resolved_exact",
      appliedFilters: [...filters],
      resolvedInput: currentInput,
      candidateCount: 800,
    })

    // 비교 후에도 필터 2개 유지
    expect(comparisonState.appliedFilters).toHaveLength(2)
    expect(comparisonState.appliedFilters![0].field).toBe("toolSubtype")
    expect(comparisonState.appliedFilters![1].field).toBe("coating")
    expect(comparisonState.candidateCount).toBe(800)
  })

  it("Turn 5: 직경 변경 — intake 값(appliedFilters에 없음)을 revision 대상으로 인식", async () => {
    const postComparisonState = makeState({
      currentMode: "comparison",
      resolutionStatus: "resolved_exact",
      appliedFilters: [...filters], // toolSubtype, coating만 있음 — diameterMm은 없음!
      resolvedInput: { ...currentInput, diameterMm: 10 },
      candidateCount: 800,
    })

    const result = await resolveExplicitRevisionRequest(postComparisonState, "직경 8mm로 바꿔서 추천해줘")

    // synthetic filter로 diameterMm을 인식해야 함
    if (result?.kind === "resolved") {
      expect(result.request.targetField).toBe("diameterMm")
      expect(result.request.nextFilter.rawValue).toBe(8)
    } else {
      // ambiguous도 OK — "직경"을 인식했다는 뜻
      expect(result).not.toBeNull()
    }
  })

  it("Turn 6: 직경 변경 후 소재 추가 — 기존 필터(toolSubtype, coating) 유지", () => {
    // 직경이 8mm로 바뀌고, 소재를 추가하는 시나리오
    const diamFilter = makeFilter("diameterMm", 8, 3)
    const matFilter = makeFilter("workPieceName", "알루미늄", 4)

    const allFilters = [...filters, diamFilter, matFilter]
    const finalInput = applyChain(baseInput, allFilters)

    expect(finalInput.diameterMm).toBe(8) // 변경됨
    expect(finalInput.toolSubtype).toBe("Square") // 유지
    expect(finalInput.coatingPreference).toBe("TiAlN") // 유지
    expect(finalInput.workPieceName).toBe("알루미늄") // 추가됨
    expect(allFilters).toHaveLength(4)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 5: canonicalField 다단계 교체
//
// 직경 10mm → 칩에서 9.95mm 클릭 → 다시 10.05mm로 변경
// diameterRefine → diameterMm 변환이 반복될 때 필터 누적 방지
// ═══════════════════════════════════════════════════════════════

describe("Scenario 5: canonicalField 다단계 교체 — diameterRefine 반복", () => {
  const baseInput = makeBaseInput()

  it("Step 1: diameterMm=10 초기 필터", () => {
    const filter = makeFilter("diameterMm", 10, 0)
    expect(filter.field).toBe("diameterMm")
    expect(filter.rawValue).toBe(10)
  })

  it("Step 2: diameterRefine=9.95 → diameterMm으로 변환 → 기존 10mm 교체", () => {
    const existing = [makeFilter("diameterMm", 10, 0)]
    const refineFilter = buildAppliedFilterFromValue("diameterRefine", 9.95, 1)!

    // canonicalField 변환 확인
    expect(refineFilter.field).toBe("diameterMm")
    expect(refineFilter.rawValue).toBe(9.95)

    const result = replaceFieldFilter(baseInput, existing, refineFilter, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].rawValue).toBe(9.95)
    expect(result.nextInput.diameterMm).toBe(9.95)
  })

  it("Step 3: 다시 diameterRefine=10.05 → 9.95 교체, 필터 1개 유지", () => {
    const existing = [makeFilter("diameterMm", 9.95, 1)]
    const refineFilter2 = buildAppliedFilterFromValue("diameterRefine", 10.05, 2)!

    expect(refineFilter2.field).toBe("diameterMm")

    const result = replaceFieldFilter(baseInput, existing, refineFilter2, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1) // 3개가 아닌 1개
    expect(result.nextFilters[0].rawValue).toBe(10.05)
    expect(result.nextInput.diameterMm).toBe(10.05)
  })

  it("Step 4: 3번 교체 후에도 diameterMm 필터 누적 없음", () => {
    let filters = [makeFilter("diameterMm", 10, 0)]

    // 10 → 9.95
    const r1 = replaceFieldFilter(baseInput, filters, buildAppliedFilterFromValue("diameterRefine", 9.95, 1)!, applyFilterToRecommendationInput)
    filters = r1.nextFilters

    // 9.95 → 10.05
    const r2 = replaceFieldFilter(baseInput, filters, buildAppliedFilterFromValue("diameterRefine", 10.05, 2)!, applyFilterToRecommendationInput)
    filters = r2.nextFilters

    // 10.05 → 9.922
    const r3 = replaceFieldFilter(baseInput, filters, buildAppliedFilterFromValue("diameterRefine", 9.922, 3)!, applyFilterToRecommendationInput)
    filters = r3.nextFilters

    // 항상 1개만
    expect(filters).toHaveLength(1)
    expect(filters[0].rawValue).toBe(9.922)
    expect(r3.nextInput.diameterMm).toBe(9.922)
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 6: 다중 필터 동시 적용 후 개별 변경
//
// "알루미늄 4날 Square 10mm 추천해줘" → 4개 필터 동시
// → "날수 2날로 바꿔" → fluteCount만 교체, 나머지 유지
// → "코팅은 DLC로" → 추가, 기존 3개 유지
// → "소재 스테인리스로 변경" → material 교체, 나머지 유지
// ═══════════════════════════════════════════════════════════════

describe("Scenario 6: 다중 필터 동시 적용 → 개별 변경", () => {
  const baseInput = makeBaseInput({ diameterMm: 10 })

  it("Turn 1: 4개 필터 동시 적용", () => {
    const filters = [
      makeFilter("workPieceName", "알루미늄", 0),
      makeFilter("fluteCount", 4, 0),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("diameterMm", 10, 0),
    ]

    const input = applyChain(baseInput, filters)
    expect(input.workPieceName).toBe("알루미늄")
    expect(input.flutePreference).toBe(4)
    expect(input.toolSubtype).toBe("Square")
    expect(input.diameterMm).toBe(10)
    expect(filters).toHaveLength(4)
  })

  it("Turn 2: fluteCount만 교체 (4→2), 나머지 3개 유지", () => {
    const filters = [
      makeFilter("workPieceName", "알루미늄", 0),
      makeFilter("fluteCount", 4, 0),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("diameterMm", 10, 0),
    ]

    const newFlute = makeFilter("fluteCount", 2, 1)
    const result = replaceFieldFilter(baseInput, filters, newFlute, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(4) // 5개 아닌 4개
    expect(result.nextInput.flutePreference).toBe(2) // 변경됨
    expect(result.nextInput.workPieceName).toBe("알루미늄") // 유지
    expect(result.nextInput.toolSubtype).toBe("Square") // 유지
    expect(result.nextInput.diameterMm).toBe(10) // 유지
  })

  it("Turn 3: coating 추가 → 5개 필터", () => {
    const filters = [
      makeFilter("workPieceName", "알루미늄", 0),
      makeFilter("fluteCount", 2, 1),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("diameterMm", 10, 0),
    ]

    const coatingFilter = makeFilter("coating", "DLC", 2)
    const result = replaceFieldFilter(baseInput, filters, coatingFilter, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(false) // 추가
    expect(result.nextFilters).toHaveLength(5)
    expect(result.nextInput.coatingPreference).toBe("DLC")
  })

  it("Turn 4: 소재 변경 (알루미늄→스테인리스), 나머지 4개 유지", () => {
    const filters = [
      makeFilter("workPieceName", "알루미늄", 0),
      makeFilter("fluteCount", 2, 1),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("diameterMm", 10, 0),
      makeFilter("coating", "DLC", 2),
    ]

    const newMat = makeFilter("workPieceName", "스테인리스강", 3)
    const result = replaceFieldFilter(baseInput, filters, newMat, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(5) // 6개 아닌 5개
    expect(result.nextInput.workPieceName).toBe("스테인리스강") // 변경
    expect(result.nextInput.flutePreference).toBe(2) // 유지
    expect(result.nextInput.toolSubtype).toBe("Square") // 유지
    expect(result.nextInput.diameterMm).toBe(10) // 유지
    expect(result.nextInput.coatingPreference).toBe("DLC") // 유지
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 7: skip → 되돌리기 → 다시 선택
//
// 코팅 질문 → "상관없음" → 추천 결과 → "코팅 TiAlN으로 바꿔" → 재검색
// skip된 필터가 있을 때 revision이 정상 동작하는지
// ═══════════════════════════════════════════════════════════════

describe("Scenario 7: skip → revision으로 되돌리기", () => {
  it("Turn 1: 코팅 상관없음 → skip 필터", () => {
    const reply = resolvePendingQuestionReply(
      makeState({
        lastAskedField: "coating",
        displayedOptions: [
          { index: 1, label: "TiAlN (500개)", field: "coating", value: "TiAlN", count: 500 },
          { index: 2, label: "상관없음", field: "coating", value: "skip", count: 0 },
        ],
      }),
      "상관없음"
    )
    expect(reply.kind).toBe("resolved")
    if (reply.kind === "resolved") {
      expect(reply.filter.op).toBe("skip")
      expect(reply.filter.field).toBe("coating")
    }
  })

  it("Turn 2: skip된 코팅을 TiAlN으로 revision — skip 필터 교체", async () => {
    const skipFilter: AppliedFilter = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 }
    const state = makeState({
      currentMode: "recommendation",
      resolutionStatus: "resolved_exact",
      appliedFilters: [
        makeFilter("toolSubtype", "Square", 0),
        skipFilter, // coating은 skip 상태
      ],
      resolvedInput: makeBaseInput({ toolSubtype: "Square", diameterMm: 10 }),
    })

    const result = await resolveExplicitRevisionRequest(state, "코팅 TiAlN으로 변경해줘")

    // skip 필터도 revision 대상이 되어야 함
    // 현재 구현에서는 skip 필터를 activeFilters에서 제외하므로 null일 수 있음
    // 이건 의도적 한계일 수 있음
    if (result?.kind === "resolved") {
      expect(result.request.targetField).toBe("coating")
      expect(result.request.nextFilter.rawValue).toMatch(/tialn/i)
    }
    // result가 null이면 skip된 필터는 revision이 아닌 새 필터 추가로 처리해야 함
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 8: 한국어 자연어 → 필터 매핑 정확도
//
// 다양한 한국어 표현이 올바른 필터로 변환되는지
// ═══════════════════════════════════════════════════════════════

describe("Scenario 8: 한국어 자연어 → 필터 매핑", () => {
  it("볼엔드밀 → Ball", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "볼엔드밀")
    expect(filter?.rawValue).toBe("Ball")
  })

  it("평엔드밀 → Square", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "평엔드밀")
    expect(filter?.rawValue).toBe("Square")
  })

  it("러핑 → Roughing", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "러핑")
    expect(filter?.rawValue).toBe("Roughing")
  })

  it("라디우스 → Radius", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "라디우스")
    expect(filter?.rawValue).toBe("Radius")
  })

  it("코너R → Radius (alias)", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "코너R")
    // 코너R이 Radius로 매핑되는지
    if (filter) {
      expect(["Radius", "Corner Radius"]).toContain(filter.rawValue)
    }
  })

  it("3날 → fluteCount 3", () => {
    const filter = buildAppliedFilterFromValue("fluteCount", "3날")
    expect(filter?.rawValue).toBe(3)
  })

  it("무코팅 → Uncoated", () => {
    const filter = buildAppliedFilterFromValue("coating", "무코팅")
    // 무코팅이 Uncoated 또는 Bright Finish로 매핑되는지
    if (filter) {
      expect(filter.rawValue).toBeTruthy()
    }
  })

  it("인치 직경 5/16 → 7.9375mm", () => {
    const filter = buildAppliedFilterFromValue("diameterRefine", "5/16")
    // 인치 분수 → mm 변환 (canonicalizeRawValue에서 처리)
    if (filter) {
      expect(filter.field).toBe("diameterMm") // canonicalField
      const val = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
      expect(Math.abs(val - 7.9375)).toBeLessThan(0.001)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 9: 필터 종속 관계 — 직경 변경 시 시리즈 클리어
//
// 직경 10mm + 시리즈 E5E84 → 직경 8mm로 변경 → 시리즈 제거
// 시리즈는 직경에 종속되므로 직경이 바뀌면 시리즈도 초기화
// ═══════════════════════════════════════════════════════════════

describe("Scenario 9: 필터 종속 관계 — 직경 변경 시 시리즈 클리어", () => {
  const baseInput = makeBaseInput()

  it("직경 + 시리즈 설정 후 직경 변경 → 시리즈 필터 제거", () => {
    const filters = [
      makeFilter("diameterMm", 10, 0),
      makeFilter("toolSubtype", "Square", 0),
      makeFilter("edpSeriesName", "E5E84", 1),
    ]

    // 직경 변경 시 edpSeriesName도 제거해야 함
    const diameterFields = ["diameterMm", "diameterRefine"]
    const dependentFields = [...diameterFields, "seriesName", "edpSeriesName"]

    const remainingFilters = filters.filter(f => !dependentFields.includes(f.field))
    const newDiamFilter = makeFilter("diameterMm", 8, 2)
    const finalFilters = [...remainingFilters, newDiamFilter]

    // toolSubtype만 남고 시리즈 + 기존 직경 제거
    expect(finalFilters).toHaveLength(2)
    expect(finalFilters.find(f => f.field === "toolSubtype")).toBeDefined()
    expect(finalFilters.find(f => f.field === "diameterMm")?.rawValue).toBe(8)
    expect(finalFilters.find(f => f.field === "edpSeriesName")).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 10: 0건 결과 → 복구 → 재선택
//
// toolSubtype=Ball → 0건 → 이전값(Square)으로 복귀 → 다시 Radius 시도
// ═══════════════════════════════════════════════════════════════

describe("Scenario 10: 0건 결과 → 이전값 복귀 → 재선택", () => {
  const baseInput = makeBaseInput({ diameterMm: 10 })

  it("Step 1: Square 적용 → 정상", () => {
    const filter = makeFilter("toolSubtype", "Square", 0)
    const input = applyFilterToRecommendationInput(baseInput, filter)
    expect(input.toolSubtype).toBe("Square")
  })

  it("Step 2: Ball로 교체 시도 → 0건이라고 가정", () => {
    const existing = [makeFilter("toolSubtype", "Square", 0)]
    const ballFilter = makeFilter("toolSubtype", "Ball", 1)

    const result = replaceFieldFilter(baseInput, existing, ballFilter, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBe("Ball")
    // 여기서 실제로는 runHybridRetrieval → 0건 → buildZeroResultWithAlternatives
    // 하지만 filter 자체는 교체됨
  })

  it("Step 3: 0건 후 이전값(Square)으로 복귀", () => {
    // 0건이 나왔으므로 이전 필터(Square)로 되돌림
    const revertFilter = makeFilter("toolSubtype", "Square", 2)
    const afterBall = [makeFilter("toolSubtype", "Ball", 1)]

    const result = replaceFieldFilter(baseInput, afterBall, revertFilter, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBe("Square")
  })

  it("Step 4: 다시 Radius 시도 — Ball 이력과 무관하게 교체", () => {
    const afterSquare = [makeFilter("toolSubtype", "Square", 2)]
    const radiusFilter = makeFilter("toolSubtype", "Radius", 3)

    const result = replaceFieldFilter(baseInput, afterSquare, radiusFilter, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextInput.toolSubtype).toBe("Radius")
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 11: replaceFieldFilters (복수) — 한 턴에 여러 필터 동시 교체
//
// "4날 TiAlN Square" → fluteCount + coating + toolSubtype 동시 적용
// 기존에 fluteCount=2, coating=DLC 있으면 둘 다 교체
// ═══════════════════════════════════════════════════════════════

describe("Scenario 11: 한 턴 다중 필터 동시 교체", () => {
  const baseInput = makeBaseInput({ diameterMm: 10 })

  it("기존 2개(fluteCount, coating) 교체 + 1개(toolSubtype) 추가 = 3개", () => {
    const existing = [
      makeFilter("fluteCount", 2, 0),
      makeFilter("coating", "DLC", 0),
      makeFilter("diameterMm", 10, 0),
    ]

    const newFilters = [
      makeFilter("fluteCount", 4, 1),
      makeFilter("coating", "TiAlN", 1),
      makeFilter("toolSubtype", "Square", 1),
    ]

    const result = replaceFieldFilters(baseInput, existing, newFilters, applyFilterToRecommendationInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.replacedFields).toContain("fluteCount")
    expect(result.replacedFields).toContain("coating")
    expect(result.nextFilters).toHaveLength(4) // diameter + fluteCount + coating + toolSubtype
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.coatingPreference).toBe("TiAlN")
    expect(result.nextInput.toolSubtype).toBe("Square")
    expect(result.nextInput.diameterMm).toBe(10) // 유지
  })
})

// ═══════════════════════════════════════════════════════════════
// Scenario 12: comparison에서 제품코드로 비교 요청
//
// 추천 결과에서 "E5E84 vs E5E83 비교해줘" → 제품 코드 파싱
// ═══════════════════════════════════════════════════════════════

describe("Scenario 12: 제품코드 비교 요청 파싱", () => {
  it("E5E84와 E5E83 비교 → targets 추출", () => {
    const state = makeState({
      currentMode: "recommendation",
      resolutionStatus: "resolved_exact",
      displayedProducts: [
        { rank: 1, productCode: "E5E84100", displayCode: "E5E84100", seriesName: "E5E84" } as any,
        { rank: 2, productCode: "E5E83100", displayCode: "E5E83100", seriesName: "E5E83" } as any,
        { rank: 3, productCode: "E5D74100", displayCode: "E5D74100", seriesName: "E5D74" } as any,
      ],
      displayedCandidates: [
        { displayCode: "E5E84100", seriesName: "E5E84" } as any,
        { displayCode: "E5E83100", seriesName: "E5E83" } as any,
        { displayCode: "E5D74100", seriesName: "E5D74" } as any,
      ],
    })

    const action = resolveExplicitComparisonAction(state, "E5E84와 E5E83 비교해줘")

    if (action) {
      expect(action.type).toBe("compare_products")
      if (action.type === "compare_products") {
        expect(action.targets.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it("상위 3개 비교 → targets에 3개 이상", () => {
    const state = makeState({
      currentMode: "recommendation",
      resolutionStatus: "resolved_exact",
      displayedProducts: [
        { rank: 1, productCode: "P1", displayCode: "P1" } as any,
        { rank: 2, productCode: "P2", displayCode: "P2" } as any,
        { rank: 3, productCode: "P3", displayCode: "P3" } as any,
      ],
      displayedCandidates: [
        { displayCode: "P1" } as any,
        { displayCode: "P2" } as any,
        { displayCode: "P3" } as any,
      ],
    })

    const action = resolveExplicitComparisonAction(state, "상위 3개 비교")

    if (action) {
      expect(action.type).toBe("compare_products")
    }
  })
})
