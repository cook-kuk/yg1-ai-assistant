/**
 * Golden Scenario Tests — Multi-turn regression protection
 *
 * Captures real failure-prone interaction patterns using deterministic
 * module composition (no LLM, no DB). Each scenario simulates a multi-turn
 * flow through the actual option/context/memory pipeline.
 *
 * Scenarios:
 * 1. Coating question → confusion → explanation → 상관없음
 * 2. Subtype count clarification → mention not committed as filter
 * 3. Recommendation card visible → 절삭조건 follow-up
 * 4. Comparison table visible → 다른 조건으로
 * 5. Answer suggests action → matching displayedOption exists
 * 6. Quoted assistant text does not create fake chips
 * 7. Revise/undo chips when user wants to change prior input
 */

import { describe, it, expect } from "vitest"
import { detectUserState } from "../domain/context/user-understanding-detector"
import { extractUIArtifacts, inferLikelyReferencedBlock } from "../domain/context/ui-context-extractor"
import { buildRecentInteractionFrame } from "../domain/context/recent-interaction-frame"
import { validateOptionFirstPipeline } from "../domain/options/option-validator"
import { buildQuestionFieldOptions, buildQuestionAssistOptions, buildDisplayedOptions } from "../../recommendation/infrastructure/engines/serve-engine-option-first"
import { rankOptions } from "../domain/options/option-ranker"
import type { ExplorationSessionState, DisplayedOption } from "@/lib/recommendation/domain/types"

// ── Helpers ──────────────────────────────────────────────────

function makeNarrowingState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "golden-test",
    candidateCount: 448,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: { material: "Aluminum", diameterMm: 4 } as any,
    turnCount: 2,
    displayedProducts: [],
    displayedCandidates: [
      { displayCode: "E5D70", seriesName: "E5D70", coating: "DLC", fluteCount: 2, diameterMm: 4, score: 90, matchStatus: "exact", hasEvidence: true, bestCondition: { Vc: "450" }, toolMaterial: "Carbide", stockStatus: "instock" } as any,
      { displayCode: "ALM90", seriesName: "ALM90", coating: "TiAlN", fluteCount: 3, diameterMm: 4, score: 85, matchStatus: "approximate", hasEvidence: true, bestCondition: { Vc: "300" }, toolMaterial: "Carbide", stockStatus: "limited" } as any,
    ],
    displayedChips: ["DLC (5개)", "TiAlN (3개)", "상관없음"],
    displayedOptions: [
      { index: 1, label: "DLC (5개)", value: "DLC", field: "coating", count: 5 },
      { index: 2, label: "TiAlN (3개)", value: "TiAlN", field: "coating", count: 3 },
    ],
    currentMode: "narrowing",
    lastAction: "continue_narrowing",
    lastAskedField: "coating",
    ...overrides,
  } as ExplorationSessionState
}

function makeRecommendedState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return makeNarrowingState({
    resolutionStatus: "resolved_exact",
    currentMode: "recommendation",
    lastAction: "show_recommendation",
    lastAskedField: undefined,
    displayedChips: ["대체 후보 비교", "절삭조건 알려줘", "처음부터 다시"],
    displayedOptions: [
      { index: 1, label: "대체 후보 비교", value: "비교", field: "_action", count: 0 },
      { index: 2, label: "절삭조건 알려줘", value: "절삭조건", field: "_action", count: 0 },
    ],
    ...overrides,
  })
}

function makeMockCandidates() {
  return [
    { product: { fluteCount: 2, coating: "DLC", seriesName: "E5D70", toolSubtype: "Square", toolMaterial: "Carbide", diameterMm: 4 } },
    { product: { fluteCount: 3, coating: "TiAlN", seriesName: "ALM90", toolSubtype: "Square", toolMaterial: "Carbide", diameterMm: 4 } },
    { product: { fluteCount: 2, coating: "AlCrN", seriesName: "E5D70", toolSubtype: "Ball", toolMaterial: "Carbide", diameterMm: 4 } },
  ] as any[]
}

// ════════════════════════════════════════════════════════════════
// SCENARIO 1: coating question → confusion → explanation → 상관없음
// ════════════════════════════════════════════════════════════════

describe("scenario 1: coating question → confusion → skip", () => {
  it("T1: coating question produces field-specific options", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC (5개)", "TiAlN (3개)", "AlCrN (2개)", "상관없음"],
      true
    )
    expect(result.displayedOptions.length).toBeGreaterThan(0)
    expect(result.displayedOptions.every(o => o.field === "coating" || o.field === "_action")).toBe(true)
    expect(result.chips.some(c => c.includes("DLC"))).toBe(true)
  })

  it("T2: confusion about coating stays in question flow", () => {
    const state = makeNarrowingState()
    const userState = detectUserState("DLC가 뭐야?", "coating")

    expect(userState.state).toBe("wants_explanation")
    expect(userState.boundField).toBe("coating")

    // Question assist should produce options tied to coating field
    const assist = buildQuestionAssistOptions({
      prevState: state,
      currentCandidates: makeMockCandidates(),
      confusedAbout: userState.confusedAbout,
      includeHelpers: true,
    })
    expect(assist.chips.length).toBeGreaterThan(0)
    // Field options should include coating values
    const coatingOpts = assist.options.filter(o => o.field === "coating")
    expect(coatingOpts.length).toBeGreaterThan(0)
  })

  it("T3: 상관없음 after explanation → skip coating", () => {
    const userState = detectUserState("상관없음", "coating")
    expect(userState.state).toBe("wants_skip")
    expect(userState.boundField).toBe("coating")
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 2: subtype count clarification → mention not committed
// ════════════════════════════════════════════════════════════════

describe("scenario 2: mention vs commitment", () => {
  it("asking about Ball/Taper counts does not produce a filter action", () => {
    // "Ball은 몇개야?" should be detected as clarification, not selection
    const userState = detectUserState("Ball은 몇개야?", "toolSubtype")

    // Should NOT be "clear" (which would lead to filter) — should be explanation
    expect(["wants_explanation", "confused", "uncertain"]).toContain(userState.state)
    expect(userState.boundField).toBe("toolSubtype")
  })

  it("interaction frame identifies count query as detail_request", () => {
    const state = makeNarrowingState({ lastAskedField: "toolSubtype" })
    const frame = buildRecentInteractionFrame(
      "공구 형상을 선택해주세요. Square (100개), Ball (50개), Radius (30개)",
      "Ball, Taper는 몇개야?",
      state
    )

    // Should NOT be "direct_answer"
    expect(frame.relation).not.toBe("direct_answer")
    // Should preserve context
    expect(frame.preserveContext).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 3: recommendation card visible → 절삭조건 follow-up
// ════════════════════════════════════════════════════════════════

describe("scenario 3: post-recommendation cutting conditions", () => {
  it("recommendation card is detected as primary UI artifact", () => {
    const state = makeRecommendedState()
    const artifacts = extractUIArtifacts(state, [])

    const recCard = artifacts.find(a => a.kind === "recommendation_card")
    expect(recCard).toBeTruthy()
    expect(recCard!.isPrimaryFocus).toBe(true)
    expect(recCard!.productCodes.length).toBeGreaterThan(0)
  })

  it("절삭조건 알려줘 references cutting_conditions block", () => {
    const state = makeRecommendedState()
    const block = inferLikelyReferencedBlock(state, "절삭조건 알려줘")
    expect(block).toBe("cutting_conditions")
  })

  it("ranker boosts cutting condition options when recommendation card is visible", () => {
    const options = [
      {
        id: "cc", family: "action" as const, label: "절삭조건 알려줘",
        projectedCount: null, projectedDelta: null,
        preservesContext: true, destructive: false, recommended: false, priorityScore: 0,
        plan: { type: "apply_filter" as const, patches: [{ op: "add" as const, field: "_action", value: "cutting_conditions" }] },
      },
      {
        id: "reset", family: "reset" as const, label: "처음부터 다시",
        projectedCount: null, projectedDelta: null,
        preservesContext: false, destructive: true, recommended: false, priorityScore: 0,
        plan: { type: "reset_session" as const, patches: [] },
      },
    ]

    const ranked = rankOptions([...options], {
      candidateCount: 5,
      filterCount: 2,
      hasRecommendation: true,
      likelyReferencedUIBlock: "recommendation_card",
    })

    const ccScore = ranked.find(o => o.id === "cc")!.priorityScore
    const resetScore = ranked.find(o => o.id === "reset")!.priorityScore
    expect(ccScore).toBeGreaterThan(resetScore)
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 4: comparison table visible → 다른 조건으로
// ════════════════════════════════════════════════════════════════

describe("scenario 4: comparison context → revision", () => {
  it("comparison artifact inferred when lastComparisonArtifact exists", () => {
    const state = makeRecommendedState({
      lastComparisonArtifact: { comparedProductCodes: ["E5D70", "ALM90"] } as any,
      currentMode: "comparison",
      lastAction: "compare_products",
    })

    const block = inferLikelyReferencedBlock(state, "다른 조건으로 비교해줘")
    expect(block).toBe("comparison_table")
  })

  it("ranker boosts revision options when comparison table is visible", () => {
    const options = [
      {
        id: "revise", family: "explore" as const, label: "다른 코팅 옵션",
        field: "coating",
        projectedCount: null, projectedDelta: null,
        preservesContext: true, destructive: false, recommended: false, priorityScore: 0,
        plan: { type: "replace_filter" as const, patches: [{ op: "remove" as const, field: "coating" }] },
      },
      {
        id: "reset", family: "reset" as const, label: "처음부터 다시",
        projectedCount: null, projectedDelta: null,
        preservesContext: false, destructive: true, recommended: false, priorityScore: 0,
        plan: { type: "reset_session" as const, patches: [] },
      },
    ]

    const ranked = rankOptions([...options], {
      candidateCount: 5,
      filterCount: 2,
      hasRecommendation: true,
      likelyReferencedUIBlock: "comparison_table",
    })

    const reviseScore = ranked.find(o => o.id === "revise")!.priorityScore
    const resetScore = ranked.find(o => o.id === "reset")!.priorityScore
    expect(reviseScore).toBeGreaterThan(resetScore)
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 5: answer suggests action → matching displayedOption exists
// ════════════════════════════════════════════════════════════════

describe("scenario 5: answer/option consistency", () => {
  it("answer suggesting existing action → NOT corrected", () => {
    const options: DisplayedOption[] = [
      { index: 1, label: "대체 후보 비교", value: "비교", field: "_action", count: 0 },
      { index: 2, label: "절삭조건 알려줘", value: "절삭조건", field: "_action", count: 0 },
    ]
    const chips = ["대체 후보 비교", "절삭조건 알려줘"]

    const result = validateOptionFirstPipeline(
      "대체 후보를 비교해 보시겠습니까?",
      chips,
      options
    )

    // Should NOT correct — the suggested action exists
    expect(result.correctedAnswer).toBeNull()
  })

  it("answer suggesting unauthorized action → corrected", () => {
    const options: DisplayedOption[] = [
      { index: 1, label: "DLC (5개)", value: "DLC", field: "coating", count: 5 },
    ]
    const chips = ["DLC (5개)"]

    const result = validateOptionFirstPipeline(
      "다시 선택하시려면 클릭해주세요.",
      chips,
      options
    )

    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
    expect(result.correctedAnswer).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 6: quoted assistant text does not create fake chips
// ════════════════════════════════════════════════════════════════

describe("scenario 6: quoted text immunity", () => {
  it("explanation text with no actionable phrases → no divergence", () => {
    const options: DisplayedOption[] = [
      { index: 1, label: "DLC (5개)", value: "DLC", field: "coating", count: 5 },
      { index: 2, label: "TiAlN (3개)", value: "TiAlN", field: "coating", count: 3 },
    ]
    const chips = ["DLC (5개)", "TiAlN (3개)"]

    const result = validateOptionFirstPipeline(
      "DLC 코팅은 Diamond-Like Carbon의 약자로, 높은 경도와 내마모성이 특징입니다. 알루미늄 가공에서 우수한 성능을 보여줍니다. TiAlN은 고온 안정성이 뛰어난 코팅입니다.",
      chips,
      options
    )

    expect(result.isValid).toBe(true)
    expect(result.correctedAnswer).toBeNull()
  })

  it("technical description does not produce orphan chips", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC (5개)", "TiAlN (3개)", "상관없음"],
      false
    )

    // Every chip should map to an option
    for (const chip of result.chips) {
      const hasOption = result.options.some(o => o.label === chip)
      expect(hasOption).toBe(true)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// SCENARIO 7: revision/undo flow
// ════════════════════════════════════════════════════════════════

describe("scenario 7: revision and undo", () => {
  it("user wants_revision is detected from revision phrases", () => {
    const phrases = ["바꿔줘", "이전으로 돌아가줘", "변경하고 싶어", "취소해줘"]

    for (const phrase of phrases) {
      const result = detectUserState(phrase, "coating")
      expect(result.state).toBe("wants_revision")
      expect(result.boundField).toBe("coating")
    }
  })

  it("interaction frame detects revise relation", () => {
    const state = makeNarrowingState()
    const frame = buildRecentInteractionFrame(
      "코팅을 선택해주세요.",
      "아까 선택한 거 바꾸고 싶어",
      state
    )

    expect(frame.relation).toBe("revise")
  })

  it("undo option appears in question field options when hasHistory", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC (5개)", "TiAlN (3개)", "상관없음"],
      true // hasHistory
    )

    const undoOption = result.options.find(o => o.value === "undo")
    expect(undoOption).toBeTruthy()
    expect(undoOption!.label).toBe("⟵ 이전 단계")
  })

  it("no undo option when no history", () => {
    const result = buildQuestionFieldOptions(
      "coating",
      ["DLC (5개)", "TiAlN (3개)", "상관없음"],
      false // no history
    )

    const undoOption = result.options.find(o => o.value === "undo")
    expect(undoOption).toBeUndefined()
  })
})
