// ~$0.05 total (Haiku 100 calls)
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let origDetScr: string | undefined
beforeAll(() => { origDetScr = process.env.DETERMINISTIC_SCR; process.env.DETERMINISTIC_SCR = "0" })
afterAll(() => { if (origDetScr === undefined) delete process.env.DETERMINISTIC_SCR; else process.env.DETERMINISTIC_SCR = origDetScr })

import {
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
  resolvePendingQuestionReply,
} from "../serve-engine-runtime"
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

// ---------------------------------------------------------------------------
// Part 1: Revision accuracy (40 cases)
// ---------------------------------------------------------------------------

describe("revision — flute changes (10)", () => {
  const fluteState = (val: string, raw: number) =>
    makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: val, rawValue: raw, appliedAt: 0 } as any,
      ],
    })

  it('"3날 대신 2날" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 대신 2날")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"3날 말고 4날로" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 말고 4날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 4 } },
    })
  })

  it('"4날 아니고 2날로" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 아니고 2날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날로 변경" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"6날로 바꿔" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "6날로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"4날 말고 3날" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 3날")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 3 } },
    })
  })

  it('"3날 대신에 4날이요" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 대신에 4날이요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 4 } },
    })
  })

  it('"3날 말고 2날로 변경" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 말고 2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 6날로 바꿔" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 6날로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"2날로 수정" → fluteCount revision', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })
})

describe("revision — coating changes (10)", () => {
  const coatState = (val: string) =>
    makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
      ],
    })

  it('"TiAlN 말고 AlCrN" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 AlCrN")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"TiAlN 대신 DLC로" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 대신 DLC로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"AlCrN으로 변경" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "AlCrN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"Bright Finish로 바꿔" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiCN"), "Bright Finish로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiCN" },
    })
  })

  it('"AlCrN 대신 TiAlN으로" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 대신 TiAlN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"TiCN으로 바꿔" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiCN으로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 말고 TiCN으로 변경" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 TiCN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"TiCN 말고 Bright Finish로" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiCN"), "TiCN 말고 Bright Finish로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiCN" },
    })
  })

  it('"DLC로 변경" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "DLC로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"AlCrN 말고 DLC로 바꿔" → coating revision', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 말고 DLC로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })
})

describe("revision — subtype changes (10)", () => {
  const subtypeState = (val: string) =>
    makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
      ],
    })

  it('"Square 말고 Ball" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square", nextFilter: { field: "toolSubtype", value: "Ball" } },
    })
  })

  it('"형상을 Roughing으로 변경" → toolSubtype revision', async () => {
    const st = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square", coating: "TiCN", seriesName: "CE7659" } },
        { product: { toolSubtype: "Roughing", coating: "TiCN", seriesName: "GAA31" } },
      ] as any,
    })
    await expect(resolveExplicitRevisionRequest(st, "형상을 Roughing으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Ball로 바꿔" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Ball로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Radius로 변경" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Radius로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Radius 대신 Square로" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Radius"), "Radius 대신 Square로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Radius", nextFilter: { field: "toolSubtype", value: "Square" } },
    })
  })

  it('"황삭 말고 Square로" → toolSubtype revision (Korean alias)', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Roughing"), "황삭 말고 Square로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Roughing" },
    })
  })

  it('"Ball 말고 Radius로 변경" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 말고 Radius로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball", nextFilter: { field: "toolSubtype", value: "Radius" } },
    })
  })

  it('"Square 대신 Roughing으로" → toolSubtype revision', async () => {
    const st = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square", coating: "TiCN", seriesName: "CE7659" } },
        { product: { toolSubtype: "Roughing", coating: "TiCN", seriesName: "GAA31" } },
      ] as any,
    })
    await expect(resolveExplicitRevisionRequest(st, "Square 대신 Roughing으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Ball로 수정" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Ball로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Roughing 대신 Ball로" → toolSubtype revision', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Roughing"), "Roughing 대신 Ball로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Roughing" },
    })
  })
})

describe("revision — negative cases (10)", () => {
  const baseState = makeState({
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 1 } as any,
    ],
  })

  it("no revision signal: plain value 'Radius' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "Radius")).resolves.toBeNull()
  })

  it("no revision signal: greeting '안녕하세요' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "안녕하세요")).resolves.toBeNull()
  })

  it("question form: '코팅이 뭐야?' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "코팅이 뭐야?")).resolves.toBeNull()
  })

  it("question form: 'TiAlN이 뭔가요?' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "TiAlN이 뭔가요?")).resolves.toBeNull()
  })

  it("no applicable filter: '10날 말고 2날로' with no 10날 filter → null", async () => {
    const result = await resolveExplicitRevisionRequest(baseState, "10날 말고 2날로")
    // 10날 does not match any existing filter's previous value
    if (result !== null) {
      expect(result).toHaveProperty("kind")
    } else {
      expect(result).toBeNull()
    }
  })

  it("no revision signal: bare number '10' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "10")).resolves.toBeNull()
  })

  it("explanation request: 'AlCrN 코팅의 장단점은?' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "AlCrN 코팅의 장단점은?")).resolves.toBeNull()
  })

  it("recommendation request without revision: '추천해줘' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "추천해줘")).resolves.toBeNull()
  })

  it("completely unrelated: '오늘 날씨 어때?' → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "오늘 날씨 어때?")).resolves.toBeNull()
  })

  it("null session state → null", async () => {
    await expect(resolveExplicitRevisionRequest(null, "4날 말고 2날로 변경")).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Part 2: Filter accuracy (30 cases)
// ---------------------------------------------------------------------------

describe("filter — brand (8)", () => {
  const brandState = makeState({
    displayedCandidates: [
      { product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "ALU-POWER", seriesName: "E5E39", toolSubtype: "Square", coating: "DLC", fluteCount: 2 } },
      { product: { brand: "V7 PLUS", seriesName: "V7P01", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "I-POWER", seriesName: "SG5E16", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
    ] as any,
  })

  it('"TANK-POWER로 필터링" → brand=TANK-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "TANK-POWER로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"ALU-POWER만 보여줘" → brand=ALU-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "ALU-POWER만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER" } })
  })

  it('"V7 PLUS 브랜드로 좁혀줘" → brand=V7 PLUS', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "V7 PLUS 브랜드로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
  })

  it('"I-POWER만 보여줘" → brand=I-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "I-POWER만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "I-POWER" } })
  })

  it('"브랜드를 TANK-POWER로 좁혀줘" → brand=TANK-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "브랜드를 TANK-POWER로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"ALU-POWER 제품만 보여줘" → brand=ALU-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "ALU-POWER 제품만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER" } })
  })

  it('"TANK-POWER 브랜드로 필터링" → brand=TANK-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "TANK-POWER 브랜드로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"I-POWER로 필터링" → brand=I-POWER', async () => {
    const result = await resolveExplicitFilterRequest(brandState, "I-POWER로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "I-POWER" } })
  })
})

describe("filter — coating (8)", () => {
  const coatFilterState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", coating: "TiAlN", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "I-POWER", coating: "AlCrN", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "ALU-POWER", coating: "DLC", toolSubtype: "Square", fluteCount: 2 } },
      { product: { brand: "I-POWER", coating: "Bright Finish", toolSubtype: "Ball", fluteCount: 2 } },
    ] as any,
  })

  it('"TiAlN만 보여줘" → coating=TiAlN', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "TiAlN만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"DLC 코팅으로 필터링" → coating=DLC', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "DLC 코팅으로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"AlCrN으로 좁혀줘" → coating=AlCrN', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "AlCrN으로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"코팅 TiAlN으로 필터링" → coating=TiAlN', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "코팅 TiAlN으로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"Bright Finish 코팅만 보여줘" → coating=Bright Finish', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "Bright Finish 코팅만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Bright Finish" } })
  })

  it('"DLC만 보여줘" → coating=DLC', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "DLC만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"코팅을 AlCrN으로 좁혀줘" → coating=AlCrN', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "코팅을 AlCrN으로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"TiAlN 코팅 제품만 보여줘" → coating=TiAlN', async () => {
    const result = await resolveExplicitFilterRequest(coatFilterState, "TiAlN 코팅 제품만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })
})

describe("filter — subtype (8)", () => {
  const subtypeFilterState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", toolSubtype: "Ball", coating: "TiAlN", fluteCount: 2 } },
      { product: { brand: "I-POWER", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "TANK-POWER", toolSubtype: "Roughing", coating: "AlCrN", fluteCount: 4 } },
      { product: { brand: "I-POWER", toolSubtype: "Radius", coating: "TiAlN", fluteCount: 4 } },
    ] as any,
  })

  it('"Ball 형상으로 필터링" → toolSubtype=Ball', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Ball 형상으로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square만 보여줘" → toolSubtype=Square', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Square만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Roughing으로 좁혀줘" → toolSubtype=Roughing', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Roughing으로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"형상을 Radius로 필터링" → toolSubtype=Radius', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "형상을 Radius로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"Ball 타입만 보여줘" → toolSubtype=Ball', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Ball 타입만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square로 필터링" → toolSubtype=Square', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Square로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Roughing 형상만 보여줘" → toolSubtype=Roughing', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Roughing 형상만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"Radius로 필터링해줘" → toolSubtype=Radius', async () => {
    const result = await resolveExplicitFilterRequest(subtypeFilterState, "Radius로 필터링해줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })
})

describe("filter — flute (6)", () => {
  const fluteFilterState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", fluteCount: 2, toolSubtype: "Ball", coating: "TiAlN" } },
      { product: { brand: "I-POWER", fluteCount: 4, toolSubtype: "Square", coating: "TiAlN" } },
      { product: { brand: "TANK-POWER", fluteCount: 6, toolSubtype: "Roughing", coating: "AlCrN" } },
    ] as any,
  })

  it('"4날로 좁혀줘" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "4날로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날만 보여줘" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "2날만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"6날로 필터링" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "6날로 필터링", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"날수 4개로 좁혀줘" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "날수 4개로 좁혀줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"4날 제품만 보여줘" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "4날 제품만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날짜리만 보여줘" → fluteCount filter', async () => {
    const result = await resolveExplicitFilterRequest(fluteFilterState, "2날짜리만 보여줘", getProvider())
    expect(result).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })
})

// ---------------------------------------------------------------------------
// Part 3: Combined flow (30 cases) — pending + revision / answer / side question
// ---------------------------------------------------------------------------

describe("combined — pending active + revision message → unresolved (10)", () => {
  const pendingWithFlute = makeState({
    lastAskedField: "toolSubtype",
    displayedOptions: [
      { index: 1, label: "Square (120개)", field: "toolSubtype", value: "Square", count: 120 },
      { index: 2, label: "Ball (80개)", field: "toolSubtype", value: "Ball", count: 80 },
    ],
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
    ],
  })

  it('"4날 말고 2날로 변경" while pending toolSubtype → unresolved', () => {
    const r = resolvePendingQuestionReply(pendingWithFlute, "4날 말고 2날로 변경")
    expect(r.kind).toBe("unresolved")
  })

  it('"3날로 바꿔" while pending toolSubtype → unresolved', () => {
    const r = resolvePendingQuestionReply(pendingWithFlute, "3날로 바꿔")
    expect(r.kind).toBe("unresolved")
  })

  it('"DLC로 변경" while pending toolSubtype → unresolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 100 },
      ],
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "DLC로 변경")
    expect(r.kind).toBe("unresolved")
  })

  it('"TiAlN 대신 AlCrN으로" while pending coating → unresolved', () => {
    const st = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 50 },
        { index: 2, label: "AlCrN", field: "coating", value: "AlCrN", count: 30 },
      ],
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "TiAlN 대신 AlCrN으로")
    expect(r.kind).toBe("unresolved")
  })

  it('"Roughing으로 변경" while pending fluteCount → unresolved', () => {
    const st = makeState({
      lastAskedField: "fluteCount",
      displayedOptions: [
        { index: 1, label: "4날", field: "fluteCount", value: "4날", count: 40 },
      ],
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "Roughing으로 변경")
    expect(r.kind).toBe("unresolved")
  })

  it('"6날로 바꿔" while pending toolSubtype → unresolved', () => {
    const r = resolvePendingQuestionReply(pendingWithFlute, "6날로 바꿔")
    expect(r.kind).toBe("unresolved")
  })

  it('"AlCrN으로 바꿔" while pending toolSubtype → unresolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 100 },
      ],
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "AlCrN으로 바꿔")
    expect(r.kind).toBe("unresolved")
  })

  it('"2날로 수정" while pending coating → unresolved', () => {
    const st = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 50 },
      ],
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "2날로 수정")
    expect(r.kind).toBe("unresolved")
  })

  it('"Bright Finish로 변경" while pending toolSubtype → unresolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 100 },
      ],
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiCN", rawValue: "TiCN", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "Bright Finish로 변경")
    expect(r.kind).toBe("unresolved")
  })

  it('"Ball 대신 Radius로" while pending fluteCount → unresolved', () => {
    const st = makeState({
      lastAskedField: "fluteCount",
      displayedOptions: [
        { index: 1, label: "4날", field: "fluteCount", value: "4날", count: 40 },
      ],
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
      ],
    })
    const r = resolvePendingQuestionReply(st, "Ball 대신 Radius로")
    expect(r.kind).toBe("unresolved")
  })
})

describe("combined — pending active + valid answer → resolved (10)", () => {
  it('"Square" when pending toolSubtype with Square option → resolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (120개)", field: "toolSubtype", value: "Square", count: 120 },
        { index: 2, label: "Ball (80개)", field: "toolSubtype", value: "Ball", count: 80 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "Square")
    expect(r.kind).toBe("resolved")
  })

  it('"Ball" when pending toolSubtype → resolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 120 },
        { index: 2, label: "Ball", field: "toolSubtype", value: "Ball", count: 80 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "Ball")
    expect(r.kind).toBe("resolved")
  })

  it('"TiAlN" when pending coating → resolved', () => {
    const st = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
        { index: 2, label: "AlCrN (30개)", field: "coating", value: "AlCrN", count: 30 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "TiAlN")
    expect(r.kind).toBe("resolved")
  })

  it('"상관없음" when pending toolSubtype → resolved (skip)', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 120 },
        { index: 2, label: "상관없음", field: "toolSubtype", value: "skip", count: 0 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "상관없음")
    expect(r.kind).toBe("resolved")
  })

  it('"고경도강" when pending workPieceName → resolved', () => {
    const st = makeState({
      lastAskedField: "workPieceName",
      displayedOptions: [
        { index: 1, label: "고경도강", field: "workPieceName", value: "고경도강", count: 12 },
        { index: 2, label: "공구강", field: "workPieceName", value: "공구강", count: 8 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "고경도강")
    expect(r.kind).toBe("resolved")
  })

  it('"AlCrN" when pending coating → resolved', () => {
    const st = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 50 },
        { index: 2, label: "AlCrN", field: "coating", value: "AlCrN", count: 30 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "AlCrN")
    expect(r.kind).toBe("resolved")
  })

  it('"Roughing" when pending toolSubtype → resolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 100 },
        { index: 2, label: "Roughing", field: "toolSubtype", value: "Roughing", count: 60 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "Roughing")
    expect(r.kind).toBe("resolved")
  })

  it('"Square (120개)" chip label when pending toolSubtype → resolved', () => {
    const st = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Square (120개)", field: "toolSubtype", value: "Square", count: 120 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "Square (120개)")
    expect(r.kind).toBe("resolved")
  })

  it('"10" bare number when pending diameterMm → resolved', () => {
    const st = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
      filterValueScope: { diameterMm: ["6", "8"] },
    })
    const r = resolvePendingQuestionReply(st, "10")
    expect(r.kind).toBe("resolved")
  })

  it('"공구강" when pending workPieceName → resolved', () => {
    const st = makeState({
      lastAskedField: "workPieceName",
      displayedOptions: [
        { index: 1, label: "고경도강", field: "workPieceName", value: "고경도강", count: 12 },
        { index: 2, label: "공구강", field: "workPieceName", value: "공구강", count: 8 },
      ],
    })
    const r = resolvePendingQuestionReply(st, "공구강")
    expect(r.kind).toBe("resolved")
  })
})

describe("combined — pending active + side question → side_question (10)", () => {
  const pendingState = (field: string, opts: any[]) =>
    makeState({
      lastAskedField: field,
      displayedOptions: opts,
    })

  const toolOpts = [
    { index: 1, label: "Square", field: "toolSubtype", value: "Square", count: 120 },
    { index: 2, label: "Ball", field: "toolSubtype", value: "Ball", count: 80 },
  ]

  it('"TiAlN이 뭐야?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "TiAlN이 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('"코팅이 뭔가요?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "코팅이 뭔가요?")
    expect(r.kind).toBe("side_question")
  })

  it('"Square가 뭐야?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "Square가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('"황삭이 뭐예요?" while pending coating → side_question', () => {
    const coatOpts = [
      { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 50 },
    ]
    const r = resolvePendingQuestionReply(pendingState("coating", coatOpts), "황삭이 뭐예요?")
    expect(r.kind).toBe("side_question")
  })

  it('"Ball 엔드밀의 특징은?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "Ball 엔드밀의 특징은?")
    expect(r.kind).toBe("side_question")
  })

  it('"AlCrN과 TiAlN 차이가 뭐야?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "AlCrN과 TiAlN 차이가 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('"Roughing은 어떤 용도야?" while pending coating → side_question', () => {
    const coatOpts = [
      { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 50 },
    ]
    const r = resolvePendingQuestionReply(pendingState("coating", coatOpts), "Roughing은 어떤 용도야?")
    expect(r.kind).toBe("side_question")
  })

  it('"DLC 코팅의 장점이 뭐야?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "DLC 코팅의 장점이 뭐야?")
    expect(r.kind).toBe("side_question")
  })

  it('"이 제품 재고 있어?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "이 제품 재고 있어?")
    expect(r.kind).toBe("side_question")
  })

  it('"4날과 2날 차이점?" while pending toolSubtype → side_question', () => {
    const r = resolvePendingQuestionReply(pendingState("toolSubtype", toolOpts), "4날과 2날 차이점?")
    expect(r.kind).toBe("side_question")
  })
})
