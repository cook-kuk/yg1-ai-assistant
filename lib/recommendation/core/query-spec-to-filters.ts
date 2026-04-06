/**
 * QuerySpec → AppliedFilter[] 브릿지 (하위 호환)
 *
 * 목적: 기존 serve-engine-runtime / filter-field-registry 경로를 유지하면서
 * 새 QuerySpec 기반 planner를 점진적으로 도입.
 *
 * 장기적으로 AppliedFilter[]는 "derived state"가 되고,
 * QuerySpec / ConstraintState가 진실의 원천이 됨.
 */

import type { QuerySpec, QueryConstraint, QueryField, QueryOp } from "./query-spec"
import type { AppliedFilter } from "@/lib/types/exploration"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"

// ── QueryField → filter-field-registry field mapping ────────

const QUERY_FIELD_TO_FILTER_FIELD: Record<QueryField, string> = {
  materialGroup: "material",
  workpiece: "workPieceName",
  toolFamily: "toolType",
  toolSubtype: "toolSubtype",
  diameterMm: "diameterMm",
  fluteCount: "fluteCount",
  coating: "coating",
  brand: "brand",
  seriesName: "seriesName",
  operationType: "operationType",
  operationShape: "operationShape",
  country: "country",
}

// ── QueryOp → AppliedFilter op mapping ──────────────────────

function mapOp(qop: QueryOp): AppliedFilter["op"] {
  switch (qop) {
    case "eq": return "eq"
    case "neq": return "neq"
    case "contains": return "includes"
    case "in": return "eq"       // TODO: "in" 연산은 AppliedFilter에 없음. 첫 번째 값만 eq로 매핑.
    case "not_in": return "neq"  // TODO: "not_in" 연산은 첫 번째 값만 neq로 매핑.
    case "gte": return "eq"      // TODO: range 연산은 AppliedFilter에서 미지원. 임시로 eq.
    case "lte": return "eq"      // TODO: range 연산은 AppliedFilter에서 미지원.
    case "between": return "eq"  // TODO: range 연산은 AppliedFilter에서 미지원.
    default: return "eq"
  }
}

// ── Core Converter ──────────────────────────────────────────

export function querySpecToAppliedFilters(
  spec: QuerySpec,
  turnCount: number,
): AppliedFilter[] {
  const results: AppliedFilter[] = []

  for (const constraint of spec.constraints) {
    const filterField = QUERY_FIELD_TO_FILTER_FIELD[constraint.field]
    if (!filterField) {
      console.warn(`[query-spec-to-filters] unmapped field "${constraint.field}", skipping`)
      continue
    }

    const rawValue = extractRawValue(constraint)
    const isNeg = constraint.op === "neq" || constraint.op === "not_in"

    // buildAppliedFilterFromValue 사용 (canonicalization 포함)
    const built = buildAppliedFilterFromValue(
      filterField,
      rawValue,
      turnCount,
      isNeg ? "neq" : undefined,
    )

    if (built) {
      // display가 있으면 override
      if (constraint.display) {
        built.value = constraint.display
      }
      results.push(built)
    } else {
      // buildAppliedFilterFromValue가 실패하면 raw로 생성
      results.push({
        field: filterField,
        op: mapOp(constraint.op),
        value: constraint.display ?? String(rawValue),
        rawValue,
        appliedAt: turnCount,
      })
    }
  }

  return results
}

// ── Helpers ─────────────────────────────────────────────────

function extractRawValue(c: QueryConstraint): string | number {
  if (typeof c.value === "number") return c.value
  if (Array.isArray(c.value)) return c.value[0] // between: 임시로 min만
  return c.value
}

// ── Reverse: AppliedFilter[] → QueryConstraint[] ────────────
// 기존 필터를 planner에 전달할 때 사용

const FILTER_FIELD_TO_QUERY_FIELD: Record<string, QueryField> = Object.fromEntries(
  Object.entries(QUERY_FIELD_TO_FILTER_FIELD).map(([qf, ff]) => [ff, qf as QueryField])
)

export function appliedFiltersToConstraints(filters: AppliedFilter[]): QueryConstraint[] {
  return filters
    .filter(f => f.op !== "skip")
    .map(f => {
      const queryField = FILTER_FIELD_TO_QUERY_FIELD[f.field]
      if (!queryField) return null
      return {
        field: queryField,
        op: (f.op === "neq" ? "neq" : f.op === "includes" ? "contains" : "eq") as QueryOp,
        value: f.rawValue ?? f.value,
        display: f.value,
      } satisfies QueryConstraint
    })
    .filter((c): c is QueryConstraint => c !== null)
}
