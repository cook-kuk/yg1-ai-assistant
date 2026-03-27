/**
 * Context-Aware Option Planning — Uses ContextInterpretation to route options.
 *
 * Handles: repair, compare, explain, narrow, recommend, revise,
 * regenerate_options, and reset actions based on interpreted context.
 */

import type { SmartOption, SmartOptionFamily, OptionPlannerContext } from "./types"
import type { ContextInterpretation } from "../context/context-types"
import { nextOptionId } from "./planner-utils"
import { getFieldLabel } from "./planner-utils"
import { planNarrowingOptions } from "./plan-narrowing"
import { planRepairOptions } from "./plan-repair"
import { planPostRecommendationOptions } from "./plan-post-recommendation"

// ════════════════════════════════════════════════════════════════
// CONTEXT-AWARE PLANNING (uses interpretation + memory)
// ════════════════════════════════════════════════════════════════

export function planContextAwareOptions(
  ctx: OptionPlannerContext,
  interp: ContextInterpretation
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
  interp: ContextInterpretation
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
  interp: ContextInterpretation
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
  interp: ContextInterpretation
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
  interp: ContextInterpretation
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

  // ── 후보 데이터 기반 동적 칩 생성 ──
  const coatings = new Set(top.map(c => c.coating).filter(Boolean))
  const flutes = new Set(top.map(c => c.fluteCount).filter(Boolean))
  const series = new Set(top.map(c => c.seriesName).filter(Boolean))
  const primaryCode = top[0]?.displayCode

  // 제품 상세 (1순위 제품코드 포함)
  if (primaryCode) {
    options.push(mkOpt("explore", `${primaryCode} 상세 정보`, "추천 제품 상세",
      { type: "explain_recommendation", patches: [{ op: "add", field: "_action", value: "explain_recommendation" }] }, 0.9, true))
  }

  // 상위 비교 (후보 있을 때)
  if (top.length >= 2) {
    options.push(mkOpt("compare", `상위 ${Math.min(top.length, 3)}개 비교`, "상위 후보 비교",
      { type: "compare_products", patches: top.slice(0, 3).map(c => ({ op: "add" as const, field: "_compare", value: c.displayCode })) }, 0.8))
  }

  // 날수 분포 비교 (2종 이상)
  if (flutes.size >= 2) {
    options.push(mkOpt("compare", `날수별 (${[...flutes].sort().join("/")}날)`, "날수별 비교",
      { type: "compare_products", patches: [{ op: "add", field: "_action", value: "flute_compare" }] }, 0.7))
  }

  // 코팅 분포 비교 (2종 이상)
  if (coatings.size >= 2) {
    options.push(mkOpt("compare", `코팅별 (${[...coatings].slice(0, 3).join("/")})`, "코팅별 비교",
      { type: "compare_products", patches: [{ op: "add", field: "_action", value: "coating_compare" }] }, 0.6))
  }

  // 시리즈 비교 (2개 이상)
  if (series.size >= 2) {
    options.push(mkOpt("explore", `${[...series].slice(0, 2).join(" vs ")} 비교`, "시리즈 비교",
      { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "series_explain" }] }, 0.5))
  }

  // 재고 상태 기반
  if (top[0]?.matchStatus) {
    const stockInfo = ctx.displayedProducts?.find(p => p.displayCode === primaryCode)
    if (stockInfo?.stockStatus === "outofstock" || stockInfo?.stockStatus === "limited") {
      options.push(mkOpt("action", "재고 있는 대안", "재고 있는 제품 탐색",
        { type: "apply_filter", patches: [{ op: "add", field: "stockStatus", value: "instock" }] }, 0.4))
    }
  }

  // 조건 변경
  options.push(mkOpt("explore", "조건 변경", "검색 조건 변경",
    { type: "apply_filter", patches: [{ op: "add", field: "_action", value: "change_conditions" }] }, 0.2))

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
