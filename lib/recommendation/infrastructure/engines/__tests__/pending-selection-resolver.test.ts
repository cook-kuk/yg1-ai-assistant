import { describe, expect, it } from "vitest"

import { buildPendingSelectionFilter, resolveExplicitComparisonAction, resolveExplicitRevisionRequest } from "../serve-engine-runtime"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

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

describe("pending selection resolver", () => {
  it("resolves explicit workPieceName selection from displayed options", () => {
    const state = makeState({
      lastAskedField: "workPieceName",
      displayedOptions: [
        { index: 1, label: "고경도강", field: "workPieceName", value: "고경도강", count: 12 },
        { index: 2, label: "공구강", field: "workPieceName", value: "공구강", count: 8 },
      ],
    })

    const filter = buildPendingSelectionFilter(state, "고경도강")

    expect(filter).toMatchObject({
      field: "workPieceName",
      op: "includes",
      value: "고경도강",
      rawValue: "고경도강",
    })
  })

  it("resolves explicit coating selection for generic pending fields", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
        { index: 2, label: "AlCrN (30개)", field: "coating", value: "AlCrN", count: 30 },
      ],
    })

    const filter = buildPendingSelectionFilter(state, "TiAlN")

    expect(filter).toMatchObject({
      field: "coating",
      op: "includes",
      value: "TiAlN",
      rawValue: "TiAlN",
    })
  })

  it('resolves "상관없음" as a skip filter for the pending field', () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (120개)", field: "toolSubtype", value: "Square", count: 120 },
        { index: 2, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
      ],
    })

    const filter = buildPendingSelectionFilter(state, "상관없음")

    expect(filter).toMatchObject({
      field: "toolSubtype",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
    })
  })

  it("does not resolve explanation-like free text as explicit selection", () => {
    const state = makeState({
      lastAskedField: "workPieceName",
      displayedOptions: [
        { index: 1, label: "고경도강", field: "workPieceName", value: "고경도강", count: 12 },
      ],
    })

    expect(buildPendingSelectionFilter(state, "고경도강이 뭐야?")).toBeNull()
  })
})

describe("explicit comparison resolver", () => {
  it('resolves "상위 4개 비교" against current candidates before chip matching', () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1001", displayCode: "P1001" } as any,
        { rank: 2, productCode: "P1002", displayCode: "P1002" } as any,
        { rank: 3, productCode: "P1003", displayCode: "P1003" } as any,
        { rank: 4, productCode: "P1004", displayCode: "P1004" } as any,
      ],
      displayedChips: ["상위 4개 비교"],
    })

    expect(resolveExplicitComparisonAction(state, "상위 4개 비교")).toEqual({
      type: "compare_products",
      targets: ["상위4"],
    })
  })

  it('resolves "1번이랑 2번 비교해줘" when numbered candidates exist', () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1001", displayCode: "P1001" } as any,
        { rank: 2, productCode: "P1002", displayCode: "P1002" } as any,
      ],
    })

    expect(resolveExplicitComparisonAction(state, "1번이랑 2번 비교해줘")).toEqual({
      type: "compare_products",
      targets: ["1번", "2번"],
    })
  })

  it("does not hijack field explanation questions into product comparison", () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1001", displayCode: "P1001" } as any,
        { rank: 2, productCode: "P1002", displayCode: "P1002" } as any,
      ],
    })

    expect(resolveExplicitComparisonAction(state, "코팅 차이 뭐야?")).toBeNull()
  })

  it("does not hijack series or brand comparison text without resolvable product references", () => {
    const state = makeState({
      displayedCandidates: [
        { rank: 1, productCode: "P1001", displayCode: "P1001" } as any,
        { rank: 2, productCode: "P1002", displayCode: "P1002" } as any,
      ],
    })

    expect(resolveExplicitComparisonAction(state, "GMG31과 GMG30 차이 설명")).toBeNull()
  })
})

describe("explicit revision resolver", () => {
  it('resolves "3날 대신 2날로 변경" as a fluteCount revision', () => {
    const state = makeState({
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 } as any,
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    expect(resolveExplicitRevisionRequest(state, "3날 대신 2날로 변경")).toMatchObject({
      targetField: "fluteCount",
      previousValue: "3날",
      nextFilter: {
        field: "fluteCount",
        op: "eq",
        value: "2날",
        rawValue: 2,
      },
    })
  })

  it('resolves recommendation-phase phrasing like "3날 말고 4날로 변경해서 추천해줘"', () => {
    const state = makeState({
      currentMode: "recommendation",
      appliedFilters: [
        { field: "workPieceName", op: "eq", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 } as any,
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 1 } as any,
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 2 } as any,
      ],
    })

    expect(resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경해서 추천해줘")).toMatchObject({
      targetField: "fluteCount",
      previousValue: "3날",
      nextFilter: {
        field: "fluteCount",
        op: "eq",
        value: "4날",
        rawValue: 4,
      },
    })
  })

  it("treats legacy stored numeric flute values and display text as the same previous filter", () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "3", rawValue: "3", appliedAt: 1 } as any,
      ],
    })

    expect(resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경")).toMatchObject({
      targetField: "fluteCount",
      previousValue: "3",
      nextFilter: {
        field: "fluteCount",
        value: "4날",
        rawValue: 4,
      },
    })
  })

  it("resolves coating revisions against existing applied filters", () => {
    const state = makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiCN", rawValue: "TiCN", appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    expect(resolveExplicitRevisionRequest(state, "TiCN 말고 Bright Finish로 변경")).toMatchObject({
      targetField: "coating",
      previousValue: "TiCN",
      nextFilter: {
        field: "coating",
        value: "Bright Finish",
      },
    })
  })

  it("does not treat a plain pending-answer selection as a revision", () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    expect(resolveExplicitRevisionRequest(state, "Radius")).toBeNull()
  })
})
