import { beforeEach, describe, expect, it } from "vitest"

import type { CandidateSnapshot } from "@/lib/recommendation/domain/types"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

import { generateSmartOptionCandidates } from "../index"
import { selectChipsWithLLM } from "../llm-chip-selector"
import { buildPostRecommendationPlannerContext } from "../option-bridge"
import { planOptions, resetOptionCounter } from "../option-planner"
import type { SmartOption } from "../types"

const unavailableProvider: LLMProvider = {
  available: () => false,
  complete: async () => "",
  completeWithTools: async () => ({ text: null, toolUse: null }),
}

describe("llm chip selector", () => {
  beforeEach(() => resetOptionCounter())

  it("does not keep chips that repeat an already-applied value", async () => {
    const result = await selectChipsWithLLM([
      makeOption({
        label: "Square 보기",
        field: "toolSubtype",
        value: "Square",
        priorityScore: 120,
      }),
      makeOption({
        label: "Ball 보기",
        field: "toolSubtype",
        value: "Ball",
        priorityScore: 90,
      }),
    ], {
      userMessage: "다음 추천 보여줘",
      assistantText: "",
      mode: "recommendation",
      pendingField: null,
      candidateCount: 12,
      appliedFilters: [{ field: "toolSubtype", value: "Square" }],
      resolutionStatus: "resolved_exact",
      displayedProducts: ["EM1"],
      userState: null,
      confusedAbout: null,
      intentShift: null,
      referencedField: null,
      referencedUIBlock: "recommendation_card",
      frameRelation: null,
      answeredFields: [],
      conversationDepth: 4,
      suggestedNextAction: null,
      hasConflict: false,
      recentTurns: [],
    }, unavailableProvider)

    expect(result.chips).not.toContain("Square 보기")
    expect(result.chips).toContain("Ball 보기")
  })

  it("prefers safe narrowing chips over forced specific values on generic requests", async () => {
    const result = await selectChipsWithLLM([
      makeOption({
        label: "Ball 보기",
        field: "toolSubtype",
        value: "Ball",
        priorityScore: 110,
      }),
      makeOption({
        label: "직경 좁히기",
        priorityScore: 35,
        plan: { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "narrow_diameterMm" }] },
      }),
      makeOption({
        label: "다른 공구 형상 보기",
        field: "toolSubtype",
        priorityScore: 40,
        plan: { type: "replace_filter", patches: [{ op: "remove", field: "toolSubtype" }] },
      }),
    ], {
      userMessage: "뭐가 좋을까?",
      assistantText: "",
      mode: "recommendation",
      pendingField: null,
      candidateCount: 20,
      appliedFilters: [],
      resolutionStatus: "resolved_exact",
      displayedProducts: ["EM1"],
      userState: null,
      confusedAbout: null,
      intentShift: null,
      referencedField: null,
      referencedUIBlock: "recommendation_card",
      frameRelation: null,
      answeredFields: [],
      conversationDepth: 3,
      suggestedNextAction: null,
      hasConflict: false,
      recentTurns: [],
    }, unavailableProvider)

    expect(["직경 좁히기", "다른 공구 형상 보기"]).toContain(result.chips[0])
    expect(result.chips.indexOf("Ball 보기")).toBeGreaterThan(result.chips.indexOf("직경 좁히기"))
    expect(result.chips.indexOf("Ball 보기")).toBeGreaterThan(result.chips.indexOf("다른 공구 형상 보기"))
  })

  it("prioritizes repair-oriented chips when there is a correction signal", async () => {
    const result = await selectChipsWithLLM([
      makeOption({
        label: "Ball 보기",
        field: "toolSubtype",
        value: "Ball",
        priorityScore: 120,
      }),
      makeOption({
        label: "다른 공구 형상 보기",
        field: "toolSubtype",
        priorityScore: 55,
        plan: { type: "replace_filter", patches: [{ op: "remove", field: "toolSubtype" }] },
      }),
      makeOption({
        label: "상위 3개 비교",
        priorityScore: 90,
        family: "compare",
      }),
    ], {
      userMessage: "Square 말고 다른 걸로 바꿔",
      assistantText: "",
      mode: "recommendation",
      pendingField: null,
      candidateCount: 14,
      appliedFilters: [{ field: "toolSubtype", value: "Square" }],
      resolutionStatus: "resolved_exact",
      displayedProducts: ["EM1"],
      userState: null,
      confusedAbout: null,
      intentShift: "replace_constraint",
      referencedField: "toolSubtype",
      referencedUIBlock: "recommendation_card",
      frameRelation: "revise",
      answeredFields: [],
      conversationDepth: 5,
      suggestedNextAction: "repair",
      hasConflict: true,
      correctionSignal: true,
      recentTurns: [],
    }, unavailableProvider)

    expect(result.chips[0]).toBe("다른 공구 형상 보기")
  })
})

describe("post-recommendation planner", () => {
  beforeEach(() => resetOptionCounter())

  it("builds subtype alternatives from the candidate buffer and excludes the active subtype", () => {
    const plannerCtx = buildPostRecommendationPlannerContext([
      makeSnapshot({ displayCode: "SQ1", toolSubtype: "Square", fluteCount: 2 }),
      makeSnapshot({ displayCode: "BL1", toolSubtype: "Ball", fluteCount: 2 }),
      makeSnapshot({ displayCode: "RD1", toolSubtype: "Radius", fluteCount: 2 }),
      makeSnapshot({ displayCode: "BL2", toolSubtype: "Ball", fluteCount: 4 }),
    ], [
      { field: "toolSubtype", op: "eq", value: "Square", rawValue: "Square", appliedAt: 0 },
      { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 1 },
    ], {
      toolSubtype: "Square",
      flutePreference: 2,
    } as any)

    const options = planOptions(plannerCtx)
    const subtypeOptions = options.filter(option => option.field === "toolSubtype")

    expect(subtypeOptions.some(option => option.label === "Ball 보기")).toBe(true)
    expect(subtypeOptions.some(option => option.label === "Radius 보기")).toBe(true)
    expect(subtypeOptions.some(option => option.value === "Square")).toBe(false)
    expect(subtypeOptions.every(option => option.plan.type === "replace_filter")).toBe(true)
  })
})

describe("scenario checks", () => {
  beforeEach(() => resetOptionCounter())

  it("2날 유지 + Square 제외 shows alternative subtype chips without repeating the active state", async () => {
    const result = await selectPostResultChips({
      snapshots: [
        makeSnapshot({ displayCode: "SQ1", toolSubtype: "Square", fluteCount: 2, diameterMm: 8 }),
        makeSnapshot({ displayCode: "BL1", toolSubtype: "Ball", fluteCount: 2, diameterMm: 10 }),
        makeSnapshot({ displayCode: "RD1", toolSubtype: "Radius", fluteCount: 2, diameterMm: 12 }),
        makeSnapshot({ displayCode: "BL2", toolSubtype: "Ball", fluteCount: 4, diameterMm: 10 }),
        makeSnapshot({ displayCode: "RD2", toolSubtype: "Radius", fluteCount: 2, diameterMm: 8 }),
      ],
      filters: [
        { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 0 },
        { field: "toolSubtype", op: "neq", value: "Square", rawValue: "Square", appliedAt: 1 },
      ],
      userMessage: "2날은 유지하고 Square 말고",
      intentShift: "replace_constraint",
      referencedField: "toolSubtype",
      frameRelation: "revise",
      hasConflict: true,
      correctionSignal: true,
    })

    expect(result.chips).toContain("Ball 보기")
    expect(result.chips).toContain("Radius 보기")
    expect(result.chips).toContain("2날 유지")
    expect(result.chips).not.toContain("Square 보기")
    expect(result.chips).not.toContain("2날 보기")
    expect(result.chips.some(chip => chip === "직경 좁히기" || chip === "다른 공구 형상 보기")).toBe(true)
  })

  it("Ball 말고 다른 형상 asks for repair and alternative subtypes first", async () => {
    const result = await selectPostResultChips({
      snapshots: [
        makeSnapshot({ displayCode: "BL1", toolSubtype: "Ball", fluteCount: 2 }),
        makeSnapshot({ displayCode: "SQ1", toolSubtype: "Square", fluteCount: 2 }),
        makeSnapshot({ displayCode: "RD1", toolSubtype: "Radius", fluteCount: 4 }),
        makeSnapshot({ displayCode: "SQ2", toolSubtype: "Square", fluteCount: 4 }),
      ],
      filters: [
        { field: "toolSubtype", op: "eq", value: "Ball", rawValue: "Ball", appliedAt: 0 },
      ],
      userMessage: "Ball 말고 다른 형상",
      intentShift: "replace_constraint",
      referencedField: "toolSubtype",
      frameRelation: "revise",
      hasConflict: true,
      correctionSignal: true,
    })

    expect(["다른 공구 형상 보기", "Square 보기", "Radius 보기"]).toContain(result.chips[0])
    expect(result.chips).toContain("Square 보기")
    expect(result.chips).toContain("Radius 보기")
    expect(result.chips).not.toContain("Ball 보기")
  })
})

function makeOption(overrides: Partial<SmartOption> & { label: string }): SmartOption {
  return {
    id: overrides.id ?? overrides.label,
    family: overrides.family ?? "narrowing",
    label: overrides.label,
    subtitle: overrides.subtitle,
    field: overrides.field,
    value: overrides.value,
    reason: overrides.reason ?? overrides.label,
    projectedCount: overrides.projectedCount ?? 6,
    projectedDelta: overrides.projectedDelta ?? -4,
    preservesContext: overrides.preservesContext ?? true,
    destructive: overrides.destructive ?? false,
    recommended: overrides.recommended ?? false,
    priorityScore: overrides.priorityScore ?? 0,
    plan: overrides.plan ?? {
      type: "apply_filter",
      patches: overrides.field && overrides.value != null
        ? [{ op: "add", field: overrides.field, value: overrides.value }]
        : [],
    },
  }
}

function makeSnapshot(overrides: Partial<CandidateSnapshot>): CandidateSnapshot {
  return {
    rank: overrides.rank ?? 1,
    productCode: overrides.productCode ?? overrides.displayCode ?? "P1",
    displayCode: overrides.displayCode ?? "P1",
    displayLabel: overrides.displayLabel ?? overrides.displayCode ?? "P1",
    brand: overrides.brand ?? "YG-1",
    seriesName: overrides.seriesName ?? "SERIES",
    seriesIconUrl: overrides.seriesIconUrl ?? null,
    diameterMm: overrides.diameterMm ?? 10,
    fluteCount: overrides.fluteCount ?? 2,
    coating: overrides.coating ?? "DLC",
    toolSubtype: overrides.toolSubtype ?? "Square",
    toolMaterial: overrides.toolMaterial ?? "Carbide",
    shankDiameterMm: overrides.shankDiameterMm ?? 10,
    shankType: overrides.shankType ?? null,
    lengthOfCutMm: overrides.lengthOfCutMm ?? 20,
    overallLengthMm: overrides.overallLengthMm ?? 75,
    helixAngleDeg: overrides.helixAngleDeg ?? 35,
    coolantHole: overrides.coolantHole ?? false,
    ballRadiusMm: overrides.ballRadiusMm ?? null,
    taperAngleDeg: overrides.taperAngleDeg ?? null,
    pointAngleDeg: overrides.pointAngleDeg ?? null,
    threadPitchMm: overrides.threadPitchMm ?? null,
    description: overrides.description ?? null,
    featureText: overrides.featureText ?? null,
    materialTags: overrides.materialTags ?? [],
    score: overrides.score ?? 80,
    scoreBreakdown: overrides.scoreBreakdown ?? null,
    matchStatus: overrides.matchStatus ?? "exact",
    stockStatus: overrides.stockStatus ?? "instock",
    totalStock: overrides.totalStock ?? 10,
    inventorySnapshotDate: overrides.inventorySnapshotDate ?? null,
    inventoryLocations: overrides.inventoryLocations ?? [],
    hasEvidence: overrides.hasEvidence ?? false,
    bestCondition: overrides.bestCondition ?? null,
  }
}

async function selectPostResultChips(input: {
  snapshots: CandidateSnapshot[]
  filters: Array<{ field: string; op: string; value: string; rawValue: string | number | boolean; appliedAt: number }>
  userMessage: string
  intentShift?: "replace_constraint" | null
  referencedField?: string | null
  frameRelation?: "revise" | null
  hasConflict?: boolean
  correctionSignal?: boolean
}) {
  const plannerCtx = buildPostRecommendationPlannerContext(
    input.snapshots,
    input.filters as any,
    {} as any,
  )
  plannerCtx.userMessage = input.userMessage
  plannerCtx.lastAskedField = input.referencedField ?? undefined

  const candidateOptions = generateSmartOptionCandidates({
    plannerCtx,
    simulatorCtx: {
      candidateCount: input.snapshots.length,
      appliedFilters: input.filters as any,
      candidateFieldValues: plannerCtx.candidateFieldValues,
    },
    rankerCtx: {
      candidateCount: input.snapshots.length,
      filterCount: input.filters.length,
      hasRecommendation: true,
      userMessage: input.userMessage,
    },
  })

  return selectChipsWithLLM(candidateOptions, {
    userMessage: input.userMessage,
    assistantText: "",
    mode: "recommendation",
    pendingField: null,
    candidateCount: input.snapshots.length,
    appliedFilters: input.filters.map(filter => ({ field: filter.field, value: filter.value })),
    resolutionStatus: "resolved_exact",
    displayedProducts: input.snapshots.slice(0, 5).map(snapshot => snapshot.displayCode),
    userState: null,
    confusedAbout: null,
    intentShift: input.intentShift ?? null,
    referencedField: input.referencedField ?? null,
    referencedUIBlock: "recommendation_card",
    frameRelation: input.frameRelation ?? null,
    answeredFields: [],
    conversationDepth: 4,
    suggestedNextAction: input.hasConflict ? "repair" : null,
    hasConflict: input.hasConflict ?? false,
    correctionSignal: input.correctionSignal ?? false,
    recentTurns: [],
  }, unavailableProvider)
}
