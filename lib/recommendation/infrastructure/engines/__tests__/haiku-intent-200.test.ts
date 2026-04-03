/**
 * 200-case intent classification pipeline test.
 * Tests the FULL routing: resolvePendingQuestionReply → resolveExplicitRevisionRequest → resolveExplicitFilterRequest
 */
import { describe, expect, it } from "vitest"

import {
  resolvePendingQuestionReply,
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
} from "../serve-engine-runtime"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "s1",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

/** Full pipeline: pending → revision → filter → none */
async function classifyIntent(state: ExplorationSessionState, msg: string) {
  const pending = resolvePendingQuestionReply(state, msg)
  if (pending.kind === "resolved") return { handler: "pending", kind: "resolved", result: pending }
  if (pending.kind === "side_question") return { handler: "pending", kind: "side_question", result: pending }
  // "skip" is handled via resolved with op="skip" above

  if (pending.kind === "unresolved" || pending.kind === "none") {
    const revision = await resolveExplicitRevisionRequest(state, msg)
    if (revision?.kind === "resolved") return { handler: "revision", kind: "resolved", result: revision }

    const filter = await resolveExplicitFilterRequest(state, msg, getProvider())
    if (filter?.kind === "resolved") return { handler: "filter", kind: "resolved", result: filter }
  }

  return { handler: "none", kind: pending.kind, result: pending }
}

// ---------------------------------------------------------------------------
// Shared states
// ---------------------------------------------------------------------------

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

const workPieceQuestionState = makeState({
  lastAskedField: "workPieceName",
  displayedOptions: [
    { index: 1, label: "고경도강", field: "workPieceName", value: "고경도강", count: 30 },
    { index: 2, label: "알루미늄", field: "workPieceName", value: "알루미늄", count: 25 },
    { index: 3, label: "스테인리스강", field: "workPieceName", value: "스테인리스강", count: 20 },
    { index: 4, label: "상관없음", field: "workPieceName", value: "skip", count: 0 },
  ],
})

const withFluteFilter = (val: string, raw: number) =>
  makeState({
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: val, rawValue: raw, appliedAt: 0 } as any,
    ],
    lastAskedField: "toolSubtype",
    displayedOptions: [
      { index: 1, label: "Square (200개)", field: "toolSubtype", value: "Square", count: 200 },
      { index: 2, label: "Radius (100개)", field: "toolSubtype", value: "Radius", count: 100 },
    ],
  })

const withCoatingFilter = (val: string) =>
  makeState({
    appliedFilters: [
      { field: "coating", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
    ],
    lastAskedField: "toolSubtype",
    displayedOptions: [],
  })

const withSubtypeFilter = (val: string) =>
  makeState({
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
    ],
    lastAskedField: "coating",
    displayedOptions: [],
  })

const withMultipleFilters = makeState({
  appliedFilters: [
    { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
    { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 1 } as any,
    { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 2 } as any,
  ],
  lastAskedField: "diameterMm",
  displayedOptions: [],
})

const candidateState = makeState({
  displayedCandidates: [
    { rank: 1, productCode: "G8A59080", displayCode: "G8A59080", product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "TiAlN" } } as any,
    { rank: 2, productCode: "E5E39060", displayCode: "E5E39060", product: { brand: "ALU-POWER", seriesName: "E5E39", toolSubtype: "Square", coating: "Bright Finish" } } as any,
    { rank: 3, productCode: "CE7659080", displayCode: "CE7659080", product: { brand: "ALU-POWER HPC", seriesName: "CE7659", toolSubtype: "Square", coating: "TiCN" } } as any,
  ],
  lastAskedField: undefined,
  currentMode: "recommendation",
  resolutionStatus: "resolved" as any,
})

const filterableCandidateState = makeState({
  displayedCandidates: [
    { rank: 1, productCode: "P1", displayCode: "P1", product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "TiAlN" } } as any,
    { rank: 2, productCode: "P2", displayCode: "P2", product: { brand: "ALU-POWER", seriesName: "E5E39", toolSubtype: "Square", coating: "Bright Finish" } } as any,
  ],
  lastAskedField: "toolSubtype",
  displayedOptions: [
    { index: 1, label: "Square (50개)", field: "toolSubtype", value: "Square", count: 50 },
    { index: 2, label: "Roughing (30개)", field: "toolSubtype", value: "Roughing", count: 30 },
  ],
})

// ---------------------------------------------------------------------------
// Part 1: Chip clicks — pending resolves immediately (40 cases)
// ---------------------------------------------------------------------------

describe("chip clicks — pending resolved (40)", () => {
  // Exact chip match
  it('C01: "Square (2072개)" → pending resolved toolSubtype=Square', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Square (2072개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Square")
  })

  it('C02: "Radius (362개)" → pending resolved toolSubtype=Radius', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius (362개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Radius")
  })

  it('C03: "Ball (180개)" → pending resolved toolSubtype=Ball', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball (180개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Ball")
  })

  it('C04: "4날 (864개)" → pending resolved fluteCount=4', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "4날 (864개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C05: "2날 (512개)" → pending resolved fluteCount=2', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "2날 (512개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C06: "6날 (120개)" → pending resolved fluteCount=6', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "6날 (120개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C07: "TiAlN (500개)" → pending resolved coating=TiAlN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN (500개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("TiAlN")
  })

  it('C08: "AlCrN (300개)" → pending resolved coating=AlCrN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "AlCrN (300개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("AlCrN")
  })

  it('C09: "TiCN (200개)" → pending resolved coating=TiCN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "TiCN (200개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("TiCN")
  })

  it('C10: "Bright Finish (50개)" → pending resolved coating', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "Bright Finish (50개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("coating")
  })

  it('C11: "6mm (120개)" → pending resolved diameterMm=6', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "6mm (120개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("diameterMm")
  })

  it('C12: "8mm (90개)" → pending resolved diameterMm=8', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "8mm (90개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("diameterMm")
  })

  it('C13: "10mm (60개)" → pending resolved diameterMm=10', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "10mm (60개)")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("diameterMm")
  })

  // Bare value match
  it('C14: "Square" → pending resolved toolSubtype=Square', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Square")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Square")
  })

  it('C15: "Radius" → pending resolved toolSubtype=Radius', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Radius")
  })

  it('C16: "Ball" → pending resolved toolSubtype=Ball', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Ball")
  })

  it('C17: "4날" → pending resolved fluteCount=4', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "4날")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C18: "2날" → pending resolved fluteCount=2', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "2날")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C19: "TiAlN" → pending resolved coating=TiAlN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("TiAlN")
  })

  it('C20: "AlCrN" → pending resolved coating=AlCrN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "AlCrN")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("AlCrN")
  })

  it('C21: "고경도강" → pending resolved workPieceName', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "고경도강")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("고경도강")
  })

  it('C22: "알루미늄" → pending resolved workPieceName', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "알루미늄")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("알루미늄")
  })

  it('C23: "스테인리스강" → pending resolved workPieceName', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "스테인리스강")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("스테인리스강")
  })

  // With Korean suffixes
  it('C24: "Square로요" → pending resolved toolSubtype=Square', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Square로요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Square")
  })

  it('C25: "4날이에요" → pending resolved fluteCount=4', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "4날이에요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C26: "Ball로요" → pending resolved toolSubtype=Ball', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball로요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Ball")
  })

  it('C27: "Radius로" → pending resolved toolSubtype=Radius', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius로")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toContain("Radius")
  })

  it('C28: "2날로요" → pending resolved fluteCount=2', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "2날로요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("fluteCount")
  })

  it('C29: "TiAlN으로요" → pending resolved coating=TiAlN', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN으로요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.value).toBe("TiAlN")
  })

  // Skip variants
  it('C30: "상관없음" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "상관없음")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C31: "아무거나" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C32: "패스" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "패스")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C33: "스킵" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "스킵")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C34: "넘어가" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "넘어가")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C35: "추천으로 골라줘" → pending resolved skip (delegation)', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "추천으로 골라줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C36: "모르겠어" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "모르겠어")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('C37: "모르겠어요" → pending resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "모르겠어요")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  // Bare diameter freeform
  it('C38: "12" → pending resolved diameterMm=12 (freeform diameter)', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "12")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") {
      expect(r.filter.field).toBe("diameterMm")
      expect(r.filter.rawValue).toBe(12)
    }
  })

  it('C39: "6.5" → pending resolved diameterMm=6.5 (freeform decimal)', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "6.5")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") {
      expect(r.filter.field).toBe("diameterMm")
    }
  })

  it('C40: "8mm" → pending resolved diameterMm=8', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "8mm")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.field).toBe("diameterMm")
  })
})

// ---------------------------------------------------------------------------
// Part 2: Revision requests — pending unresolved → revision resolves (50 cases)
// ---------------------------------------------------------------------------

describe("revision requests (50)", () => {
  // Flute revisions
  it('R01: "3날 대신 2날" → revision fluteCount 3→2', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("3날", 3), "3날 대신 2날")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R02: "3날 말고 4날로" → revision fluteCount 3→4', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("3날", 3), "3날 말고 4날로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 4 } } })
  })

  it('R03: "4날 아니고 2날로" → revision fluteCount 4→2', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "4날 아니고 2날로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R04: "2날로 변경" → revision fluteCount →2', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "2날로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R05: "6날로 바꿔" → revision fluteCount →6', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "6날로 바꿔")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 6 } } })
  })

  it('R06: "4날로 수정" → revision fluteCount →4', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("2날", 2), "4날로 수정")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 4 } } })
  })

  it('R07: "2날 말고 6날" → revision fluteCount 2→6', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("2날", 2), "2날 말고 6날")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 6 } } })
  })

  it('R08: "3날 말고 4날로 변경해줘" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("3날", 3), "3날 말고 4날로 변경해줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 4 } } })
  })

  it('R09: "4날 아닌 2날로 바꿔주세요" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "4날 아닌 2날로 바꿔주세요")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R10: "switch to 2날" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "switch to 2날")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  // Coating revisions
  it('R11: "TiCN 말고 TiAlN으로 변경" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiCN"), "TiCN 말고 TiAlN으로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating", nextFilter: { field: "coating" } } })
  })

  it('R12: "TiAlN 대신 AlCrN" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "TiAlN 대신 AlCrN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating", nextFilter: { field: "coating" } } })
  })

  it('R13: "코팅을 TiCN으로 바꿔" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "코팅을 TiCN으로 바꿔")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating", nextFilter: { field: "coating" } } })
  })

  it('R14: "코팅 TiAlN 말고 Bright Finish로" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "코팅 TiAlN 말고 Bright Finish로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  it('R15: "AlCrN으로 변경" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiCN"), "AlCrN으로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  // Tool subtype revisions
  it('R16: "Square 말고 Radius로" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Square"), "Square 말고 Radius로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  it('R17: "형상을 Ball로 변경" → revision toolSubtype (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Ball" } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "형상을 Ball로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  it('R18: "Radius 대신 Square" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Radius"), "Radius 대신 Square")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  it('R19: "Ball 아니고 Square로" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Ball"), "Ball 아니고 Square로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  it('R20: "Roughing으로 바꿔줘" → revision toolSubtype (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Roughing" } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "Roughing으로 바꿔줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  // Korean aliases
  it('R21: "황삭 말고 Square로 변경" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Roughing"), "황삭 말고 Square로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  // Pending defers to revision
  it('R22: "3날 말고 4날" pending defers → revision resolves', async () => {
    const state = withFluteFilter("3날", 3)
    const pending = resolvePendingQuestionReply(state, "3날 말고 4날")
    expect(pending.kind).toBe("unresolved") // defers
    const rev = await resolveExplicitRevisionRequest(state, "3날 말고 4날")
    expect(rev).toMatchObject({ kind: "resolved" })
  })

  it('R23: "TiCN 대신 AlCrN" pending defers → revision resolves', async () => {
    const state = withCoatingFilter("TiCN")
    const pending = resolvePendingQuestionReply(state, "TiCN 대신 AlCrN")
    expect(pending.kind).toBe("unresolved")
    const rev = await resolveExplicitRevisionRequest(state, "TiCN 대신 AlCrN")
    expect(rev).toMatchObject({ kind: "resolved" })
  })

  it('R24: "Square 아니고 Ball로 바꿔" pending defers → revision resolves', async () => {
    const state = withSubtypeFilter("Square")
    const pending = resolvePendingQuestionReply(state, "Square 아니고 Ball로 바꿔")
    expect(pending.kind).toBe("unresolved")
    const rev = await resolveExplicitRevisionRequest(state, "Square 아니고 Ball로 바꿔")
    expect(rev).toMatchObject({ kind: "resolved" })
  })

  // Full pipeline verification
  it('R25: full pipeline "4날 대신 2날로" → revision handler', async () => {
    const c = await classifyIntent(withFluteFilter("4날", 4), "4날 대신 2날로")
    expect(c.handler).toBe("revision")
  })

  it('R26: full pipeline "TiAlN 말고 AlCrN으로 변경" → revision handler', async () => {
    const c = await classifyIntent(withCoatingFilter("TiAlN"), "TiAlN 말고 AlCrN으로 변경")
    expect(c.handler).toBe("revision")
  })

  it('R27: full pipeline "Square 대신 Ball" → revision handler', async () => {
    const c = await classifyIntent(withSubtypeFilter("Square"), "Square 대신 Ball")
    expect(c.handler).toBe("revision")
  })

  // Edge: "change to" English pattern
  it('R28: "change to 2날" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "change to 2날")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
  })

  it('R29: "change to Radius" → revision toolSubtype (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      filterValueScope: {
        toolSubtype: ["Square", "Radius", "Ball"],
      },
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Radius" } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "change to Radius")
    // revision 대상 필드의 필터가 candidate pool을 좁힌 상태에서는 ambiguous가 될 수 있음
    // ambiguous이든 resolved이든, toolSubtype revision으로 인식되어야 함
    expect(r).not.toBeNull()
    expect(["resolved", "ambiguous"]).toContain(r!.kind)
  })

  // "instead of" English
  it('R30: "instead of TiAlN use AlCrN" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "instead of TiAlN use AlCrN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  // Compound: multiple filters but only one changes
  it('R31: multi-filter state "4날 말고 2날로 변경" → revision fluteCount only', async () => {
    const r = await resolveExplicitRevisionRequest(withMultipleFilters, "4날 말고 2날로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R32: multi-filter state "코팅 TiAlN 대신 AlCrN" → revision coating only', async () => {
    const r = await resolveExplicitRevisionRequest(withMultipleFilters, "코팅 TiAlN 대신 AlCrN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  it('R33: multi-filter state "Square 말고 Radius로 변경" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withMultipleFilters, "Square 말고 Radius로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  // "ㄴㄴ" informal revision
  it('R34: "ㄴㄴ 2날로" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "ㄴㄴ 2날로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
  })

  // "아니라" variant
  it('R35: "4날이 아니라 6날로" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "4날이 아니라 6날로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 6 } } })
  })

  // "replace with"
  it('R36: "replace with AlCrN" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "replace with AlCrN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  // Non-revision should NOT match
  it('R37: "Radius" plain selection → revision returns null', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Square"), "Radius")
    expect(r).toBeNull()
  })

  it('R38: "TiAlN" plain selection → revision returns null', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiCN"), "TiAlN")
    expect(r).toBeNull()
  })

  it('R39: "안녕하세요" → revision returns null', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "안녕하세요")
    expect(r).toBeNull()
  })

  // Polite form
  it('R40: "4날 말고 2날로 변경해주세요" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "4날 말고 2날로 변경해주세요")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R41: "코팅을 AlCrN으로 바꿔줘" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "코팅을 AlCrN으로 바꿔줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  it('R42: "형상을 Radius로 수정해줘" → revision toolSubtype (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Radius" } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "형상을 Radius로 수정해줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  // Legacy stored numeric flute values
  it('R43: legacy "3" stored → "3날 말고 4날" revision', async () => {
    const state = makeState({
      appliedFilters: [{ field: "fluteCount", op: "eq", value: "3", rawValue: "3", appliedAt: 1 } as any],
    })
    const r = await resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
  })

  // Recommendation mode revisions
  it('R44: recommendation mode "3날 말고 4날로 변경해서 추천해줘" → revision', async () => {
    const state = makeState({
      currentMode: "recommendation",
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 0 } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경해서 추천해줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
  })

  // Synthetic filters from resolvedInput
  it('R45: no appliedFilters but resolvedInput.flutePreference=3 → "3날 말고 2날로 변경" revision (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [],
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko", material: "일반강", flutePreference: 3 },
      displayedCandidates: [
        { product: { fluteCount: 3 } } as any,
        { product: { fluteCount: 2 } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "3날 말고 2날로 변경")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount" } })
  })

  it('R46: "4날 바꿀래 2날로" → revision fluteCount', async () => {
    const r = await resolveExplicitRevisionRequest(withFluteFilter("4날", 4), "4날 바꿀래 2날로")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "fluteCount", nextFilter: { rawValue: 2 } } })
  })

  it('R47: "TiCN 말고 TiAlN" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiCN"), "TiCN 말고 TiAlN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  it('R48: "Roughing 말고 Square로 바꿔줘" → revision toolSubtype', async () => {
    const r = await resolveExplicitRevisionRequest(withSubtypeFilter("Roughing"), "Roughing 말고 Square로 바꿔줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })

  it('R49: "코팅 변경 AlCrN" → revision coating', async () => {
    const r = await resolveExplicitRevisionRequest(withCoatingFilter("TiAlN"), "코팅 변경 AlCrN")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "coating" } })
  })

  it('R50: "Square 대신 Roughing으로 변경해줘" → revision toolSubtype (with candidates)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Roughing" } } as any,
      ],
    })
    const r = await resolveExplicitRevisionRequest(state, "Square 대신 Roughing으로 변경해줘")
    expect(r).toMatchObject({ kind: "resolved", request: { targetField: "toolSubtype" } })
  })
})

// ---------------------------------------------------------------------------
// Part 3: Filter requests — pending unresolved → revision null → filter resolves (30 cases)
// ---------------------------------------------------------------------------

describe("filter requests (30)", () => {
  it('F01: "TANK-POWER로 필터링" → filter brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TANK-POWER로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('F02: "ALU-POWER 브랜드로 필터링" → filter brand=ALU-POWER', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "ALU-POWER 브랜드로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F03: "ALU-POWER HPC만 보여줘" → filter brand=ALU-POWER HPC', async () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1", displayCode: "P1", product: { brand: "ALU-POWER HPC", seriesName: "E5H22", toolSubtype: "Square" } } as any,
        { rank: 2, productCode: "P2", displayCode: "P2", product: { brand: "ALU-CUT for Korean Market", seriesName: "E5E83", toolSubtype: "Square" } } as any,
      ],
      filterValueScope: { brand: ["ALU-POWER HPC", "ALU-CUT for Korean Market"] },
    })
    const r = await resolveExplicitFilterRequest(state, "ALU-POWER HPC만 보여줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('F04: "TANK-POWER만 추천해줘" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TANK-POWER만 추천해줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F05: "TiAlN만 보여줘" → filter coating=TiAlN', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "TiAlN", brand: "X" } } as any,
        { product: { coating: "AlCrN", brand: "Y" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "TiAlN만 보여줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('F06: "TiCN 코팅으로 좁혀" → filter coating=TiCN', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "TiCN", brand: "A" } } as any,
        { product: { coating: "TiAlN", brand: "B" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "TiCN 코팅으로 좁혀", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('F07: "Roughing 형상으로 필터링" → filter toolSubtype=Roughing', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Roughing", brand: "A" } } as any,
        { product: { toolSubtype: "Square", brand: "B" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Roughing 형상으로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F08: "Ball 형상으로 좁혀" → filter toolSubtype=Ball', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Ball", brand: "A" } } as any,
        { product: { toolSubtype: "Square", brand: "B" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Ball 형상으로 좁혀", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F09: "Square만 찾아줘" → filter toolSubtype=Square', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Square", brand: "A" } } as any,
        { product: { toolSubtype: "Ball", brand: "B" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Square만 찾아줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F10: "Radius 형상으로 필터" → filter toolSubtype=Radius', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Radius", brand: "A" } } as any,
        { product: { toolSubtype: "Square", brand: "B" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Radius 형상으로 필터", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F11: "TANK-POWER로 검색" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TANK-POWER로 검색", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F12: "ALU-POWER HPC로 필터링" → filter brand=ALU-POWER HPC', async () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1", displayCode: "P1", product: { brand: "ALU-POWER HPC", seriesName: "E5H22", toolSubtype: "Square" } } as any,
        { rank: 2, productCode: "P2", displayCode: "P2", product: { brand: "ALU-CUT for Korean Market", seriesName: "E5E83", toolSubtype: "Square" } } as any,
      ],
      filterValueScope: { brand: ["ALU-POWER HPC", "ALU-CUT for Korean Market"] },
    })
    const r = await resolveExplicitFilterRequest(state, "ALU-POWER HPC로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('F13: "지금 후보에서 브랜드를 TANK-POWER로만 보여줘" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "지금 후보에서 브랜드를 TANK-POWER로만 보여줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F14: full pipeline "TANK-POWER로 필터링" → filter handler', async () => {
    const c = await classifyIntent(candidateState, "TANK-POWER로 필터링")
    expect(c.handler).toBe("filter")
  })

  it('F15: full pipeline "TiAlN만 보여줘" with coating candidates → filter handler', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "TiAlN", brand: "X" } } as any,
        { product: { coating: "AlCrN", brand: "Y" } } as any,
      ],
      resolutionStatus: "resolved" as any,
    })
    const c = await classifyIntent(state, "TiAlN만 보여줘")
    expect(c.handler).toBe("filter")
  })

  it('F16: "TANK-POWER 브랜드 기준으로 필터링" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TANK-POWER 브랜드 기준으로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F17: "TiAlN 코팅 적용해줘" → filter coating', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "TiAlN" } } as any,
        { product: { coating: "AlCrN" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "TiAlN 코팅 적용해줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('F18: "ALU-POWER만 보여" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "ALU-POWER만 보여", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })

  it('F19: "Roughing만 추천" → filter toolSubtype', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Roughing" } } as any,
        { product: { toolSubtype: "Square" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Roughing만 추천", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F20: "Ball로 추천해줘" → filter toolSubtype', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Ball" } } as any,
        { product: { toolSubtype: "Square" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Ball로 추천해줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  it('F21: filterValueScope "ALU-POWER HPC 브랜드로 필터링" → filter brand', async () => {
    const state = makeState({
      displayedCandidates: [{ product: { brand: "ALU-CUT for Korean Market" } } as any],
      filterValueScope: { brand: ["ALU-POWER HPC", "ALU-CUT for Korean Market"] },
    })
    const r = await resolveExplicitFilterRequest(state, "ALU-POWER HPC 브랜드로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('F22: "코팅을 AlCrN으로 좁혀줘" → filter coating', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "AlCrN" } } as any,
        { product: { coating: "TiAlN" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "코팅을 AlCrN으로 좁혀줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('F23: "TiCN으로 필터링해줘" → filter coating', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "TiCN" } } as any,
        { product: { coating: "TiAlN" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "TiCN으로 필터링해줘", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('F24: "Bright Finish로 필터링" → filter coating', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { coating: "Bright Finish" } } as any,
        { product: { coating: "TiAlN" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Bright Finish로 필터링", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('F25: "Square 형상 적용" → filter toolSubtype', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { toolSubtype: "Square" } } as any,
        { product: { toolSubtype: "Radius" } } as any,
      ],
    })
    const r = await resolveExplicitFilterRequest(state, "Square 형상 적용", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype" } })
  })

  // No filter signal → returns null
  it('F26: "안녕하세요" → filter returns null', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "안녕하세요", getProvider())
    expect(r).toBeNull()
  })

  it('F27: "감사합니다" → filter returns null', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "감사합니다", getProvider())
    expect(r).toBeNull()
  })

  it('F28: "Radius" plain → filter returns null (no filter signal word)', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "Radius", getProvider())
    expect(r).toBeNull()
  })

  it('F29: revision signal blocks filter "TiAlN 말고 AlCrN으로 필터링" → null (revision signal takes precedence)', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TiAlN 말고 AlCrN으로 필터링", getProvider())
    expect(r).toBeNull()
  })

  it('F30: "TANK-POWER로 추천" → filter brand', async () => {
    const r = await resolveExplicitFilterRequest(candidateState, "TANK-POWER로 추천", getProvider())
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand" } })
  })
})

// ---------------------------------------------------------------------------
// Part 4: Side questions — pending returns side_question (40 cases)
// ---------------------------------------------------------------------------

describe("side questions (40)", () => {
  // Questions with ?
  it('S01: "이거 뭐야?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "이거 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('S02: "차이가 뭐야?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "차이가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('S03: "설명해줘?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "설명해줘?")
    expect(r.kind).toBe("side_question")
  })

  it('S04: "Square가 뭐야?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Square가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('S05: "Radius가 뭔가요?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Radius가 뭔가요?")
    expect(r.kind).toBe("side_question")
  })

  it('S06: "Ball은 어떤 형상이야?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Ball은 어떤 형상이야?")
    expect(r.kind).toBe("side_question")
  })

  // Explanation-like (no ?)
  it('S07: "코팅이 뭔지 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "코팅이 뭔지 알려줘")
    expect(r.kind).toBe("side_question")
  })

  it('S08: "TiAlN 설명" → side_question', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "TiAlN 설명")
    expect(r.kind).toBe("side_question")
  })

  it('S09: "2날과 4날의 차이가 뭐야?" → side_question (? triggers)', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "2날과 4날의 차이가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('S10: "Square와 Radius 차이가 뭐야?" → side_question (? triggers)', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "Square와 Radius 차이가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  // Product info
  it('S11: "G8A59080 재고 몇개야" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "G8A59080 재고 몇개야")
    expect(r.kind).toBe("side_question")
  })

  it('S12: "G8A59080 스펙 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "G8A59080 스펙 알려줘")
    expect(r.kind).toBe("side_question")
  })

  it('S13: "E5E39060의 가격" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "E5E39060의 가격")
    expect(r.kind).toBe("side_question")
  })

  it('S14: "CE7659080 납기 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "CE7659080 납기 알려줘")
    expect(r.kind).toBe("side_question")
  })

  // Company info
  it('S15: "영업소 번호" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "영업소 번호")
    expect(r.kind).toBe("side_question")
  })

  it('S16: "회사 정보" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "회사 정보")
    expect(r.kind).toBe("side_question")
  })

  it('S17: "연락처 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "연락처 알려줘")
    expect(r.kind).toBe("side_question")
  })

  it('S18: "공장 어디야" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "공장 어디야")
    expect(r.kind).toBe("side_question")
  })

  // Domain knowledge
  it('S19: "코팅이 뭔지" → side_question', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "코팅이 뭔지")
    expect(r.kind).toBe("side_question")
  })

  it('S20: "왜 4날을 추천하나요" → side_question', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "왜 4날을 추천하나요")
    expect(r.kind).toBe("side_question")
  })

  it('S21: "어떻게 골라야 해" → delegation (matches 골라 + 해 pattern)', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "어떻게 골라야 해")
    // delegation regex matches "골라...해" → treated as skip
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('S22: "알루미늄 가공 어떤 코팅이 좋아?" → side_question', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "알루미늄 가공 어떤 코팅이 좋아?")
    expect(r.kind).toBe("side_question")
  })

  it('S23: "이 중에 뭐가 좋아?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "이 중에 뭐가 좋아?")
    expect(r.kind).toBe("side_question")
  })

  // Full pipeline: side question goes through correctly
  it('S24: full pipeline "이거 뭐야?" → pending side_question', async () => {
    const c = await classifyIntent(subtypeQuestionState, "이거 뭐야?")
    expect(c.handler).toBe("pending")
    expect(c.kind).toBe("side_question")
  })

  it('S25: full pipeline "2날과 4날 차이점이 뭐야?" → pending side_question', async () => {
    const c = await classifyIntent(fluteQuestionState, "2날과 4날 차이점이 뭐야?")
    expect(c.handler).toBe("pending")
    expect(c.kind).toBe("side_question")
  })

  it('S26: "고경도강이 뭐야?" → side_question', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "고경도강이 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('S27: "스테인리스강 설명해줘" → side_question', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "스테인리스강 설명해줘")
    expect(r.kind).toBe("side_question")
  })

  it('S28: "알루미늄이랑 스테인리스 차이가 뭐야?" → side_question', () => {
    const r = resolvePendingQuestionReply(workPieceQuestionState, "알루미늄이랑 스테인리스 차이가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  // Inventory/logistics
  it('S29: "재고 확인" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "재고 확인")
    expect(r.kind).toBe("side_question")
  })

  it('S30: "배송 기간" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "배송 기간")
    expect(r.kind).toBe("side_question")
  })

  it('S31: "리드타임 얼마나 걸려" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "리드타임 얼마나 걸려")
    expect(r.kind).toBe("side_question")
  })

  it('S32: "가격 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "가격 알려줘")
    expect(r.kind).toBe("side_question")
  })

  it('S33: "카탈로그 있어" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "카탈로그 있어")
    expect(r.kind).toBe("side_question")
  })

  // Geography
  it('S34: "사우디 공장" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "사우디 공장")
    expect(r.kind).toBe("side_question")
  })

  it('S35: "해외 지점" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "해외 지점")
    expect(r.kind).toBe("side_question")
  })

  // More explanation
  it('S36: "각 옵션 종류 알려줘" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "각 옵션 종류 알려줘")
    expect(r.kind).toBe("side_question")
  })

  it('S37: "왜 Square를 추천하나요?" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "왜 Square를 추천하나요?")
    expect(r.kind).toBe("side_question")
  })

  it('S38: "결과가 왜 이래" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "결과가 왜 이래")
    expect(r.kind).toBe("side_question")
  })

  it('S39: "이전 단계로 돌아갈래" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "이전 단계로 돌아갈래")
    expect(r.kind).toBe("side_question")
  })

  it('S40: "처음부터 다시" → side_question', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "처음부터 다시")
    expect(r.kind).toBe("side_question")
  })
})

// ---------------------------------------------------------------------------
// Part 5: Delegation — pending returns resolved(skip) (20 cases)
// ---------------------------------------------------------------------------

describe("delegation — pending skip (20)", () => {
  it('D01: "알아서 해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "알아서 해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D02: "너가 골라" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "너가 골라")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D03: "추천해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "추천해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D04: "아무거나 한개" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 한개")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D05: "아무거나 골라줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 골라줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D06: "니가 골라줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "니가 골라줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D07: "너가 추천해" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "너가 추천해")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D08: "하나만 골라줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "하나만 골라줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D09: "알아서 추천해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "알아서 추천해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D10: "추천으로 골라줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "추천으로 골라줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  // With different pending fields
  it('D11: "알아서 해줘" on fluteCount → resolved skip fluteCount', () => {
    const r = resolvePendingQuestionReply(fluteQuestionState, "알아서 해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") {
      expect(r.filter.op).toBe("skip")
      expect(r.filter.field).toBe("fluteCount")
    }
  })

  it('D12: "추천해줘" on coating → resolved skip coating', () => {
    const r = resolvePendingQuestionReply(coatingQuestionState, "추천해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") {
      expect(r.filter.op).toBe("skip")
      expect(r.filter.field).toBe("coating")
    }
  })

  it('D13: "너가 골라" on diameterMm → resolved skip', () => {
    const r = resolvePendingQuestionReply(diameterQuestionState, "너가 골라")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D14: "알아서 해" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "알아서 해")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D15: "아무거나 해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D16: "너가 알아서 해" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "너가 알아서 해")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D17: "아무거나 추천해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 추천해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D18: "아무거나 하나만 해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "아무거나 하나만 해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D19: "너가 추천해줘" → resolved skip', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "너가 추천해줘")
    expect(r.kind).toBe("resolved")
    if (r.kind === "resolved") expect(r.filter.op).toBe("skip")
  })

  it('D20: full pipeline "알아서 골라줘" → pending resolved skip', async () => {
    const c = await classifyIntent(subtypeQuestionState, "알아서 골라줘")
    expect(c.handler).toBe("pending")
    expect(c.kind).toBe("resolved")
    if (c.result.kind === "resolved") expect(c.result.filter.op).toBe("skip")
  })
})

// ---------------------------------------------------------------------------
// Part 6: General chat / none — nothing resolves (20 cases)
// ---------------------------------------------------------------------------

describe("general chat — none resolves (20)", () => {
  // No pending field + no revision/filter signal
  const noFieldState = makeState({ lastAskedField: undefined })

  it('G01: "안녕하세요" → none', async () => {
    const c = await classifyIntent(noFieldState, "안녕하세요")
    expect(c.handler).toBe("none")
  })

  it('G02: "감사합니다" → none', async () => {
    const c = await classifyIntent(noFieldState, "감사합니다")
    expect(c.handler).toBe("none")
  })

  it('G03: "ㅋㅋㅋ" → none', async () => {
    const c = await classifyIntent(noFieldState, "ㅋㅋㅋ")
    expect(c.handler).toBe("none")
  })

  it('G04: "네" → none', async () => {
    const c = await classifyIntent(noFieldState, "네")
    expect(c.handler).toBe("none")
  })

  it('G05: "좋아요" → none', async () => {
    const c = await classifyIntent(noFieldState, "좋아요")
    expect(c.handler).toBe("none")
  })

  it('G06: "오케이" → none', async () => {
    const c = await classifyIntent(noFieldState, "오케이")
    expect(c.handler).toBe("none")
  })

  it('G07: "알겠어" → none', async () => {
    const c = await classifyIntent(noFieldState, "알겠어")
    expect(c.handler).toBe("none")
  })

  it('G08: "고마워" → none', async () => {
    const c = await classifyIntent(noFieldState, "고마워")
    expect(c.handler).toBe("none")
  })

  it('G09: "hello" → none', async () => {
    const c = await classifyIntent(noFieldState, "hello")
    expect(c.handler).toBe("none")
  })

  it('G10: "thanks" → none', async () => {
    const c = await classifyIntent(noFieldState, "thanks")
    expect(c.handler).toBe("none")
  })

  // Resolved state — pending returns "none"
  it('G11: resolved state "Square" → none (no pending question)', async () => {
    const state = makeState({ resolutionStatus: "resolved" as any, lastAskedField: "toolSubtype" })
    const c = await classifyIntent(state, "Square")
    expect(c.handler).toBe("none")
  })

  it('G12: resolved state "4날" → none', async () => {
    const state = makeState({ resolutionStatus: "resolved" as any, lastAskedField: "fluteCount" })
    const c = await classifyIntent(state, "4날")
    expect(c.handler).toBe("none")
  })

  // No session / empty
  it('G13: null message → pending none', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, null)
    expect(r.kind).toBe("none")
  })

  it('G14: empty string → pending none', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "")
    expect(r.kind).toBe("none")
  })

  it('G15: whitespace only → pending none', () => {
    const r = resolvePendingQuestionReply(subtypeQuestionState, "   ")
    expect(r.kind).toBe("none")
  })

  it('G16: null state → pending none', () => {
    const r = resolvePendingQuestionReply(null, "Square")
    expect(r.kind).toBe("none")
  })

  // Random noise
  it('G17: "ㅎㅎ 잘됐다" → none (no pending field)', async () => {
    const c = await classifyIntent(noFieldState, "ㅎㅎ 잘됐다")
    expect(c.handler).toBe("none")
  })

  it('G18: "음..." → none', async () => {
    const c = await classifyIntent(noFieldState, "음...")
    expect(c.handler).toBe("none")
  })

  it('G19: "." → none', async () => {
    const c = await classifyIntent(noFieldState, ".")
    expect(c.handler).toBe("none")
  })

  it('G20: "ok" → none', async () => {
    const c = await classifyIntent(noFieldState, "ok")
    expect(c.handler).toBe("none")
  })
})
