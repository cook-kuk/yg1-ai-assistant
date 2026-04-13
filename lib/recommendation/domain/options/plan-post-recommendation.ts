/**
 * Post-recommendation option planning.
 *
 * Chips after a recommendation should come from the actual candidate buffer,
 * not from a fixed post-result menu. This planner turns candidate-field
 * distributions into executable option hints, then the selector decides which
 * ones to surface in the current conversation context.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import { getFieldLabel, nextOptionId } from "./planner-utils"

const POST_RESULT_FIELD_PRIORITY: Record<string, number> = {
  toolSubtype: 1.35,
  fluteCount: 1.2,
  diameterMm: 1.15,
  coating: 1.0,
  seriesName: 0.9,
  toolMaterial: 0.8,
  ballRadiusMm: 0.75,
  taperAngleDeg: 0.7,
}

const VALUE_LABELS: Record<string, Record<string, string>> = {
  toolSubtype: {
    Square: "Square",
    Ball: "Ball",
    Radius: "Radius",
    Roughing: "Roughing",
    Taper: "Taper",
    Chamfer: "Chamfer",
    "High-Feed": "High-Feed",
  },
  coating: {
    Uncoated: "무코팅",
    Bright: "브라이트",
    "Bright Finish": "브라이트",
  },
}

const FIELD_ORDER = [
  "toolSubtype",
  "fluteCount",
  "diameterMm",
  "coating",
  "seriesName",
  "toolMaterial",
  "ballRadiusMm",
  "taperAngleDeg",
]

const POSITIVE_FILTER_OPS = new Set(["eq", "includes"])
const REVISION_HINT_RE = /(유지|말고|빼고|제외|다른|변경|바꿔|수정)/u

export function planPostRecommendationOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const top = ctx.topCandidates ?? []
  const displayed = ctx.displayedProducts ?? []
  const artifacts = ctx.visibleArtifacts
  const activeFilters = buildActiveFilterMap(ctx)
  const skippedFields = new Set(ctx.appliedFilters.filter(filter => filter.op === "skip").map(filter => filter.field))

  const primaryCode = top[0]?.displayCode
  if (primaryCode) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `${primaryCode} 상세 정보`,
      subtitle: "추천 제품 상세",
      reason: "추천 근거 + 스펙 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.9,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "explain_recommendation" }],
      },
    })
  }

  if (top.length >= 2 && !artifacts?.hasComparison) {
    options.push({
      id: nextOptionId("compare"),
      family: "compare",
      label: `상위 ${Math.min(top.length, 3)}개 비교`,
      subtitle: top.slice(0, 3).map(candidate => candidate.displayCode).join(" vs "),
      reason: "상위 후보 비교",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: top.length >= 3,
      priorityScore: 0.8,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "compare" }],
      },
    })
  }

  const candidateFieldValues = ctx.candidateFieldValues ?? new Map<string, Map<string, number>>()
  for (const field of FIELD_ORDER) {
    if (skippedFields.has(field)) continue
    const distribution = candidateFieldValues.get(field)
    if (!distribution || distribution.size < 2) continue

    options.push(...buildBrowseOptions(field, distribution, ctx, activeFilters))
    options.push(...buildValueOptions(field, distribution, ctx, activeFilters))
  }

  options.push(...buildPreserveOptions(ctx))

  if (ctx.appliedFilters.some(filter => filter.op !== "skip")) {
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
      priorityScore: 0.65,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "undo" }],
      },
    })
  }

  const primaryProduct = displayed[0]
  if (primaryProduct?.stockStatus === "outofstock") {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "재고 있는 대안 보기",
      subtitle: `${primaryProduct.displayCode} 재고 없음`,
      field: "stockStatus",
      value: "instock",
      reason: "재고 있는 제품으로 대안 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.75,
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
      priorityScore: 0.55,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "inventory_detail" }],
      },
    })
  }

  const material = ctx.resolvedInput.material as string | undefined
  if (material && top.length >= 2) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `${material} 가공 팁 보기`,
      subtitle: "소재별 최적 조건",
      field: "material",
      value: material,
      reason: "소재 특성에 맞는 가공 조건 안내",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.5,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "material_tip" }],
      },
    })
  }

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
    priorityScore: 0.05,
    plan: {
      type: "reset_session",
      patches: [],
    },
  })

  return dedupeOptions(options)
}

function buildActiveFilterMap(ctx: OptionPlannerContext): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()

  for (const filter of ctx.appliedFilters) {
    if (filter.op === "skip") continue

    const values = Array.isArray(filter.rawValue)
      ? filter.rawValue
      : [filter.rawValue ?? filter.value]

    for (const rawValue of values) {
      const normalized = normalizeToken(rawValue)
      if (!normalized) continue

      if (!result.has(filter.field)) {
        result.set(filter.field, new Set())
      }
      result.get(filter.field)!.add(normalized)
    }
  }

  return result
}

function buildBrowseOptions(
  field: string,
  distribution: Map<string, number>,
  ctx: OptionPlannerContext,
  activeFilters: Map<string, Set<string>>,
): SmartOption[] {
  const options: SmartOption[] = []
  const activeValues = activeFilters.get(field)

  if (activeValues && activeValues.size > 0) {
    const currentLabel = Array.from(activeValues).join("/")
    options.push({
      id: nextOptionId("repair"),
      family: "repair",
      label: `다른 ${getFieldLabel(field)} 보기`,
      subtitle: currentLabel ? `현재 조건 변경` : undefined,
      field,
      reason: `${getFieldLabel(field)}만 바꾸고 나머지 조건 유지`,
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 110 * (POST_RESULT_FIELD_PRIORITY[field] ?? 0.7),
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field }],
      },
    })
    return options
  }

  if (distribution.size < 2) return options

  const actionValue = `narrow_${field}`
  options.push({
    id: nextOptionId("narrowing"),
    family: "narrowing",
    label: buildFieldBrowseLabel(field),
    reason: `${getFieldLabel(field)} 기준 안전한 추가 축소`,
    projectedCount: null,
    projectedDelta: null,
    preservesContext: true,
    destructive: false,
    recommended: false,
    priorityScore: 70 * (POST_RESULT_FIELD_PRIORITY[field] ?? 0.7),
    plan: {
      type: "apply_filter",
      patches: [{ op: "add", field: "_action", value: actionValue }],
    },
  })

  return options
}

function buildValueOptions(
  field: string,
  distribution: Map<string, number>,
  ctx: OptionPlannerContext,
  activeFilters: Map<string, Set<string>>,
): SmartOption[] {
  const activeValues = activeFilters.get(field) ?? new Set<string>()
  const useReplace = activeValues.size > 0
  const maxPerField = field === "toolSubtype" || field === "diameterMm" ? 3 : 2

  return Array.from(distribution.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .filter(([value]) => !activeValues.has(normalizeToken(value)))
    .slice(0, maxPerField)
    .map(([value, count], index) => {
      const plan = useReplace
        ? {
            type: "replace_filter" as const,
            patches: [
              { op: "remove" as const, field },
              { op: "add" as const, field, value },
            ],
          }
        : {
            type: "apply_filter" as const,
            patches: [{ op: "add" as const, field, value }],
          }

      const projectedDelta = count - ctx.candidateCount
      const narrowingGain = ctx.candidateCount > 0
        ? Math.max(0, (1 - (count / ctx.candidateCount)) * 100)
        : 0

      return {
        id: nextOptionId(useReplace ? "repair" : "narrowing"),
        family: useReplace ? "repair" : "narrowing",
        label: buildFieldValueLabel(field, value),
        subtitle: `${count}개 후보`,
        field,
        value,
        reason: useReplace
          ? `${getFieldLabel(field)}만 바꾸고 기존 맥락 유지`
          : `${getFieldLabel(field)} 기준 추가 축소`,
        projectedCount: count,
        projectedDelta,
        preservesContext: true,
        destructive: false,
        recommended: index === 0 && (field === "toolSubtype" || field === "diameterMm"),
        priorityScore: (POST_RESULT_FIELD_PRIORITY[field] ?? 0.7) * 100 + narrowingGain,
        plan,
      }
    })
}

function buildPreserveOptions(ctx: OptionPlannerContext): SmartOption[] {
  if (!shouldGeneratePreserveOptions(ctx)) return []

  const focusedField = getFocusedField(ctx)

  return ctx.appliedFilters
    .filter(filter => POSITIVE_FILTER_OPS.has(filter.op))
    .filter(filter => filter.field !== focusedField)
    .slice(0, 2)
    .map(filter => {
      const label = buildPreserveLabel(filter.field, filter.value, filter.rawValue)
      return {
        id: nextOptionId("action"),
        family: "action" as const,
        label,
        subtitle: `${getFieldLabel(filter.field)} 조건 유지`,
        field: filter.field,
        value: filter.value,
        reason: `${getFieldLabel(filter.field)}는 유지하고 다른 축만 조정`,
        projectedCount: ctx.candidateCount,
        projectedDelta: 0,
        preservesContext: true,
        destructive: false,
        recommended: true,
        priorityScore: 82,
        plan: {
          type: "branch_session",
          patches: [{ op: "add", field: filter.field, value: stringifyFilterRawValue(filter.rawValue, filter.value) }],
        },
      }
    })
}

function shouldGeneratePreserveOptions(ctx: OptionPlannerContext): boolean {
  const hasPositiveFilter = ctx.appliedFilters.some(filter => POSITIVE_FILTER_OPS.has(filter.op))
  if (!hasPositiveFilter) return false

  const interpretation = ctx.contextInterpretation
  if (interpretation && (
    interpretation.intentShift === "replace_constraint"
    || interpretation.intentShift === "refine_existing"
    || interpretation.intentShift === "revise_prior_input"
  )) {
    return true
  }

  return REVISION_HINT_RE.test(ctx.userMessage ?? "")
}

function getFocusedField(ctx: OptionPlannerContext): string | null {
  const interpretationField = ctx.contextInterpretation?.referencedField
  if (interpretationField) return interpretationField
  if (ctx.lastAskedField) return ctx.lastAskedField

  const lastNegativeFilter = [...ctx.appliedFilters]
    .reverse()
    .find(filter => filter.op === "neq" || filter.op === "exclude")
  if (lastNegativeFilter) return lastNegativeFilter.field

  return null
}

function buildPreserveLabel(
  field: string,
  value: string,
  rawValue: string | number | boolean | Array<string | number | boolean>
): string {
  const rendered = renderFilterValue(field, value, rawValue)

  switch (field) {
    case "diameterMm":
      return `φ${rendered} 유지`
    default:
      return `${rendered} 유지`
  }
}

function renderFilterValue(
  field: string,
  value: string,
  rawValue: string | number | boolean | Array<string | number | boolean>
): string {
  if (field === "fluteCount") {
    if (typeof rawValue === "number") return `${rawValue}날`
    return value.endsWith("날") ? value : `${value}날`
  }

  if (field === "diameterMm") {
    if (typeof rawValue === "number") return `${rawValue}mm`
    return value.endsWith("mm") ? value : `${value}mm`
  }

  return value
}

function stringifyFilterRawValue(
  rawValue: string | number | boolean | Array<string | number | boolean>,
  fallback: string
): string | number {
  if (typeof rawValue === "string" || typeof rawValue === "number") return rawValue
  return fallback
}

function buildFieldBrowseLabel(field: string): string {
  switch (field) {
    case "toolSubtype":
      return "공구 형상 보기"
    case "fluteCount":
      return "날 수 좁히기"
    case "diameterMm":
      return "직경 좁히기"
    case "coating":
      return "코팅 보기"
    case "seriesName":
      return "시리즈 보기"
    default:
      return `${getFieldLabel(field)} 보기`
  }
}

function buildFieldValueLabel(field: string, rawValue: string): string {
  const value = localizeValue(field, rawValue)

  switch (field) {
    case "toolSubtype":
    case "coating":
    case "seriesName":
    case "toolMaterial":
      return `${value} 보기`
    case "fluteCount":
      return `${value}날 보기`
    case "diameterMm":
      return `φ${value}mm 보기`
    case "ballRadiusMm":
      return `R${value} 보기`
    case "taperAngleDeg":
      return `${value}° 보기`
    case "coolantHole":
      return value === "true" ? "절삭유 홀 있음 보기" : "절삭유 홀 없음 보기"
    default:
      return `${value} 보기`
  }
}

function localizeValue(field: string, value: string): string {
  return VALUE_LABELS[field]?.[value] ?? value
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
}

function dedupeOptions(options: SmartOption[]): SmartOption[] {
  const seen = new Set<string>()
  const deduped: SmartOption[] = []

  for (const option of options) {
    const key = [
      normalizeToken(option.label),
      option.plan.type,
      option.field ?? "",
      normalizeToken(option.value),
    ].join("|")

    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(option)
  }

  return deduped
}
