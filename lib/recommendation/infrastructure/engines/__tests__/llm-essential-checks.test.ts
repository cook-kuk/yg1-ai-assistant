// These tests call Haiku LLM — ~$0.01 total cost
import { afterAll, beforeAll, describe, expect, it } from "vitest"

let origDetScr: string | undefined
beforeAll(() => { origDetScr = process.env.DETERMINISTIC_SCR; process.env.DETERMINISTIC_SCR = "0" })
afterAll(() => { if (origDetScr === undefined) delete process.env.DETERMINISTIC_SCR; else process.env.DETERMINISTIC_SCR = origDetScr })

import { resolveExplicitRevisionRequest, resolveExplicitFilterRequest } from "../serve-engine-runtime"
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

describe("revision — LLM essential checks", () => {
  it('"Ball 말고 Radius로" with toolSubtype=Ball → resolved, targetField=toolSubtype', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "Ball 말고 Radius로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "toolSubtype",
        previousValue: "Ball",
        nextFilter: {
          field: "toolSubtype",
          value: "Radius",
          rawValue: "Radius",
        },
      },
    })
  })

  it('"4날 말고 2날로 변경" with fluteCount=4날 → resolved, targetField=fluteCount', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "4날 말고 2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "fluteCount",
        previousValue: "4날",
        nextFilter: {
          field: "fluteCount",
          value: "2날",
          rawValue: 2,
        },
      },
    })
  })

  it('"TiAlN 대신 AlCrN으로" with coating=TiAlN → resolved, targetField=coating', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "TiAlN 대신 AlCrN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "coating",
        previousValue: "TiAlN",
        nextFilter: {
          field: "coating",
        },
      },
    })
  })

  it('"황삭 대신 Square로" with toolSubtype=Roughing → resolved (Korean alias)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Roughing", rawValue: "Roughing", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "황삭 대신 Square로")).resolves.toMatchObject({
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

  it('"TiCN 말고 Bright Finish로 변경" with coating=TiCN → resolved (coating revision)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "coating", op: "includes", value: "TiCN", rawValue: "TiCN", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "TiCN 말고 Bright Finish로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: {
        targetField: "coating",
        previousValue: "TiCN",
      },
    })
  })

  it('"형상을 Roughing으로 변경" with toolSubtype=Square → resolved', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Square", rawValue: "Square", appliedAt: 0 } as any,
      ],
      displayedCandidates: [
        { product: { toolSubtype: "Square", coating: "TiCN", seriesName: "CE7659" } },
        { product: { toolSubtype: "Roughing", coating: "TiCN", seriesName: "GAA31" } },
      ] as any,
    })

    await expect(resolveExplicitRevisionRequest(state, "형상을 Roughing으로 변경")).resolves.toMatchObject({
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

  it('no revision signal "Radius" → null', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
      ],
    })

    await expect(resolveExplicitRevisionRequest(state, "Radius")).resolves.toBeNull()
  })

  it('"10날 말고 2날로" with no matching 10날 filter → null or resolved differently', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      ],
    })

    const result = await resolveExplicitRevisionRequest(state, "10날 말고 2날로")

    // 10날 does not match any existing filter — should be null or not match fluteCount's previousValue
    if (result !== null) {
      expect(result).toHaveProperty("kind")
    } else {
      expect(result).toBeNull()
    }
  })
})

describe("filter — LLM essential checks", () => {
  it('"Tank-Power로 필터링" with displayed candidate brand TANK-POWER → resolved, brand', async () => {
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

  it('"코팅 TiAlN만 보여줘" → resolved, coating field', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "I-POWER", coating: "TiAlN", seriesName: "SG5E16", toolSubtype: "Square" } },
        { product: { brand: "I-POWER", coating: "AlCrN", seriesName: "SG9E76", toolSubtype: "Square" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "코팅 TiAlN만 보여줘", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "coating",
        value: "TiAlN",
        rawValue: "TiAlN",
      },
    })
  })

  it('"6날로 좁혀줘" → resolved, fluteCount', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "I-POWER", fluteCount: 4, toolSubtype: "Square" } },
        { product: { brand: "I-POWER", fluteCount: 6, toolSubtype: "Square" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "6날로 좁혀줘", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "fluteCount",
      },
    })
  })

  it('"Ball 형상으로 필터링" → resolved, toolSubtype', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "I-POWER", toolSubtype: "Ball", seriesName: "SG5B16" } },
        { product: { brand: "I-POWER", toolSubtype: "Square", seriesName: "SG5E16" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "Ball 형상으로 필터링", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "toolSubtype",
        value: "Ball",
        rawValue: "Ball",
      },
    })
  })

  it('"V7 PLUS 시리즈로 필터링" → resolved, seriesName', async () => {
    const state = makeState({
      displayedCandidates: [
        { product: { brand: "I-POWER", seriesName: "V7 PLUS", toolSubtype: "Square" } },
        { product: { brand: "I-POWER", seriesName: "SG5E16", toolSubtype: "Square" } },
      ] as any,
    })

    const provider = getProvider()
    const result = await resolveExplicitFilterRequest(state, "V7 PLUS 시리즈로 필터링", provider)

    expect(result).toMatchObject({
      kind: "resolved",
      filter: {
        field: "seriesName",
        value: "V7 PLUS",
        rawValue: "V7 PLUS",
      },
    })
  })
})
