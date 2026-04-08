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
  /** Column expression used for text comparison (LOWER, =, LIKE, IN). */
  column: string
  type: "text" | "numeric"
  /**
   * Column expression used for numeric comparison (=, gte, lte, between).
   * Defaults to `column`. For numeric ops on text columns, set this to a
   * coercion expression like `numericFromColumns(["option_loc", ...])`.
   */
  numericExpr?: string
  /** workpiece는 series_profile_mv와 EXISTS join */
  semantic?: "workpiece"
}

/**
 * Build a SQL expression that extracts a number from one or more text columns.
 * Mirrors `firstNumberFromColumns` in filter-field-registry.ts so that the
 * compile-product-query path produces the same numeric values as the registry
 * path for text columns that store numbers as strings.
 */
function numericFromColumns(columns: string[]): string {
  const coalesced = `COALESCE(${columns.map(c => `NULLIF(CAST(${c} AS text), '')`).join(", ")})`
  return `NULLIF(substring(${coalesced} from '[-+]?[0-9]*\\.?[0-9]+'), '')::numeric`
}

// Partial: 미지원 필드는 caller가 dropReason="unknown field"로 처리
//
// IMPORTANT: column / numericExpr must reference columns that actually exist in
// catalog_app.product_recommendation_mv. The historical mapping referenced
// non-existent columns (search_flute_count, shank_type, material_group, etc.)
// which produced "column does not exist" errors when this compiler was wired
// up live. The fixes below replace each broken column with a coalesce of the
// real columns the MV exposes.
const FIELD_TO_COLUMN: Partial<Record<QueryField, ColumnMapping>> = {
  // materialGroup: removed. The MV stores material as text[] (`material_tags`),
  // not a scalar `material_group`. The scalar compiler cannot emit the array
  // overlap clause this needs — falls through to the registry path.
  workpiece:       { column: "work_piece_name", type: "text", semantic: "workpiece" },
  toolFamily:      { column: "edp_root_category", type: "text" },
  toolSubtype:     { column: "search_subtype", type: "text" },
  diameterMm:      { column: "search_diameter_mm", type: "numeric" },
  fluteCount:      {
    column: "COALESCE(option_numberofflute, option_z, milling_number_of_flute, holemaking_number_of_flute, threading_number_of_flute)",
    type: "numeric",
    numericExpr: numericFromColumns([
      "option_numberofflute", "option_z",
      "milling_number_of_flute", "holemaking_number_of_flute", "threading_number_of_flute",
    ]),
  },
  coating:         { column: "search_coating", type: "text" },
  brand:           { column: "edp_brand_name", type: "text" },
  seriesName:      { column: "edp_series_name", type: "text" },
  operationType:   { column: "series_application_shape", type: "text" },
  operationShape:  { column: "milling_cutter_shape", type: "text" },
  shankType:       {
    column: "COALESCE(search_shank_type, milling_shank_type, series_shank_type, tooling_shank_type)",
    type: "text",
  },
  // country: intentionally omitted — DB column is `country_codes` (text[]), not a scalar `country`.
  //   The scalar compiler cannot emit the `country_codes && ARRAY[...]::text[]` clause it needs.
  //   Country routing lives in the registry path (filter-field-registry buildDbClause).
  overallLengthMm: {
    column: "COALESCE(milling_overall_length, holemaking_overall_length, threading_overall_length, option_overall_length, option_oal)",
    type: "numeric",
    numericExpr: numericFromColumns([
      "milling_overall_length", "holemaking_overall_length", "threading_overall_length",
      "option_overall_length", "option_oal",
    ]),
  },
  lengthOfCutMm:   {
    column: "COALESCE(milling_length_of_cut, holemaking_flute_length, threading_thread_length, option_flute_length, option_loc)",
    type: "numeric",
    numericExpr: numericFromColumns([
      "milling_length_of_cut", "holemaking_flute_length", "threading_thread_length",
      "option_flute_length", "option_loc",
    ]),
  },
  shankDiameterMm: {
    column: "COALESCE(milling_shank_dia, holemaking_shank_dia, threading_shank_dia, option_shank_diameter, option_dcon)",
    type: "numeric",
    numericExpr: numericFromColumns([
      "milling_shank_dia", "holemaking_shank_dia", "threading_shank_dia",
      "option_shank_diameter", "option_dcon",
    ]),
  },
  helixAngleDeg:   {
    column: "COALESCE(milling_helix_angle, holemaking_helix_angle)",
    type: "numeric",
    numericExpr: numericFromColumns(["milling_helix_angle", "holemaking_helix_angle"]),
  },
  // pointAngleDeg / threadPitchMm: text columns in mv, registry path handles
  //   numeric-safe extraction via firstNumberFromColumns. Keep out of the
  //   scalar compiler to avoid type-mismatch SQL.
  // coolantHole: boolean — compile-product-query는 text/numeric만 지원, registry path로 위임
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
  // For numeric ops on text columns, use the numeric coercion expression instead.
  const numCol = m.numericExpr ?? m.column

  switch (c.op) {
    case "eq":
      if (m.type === "numeric" && strategy === "diameter_near_0_5" && c.field === "diameterMm") {
        const v = Number(c.value)
        return `${numCol} BETWEEN ${nextParam(v - 0.5)} AND ${nextParam(v + 0.5)}`
      }
      if (m.type === "numeric" && strategy === "diameter_near_2_0" && c.field === "diameterMm") {
        const v = Number(c.value)
        return `${numCol} BETWEEN ${nextParam(v - 2.0)} AND ${nextParam(v + 2.0)}`
      }
      return m.type === "text"
        ? `LOWER(COALESCE(${col}, '')) = LOWER(${nextParam(c.value)})`
        : `${numCol} = ${nextParam(Number(c.value))}`

    case "neq":
      return m.type === "text"
        ? `(${col} IS NULL OR LOWER(COALESCE(${col}, '')) != LOWER(${nextParam(c.value)}))`
        : `(${numCol} IS NULL OR ${numCol} != ${nextParam(Number(c.value))})`

    case "contains":
      return `LOWER(COALESCE(${col}, '')) LIKE ${nextParam(`%${String(c.value).toLowerCase()}%`)}`

    case "gte":
      if (m.type !== "numeric") return null
      return `${numCol} >= ${nextParam(Number(c.value))}`

    case "lte":
      if (m.type !== "numeric") return null
      return `${numCol} <= ${nextParam(Number(c.value))}`

    case "between":
      if (m.type !== "numeric" || !Array.isArray(c.value)) return null
      return `${numCol} BETWEEN ${nextParam(c.value[0])} AND ${nextParam(c.value[1])}`

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
