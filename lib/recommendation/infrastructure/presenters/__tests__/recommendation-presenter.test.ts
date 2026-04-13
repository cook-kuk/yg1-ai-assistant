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
      text: "질문 응답",
      purpose: "question",
      isComplete: false,
      sessionState,
      candidateSnapshot: questionSnapshot,
    })

    expect(dto.candidates?.[0]?.displayCode).toBe("KEEP-001")
  })

  it("does not append hallucination warning for material grades like SUS316L", () => {
    const dto = buildRecommendationResponseDto({
      text: "TitaNox-Power가 SUS316L 가공에 무난합니다.",
      purpose: "recommendation",
      isComplete: true,
    })

    expect(dto.text).toContain("SUS316L")
    expect(dto.text).not.toContain("카탈로그에서 확인되지 않은 시리즈명")
  })

  it("still appends hallucination warning for unknown series-like names", () => {
    const dto = buildRecommendationResponseDto({
      text: "ZXQ999 시리즈가 적합합니다.",
      purpose: "recommendation",
      isComplete: true,
    })

    expect(dto.text).toContain("ZXQ999")
    expect(dto.text).toContain("카탈로그에서 확인되지 않은 시리즈명")
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

  it("keeps neq filter reasoning idempotent without duplicating 제외", () => {
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

    expect(dto.thinkingProcess).toContain("코팅 'T-Coating'")
    expect(dto.thinkingProcess).toContain("코팅 T-Coating 제외")
    expect(dto.thinkingProcess).not.toContain("제외 제외")
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
