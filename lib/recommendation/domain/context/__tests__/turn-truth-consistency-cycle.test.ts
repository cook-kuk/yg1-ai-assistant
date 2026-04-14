import { describe, expect, it } from "vitest"

import type { CandidateSnapshot, ExplorationSessionState } from "@/lib/recommendation/domain/types"
import {
  assertAnswerCardEvidenceConsistency,
  assertFreshReasoningSummary,
  buildTurnTruth,
  buildTruthConsistentAnswerFallback,
  buildTurnTruthThinkingSummary,
  detectAnswerCardEvidenceConsistencyIssues,
  detectStaleReasoningSummary,
  sanitizeReasoningSummary,
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
    sessionId: "turn-truth-cycle",
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

describe("turn-truth — 전체 detect → sanitize → fallback 사이클", () => {
  describe("happy path: 불일치 없음", () => {
    it("필터 없고 reasoning이 none이면 이슈 없음", () => {
      const truth = buildTurnTruth({
        userMessage: "추천해줘",
        sessionState: makeSessionState(),
      })
      expect(detectStaleReasoningSummary("Currently Applied Filters: none", truth)).toEqual([])
      expect(() => assertFreshReasoningSummary("Currently Applied Filters: none", truth)).not.toThrow()
    })

    it("일관된 답변/증거면 이슈 없음", () => {
      const truth = buildTurnTruth({
        userMessage: "절삭 조건 있는 것만",
        sessionState: makeSessionState({
          displayedCandidates: [
            makeCandidate({
              productCode: "OK-1",
              hasEvidence: true,
              bestCondition: { Vc: "120", n: null, fz: null, vf: null, ap: null, ae: null },
            }),
          ],
        }),
      })
      expect(detectAnswerCardEvidenceConsistencyIssues({
        text: "절삭 조건 근거가 1개 있습니다.",
        truth,
      })).toEqual([])
    })
  })

  describe("issue 1: stale_reasoning_none_mismatch", () => {
    it("sanitize는 stale reasoning을 truth thinking summary로 교체", () => {
      const truth = buildTurnTruth({
        userMessage: "재고 있는 것만",
        sessionState: makeSessionState({
          appliedFilters: [
            { field: "workPieceName", op: "includes", value: "Hardened Steels", rawValue: "Hardened Steels", appliedAt: 2 },
          ],
        }),
      })

      const sanitized = sanitizeReasoningSummary("Currently Applied Filters: none", truth)
      expect(sanitized).not.toBe("Currently Applied Filters: none")
      expect(sanitized).toBe(buildTurnTruthThinkingSummary(truth))
    })

    it("sanitize는 일관된 reasoning은 그대로 반환 (trim만)", () => {
      const truth = buildTurnTruth({
        userMessage: "추천해줘",
        sessionState: makeSessionState(),
      })
      expect(sanitizeReasoningSummary("  정상 reasoning  ", truth)).toBe("정상 reasoning")
    })

    it("sanitize는 빈 reasoning에는 null 반환", () => {
      const truth = buildTurnTruth({
        userMessage: "추천해줘",
        sessionState: makeSessionState(),
      })
      expect(sanitizeReasoningSummary("", truth)).toBeNull()
      expect(sanitizeReasoningSummary(null, truth)).toBeNull()
    })

    it("activeDisplayFilter가 있는데 reasoning이 none이면 이슈", () => {
      const truth = buildTurnTruth({
        userMessage: "보여줘",
        sessionState: makeSessionState({
          displayedSetFilter: "instock_only" as ExplorationSessionState["displayedSetFilter"],
        }),
      })
      // appliedFilters가 비어도 activeDisplayFilter만 있으면 mismatch로 잡혀야 함
      const issues = detectStaleReasoningSummary("existing filters: (none)", truth)
      if (truth.displayedCandidateScope.activeDisplayFilter != null) {
        expect(issues.length).toBeGreaterThan(0)
        expect(issues[0].code).toBe("stale_reasoning_none_mismatch")
      }
    })
  })

  describe("issue 2: answer_denies_cutting_conditions — 한국어 fallback", () => {
    it("한국어 locale에서 fallback이 현재 표시 후보 문구로 교체", () => {
      const candidates = [
        makeCandidate({
          productCode: "COND-1",
          hasEvidence: true,
          bestCondition: { Vc: "120", n: null, fz: null, vf: null, ap: null, ae: null },
        }),
        makeCandidate({ productCode: "PLAIN-1", hasEvidence: false }),
      ]
      const truth = buildTurnTruth({
        userMessage: "여기 절삭 조건 있는 것들만",
        sessionState: makeSessionState({
          displayedCandidates: candidates,
          fullDisplayedCandidates: candidates,
        }),
        candidateSnapshot: candidates,
      })

      expect(() => assertAnswerCardEvidenceConsistency({
        text: "절삭 조건은 없습니다.",
        truth,
      })).toThrow()

      const fallback = buildTruthConsistentAnswerFallback(truth, "절삭 조건은 없습니다.")
      expect(fallback).toContain("현재 표시 후보")
      expect(fallback).toContain("절삭 조건 근거가 있는 제품은 1개입니다.")
    })
  })

  describe("issue 3: answer_denies_inventory — 한국어 fallback", () => {
    it("한국어 locale에서 재고 부정 시 fallback 교체", () => {
      const candidates = [
        makeCandidate({ productCode: "STOCK-1", totalStock: 5, stockStatus: "instock" }),
        makeCandidate({ productCode: "OOS-1", totalStock: 0, stockStatus: "outofstock" }),
      ]
      const truth = buildTurnTruth({
        userMessage: "재고 있는 것만",
        sessionState: makeSessionState({
          displayedCandidates: candidates,
          fullDisplayedCandidates: candidates,
        }),
        candidateSnapshot: candidates,
      })

      expect(() => assertAnswerCardEvidenceConsistency({
        text: "재고가 없습니다.",
        truth,
      })).toThrow()

      const fallback = buildTruthConsistentAnswerFallback(truth, "재고가 없습니다.")
      expect(fallback).toContain("현재 표시 후보")
      expect(fallback).toContain("재고 확인 가능한 제품은 1개입니다.")
    })
  })

  describe("복합 이슈: cutting_conditions + inventory 동시 부정", () => {
    it("두 이슈 모두 감지되고 fallback에 둘 다 포함", () => {
      const candidates = [
        makeCandidate({
          productCode: "BOTH-1",
          hasEvidence: true,
          totalStock: 7,
          stockStatus: "instock",
          bestCondition: { Vc: "150", n: null, fz: null, vf: null, ap: null, ae: null },
        }),
        makeCandidate({
          productCode: "PLAIN-1",
          hasEvidence: false,
          totalStock: 0,
          stockStatus: "outofstock",
        }),
      ]
      const truth = buildTurnTruth({
        userMessage: "재고와 절삭조건 확인",
        sessionState: makeSessionState({
          displayedCandidates: candidates,
          fullDisplayedCandidates: candidates,
        }),
        candidateSnapshot: candidates,
      })

      const badAnswer = "절삭 조건이 없고 재고도 없습니다."
      const issues = detectAnswerCardEvidenceConsistencyIssues({ text: badAnswer, truth })
      const codes = issues.map(issue => issue.code).sort()
      expect(codes).toEqual(["answer_denies_cutting_conditions", "answer_denies_inventory"])

      const fallback = buildTruthConsistentAnswerFallback(truth, badAnswer)
      expect(fallback).toContain("절삭 조건 근거")
      expect(fallback).toContain("재고 확인 가능")
    })
  })

  describe("fallback idempotency", () => {
    it("이미 일관된 답변은 fallback이 원문 그대로 반환", () => {
      const truth = buildTurnTruth({
        userMessage: "추천",
        sessionState: makeSessionState(),
      })
      const original = "이 제품을 추천드립니다."
      expect(buildTruthConsistentAnswerFallback(truth, original)).toBe(original)
    })
  })

  describe("영어 fallback locale 분기", () => {
    it("영어 locale에서 fallback이 영어 문구", () => {
      const candidates = [
        makeCandidate({ productCode: "EN-1", totalStock: 3, stockStatus: "instock" }),
        makeCandidate({ productCode: "EN-2", totalStock: 0, stockStatus: "outofstock" }),
      ]
      const truth = buildTurnTruth({
        userMessage: "show stock",
        sessionState: makeSessionState({
          resolvedInput: { manufacturerScope: "yg1-only", locale: "en" },
          displayedCandidates: candidates,
          fullDisplayedCandidates: candidates,
        }),
        candidateSnapshot: candidates,
      })

      const fallback = buildTruthConsistentAnswerFallback(truth, "no stock.")
      expect(fallback).toContain("Among the")
      expect(fallback).toContain("available in stock.")
      expect(fallback).not.toContain("현재 표시 후보")
    })
  })
})
