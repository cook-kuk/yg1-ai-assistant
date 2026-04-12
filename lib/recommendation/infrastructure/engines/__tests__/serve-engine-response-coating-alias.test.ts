import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  buildCoatingAliasDisplayLabel,
  buildCoatingAliasGroundedQuestionText,
} from "../serve-engine-response"
import type { CandidateSnapshot, NarrowingTurn } from "@/lib/recommendation/domain/types"

function makeCandidate(coating: string | null): CandidateSnapshot {
  return {
    rank: 1,
    productCode: "TEST001",
    displayCode: "TEST001",
    displayLabel: null,
    brand: "YG-1",
    seriesName: "TEST",
    seriesIconUrl: null,
    diameterMm: 10,
    fluteCount: 4,
    coating,
    toolSubtype: "Square",
    toolMaterial: "Carbide",
    shankDiameterMm: 10,
    shankType: null,
    lengthOfCutMm: 20,
    overallLengthMm: 75,
    helixAngleDeg: null,
    coolantHole: null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    pointAngleDeg: null,
    threadPitchMm: null,
    description: null,
    featureText: null,
    materialTags: ["M"],
    score: 0.95,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "in_stock",
    totalStock: 10,
    inventorySnapshotDate: null,
    inventoryLocations: [],
    hasEvidence: true,
    bestCondition: null,
  }
}

function makeTurn(filters: NarrowingTurn["extractedFilters"]): NarrowingTurn {
  return {
    question: "코팅은 어떤 걸로 가실래요?",
    askedField: "coating",
    answer: "코팅 AlCrN으로 바꿔",
    extractedFilters: filters,
    candidateCountBefore: 101,
    candidateCountAfter: 101,
  }
}

describe("coating alias grounding", () => {
  it("renders chemical coating with the returned DB alias label", () => {
    const label = buildCoatingAliasDisplayLabel("AlCrN", [
      makeCandidate("Y-Coating"),
      makeCandidate("Y Coating"),
    ])

    expect(label).toBe("AlCrN(Y-Coating)")
  })

  it("returns null when candidates already use the same coating label", () => {
    const label = buildCoatingAliasDisplayLabel("TiAlN", [makeCandidate("TiAlN")])

    expect(label).toBeNull()
  })

  it("builds a deterministic alias-aware question response", () => {
    const responseText = buildCoatingAliasGroundedQuestionText({
      history: [
        makeTurn([
          { field: "coating", op: "eq", value: "AlCrN", rawValue: "AlCrN", appliedAt: 3 },
        ]),
      ],
      questionText: "어떤 가공으로 보실까요?",
      candidateSnapshot: [makeCandidate("Y-Coating")],
      totalCandidateCount: 101,
    })

    expect(responseText).toBe(
      "코팅은 AlCrN(Y-Coating) 기준으로 그대로 좁혀졌습니다. 현재 후보는 101개입니다. 어떤 가공으로 보실까요?",
    )
  })
})
