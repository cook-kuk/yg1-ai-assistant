import { describe, expect, it } from "vitest"

import { resolvePendingQuestionReply, resolveExplicitRevisionRequest } from "../serve-engine-runtime"
import { applyFilterToInput } from "../serve-engine-input"
import { replaceFieldFilter } from "../serve-engine-filter-state"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    manufacturerScope: "yg1-only",
    locale: "ko",
    material: "일반강",
    ...overrides,
  } as RecommendationInput
}

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "multiturn-test",
    candidateCount: 30,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: makeBaseInput(),
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

// ---------------------------------------------------------------------------
// Scenario 1: Filter chain -> mid-change -> re-change
//
// Simulate: toolSubtype=Square -> fluteCount=4날 -> coating=TiAlN
//           -> "4날 말고 2날로" -> "TiAlN 말고 AlCrN으로"
// ---------------------------------------------------------------------------

describe("Scenario 1: 필터 체인 -> 중간 변경 -> 재변경", () => {
  let input: RecommendationInput
  let filters: AppliedFilter[]

  it("Step 1: parse Square as toolSubtype and apply", () => {
    input = makeBaseInput()
    filters = []

    const filter = parseAnswerToFilter("toolSubtype", "Square")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("toolSubtype")
    expect(filter!.rawValue).toBe("Square")

    input = applyFilterToInput(input, filter!)
    filters.push(filter!)

    expect(input.toolSubtype).toBe("Square")
    expect(filters).toHaveLength(1)
  })

  it("Step 2: parse 4날 as fluteCount and apply — verify accumulation", () => {
    const filter = parseAnswerToFilter("fluteCount", "4날")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("fluteCount")
    expect(filter!.rawValue).toBe(4)

    input = applyFilterToInput(input, filter!)
    filters.push(filter!)

    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(filters).toHaveLength(2)
  })

  it("Step 3: parse TiAlN as coating and apply — verify 3 filters active", () => {
    const filter = parseAnswerToFilter("coating", "TiAlN")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("coating")
    // coating canonicalization preserves original case for non-Korean aliases
    expect(filter!.rawValue).toBe("TiAlN")

    input = applyFilterToInput(input, filter!)
    filters.push(filter!)

    expect(input.toolSubtype).toBe("Square")
    expect(input.flutePreference).toBe(4)
    expect(input.coatingPreference).toBe("TiAlN")
    expect(filters).toHaveLength(3)
  })

  it("Step 4a: revision signal detected — resolvePendingQuestionReply returns unresolved", () => {
    const state = makeState({
      lastAskedField: "coating",
      appliedFilters: [...filters],
      resolvedInput: { ...input },
    })

    const result = resolvePendingQuestionReply(state, "4날 말고 2날로")
    expect(result.kind).toBe("unresolved")
  })

  it("Step 4b: resolveExplicitRevisionRequest resolves fluteCount change (no LLM)", async () => {
    // When hintedFields is empty (no LLM, short alias "날" filtered out),
    // inferRevisionTargetFields falls back to lastAskedField if it matches an
    // active filter, otherwise tries all active fields. We set lastAskedField
    // to a field NOT in appliedFilters so the fallback iterates all fields.
    const state = makeState({
      lastAskedField: "seriesName",
      appliedFilters: [...filters],
      resolvedInput: { ...input },
      filterValueScope: {
        fluteCount: ["2", "4", "6"],
        coating: ["TiAlN", "AlCrN", "TiN"],
        toolSubtype: ["Square", "Ball", "Radius"],
      },
    })

    const revision = await resolveExplicitRevisionRequest(state, "4날 말고 2날로")
    expect(revision).not.toBeNull()
    expect(revision!.kind).toBe("resolved")

    if (revision!.kind === "resolved") {
      expect(revision!.request.targetField).toBe("fluteCount")
      expect(revision!.request.nextFilter.rawValue).toBe(2)
    }
  })

  it("Step 4c: replaceFieldFilter changes fluteCount to 2, preserves other filters", () => {
    const newFluteFilter = parseAnswerToFilter("fluteCount", "2날")!
    expect(newFluteFilter).not.toBeNull()
    expect(newFluteFilter.rawValue).toBe(2)

    const result = replaceFieldFilter(makeBaseInput(), filters, newFluteFilter, applyFilterToInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(3)

    const fluteFilter = result.nextFilters.find(f => f.field === "fluteCount")
    expect(fluteFilter).toBeDefined()
    expect(fluteFilter!.rawValue).toBe(2)

    expect(result.nextFilters.find(f => f.field === "toolSubtype")).toBeDefined()
    expect(result.nextFilters.find(f => f.field === "coating")).toBeDefined()

    expect(result.nextInput.flutePreference).toBe(2)
    expect(result.nextInput.toolSubtype).toBe("Square")
    expect(result.nextInput.coatingPreference).toBe("TiAlN")

    input = result.nextInput
    filters = result.nextFilters
  })

  it("Step 5a: second revision signal detected for coating", () => {
    const state = makeState({
      lastAskedField: "fluteCount",
      appliedFilters: [...filters],
      resolvedInput: { ...input },
    })

    const result = resolvePendingQuestionReply(state, "TiAlN 말고 AlCrN으로")
    expect(result.kind).toBe("unresolved")
  })

  it("Step 5b: resolveExplicitRevisionRequest resolves coating change", async () => {
    const state = makeState({
      lastAskedField: "seriesName",
      appliedFilters: [...filters],
      resolvedInput: { ...input },
      filterValueScope: {
        fluteCount: ["2", "4", "6"],
        coating: ["TiAlN", "AlCrN", "TiN"],
        toolSubtype: ["Square", "Ball", "Radius"],
      },
    })

    const revision = await resolveExplicitRevisionRequest(state, "TiAlN 말고 AlCrN으로")
    expect(revision).not.toBeNull()
    expect(revision!.kind).toBe("resolved")

    if (revision!.kind === "resolved") {
      expect(revision!.request.targetField).toBe("coating")
      expect(revision!.request.nextFilter.rawValue).toBe("AlCrN")
    }
  })

  it("Step 5c: replaceFieldFilter changes coating to AlCrN, preserves Square + 2날", () => {
    const newCoatingFilter = parseAnswerToFilter("coating", "AlCrN")!
    expect(newCoatingFilter).not.toBeNull()

    const result = replaceFieldFilter(makeBaseInput(), filters, newCoatingFilter, applyFilterToInput)

    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(3)

    const coatingFilter = result.nextFilters.find(f => f.field === "coating")
    expect(coatingFilter).toBeDefined()
    expect(coatingFilter!.rawValue).toBe("AlCrN")

    expect(result.nextInput.toolSubtype).toBe("Square")
    expect(result.nextInput.flutePreference).toBe(2)
    expect(result.nextInput.coatingPreference).toBe("AlCrN")
  })
})

// ---------------------------------------------------------------------------
// Scenario 2: Material change -> dependent workPieceName clears -> re-set
//
// Simulate: material=알루미늄, workPieceName=ADC12
//           -> material=주철 (workPieceName clears due to dependency)
//           -> workPieceName=FC250
// ---------------------------------------------------------------------------

describe("Scenario 2: 소재 변경 -> 종속 클리어 -> 재설정", () => {
  let input: RecommendationInput
  let filters: AppliedFilter[]

  it("Step 1: set material=알루미늄 + workPieceName=ADC12", () => {
    input = makeBaseInput({ material: undefined })
    filters = []

    const materialFilter = parseAnswerToFilter("material", "알루미늄")
    expect(materialFilter).not.toBeNull()
    expect(materialFilter!.field).toBe("material")
    input = applyFilterToInput(input, materialFilter!)
    filters.push(materialFilter!)

    const wpFilter = parseAnswerToFilter("workPieceName", "ADC12")
    expect(wpFilter).not.toBeNull()
    expect(wpFilter!.field).toBe("workPieceName")
    input = applyFilterToInput(input, wpFilter!)
    filters.push(wpFilter!)

    expect(input.material).toBe("알루미늄")
    expect(input.workPieceName).toBe("ADC12")
    expect(filters).toHaveLength(2)
  })

  it("Step 2: replace material=주철 → workPieceName cleared by material dependency", () => {
    const ironFilter = parseAnswerToFilter("material", "주철")
    expect(ironFilter).not.toBeNull()

    // replaceFieldFilter rebuilds: remaining=[workPieceName=ADC12], then appends [material=주철]
    // material.setInput does { ...input, material: value, workPieceName: undefined }
    // Since material is applied LAST, it clears the workPieceName set by the earlier filter
    const result = replaceFieldFilter(
      makeBaseInput({ material: undefined }),
      filters,
      ironFilter!,
      applyFilterToInput,
    )

    expect(result.replacedExisting).toBe(true)
    expect(result.nextInput.material).toBe("주철")
    expect(result.nextInput.workPieceName).toBeUndefined()

    input = result.nextInput
    filters = result.nextFilters
  })

  it("Step 2b: filter array still has material and workPieceName entries", () => {
    const materialFilter = filters.find(f => f.field === "material")
    expect(materialFilter).toBeDefined()
    expect(String(materialFilter!.rawValue)).toBe("주철")

    // workPieceName filter entry remains (ADC12) but its effect is overridden
    const wpFilter = filters.find(f => f.field === "workPieceName")
    expect(wpFilter).toBeDefined()
  })

  it("Step 3: apply workPieceName=FC250 → replaces ADC12, material=주철 preserved", () => {
    const fc250Filter = parseAnswerToFilter("workPieceName", "FC250")
    expect(fc250Filter).not.toBeNull()

    // replaceFieldFilter removes old workPieceName, keeps [material=주철], appends [workPieceName=FC250]
    // Rebuild order: material=주철 first, then workPieceName=FC250
    // Result: material=주철, workPieceName=FC250
    const result = replaceFieldFilter(
      makeBaseInput({ material: undefined }),
      filters,
      fc250Filter!,
      applyFilterToInput,
    )

    expect(result.nextInput.material).toBe("주철")
    expect(result.nextInput.workPieceName).toBe("FC250")

    const wpFilter = result.nextFilters.find(f => f.field === "workPieceName")
    expect(wpFilter).toBeDefined()
    expect(String(wpFilter!.rawValue)).toBe("FC250")

    input = result.nextInput
    filters = result.nextFilters
  })

  it("Step 3b: final filter array has exactly 2 entries", () => {
    const fieldSet = new Set(filters.map(f => f.field))
    expect(fieldSet.has("material")).toBe(true)
    expect(fieldSet.has("workPieceName")).toBe(true)
    expect(fieldSet.size).toBe(2)
  })

  it("Step 3c: final input reflects correct values", () => {
    expect(input.material).toBe("주철")
    expect(input.workPieceName).toBe("FC250")
  })
})

// ---------------------------------------------------------------------------
// Scenario 3: Side question preserves filters
//
// Simulate: filters [toolSubtype=Ball, fluteCount=2날], lastAskedField=coating
//           -> "G8A59080 재고 몇개야?" -> side_question (no filter change)
//           -> "TiAlN" -> resolves coating
// ---------------------------------------------------------------------------

describe("Scenario 3: 추천 후 side question -> 조건 유지", () => {
  const baseFilters: AppliedFilter[] = [
    { field: "toolSubtype", op: "includes", value: "Ball", rawValue: "Ball", appliedAt: 1 },
    { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 2 },
  ]

  let state: ExplorationSessionState

  it("Step 1: set up state with toolSubtype=Ball, fluteCount=2날, lastAskedField=coating", () => {
    state = makeState({
      lastAskedField: "coating",
      appliedFilters: [...baseFilters],
      resolvedInput: makeBaseInput({
        toolSubtype: "Ball",
        flutePreference: 2,
      }),
      displayedChips: ["TiAlN (5개)", "AlCrN (3개)", "TiN (2개)", "상관없음"],
    })

    expect(state.appliedFilters).toHaveLength(2)
    expect(state.lastAskedField).toBe("coating")
  })

  it("Step 2: product code + question → classified as side_question", () => {
    const result = resolvePendingQuestionReply(state, "G8A59080 재고 몇개야?")
    expect(result.kind).toBe("side_question")
  })

  it("Step 3: appliedFilters unchanged after side_question", () => {
    expect(state.appliedFilters).toHaveLength(2)
    expect(state.appliedFilters[0].field).toBe("toolSubtype")
    expect(state.appliedFilters[0].rawValue).toBe("Ball")
    expect(state.appliedFilters[1].field).toBe("fluteCount")
    expect(state.appliedFilters[1].rawValue).toBe(2)
  })

  it("Step 3b: plain inventory question also classified as side_question", () => {
    const result = resolvePendingQuestionReply(state, "재고 몇개야?")
    expect(result.kind).toBe("side_question")
  })

  it("Step 3c: price question classified as side_question", () => {
    const result = resolvePendingQuestionReply(state, "가격 알려줘")
    expect(result.kind).toBe("side_question")
  })

  it("Step 3d: lead time question classified as side_question", () => {
    const result = resolvePendingQuestionReply(state, "납기 얼마나 걸려?")
    expect(result.kind).toBe("side_question")
  })

  it("Step 4: direct coating answer TiAlN → resolved with coating filter", () => {
    const result = resolvePendingQuestionReply(state, "TiAlN")
    expect(result.kind).toBe("resolved")

    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("coating")
      // resolvePendingQuestionReply normalizes input text to lowercase before parsing,
      // so rawValue is "tialn" (not original "TiAlN")
      expect(String(result.filter.rawValue).toLowerCase()).toBe("tialn")
    }
  })

  it("Step 5: apply coating → all 3 conditions active in input", () => {
    const resolveResult = resolvePendingQuestionReply(state, "TiAlN")
    expect(resolveResult.kind).toBe("resolved")
    if (resolveResult.kind !== "resolved") return

    const newFilter = resolveResult.filter
    const currentInput = makeBaseInput({ toolSubtype: "Ball", flutePreference: 2 })
    const updatedInput = applyFilterToInput(currentInput, newFilter)

    expect(updatedInput.toolSubtype).toBe("Ball")
    expect(updatedInput.flutePreference).toBe(2)
    expect(updatedInput.coatingPreference?.toLowerCase()).toBe("tialn")

    const allFilters = [...baseFilters, newFilter]
    expect(allFilters).toHaveLength(3)
    expect(allFilters.map(f => f.field)).toEqual(
      expect.arrayContaining(["toolSubtype", "fluteCount", "coating"])
    )
  })

  it("Step 5b: chip selection with count also resolves to coating", () => {
    const result = resolvePendingQuestionReply(state, "TiAlN (5개)")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.field).toBe("coating")
    }
  })

  it("Step 5c: skip selection resolves as skip for pending coating field", () => {
    const result = resolvePendingQuestionReply(state, "상관없음")
    expect(result.kind).toBe("resolved")
    if (result.kind === "resolved") {
      expect(result.filter.op).toBe("skip")
      expect(result.filter.field).toBe("coating")
    }
  })
})
