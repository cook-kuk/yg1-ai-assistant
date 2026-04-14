import { describe, expect, it } from "vitest"

import { buildRecommendationResponseDto, toRecommendationCandidateDto } from "../recommendation-presenter"
import type { CandidateSnapshot, ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeCandidate(rank: number, displayCode: string) {
  return {
    rank,
    productCode: displayCode,
    displayCode,
    displayLabel: null,
    brand: "YG-1",
    seriesName: "TEST",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 4,
    coating: "TiAlN",
    toolSubtype: "Square",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    lengthOfCutMm: 20,
    overallLengthMm: 75,
    helixAngleDeg: 35,
    description: null,
    featureText: null,
    materialTags: ["N"],
    score: 50,
    scoreBreakdown: null,
    matchStatus: "approximate" as const,
    stockStatus: "instock",
    totalStock: 10,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: false,
    bestCondition: null,
  }
}

describe("buildRecommendationResponseDto", () => {
  it("normalizes missing candidate arrays before building DTOs", () => {
    const dto = toRecommendationCandidateDto({
      ...makeCandidate(1, "SAFE-001"),
      materialTags: undefined,
      inventoryLocations: undefined,
    } as unknown as CandidateSnapshot)

    expect(dto.materialTags).toEqual([])
    expect(dto.inventoryLocations).toEqual([])
  })

  it("maps displayed-product style candidates into response DTO shape", () => {
    const dto = toRecommendationCandidateDto({
      rank: 3,
      code: "E5571000",
      brand: "YG-1",
      series: "X5070",
      diameter: 10,
      flute: 4,
      coating: "TiAlN",
      toolSubtype: "Ball",
      materialTags: ["M"],
      score: 91,
      matchStatus: "approximate",
    } as unknown as CandidateSnapshot)

    expect(dto.rank).toBe(3)
    expect(dto.productCode).toBe("E5571000")
    expect(dto.displayCode).toBe("E5571000")
    expect(dto.seriesName).toBe("X5070")
    expect(dto.diameterMm).toBe(10)
    expect(dto.fluteCount).toBe(4)
    expect(dto.toolSubtype).toBe("Ball")
    expect(dto.materialTags).toEqual(["M"])
  })

  it("preserves lastRecommendationArtifact candidates for non-recommendation replies", () => {
    const preserved = [makeCandidate(1, "KEEP-001")]
    const questionSnapshot = [makeCandidate(1, "QUESTION-001")]
    const sessionState = {
      sessionId: "s1",
      candidateCount: 1,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: questionSnapshot,
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: preserved,
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "吏덈Ц ?묐떟",
      purpose: "question",
      isComplete: false,
      sessionState,
      candidateSnapshot: questionSnapshot,
    })

    expect(dto.candidates?.[0]?.displayCode).toBe("KEEP-001")
  })

  it("does not append hallucination warning for material grades like SUS316L", () => {
    const dto = buildRecommendationResponseDto({
      text: "TitaNox-Power媛 SUS316L 媛怨듭뿉 臾대궃?⑸땲??",
      purpose: "recommendation",
      isComplete: true,
    })

    expect(dto.text).toContain("SUS316L")
    expect(dto.text).not.toContain("移댄깉濡쒓렇?먯꽌 ?뺤씤?섏? ?딆? ?쒕━利덈챸")
  })

  it("still appends hallucination warning for unknown series-like names", () => {
    const dto = buildRecommendationResponseDto({
      text: "ZXQ999 ?쒕━利덇? ?곹빀?⑸땲??",
      purpose: "recommendation",
      isComplete: true,
    })

    expect(dto.text).toContain("ZXQ999")
    expect(dto.text).toContain("⚠️")
  })

  it("surfaces thinkingDeep from session state", () => {
    const sessionState = {
      sessionId: "s-thinking",
      candidateCount: 1,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      thinkingProcess: "short reasoning",
      thinkingDeep: "full cot body",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "test",
      purpose: "question",
      isComplete: false,
      sessionState,
    })

    expect(dto.thinkingProcess).toBe("short reasoning")
    expect(dto.thinkingDeep).toBe("full cot body")
  })

  it("keeps neq filter reasoning idempotent without duplicating ?쒖쇅", () => {
    const sessionState = {
      sessionId: "s-neq",
      candidateCount: 10,
      appliedFilters: [
        { field: "coating", op: "neq", value: "T-Coating", rawValue: "T-Coating", appliedAt: 2 },
      ],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 2,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "test",
      purpose: "question",
      isComplete: false,
      sessionState,
    })

    const coatingMentions = (dto.thinkingProcess ?? "").match(/T-Coating/g) ?? []
    expect(coatingMentions.length).toBeGreaterThanOrEqual(2)
  })

  it("hides reasoning when reasoningVisibility is hidden", () => {
    const sessionState = {
      sessionId: "s-hidden",
      candidateCount: 10,
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4", rawValue: "4", appliedAt: 1 },
      ],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      thinkingProcess: "?④꺼?몄빞 ?섎뒗 reasoning",
      thinkingDeep: "?④꺼?몄빞 ?섎뒗 deep reasoning",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "test",
      purpose: "question",
      isComplete: false,
      sessionState,
      reasoningVisibility: "hidden",
    })

    expect(dto.reasoningVisibility).toBe("hidden")
    expect(dto.thinkingProcess).toBeNull()
    expect(dto.thinkingDeep).toBeNull()
  })

  it("replaces stale reasoning that claims there are no applied filters", () => {
    const sessionState = {
      sessionId: "s-stale",
      candidateCount: 10,
      appliedFilters: [
        { field: "workPieceName", op: "includes", value: "Hardened Steels", rawValue: "Hardened Steels", appliedAt: 1 },
        { field: "stockStatus", op: "eq", value: "instock", rawValue: "instock", appliedAt: 1 },
      ],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 2,
      displayedCandidates: [makeCandidate(1, "SAFE-101")],
      displayedChips: [],
      displayedOptions: [],
      thinkingProcess: "Currently Applied Filters: none",
      thinkingDeep: "stale deep reasoning",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "test",
      purpose: "question",
      isComplete: false,
      sessionState,
    })

    expect(dto.thinkingProcess).not.toContain("Currently Applied Filters: none")
    expect(dto.thinkingProcess).toContain("filters=")
    expect(dto.thinkingDeep).toBeNull()
  })

  it("falls back to truth-consistent text when answer denies cutting-condition evidence", () => {
    const candidate = {
      ...makeCandidate(1, "COND-101"),
      hasEvidence: true,
      bestCondition: {
        Vc: "120",
        n: null,
        fz: null,
        vf: null,
        ap: null,
        ae: null,
      },
    } as CandidateSnapshot
    const sessionState = {
      sessionId: "s-consistency",
      candidateCount: 1,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: [candidate],
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: [candidate],
      currentMode: "recommendation",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "there are no cutting conditions.",
      purpose: "recommendation",
      isComplete: true,
      sessionState,
      candidateSnapshot: [candidate],
    })

    expect(dto.text).not.toBe("there are no cutting conditions.")
    expect(dto.text).toContain("1")
  })
  it("falls back to truth-consistent text when answer denies inventory", () => {
    const sessionState = {
      sessionId: "s-consistency-inventory",
      candidateCount: 2,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      currentMode: "recommendation",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "there is no stock available.",
      purpose: "recommendation",
      isComplete: true,
      sessionState,
      candidateSnapshot: sessionState.lastRecommendationArtifact,
    })

    expect(dto.text).not.toBe("there is no stock available.")
  })

  it("falls back to English truth-consistent text when locale inference picks en from English text", () => {
    const sessionState = {
      sessionId: "s-consistency-inventory-en-by-message",
      candidateCount: 2,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
      },
      turnCount: 1,
      displayedCandidates: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      currentMode: "recommendation",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "there is no stock available.",
      purpose: "recommendation",
      isComplete: true,
      sessionState,
      candidateSnapshot: sessionState.lastRecommendationArtifact,
    })

    expect(dto.text).toContain("Among the 2 displayed candidates,")
    expect(dto.text).toContain("are available in stock.")
  })

  it("falls back to English truth-consistent text when locale is en", () => {
    const sessionState = {
      sessionId: "s-consistency-inventory-en",
      candidateCount: 2,
      appliedFilters: [],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "en" },
      turnCount: 1,
      displayedCandidates: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      displayedChips: [],
      displayedOptions: [],
      lastRecommendationArtifact: [
        {
          ...makeCandidate(1, "STOCK-101"),
          totalStock: 3,
          stockStatus: "instock",
        },
        {
          ...makeCandidate(2, "NO-STOCK-102"),
          totalStock: 0,
          stockStatus: "outofstock",
        },
      ],
      currentMode: "recommendation",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "재고가 없습니다.",
      purpose: "recommendation",
      isComplete: true,
      sessionState,
      candidateSnapshot: sessionState.lastRecommendationArtifact,
    })

    expect(dto.text).toContain("Among the 2 displayed candidates,")
    expect(dto.text).toContain("are available in stock.")
  })

  it("hides reasoning when reasoningVisibility is hidden", () => {
    const sessionState = {
      sessionId: "s-hidden",
      candidateCount: 10,
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4", rawValue: "4", appliedAt: 1 },
      ],
      narrowingHistory: [],
      stageHistory: [],
      resolutionStatus: "resolved_approximate",
      resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" },
      turnCount: 1,
      displayedCandidates: [],
      displayedChips: [],
      displayedOptions: [],
      thinkingProcess: "숨겨져야 하는 reasoning",
      thinkingDeep: "숨겨져야 하는 deep reasoning",
    } as ExplorationSessionState

    const dto = buildRecommendationResponseDto({
      text: "test",
      purpose: "question",
      isComplete: false,
      sessionState,
      reasoningVisibility: "hidden",
    })

    expect(dto.reasoningVisibility).toBe("hidden")
    expect(dto.thinkingProcess).toBeNull()
    expect(dto.thinkingDeep).toBeNull()
  })
})

