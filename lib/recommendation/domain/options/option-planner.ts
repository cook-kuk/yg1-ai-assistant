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
  const interp = ctx.contextInterpretation

  // If context interpretation is available, use it to determine mode and options
  if (interp) {
    return planContextAwareOptions(ctx, interp)
  }

  // Fallback: use mode-based planning
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
// CONTEXT-AWARE PLANNING (uses interpretation + memory)
// ════════════════════════════════════════════════════════════════

function planContextAwareOptions(
  ctx: OptionPlannerContext,
  interp: import("../context/context-types").ContextInterpretation
): SmartOption[] {
  const options: SmartOption[] = []
  const memory = ctx.conversationMemory

  // Route based on interpreted next action
  switch (interp.suggestedNextAction) {
    case "repair":
      // Generate repair options from detected conflicts
      if (interp.detectedConflicts.length > 0) {
        const conflict = interp.detectedConflicts[0]
        ctx.conflictField = conflict.newField
        ctx.conflictValue = conflict.newValue
        options.push(...planRepairOptions(ctx))

        // Also add a branch exploration option
        options.push({
          id: nextOptionId("explore"),
          family: "explore",
          label: `${conflict.newValue} 조건으로 별도 탐색`,
          subtitle: "현재 추천 유지하면서 새 조건 탐색",
          field: conflict.newField,
          value: conflict.newValue,
          reason: "기존 결과를 유지하면서 새로운 가능성 탐색",
          projectedCount: null,
          projectedDelta: null,
          preservesContext: true,
          destructive: false,
          recommended: false,
          priorityScore: 0,
          plan: {
            type: "branch_session",
            patches: [{ op: "add", field: conflict.newField, value: conflict.newValue }],
          },
        })
      }
      break

    case "compare":
      options.push(...planCompareOptions(ctx, interp))
      break

    case "explain":
      options.push(...planExplainOptions(ctx, interp))
      break

    case "narrow":
      options.push(...planContextAwareNarrowingOptions(ctx, interp))
      break

    case "recommend":
      options.push(...planPostRecommendationOptions(ctx))
      // Enrich with context-specific options based on intent shift
      if (interp.intentShift === "refine_existing" && interp.referencedField) {
        options.push({
          id: nextOptionId("action"),
          family: "action",
          label: `${getFieldLabel(interp.referencedField)} 변경`,
          subtitle: "현재 조건 유지하면서 변경",
          field: interp.referencedField,
          reason: "사용자가 특정 조건 변경을 요청",
          projectedCount: null,
          projectedDelta: null,
          preservesContext: true,
          destructive: false,
          recommended: true,
          priorityScore: 0,
          plan: {
            type: "replace_filter",
            patches: [{ op: "remove", field: interp.referencedField }],
          },
        })
      }
      break

    case "revise":
      options.push(...planRevisionOptions(ctx, interp))
      break

    case "regenerate_options":
      // Regenerate options from current session state
      if (ctx.topCandidates && ctx.topCandidates.length > 0) {
        options.push(...planPostRecommendationOptions(ctx))
      } else {
        options.push(...planNarrowingOptions(ctx))
      }
      // Always add revision options when regenerating
      options.push(...planRevisionOptions(ctx, interp))
      break

    case "reset":
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
        plan: { type: "reset_session", patches: [] },
      })
      break

    default:
      options.push(...planNarrowingOptions(ctx))
  }

  return options
}

// ════════════════════════════════════════════════════════════════
// REVISION OPTIONS (undo / revise / go-back)
// ════════════════════════════════════════════════════════════════

function planRevisionOptions(
  ctx: OptionPlannerContext,
  interp: import("../context/context-types").ContextInterpretation
): SmartOption[] {
  const options: SmartOption[] = []
  const filters = ctx.appliedFilters.filter(f => f.op !== "skip")

  // 1. Undo last selection
  if (filters.length > 0) {
    const lastFilter = filters[filters.length - 1]
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: `직전 선택 되돌리기 (${lastFilter.value})`,
      subtitle: `${getFieldLabel(lastFilter.field)} 선택 취소`,
      field: lastFilter.field,
      value: lastFilter.value,
      reason: "마지막 필터 선택 취소",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0,
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field: lastFilter.field, value: lastFilter.value }],
      },
    })
  }

  // 2. Go back to specific prior selection points
  for (const filter of filters.slice(0, -1)) {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: `${getFieldLabel(filter.field)} 선택 전으로 (${filter.value})`,
      subtitle: `${filter.value} 이후 선택 모두 취소`,
      field: filter.field,
      value: filter.value,
      reason: `${filter.field} 선택 전 단계로 복귀`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "relax_filters",
        patches: [{ op: "remove", field: filter.field, value: filter.value }],
      },
    })
  }

  // 3. Replace individual constraints
  const replaceableFields = ["material", "coating", "fluteCount", "diameterMm", "toolSubtype"]
  for (const field of replaceableFields) {
    const existing = filters.find(f => f.field === field)
    if (existing) {
      options.push({
        id: nextOptionId("action"),
        family: "action",
        label: `${getFieldLabel(field)} 다시 고르기`,
        subtitle: `현재: ${existing.value}`,
        field,
        value: existing.value,
        reason: `${field}만 변경하고 나머지 유지`,
        projectedCount: null,
        projectedDelta: null,
        preservesContext: true,
        destructive: false,
        recommended: false,
        priorityScore: 0,
        plan: {
          type: "replace_filter",
          patches: [{ op: "remove", field }],
        },
      })
    }
  }

  // 4. Keep current recommendation and explore different conditions
  if (ctx.topCandidates && ctx.topCandidates.length > 0) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: "현재 추천 유지하고 다른 조건 보기",
      reason: "추천 결과를 보존하면서 추가 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "branch_session",
        patches: [],
      },
    })
  }

  // 5. Reset (always last)
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
    plan: { type: "reset_session", patches: [] },
  })

  return options
}

function planContextAwareNarrowingOptions(
  ctx: OptionPlannerContext,
  interp: import("../context/context-types").ContextInterpretation
): SmartOption[] {
  const options = planNarrowingOptions(ctx)

  // Filter out options for fields that have already been answered
  const answeredFields = new Set(interp.answeredFields)
  const filtered = options.filter(o => {
    if (!o.field) return true
    // Keep options for the currently asked field
    if (o.field === ctx.lastAskedField) return true
    // Filter out already-answered fields
    return !answeredFields.has(o.field)
  })

  return filtered.length > 0 ? filtered : options
}

function planCompareOptions(
  ctx: OptionPlannerContext,
  interp: import("../context/context-types").ContextInterpretation
): SmartOption[] {
  const options: SmartOption[] = []
  const top = ctx.topCandidates ?? []

  if (top.length >= 2) {
    // Compare all alternatives
    options.push({
      id: nextOptionId("compare"),
      family: "compare",
      label: `후보 ${top.length}개 전체 비교`,
      subtitle: "스펙, 재고, 가격 비교",
      reason: "전체 비교표 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0,
      plan: {
        type: "compare_products",
        patches: top.map(c => ({ op: "add" as const, field: "_compare", value: c.displayCode })),
      },
    })
  }

  // Compare specific referenced products
  if (interp.referencedProducts.length >= 2) {
    options.push({
      id: nextOptionId("compare"),
      family: "compare",
      label: `${interp.referencedProducts.slice(0, 2).join(" vs ")} 비교`,
      reason: "선택된 제품 비교",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "compare_products",
        patches: interp.referencedProducts.map(p => ({ op: "add" as const, field: "_compare", value: p })),
      },
    })
  }

  // Always offer cutting conditions and explain after compare
  options.push({
    id: nextOptionId("action"),
    family: "action",
    label: "절삭조건 알려줘",
    reason: "절삭조건 확인",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 0,
    plan: { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "cutting_conditions" }] },
  })

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
    plan: { type: "reset_session", patches: [] },
  })

  return options
}

function planExplainOptions(
  ctx: OptionPlannerContext,
  interp: import("../context/context-types").ContextInterpretation
): SmartOption[] {
  const options: SmartOption[] = []
  const top = ctx.topCandidates ?? []

  // ── Post-recommendation 다양한 후보 (LLM chip selector가 맥락에 맞게 선택) ──
  const mkOpt = (family: SmartOptionFamily, label: string, reason: string, plan: SmartOption["plan"], priority = 0, recommended = false): SmartOption => ({
    id: nextOptionId(family),
    family,
    label,
    reason,
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended,
    priorityScore: priority,
    plan,
  })

  // 추천 이유
  options.push(mkOpt("explore", "왜 이 제품을 추천했나요?", "추천 근거 확인",
    { type: "explain_recommendation", patches: [{ op: "add", field: "_action", value: "explain_recommendation" }] }, 0.9, true))

  // 대체 후보 비교
  if (top.length >= 2) {
    options.push(mkOpt("compare", `대체 후보 ${top.length - 1}개 비교하기`, "대안 비교",
      { type: "compare_products", patches: top.slice(0, 3).map(c => ({ op: "add" as const, field: "_compare", value: c.displayCode })) }, 0.8))
  }

  // 절삭조건
  options.push(mkOpt("action", "절삭조건 알려줘", "절삭조건 확인",
    { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "cutting_conditions" }] }, 0.7))

  // 코팅별 비교 (다양한 코팅이 있을 때)
  const coatings = new Set(top.map(c => c.coating).filter(Boolean))
  if (coatings.size >= 2) {
    options.push(mkOpt("compare", "코팅별 차이 비교", "코팅 특성 비교",
      { type: "compare_products", patches: [{ op: "add", field: "_action", value: "coating_compare" }] }, 0.6))
  }

  // 날수별 비교 (다양한 날수가 있을 때)
  const flutes = new Set(top.map(c => c.fluteCount).filter(Boolean))
  if (flutes.size >= 2) {
    options.push(mkOpt("compare", `${[...flutes].sort().join("날 vs ")}날 비교`, "날수별 특성 비교",
      { type: "compare_products", patches: [{ op: "add", field: "_action", value: "flute_compare" }] }, 0.5))
  }

  // 시리즈 설명 (다양한 시리즈가 있을 때)
  const series = new Set(top.map(c => c.seriesName).filter(Boolean))
  if (series.size >= 2) {
    options.push(mkOpt("explore", "시리즈 차이 설명해줘", "시리즈 특성 비교",
      { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "series_explain" }] }, 0.4))
  }

  // 재고 확인 (primary가 있을 때)
  if (top.length > 0) {
    options.push(mkOpt("action", "재고 확인", "재고 현황 조회",
      { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "inventory_check" }] }, 0.3))
  }

  // 다른 직경/조건 탐색
  options.push(mkOpt("explore", "다른 직경으로 검색", "직경 변경 탐색",
    { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "change_diameter" }] }, 0.2))

  // 다른 소재 조건
  options.push(mkOpt("explore", "다른 소재 조건 검색", "소재 변경 탐색",
    { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "change_material" }] }, 0.1))

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
    plan: { type: "reset_session", patches: [] },
  })

  return options
}

function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    material: "소재", coating: "코팅", diameterMm: "직경",
    fluteCount: "날 수", toolSubtype: "공구 형상", seriesName: "시리즈",
    cuttingType: "가공 유형", operationType: "가공 방식", workPieceName: "세부 피삭재",
  }
  return labels[field] ?? field
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
    workPieceName: "세부 피삭재",
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
  const displayed = ctx.displayedProducts ?? []
  const artifacts = ctx.visibleArtifacts

  // ── UI-artifact-aware: if comparison is already visible, skip compare option ──
  // ── If cutting conditions already shown, skip cutting conditions option ──

  // 1. Compare alternatives (if there are alternatives and no comparison visible)
  if (top.length >= 2 && !artifacts?.hasComparison) {
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

  // 3. Narrow/change coating (dynamic based on variety)
  const coatingSet = new Set(top.map(c => c.coating).filter(Boolean))
  if (coatingSet.size >= 2) {
    const coatingProjected = Math.max(1, Math.round(top.length / coatingSet.size))
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: `코팅으로 좁히기 (${[...coatingSet].slice(0, 3).join("/")})`,
      subtitle: `현재 ${coatingSet.size}종`,
      field: "coating",
      reason: "코팅 기준 추가 필터링",
      projectedCount: coatingProjected,
      projectedDelta: -(top.length - coatingProjected),
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.7,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "narrow_coating" }],
      },
    })
  } else if (top[0]?.coating) {
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

  // 4. Narrow by flute count (if multiple flute counts exist)
  const fluteCounts = new Set(top.map(c => c.fluteCount).filter(Boolean))
  if (fluteCounts.size >= 2) {
    const fluteLabels = [...fluteCounts].sort((a, b) => (a ?? 0) - (b ?? 0)).map(f => `${f}날`).join("/")
    const fluteProjected = Math.max(1, Math.round(top.length / fluteCounts.size))
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: `날수로 좁히기 (${fluteLabels})`,
      subtitle: `현재 ${fluteCounts.size}종`,
      field: "fluteCount",
      reason: "날수 기준 추가 필터링",
      projectedCount: fluteProjected,
      projectedDelta: -(top.length - fluteProjected),
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.85,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "narrow_flute" }],
      },
    })
  }

  // 4b. Change diameter (explore)
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

  // 7. Stock-aware options from displayedProducts
  const primaryProduct = displayed[0]
  if (primaryProduct?.stockStatus === "outofstock") {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "재고 있는 대안 보기",
      subtitle: `${primaryProduct.displayCode} 재고 없음`,
      field: "stockStatus",
      reason: "재고 있는 제품으로 대안 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "stockStatus", value: "instock" }],
      },
    })
  } else if (primaryProduct?.stockStatus === "limited") {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "재고 상세 확인",
      subtitle: `${primaryProduct.displayCode} 재고 제한적`,
      reason: "재고 상세 정보 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "inventory_detail" }],
      },
    })
  }

  // 8. Reset (always available, ranked last)
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
