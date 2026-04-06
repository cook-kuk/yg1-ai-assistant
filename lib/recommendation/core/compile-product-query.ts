/**
 * Deterministic SQL Compiler — QuerySpec → SQL
 *
 * QuerySpec의 constraints를 parameterized SQL로 변환.
 * string concatenation 없이 parameter binding 사용.
 * 지원하지 않는 constraint는 droppedConstraints에 기록.
 */

import type { QuerySpec, QueryConstraint, QueryField } from "./query-spec"

// ── Output Types ────────────────────────────────────────────

export interface CompiledQuery {
  sql: string
  params: unknown[]
  strategy: string
  appliedConstraints: QueryConstraint[]
  droppedConstraints: Array<QueryConstraint & { dropReason: string }>
}

// ── Field → Column Mapping ──────────────────────────────────

interface ColumnMapping {
  column: string
  type: "text" | "numeric"
  /** workpiece는 series_profile_mv와 EXISTS join */
  semantic?: "workpiece"
}

const FIELD_TO_COLUMN: Record<QueryField, ColumnMapping> = {
  materialGroup:   { column: "material_group", type: "text" },
  workpiece:       { column: "work_piece_name", type: "text", semantic: "workpiece" },
  toolFamily:      { column: "edp_root_category", type: "text" },
  toolSubtype:     { column: "search_subtype", type: "text" },
  diameterMm:      { column: "search_diameter_mm", type: "numeric" },
  fluteCount:      { column: "search_flute_count", type: "numeric" },
  coating:         { column: "search_coating", type: "text" },
  brand:           { column: "edp_brand_name", type: "text" },
  seriesName:      { column: "edp_series_name", type: "text" },
  operationType:   { column: "series_application_shape", type: "text" },
  operationShape:  { column: "milling_cutter_shape", type: "text" },
  country:         { column: "country", type: "text" },
}

// ── Core Compiler ───────────────────────────────────────────

const BASE_TABLE = "catalog_app.product_recommendation_mv"

export function compileProductQuery(
  spec: QuerySpec,
  strategy: string = "strict",
): CompiledQuery {
  const params: unknown[] = []
  const whereClauses: string[] = []
  const applied: QueryConstraint[] = []
  const dropped: CompiledQuery["droppedConstraints"] = []

  let paramIdx = 1
  const nextParam = (value: unknown) => {
    params.push(value)
    return `$${paramIdx++}`
  }

  for (const constraint of spec.constraints) {
    const mapping = FIELD_TO_COLUMN[constraint.field]
    if (!mapping) {
      dropped.push({ ...constraint, dropReason: `unknown field: ${constraint.field}` })
      continue
    }

    const clause = buildClause(constraint, mapping, nextParam, strategy)
    if (clause) {
      whereClauses.push(clause)
      applied.push(constraint)
    } else {
      dropped.push({ ...constraint, dropReason: `unsupported op "${constraint.op}" for field "${constraint.field}"` })
    }
  }

  const whereStr = whereClauses.length > 0
    ? `WHERE ${whereClauses.join("\n  AND ")}`
    : ""

  const sql = `SELECT * FROM ${BASE_TABLE}\n${whereStr}\nORDER BY edp_series_name, search_diameter_mm`

  return { sql, params, strategy, appliedConstraints: applied, droppedConstraints: dropped }
}

// ── Clause Builder ──────────────────────────────────────────

function buildClause(
  c: QueryConstraint,
  m: ColumnMapping,
  nextParam: (v: unknown) => string,
  strategy: string,
): string | null {
  // workpiece는 semantic EXISTS clause
  if (m.semantic === "workpiece") {
    return buildWorkpieceClause(c, nextParam)
  }

  const col = m.column

  switch (c.op) {
    case "eq":
      if (m.type === "numeric" && strategy === "diameter_near_0_5" && c.field === "diameterMm") {
        const v = Number(c.value)
        return `${col} BETWEEN ${nextParam(v - 0.5)} AND ${nextParam(v + 0.5)}`
      }
      if (m.type === "numeric" && strategy === "diameter_near_2_0" && c.field === "diameterMm") {
        const v = Number(c.value)
        return `${col} BETWEEN ${nextParam(v - 2.0)} AND ${nextParam(v + 2.0)}`
      }
      return m.type === "text"
        ? `LOWER(COALESCE(${col}, '')) = LOWER(${nextParam(c.value)})`
        : `${col} = ${nextParam(Number(c.value))}`

    case "neq":
      return m.type === "text"
        ? `(${col} IS NULL OR LOWER(COALESCE(${col}, '')) != LOWER(${nextParam(c.value)}))`
        : `(${col} IS NULL OR ${col} != ${nextParam(Number(c.value))})`

    case "contains":
      return `LOWER(COALESCE(${col}, '')) LIKE ${nextParam(`%${String(c.value).toLowerCase()}%`)}`

    case "gte":
      if (m.type !== "numeric") return null
      return `${col} >= ${nextParam(Number(c.value))}`

    case "lte":
      if (m.type !== "numeric") return null
      return `${col} <= ${nextParam(Number(c.value))}`

    case "between":
      if (m.type !== "numeric" || !Array.isArray(c.value)) return null
      return `${col} BETWEEN ${nextParam(c.value[0])} AND ${nextParam(c.value[1])}`

    case "in": {
      const vals = String(c.value).split(",").map(s => s.trim())
      const placeholders = vals.map(v => nextParam(v.toLowerCase()))
      return `LOWER(COALESCE(${col}, '')) IN (${placeholders.join(", ")})`
    }

    case "not_in": {
      const vals = String(c.value).split(",").map(s => s.trim())
      const placeholders = vals.map(v => nextParam(v.toLowerCase()))
      return `(${col} IS NULL OR LOWER(COALESCE(${col}, '')) NOT IN (${placeholders.join(", ")}))`
    }

    default:
      return null
  }
}

// ── Workpiece Semantic Clause ───────────────────────────────
// workpiece는 series_profile_mv에서 JOIN으로 확인

function buildWorkpieceClause(
  c: QueryConstraint,
  nextParam: (v: unknown) => string,
): string | null {
  const spTable = "catalog_app.series_profile_mv"

  switch (c.op) {
    case "eq":
    case "contains":
      return `EXISTS (
        SELECT 1 FROM ${spTable} sp
        WHERE sp.normalized_series_name = ${BASE_TABLE}.edp_series_name
          AND LOWER(sp.normalized_work_piece_name) LIKE ${nextParam(`%${String(c.value).toLowerCase()}%`)}
      )`

    case "neq":
      return `NOT EXISTS (
        SELECT 1 FROM ${spTable} sp
        WHERE sp.normalized_series_name = ${BASE_TABLE}.edp_series_name
          AND LOWER(sp.normalized_work_piece_name) LIKE ${nextParam(`%${String(c.value).toLowerCase()}%`)}
      )`

    default:
      return null
  }
}
