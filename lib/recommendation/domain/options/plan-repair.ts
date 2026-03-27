/**
 * Repair Option Planning — Conflict recovery options.
 *
 * Generates options to resolve filter conflicts: keep, replace,
 * relax related filters, or full reset.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import { nextOptionId } from "./planner-utils"

// ════════════════════════════════════════════════════════════════
// REPAIR OPTIONS (conflict recovery)
// ════════════════════════════════════════════════════════════════

export function planRepairOptions(ctx: OptionPlannerContext): SmartOption[] {
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
