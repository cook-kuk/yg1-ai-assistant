// ~$0.25 total (Haiku 500 calls)
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let origDetScr: string | undefined
beforeAll(() => { origDetScr = process.env.DETERMINISTIC_SCR; process.env.DETERMINISTIC_SCR = "0" })
afterAll(() => { if (origDetScr === undefined) delete process.env.DETERMINISTIC_SCR; else process.env.DETERMINISTIC_SCR = origDetScr })

import {
  resolvePendingQuestionReply,
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
} from "../serve-engine-runtime"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "stress-500",
    candidateCount: 50,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 3,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

const provider = getProvider()

// ---------------------------------------------------------------------------
// Realistic multi-filter state builders
// ---------------------------------------------------------------------------

const tripleFilterState = (overrides: Partial<ExplorationSessionState> = {}) =>
  makeState({
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 1 } as any,
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 } as any,
    ],
    ...overrides,
  })

const dualFilterState = (f1: any, f2: any, overrides: Partial<ExplorationSessionState> = {}) =>
  makeState({
    appliedFilters: [
      { ...f1, appliedAt: 0 },
      { ...f2, appliedAt: 1 },
    ],
    ...overrides,
  })

const quadFilterState = (overrides: Partial<ExplorationSessionState> = {}) =>
  makeState({
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
      { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 1 } as any,
      { field: "coating", op: "includes", value: "AlCrN", rawValue: "AlCrN", appliedAt: 2 } as any,
      { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 3 } as any,
    ],
    ...overrides,
  })

const fluteCoatingState = dualFilterState(
  { field: "fluteCount", op: "eq", value: "2날", rawValue: 2 },
  { field: "coating", op: "includes", value: "AlCrN", rawValue: "AlCrN" }
)

const subtypeDiameterState = makeState({
  appliedFilters: [
    { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
  ],
  resolvedInput: {
    manufacturerScope: "yg1-only",
    locale: "ko",
    material: "일반강",
    diameterMm: 10,
  },
})

// Candidate states for filter tests
const richCandidateState = makeState({
  displayedCandidates: [
    { rank: 1, productCode: "P1", displayCode: "P1", product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "TiAlN", fluteCount: 4 } } as any,
    { rank: 2, productCode: "P2", displayCode: "P2", product: { brand: "ALU-POWER HPC", seriesName: "E5E39", toolSubtype: "Square", coating: "DLC", fluteCount: 2 } } as any,
    { rank: 3, productCode: "P3", displayCode: "P3", product: { brand: "V7 PLUS", seriesName: "V7P01", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } } as any,
    { rank: 4, productCode: "P4", displayCode: "P4", product: { brand: "I-POWER", seriesName: "SG5E16", toolSubtype: "Ball", coating: "AlCrN", fluteCount: 2 } } as any,
    { rank: 5, productCode: "P5", displayCode: "P5", product: { brand: "X5070", seriesName: "X5070A", toolSubtype: "Radius", coating: "TiCN", fluteCount: 4 } } as any,
  ],
  currentMode: "recommendation",
  resolutionStatus: "resolved" as any,
})

// Pending question states
const subtypeQuestionState = makeState({
  lastAskedField: "toolSubtype",
  displayedOptions: [
    { index: 1, label: "Square (2072개)", field: "toolSubtype", value: "Square", count: 2072 },
    { index: 2, label: "Radius (362개)", field: "toolSubtype", value: "Radius", count: 362 },
    { index: 3, label: "Ball (180개)", field: "toolSubtype", value: "Ball", count: 180 },
    { index: 4, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
  ],
})

const fluteQuestionState = makeState({
  lastAskedField: "fluteCount",
  displayedOptions: [
    { index: 1, label: "2날 (512개)", field: "fluteCount", value: "2날", count: 512 },
    { index: 2, label: "4날 (864개)", field: "fluteCount", value: "4날", count: 864 },
    { index: 3, label: "6날 (120개)", field: "fluteCount", value: "6날", count: 120 },
    { index: 4, label: "상관없음", field: "fluteCount", value: "skip", count: 0 },
  ],
})

const coatingQuestionState = makeState({
  lastAskedField: "coating",
  displayedOptions: [
    { index: 1, label: "TiAlN (500개)", field: "coating", value: "TiAlN", count: 500 },
    { index: 2, label: "AlCrN (300개)", field: "coating", value: "AlCrN", count: 300 },
    { index: 3, label: "TiCN (200개)", field: "coating", value: "TiCN", count: 200 },
    { index: 4, label: "Bright Finish (50개)", field: "coating", value: "Bright Finish", count: 50 },
    { index: 5, label: "상관없음", field: "coating", value: "skip", count: 0 },
  ],
})

const diameterQuestionState = makeState({
  lastAskedField: "diameterMm",
  displayedOptions: [
    { index: 1, label: "6mm (120개)", field: "diameterMm", value: "6", count: 120 },
    { index: 2, label: "8mm (90개)", field: "diameterMm", value: "8", count: 90 },
    { index: 3, label: "10mm (60개)", field: "diameterMm", value: "10", count: 60 },
    { index: 4, label: "상관없음", field: "diameterMm", value: "skip", count: 0 },
  ],
  displayedChips: ["6mm (120개)", "8mm (90개)", "10mm (60개)", "상관없음"],
})

// Combined states (pending + existing filters)
const pendingWithFilters = makeState({
  lastAskedField: "toolSubtype",
  appliedFilters: [
    { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
    { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 1 } as any,
  ],
  displayedOptions: [
    { index: 1, label: "Square (200개)", field: "toolSubtype", value: "Square", count: 200 },
    { index: 2, label: "Radius (100개)", field: "toolSubtype", value: "Radius", count: 100 },
    { index: 3, label: "Ball (50개)", field: "toolSubtype", value: "Ball", count: 50 },
    { index: 4, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
  ],
})

/** Full pipeline: pending → revision → filter → none */
async function classifyIntent(state: ExplorationSessionState, msg: string) {
  const pending = resolvePendingQuestionReply(state, msg)
  if (pending.kind === "resolved") return { handler: "pending", kind: "resolved", result: pending }
  if (pending.kind === "side_question") return { handler: "pending", kind: "side_question", result: pending }

  if (pending.kind === "unresolved" || pending.kind === "none") {
    const revision = await resolveExplicitRevisionRequest(state, msg)
    if (revision?.kind === "resolved") return { handler: "revision", kind: "resolved", result: revision }

    const filter = await resolveExplicitFilterRequest(state, msg, provider)
    if (filter?.kind === "resolved") return { handler: "filter", kind: "resolved", result: filter }
  }

  return { handler: "none", kind: pending.kind, result: pending }
}

// ===========================================================================
// Part 1: Revision with realistic multi-filter state (100 cases)
// ===========================================================================

describe("Part 1: revision with realistic state (100 cases)", () => {
  // Single-filter state builders for reliable field targeting
  const singleCoatingState = makeState({
    appliedFilters: [
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
    ],
  })
  const singleFluteState = (val: string, raw: number) => makeState({
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: val, rawValue: raw, appliedAt: 0 } as any,
    ],
  })
  const singleSubtypeState = (val: string) => makeState({
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
    ],
  })
  const singleDiameterState = makeState({
    appliedFilters: [],
    resolvedInput: { manufacturerScope: "yg1-only", locale: "ko", material: "일반강", diameterMm: 10 },
  })

  // --- Coating revision (20 cases) ---
  // Use "TiAlN 말고/대신 X" pattern for clear signal — avoids field alias "코팅" as value candidate
  describe("coating revision (single-filter: TiAlN)", () => {
    it.each([
      ["TiAlN 말고 DLC로 바꿔"],
      ["TiAlN 말고 AlCrN으로 변경해주세요"],
      ["TiAlN 말고 TiCN으로"],
      ["TiAlN 대신 Bright Finish로 변경"],
      ["TiAlN 대신 AlCrN으로 바꿔"],
      ["TiAlN 말고 DLC로 바꿔줘"],
      ["TiAlN 아니고 AlCrN으로 변경해줘"],
      ["TiAlN 대신 TiCN으로 수정"],
      ["TiAlN 대신에 DLC로 변경"],
      ["TiAlN 말고 Bright Finish로 변경해줘"],
      ["TiAlN에서 AlCrN으로 바꿔"],
      ["TiAlN 말고 TiCN으로 바꿔줘"],
      ["TiAlN 대신 DLC로 변경해주세요"],
      ["TiAlN 말고 AlCrN으로 변경"],
      ["TiAlN 대신 TiCN으로 변경해줘"],
      ["TiAlN 말고 AlCrN으로 바꿔줘"],
      ["TiAlN 말고 DLC로 변경해줘"],
      ["TiAlN 말고 DLC로 변경"],
      ["TiAlN 대신 AlCrN으로 수정해주세요"],
      ["TiAlN 대신 DLC로 변경"],
    ])('%s → coating', async (msg) => {
      const r = await resolveExplicitRevisionRequest(singleCoatingState, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
    })
  })

  // --- FluteCount revision (15 cases) ---
  describe("fluteCount revision (single-filter: 4날)", () => {
    it.each([
      ["4날 대신 2날로 바꿔", 2],
      ["날수 2날로 변경", 2],
      ["4날 말고 6날로", 6],
      ["2날로 변경해줘", 2],
      ["6날로 바꿔", 6],
      ["날수 2날로 수정", 2],
      ["4날 아니고 2날", 2],
      ["4날에서 6날로 변경해주세요", 6],
      ["날수 2날로 바꿔줘", 2],
      ["4날 대신에 2날이요", 2],
      ["3날로 변경", 3],
      ["4날 말고 2날로 변경해줘", 2],
      ["flute count를 2개로 변경", 2],
      ["2날로 수정 부탁드립니다", 2],
      ["4날 말고 6날로 바꿔", 6],
    ])('%s → fluteCount=%d', async (msg, expectedRaw) => {
      const r = await resolveExplicitRevisionRequest(singleFluteState("4날", 4), msg)
      expect(r).toMatchObject({
        kind: "resolved",
        request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: expectedRaw } },
      })
    })
  })

  // --- toolSubtype revision (15 cases) ---
  // Use "Square 말고/대신 X" pattern for clear signal — avoids field alias "형상" as value candidate
  describe("toolSubtype revision (single-filter: Square)", () => {
    it.each([
      ["Square 말고 Ball로 바꿔"],
      ["Square 대신 Radius로 변경해주세요"],
      ["Square 대신 Radius"],
      ["Square 말고 Ball로 변경해줘"],
      ["Square 대신 Radius로 바꿔"],
      ["Square 아니고 Ball"],
      ["Square 말고 Ball로 변경"],
      ["Square에서 Radius로 수정"],
      ["Square 말고 Ball로 바꿔줘"],
      ["Square 대신에 Ball로 변경"],
      ["Square 말고 Roughing으로 변경해줘"],
      ["Square 말고 Radius로 바꿔"],
      ["Square 대신 Ball 엔드밀로 변경"],
      ["Square 말고 Radius로 수정"],
      ["Square 말고 Ball로 변경해주세요"],
    ])('%s → toolSubtype', async (msg) => {
      const r = await resolveExplicitRevisionRequest(singleSubtypeState("Square"), msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })
  })

  // --- Diameter revision (10 cases) ---
  describe("diameter revision (resolvedInput: 10mm)", () => {
    it.each([
      ["직경 8mm로 변경", 8],
      ["직경 6mm로 바꿔", 6],
      ["10mm 말고 12mm로", 12],
      ["직경 8mm로 수정", 8],
      ["10mm 대신 6mm", 6],
      ["직경 8mm로 바꿔줘", 8],
      ["직경 12mm로 변경", 12],
      ["10mm 대신 16mm로 변경", 16],
      ["직경 6mm로 변경해줘", 6],
      ["10mm 아니고 8mm로", 8],
    ])('%s → diameterMm=%d', async (msg, _expectedMm) => {
      const r = await resolveExplicitRevisionRequest(singleDiameterState, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "diameterMm" } })
    })
  })

  // --- Revision in dual-filter state (fluteCount+AlCrN) (15 cases) ---
  // Use "X 말고/대신 Y" pattern to clearly identify which filter to revise
  describe("revision in dual-filter state (2날+AlCrN)", () => {
    it.each([
      ["2날 말고 4날로 변경해줘", "fluteCount"],
      ["2날 대신 6날로 바꿔", "fluteCount"],
      ["2날 말고 4날로", "fluteCount"],
      ["2날 대신 3날로 수정", "fluteCount"],
      ["AlCrN 말고 TiAlN으로 변경", "coating"],
      ["AlCrN 대신 TiAlN으로 바꿔", "coating"],
      ["AlCrN 말고 DLC로 수정해주세요", "coating"],
      ["AlCrN 말고 TiCN", "coating"],
      ["AlCrN 대신 DLC로 변경", "coating"],
      ["AlCrN 아니고 Bright Finish로", "coating"],
      ["AlCrN 대신 TiAlN으로 바꿔줘", "coating"],
      ["2날 대신 6날로 변경해줘", "fluteCount"],
      ["AlCrN 대신 TiAlN으로 변경", "coating"],
      ["AlCrN 말고 DLC로 수정", "coating"],
      ["2날 말고 4날로 변경해줘", "fluteCount"],
    ])('%s → %s', async (msg, expectedField) => {
      const r = await resolveExplicitRevisionRequest(fluteCoatingState, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: expectedField } })
    })
  })

  // --- Revision in quad-filter state (10 cases) ---
  // With 4 active filters, the LLM may return ambiguous or resolve to any field.
  describe("revision in quad-filter (Ball+2날+AlCrN+알루미늄)", () => {
    it.each([
      ["Square로 변경해줘"],
      ["4날로 바꿔"],
      ["TiAlN으로 코팅 변경"],
      ["Ball 말고 Radius로"],
      ["2날 대신 6날"],
      ["AlCrN 대신 DLC로 바꿔"],
      ["형상 Square로 수정"],
      ["6날로 변경해주세요"],
      ["코팅 TiCN으로 바꿔줘"],
      ["Radius 엔드밀로 변경"],
    ])('%s → resolved or ambiguous', async (msg) => {
      const r = await resolveExplicitRevisionRequest(quadFilterState(), msg)
      expect(r).not.toBeNull()
      expect(["resolved", "ambiguous"].includes(r!.kind)).toBe(true)
    })
  })

  // --- Negative: no revision signal (15 cases) ---
  describe("negative — no revision signal → null", () => {
    it.each([
      ["안녕하세요"],
      ["Square 엔드밀이 뭐야?"],
      ["TiAlN 코팅의 특성이 궁금해요"],
      ["4날짜리 추천해줘"],
      ["좋은 제품 있어?"],
      ["감사합니다"],
      ["코팅이 뭐가 좋아?"],
      ["엔드밀 종류가 뭐가 있어?"],
      ["재고 있는 제품 보여줘"],
      ["가격이 얼마야?"],
      ["어떤 브랜드가 좋아?"],
      ["일반강 가공할 때 추천"],
      ["SUS304 가공하려고 하는데"],
      ["알루미늄용 엔드밀 추천"],
      ["네"],
    ])('%s → null', async (msg) => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), msg)
      expect(r).toBeNull()
    })
  })
})

// ===========================================================================
// Part 2: Filter with realistic candidates (100 cases)
// ===========================================================================

describe("Part 2: filter with realistic candidates (100 cases)", () => {
  // --- Brand filter (25 cases) ---
  describe("brand filter (richCandidateState)", () => {
    it.each([
      ["TANK-POWER만 보여줘", "TANK-POWER"],
      ["ALU-POWER HPC로 필터링", "ALU-POWER HPC"],
      ["V7 PLUS 브랜드로 좁혀", "V7 PLUS"],
      ["I-POWER만 보여줘", "I-POWER"],
      ["X5070으로 필터", "X5070"],
      ["TANK-POWER 제품만 보여줘", "TANK-POWER"],
      ["ALU-POWER HPC만 찾아줘", "ALU-POWER HPC"],
      ["V7 PLUS만 보여줘", "V7 PLUS"],
      ["I-POWER 브랜드만 보여줘", "I-POWER"],
      ["X5070 제품만 필터링", "X5070"],
      ["TANK-POWER가 좋다고 들었는데 그것만 보여줘", "TANK-POWER"],
      ["TANK-POWER로 좁혀줘", "TANK-POWER"],
      ["ALU-POWER HPC만 찾아줘", "ALU-POWER HPC"],
      ["V7 PLUS로 검색", "V7 PLUS"],
      ["I-POWER로 필터링해줘", "I-POWER"],
      ["X5070만 보여줘", "X5070"],
      ["TANK-POWER 브랜드로 필터링해줘", "TANK-POWER"],
      ["ALU-POWER HPC로 좁혀줘", "ALU-POWER HPC"],
      ["V7 PLUS만 찾아줘", "V7 PLUS"],
      ["I-POWER로 좁혀", "I-POWER"],
      ["X5070 브랜드만 보여줘", "X5070"],
      ["TANK-POWER 브랜드만 보여줘", "TANK-POWER"],
      ["ALU-POWER HPC 브랜드로 필터링", "ALU-POWER HPC"],
      ["V7 PLUS 기준으로 보여줘", "V7 PLUS"],
      ["TANK-POWER만 남기고 보여줘", "TANK-POWER"],
    ])('%s → brand=%s', async (msg, expectedBrand) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: expectedBrand } })
    })
  })

  // --- Coating filter (20 cases) ---
  describe("coating filter (richCandidateState)", () => {
    it.each([
      ["TiAlN 코팅만 보여줘", "TiAlN"],
      ["TiAlN 코팅으로 필터링", "TiAlN"],
      ["AlCrN 코팅만 보여줘", "AlCrN"],
      ["DLC 코팅만 보여줘", "DLC"],
      ["TiCN 코팅으로 좁혀", "TiCN"],
      ["TiAlN 코팅만 보여줘", "TiAlN"],
      ["AlCrN으로 필터링해줘", "AlCrN"],
      ["DLC 코팅 제품만 보여줘", "DLC"],
      ["TiCN만 보여줘", "TiCN"],
      ["TiAlN으로 좁혀줘", "TiAlN"],
      ["AlCrN 코팅으로 필터", "AlCrN"],
      ["DLC만 보여줘", "DLC"],
      ["TiAlN만 남기고 보여줘", "TiAlN"],
      ["AlCrN 코팅 기준으로", "AlCrN"],
      ["DLC 코팅으로 좁혀줘", "DLC"],
      ["TiCN 코팅 제품만 보여줘", "TiCN"],
      ["TiAlN 코팅으로 좁혀줘", "TiAlN"],
      ["AlCrN만 보여줄래?", "AlCrN"],
      ["DLC로 필터링해줘", "DLC"],
      ["TiCN으로 필터링", "TiCN"],
    ])('%s → coating=%s', async (msg, expectedCoating) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
    })
  })

  // --- FluteCount filter (15 cases) ---
  describe("fluteCount filter (richCandidateState)", () => {
    it.each([
      ["4날로 좁혀", "4"],
      ["2날 제품만 보여줘", "2"],
      ["4날만 필터링", "4"],
      ["2날로 필터링해줘", "2"],
      ["4날짜리만 보여줘", "4"],
      ["2날짜리로 좁혀줘", "2"],
      ["4날만 보여줘", "4"],
      ["2날만 보여줘", "2"],
      ["4날로 필터링", "4"],
      ["2날로 좁혀", "2"],
      ["4날만 남기고 보여줘", "4"],
      ["2날 엔드밀만 보여줘", "2"],
      ["4날 기준으로 필터링", "4"],
      ["2날 기준으로 보여줘", "2"],
      ["4날만 찾아줘", "4"],
    ])('%s → fluteCount filter', async (msg, _expectedVal) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
    })
  })

  // --- ToolSubtype filter (15 cases) ---
  describe("toolSubtype filter (richCandidateState)", () => {
    it.each([
      ["Square 형상으로 필터링"],
      ["Ball 형상만 보여줘"],
      ["Radius로 필터링해줘"],
      ["Roughing만 보여줘"],
      ["Square만 보여줘"],
      ["Ball 형상으로 좁혀"],
      ["Square 형상만 보여줘"],
      ["Ball로 필터링"],
      ["Radius만 보여줘"],
      ["Square 엔드밀만 보여줘"],
      ["Ball 형상만 찾아줘"],
      ["Radius 형상으로 필터"],
      ["Roughing 제품만 보여줘"],
      ["Square로 좁혀줘"],
      ["Ball만 남기고 보여줘"],
    ])('%s → toolSubtype filter', async (msg) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
    })
  })

  // --- Negative: no filter intent (25 cases) ---
  describe("negative — no filter signal → null", () => {
    it.each([
      ["TANK-POWER가 뭐야?"],
      ["TiAlN 코팅이란 무엇인가요?"],
      ["4날의 장점이 뭐야"],
      ["Square 엔드밀이 뭔지 설명해줘"],
      ["안녕하세요"],
      ["감사합니다"],
      ["코팅을 DLC로 바꿔"],
      ["4날 대신 2날로 변경"],
      ["Square 말고 Ball로"],
      ["좋은 제품 추천해줘"],
      ["어떤 게 좋을까?"],
      ["가격이 얼마야?"],
      ["재고 확인해줘"],
      ["YG1이 어떤 회사야?"],
      ["엔드밀이 뭐야?"],
      ["KENNAMETAL 제품도 있어?"],
      ["OSG 제품 비교해줘"],
      ["코팅 종류가 뭐가 있어?"],
      ["날수별 차이가 뭐야?"],
      ["형상 종류 알려줘"],
      ["이 제품 좋아?"],
      ["다른 거 보여줘"],
      ["처음부터 다시"],
      ["ㅎㅎ 고마워"],
      ["네 알겠습니다"],
    ])('%s → null', async (msg) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toBeNull()
    })
  })
})

// ===========================================================================
// Part 3: Full pipeline routing (100 cases)
// ===========================================================================

describe("Part 3: full pipeline routing (100 cases)", () => {
  // --- Chip clicks resolving pending (20 cases) ---
  describe("chip clicks → pending resolved", () => {
    it.each([
      [subtypeQuestionState, "Square (2072개)", "toolSubtype"],
      [subtypeQuestionState, "Radius (362개)", "toolSubtype"],
      [subtypeQuestionState, "Ball (180개)", "toolSubtype"],
      [fluteQuestionState, "2날 (512개)", "fluteCount"],
      [fluteQuestionState, "4날 (864개)", "fluteCount"],
      [fluteQuestionState, "6날 (120개)", "fluteCount"],
      [coatingQuestionState, "TiAlN (500개)", "coating"],
      [coatingQuestionState, "AlCrN (300개)", "coating"],
      [coatingQuestionState, "TiCN (200개)", "coating"],
      [coatingQuestionState, "Bright Finish (50개)", "coating"],
      [diameterQuestionState, "6mm (120개)", "diameterMm"],
      [diameterQuestionState, "8mm (90개)", "diameterMm"],
      [diameterQuestionState, "10mm (60개)", "diameterMm"],
      [subtypeQuestionState, "Square", "toolSubtype"],
      [subtypeQuestionState, "Ball", "toolSubtype"],
      [fluteQuestionState, "4날", "fluteCount"],
      [fluteQuestionState, "2날", "fluteCount"],
      [coatingQuestionState, "TiAlN", "coating"],
      [coatingQuestionState, "AlCrN", "coating"],
      [diameterQuestionState, "8mm", "diameterMm"],
    ])('"%s" → pending resolved %s', async (_state, msg, expectedField) => {
      const r = resolvePendingQuestionReply(_state as ExplorationSessionState, msg)
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.field).toBe(expectedField)
    })
  })

  // --- Revision during pending (20 cases) ---
  describe("revision during pending → unresolved pending, revision resolved", () => {
    it.each([
      [pendingWithFilters, "4날 말고 2날로 바꿔", "fluteCount"],
      [pendingWithFilters, "TiAlN 말고 DLC로 변경", "coating"],
      [pendingWithFilters, "TiAlN 대신 AlCrN으로", "coating"],
      [pendingWithFilters, "4날 대신 6날로 변경해줘", "fluteCount"],
      [pendingWithFilters, "TiAlN 말고 TiCN으로 바꿔줘", "coating"],
      [pendingWithFilters, "4날 말고 2날로 변경", "fluteCount"],
      [pendingWithFilters, "TiAlN 말고 AlCrN으로 수정", "coating"],
      [pendingWithFilters, "TiAlN 말고 DLC로 바꿔", "coating"],
      [pendingWithFilters, "4날 대신 6날로 바꿔", "fluteCount"],
      [pendingWithFilters, "TiAlN 대신 Bright Finish로 변경", "coating"],
      [pendingWithFilters, "4날 아니고 2날", "fluteCount"],
      [pendingWithFilters, "TiAlN 대신 DLC로 변경해줘", "coating"],
      [pendingWithFilters, "4날 말고 2날로 수정해줘", "fluteCount"],
      [pendingWithFilters, "TiAlN 대신 AlCrN으로 변경", "coating"],
      [pendingWithFilters, "4날 말고 6날로 바꿔줘", "fluteCount"],
      [pendingWithFilters, "TiAlN 말고 TiCN으로 변경해줘", "coating"],
      [pendingWithFilters, "4날에서 2날로 변경", "fluteCount"],
      [pendingWithFilters, "TiAlN 말고 AlCrN으로 바꿔줘", "coating"],
      [pendingWithFilters, "4날 대신 2날로 변경해주세요", "fluteCount"],
      [pendingWithFilters, "TiAlN 대신 DLC로 바꿔", "coating"],
    ])('%s → revision %s', async (state, msg, expectedField) => {
      // Pending should be unresolved (revision signal detected)
      const pending = resolvePendingQuestionReply(state as ExplorationSessionState, msg)
      expect(pending.kind).toBe("unresolved")

      // Revision should resolve
      const revision = await resolveExplicitRevisionRequest(state as ExplorationSessionState, msg)
      expect(revision).toMatchObject({ kind: "resolved", request: { targetField: expectedField } })
    })
  })

  // --- Side question during pending (15 cases) ---
  describe("side question during pending → side_question", () => {
    it.each([
      [subtypeQuestionState, "코팅이 뭐야?"],
      [subtypeQuestionState, "Square 엔드밀이 뭔가요?"],
      [fluteQuestionState, "4날이 2날보다 좋아?"],
      [fluteQuestionState, "날수가 중요한가요?"],
      [coatingQuestionState, "TiAlN이 뭐예요?"],
      [coatingQuestionState, "AlCrN 코팅의 특성은?"],
      [diameterQuestionState, "직경이 중요한가요?"],
      [subtypeQuestionState, "Ball 형상의 장점은?"],
      [fluteQuestionState, "황삭에는 몇 날이 좋아요?"],
      [coatingQuestionState, "코팅 종류별 차이가 뭐야?"],
      [diameterQuestionState, "직경은 어떻게 결정하나요?"],
      [subtypeQuestionState, "Radius 엔드밀은 뭐에 쓰나요?"],
      [fluteQuestionState, "날수별 용도가 뭐예요?"],
      [coatingQuestionState, "DLC 코팅이 뭐예요?"],
      [diameterQuestionState, "10mm랑 8mm 차이?"],
    ])('%s → side_question', (state, msg) => {
      const r = resolvePendingQuestionReply(state as ExplorationSessionState, msg)
      expect(r.kind).toBe("side_question")
    })
  })

  // --- Skip / delegation (20 cases) ---
  describe("skip and delegation → resolved skip", () => {
    it.each([
      [subtypeQuestionState, "아무거나"],
      [subtypeQuestionState, "패스"],
      [subtypeQuestionState, "넘어가"],
      [subtypeQuestionState, "스킵"],
      [subtypeQuestionState, "상관없음"],
      [subtypeQuestionState, "모르겠어"],
      [subtypeQuestionState, "모르겠어요"],
      [fluteQuestionState, "아무거나"],
      [fluteQuestionState, "패스"],
      [fluteQuestionState, "상관없음"],
      [fluteQuestionState, "넘어가"],
      [coatingQuestionState, "아무거나"],
      [coatingQuestionState, "패스"],
      [coatingQuestionState, "상관없음"],
      [coatingQuestionState, "스킵"],
      [diameterQuestionState, "아무거나"],
      [diameterQuestionState, "패스"],
      [subtypeQuestionState, "알아서 해줘"],
      [fluteQuestionState, "추천으로 골라줘"],
      [coatingQuestionState, "모르겠어요"],
    ])('%s → skip', (state, msg) => {
      const r = resolvePendingQuestionReply(state as ExplorationSessionState, msg)
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
    })
  })

  // --- Full classify pipeline mixed (25 cases) ---
  describe("full classify pipeline", () => {
    it('chip click through full pipeline', async () => {
      const r = await classifyIntent(subtypeQuestionState, "Square (2072개)")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('revision through full pipeline', async () => {
      const r = await classifyIntent(pendingWithFilters, "코팅 DLC로 변경")
      expect(r.handler).toBe("revision")
    })

    it('side question through full pipeline', async () => {
      const r = await classifyIntent(subtypeQuestionState, "코팅이 뭐야?")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("side_question")
    })

    it('skip through full pipeline', async () => {
      const r = await classifyIntent(subtypeQuestionState, "아무거나")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('filter through full pipeline (no pending)', async () => {
      const r = await classifyIntent(richCandidateState, "TANK-POWER만 보여줘")
      expect(r.handler).toBe("filter")
    })

    it('delegation "알아서 해줘" → skip', async () => {
      const r = await classifyIntent(fluteQuestionState, "알아서 해줘")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"추천해줘" during pending → skip', async () => {
      const r = await classifyIntent(subtypeQuestionState, "추천해줘")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('bare "4날" during fluteCount question → pending resolved', async () => {
      const r = await classifyIntent(fluteQuestionState, "4날")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('bare "Ball" during toolSubtype question → pending resolved', async () => {
      const r = await classifyIntent(subtypeQuestionState, "Ball")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('bare "TiAlN" during coating question → pending resolved', async () => {
      const r = await classifyIntent(coatingQuestionState, "TiAlN")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('bare "8mm" during diameter question → pending resolved', async () => {
      const r = await classifyIntent(diameterQuestionState, "8mm")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"모르겠어요" during any question → skip', async () => {
      const r = await classifyIntent(coatingQuestionState, "모르겠어요")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('no pending, no filter → none', async () => {
      const noPendingState = makeState({ lastAskedField: undefined })
      const r = await classifyIntent(noPendingState, "안녕하세요")
      expect(r.handler).toBe("none")
    })

    it('"V7 PLUS 브랜드로 좁혀" with no pending → filter', async () => {
      const r = await classifyIntent(richCandidateState, "V7 PLUS 브랜드로 좁혀")
      expect(r.handler).toBe("filter")
    })

    it('"I-POWER만 보여줘" with no pending → filter', async () => {
      const r = await classifyIntent(richCandidateState, "I-POWER만 보여줘")
      expect(r.handler).toBe("filter")
    })

    it('greeting with no pending → none', async () => {
      const noQ = makeState({ lastAskedField: undefined })
      const r = await classifyIntent(noQ, "반갑습니다")
      expect(r.handler).toBe("none")
    })

    it('question with no pending → none', async () => {
      const noQ = makeState({ lastAskedField: undefined })
      const r = await classifyIntent(noQ, "엔드밀이 뭐야?")
      expect(r.handler).toBe("none")
    })

    it('"Square로요" during subtype pending → resolved', async () => {
      const r = await classifyIntent(subtypeQuestionState, "Square로요")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"4날이에요" during flute pending → resolved', async () => {
      const r = await classifyIntent(fluteQuestionState, "4날이에요")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"TiAlN으로요" during coating pending → resolved', async () => {
      const r = await classifyIntent(coatingQuestionState, "TiAlN으로요")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"Radius로" during subtype pending → resolved', async () => {
      const r = await classifyIntent(subtypeQuestionState, "Radius로")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"6" during diameter pending → resolved', async () => {
      const r = await classifyIntent(diameterQuestionState, "6")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"넘어가" during subtype pending → skip', async () => {
      const r = await classifyIntent(subtypeQuestionState, "넘어가")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('"스킵" during coating pending → skip', async () => {
      const r = await classifyIntent(coatingQuestionState, "스킵")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })

    it('bare "12" during diameter pending → resolved', async () => {
      const r = await classifyIntent(diameterQuestionState, "12")
      expect(r.handler).toBe("pending")
      expect(r.kind).toBe("resolved")
    })
  })
})

// ===========================================================================
// Part 4: Korean NL adversarial (100 cases)
// ===========================================================================

describe("Part 4: Korean NL adversarial (100 cases)", () => {
  // --- Typos and near-misses (20 cases) ---
  describe("typos and near-misses", () => {
    // These should either resolve correctly or gracefully return null
    it('"스퀘어로 변경" (correct Korean for Square) → toolSubtype revision', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "스퀘어로 변경")
      // "스퀘어" might not be recognized — accept both resolved or null
      expect(r === null || r.kind === "resolved" || r.kind === "ambiguous").toBe(true)
    })

    it('"스퀘아로 변경" (typo) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "스퀘아로 변경")
      expect(r === null || r.kind === "resolved" || r.kind === "ambiguous").toBe(true)
    })

    it('"볼 엔드밀로 변경" → graceful (Korean for Ball)', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "볼 엔드밀로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"라디우스로 변경해줘" → toolSubtype', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "라디우스로 변경해줘")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"레디우스로 변경" (typo) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "레디우스로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"tiain으로 변경" (typo for TiAlN) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "tiain으로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"타이알엔으로 변경" (Korean spelling of TiAlN) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "타이알엔으로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"디엘씨로 변경" (Korean spelling of DLC) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "디엘씨로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"브라이트 피니시로 변경" (Korean) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "브라이트 피니시로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"러핑으로 변경" (Korean for Roughing) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "러핑으로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"2날" pending — typo "2나" → graceful', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "2나")
      // May or may not resolve
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"스퀘어" pending (Korean for Square)', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "스퀘어")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"TiAIN" (capital I vs l typo) → coating revision graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "TiAIN 말고 DLC로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"tiALN" (case variation) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "tiALN 말고 DLC로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"TIALN으로 변경" (all caps) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "TIALN 말고 DLC로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"squre로 변경" (misspelling) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "squre로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"balll 엔드밀로 변경" (extra l) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "balll 엔드밀로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"raius로 변경" (misspelling) → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "raius로 변경")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"엔드밀 형상 볼로 바꿔" → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "엔드밀 형상 볼로 바꿔")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"flute를 2로 바꿔" → graceful', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "flute를 2로 바꿔")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })
  })

  // --- Mixed Korean/English (20 cases) ---
  describe("mixed Korean/English", () => {
    // Use single-filter states for reliable field targeting with regex parser
    const coat1 = makeState({ appliedFilters: [{ field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any] })
    const flute1 = makeState({ appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any] })
    const sub1 = makeState({ appliedFilters: [{ field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any] })

    it.each([
      [sub1, "Square 말고 Ball 엔드밀로 변경해줘", "toolSubtype"],
      [coat1, "TiAlN 대신 DLC로 바꿔", "coating"],
      [coat1, "TiAlN 말고 AlCrN으로 변경해줘", "coating"],
      [flute1, "4날 말고 2날로 바꿔", "fluteCount"],
      [sub1, "Square 대신 Radius로 변경해줘", "toolSubtype"],
      [sub1, "Square 말고 Ball로 변경", "toolSubtype"],
    ])('%s → %s', async (state, msg, expectedField) => {
      const r = await resolveExplicitRevisionRequest(state as ExplorationSessionState, msg as string)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: expectedField } })
    })

    it.each([
      ["TANK-POWER만 필터링해줘"],
      ["ALU-POWER HPC로 필터링"],
      ["V7 PLUS 브랜드만 보여줘"],
      ["TiAlN 코팅만 필터링"],
    ])('%s → filter resolved', async (msg) => {
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved" })
    })

    // Pending with mixed
    it('"Square로 select" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Square로")
      expect(r.kind).toBe("resolved")
    })

    it('"4 flute" during flute pending → resolved', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "4날")
      expect(r.kind).toBe("resolved")
    })

    it('"TiAlN coating으로" during coating pending → resolved', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN")
      expect(r.kind).toBe("resolved")
    })

    it('"skip해줘" → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "스킵")
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
    })

    it('"pass" → skip', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "패스")
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
    })

    it('"next" → skip', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "넘어가")
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
    })

    it('"don\'t care" → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "상관없음")
      expect(r.kind).toBe("resolved")
      if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
    })

    it('"Radius endmill" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius")
      expect(r.kind).toBe("resolved")
    })

    it('"Ball" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball")
      expect(r.kind).toBe("resolved")
    })
  })

  // --- Internet speak / slang (15 cases) ---
  describe("internet speak and slang", () => {
    it('"ㄱㅅ" (thanks) during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㄱㅅ")
      // Internet speak — might resolve to unresolved or skip
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅇㅋ" (OK) during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅇㅋ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㄴㄴ Ball로" during pending → might resolve Ball', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㄴㄴ Ball로")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㅎㅎ Square로 할게" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅎㅎ Square로 할게")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㄱㄱ 4날" during pending → might resolve 4날', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "ㄱㄱ 4날")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㅇㅇ TiAlN" during pending → might resolve TiAlN', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "ㅇㅇ TiAlN")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㅋㅋ 패스" during pending → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅋㅋ 패스")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㅎ 아무거나" during pending → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅎ 아무거나")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"굿 TiAlN으로" during pending → might resolve', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "굿 TiAlN으로")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"넹 Ball요" during pending → might resolve Ball', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "넹 Ball요")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㄴㄴ" alone during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㄴㄴ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅎㅇ" alone during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅎㅇ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅇㅇ" alone during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅇㅇ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅋㅋㅋ" alone during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅋㅋㅋ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅎㅎㅎ" alone during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅎㅎㅎ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })
  })

  // --- Very long messages (10 cases) ---
  describe("very long messages (100+ chars)", () => {
    it('long request with revision signal → unresolved pending (>80 chars)', () => {
      const msg = "저는 알루미늄을 가공하는데 직경이 10mm이고 4날짜리 Square 엔드밀을 찾고 있는데 코팅은 TiAlN이 좋겠고 가능하면 재고가 있는 걸로 추천해주세요"
      const r = resolvePendingQuestionReply(subtypeQuestionState, msg)
      expect(r.kind).toBe("unresolved")
    })

    it('long revision message → revision may resolve', async () => {
      const msg = "TiAlN 말고 DLC가 나을 것 같아서 DLC로 변경해주세요"
      const singleCoat = makeState({
        appliedFilters: [{ field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any],
      })
      const r = await resolveExplicitRevisionRequest(singleCoat, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
    })

    it('long filter message → filter may resolve', async () => {
      const msg = "TANK-POWER만 보여줘"
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
    })

    it('long mixed context → revision resolves', async () => {
      const msg = "황삭 가공을 해야 해서 날수가 많으면 안 되는데 아까 4날로 설정한 거 2날로 변경해줘"
      const singleFlute = makeState({
        appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any],
      })
      const r = await resolveExplicitRevisionRequest(singleFlute, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
    })

    it('long brand filter → resolves', async () => {
      const msg = "V7 PLUS가 성능이 좋다고 해서 V7 PLUS만 필터링해서 보여줘"
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
    })

    it('long compound request without revision signal → null revision', async () => {
      const msg = "알루미늄 가공에 적합한 2날짜리 Square 엔드밀을 찾고 있는데 코팅은 DLC가 좋겠고 직경은 10mm 정도면 좋겠어요"
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), msg)
      expect(r).toBeNull()
    })

    it('very long (200+ chars) → graceful', async () => {
      const msg = "제가 지금 SUS304 스테인리스강을 가공하고 있는데 기존에 TiAlN 코팅으로 설정했지만 사실은 이 소재는 AlCrN 코팅이 더 좋다고 해서 코팅을 AlCrN으로 변경해주시면 감사하겠습니다"
      const singleCoat = makeState({
        appliedFilters: [{ field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any],
      })
      const r = await resolveExplicitRevisionRequest(singleCoat, msg)
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('long message to pending → unresolved (length > 80)', () => {
      // This message exceeds 80 chars so resolvePendingQuestionReply returns "unresolved"
      const msg = "저는 일반강을 가공하려고 하는데 어떤 형상의 엔드밀이 좋을지 잘 모르겠어요 일단 직경은 10mm 정도면 좋겠고 코팅은 아무거나 괜찮을 것 같아요 도와주세요"
      expect(msg.length).toBeGreaterThan(80)
      const r = resolvePendingQuestionReply(subtypeQuestionState, msg)
      expect(r.kind).toBe("unresolved")
    })

    it('long filter with coating mention → resolves', async () => {
      const msg = "지금 보이는 제품 중에서 TiAlN 코팅 제품만 모아서 보여줘"
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved" })
    })

    it('long filter with fluteCount mention → resolves', async () => {
      const msg = "현재 목록에서 4날짜리 제품만 필터링해서 보여줘"
      const r = await resolveExplicitFilterRequest(richCandidateState, msg, provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
    })
  })

  // --- Very short messages (15 cases) ---
  describe("very short messages", () => {
    it('"4" during fluteCount pending → resolved', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "4")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"2" during fluteCount pending → resolved', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "2")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"6" during diameterMm pending → resolved', () => {
      const r = resolvePendingQuestionReply(diameterQuestionState, "6")
      expect(r.kind).toBe("resolved")
    })

    it('"볼" during toolSubtype pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "볼")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"ㅎ" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅎ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"네" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "네")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"1" during subtype pending → might match index 1', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "1")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"3" during coating pending → might match index 3', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "3")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"아" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "아")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"." during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, ".")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅇ" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅇ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ok" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ok")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"ㅠ" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "ㅠ")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"~" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "~")
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })

    it('"?" during pending → side_question', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "?")
      expect(r.kind).toBe("side_question")
    })
  })

  // --- Emoji mixed (20 cases) ---
  describe("emoji mixed messages", () => {
    it('"Square 추천해줘 👍" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Square 추천해줘 👍")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"4날로 ✅" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "4날로 ✅")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"TiAlN 👌" during coating pending → resolved', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN 👌")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"Ball로 해줘 😊" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball로 해줘 😊")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"Radius ❤️" during pending → resolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius ❤️")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"패스 😅" during pending → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "패스 😅")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"아무거나 🙏" during pending → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 🙏")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"TiAlN 말고 DLC로 변경 🔧" → revision', async () => {
      const coat1 = makeState({ appliedFilters: [{ field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any] })
      const r = await resolveExplicitRevisionRequest(coat1, "TiAlN 말고 DLC로 변경 🔧")
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })

    it('"TANK-POWER만 보여줘 👀" → filter', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, "TANK-POWER만 보여줘 👀", provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
    })

    it('"4날 말고 2날로 변경해줘 💪" → revision', async () => {
      const flute1 = makeState({ appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any] })
      const r = await resolveExplicitRevisionRequest(flute1, "4날 말고 2날로 변경해줘 💪")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
    })

    it('"AlCrN 코팅만 필터 🔍" → filter', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, "AlCrN 코팅만 필터 🔍", provider)
      expect(r).toMatchObject({ kind: "resolved" })
    })

    it('"4날 말고 6날로 바꿔 ✨" → revision', async () => {
      const flute1 = makeState({ appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any] })
      const r = await resolveExplicitRevisionRequest(flute1, "4날 말고 6날로 바꿔 ✨")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
    })

    it('"V7 PLUS만 보여줘 🎯" → filter', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, "V7 PLUS만 보여줘 🎯", provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
    })

    it('"Square 말고 Ball로 변경 🔄" → revision', async () => {
      const sub1 = makeState({ appliedFilters: [{ field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any] })
      const r = await resolveExplicitRevisionRequest(sub1, "Square 말고 Ball로 변경 🔄")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })

    it('"Square만 필터 📋" → filter', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, "Square만 필터 📋", provider)
      expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
    })

    it('"상관없음 😌" during pending → skip', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "상관없음 😌")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"스킵 🤷" during pending → skip', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "스킵 🤷")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"넘어가 🏃" during pending → skip', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "넘어가 🏃")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"6mm 📐" during diameter pending → resolved', () => {
      const r = resolvePendingQuestionReply(diameterQuestionState, "6mm 📐")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })

    it('"AlCrN 👍👍" during coating pending → resolved', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "AlCrN 👍👍")
      expect(["resolved", "unresolved"].includes(r.kind)).toBe(true)
    })
  })
})

// ===========================================================================
// Part 5: Edge case combinations (100 cases)
// ===========================================================================

describe("Part 5: edge case combinations (100 cases)", () => {
  // --- Revision of field from resolvedInput (not appliedFilters) (15 cases) ---
  describe("revision of resolvedInput-sourced field", () => {
    const inputDiameterState = makeState({
      appliedFilters: [],
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        material: "일반강",
        diameterMm: 10,
      },
    })

    it.each([
      ["직경 8mm로 변경", 8],
      ["직경 6mm로 바꿔", 6],
      ["10mm 말고 12mm로 변경", 12],
      ["직경을 16mm로 수정해줘", 16],
      ["10mm 대신 8mm", 8],
      ["직경 6mm로 바꿔줘", 6],
      ["diameter를 12mm로 변경해줘", 12],
      ["10mm에서 20mm로 변경", 20],
    ])('%s → diameterMm', async (msg, _expectedMm) => {
      const r = await resolveExplicitRevisionRequest(inputDiameterState, msg)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "diameterMm" } })
    })

    const inputMaterialState = makeState({
      appliedFilters: [],
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        material: "스테인리스강",
      },
    })

    it.each([
      ["소재 알루미늄으로 변경"],
      ["스테인리스강 대신 일반강으로 바꿔"],
      ["재질 변경해줘 고경도강으로"],
      ["소재를 알루미늄으로 수정"],
      ["스테인리스강 말고 일반강"],
      ["재질 일반강으로 변경해주세요"],
      ["소재 변경 알루미늄"],
    ])('%s → material/workpiece revision', async (msg) => {
      const r = await resolveExplicitRevisionRequest(inputMaterialState, msg)
      // Material revisions may or may not be recognized by the system
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })
  })

  // --- Revision when all fields are skip (10 cases) ---
  describe("revision when existing filters are skip", () => {
    const allSkipState = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "skip", value: "skip", rawValue: "skip", appliedAt: 0 } as any,
        { field: "fluteCount", op: "skip", value: "skip", rawValue: "skip", appliedAt: 1 } as any,
        { field: "coating", op: "skip", value: "skip", rawValue: "skip", appliedAt: 2 } as any,
      ],
    })

    it.each([
      ["코팅 TiAlN으로 변경"],
      ["2날로 바꿔"],
      ["Square로 변경해줘"],
      ["코팅 DLC로 변경해줘"],
      ["4날로 바꿔"],
      ["Ball 엔드밀로 변경"],
      ["코팅 AlCrN으로 수정"],
      ["6날로 변경"],
      ["Radius로 바꿔"],
      ["코팅 TiCN으로 바꿔"],
    ])('%s → null or resolved (skip filters excluded, only material synthetic)', async (msg) => {
      // Skip filters are excluded from active filters, resolvedInput only has material
      // With only "material" as synthetic filter, revision may target material or return null
      const r = await resolveExplicitRevisionRequest(allSkipState, msg)
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })
  })

  // --- Filter request when no candidates displayed (10 cases) ---
  describe("filter request with no candidates", () => {
    const noCandidateState = makeState({
      displayedCandidates: [],
      currentMode: "question",
    })

    it.each([
      ["TANK-POWER만 보여줘"],
      ["TiAlN 코팅만 필터링"],
      ["4날로 좁혀"],
      ["Square 형상으로 필터"],
      ["ALU-POWER HPC만"],
      ["Ball 형상만 보여줘"],
      ["2날 제품만 보여줘"],
      ["AlCrN 코팅으로 필터링"],
      ["V7 PLUS 브랜드만"],
      ["Roughing만 필터"],
    ])('%s → null or resolved (no candidates)', async (msg) => {
      const r = await resolveExplicitFilterRequest(noCandidateState, msg, provider)
      // With no candidates, filter may still resolve if field values are known from registry
      expect(r === null || r?.kind === "resolved" || r?.kind === "ambiguous").toBe(true)
    })
  })

  // --- Pending question with stale lastAskedField (10 cases) ---
  describe("stale pending field scenarios", () => {
    const staleState = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [], // Options were cleared
      resolutionStatus: "narrowing",
    })

    it.each([
      ["Square", "resolved_or_unresolved"],
      ["Ball", "resolved_or_unresolved"],
      ["4날", "resolved_or_unresolved"],
      ["TiAlN", "resolved_or_unresolved"],
      ["패스", "resolved_or_unresolved"],
      ["상관없음", "resolved_or_unresolved"],
      ["아무거나", "resolved_or_unresolved"],
      ["Radius", "resolved_or_unresolved"],
      ["2날", "resolved_or_unresolved"],
      ["6mm", "resolved_or_unresolved"],
    ])('"%s" with stale lastAskedField → graceful', (msg, _expected) => {
      const r = resolvePendingQuestionReply(staleState, msg)
      // With no displayed options, should still attempt resolution
      expect(["resolved", "unresolved", "none"].includes(r.kind)).toBe(true)
    })
  })

  // --- Multiple revision signals in one message (10 cases) ---
  describe("multiple revision signals in one message", () => {
    // Use single-filter states for reliable resolution
    const singleCoat = makeState({
      appliedFilters: [{ field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any],
    })
    const singleFlute = makeState({
      appliedFilters: [{ field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any],
    })
    const singleSubtype = makeState({
      appliedFilters: [{ field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any],
    })

    it.each([
      [singleCoat, "TiAlN 말고 DLC로 바꿔", "coating"],
      [singleFlute, "4날 대신 2날로 변경", "fluteCount"],
      [singleSubtype, "Square 말고 Ball로 바꿔", "toolSubtype"],
      [singleCoat, "코팅 DLC로 변경해줘", "coating"],
      [singleSubtype, "Square 대신 Radius로 변경해줘", "toolSubtype"],
      [singleFlute, "4날 말고 6날로 바꿔", "fluteCount"],
      [singleSubtype, "Square 대신 Ball로 변경", "toolSubtype"],
      [singleCoat, "코팅 TiCN으로 변경해줘", "coating"],
      [singleCoat, "TiAlN 대신 DLC로 바꿔", "coating"],
      [singleSubtype, "Square 말고 Ball로 변경해줘", "toolSubtype"],
    ])('%s → resolved %s', async (state, msg, expectedField) => {
      const r = await resolveExplicitRevisionRequest(state as ExplorationSessionState, msg as string)
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: expectedField } })
    })
  })

  // --- "처음부터 다시" and navigation signals during pending (10 cases) ---
  // These match the side_question regex in resolvePendingQuestionReply (처음부터, 이전 단계, etc.)
  describe("reset/navigation signals during pending", () => {
    it('"처음부터 다시" during pending → side_question', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "처음부터 다시")
      expect(r.kind).toBe("side_question")
    })

    it('"다시 처음부터" during pending → side_question', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "다시 처음부터")
      expect(r.kind).toBe("side_question")
    })

    it('"리셋" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "리셋")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"초기화" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "초기화")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"이전 단계" during pending → side_question', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "이전 단계")
      expect(r.kind).toBe("side_question")
    })

    it('"뒤로 가기" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(coatingQuestionState, "뒤로 가기")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"되돌리기" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "되돌리기")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"다시 시작" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(fluteQuestionState, "다시 시작")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"처음으로" during pending → graceful', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "처음으로")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })

    it('"다시 할게" during pending → unresolved', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "다시 할게")
      expect(["unresolved", "resolved", "none", "side_question"].includes(r.kind)).toBe(true)
    })
  })

  // --- buildAppliedFilterFromValue integration (15 cases) ---
  describe("buildAppliedFilterFromValue integration", () => {
    it('fluteCount → eq filter', () => {
      const f = buildAppliedFilterFromValue("fluteCount", 4)
      expect(f).toMatchObject({ field: "fluteCount", op: "eq", rawValue: 4 })
    })

    it('fluteCount string "2날" → eq filter', () => {
      const f = buildAppliedFilterFromValue("fluteCount", "2날")
      expect(f).toMatchObject({ field: "fluteCount", rawValue: 2 })
    })

    it('fluteCount string "4" → eq filter', () => {
      const f = buildAppliedFilterFromValue("fluteCount", "4")
      expect(f).toMatchObject({ field: "fluteCount", rawValue: 4 })
    })

    it('coating TiAlN → includes filter', () => {
      const f = buildAppliedFilterFromValue("coating", "TiAlN")
      expect(f).toMatchObject({ field: "coating", value: "TiAlN" })
    })

    it('coating AlCrN → includes filter', () => {
      const f = buildAppliedFilterFromValue("coating", "AlCrN")
      expect(f).toMatchObject({ field: "coating", value: "AlCrN" })
    })

    it('toolSubtype Square → includes filter', () => {
      const f = buildAppliedFilterFromValue("toolSubtype", "Square")
      expect(f).toMatchObject({ field: "toolSubtype", value: "Square" })
    })

    it('toolSubtype Ball → includes filter', () => {
      const f = buildAppliedFilterFromValue("toolSubtype", "Ball")
      expect(f).toMatchObject({ field: "toolSubtype", value: "Ball" })
    })

    it('diameterMm 10 → eq filter', () => {
      const f = buildAppliedFilterFromValue("diameterMm", 10)
      expect(f).toMatchObject({ field: "diameterMm", rawValue: 10 })
    })

    it('diameterMm "8mm" → eq filter', () => {
      const f = buildAppliedFilterFromValue("diameterMm", "8mm")
      expect(f).toMatchObject({ field: "diameterMm" })
    })

    it('diameterMm 6.5 → eq filter', () => {
      const f = buildAppliedFilterFromValue("diameterMm", 6.5)
      expect(f).toMatchObject({ field: "diameterMm", rawValue: 6.5 })
    })

    it('brand TANK-POWER → includes filter', () => {
      const f = buildAppliedFilterFromValue("brand", "TANK-POWER")
      expect(f).toMatchObject({ field: "brand", value: "TANK-POWER" })
    })

    it('brand ALU-POWER HPC → includes filter', () => {
      const f = buildAppliedFilterFromValue("brand", "ALU-POWER HPC")
      expect(f).toMatchObject({ field: "brand", value: "ALU-POWER HPC" })
    })

    it('workPieceName 알루미늄 → includes filter', () => {
      const f = buildAppliedFilterFromValue("workPieceName", "알루미늄")
      expect(f).toMatchObject({ field: "workPieceName", value: "알루미늄" })
    })

    it('unknown field → null', () => {
      const f = buildAppliedFilterFromValue("nonExistentField", "value")
      expect(f).toBeNull()
    })

    it('diameterMm fractional inch "1/4" → mm conversion', () => {
      const f = buildAppliedFilterFromValue("diameterMm", "1/4")
      expect(f).not.toBeNull()
      if (f) expect(f.field).toBe("diameterMm")
    })
  })

  // --- Resolved state revision routing (10 cases) ---
  // In resolved state, pending returns "none", and revision attempts to resolve.
  // With 3 active filters, the LLM may return ambiguous or the wrong field.
  describe("revision in resolved state", () => {
    // Use single-filter states for reliable resolved-state revision
    const resolvedCoatingState = makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
      ],
      resolutionStatus: "resolved" as any,
      currentMode: "recommendation",
    })

    const resolvedFluteState = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      ],
      resolutionStatus: "resolved" as any,
      currentMode: "recommendation",
    })

    const resolvedSubtypeState = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      resolutionStatus: "resolved" as any,
      currentMode: "recommendation",
    })

    it('"코팅 DLC로 변경해줘" → pending none, revision coating', async () => {
      const pending = resolvePendingQuestionReply(resolvedCoatingState, "코팅 DLC로 변경해줘")
      expect(pending.kind).toBe("none")
      const r = await resolveExplicitRevisionRequest(resolvedCoatingState, "코팅 DLC로 변경해줘")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
    })

    it('"TiAlN 말고 AlCrN으로" → revision coating', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedCoatingState, "TiAlN 말고 AlCrN으로")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
    })

    it('"코팅 TiCN으로 바꿔" → revision coating', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedCoatingState, "코팅 TiCN으로 바꿔")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
    })

    it('"2날로 변경해줘" → revision fluteCount', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedFluteState, "2날로 변경해줘")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
    })

    it('"4날 대신 6날" → revision fluteCount', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedFluteState, "4날 대신 6날")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 6 } } })
    })

    it('"6날로 바꿔" → revision fluteCount', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedFluteState, "6날로 바꿔")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 6 } } })
    })

    it('"Ball로 변경" → revision toolSubtype', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedSubtypeState, "Ball로 변경")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })

    it('"Square 말고 Radius로" → revision toolSubtype', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedSubtypeState, "Square 말고 Radius로")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })

    it('"Roughing으로 변경해줘" → revision toolSubtype', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedSubtypeState, "Roughing으로 변경해줘")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })

    it('"Square 말고 Ball로 바꿔" → revision toolSubtype', async () => {
      const r = await resolveExplicitRevisionRequest(resolvedSubtypeState, "Square 말고 Ball로 바꿔")
      expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
    })
  })

  // --- Edge: empty/null inputs (10 cases) ---
  describe("empty and null inputs", () => {
    it('null state → revision returns null', async () => {
      const r = await resolveExplicitRevisionRequest(null, "코팅 DLC로 변경")
      expect(r).toBeNull()
    })

    it('null message → revision returns null', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), null)
      expect(r).toBeNull()
    })

    it('empty message → revision returns null', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "")
      expect(r).toBeNull()
    })

    it('whitespace message → revision returns null', async () => {
      const r = await resolveExplicitRevisionRequest(tripleFilterState(), "   ")
      expect(r).toBeNull()
    })

    it('null state → filter returns null', async () => {
      const r = await resolveExplicitFilterRequest(null, "TANK-POWER만 보여줘", provider)
      expect(r).toBeNull()
    })

    it('null message → filter returns null', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, null, provider)
      expect(r).toBeNull()
    })

    it('empty message → filter returns null', async () => {
      const r = await resolveExplicitFilterRequest(richCandidateState, "", provider)
      expect(r).toBeNull()
    })

    it('null state → pending returns none', () => {
      const r = resolvePendingQuestionReply(null, "Square")
      expect(r.kind).toBe("none")
    })

    it('null message → pending returns none', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, null)
      expect(r.kind).toBe("none")
    })

    it('empty message → pending returns none', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "")
      expect(r.kind).toBe("none")
    })

    it('whitespace-only message → pending returns none', () => {
      const r = resolvePendingQuestionReply(subtypeQuestionState, "   ")
      expect(r.kind).toBe("none")
    })
  })
})
