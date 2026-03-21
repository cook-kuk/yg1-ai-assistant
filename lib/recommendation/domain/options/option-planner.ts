/**
 * Option Planner — Deterministic candidate option generation.
 *
 * Generates structured SmartOptions from session state, resolved input,
 * applied filters, candidates, and current mode.
 *
 * No LLM calls. No external services. Purely deterministic.
 */

import type { SmartOption, SmartOptionFamily, OptionPlannerContext, SmartOptionPlan } from "./types"

let optionCounter = 0
function nextOptionId(family: SmartOptionFamily): string {
  return `${family}_${++optionCounter}`
}

/** Reset counter between test runs */
export function resetOptionCounter(): void {
  optionCounter = 0
}

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════

export function planOptions(ctx: OptionPlannerContext): SmartOption[] {
  switch (ctx.mode) {
    case "intake":
    case "narrowing":
      return planNarrowingOptions(ctx)
    case "repair":
      return planRepairOptions(ctx)
    case "recommended":
      return planPostRecommendationOptions(ctx)
    default:
      return []
  }
}

// ════════════════════════════════════════════════════════════════
// A. NARROWING OPTIONS (before recommendation)
// ════════════════════════════════════════════════════════════════

function planNarrowingOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const fieldValues = ctx.candidateFieldValues

  if (!fieldValues) return options

  // Generate options for the best narrowing fields
  const fields = rankNarrowingFields(fieldValues, ctx)

  for (const { field, values } of fields.slice(0, 3)) {
    // Top values by count for this field
    const sortedValues = Array.from(values.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)

    for (const [value, count] of sortedValues) {
      const delta = count - ctx.candidateCount
      options.push({
        id: nextOptionId("narrowing"),
        family: "narrowing",
        label: formatNarrowingLabel(field, value, count),
        subtitle: `${count}개 후보`,
        field,
        value,
        reason: `${field} = ${value}로 축소`,
        projectedCount: count,
        projectedDelta: delta,
        preservesContext: true,
        destructive: false,
        recommended: false,
        priorityScore: 0, // scored later by ranker
        plan: {
          type: "apply_filter",
          patches: [{ op: "add", field, value }],
        },
      })
    }
  }

  // Add skip option if there's a lastAskedField
  if (ctx.lastAskedField) {
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: "상관없음",
      field: ctx.lastAskedField,
      value: "skip",
      projectedCount: ctx.candidateCount,
      projectedDelta: 0,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: ctx.lastAskedField, value: "skip" }],
      },
    })
  }

  return options
}

interface FieldRank {
  field: string
  values: Map<string, number>
  entropy: number
}

function rankNarrowingFields(
  fieldValues: Map<string, Map<string, number>>,
  ctx: OptionPlannerContext
): FieldRank[] {
  const askedFields = new Set(ctx.appliedFilters.map(f => f.field))
  const results: FieldRank[] = []

  fieldValues.forEach((values, field) => {
    if (askedFields.has(field)) return
    if (values.size <= 1) return

    const entropy = computeEntropy(values, ctx.candidateCount)
    results.push({ field, values, entropy })
  })

  // Sort by entropy (highest information gain first)
  results.sort((a, b) => b.entropy - a.entropy)
  return results
}

function computeEntropy(distribution: Map<string, number>, total: number): number {
  if (total === 0 || distribution.size <= 1) return 0
  let entropy = 0
  distribution.forEach(count => {
    if (count === 0) return
    const p = count / total
    entropy -= p * Math.log2(p)
  })
  const maxEntropy = Math.log2(distribution.size)
  return maxEntropy > 0 ? entropy / maxEntropy : 0
}

function formatNarrowingLabel(field: string, value: string, count: number): string {
  const fieldNames: Record<string, string> = {
    fluteCount: "날 수",
    coating: "코팅",
    seriesName: "시리즈",
    toolSubtype: "공구 형상",
    cuttingType: "가공 유형",
  }
  const fieldLabel = fieldNames[field] ?? field
  return `${value} (${count}개)`
}

// ════════════════════════════════════════════════════════════════
// B. REPAIR OPTIONS (conflict recovery)
// ════════════════════════════════════════════════════════════════

function planRepairOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const { conflictField, conflictValue, appliedFilters, candidateCount } = ctx

  if (!conflictField || !conflictValue) return options

  // 1. Keep current filters and try anyway
  options.push({
    id: nextOptionId("repair"),
    family: "repair",
    label: `현재 조건 유지하고 ${conflictValue} 적용`,
    subtitle: "결과가 적을 수 있음",
    field: conflictField,
    value: conflictValue,
    reason: "기존 필터를 유지하면서 새 조건 추가",
    projectedCount: null, // simulator fills this
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: conflictField, value: conflictValue }],
    },
  })

  // 2. Replace conflicting filters one by one
  const conflictingFilters = findConflictingFilters(conflictField, conflictValue, appliedFilters)
  for (const filter of conflictingFilters) {
    options.push({
      id: nextOptionId("repair"),
      family: "repair",
      label: `${filter.value} 대신 ${conflictValue} 적용`,
      subtitle: `${filter.field} 교체`,
      field: conflictField,
      value: conflictValue,
      reason: `${filter.field}=${filter.value} 제거 후 ${conflictField}=${conflictValue} 적용`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "replace_filter",
        patches: [
          { op: "remove", field: filter.field, value: filter.value },
          { op: "add", field: conflictField, value: conflictValue },
        ],
      },
    })
  }

  // 3. Relax related filters (e.g., coating for material change)
  const relaxableFilters = findRelaxableFilters(conflictField, appliedFilters)
  if (relaxableFilters.length > 0) {
    const relaxPatches: Array<{ op: "add" | "remove" | "replace"; field: string; value?: string }> = relaxableFilters.map(f => ({
      op: "remove" as const,
      field: f.field,
      value: f.value,
    }))
    relaxPatches.push({ op: "add", field: conflictField, value: conflictValue })

    options.push({
      id: nextOptionId("repair"),
      family: "repair",
      label: `${relaxableFilters.map(f => f.value).join(", ")} 조건 완화 후 ${conflictValue} 적용`,
      subtitle: `${relaxableFilters.length}개 조건 완화`,
      field: conflictField,
      value: conflictValue,
      reason: "관련 조건을 완화하여 호환성 확보",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "relax_filters",
        patches: relaxPatches,
      },
    })
  }

  // 4. Full reset with new material (destructive, ranked last)
  options.push({
    id: nextOptionId("reset"),
    family: "reset",
    label: `${conflictValue} 기준으로 처음부터 다시`,
    subtitle: "모든 기존 조건 초기화",
    field: conflictField,
    value: conflictValue,
    reason: "전체 초기화 후 새 조건으로 시작",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: false,
    destructive: true,
    recommended: false,
    priorityScore: 0,
    plan: {
      type: "reset_session",
      patches: [{ op: "replace", field: conflictField, value: conflictValue }],
    },
  })

  return options
}

/** Fields likely to conflict when a given field changes */
const FIELD_CONFLICT_MAP: Record<string, string[]> = {
  material: ["coating", "fluteCount"],
  coating: ["material"],
  fluteCount: ["toolSubtype"],
  toolSubtype: ["fluteCount"],
}

function findConflictingFilters(
  conflictField: string,
  _conflictValue: string,
  appliedFilters: Array<{ field: string; op: string; value: string; rawValue: string | number }>
): Array<{ field: string; value: string }> {
  // If conflictField is the same as an existing filter, that filter conflicts
  return appliedFilters
    .filter(f => f.field === conflictField && f.op !== "skip")
    .map(f => ({ field: f.field, value: f.value }))
}

function findRelaxableFilters(
  conflictField: string,
  appliedFilters: Array<{ field: string; op: string; value: string; rawValue: string | number }>
): Array<{ field: string; value: string }> {
  const relatedFields = FIELD_CONFLICT_MAP[conflictField] ?? []
  return appliedFilters
    .filter(f => relatedFields.includes(f.field) && f.op !== "skip")
    .map(f => ({ field: f.field, value: f.value }))
}

// ════════════════════════════════════════════════════════════════
// C. POST-RECOMMENDATION OPTIONS (after recommendation)
// ════════════════════════════════════════════════════════════════

function planPostRecommendationOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const top = ctx.topCandidates ?? []

  // 1. Compare alternatives (if there are alternatives)
  if (top.length >= 2) {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: `대체 후보 ${top.length - 1}개 비교하기`,
      subtitle: "추천 제품과 대안 비교",
      reason: "대안 비교로 확신 있는 선택",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: top.length >= 3,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "compare" }],
      },
    })
  }

  // 2. Cutting conditions
  options.push({
    id: nextOptionId("action"),
    family: "action",
    label: "절삭조건 알려줘",
    subtitle: "추천 제품의 권장 가공 조건",
    reason: "절삭조건 확인",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0,
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: "_action", value: "cutting_conditions" }],
    },
  })

  // 3. Change coating (explore)
  if (top[0]?.coating) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: "다른 코팅 옵션 보기",
      subtitle: `현재: ${top[0].coating}`,
      field: "coating",
      reason: "코팅 변경 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field: "coating" }],
      },
    })
  }

  // 4. Change diameter (explore)
  if (top[0]?.diameterMm) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: "다른 직경 검색",
      subtitle: `현재: ${top[0].diameterMm}mm`,
      field: "diameterMm",
      reason: "직경 변경 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field: "diameterMm" }],
      },
    })
  }

  // 5. Why this product (explore)
  if (top.length > 0) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: "왜 이 제품을 추천했나요?",
      subtitle: "추천 근거 확인",
      reason: "추천 이유 설명",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "explain_recommendation" }],
      },
    })
  }

  // 6. Previous step (if filters exist)
  if (ctx.appliedFilters.length > 0) {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "⟵ 이전 단계로 돌아가기",
      reason: "이전 필터 단계로 복귀",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "undo" }],
      },
    })
  }

  // 7. Reset (always available, ranked last)
  options.push({
    id: nextOptionId("reset"),
    family: "reset",
    label: "처음부터 다시",
    reason: "전체 초기화",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: false,
    destructive: true,
    recommended: false,
    priorityScore: 0,
    plan: {
      type: "reset_session",
      patches: [],
    },
  })

  return options
}
