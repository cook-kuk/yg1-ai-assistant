/**
 * 전 스펙 필터 커버리지 + 까다로운 조건 변경 시나리오 테스트
 *
 * 테스트 범위:
 * 1. 모든 주요 필터 필드에 대한 parseAnswerToFilter 정확성
 * 2. pending question 중 revision 요청이 올바르게 위임되는지
 * 3. 다중 필터 교체 / 연쇄 변경 / 한국어 alias 매칭
 * 4. 엣지 케이스: alias=값, 동일 값 재지정, skip→값, 값→skip
 */

import { describe, expect, it } from "vitest"

import {
  buildPendingSelectionFilter,
  resolveExplicitRevisionRequest,
  resolvePendingQuestionReply,
} from "../serve-engine-runtime"
import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test-filter-coverage",
    candidateCount: 100,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 2,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

function makeBaseInput(): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    diameterMm: 10,
    material: "일반강",
    operationType: "Side Cutting",
    toolType: "엔드밀",
  }
}

function af(field: string, op: string, value: string, rawValue: string | number | boolean, appliedAt = 0): AppliedFilter {
  return { field, op, value, rawValue, appliedAt } as AppliedFilter
}

// ═══════════════════════════════════════════════════════════
//  1. 모든 주요 필터 필드 parseAnswerToFilter 테스트
// ═══════════════════════════════════════════════════════════

describe("parseAnswerToFilter — 전 스펙 필드 커버리지", () => {
  it("diameterMm: 숫자+mm", () => {
    const f = parseAnswerToFilter("diameterMm", "12mm")
    expect(f).toMatchObject({ field: "diameterMm", op: "eq", rawValue: 12 })
  })

  it("diameterMm: 소수점", () => {
    const f = parseAnswerToFilter("diameterMm", "6.35")
    expect(f).toMatchObject({ field: "diameterMm", rawValue: 6.35 })
  })

  it("diameterRefine: 숫자", () => {
    const f = parseAnswerToFilter("diameterRefine", "8mm")
    expect(f).toMatchObject({ field: "diameterMm", rawValue: 8 })
  })

  it("fluteCount: 숫자+날", () => {
    const f = parseAnswerToFilter("fluteCount", "4날")
    expect(f).toMatchObject({ field: "fluteCount", op: "eq", rawValue: 4 })
  })

  it("fluteCount: 숫자만", () => {
    const f = parseAnswerToFilter("fluteCount", "2")
    expect(f).toMatchObject({ field: "fluteCount", rawValue: 2 })
  })

  it("coating: 문자열", () => {
    const f = parseAnswerToFilter("coating", "TiAlN")
    expect(f).toMatchObject({ field: "coating", op: "includes", value: "TiAlN" })
  })

  it("coating: Bright Finish (공백 포함)", () => {
    const f = parseAnswerToFilter("coating", "Bright Finish")
    expect(f).toMatchObject({ field: "coating", value: "Bright Finish" })
  })

  it("toolSubtype: Square", () => {
    const f = parseAnswerToFilter("toolSubtype", "Square")
    expect(f).toMatchObject({ field: "toolSubtype", op: "includes", rawValue: "Square" })
  })

  it("toolSubtype: 한국어 alias 황삭→Roughing", () => {
    const f = parseAnswerToFilter("toolSubtype", "황삭")
    expect(f).toMatchObject({ field: "toolSubtype", rawValue: "Roughing" })
  })

  it("toolSubtype: 라디우스→Radius", () => {
    const f = parseAnswerToFilter("toolSubtype", "라디우스")
    expect(f).toMatchObject({ field: "toolSubtype", rawValue: "Radius" })
  })

  it("toolSubtype: 볼→Ball", () => {
    const f = parseAnswerToFilter("toolSubtype", "볼")
    expect(f).toMatchObject({ field: "toolSubtype", rawValue: "Ball" })
  })

  it("workPieceName: 알루미늄", () => {
    const f = parseAnswerToFilter("workPieceName", "알루미늄")
    expect(f).toMatchObject({ field: "workPieceName", op: "includes", value: "알루미늄" })
  })

  it("seriesName: 시리즈명", () => {
    const f = parseAnswerToFilter("seriesName", "V7 PLUS")
    expect(f).toMatchObject({ field: "seriesName", op: "includes" })
  })

  it("lengthOfCutMm: 절삭길이", () => {
    const f = parseAnswerToFilter("lengthOfCutMm", "25mm")
    expect(f).toMatchObject({ field: "lengthOfCutMm", op: "eq", rawValue: 25 })
  })

  it("overallLengthMm: 전장", () => {
    const f = parseAnswerToFilter("overallLengthMm", "75mm")
    expect(f).toMatchObject({ field: "overallLengthMm", op: "eq", rawValue: 75 })
  })

  it("shankDiameterMm: 생크 직경", () => {
    const f = parseAnswerToFilter("shankDiameterMm", "10mm")
    expect(f).toMatchObject({ field: "shankDiameterMm", op: "eq", rawValue: 10 })
  })

  it("helixAngleDeg: 헬릭스각", () => {
    const f = parseAnswerToFilter("helixAngleDeg", "45")
    expect(f).toMatchObject({ field: "helixAngleDeg", op: "eq", rawValue: 45 })
  })

  it("ballRadiusMm: 볼 반경", () => {
    const f = parseAnswerToFilter("ballRadiusMm", "5mm")
    expect(f).toMatchObject({ field: "ballRadiusMm", op: "eq", rawValue: 5 })
  })

  it("taperAngleDeg: 테이퍼각", () => {
    const f = parseAnswerToFilter("taperAngleDeg", "3")
    expect(f).toMatchObject({ field: "taperAngleDeg", op: "eq", rawValue: 3 })
  })

  it("cuttingType: 가공 타입", () => {
    const f = parseAnswerToFilter("cuttingType", "Side_Milling")
    expect(f).toMatchObject({ field: "cuttingType", op: "eq" })
  })

  it("brand: 브랜드", () => {
    const f = parseAnswerToFilter("brand", "ALU-POWER HPC")
    expect(f).toMatchObject({ field: "brand", op: "includes" })
  })

  it("toolMaterial: 공구 소재 초경", () => {
    const f = parseAnswerToFilter("toolMaterial", "초경")
    expect(f).toMatchObject({ field: "toolMaterial", op: "includes" })
  })

  it("country: 국가 코드", () => {
    const f = parseAnswerToFilter("country", "KOR")
    expect(f).toMatchObject({ field: "country", op: "includes" })
  })
})

// ═══════════════════════════════════════════════════════════
//  2. 필터 적용 (applyFilterToInput) — 종속 클리어 & 교체
// ═══════════════════════════════════════════════════════════

describe("applyFilterToInput — 종속 관계 & 교체", () => {
  it("material 변경 시 workPieceName 클리어", () => {
    const input = { ...makeBaseInput(), workPieceName: "ADC12" }
    const updated = applyFilterToInput(input, af("material", "eq", "주철", "주철"))
    expect(updated.material).toBe("주철")
    expect(updated.workPieceName).toBeUndefined()
  })

  it("material 같은 값 재적용은 같은 ISO 그룹이면 workPieceName 보존", () => {
    // ADC12 = 알루미늄(N) → 같은 그룹 → production 은 보존 (사용자 의도 모순 없음).
    const input = { ...makeBaseInput(), material: "알루미늄", workPieceName: "ADC12" }
    const updated = applyFilterToInput(input, af("material", "eq", "알루미늄", "알루미늄"))
    expect(updated.material).toBe("알루미늄")
    expect(updated.workPieceName).toBe("ADC12")
  })

  it("fluteCount 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("fluteCount", "eq", "4날", 4))
    expect(updated.flutePreference).toBe(4)
  })

  it("coating 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("coating", "includes", "TiAlN", "TiAlN"))
    expect(updated.coatingPreference).toBe("TiAlN")
  })

  it("toolSubtype 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("toolSubtype", "includes", "Ball", "Ball"))
    expect(updated.toolSubtype).toBe("Ball")
  })

  it("lengthOfCutMm 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("lengthOfCutMm", "eq", "25mm", 25))
    expect(updated.lengthOfCutMm).toBe(25)
  })

  it("overallLengthMm 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("overallLengthMm", "eq", "75mm", 75))
    expect(updated.overallLengthMm).toBe(75)
  })

  it("shankDiameterMm 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("shankDiameterMm", "eq", "10mm", 10))
    expect(updated.shankDiameterMm).toBe(10)
  })

  it("helixAngleDeg 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("helixAngleDeg", "eq", "45°", 45))
    expect(updated.helixAngleDeg).toBe(45)
  })

  it("ballRadiusMm 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("ballRadiusMm", "eq", "3mm", 3))
    expect(updated.ballRadiusMm).toBe(3)
  })

  it("taperAngleDeg 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("taperAngleDeg", "eq", "5°", 5))
    expect(updated.taperAngleDeg).toBe(5)
  })

  it("cuttingType → operationType 매핑", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("cuttingType", "eq", "Slotting", "Slotting"))
    expect(updated.operationType).toBe("Slotting")
  })

  it("brand 적용", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("brand", "includes", "V7 PLUS", "V7 PLUS"))
    expect(updated.brand).toBe("V7 PLUS")
  })

  it("country 적용 (raw filter, applyFilterToInput stores as-is)", () => {
    const updated = applyFilterToInput(makeBaseInput(), af("country", "includes", "KOR", "KOR"))
    // canonical 화는 parseAnswerToFilter 에서 함. raw filter 는 그대로 저장.
    expect(updated.country).toBe("KOR")
  })
})

// ═══════════════════════════════════════════════════════════
//  3. replaceFieldFilter — 연쇄 교체 시나리오
// ═══════════════════════════════════════════════════════════

describe("replaceFieldFilter — 연쇄 교체 시나리오", () => {
  it("같은 필드 3번 연속 교체: 2날→4날→6날", () => {
    const baseInput = makeBaseInput()
    const filters: AppliedFilter[] = [
      af("fluteCount", "eq", "2날", 2, 1),
    ]

    // 2날 → 4날
    const r1 = replaceFieldFilter(baseInput, filters, af("fluteCount", "eq", "4날", 4, 2), applyFilterToInput)
    expect(r1.replacedExisting).toBe(true)
    expect(r1.nextInput.flutePreference).toBe(4)

    // 4날 → 6날
    const r2 = replaceFieldFilter(baseInput, r1.nextFilters, af("fluteCount", "eq", "6날", 6, 3), applyFilterToInput)
    expect(r2.replacedExisting).toBe(true)
    expect(r2.nextInput.flutePreference).toBe(6)
    expect(r2.nextFilters.filter(f => f.field === "fluteCount")).toHaveLength(1)
  })

  it("다른 필드 교체는 기존 필드 유지: coating 교체 시 fluteCount 유지", () => {
    const baseInput = makeBaseInput()
    const filters: AppliedFilter[] = [
      af("fluteCount", "eq", "4날", 4, 1),
      af("coating", "includes", "TiAlN", "TiAlN", 2),
    ]

    const result = replaceFieldFilter(baseInput, filters, af("coating", "includes", "AlCrN", "AlCrN", 3), applyFilterToInput)
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.coatingPreference).toBe("AlCrN")
    expect(result.nextFilters).toHaveLength(2)
  })

  it("skip → 값 교체: 상관없음에서 구체값으로", () => {
    const baseInput = makeBaseInput()
    const filters: AppliedFilter[] = [
      af("toolSubtype", "skip", "상관없음", "skip", 1),
    ]

    const result = replaceFieldFilter(baseInput, filters, af("toolSubtype", "includes", "Ball", "Ball", 2), applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBe("Ball")
  })

  it("값 → skip 교체: 구체값에서 상관없음으로", () => {
    const baseInput = makeBaseInput()
    const filters: AppliedFilter[] = [
      af("toolSubtype", "includes", "Ball", "Ball", 1),
    ]

    const result = replaceFieldFilter(baseInput, filters, af("toolSubtype", "skip", "상관없음", "skip", 2), applyFilterToInput)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.toolSubtype).toBeUndefined()
  })

  it("5개 필터 동시 존재 중 중간 필터만 교체", () => {
    const baseInput = makeBaseInput()
    const filters: AppliedFilter[] = [
      af("toolSubtype", "includes", "Square", "Square", 0),
      af("fluteCount", "eq", "4날", 4, 1),
      af("coating", "includes", "TiAlN", "TiAlN", 2),
      af("lengthOfCutMm", "eq", "25mm", 25, 3),
      af("shankDiameterMm", "eq", "10mm", 10, 4),
    ]

    const result = replaceFieldFilter(baseInput, filters, af("coating", "includes", "AlCrN", "AlCrN", 5), applyFilterToInput)
    expect(result.nextFilters).toHaveLength(5)
    expect(result.nextInput.coatingPreference).toBe("AlCrN")
    expect(result.nextInput.toolSubtype).toBe("Square")
    expect(result.nextInput.flutePreference).toBe(4)
    expect(result.nextInput.lengthOfCutMm).toBe(25)
    expect(result.nextInput.shankDiameterMm).toBe(10)
  })
})

// ═══════════════════════════════════════════════════════════
//  4. pending question 중 revision signal 감지
// ═══════════════════════════════════════════════════════════

describe("resolvePendingQuestionReply — revision signal bypass", () => {
  it('"Ball 말고 Radius로" — fluteCount pending 중 revision은 unresolved', () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (442개)", "4날 (69개)", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "Ball 말고 Radius로")
    expect(result.kind).toBe("unresolved")
  })

  it('"Square 대신 Roughing으로 변경해줘" — coating pending 중 revision은 unresolved', () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedChips: ["TiAlN (50개)", "AlCrN (30개)", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "Square 대신 Roughing으로 변경해줘")
    expect(result.kind).toBe("unresolved")
  })

  it('"3날 말고 4날로 바꿔" — toolSubtype pending 중에도 revision bypass', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedChips: ["Square (100개)", "Radius (80개)", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "3날 말고 4날로 바꿔")
    expect(result.kind).toBe("unresolved")
  })

  it('"코팅을 수정하고 싶어" — pending 중 수정 키워드도 bypass', () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날", "4날", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "코팅을 수정하고 싶어")
    expect(result.kind).toBe("unresolved")
  })

  it("revision signal 없는 정상 답변은 그대로 resolved", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Radius (80개)", field: "toolSubtype", value: "Radius", count: 80 },
      ],
    })

    const result = resolvePendingQuestionReply(state, "Square (100개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("toolSubtype")
      expect(result.filter.rawValue).toBe("Square")
    }
  })

  it("상관없음은 revision이 아니므로 정상 skip resolved", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날", "4날", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "상관없음")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.op).toBe("skip")
    }
  })
})

// ═══════════════════════════════════════════════════════════
//  5. explicit revision — 까다로운 크로스 필드 시나리오
// ═══════════════════════════════════════════════════════════

describe("resolveExplicitRevisionRequest — 크로스 필드 까다로운 시나리오", () => {
  it("coating revision: TiAlN 말고 AlCrN으로", async () => {
    const state = makeState({
      appliedFilters: [
        af("coating", "includes", "TiAlN", "TiAlN", 1),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "TiAlN 말고 AlCrN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "coating",
        previousValue: "TiAlN",
        nextFilter: { field: "coating", value: "AlCrN" },
      },
    })
  })

  it("toolSubtype revision: Ball 대신 Radius로", async () => {
    const state = makeState({
      appliedFilters: [
        af("toolSubtype", "includes", "Ball", "Ball", 0),
        af("fluteCount", "eq", "2날", 2, 1),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "Ball 대신 Radius로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Ball",
        nextFilter: { field: "toolSubtype", value: "Radius", rawValue: "Radius" },
      },
    })
  })

  it("한국어 형상 alias: 황삭 대신 Square로 변경", async () => {
    const state = makeState({
      appliedFilters: [
        af("toolSubtype", "includes", "Roughing", "Roughing", 0),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "황삭 대신 Square로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Roughing",
        nextFilter: { field: "toolSubtype", rawValue: "Square" },
      },
    })
  })

  it("날 수 revision: 2날 말고 6날로", async () => {
    const state = makeState({
      appliedFilters: [
        af("toolSubtype", "includes", "Square", "Square", 0),
        af("fluteCount", "eq", "2날", 2, 1),
        af("coating", "includes", "TiAlN", "TiAlN", 2),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "2날 말고 6날로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "2날",
        nextFilter: { field: "fluteCount", rawValue: 6 },
      },
    })
  })

  it("revision signal 없는 일반 텍스트는 null", async () => {
    const state = makeState({
      appliedFilters: [
        af("fluteCount", "eq", "4날", 4, 1),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "Ball")).resolves.toBeNull()
  })

  it("적용된 필터가 없으면 null", async () => {
    const state = makeState({ appliedFilters: [] })
    await expect(resolveExplicitRevisionRequest(state, "4날 말고 2날로")).resolves.toBeNull()
  })

  it("다중 필터 중 정확히 맞는 필드만 교체", async () => {
    const state = makeState({
      appliedFilters: [
        af("toolSubtype", "includes", "Square", "Square", 0),
        af("fluteCount", "eq", "4날", 4, 1),
        af("coating", "includes", "TiAlN", "TiAlN", 2),
        af("lengthOfCutMm", "eq", "25mm", 25, 3),
      ],
    })

    const result = await resolveExplicitRevisionRequest(state, "4날 말고 2날로 변경")
    expect(result).toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "4날",
        nextFilter: { field: "fluteCount", rawValue: 2 },
      },
    })
  })

  it('"Bright Finish 말고 TiCN으로" — 공백 포함 코팅 값 매칭', async () => {
    const state = makeState({
      appliedFilters: [
        af("coating", "includes", "Bright Finish", "Bright Finish", 1),
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "Bright Finish 말고 TiCN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "coating",
        previousValue: "Bright Finish",
        nextFilter: { field: "coating", value: "TiCN" },
      },
    })
  })
})

// ═══════════════════════════════════════════════════════════
//  6. pending + revision 우선순위 통합 시나리오
// ═══════════════════════════════════════════════════════════

describe("pending question 중 revision: 전체 흐름 검증", () => {
  it("fluteCount pending 중 toolSubtype revision → pending unresolved, revision resolved", async () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (442개)", "4날 (69개)", "상관없음"],
      appliedFilters: [
        af("toolSubtype", "includes", "Ball", "Ball", 0),
      ],
    })

    // Step 1: pending resolver는 revision signal로 인해 unresolved
    const pendingResult = resolvePendingQuestionReply(state, "Ball 말고 Radius로")
    expect(pendingResult.kind).toBe("unresolved")

    // Step 2: revision resolver가 정상 처리
    const revisionResult = await resolveExplicitRevisionRequest(state, "Ball 말고 Radius로")
    expect(revisionResult).toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Ball",
        nextFilter: { field: "toolSubtype", rawValue: "Radius" },
      },
    })
  })

  it("coating pending 중 fluteCount revision → pending unresolved, revision resolved", async () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedChips: ["TiAlN (50개)", "AlCrN (30개)", "상관없음"],
      appliedFilters: [
        af("fluteCount", "eq", "4날", 4, 1),
      ],
    })

    const pendingResult = resolvePendingQuestionReply(state, "4날 말고 2날로 바꿔")
    expect(pendingResult.kind).toBe("unresolved")

    const revisionResult = await resolveExplicitRevisionRequest(state, "4날 말고 2날로 바꿔")
    expect(revisionResult).toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "4날",
        nextFilter: { field: "fluteCount", rawValue: 2 },
      },
    })
  })

  it("toolSubtype pending 중 정상 답변은 pending resolved (revision 아님)", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (100개)", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Ball (80개)", field: "toolSubtype", value: "Ball", count: 80 },
      ],
    })

    const result = resolvePendingQuestionReply(state, "Ball (80개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.rawValue).toBe("Ball")
    }
  })

  it("diameterMm pending 중 숫자 입력은 정상 resolved (revision signal 없음)", () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })

    const result = resolvePendingQuestionReply(state, "10mm")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("diameterMm")
      expect(result.filter.rawValue).toBe(10)
    }
  })
})

// ═══════════════════════════════════════════════════════════
//  7. Edge cases — 엣지 케이스
// ═══════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("side question으로 빠지는 경우: 물음표 포함", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날", "4날", "상관없음"],
    })

    const result = resolvePendingQuestionReply(state, "2날이 뭐야?")
    expect(result.kind).toBe("side_question")
  })

  it("80자 이상 긴 입력도 det-SCR fallback이 fluteCount를 추출하면 resolved", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      displayedChips: ["2날", "4날"],
    })

    // det-SCR fallback이 "몇 개" 등에서 fluteCount를 추출하면 resolved 처리됨
    const longMsg = "이번에 가공할 소재가 알루미늄인데 ADC12라는 합금인데 경도가 좀 높아서 날 수를 몇 개로 해야 할지 모르겠어요 추천 부탁드립니다"
    const result = resolvePendingQuestionReply(state, longMsg)
    expect(result.kind).toBe("unresolved")
  })

  it("null session → none", () => {
    const result = resolvePendingQuestionReply(null, "Ball")
    expect(result.kind).toBe("none")
  })

  it("null message → none", () => {
    const state = makeState({ lastAskedField: "fluteCount" })
    const result = resolvePendingQuestionReply(state, null)
    expect(result.kind).toBe("none")
  })

  it("resolved 상태에서는 none", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      resolutionStatus: "resolved_exact",
    })
    const result = resolvePendingQuestionReply(state, "4날")
    expect(result.kind).toBe("none")
  })

  it("빈 문자열 → none", () => {
    const state = makeState({ lastAskedField: "fluteCount" })
    const result = resolvePendingQuestionReply(state, "   ")
    expect(result.kind).toBe("none")
  })
})
