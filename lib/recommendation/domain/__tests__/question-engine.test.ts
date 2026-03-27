import { describe, expect, it } from "vitest"

import { explainQuestionFieldReplayFailure, selectNextQuestion, selectQuestionForField } from "@/lib/recommendation/domain/question-engine"
import type { NarrowingTurn, RecommendationInput, ScoredProduct } from "@/lib/recommendation/domain/types"

function makeInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    material: "알루미늄",
    workPieceName: "알루미늄",
    operationType: "Milling",
    flutePreference: 4,
    ...overrides,
  }
}

function makeHistory(): NarrowingTurn[] {
  return [
    {
      question: "initial",
      answer: "알루미늄",
      extractedFilters: [
        { field: "workPieceName", op: "includes", value: "알루미늄", rawValue: "알루미늄", appliedAt: 0 } as any,
      ],
      candidateCountBefore: 1852,
      candidateCountAfter: 275,
    },
    {
      question: "follow-up",
      answer: "4날",
      extractedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 1 } as any,
      ],
      candidateCountBefore: 275,
      candidateCountAfter: 49,
    },
  ]
}

function makeCandidate(toolSubtype: string, coating: string, code: string): ScoredProduct {
  return {
    product: {
      normalizedCode: code,
      displayCode: code,
      seriesName: "CE7659",
      brand: "YG-1",
      toolSubtype,
      coating,
      fluteCount: 4,
    },
    score: 53,
    scoreBreakdown: null,
    matchedFields: ["workPieceName", "fluteCount"],
    matchStatus: "approximate",
    inventory: [],
    leadTimes: [],
    evidence: [],
    stockStatus: "unknown",
    totalStock: null,
    minLeadTimeDays: null,
  } as any
}

describe("selectQuestionForField", () => {
  it("replays a still-valid pending field instead of choosing a different one", () => {
    const candidates = [
      makeCandidate("Square", "TiCN", "P1"),
      makeCandidate("Square", "X-Coating", "P2"),
      makeCandidate("Radius", "TiCN", "P3"),
      makeCandidate("Radius", "X-Coating", "P4"),
    ]

    const question = selectQuestionForField(makeInput(), candidates, makeHistory(), "toolSubtype", 50)

    expect(question?.field).toBe("toolSubtype")
    expect(question?.chips).toContain("Square (2개)")
    expect(question?.chips).toContain("Radius (2개)")
    expect(question?.chips).toContain("⟵ 이전 단계")
  })

  it("returns null when the preserved field is no longer meaningful", () => {
    const candidates = [
      makeCandidate("Square", "TiCN", "P1"),
      makeCandidate("Square", "X-Coating", "P2"),
    ]

    const question = selectQuestionForField(makeInput(), candidates, makeHistory(), "toolSubtype", candidates.length)

    expect(question).toBeNull()
  })

  it("explains why the preserved field can no longer be replayed", () => {
    const candidates = [
      makeCandidate("Square", "TiCN", "P1"),
      makeCandidate("Square", "X-Coating", "P2"),
    ]

    expect(explainQuestionFieldReplayFailure(makeInput(), candidates, "toolSubtype")).toContain("공구 세부 타입")
    expect(explainQuestionFieldReplayFailure(makeInput(), candidates, "toolSubtype")).toContain("같은 질문으로 후보를 더 나누기 어렵습니다")
  })
})

describe("selectNextQuestion", () => {
  it("prefers toolSubtype when multiple question fields are available", () => {
    const candidates = [
      {
        ...makeCandidate("Square", "TiCN", "P1"),
        product: { ...makeCandidate("Square", "TiCN", "P1").product, diameterMm: 10 },
      },
      {
        ...makeCandidate("Radius", "X-Coating", "P2"),
        product: { ...makeCandidate("Radius", "X-Coating", "P2").product, diameterMm: 12 },
      },
      {
        ...makeCandidate("Square", "TiCN", "P3"),
        product: { ...makeCandidate("Square", "TiCN", "P3").product, diameterMm: 14 },
      },
      {
        ...makeCandidate("Radius", "X-Coating", "P4"),
        product: { ...makeCandidate("Radius", "X-Coating", "P4").product, diameterMm: 16 },
      },
    ] as ScoredProduct[]

    const question = selectNextQuestion(
      makeInput({ workPieceName: undefined, flutePreference: undefined, diameterMm: 12 }),
      candidates,
      [],
      50
    )

    expect(question).not.toBeNull()
    expect(question?.field).toBe("toolSubtype")
    expect(question?.chips).toContain("Square (2개)")
    expect(question?.chips).toContain("Radius (2개)")
  })

  it("considers externally supplied workPiece question in the same priority ordering", () => {
    const candidates = [
      makeCandidate("Square", "TiCN", "P1"),
      makeCandidate("Square", "X-Coating", "P2"),
      makeCandidate("Square", "TiCN", "P3"),
      makeCandidate("Square", "X-Coating", "P4"),
    ]

    const question = selectNextQuestion(
      makeInput({ workPieceName: undefined, flutePreference: 4, diameterMm: undefined, toolSubtype: "Square" }),
      candidates,
      [],
      50,
      [{
        field: "workPieceName",
        questionText: "세부 피삭재를 선택해주세요.",
        chips: ["알루미늄 합금 (3개)", "비철금속 (1개)", "상관없음"],
      }]
    )

    expect(question).not.toBeNull()
    expect(question?.field).toBe("workPieceName")
    expect(question?.chips).toContain("알루미늄 합금 (3개)")
    expect(question?.chips).toContain("상관없음")
  })
})
