import { describe, expect, it } from "vitest"

import { buildRecommendationResponseDto } from "../recommendation-presenter"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

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
})
