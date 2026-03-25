import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { findByCodeMock, findBrandProfilesMock, findSeriesProfilesMock } = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
  findBrandProfilesMock: vi.fn(),
  findSeriesProfilesMock: vi.fn(),
}))

vi.mock("@/lib/recommendation/infrastructure/repositories/recommendation-repositories", () => ({
  BrandReferenceRepo: {},
  EvidenceRepo: {},
  EntityProfileRepo: {
    findSeriesProfiles: findSeriesProfilesMock,
    findBrandProfiles: findBrandProfilesMock,
  },
  InventoryRepo: {},
  ProductRepo: {
    findByCode: findByCodeMock,
  },
}))

vi.mock("@/lib/knowledge/knowledge-router", () => ({
  resolveYG1Query: () => ({ source: "none", answer: null }),
}))

vi.mock("@/lib/recommendation/domain/recommendation-domain", () => ({
  resolveMaterialTag: () => null,
}))

vi.mock("@/lib/recommendation/infrastructure/llm/recommendation-llm", () => ({
  getProvider: () => ({ available: () => false }),
}))

vi.mock("@/lib/knowledge/company-prompt-snippet", () => ({
  YG1_COMPANY_SNIPPET: "",
}))

import {
  handleDirectEntityProfileQuestion,
  handleDirectProductInfoQuestion,
  shouldAttemptWebSearchFallback,
} from "../serve-engine-assist"

describe("handleDirectProductInfoQuestion", () => {
  beforeEach(() => {
    findByCodeMock.mockReset()
    findSeriesProfilesMock.mockReset()
    findBrandProfilesMock.mockReset()
    findSeriesProfilesMock.mockResolvedValue([])
    findBrandProfilesMock.mockResolvedValue([])
  })

  it("returns direct field answer for product tool material question", async () => {
    findByCodeMock.mockResolvedValue({
      displayCode: "GYG02100",
      brand: "YG-1",
      seriesName: "GYG02",
      productName: "Test End Mill",
      toolSubtype: "Square",
      diameterMm: 10,
      fluteCount: 4,
      coating: "TiAlN",
      toolMaterial: "Carbide",
      shankDiameterMm: 10,
      lengthOfCutMm: 20,
      overallLengthMm: 75,
      helixAngleDeg: 35,
      coolantHole: false,
      applicationShapes: ["Side_Milling"],
      materialTags: ["P", "M"],
      description: null,
      featureText: null,
    })

    const reply = await handleDirectProductInfoQuestion(
      "GYG02100의 공구 소재는 뭐예요?",
      {} as any,
      null
    )

    expect(findByCodeMock).toHaveBeenCalledWith("GYG02100")
    expect(findSeriesProfilesMock).not.toHaveBeenCalled()
    expect(findBrandProfilesMock).not.toHaveBeenCalled()
    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("GYG02100의 공구 소재는 Carbide입니다.")
    expect(reply?.text).toContain("| 공구 소재 | Carbide |")
    expect(reply?.chips).toEqual(["GYG02100 전체 사양 알려줘", "GYG02100 재고 알려줘", "GYG02100 절삭조건 알려줘"])
  })

  it("does not hijack series profile questions", async () => {
    const reply = await handleDirectProductInfoQuestion(
      "E5D70 시리즈 특징이 뭐야?",
      {} as any,
      null
    )

    expect(findByCodeMock).not.toHaveBeenCalled()
    expect(reply).toBeNull()
  })

  it("keeps product code in follow-up chips for summary replies", async () => {
    findByCodeMock.mockResolvedValue({
      displayCode: "GYG02100",
      brand: "YG-1",
      seriesName: "GYG02",
      productName: "Test End Mill",
      toolSubtype: "Square",
      diameterMm: 10,
      fluteCount: 4,
      coating: "TiAlN",
      toolMaterial: "Carbide",
      shankDiameterMm: 10,
      lengthOfCutMm: 20,
      overallLengthMm: 75,
      helixAngleDeg: 35,
      coolantHole: false,
      applicationShapes: ["Side_Milling"],
      materialTags: ["P", "M"],
      description: null,
      featureText: null,
    })

    const reply = await handleDirectProductInfoQuestion(
      "GYG02100 스펙 알려줘",
      {} as any,
      null
    )

    expect(reply?.chips).toEqual(["GYG02100 재고 알려줘", "GYG02100 절삭조건 알려줘", "추천 제품 보기"])
  })

  it("resolves single-letter product codes via exact DB lookup", async () => {
    findByCodeMock.mockResolvedValue({
      displayCode: "P2777221",
      brand: "YG-1",
      seriesName: "TEST01",
      productName: "Single Letter Code Product",
      toolSubtype: "Square",
      diameterMm: 12,
      fluteCount: 4,
      coating: "TiAlN",
      toolMaterial: "Carbide",
      shankDiameterMm: 12,
      lengthOfCutMm: 24,
      overallLengthMm: 75,
      helixAngleDeg: 35,
      coolantHole: false,
      applicationShapes: ["Side_Milling"],
      materialTags: ["P"],
      description: null,
      featureText: null,
    })

    const reply = await handleDirectProductInfoQuestion(
      "P2777221 스펙 알려줘",
      {} as any,
      null
    )

    expect(findByCodeMock).toHaveBeenCalledWith("P2777221")
    expect(findSeriesProfilesMock).not.toHaveBeenCalled()
    expect(findBrandProfilesMock).not.toHaveBeenCalled()
    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("P2777221 제품 정보를 내부 DB에서 조회했습니다.")
  })

  it("does not hijack subtype taxonomy questions as product lookup", async () => {
    const reply = await handleDirectProductInfoQuestion(
      "slotting 하는데 적절한 공구 형상은 뭔가요?",
      {} as any,
      null
    )

    expect(findByCodeMock).not.toHaveBeenCalled()
    expect(reply).toBeNull()
  })

  it("allows taxonomy knowledge questions to reach web-search fallback", () => {
    expect(shouldAttemptWebSearchFallback("slotting 하는데 적절한 공구 형상은 뭔가요?")).toBe(true)
  })

  it("resolves brand profile questions even when brand regex misses the name", async () => {
    findBrandProfilesMock.mockResolvedValue([
      {
        normalizedBrandName: "GENERALCARBIDEDRILLS",
        brandName: "GENERAL CARBIDE DRILLS",
        primaryDescription: "General purpose drills",
        primaryDescriptionWorkPiece: "Carbon steel",
        seriesNames: ["GMG", "GMD"],
        seriesCount: 2,
        toolTypes: ["Solid"],
        productTypes: ["Drill"],
        applicationShapeValues: ["Holemaking"],
        cuttingEdgeShapeValues: [],
        materialTags: ["P"],
        materialWorkPieceNames: ["Carbon Steels"],
        countryCodes: ["KOR"],
        edpCount: 12,
        fluteCounts: [2],
        coatingValues: ["TiAlN"],
        toolMaterialValues: ["Carbide"],
        diameterMinMm: 3,
        diameterMaxMm: 20,
        referenceIsoGroups: ["P"],
        referenceWorkPieceNames: ["Carbon Steels"],
        referenceHrcMin: null,
        referenceHrcMax: null,
      },
    ])

    const reply = await handleDirectEntityProfileQuestion(
      { available: () => false } as any,
      "GENERAL CARBIDE DRILLS 특징이 뭐야?",
      {} as any,
      null
    )

    expect(reply).not.toBeNull()
    expect(findByCodeMock).not.toHaveBeenCalled()
    expect(reply?.text).toContain("GENERAL CARBIDE DRILLS 브랜드 프로필을 내부 DB에서 조회했습니다.")
  })
})
