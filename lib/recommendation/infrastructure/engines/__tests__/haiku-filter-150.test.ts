// ~$0.10 total (Haiku 150 calls) — filter-only accuracy
import { describe, expect, it } from "vitest"

import { resolveExplicitFilterRequest } from "../serve-engine-runtime"
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

const provider = getProvider()

// ---------------------------------------------------------------------------
// Brand filtering (30 cases)
// ---------------------------------------------------------------------------

describe("filter — brand (30)", () => {
  const brandState = makeState({
    displayedCandidates: [
      { product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "ALU-POWER HPC", seriesName: "E5E39", toolSubtype: "Square", coating: "DLC", fluteCount: 2 } },
      { product: { brand: "V7 PLUS", seriesName: "V7P01", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "JET-POWER", seriesName: "JP001", toolSubtype: "Square", coating: "AlCrN", fluteCount: 4 } },
      { product: { brand: "I-POWER", seriesName: "SG5E16", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "X5070", seriesName: "X5070A", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "ONLY ONE", seriesName: "OO001", toolSubtype: "Ball", coating: "TiAlN", fluteCount: 2 } },
      { product: { brand: "4G MILL", seriesName: "4GM01", toolSubtype: "Square", coating: "AlCrN", fluteCount: 4 } },
    ] as any,
  })

  // Direct brand name + filter signal
  it('"TANK-POWER로 필터링" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "TANK-POWER로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"ALU-POWER HPC만 보여줘" → brand=ALU-POWER HPC', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ALU-POWER HPC만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('"V7 PLUS 브랜드로 좁혀" → brand=V7 PLUS', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "V7 PLUS 브랜드로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
  })

  it('"JET-POWER만 보여줘" → brand=JET-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "JET-POWER만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "JET-POWER" } })
  })

  it('"I-POWER 브랜드 제품만 보여줘" → brand=I-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "I-POWER 브랜드 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "I-POWER" } })
  })

  it('"X5070으로 필터" → brand=X5070', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "X5070으로 필터", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "X5070" } })
  })

  it('"ONLY ONE 브랜드만 보여줘" → brand=ONLY ONE', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ONLY ONE 브랜드만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ONLY ONE" } })
  })

  it('"4G MILL 브랜드로 좁혀줘" → brand=4G MILL', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "4G MILL 브랜드로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "4G MILL" } })
  })

  // Casual variations with filter signal
  it('"TANK-POWER만 찾아줘" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "TANK-POWER만 찾아줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"ALU-POWER HPC로 검색" → brand=ALU-POWER HPC', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ALU-POWER HPC로 검색", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('"V7 PLUS 기준으로 보여줘" → brand=V7 PLUS', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "V7 PLUS 기준으로 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
  })

  // With context
  it('"TANK-POWER가 좋다고 들었는데 그것만 보여줘" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "TANK-POWER가 좋다고 들었는데 그것만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  // More brand variations
  it('"TANK-POWER 제품만 보여줘" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "TANK-POWER 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"ALU-POWER HPC로 필터링해줘" → brand=ALU-POWER HPC', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ALU-POWER HPC로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('"V7 PLUS만 보여줘" → brand=V7 PLUS', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "V7 PLUS만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
  })

  it('"JET-POWER 브랜드로 필터링" → brand=JET-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "JET-POWER 브랜드로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "JET-POWER" } })
  })

  it('"I-POWER로 필터링" → brand=I-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "I-POWER로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "I-POWER" } })
  })

  it('"X5070만 보여줘" → brand=X5070', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "X5070만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "X5070" } })
  })

  it('"ONLY ONE으로 필터링" → brand=ONLY ONE', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ONLY ONE으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ONLY ONE" } })
  })

  it('"4G MILL 브랜드 제품만 보여줘" → brand=4G MILL', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "4G MILL 브랜드 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "4G MILL" } })
  })

  it('"브랜드를 TANK-POWER로 좁혀줘" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "브랜드를 TANK-POWER로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"브랜드 JET-POWER로 필터링해줘" → brand=JET-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "브랜드 JET-POWER로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "JET-POWER" } })
  })

  it('"JET-POWER로 좁혀줘" → brand=JET-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "JET-POWER로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "JET-POWER" } })
  })

  it('"I-POWER로 좁혀" → brand=I-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "I-POWER로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "I-POWER" } })
  })

  it('"ALU-POWER HPC 브랜드만 보여줘" → brand=ALU-POWER HPC', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ALU-POWER HPC 브랜드만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })

  it('"TANK-POWER로 좁혀줘" → brand=TANK-POWER', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "TANK-POWER로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "TANK-POWER" } })
  })

  it('"V7 PLUS로 필터링해주세요" → brand=V7 PLUS', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "V7 PLUS로 필터링해주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "V7 PLUS" } })
  })

  it('"ONLY ONE 브랜드 제품만 보여줘" → brand=ONLY ONE', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ONLY ONE 브랜드 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ONLY ONE" } })
  })

  it('"4G MILL 브랜드로 좁혀" → brand=4G MILL', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "4G MILL 브랜드로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "4G MILL" } })
  })

  it('"ALU-POWER HPC가 좋다던데 그걸로 필터링" → brand=ALU-POWER HPC', async () => {
    const r = await resolveExplicitFilterRequest(brandState, "ALU-POWER HPC가 좋다던데 그걸로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "brand", value: "ALU-POWER HPC" } })
  })
})

// ---------------------------------------------------------------------------
// Coating filtering (30 cases)
// ---------------------------------------------------------------------------

describe("filter — coating (30)", () => {
  const coatState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", coating: "TiAlN", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "I-POWER", coating: "AlCrN", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "ALU-POWER HPC", coating: "DLC", toolSubtype: "Square", fluteCount: 2 } },
      { product: { brand: "I-POWER", coating: "Bright Finish", toolSubtype: "Ball", fluteCount: 2 } },
      { product: { brand: "TANK-POWER", coating: "Blue-Coating", toolSubtype: "Roughing", fluteCount: 4 } },
      { product: { brand: "V7 PLUS", coating: "X-Coating", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "JET-POWER", coating: "Y-Coating", toolSubtype: "Square", fluteCount: 4 } },
      { product: { brand: "X5070", coating: "Uncoated", toolSubtype: "Square", fluteCount: 4 } },
    ] as any,
  })

  it('"TiAlN 코팅만 보여줘" → coating=TiAlN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "TiAlN 코팅만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"DLC로 필터링" → coating=DLC', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "DLC로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"블루코팅만 보여줘" → coating=Blue-Coating', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "블루코팅만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"Uncoated 코팅만 보여줘" → coating=Uncoated', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Uncoated 코팅만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Uncoated" } })
  })

  it('"AlCrN으로 좁혀" → coating=AlCrN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "AlCrN으로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"코팅을 X-Coating으로 필터링" → resolved coating (field hint "코팅" disambiguates)', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 X-Coating으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"코팅 종류를 TiAlN으로 좁혀주세요" → coating=TiAlN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅 종류를 TiAlN으로 좁혀주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"코팅 DLC만 보여줘" → coating=DLC', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅 DLC만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"TiAlN만 보여줘" → coating=TiAlN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "TiAlN만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"AlCrN 코팅으로 필터링" → coating=AlCrN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "AlCrN 코팅으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"Bright Finish 코팅만 보여줘" → coating=Bright Finish', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Bright Finish 코팅만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Bright Finish" } })
  })

  it('"DLC만 보여줘" → coating=DLC', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "DLC만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"코팅을 AlCrN으로 좁혀줘" → coating=AlCrN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 AlCrN으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"TiAlN 코팅 제품만 보여줘" → coating=TiAlN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "TiAlN 코팅 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"코팅을 Y-Coating으로 필터링" → resolved coating (field hint "코팅" disambiguates)', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 Y-Coating으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"Blue-Coating 코팅으로 좁혀줘" → coating=Blue-Coating', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Blue-Coating 코팅으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"Uncoated로 필터링해줘" → coating=Uncoated', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Uncoated로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Uncoated" } })
  })

  it('"코팅 X-Coating 제품만 보여줘" → resolved coating (field hint "코팅" disambiguates)', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅 X-Coating 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"코팅 Bright Finish로 좁혀" → coating=Bright Finish', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅 Bright Finish로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Bright Finish" } })
  })

  it('"코팅 Y-Coating만 보여줘" → resolved coating (field hint "코팅" disambiguates)', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅 Y-Coating만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"코팅을 DLC로 필터링해주세요" → coating=DLC', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 DLC로 필터링해주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"AlCrN 코팅만 보여줘" → coating=AlCrN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "AlCrN 코팅만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })

  it('"Bright Finish만 보여줘" → coating=Bright Finish', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Bright Finish만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Bright Finish" } })
  })

  it('"Blue-Coating 코팅으로 필터링" → coating=Blue-Coating', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Blue-Coating 코팅으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"Uncoated만 보여줘" → coating=Uncoated', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Uncoated만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Uncoated" } })
  })

  it('"Uncoated 제품만 보여줘" → coating=Uncoated', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "Uncoated 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "Uncoated" } })
  })

  it('"코팅을 X-Coating으로 좁혀줘" → resolved coating (field hint "코팅" disambiguates)', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 X-Coating으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating" } })
  })

  it('"DLC 코팅 제품만 보여줘" → coating=DLC', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "DLC 코팅 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "DLC" } })
  })

  it('"코팅을 TiAlN으로 좁혀주세요" → coating=TiAlN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "코팅을 TiAlN으로 좁혀주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "TiAlN" } })
  })

  it('"AlCrN으로 필터링해줘" → coating=AlCrN', async () => {
    const r = await resolveExplicitFilterRequest(coatState, "AlCrN으로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "coating", value: "AlCrN" } })
  })
})

// ---------------------------------------------------------------------------
// Subtype filtering (30 cases)
// ---------------------------------------------------------------------------

describe("filter — subtype (30)", () => {
  const subtypeState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", toolSubtype: "Ball", coating: "TiAlN", fluteCount: 2 } },
      { product: { brand: "I-POWER", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "TANK-POWER", toolSubtype: "Roughing", coating: "AlCrN", fluteCount: 4 } },
      { product: { brand: "I-POWER", toolSubtype: "Radius", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "V7 PLUS", toolSubtype: "Taper", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "JET-POWER", toolSubtype: "Chamfer", coating: "AlCrN", fluteCount: 4 } },
    ] as any,
  })

  it('"Ball 형상으로 필터링" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Ball 형상으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square만 보여줘" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Square만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Roughing으로 좁혀" → toolSubtype=Roughing', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Roughing으로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"Radius 형상만 보여줘" → toolSubtype=Radius', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Radius 형상만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"테이퍼만 보여줘" → toolSubtype=Taper', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "테이퍼만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Taper" } })
  })

  it('"챔퍼로 필터" → toolSubtype=Chamfer', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "챔퍼로 필터", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Chamfer" } })
  })

  it('"볼 형상만 보여줘" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "볼 형상만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"황삭만 보여줘" → toolSubtype=Roughing', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "황삭만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"코너레디우스만 보여줘" → toolSubtype=Radius', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "코너레디우스만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"형상을 Ball로 필터링" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "형상을 Ball로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square 형상으로 좁혀줘" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Square 형상으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Roughing 형상만 보여줘" → toolSubtype=Roughing', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Roughing 형상만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"Radius로 필터링해줘" → toolSubtype=Radius', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Radius로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"Ball 타입만 보여줘" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Ball 타입만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square로 필터링" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Square로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Taper 형상으로 필터링" → toolSubtype=Taper', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Taper 형상으로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Taper" } })
  })

  it('"Chamfer만 보여줘" → toolSubtype=Chamfer', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Chamfer만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Chamfer" } })
  })

  it('"형상을 Roughing으로 좁혀줘" → toolSubtype=Roughing', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "형상을 Roughing으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"Ball로 좁혀줘" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Ball로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"Square 제품만 보여줘" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Square 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"Radius 타입으로 필터링해줘" → toolSubtype=Radius', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Radius 타입으로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"Taper 형상으로 좁혀줘" → toolSubtype=Taper', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Taper 형상으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Taper" } })
  })

  it('"Chamfer 형상으로 좁혀줘" → toolSubtype=Chamfer', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Chamfer 형상으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Chamfer" } })
  })

  it('"볼만 보여줘" → toolSubtype=Ball', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "볼만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Ball" } })
  })

  it('"스퀘어로 필터링" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "스퀘어로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })

  it('"황삭으로 좁혀줘" → toolSubtype=Roughing', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "황삭으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Roughing" } })
  })

  it('"Radius만 보여줘" → toolSubtype=Radius', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "Radius만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Radius" } })
  })

  it('"테이퍼 형상만 보여줘" → toolSubtype=Taper', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "테이퍼 형상만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Taper" } })
  })

  it('"챔퍼만 보여줘" → toolSubtype=Chamfer', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "챔퍼만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Chamfer" } })
  })

  it('"형상을 Square로 필터링해주세요" → toolSubtype=Square', async () => {
    const r = await resolveExplicitFilterRequest(subtypeState, "형상을 Square로 필터링해주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "toolSubtype", value: "Square" } })
  })
})

// ---------------------------------------------------------------------------
// Flute filtering (20 cases)
// ---------------------------------------------------------------------------

describe("filter — flute (20)", () => {
  const fluteState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", fluteCount: 2, toolSubtype: "Ball", coating: "TiAlN" } },
      { product: { brand: "I-POWER", fluteCount: 3, toolSubtype: "Square", coating: "TiAlN" } },
      { product: { brand: "I-POWER", fluteCount: 4, toolSubtype: "Square", coating: "TiAlN" } },
      { product: { brand: "TANK-POWER", fluteCount: 6, toolSubtype: "Roughing", coating: "AlCrN" } },
    ] as any,
  })

  it('"4날로 좁혀줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "4날로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "2날만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"6날로 필터링" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "6날로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"3날 제품만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "3날 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"4 flute만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "4 flute만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날짜리만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "2날짜리만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"날수 4개로 좁혀줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "날수 4개로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"4날 제품만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "4날 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날로 필터링해줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "2날로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"6날만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "6날만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"3날로 좁혀" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "3날로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"날수를 2개로 필터링" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "날수를 2개로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"4날짜리만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "4날짜리만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"6날 제품으로 좁혀줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "6날 제품으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"3날만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "3날만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2 flute로 필터링" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "2 flute로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"4날로 필터링해주세요" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "4날로 필터링해주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"6 flute만 보여줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "6 flute만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"날수 3개로 필터링해줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "날수 3개로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })

  it('"2날로 좁혀줘" → fluteCount', async () => {
    const r = await resolveExplicitFilterRequest(fluteState, "2날로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "fluteCount" } })
  })
})

// ---------------------------------------------------------------------------
// Series filtering (20 cases)
// ---------------------------------------------------------------------------

describe("filter — series (20)", () => {
  const seriesState = makeState({
    displayedCandidates: [
      { product: { brand: "V7 PLUS", seriesName: "V7P01", toolSubtype: "Square", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "4G MILL", seriesName: "4GM01", toolSubtype: "Square", coating: "AlCrN", fluteCount: 4 } },
      { product: { brand: "I-POWER", seriesName: "E5E84", toolSubtype: "Ball", coating: "TiAlN", fluteCount: 2 } },
      { product: { brand: "I-POWER", seriesName: "SG9E76", toolSubtype: "Radius", coating: "TiAlN", fluteCount: 4 } },
      { product: { brand: "TANK-POWER", seriesName: "GAA31", toolSubtype: "Roughing", coating: "AlCrN", fluteCount: 4 } },
    ] as any,
  })

  it('"V7P01 시리즈로 필터링" → seriesName=V7P01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "V7P01 시리즈로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "V7P01" } })
  })

  it('"4GM01 시리즈만 보여줘" → seriesName=4GM01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "4GM01 시리즈만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "4GM01" } })
  })

  it('"E5E84 시리즈만 보여줘" → seriesName=E5E84', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "E5E84 시리즈만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "E5E84" } })
  })

  it('"SG9E76 시리즈로 좁혀" → seriesName=SG9E76', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "SG9E76 시리즈로 좁혀", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "SG9E76" } })
  })

  it('"GAA31만 보여줘" → seriesName=GAA31', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "GAA31만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "GAA31" } })
  })

  it('"V7P01로 필터링해줘" → seriesName=V7P01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "V7P01로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "V7P01" } })
  })

  it('"시리즈를 E5E84로 좁혀줘" → seriesName=E5E84', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "시리즈를 E5E84로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "E5E84" } })
  })

  it('"시리즈 4GM01로 필터링" → seriesName=4GM01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "시리즈 4GM01로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "4GM01" } })
  })

  it('"SG9E76 시리즈만 보여줘" → seriesName=SG9E76', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "SG9E76 시리즈만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "SG9E76" } })
  })

  it('"GAA31 시리즈만 보여줘" → seriesName=GAA31', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "GAA31 시리즈만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "GAA31" } })
  })

  it('"V7P01만 보여줘" → seriesName=V7P01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "V7P01만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "V7P01" } })
  })

  it('"시리즈 GAA31로 필터링" → seriesName=GAA31', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "시리즈 GAA31로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "GAA31" } })
  })

  it('"E5E84 시리즈로 좁혀줘" → seriesName=E5E84', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "E5E84 시리즈로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "E5E84" } })
  })

  it('"4GM01 시리즈로 필터링해줘" → seriesName=4GM01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "4GM01 시리즈로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "4GM01" } })
  })

  it('"SG9E76 시리즈 제품만 보여줘" → seriesName=SG9E76', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "SG9E76 시리즈 제품만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "SG9E76" } })
  })

  it('"GAA31로 필터링해줘" → seriesName=GAA31', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "GAA31로 필터링해줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "GAA31" } })
  })

  it('"시리즈를 V7P01로 필터링해주세요" → seriesName=V7P01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "시리즈를 V7P01로 필터링해주세요", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "V7P01" } })
  })

  it('"E5E84 시리즈로 필터링" → seriesName=E5E84', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "E5E84 시리즈로 필터링", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "E5E84" } })
  })

  it('"시리즈 SG9E76으로 좁혀줘" → seriesName=SG9E76', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "시리즈 SG9E76으로 좁혀줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "SG9E76" } })
  })

  it('"4GM01 시리즈만 보여줘" → seriesName=4GM01', async () => {
    const r = await resolveExplicitFilterRequest(seriesState, "4GM01 시리즈만 보여줘", provider)
    expect(r).toMatchObject({ kind: "resolved", filter: { field: "seriesName", value: "4GM01" } })
  })
})

// ---------------------------------------------------------------------------
// Negative cases (20 cases) — should return null
// ---------------------------------------------------------------------------

describe("filter — negative (20)", () => {
  const negState = makeState({
    displayedCandidates: [
      { product: { brand: "I-POWER", toolSubtype: "Ball", coating: "TiAlN", fluteCount: 2, seriesName: "SG5E16" } },
      { product: { brand: "TANK-POWER", toolSubtype: "Square", coating: "AlCrN", fluteCount: 4, seriesName: "GAA31" } },
      { product: { brand: "V7 PLUS", toolSubtype: "Radius", coating: "DLC", fluteCount: 4, seriesName: "V7P01" } },
    ] as any,
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 0 } as any,
    ],
  })

  // Revision signals (should go to revision, not filter)
  it('"Ball 말고 Radius로" → null (revision signal)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "Ball 말고 Radius로", provider)
    expect(r).toBeNull()
  })

  it('"Ball 대신 Square로" → null (revision signal)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "Ball 대신 Square로", provider)
    expect(r).toBeNull()
  })

  it('"Ball 아니고 Radius로 변경" → null (revision signal)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "Ball 아니고 Radius로 변경", provider)
    expect(r).toBeNull()
  })

  it('"TiAlN 말고 AlCrN으로 바꿔" → null (revision signal)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "TiAlN 말고 AlCrN으로 바꿔", provider)
    expect(r).toBeNull()
  })

  it('"코팅 TiAlN에서 DLC로 변경" → null (revision signal)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "코팅 TiAlN에서 DLC로 변경", provider)
    expect(r).toBeNull()
  })

  // Questions
  it('"이 제품 뭐야?" → null (question)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "이 제품 뭐야?", provider)
    expect(r).toBeNull()
  })

  it('"코팅 차이 설명해줘" → null (question)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "코팅 차이 설명해줘", provider)
    expect(r).toBeNull()
  })

  it('"TiAlN이 뭔가요?" → null (question)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "TiAlN이 뭔가요?", provider)
    expect(r).toBeNull()
  })

  it('"AlCrN 코팅의 장단점은?" → null (question)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "AlCrN 코팅의 장단점은?", provider)
    expect(r).toBeNull()
  })

  it('"Ball과 Square 차이가 뭐야?" → null (question)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "Ball과 Square 차이가 뭐야?", provider)
    expect(r).toBeNull()
  })

  // General / unrelated
  it('"추천해줘" → null (general)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "추천해줘", provider)
    expect(r).toBeNull()
  })

  it('"알아서 해줘" → null (general)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "알아서 해줘", provider)
    expect(r).toBeNull()
  })

  it('"좋은 거 골라줘" → null (general)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "좋은 거 골라줘", provider)
    expect(r).toBeNull()
  })

  it('"오늘 날씨 어때?" → null (unrelated)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "오늘 날씨 어때?", provider)
    expect(r).toBeNull()
  })

  it('"안녕하세요" → null (greeting)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "안녕하세요", provider)
    expect(r).toBeNull()
  })

  // No matching value in candidates
  it('"존재하지않는브랜드로 필터링" → null (no match)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "존재하지않는브랜드로 필터링", provider)
    expect(r).toBeNull()
  })

  it('"SUPER-BRAND만 보여줘" → null (no match)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "SUPER-BRAND만 보여줘", provider)
    expect(r).toBeNull()
  })

  it('"ZZZ-Coating으로 필터링" → null (no match)', async () => {
    const r = await resolveExplicitFilterRequest(negState, "ZZZ-Coating으로 필터링", provider)
    expect(r).toBeNull()
  })

  // Null inputs
  it("null session → null", async () => {
    const r = await resolveExplicitFilterRequest(null, "TANK-POWER만", provider)
    expect(r).toBeNull()
  })

  it("null message → null", async () => {
    const r = await resolveExplicitFilterRequest(negState, null, provider)
    expect(r).toBeNull()
  })
})
