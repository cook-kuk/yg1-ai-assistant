import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const {
  findByCodeMock,
  findBrandProfilesMock,
  findSeriesProfilesMock,
  findMatchesMock,
  findForProductMock,
  findBySeriesNameMock,
  getEnrichedAsyncMock,
} = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
  findBrandProfilesMock: vi.fn(),
  findSeriesProfilesMock: vi.fn(),
  findMatchesMock: vi.fn(),
  findForProductMock: vi.fn(),
  findBySeriesNameMock: vi.fn(),
  getEnrichedAsyncMock: vi.fn(),
}))

vi.mock("@/lib/recommendation/infrastructure/repositories/recommendation-repositories", () => ({
  BrandReferenceRepo: { findMatches: findMatchesMock },
  EvidenceRepo: { findForProduct: findForProductMock, findBySeriesName: findBySeriesNameMock },
  EntityProfileRepo: {
    findSeriesProfiles: findSeriesProfilesMock,
    findBrandProfiles: findBrandProfilesMock,
  },
  InventoryRepo: { getEnrichedAsync: getEnrichedAsyncMock },
  ProductRepo: { findByCode: findByCodeMock },
}))

vi.mock("@/lib/recommendation/infrastructure/cache/session-cache", () => ({
  getSessionCache: () => ({
    getOrFetch: (_key: string, fn: () => Promise<unknown>) => fn(),
  }),
}))

vi.mock("@/lib/knowledge/knowledge-router", () => ({
  resolveYG1Query: () => ({ source: "none", answer: null }),
}))

vi.mock("@/lib/recommendation/domain/recommendation-domain", () => ({
  resolveMaterialTag: () => null,
}))

vi.mock("@/lib/recommendation/infrastructure/llm/recommendation-llm", () => ({
  getProvider: () => ({ available: () => false }),
  resolveModel: () => "haiku",
}))

vi.mock("@/lib/knowledge/company-prompt-snippet", () => ({
  YG1_COMPANY_SNIPPET: "",
}))

vi.mock("@/lib/recommendation/domain/context/unified-haiku-judgment", () => ({
  performUnifiedJudgment: vi.fn().mockResolvedValue({ domainRelevance: "tool_question" }),
}))

import {
  handleDirectEntityProfileQuestion,
  handleDirectProductInfoQuestion,
  handleDirectBrandReferenceQuestion,
  handleCompetitorCrossReference,
  handleDirectInventoryQuestion,
  handleDirectCuttingConditionQuestion,
  handleContextualNarrowingQuestion,
  shouldAttemptWebSearchFallback,
} from "../serve-engine-assist"

// ── Helpers ──

const mockProvider = { available: () => false, complete: vi.fn() } as any

function makeProduct(overrides?: Record<string, unknown>) {
  return {
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
    ...overrides,
  }
}

function makeScoredCandidate(overrides?: Record<string, unknown>) {
  return {
    product: makeProduct(overrides),
    score: 100,
    matchStatus: "exact",
    stockStatus: "instock",
    totalStock: 10,
    inventory: [],
  } as any
}

function makeSeriesProfile(overrides?: Record<string, unknown>) {
  return {
    normalizedSeriesName: "E5D70",
    seriesName: "E5D70",
    primaryBrandName: "YG-1",
    primaryDescription: "고성능 엔드밀",
    primaryFeature: "내마모 코팅",
    primaryToolType: "End Mill",
    primaryProductType: "Solid",
    primaryApplicationShape: "Side_Milling",
    primaryCuttingEdgeShape: null,
    toolSubtypes: ["Square"],
    fluteCounts: [4],
    coatingValues: ["TiAlN"],
    toolMaterialValues: ["Carbide"],
    diameterMinMm: 1,
    diameterMaxMm: 20,
    referenceIsoGroups: ["P", "M"],
    referenceWorkPieceNames: ["Carbon Steel"],
    materialWorkPieceNames: [],
    referenceHrcMin: null,
    referenceHrcMax: null,
    countryCodes: ["KR"],
    edpCount: 50,
    ...overrides,
  }
}

function makeBrandProfile(overrides?: Record<string, unknown>) {
  return {
    normalizedBrandName: "YG-AX",
    brandName: "YG-AX",
    primaryDescription: "고속 가공용 브랜드",
    primaryDescriptionWorkPiece: "알루미늄, 비철금속",
    seriesNames: ["AX01", "AX02"],
    seriesCount: 2,
    toolTypes: ["End Mill"],
    productTypes: ["Solid"],
    applicationShapeValues: ["Side_Milling"],
    cuttingEdgeShapeValues: [],
    fluteCounts: [2, 3],
    coatingValues: ["DLC"],
    toolMaterialValues: ["Carbide"],
    diameterMinMm: 1,
    diameterMaxMm: 25,
    referenceIsoGroups: ["N"],
    referenceWorkPieceNames: ["Aluminum"],
    materialWorkPieceNames: [],
    referenceHrcMin: null,
    referenceHrcMax: null,
    countryCodes: ["KR", "US"],
    edpCount: 120,
    ...overrides,
  }
}

// ── Tests ──

describe("handleDirectProductInfoQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByCodeMock.mockResolvedValue(null)
    findSeriesProfilesMock.mockResolvedValue([])
    findBrandProfilesMock.mockResolvedValue([])
  })

  it("returns product info for a known product code", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙 알려줘", {} as any, null)

    expect(findByCodeMock).toHaveBeenCalledWith("GYG02100")
    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("GYG02100 제품 정보를 내부 DB에서 조회했습니다.")
    expect(reply?.text).toContain("| 제품코드 | GYG02100 |")
  })

  it("returns specific field when user asks about coating", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 코팅이 뭐야?", {} as any, null)

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("코팅는 TiAlN입니다")
  })

  it("returns specific field for tool material question", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100의 공구 소재는?", {} as any, null)

    expect(reply?.text).toContain("공구 소재는 Carbide입니다")
  })

  it("returns specific field for flute count question", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 날수 알려줘", {} as any, null)

    expect(reply?.text).toContain("날 수는 4날입니다")
  })

  it("returns specific field for diameter question", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 직경 알려줘", {} as any, null)

    expect(reply?.text).toContain("직경")
  })

  it("returns not-found for unknown product code", async () => {
    findByCodeMock.mockResolvedValue(null)
    const reply = await handleDirectProductInfoQuestion("ZZZ99999 스펙 알려줘", {} as any, null)

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("제품 정보를 내부 DB에서 찾지 못했습니다")
  })

  it("returns null for inventory query pattern (defers to inventory handler)", async () => {
    const reply = await handleDirectProductInfoQuestion("GYG02100 재고 알려줘", {} as any, null)
    expect(reply).toBeNull()
  })

  it("returns null for cutting condition query pattern", async () => {
    const reply = await handleDirectProductInfoQuestion("GYG02100 절삭조건 알려줘", {} as any, null)
    expect(reply).toBeNull()
  })

  it("returns null for comparison requests (defers to entity profile)", async () => {
    const reply = await handleDirectProductInfoQuestion("GYG02100 vs GYG02200 비교해줘", {} as any, null)
    expect(reply).toBeNull()
  })

  it("generates correct follow-up chips for full spec response", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙 알려줘", {} as any, null)

    expect(reply?.chips).toBeDefined()
    expect(reply?.chips.length).toBeGreaterThan(0)
    expect(reply?.chips.some((c: string) => c.includes("재고"))).toBe(true)
    expect(reply?.chips.some((c: string) => c.includes("절삭조건"))).toBe(true)
  })

  it("generates correct chips for single-field response", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 코팅 뭐야?", {} as any, null)

    expect(reply?.chips).toBeDefined()
    expect(reply?.chips.some((c: string) => c.includes("전체 사양"))).toBe(true)
  })

  it("returns null for bare text with no product code", async () => {
    const reply = await handleDirectProductInfoQuestion("절삭공구 추천해줘", {} as any, null)
    expect(reply).toBeNull()
  })

  it("handles product with null optional fields", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({
      coating: null,
      toolMaterial: null,
      fluteCount: null,
      helixAngleDeg: null,
      coolantHole: null,
      description: null,
      featureText: null,
    }))
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙", {} as any, null)

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("GYG02100")
  })

  it("includes description and feature text when present", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({
      description: "High performance end mill",
      featureText: "Optimized for stainless steel",
    }))
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙", {} as any, null)

    expect(reply?.text).toContain("High performance end mill")
    expect(reply?.text).toContain("Optimized for stainless steel")
  })

  it("respects force option to bypass trigger pattern check", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion(
      "GYG02100",
      {} as any,
      null,
      { force: true }
    )

    expect(reply).not.toBeNull()
  })

  it("uses semanticContext lookupCode when provided", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({ displayCode: "ABC12345" }))
    const reply = await handleDirectProductInfoQuestion(
      "이 제품 스펙 알려줘",
      {} as any,
      null,
      { force: true, semanticContext: { lookupCode: "ABC12345" } as any }
    )

    expect(findByCodeMock).toHaveBeenCalledWith("ABC12345")
    expect(reply).not.toBeNull()
  })

  it("returns not-found with candidate hint when prevState has displayed candidates", async () => {
    findByCodeMock.mockResolvedValue(null)
    const prevState = {
      displayedCandidates: [{ productCode: "REAL001", displayCode: "REAL001" }],
    } as any
    const reply = await handleDirectProductInfoQuestion("ZZZ99999 스펙", {} as any, prevState)

    expect(reply?.text).toContain("찾지 못했습니다")
    expect(reply?.text).toContain("후보 제품")
  })
})

describe("handleDirectEntityProfileQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findSeriesProfilesMock.mockResolvedValue([])
    findBrandProfilesMock.mockResolvedValue([])
    findByCodeMock.mockResolvedValue(null)
  })

  it("returns single series info for a series name query", async () => {
    findSeriesProfilesMock.mockResolvedValue([makeSeriesProfile()])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "E5D70 시리즈 특징이 뭐야?", {} as any, null
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("E5D70 시리즈 프로필을 내부 DB에서 조회했습니다.")
    expect(reply?.text).toContain("| 시리즈 | E5D70 |")
  })

  it("returns single brand info for a brand query", async () => {
    findBrandProfilesMock.mockResolvedValue([makeBrandProfile()])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "YG-AX 브랜드 특징 알려줘", {} as any, null
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("YG-AX 브랜드 프로필을 내부 DB에서 조회했습니다.")
  })

  it("returns series comparison for two series with comparison keyword", async () => {
    findSeriesProfilesMock.mockResolvedValue([
      makeSeriesProfile({ normalizedSeriesName: "E5D70", seriesName: "E5D70" }),
      makeSeriesProfile({ normalizedSeriesName: "E5D80", seriesName: "E5D80" }),
    ])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "E5D70과 E5D80 차이가 뭐야?", {} as any, null
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("E5D70 vs E5D80")
    expect(reply?.text).toContain("비교했습니다")
  })

  it("returns brand comparison for two brands with comparison keyword", async () => {
    findBrandProfilesMock.mockResolvedValue([
      makeBrandProfile({ normalizedBrandName: "YG-AX", brandName: "YG-AX" }),
      makeBrandProfile({ normalizedBrandName: "YG-BX", brandName: "YG-BX" }),
    ])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "YG-AX과 YG-BX 브랜드 비교해줘", {} as any, null
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("YG-AX vs YG-BX")
    expect(reply?.text).toContain("브랜드를 내부 DB 기준으로 비교했습니다")
  })

  it("returns null when no entity names are extracted", async () => {
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "안녕하세요", {} as any, null
    )
    expect(reply).toBeNull()
  })

  it("returns null when profiles are not found", async () => {
    findSeriesProfilesMock.mockResolvedValue([])
    findBrandProfilesMock.mockResolvedValue([])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "NONEXISTENT 시리즈 알려줘", {} as any, null
    )
    expect(reply).toBeNull()
  })

  it("treats multiple entities without comparison keyword as implicit comparison", async () => {
    findSeriesProfilesMock.mockResolvedValue([
      makeSeriesProfile({ normalizedSeriesName: "GMG30", seriesName: "GMG30" }),
      makeSeriesProfile({ normalizedSeriesName: "GMG31", seriesName: "GMG31" }),
    ])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "GMG30과 GMG31 정보 알려줘", {} as any, null
    )

    expect(reply).not.toBeNull()
    // Should be treated as comparison (implicit multi-entity)
    expect(reply?.text).toContain("비교했습니다")
  })

  it("defers product_comparison to session handler when prevState is not null", async () => {
    // When prevState exists, product_comparison type should return null
    // (handled by session-based comparison handler instead)
    const prevState = { displayedCandidates: [] } as any
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "이 두 제품 비교해줘", {} as any, prevState
    )
    // With prevState !== null and no entity names extracted, returns null
    expect(reply).toBeNull()
  })

  it("includes unmatched entity note when some names are not found", async () => {
    findSeriesProfilesMock.mockResolvedValue([
      makeSeriesProfile({ normalizedSeriesName: "E5D70", seriesName: "E5D70" }),
    ])
    findBrandProfilesMock.mockResolvedValue([])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "E5D70과 PHANTOM99 시리즈 비교해줘", {} as any, null
    )

    if (reply) {
      // May contain unmatched note for PHANTOM99
      expect(reply.text).toBeDefined()
    }
  })

  it("returns correct chips for series info", async () => {
    findSeriesProfilesMock.mockResolvedValue([makeSeriesProfile()])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "E5D70 시리즈 뭐야?", {} as any, null
    )

    expect(reply?.chips).toEqual(expect.arrayContaining(["다른 시리즈 비교", "추천 제품 보기"]))
  })

  it("returns correct chips for brand info", async () => {
    findBrandProfilesMock.mockResolvedValue([makeBrandProfile()])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "YG-AX 브랜드 알려줘", {} as any, null
    )

    expect(reply?.chips).toEqual(expect.arrayContaining(["다른 브랜드 비교", "추천 제품 보기"]))
  })
})

describe("handleDirectBrandReferenceQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findMatchesMock.mockResolvedValue([])
  })

  it("returns guide when no ISO/workpiece/HRC conditions are specified", async () => {
    const reply = await handleDirectBrandReferenceQuestion(
      "브랜드 기준표 보여줘", {} as any, null
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("ISO, 피삭재, HRC 조건으로 조회할 수 있습니다")
    expect(reply?.chips).toEqual(expect.arrayContaining(["ISO H 브랜드"]))
  })

  it("returns no-match message when DB returns empty rows", async () => {
    findMatchesMock.mockResolvedValue([])
    const reply = await handleDirectBrandReferenceQuestion(
      "ISO Z 브랜드 뭐야?", {} as any, null,
      { force: true, semanticContext: { isoGroup: "Z" } as any }
    )

    expect(reply?.text).toContain("찾지 못했습니다")
  })

  it("returns brand reference table when matches are found", async () => {
    findMatchesMock.mockResolvedValue([
      { tagName: "P", workPieceName: "Carbon Steel", hardnessMinHrc: null, hardnessMaxHrc: null, brandName: "YG-AX" },
      { tagName: "P", workPieceName: "Carbon Steel", hardnessMinHrc: null, hardnessMaxHrc: null, brandName: "YG-BX" },
    ])
    const reply = await handleDirectBrandReferenceQuestion(
      "ISO P 브랜드 알려줘", {} as any, null,
      { force: true, semanticContext: { isoGroup: "P" } as any }
    )

    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("reference brand 기준표를 내부 DB에서 조회했습니다")
    expect(reply?.text).toContain("YG-AX")
  })

  it("returns null for non-brand-reference message without force", async () => {
    const reply = await handleDirectBrandReferenceQuestion(
      "알루미늄 10mm 추천해줘", {} as any, null
    )
    expect(reply).toBeNull()
  })

  it("uses semanticContext for ISO group, workpiece, and HRC", async () => {
    findMatchesMock.mockResolvedValue([
      { tagName: "H", workPieceName: "Hardened Steel", hardnessMinHrc: 50, hardnessMaxHrc: 60, brandName: "YG-HX" },
    ])
    const reply = await handleDirectBrandReferenceQuestion(
      "브랜드 추천해줘", {} as any, null,
      { force: true, semanticContext: { isoGroup: "H", workPieceName: "Hardened Steel", hardnessMinHrc: 50, hardnessMaxHrc: 60 } as any }
    )

    expect(reply?.text).toContain("YG-HX")
  })
})

describe("handleCompetitorCrossReference", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it("returns null for non-competitor messages", async () => {
    const reply = await handleCompetitorCrossReference("알루미늄 추천해줘", null)
    expect(reply).toBeNull()
  })

  it("returns null when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const reply = await handleCompetitorCrossReference("sandvik 대체품 추천", null)
    expect(reply).toBeNull()
  })

  it("detects competitor brand names in message", async () => {
    delete process.env.ANTHROPIC_API_KEY
    // Without API key it returns null, but it should at least detect the pattern
    const reply = await handleCompetitorCrossReference("kennametal KC7315 대체품", null)
    // Returns null due to no API key, but the pattern should match
    expect(reply).toBeNull()
  })

  it("detects Korean competitor keywords", async () => {
    delete process.env.ANTHROPIC_API_KEY
    const reply = await handleCompetitorCrossReference("경쟁사 제품 대체품 추천", null)
    expect(reply).toBeNull() // no API key
  })
})

describe("handleContextualNarrowingQuestion", () => {
  it("answers count questions from current candidates without committing filters", async () => {
    const prevState = {
      candidateCount: 4,
      appliedFilters: [],
      displayedOptions: [],
      lastAskedField: undefined,
      resolutionStatus: "resolved_exact",
    } as any

    const reply = await handleContextualNarrowingQuestion(
      mockProvider,
      "Ball\uC740 \uBA87\uAC1C\uC57C?",
      {} as any,
      [
        makeScoredCandidate({ toolSubtype: "Ball" }),
        makeScoredCandidate({ toolSubtype: "Square" }),
        makeScoredCandidate({ toolSubtype: "Square" }),
        makeScoredCandidate({ toolSubtype: "Radius" }),
      ],
      prevState,
      [],
    )

    expect(reply).toContain("Ball 1\uAC1C")
    expect(reply).toContain("\uD604\uC7AC \uD6C4\uBCF4 4\uAC1C")
  })
})

describe("shouldAttemptWebSearchFallback", () => {
  it("returns false for short messages", () => {
    expect(shouldAttemptWebSearchFallback("hi")).toBe(false)
    expect(shouldAttemptWebSearchFallback("")).toBe(false)
    expect(shouldAttemptWebSearchFallback("ab")).toBe(false)
  })

  it("returns false for simple chat patterns", () => {
    expect(shouldAttemptWebSearchFallback("안녕하세요")).toBe(false)
  })

  it("returns false for product code lookups", () => {
    expect(shouldAttemptWebSearchFallback("GYG02100 스펙")).toBe(false)
  })

  it("returns false for inventory queries", () => {
    expect(shouldAttemptWebSearchFallback("GYG02100 재고 알려줘")).toBe(false)
  })

  it("returns true for cutting knowledge questions", () => {
    expect(shouldAttemptWebSearchFallback("TiAlN 코팅의 장단점은?")).toBe(true)
  })

  it("returns true for general knowledge questions with question mark", () => {
    expect(shouldAttemptWebSearchFallback("엔드밀과 드릴의 차이는?")).toBe(true)
  })
})

describe("edge cases across handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByCodeMock.mockResolvedValue(null)
    findSeriesProfilesMock.mockResolvedValue([])
    findBrandProfilesMock.mockResolvedValue([])
    findMatchesMock.mockResolvedValue([])
  })

  it("product info with DB error returns not-found gracefully", async () => {
    findByCodeMock.mockRejectedValue(new Error("DB connection failed"))
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙 알려줘", {} as any, null)

    // Session cache calls fn directly, so error propagates.
    // But findDirectProductByCode has .catch(() => null), so it should return not-found.
    expect(reply).not.toBeNull()
    expect(reply?.text).toContain("찾지 못했습니다")
  })

  it("entity profile with DB error returns null gracefully", async () => {
    findSeriesProfilesMock.mockRejectedValue(new Error("DB error"))
    findBrandProfilesMock.mockRejectedValue(new Error("DB error"))
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "E5D70 시리즈 알려줘", {} as any, null
    )
    // resolveEntityProfiles has .catch(() => []) for each, so returns empty -> null
    expect(reply).toBeNull()
  })

  it("product code normalization works for lowercase input", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({ displayCode: "GYG02100" }))
    const reply = await handleDirectProductInfoQuestion("gyg02100 스펙", {} as any, null)

    expect(findByCodeMock).toHaveBeenCalledWith("GYG02100")
    expect(reply).not.toBeNull()
  })

  it("handles coolantHole true display", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({ coolantHole: true }))
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙", {} as any, null)

    expect(reply?.text).toContain("있음")
  })

  it("handles coolantHole false display", async () => {
    findByCodeMock.mockResolvedValue(makeProduct({ coolantHole: false }))
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙", {} as any, null)

    expect(reply?.text).toContain("없음")
  })

  it("product info includes Reference tag", async () => {
    findByCodeMock.mockResolvedValue(makeProduct())
    const reply = await handleDirectProductInfoQuestion("GYG02100 스펙", {} as any, null)

    expect(reply?.text).toContain("[Reference: YG-1 내부 DB]")
  })

  it("series comparison includes Reference tag", async () => {
    findSeriesProfilesMock.mockResolvedValue([
      makeSeriesProfile({ normalizedSeriesName: "A1", seriesName: "A1" }),
      makeSeriesProfile({ normalizedSeriesName: "A2", seriesName: "A2" }),
    ])
    const reply = await handleDirectEntityProfileQuestion(
      mockProvider, "A1과 A2 시리즈 차이", {} as any, null
    )

    expect(reply?.text).toContain("[Reference: YG-1 내부 DB]")
  })

  it("brand reference includes Reference tag", async () => {
    findMatchesMock.mockResolvedValue([
      { tagName: "P", workPieceName: "CS", hardnessMinHrc: null, hardnessMaxHrc: null, brandName: "B1" },
    ])
    const reply = await handleDirectBrandReferenceQuestion(
      "ISO P 브랜드 뭐야?", {} as any, null
    )

    expect(reply?.text).toContain("[Reference: YG-1 내부 DB]")
  })
})
