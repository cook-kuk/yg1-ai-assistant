import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const { findByCodeMock } = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
}))

vi.mock("@/lib/recommendation/infrastructure/repositories/recommendation-repositories", () => ({
  BrandReferenceRepo: {},
  EvidenceRepo: {},
  EntityProfileRepo: {},
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
  handleDirectProductInfoQuestion,
  shouldAttemptWebSearchFallback,
} from "../serve-engine-assist"

describe("handleDirectProductInfoQuestion", () => {
  beforeEach(() => {
    findByCodeMock.mockReset()
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
})
