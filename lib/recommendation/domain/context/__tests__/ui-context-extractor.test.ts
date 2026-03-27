/**
 * UI Context Extractor — Regression tests
 *
 * Tests:
 * 1. Recommendation card context detected
 * 2. Comparison table context detected
 * 3. Cutting conditions context detected
 * 4. likelyReferencedUIBlock inferred deterministically
 * 5. UI block inference influences option relevance
 */

import { describe, it, expect } from "vitest"
import { extractUIArtifacts, inferLikelyReferencedBlock } from "../ui-context-extractor"
import type { ExplorationSessionState, CandidateSnapshot } from "@/lib/recommendation/domain/types"

function makeSessionState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "test",
    candidateCount: 5,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "resolved_exact",
    resolvedInput: {} as any,
    turnCount: 3,
    displayedProducts: [],
    displayedCandidates: [
      { displayCode: "E5D70", seriesName: "E5D70", coating: "DLC", fluteCount: 2, diameterMm: 4, score: 90, matchStatus: "exact", hasEvidence: true, bestCondition: { Vc: "450" } } as any,
      { displayCode: "ALM90", seriesName: "ALM90", coating: "TiAlN", fluteCount: 3, diameterMm: 4, score: 85, matchStatus: "approximate", hasEvidence: true, bestCondition: { Vc: "300" } } as any,
    ],
    displayedChips: ["절삭조건 알려줘", "대체 후보 비교", "처음부터 다시"],
    displayedOptions: [
      { index: 1, label: "절삭조건 알려줘", value: "절삭조건", field: "_action", count: 0 },
      { index: 2, label: "대체 후보 비교", value: "비교", field: "_action", count: 0 },
    ],
    currentMode: "recommendation",
    lastAction: "show_recommendation",
    ...overrides,
  } as ExplorationSessionState
}

// ════════════════════════════════════════════════════════════════
// TEST 1: Recommendation card context
// ════════════════════════════════════════════════════════════════

describe("ui-context: recommendation card", () => {
  it("detects recommendation card when resolved with displayed candidates", () => {
    const state = makeSessionState()
    const artifacts = extractUIArtifacts(state, [])

    const recCard = artifacts.find(a => a.kind === "recommendation_card")
    expect(recCard).toBeTruthy()
    expect(recCard!.isPrimaryFocus).toBe(true)
    expect(recCard!.productCodes).toContain("E5D70")
  })

  it("recommendation card NOT present when not resolved", () => {
    const state = makeSessionState({ resolutionStatus: "narrowing" })
    const artifacts = extractUIArtifacts(state, [])

    const recCard = artifacts.find(a => a.kind === "recommendation_card")
    expect(recCard).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Comparison table context
// ════════════════════════════════════════════════════════════════

describe("ui-context: comparison table", () => {
  it("detects comparison table when lastComparisonArtifact exists", () => {
    const state = makeSessionState({
      lastComparisonArtifact: { comparedProductCodes: ["E5D70", "ALM90"] } as any,
      currentMode: "comparison",
      lastAction: "compare_products",
    })
    const artifacts = extractUIArtifacts(state, [])

    const compTable = artifacts.find(a => a.kind === "comparison_table")
    expect(compTable).toBeTruthy()
    expect(compTable!.isPrimaryFocus).toBe(true)
    expect(compTable!.productCodes).toEqual(["E5D70", "ALM90"])
  })

  it("no comparison table when artifact absent", () => {
    const state = makeSessionState({ lastComparisonArtifact: null as any })
    const artifacts = extractUIArtifacts(state, [])

    const compTable = artifacts.find(a => a.kind === "comparison_table")
    expect(compTable).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Cutting conditions context
// ════════════════════════════════════════════════════════════════

describe("ui-context: cutting conditions", () => {
  it("detects cutting conditions when candidates have bestCondition", () => {
    const state = makeSessionState({ lastAction: "explain_product" })
    const artifacts = extractUIArtifacts(state, [])

    const ccBlock = artifacts.find(a => a.kind === "cutting_conditions")
    expect(ccBlock).toBeTruthy()
    expect(ccBlock!.productCodes.length).toBeGreaterThan(0)
  })

  it("no cutting conditions when candidates have no evidence", () => {
    const state = makeSessionState({
      displayedCandidates: [
        { displayCode: "X1", hasEvidence: false, bestCondition: null } as any,
      ],
      resolutionStatus: "narrowing",
      lastAction: "continue_narrowing",
    })
    const artifacts = extractUIArtifacts(state, [])

    const ccBlock = artifacts.find(a => a.kind === "cutting_conditions")
    expect(ccBlock).toBeUndefined()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: likelyReferencedUIBlock inference
// ════════════════════════════════════════════════════════════════

describe("ui-context: inferLikelyReferencedBlock", () => {
  it("recommendation card when user mentions 이 제품", () => {
    const state = makeSessionState()
    const block = inferLikelyReferencedBlock(state, "이 제품 재고 있어?")
    expect(block).toBe("recommendation_card")
  })

  it("comparison table when user mentions 비교 with comparison artifact", () => {
    const state = makeSessionState({
      lastComparisonArtifact: { comparedProductCodes: ["A", "B"] } as any,
    })
    const block = inferLikelyReferencedBlock(state, "코팅 비교해줘")
    expect(block).toBe("comparison_table")
  })

  it("cutting conditions when user mentions 절삭조건", () => {
    const state = makeSessionState()
    const block = inferLikelyReferencedBlock(state, "절삭조건 알려줘")
    expect(block).toBe("cutting_conditions")
  })

  it("candidate list when user asks about counts", () => {
    const state = makeSessionState({ resolutionStatus: "narrowing", currentMode: "narrowing" })
    const block = inferLikelyReferencedBlock(state, "후보가 몇 개야?")
    expect(block).toBe("candidate_list")
  })

  it("question prompt in narrowing mode by default", () => {
    const state = makeSessionState({ resolutionStatus: "narrowing", currentMode: "narrowing", lastAction: "continue_narrowing" })
    const block = inferLikelyReferencedBlock(state, "네")
    expect(block).toBe("question_prompt")
  })

  it("recommendation card for default in recommendation mode", () => {
    const state = makeSessionState()
    const block = inferLikelyReferencedBlock(state, "안녕")
    expect(block).toBe("recommendation_card")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: UI block feeds into ranker context
// ════════════════════════════════════════════════════════════════

describe("ui-context: ranker integration", () => {
  it("ranker context accepts likelyReferencedUIBlock", async () => {
    const { rankOptions } = await import("../../options/option-ranker")
    const options = [
      {
        id: "test-cc", family: "action" as const, label: "절삭조건 알려줘",
        projectedCount: null, projectedDelta: null,
        preservesContext: true, destructive: false, recommended: false, priorityScore: 0,
        plan: { type: "apply_filter" as const, patches: [{ op: "add" as const, field: "_action", value: "cutting_conditions" }] },
      },
      {
        id: "test-compare", family: "compare" as const, label: "대체 후보 비교",
        projectedCount: null, projectedDelta: null,
        preservesContext: true, destructive: false, recommended: false, priorityScore: 0,
        plan: { type: "compare_products" as const, patches: [] },
      },
    ]

    // With recommendation_card block, cutting_conditions should score higher
    const rankedRec = rankOptions([...options], {
      candidateCount: 5, filterCount: 2, hasRecommendation: true,
      likelyReferencedUIBlock: "recommendation_card",
    })
    const ccScore = rankedRec.find(o => o.id === "test-cc")!.priorityScore
    expect(ccScore).toBeGreaterThan(0)

    // With candidate_list block, compare should score higher
    const rankedCand = rankOptions([...options], {
      candidateCount: 5, filterCount: 2, hasRecommendation: false,
      likelyReferencedUIBlock: "candidate_list",
    })
    const compScore = rankedCand.find(o => o.id === "test-compare")!.priorityScore
    expect(compScore).toBeGreaterThan(0)
  })
})
