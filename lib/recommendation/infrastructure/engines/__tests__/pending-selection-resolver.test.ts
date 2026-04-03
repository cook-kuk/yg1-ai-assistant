import { describe, expect, it } from "vitest"

import { buildPendingSelectionFilter, resolveExplicitComparisonAction, resolveExplicitFilterRequest, resolveExplicitRevisionRequest } from "../serve-engine-runtime"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
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

  it("resolves chip labels with counts for the pending field", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Radius (362개)", field: "toolSubtype", value: "Radius", count: 362 },
        { index: 2, label: "Square (164개)", field: "toolSubtype", value: "Square", count: 164 },
      ],
    })

    const filter = buildPendingSelectionFilter(state, "Square (164개)")

    expect(filter).toMatchObject({
      field: "toolSubtype",
      op: "includes",
      value: "Square",
      rawValue: "Square",
    })
  })

  it("resolves the clicked option from displayedOptions even when lastAskedField is stale", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedOptions: [
        { index: 1, label: "Square (167개)", field: "toolSubtype", value: "Square", count: 167 },
        { index: 2, label: "Spiral Flute (94개)", field: "toolSubtype", value: "Spiral Flute", count: 94 },
      ],
    })

    const filter = buildPendingSelectionFilter(state, "Square (167개)")

    expect(filter).toMatchObject({
      field: "toolSubtype",
      op: "includes",
      value: "Square",
      rawValue: "Square",
    })
  })

  it("falls back to displayedChips when displayedOptions are missing", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedChips: ["Square (1180개)", "Radius (362개)", "상관없음"],
      displayedOptions: [],
    })

    const filter = buildPendingSelectionFilter(state, "Radius (362개)")

    expect(filter).toMatchObject({
      field: "toolSubtype",
      op: "includes",
      value: "Radius",
      rawValue: "Radius",
    })
  })

  it("infers the correct field from filterValueScope when displayedOptions are missing and lastAskedField is stale", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedChips: ["Square (167개)", "Spiral Flute (94개)", "상관없음"],
      displayedOptions: [],
      filterValueScope: {
        toolSubtype: ["Square", "Spiral Flute", "Radius"],
        diameterMm: ["8", "8.03", "7.95"],
      },
    })

    const filter = buildPendingSelectionFilter(state, "Square (167개)")

    expect(filter).toMatchObject({
      field: "toolSubtype",
      op: "includes",
      value: "Square",
      rawValue: "Square",
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

  it("resolves bare number as diameter when pending field is diameterMm even if resolvedField drifts", () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
      filterValueScope: {
        edpSeriesName: ["SG9E76", "SG5E16"],
        diameterMm: ["6", "8"],
      },
    })

    const filter = buildPendingSelectionFilter(state, "10")

    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("diameterMm")
    expect(filter!.rawValue).toBe(10)
  })

  it("resolves bare number as diameter when pending field is diameterRefine", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })

    const filter = buildPendingSelectionFilter(state, "10")

    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("diameterMm")
    expect(filter!.rawValue).toBe(10)
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
  it('resolves "3날 대신 2날로 변경" as a fluteCount revision', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 } as any,
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    await expect(resolveExplicitRevisionRequest(state, "3날 대신 2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "3날",
        nextFilter: {
          field: "fluteCount",
          op: "eq",
          value: "2날",
          rawValue: 2,
        },
      },
    })
  })

  it('resolves recommendation-phase phrasing like "3날 말고 4날로 변경해서 추천해줘"', async () => {
    const state = makeState({
      currentMode: "recommendation",
      appliedFilters: [
        { field: "workPieceName", op: "eq", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 } as any,
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 1 } as any,
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 2 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경해서 추천해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "3날",
        nextFilter: {
          field: "fluteCount",
          op: "eq",
          value: "4날",
          rawValue: 4,
        },
      },
    })
  })

  it("treats legacy stored numeric flute values and display text as the same previous filter", async () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "3", rawValue: "3", appliedAt: 1 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "3날 말고 4날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "3",
        nextFilter: {
          field: "fluteCount",
          value: "4날",
          rawValue: 4,
        },
      },
    })
  })

  it("resolves coating revisions against existing applied filters", async () => {
    const state = makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiCN", rawValue: "TiCN", appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    await expect(resolveExplicitRevisionRequest(state, "TiCN 말고 Bright Finish로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "coating",
        previousValue: "TiCN",
        nextFilter: {
          field: "coating",
          value: "Bright Finish",
        },
      },
    })
  })

  it('resolves "형상을 roughing으로 변경" as a toolSubtype revision instead of workPieceName', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 1 } as any,
        { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 2 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square", coating: "TiCN", seriesName: "CE7659" } },
        { product: { toolSubtype: "Roughing", coating: "TiCN", seriesName: "GAA31" } },
      ] as any,
    })

    await expect(resolveExplicitRevisionRequest(state, "형상을 roughing으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Square",
        nextFilter: {
          field: "toolSubtype",
          value: "Roughing",
          rawValue: "Roughing",
        },
      },
    })
  })

  it("matches Korean subtype aliases against the active toolSubtype filter", async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Roughing", rawValue: "Roughing", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "황삭 말고 Square로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Roughing",
        nextFilter: {
          field: "toolSubtype",
          value: "Square",
          rawValue: "Square",
        },
      },
    })
  })

  it("resolves unambiguously when the target value already matches one filter (no real change for that field)", async () => {
    // "알루미늄으로 변경" with workPieceName already "알루미늄" → only toolSubtype changes
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
        { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 1 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "알루미늄으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
      },
    })
  })

  it("does not treat a plain pending-answer selection as a revision", async () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "3날", rawValue: 3, appliedAt: 1 } as any,
      ],
      lastAskedField: "toolSubtype",
    })

    await expect(resolveExplicitRevisionRequest(state, "Radius")).resolves.toBeNull()
  })
})

describe("explicit filter resolver", () => {
  it('resolves "Tank-Power로 필터링" as a brand filter before direct lookup routing', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing" } },
        { product: { brand: "ALU-POWER", seriesName: "E5E39", toolSubtype: "Roughing" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "Tank-Power로 필터링", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "brand",
        value: "TANK-POWER",
        rawValue: "TANK-POWER",
      },
    })
  })

  it('resolves "ALU-POWER HPC 브랜드로 필터링" as a brand filter when the value comes before the field phrase', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "ALU-POWER HPC", seriesName: "E5H22", toolSubtype: "Square" } },
        { product: { brand: "ALU-CUT for Korean Market", seriesName: "E5E83", toolSubtype: "Square" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "ALU-POWER HPC 브랜드로 필터링", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "brand",
        value: "ALU-POWER HPC",
        rawValue: "ALU-POWER HPC",
      },
    })
  })

  it('resolves longer slot-based phrasing like "지금 후보에서 브랜드를 ALU-POWER HPC로만 보여줘"', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "ALU-POWER HPC", seriesName: "E5H22", toolSubtype: "Square" } },
        { product: { brand: "ALU-CUT for Korean Market", seriesName: "E5E83", toolSubtype: "Square" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "지금 후보에서 브랜드를 ALU-POWER HPC로만 보여줘", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "brand",
        value: "ALU-POWER HPC",
        rawValue: "ALU-POWER HPC",
      },
    })
  })

  it("uses filterValueScope from the full candidate set instead of the visible snapshot", async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "ALU-CUT for Korean Market", seriesName: "E5E83", toolSubtype: "Square" } },
      ] as any,
      filterValueScope: {
        brand: ["ALU-POWER HPC", "ALU-CUT for Korean Market"],
      },
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "ALU-POWER HPC 브랜드로 필터링", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "brand",
        value: "ALU-POWER HPC",
        rawValue: "ALU-POWER HPC",
      },
    })
  })
})
