import { describe, expect, it } from "vitest"

import type { CandidateSnapshot, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import {
  assertAnswerCardEvidenceConsistency,
  assertFreshReasoningSummary,
  buildTurnTruth,
  buildTruthConsistentAnswerFallback,
  buildTurnTruthThinkingSummary,
  filterDisplayedCandidatesByTruth,
  mergeInventoryTruthFilters,
} from "../turn-truth"

function makeCandidate(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    rank: overrides.rank ?? 1,
    productCode: overrides.productCode ?? "TEST-001",
    displayCode: overrides.displayCode ?? overrides.productCode ?? "TEST-001",
    displayLabel: overrides.displayLabel ?? "TEST-001",
    brand: overrides.brand ?? "YG-1",
    seriesName: overrides.seriesName ?? "X5070",
    seriesIconUrl: overrides.seriesIconUrl ?? null,
    diameterMm: overrides.diameterMm ?? 10,
    fluteCount: overrides.fluteCount ?? 4,
    coating: overrides.coating ?? "TiAlN",
    toolSubtype: overrides.toolSubtype ?? "Square",
    toolMaterial: overrides.toolMaterial ?? "Carbide",
    shankDiameterMm: overrides.shankDiameterMm ?? 10,
    shankType: overrides.shankType ?? null,
    lengthOfCutMm: overrides.lengthOfCutMm ?? 20,
    overallLengthMm: overrides.overallLengthMm ?? 75,
    helixAngleDeg: overrides.helixAngleDeg ?? 35,
    coolantHole: overrides.coolantHole ?? null,
    ballRadiusMm: overrides.ballRadiusMm ?? null,
    taperAngleDeg: overrides.taperAngleDeg ?? null,
    pointAngleDeg: overrides.pointAngleDeg ?? null,
    threadPitchMm: overrides.threadPitchMm ?? null,
    description: overrides.description ?? null,
    featureText: overrides.featureText ?? null,
    materialTags: overrides.materialTags ?? ["M"],
    score: overrides.score ?? 91,
    scoreBreakdown: overrides.scoreBreakdown ?? null,
    matchStatus: overrides.matchStatus ?? "exact",
    stockStatus: overrides.stockStatus ?? "instock",
    totalStock: overrides.totalStock ?? 100,
    inventorySnapshotDate: overrides.inventorySnapshotDate ?? null,
    inventoryLocations: overrides.inventoryLocations ?? [],
    hasEvidence: overrides.hasEvidence ?? false,
    bestCondition: overrides.bestCondition ?? null,
  }
}

function makeSessionState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "turn-truth",
    candidateCount: 2,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "resolved_approximate",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
    } as ExplorationSessionState["resolvedInput"],
    turnCount: 3,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "recommendation",
    ...overrides,
  }
}

describe("turn truth intent routing", () => {
  it('"소재를 추천해달라는 거예요" -> recommendation intent', () => {
    const truth = buildTurnTruth({
      userMessage: "소재를 추천해달라는 거예요",
      sessionState: makeSessionState(),
    })

    expect(truth.intent).toBe("recommendation")
  })

  it('"내 지금 당장 50개 주문해야하는데요" -> inventory constraint with stock threshold', () => {
    const truth = buildTurnTruth({
      userMessage: "내 지금 당장 50개 주문해야하는데요",
      sessionState: makeSessionState(),
    })

    expect(truth.intent).toBe("inventory_constraint")
    expect(truth.inventoryConstraint).toEqual({
      minimumStock: 50,
      requiresInStock: true,
    })

    const merged = mergeInventoryTruthFilters([], truth, 7)
    expect(merged).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "stockStatus", rawValue: "instock" }),
      expect.objectContaining({ field: "totalStock", op: "gte", rawValue: 50 }),
    ]))
  })

  it('"응 재고 확인하고 filter 넣어줘" keeps inventory constraint intent', () => {
    const truth = buildTurnTruth({
      userMessage: "응 재고 확인하고 filter 넣어줘",
      sessionState: makeSessionState(),
    })

    expect(truth.intent).toBe("inventory_constraint")
    expect(truth.inventoryConstraint?.minimumStock ?? null).toBeNull()
    expect(truth.inventoryConstraint?.requiresInStock).toBe(true)
  })

  it('"여기 절삭 조건 있는 것들만 제품 카드 보여줄수 있어?" -> displayed candidate filtering', () => {
    const candidates = [
      makeCandidate({
        productCode: "COND-1",
        displayCode: "COND-1",
        hasEvidence: true,
        bestCondition: {
          Vc: "120",
          n: null,
          fz: null,
          vf: null,
          ap: null,
          ae: null,
        },
      }),
      makeCandidate({
        productCode: "PLAIN-1",
        displayCode: "PLAIN-1",
        hasEvidence: false,
        bestCondition: null,
      }),
    ]
    const truth = buildTurnTruth({
      userMessage: "여기 절삭 조건 있는 것들만 제품 카드 보여줄수 있어?",
      sessionState: makeSessionState({
        displayedCandidates: candidates,
        fullDisplayedCandidates: candidates,
      }),
      candidateSnapshot: candidates,
    })

    expect(truth.intent).toBe("displayed_candidate_filtering")
    expect(truth.displayedCandidateFilter?.kind).toBe("has_cutting_conditions")
    expect(filterDisplayedCandidatesByTruth(candidates, truth)?.map(candidate => candidate.displayCode)).toEqual(["COND-1"])
  })

  it("uses English labels for displayed candidate filters when locale is en", () => {
    const candidates = [
      makeCandidate({
        productCode: "COND-1",
        displayCode: "COND-1",
        hasEvidence: true,
      }),
      makeCandidate({
        productCode: "PLAIN-1",
        displayCode: "PLAIN-1",
        hasEvidence: false,
      }),
    ]
    const truth = buildTurnTruth({
      userMessage: "show only these candidates with cutting conditions",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "en",
        },
        displayedCandidates: candidates,
        fullDisplayedCandidates: candidates,
      }),
      candidateSnapshot: candidates,
    })

    expect(truth.intent).toBe("displayed_candidate_filtering")
    expect(truth.displayedCandidateFilter?.kind).toBe("has_cutting_conditions")
    expect(truth.displayedCandidateFilter?.label).toBe("showing candidates with cutting conditions only")
  })

  it("uses English displayed scope detection", () => {
    const candidates = [
      makeCandidate({
        productCode: "STOCK-1",
        displayCode: "STOCK-1",
        totalStock: 3,
        stockStatus: "instock",
      }),
      makeCandidate({
        productCode: "NO-STOCK-1",
        displayCode: "NO-STOCK-1",
        totalStock: 0,
        stockStatus: "outofstock",
      }),
    ]
    const truth = buildTurnTruth({
      userMessage: "show only these candidates with stock",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "en",
        },
        displayedCandidates: candidates,
        fullDisplayedCandidates: candidates,
      }),
    })

    expect(truth.intent).toBe("displayed_candidate_filtering")
    expect(truth.displayedCandidateFilter?.kind).toBe("instock_only")
  })
})

describe("turn truth validation", () => {
  it("blocks stale reasoning summaries that say filters are none", () => {
    const truth = buildTurnTruth({
      userMessage: "재고 있는 것만 보여줘",
      sessionState: makeSessionState({
        appliedFilters: [
          { field: "workPieceName", op: "includes", value: "Hardened Steels", rawValue: "Hardened Steels", appliedAt: 2 },
        ],
      }),
    })

    expect(() => assertFreshReasoningSummary("Currently Applied Filters: none", truth)).toThrow(/filters are none/i)
  })

  it("blocks answer/card/evidence inconsistency when answer denies cutting conditions", () => {
    const truth = buildTurnTruth({
      userMessage: "여기 절삭 조건 있는 것들만 보여줘",
      sessionState: makeSessionState({
        displayedCandidates: [
          makeCandidate({
            productCode: "COND-1",
            displayCode: "COND-1",
            hasEvidence: true,
            bestCondition: {
              Vc: "120",
              n: null,
              fz: null,
              vf: null,
              ap: null,
              ae: null,
            },
          }),
        ],
      }),
    })

    expect(() => assertAnswerCardEvidenceConsistency({
      text: "절삭 조건은 없습니다.",
      truth,
    })).toThrow(/cutting conditions/i)
  })

  it("blocks answer/card/evidence inconsistency when answer denies inventory", () => {
    const truth = buildTurnTruth({
      userMessage: "재고 있는 후보만 남겨줘",
      sessionState: makeSessionState({
        displayedCandidates: [
          makeCandidate({
            productCode: "STOCK-1",
            displayCode: "STOCK-1",
            totalStock: 5,
            stockStatus: "instock",
          }),
          makeCandidate({
            productCode: "NO-STOCK-2",
            displayCode: "NO-STOCK-2",
            totalStock: 0,
            stockStatus: "outofstock",
          }),
        ],
      }),
    })

    expect(() => assertAnswerCardEvidenceConsistency({
      text: "재고가 없습니다.",
      truth,
    })).toThrow(/in-stock candidates/i)
  })

  it("infers locale from resolvedInput", () => {
    const truth = buildTurnTruth({
      userMessage: "anything",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "en",
        },
      }),
    })

    expect(truth.locale).toBe("en")
  })

  it("uses locale-aware thinking summary when locale is en", () => {
    const truth = buildTurnTruth({
      userMessage: "anything",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "en",
        },
      }),
    })

    const summary = buildTurnTruthThinkingSummary(truth)
    expect(summary).toContain("filters=none")
    expect(summary).not.toContain("filters=없음")
  })

  it("builds English fallback text for inventory contradiction", () => {
    const truth = buildTurnTruth({
      userMessage: "재고 확인해줘",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "en",
        },
        displayedCandidates: [
          makeCandidate({
            productCode: "STOCK-1",
            displayCode: "STOCK-1",
            totalStock: 3,
            stockStatus: "instock",
          }),
          makeCandidate({
            productCode: "NO-STOCK-1",
            displayCode: "NO-STOCK-1",
            totalStock: 0,
            stockStatus: "outofstock",
          }),
        ],
      }),
      candidateSnapshot: [
        makeCandidate({
          productCode: "STOCK-1",
          displayCode: "STOCK-1",
          totalStock: 3,
          stockStatus: "instock",
        }),
        makeCandidate({
          productCode: "NO-STOCK-1",
          displayCode: "NO-STOCK-1",
          totalStock: 0,
          stockStatus: "outofstock",
        }),
      ],
    })

    const fixed = buildTruthConsistentAnswerFallback(truth, "재고가 없다.")
    expect(fixed).toContain("Among the 2 displayed candidates,")
    expect(fixed).toContain("are available in stock.")
  })

  it("infers English locale from English-only user message when session locale is ko", () => {
    const truth = buildTurnTruth({
      userMessage: "show these candidates with stock",
      sessionState: makeSessionState({
        resolvedInput: {
          manufacturerScope: "yg1-only",
          locale: "ko",
        },
        displayedCandidates: [
          makeCandidate({
            productCode: "EN-001",
            displayCode: "EN-001",
            totalStock: 4,
            stockStatus: "instock",
          }),
          makeCandidate({
            productCode: "EN-002",
            displayCode: "EN-002",
            totalStock: 0,
            stockStatus: "outofstock",
          }),
        ],
      }),
      candidateSnapshot: [
        makeCandidate({
          productCode: "EN-001",
          displayCode: "EN-001",
          totalStock: 4,
          stockStatus: "instock",
        }),
        makeCandidate({
          productCode: "EN-002",
          displayCode: "EN-002",
          totalStock: 0,
          stockStatus: "outofstock",
        }),
      ],
    })

    expect(truth.locale).toBe("en")
    expect(truth.intent).toBe("displayed_candidate_filtering")
    expect(truth.displayedCandidateFilter?.kind).toBe("instock_only")
    expect(truth.inventoryConstraint).toBeNull()
  })
})
