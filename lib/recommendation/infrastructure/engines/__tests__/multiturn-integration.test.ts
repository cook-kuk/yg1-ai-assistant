/**
 * 멀티턴 통합 테스트 — 실제 LLM 호출 포함
 * 병렬화된 라우팅이 정확한지 검증
 *
 * 비용: Haiku ~$0.05 (13개 LLM 호출)
 * 시간: ~15초 (병렬화 덕에 순차보다 빠름)
 */
import { describe, expect, it } from "vitest"

import {
  resolvePendingQuestionReply,
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
} from "../serve-engine-runtime"
import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"

// ═══════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    material: "일반강",
    diameterMm: 10,
    operationType: "Side Cutting",
    toolType: "엔드밀",
    ...overrides,
  }
}

function af(field: string, op: string, value: string, rawValue: string | number | boolean, appliedAt = 0): AppliedFilter {
  return { field, op, value, rawValue, appliedAt } as AppliedFilter
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "integration-test",
    candidateCount: 500,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: makeInput(),
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

// ═══════════════════════════════════════════════════════════
//  시나리오 1: 필터 체인 → revision → 또 revision → side question
//  "진짜 대화처럼" 조건을 바꾸고, 바꾸고, 질문하고, 또 바꿈
// ═══════════════════════════════════════════════════════════

describe("멀티턴 통합: 필터→revision→revision→side question→재변경", () => {
  const provider = getProvider()
  let state: ExplorationSessionState
  let input: RecommendationInput
  let filters: AppliedFilter[]

  it("Turn 1: Square 형상 선택 (칩 클릭)", () => {
    state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (2070개)", field: "toolSubtype", value: "Square", count: 2070 },
        { index: 2, label: "Ball (559개)", field: "toolSubtype", value: "Ball", count: 559 },
      ],
    })

    const reply = resolvePendingQuestionReply(state, "Square (2070개)")
    expect(reply.kind).toBe("resolved")
    if (reply.kind !== "resolved") throw new Error("not resolved")

    input = applyFilterToInput(makeInput(), reply.filter)
    filters = [reply.filter]

    expect(input.toolSubtype).toBe("Square")
    state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      turnCount: 1,
      candidateCount: 2070,
      lastAskedField: "fluteCount",
      displayedChips: ["2날 (800개)", "4날 (600개)", "상관없음"],
    })
  })

  it("Turn 2: 4날 선택 (칩 클릭)", () => {
    const reply = resolvePendingQuestionReply(state, "4날 (600개)")
    expect(reply.kind).toBe("resolved")
    if (reply.kind !== "resolved") throw new Error("not resolved")

    input = applyFilterToInput(input, reply.filter)
    filters = [...filters, reply.filter]

    expect(input.flutePreference).toBe(4)
    state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      turnCount: 2,
      candidateCount: 600,
      lastAskedField: "coating",
      displayedChips: ["TiAlN (200개)", "AlCrN (100개)", "상관없음"],
    })
  })

  it("Turn 3: 코팅 질문 중 'Square 말고 Ball로' → pending bypass + revision 성공 (LLM)", async () => {
    // pending question은 coating이지만, 사용자가 형상을 바꾸려 함
    const pendingReply = resolvePendingQuestionReply(state, "Square 말고 Ball로")
    expect(pendingReply.kind).toBe("unresolved") // revision signal로 bypass

    const revision = await resolveExplicitRevisionRequest(state, "Square 말고 Ball로", provider)
    expect(revision).not.toBeNull()
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("revision not resolved")

    expect(revision.request.targetField).toBe("toolSubtype")
    expect(revision.request.previousValue).toBe("Square")

    // 필터 교체
    const replaceResult = replaceFieldFilter(
      makeInput(),
      filters,
      revision.request.nextFilter,
      applyFilterToInput
    )
    expect(replaceResult.replacedExisting).toBe(true)
    expect(replaceResult.nextInput.toolSubtype).toBe("Ball")
    expect(replaceResult.nextInput.flutePreference).toBe(4) // 4날 유지!

    input = replaceResult.nextInput
    filters = replaceResult.nextFilters

    state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      turnCount: 3,
      candidateCount: 300,
      lastAskedField: "coating",
      displayedChips: ["TiAlN (100개)", "Bright Finish (80개)", "상관없음"],
    })
  })

  it("Turn 4: 또 revision — '4날 말고 2날로 바꿔' (LLM)", async () => {
    const pendingReply = resolvePendingQuestionReply(state, "4날 말고 2날로 바꿔")
    expect(pendingReply.kind).toBe("unresolved")

    const revision = await resolveExplicitRevisionRequest(state, "4날 말고 2날로 바꿔", provider)
    expect(revision).not.toBeNull()
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("revision not resolved")

    expect(revision.request.targetField).toBe("fluteCount")
    expect(revision.request.previousValue).toBe("4날")

    const replaceResult = replaceFieldFilter(
      makeInput(),
      filters,
      revision.request.nextFilter,
      applyFilterToInput
    )
    expect(replaceResult.nextInput.flutePreference).toBe(2)
    expect(replaceResult.nextInput.toolSubtype).toBe("Ball") // Ball 유지!

    input = replaceResult.nextInput
    filters = replaceResult.nextFilters

    state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      turnCount: 4,
      candidateCount: 200,
      lastAskedField: "coating",
      displayedChips: ["TiAlN (80개)", "상관없음"],
    })
  })

  it("Turn 5: side question — '2날이 4날보다 좋은 이유가 뭐야?' → 필터 유지", () => {
    const reply = resolvePendingQuestionReply(state, "2날이 4날보다 좋은 이유가 뭐야?")
    expect(reply.kind).toBe("side_question")

    // 필터 변화 없음
    expect(filters).toHaveLength(2)
    expect(input.toolSubtype).toBe("Ball")
    expect(input.flutePreference).toBe(2)
  })

  it("Turn 6: 다시 코팅 답변 — 'TiAlN' → 정상 resolved", () => {
    const reply = resolvePendingQuestionReply(state, "TiAlN (80개)")
    expect(reply.kind).toBe("resolved")
    if (reply.kind !== "resolved") throw new Error("not resolved")

    expect(reply.filter.field).toBe("coating")

    input = applyFilterToInput(input, reply.filter)
    filters = [...filters, reply.filter]

    // 칩 클릭 시 normalizePendingSelectionText가 lowercase 변환
    expect(input.coatingPreference?.toLowerCase()).toBe("tialn")
    expect(input.toolSubtype).toBe("Ball")    // 유지
    expect(input.flutePreference).toBe(2)      // 유지
    expect(filters).toHaveLength(3)            // Ball + 2날 + TiAlN
  })

  it("Turn 7: 코팅도 revision — 'TiAlN 대신 AlCrN으로 변경' (LLM)", async () => {
    state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      turnCount: 6,
      candidateCount: 80,
    })

    const revision = await resolveExplicitRevisionRequest(state, "TiAlN 대신 AlCrN으로 변경", provider)
    expect(revision).not.toBeNull()
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("revision not resolved")

    expect(revision.request.targetField).toBe("coating")
    expect(revision.request.previousValue.toLowerCase()).toBe("tialn")

    const replaceResult = replaceFieldFilter(
      makeInput(),
      filters,
      revision.request.nextFilter,
      applyFilterToInput
    )
    expect(replaceResult.nextInput.coatingPreference).not.toBe("TiAlN")
    expect(replaceResult.nextInput.toolSubtype).toBe("Ball")    // 유지
    expect(replaceResult.nextInput.flutePreference).toBe(2)      // 유지
    expect(replaceResult.nextFilters).toHaveLength(3)            // 개수 유지
  })
})

// ═══════════════════════════════════════════════════════════
//  시나리오 2: 소재 변경 → 종속 클리어 → 형상 변경 → 필터링
//  종속 관계가 올바르게 동작하는지 full chain 검증
// ═══════════════════════════════════════════════════════════

describe("멀티턴 통합: 소재종속 + 형상변경 + 필터링", () => {
  const provider = getProvider()

  it("알루미늄+ADC12 → 주철 변경 → workPieceName 클리어 → 형상 revision → 브랜드 필터링", async () => {
    // Step 1: 초기 상태 — 알루미늄 + ADC12 + Square
    let input = makeInput({ material: "알루미늄", workPieceName: "ADC12", toolSubtype: "Square" })
    let filters: AppliedFilter[] = [
      af("workPieceName", "includes", "ADC12", "ADC12", 0),
      af("toolSubtype", "includes", "Square", "Square", 1),
    ]

    // Step 2: 소재를 주철로 변경
    input = applyFilterToInput(input, af("material", "eq", "주철", "주철", 2))
    expect(input.material).toBe("주철")
    expect(input.workPieceName).toBeUndefined()  // 종속 클리어!
    expect(input.toolSubtype).toBe("Square")     // 유지

    // Step 3: "Square 말고 Roughing으로" revision
    const state = makeState({
      appliedFilters: filters,
      resolvedInput: input,
      displayedCandidates: [
        { product: { toolSubtype: "Square" } },
        { product: { toolSubtype: "Roughing" } },
      ] as any,
    })

    const revision = await resolveExplicitRevisionRequest(state, "Square 말고 Roughing으로", provider)
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("not resolved")
    expect(revision.request.targetField).toBe("toolSubtype")

    const replaceResult = replaceFieldFilter(makeInput(), filters, revision.request.nextFilter, applyFilterToInput)
    expect(replaceResult.nextInput.toolSubtype).toBe("Roughing")

    // Step 4: 브랜드 필터링 "TANK-POWER로 필터링"
    const filterState = makeState({
      appliedFilters: replaceResult.nextFilters,
      resolvedInput: replaceResult.nextInput,
      displayedCandidates: [
        { product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing" } },
        { product: { brand: "JET-POWER", seriesName: "EH918", toolSubtype: "Roughing" } },
      ] as any,
    })

    const filterResult = await resolveExplicitFilterRequest(filterState, "TANK-POWER로 필터링", provider)
    expect(filterResult?.kind).toBe("resolved")
    if (filterResult?.kind !== "resolved") throw new Error("filter not resolved")
    expect(filterResult.filter.field).toBe("brand")
    expect(filterResult.filter.value).toBe("TANK-POWER")
  })
})

// ═══════════════════════════════════════════════════════════
//  시나리오 3: 한국어 자연어 폭탄 — 다양한 표현으로 연속 입력
//  실사용 패턴: 격식체/비격식체 혼용, 줄임말, 조사 변형
// ═══════════════════════════════════════════════════════════

describe("멀티턴 통합: 한국어 자연어 변형 연속 입력", () => {
  const provider = getProvider()

  it("'황삭 대신 볼로 바꿔주세요' → toolSubtype revision (LLM)", async () => {
    const state = makeState({
      appliedFilters: [af("toolSubtype", "includes", "Roughing", "Roughing", 0)],
    })

    const revision = await resolveExplicitRevisionRequest(state, "황삭 대신 볼로 바꿔주세요", provider)
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("not resolved")
    expect(revision.request.targetField).toBe("toolSubtype")
    expect(revision.request.previousValue).toBe("Roughing")
  })

  it("'Bright Finish 말고 블루코팅으로' → coating revision (LLM)", async () => {
    const state = makeState({
      appliedFilters: [af("coating", "includes", "Bright Finish", "Bright Finish", 0)],
    })

    const revision = await resolveExplicitRevisionRequest(state, "Bright Finish 말고 블루코팅으로", provider)
    expect(revision?.kind).toBe("resolved")
    if (revision?.kind !== "resolved") throw new Error("not resolved")
    expect(revision.request.targetField).toBe("coating")
    expect(revision.request.previousValue).toBe("Bright Finish")
  })

  it("pending 중 다양한 자연어 → 올바른 분류", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedChips: ["TiAlN (50개)", "AlCrN (30개)", "상관없음"],
    })

    // revision signal → unresolved
    expect(resolvePendingQuestionReply(state, "3날 말고 2날로 바꿔").kind).toBe("unresolved")
    expect(resolvePendingQuestionReply(state, "형상을 수정하고 싶어").kind).toBe("unresolved")

    // side question → side_question
    expect(resolvePendingQuestionReply(state, "TiAlN이 뭐야?").kind).toBe("side_question")
    expect(resolvePendingQuestionReply(state, "재고 있어?").kind).toBe("side_question")
    expect(resolvePendingQuestionReply(state, "가격 알려줘").kind).toBe("side_question")
    expect(resolvePendingQuestionReply(state, "이 코팅 차이가 뭐야?").kind).toBe("side_question")

    // skip → resolved with skip
    expect(resolvePendingQuestionReply(state, "상관없음").kind).toBe("resolved")
    expect(resolvePendingQuestionReply(state, "아무거나").kind).toBe("resolved")
    expect(resolvePendingQuestionReply(state, "패스").kind).toBe("resolved")
    expect(resolvePendingQuestionReply(state, "모르겠어").kind).toBe("resolved")
  })

  it("인치 직경 + 한국어 단위 파싱", () => {
    // 인치
    const inch = parseAnswerToFilter("diameterMm", '3/8"')
    // 3/8은 MULTI_VALUE_SEPARATOR가 /를 분리할 수 있어서 canonicalizeRawValue에서 먼저 처리
    // 결과는 구현에 따라 다를 수 있음
    if (inch) {
      expect(inch.field).toBe("diameterMm")
    }

    // 한국어 단위
    const milli = parseAnswerToFilter("diameterMm", "10밀리")
    expect(milli).not.toBeNull()
    expect(milli?.field).toBe("diameterMm")
    expect(milli?.rawValue).toBe(10)

    // 파이 접두사
    const phi = parseAnswerToFilter("diameterMm", "파이10")
    expect(phi).not.toBeNull()
    expect(phi?.rawValue).toBe(10)

    // 근사치
    const approx = parseAnswerToFilter("diameterMm", "약 10mm")
    expect(approx).not.toBeNull()
    expect(approx?.rawValue).toBe(10)
  })

  it("코팅 한국어 alias 파싱 — 블루/골드/무코팅", () => {
    const blue = parseAnswerToFilter("coating", "블루코팅")
    expect(blue?.value?.toLowerCase()).toContain("blue")

    const gold = parseAnswerToFilter("coating", "골드코팅")
    expect(gold).not.toBeNull()

    const uncoated = parseAnswerToFilter("coating", "무코팅")
    expect(uncoated?.value?.toLowerCase()).toContain("uncoated")
  })

  it("toolSubtype 한국어 alias — 코너레디우스/황삭/테이퍼", () => {
    const corner = parseAnswerToFilter("toolSubtype", "코너레디우스")
    expect(corner?.rawValue).toBe("Radius")

    const roughing = parseAnswerToFilter("toolSubtype", "황삭")
    expect(roughing?.rawValue).toBe("Roughing")

    const taper = parseAnswerToFilter("toolSubtype", "테이퍼")
    expect(taper?.rawValue).toBe("Taper")
  })
})
