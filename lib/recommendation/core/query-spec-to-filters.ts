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
  shankType: "shankType",
  country: "country",
}

// ── QueryOp → AppliedFilter op mapping ──────────────────────

// Phase 2: gte/lte/between을 AppliedFilter에서 직접 지원
// in/not_in은 아직 lossy (첫 번째 값만 사용)
const STILL_LOSSY_OPS = new Set(["in", "not_in"])

function mapOp(qop: QueryOp, field?: string): AppliedFilter["op"] {
  if (STILL_LOSSY_OPS.has(qop)) {
    console.warn(`[query-spec-bridge] lossy op: ${field ?? "?"} ${qop} → eq/neq (in/not_in 미지원)`)
  }
  switch (qop) {
    case "eq": return "eq"
    case "neq": return "neq"
    case "contains": return "includes"
    case "gte": return "gte"
    case "lte": return "lte"
    case "between": return "between"
    case "in": return "eq"       // TODO: "in" → 첫 번째 값만 eq
    case "not_in": return "neq"  // TODO: "not_in" → 첫 번째 값만 neq
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

    const mappedOp = mapOp(constraint.op, constraint.field)
    const rawValue = extractRawValue(constraint)
    const isNeg = constraint.op === "neq" || constraint.op === "not_in"

    // Range ops (gte/lte/between): 직접 AppliedFilter 생성 (Phase 2)
    if (mappedOp === "gte" || mappedOp === "lte" || mappedOp === "between") {
      const filter: AppliedFilter = {
        field: filterField,
        op: mappedOp,
        value: constraint.display ?? `${filterField} ${mappedOp} ${rawValue}`,
        rawValue,
        appliedAt: turnCount,
      }
      if (mappedOp === "between" && Array.isArray(constraint.value)) {
        filter.rawValue = constraint.value[0]
        filter.rawValue2 = constraint.value[1]
        filter.value = constraint.display ?? `${filterField}: ${constraint.value[0]}~${constraint.value[1]}`
      }
      results.push(filter)
      continue
    }

    // eq/neq/contains: buildAppliedFilterFromValue 사용 (canonicalization 포함)
    const built = buildAppliedFilterFromValue(
      filterField,
      rawValue,
      turnCount,
      isNeg ? "neq" : undefined,
    )

    if (built) {
      if (constraint.display) built.value = constraint.display
      results.push(built)
    } else {
      results.push({
        field: filterField,
        op: mappedOp,
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
