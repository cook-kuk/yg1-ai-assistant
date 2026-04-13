import "server-only"

import { randomBytes } from "node:crypto"
import { Pool, type QueryResult, type QueryResultRow } from "pg"
import { getSharedPool, getSharedPoolStats } from "@/lib/data/shared-pool"
import { notifyDbQuery } from "@/lib/slack-notifier"
import { appendRuntimeLog, logRuntimeError } from "@/lib/runtime-logger"
import { isPrecisionMode } from "@/lib/recommendation/runtime-flags"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { CanonicalProduct, RecommendationInput, SourcePriority, SourceType } from "@/lib/types/canonical"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import { getOperationShapeSearchTexts } from "@/lib/domain/operation-resolver"
import { resolveRequestedToolFamily as resolveRequestedToolFamilyInput } from "@/lib/data/repos/product-query-filters"
import { buildDbWhereClauseForFilter, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"
import { resolveMaterialFamilyName } from "@/lib/recommendation/shared/material-mapping"

/**
 * Map Korean workpiece names to English for DB series_profile_mv.normalized_work_piece_name matching.
 * Display-level stays Korean; this is only for SQL comparison.
 */
const WORKPIECE_DB_MAP: Record<string, string> = {
  구리: "Copper",
  동: "Copper",
  황동: "Copper",
  구리합금: "Copper",
  copper: "Copper",
  알루미늄: "Aluminum",
  알루: "Aluminum",
  aluminum: "Aluminum",
  aluminium: "Aluminum",
  스테인리스: "Stainless",
  스텐: "Stainless",
  stainless: "Stainless",
  // det-SCR / human variants emit English plural / longer forms — fold them all
  // back to the DB-canonical singular so workpiece-match SQL hits.
  // Without these, "스테인리스 10mm" returned 0 candidates because the SQL bound
  // the literal "Stainless Steels" while the DB had "Stainless".
  stainlesssteel: "Stainless",
  stainlesssteels: "Stainless",
  sus304: "Stainless",
  sus316: "Stainless",
  sts: "Stainless",
  탄소강: "Carbon Steel",
  일반강: "Carbon Steel",
  연강: "Carbon Steel",
  carbonsteel: "Carbon Steel",
  carbonsteels: "Carbon Steel",
  s45c: "Carbon Steel",
  sm45c: "Carbon Steel",
  scm: "Carbon Steel",
  주철: "Cast Iron",
  castiron: "Cast Iron",
  티타늄: "Titanium",
  titanium: "Titanium",
  인코넬: "Inconel",
  inconel: "Inconel",
  초내열합금: "Inconel",
  내열합금: "Inconel",
  고경도강: "Hardened Steel",
  hardenedsteel: "Hardened Steel",
  hardenedsteels: "Hardened Steel",
  skd: "Hardened Steel",
  skd11: "Hardened Steel",
  skd61: "Hardened Steel",
  // Alloy Steels — det-SCR canonical
  합금강: "Alloy Steel",
  alloysteel: "Alloy Steel",
  alloysteels: "Alloy Steel",
  // Prehardened
  prehardenedsteel: "Prehardened Steel",
  prehardenedsteels: "Prehardened Steel",
  // FRP / composite
  frp: "FRP",
  cfrp: "FRP",
  // Graphite
  흑연: "Graphite",
  graphite: "Graphite",
}

export function normalizeWorkPieceNameForDb(raw: string | null): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  const mappedFamily = resolveMaterialFamilyName(trimmed)
  if (mappedFamily) return mappedFamily

  const key = trimmed.toLowerCase().replace(/\s+/g, "")
  const exact = WORKPIECE_DB_MAP[key]
  if (exact) return exact

  const compact = key.replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3]+/g, "")

  // Grade-level material names should collapse into the DB's canonical
  // workpiece family so recommendation queries do not go to 0 rows on
  // literals such as SUS316L or typo-ish stainless variants.
  if (
    /^(?:sus|sts)\d+[a-z]*$/i.test(compact)
    || compact.includes("stainless")
    || compact.includes("스텐")
    || compact.includes("스테인")
  ) {
    return "Stainless"
  }

  if (
    /^a?(?:5052|6061|7075)$/i.test(compact)
    || compact.includes("aluminum")
    || compact.includes("aluminium")
    || compact.includes("알루")
    || compact.includes("알미늄")
  ) {
    return "Aluminum"
  }

  if (
    /^(?:fc|fcd)\d*[a-z]*$/i.test(compact)
    || compact.includes("castiron")
    || compact.includes("주철")
  ) {
    return "Cast Iron"
  }

  if (
    /^(?:scm|sncm|suj)\d*[a-z]*$/i.test(compact)
    || compact.includes("alloysteel")
    || compact.includes("합금")
  ) {
    return "Alloy Steel"
  }

  if (
    /^(?:skd|hrc)\d*[a-z]*$/i.test(compact)
    || compact.includes("hardened")
    || compact.includes("고경도")
    || compact.includes("경화강")
  ) {
    return "Hardened Steel"
  }

  if (
    /^(?:s(?:m)?45c|s50c|s55c|sk3|sk5)$/i.test(compact)
    || compact.includes("carbonsteel")
    || compact.includes("탄소")
    || compact.includes("일반강")
  ) {
    return "Carbon Steel"
  }

  if (
    compact === "cu"
    || compact.includes("copper")
    || compact.includes("brass")
    || compact.includes("bronze")
    || compact.includes("구리")
    || compact.includes("황동")
    || compact.includes("청동")
  ) {
    return "Copper"
  }

  if (
    compact.includes("ti6al4v")
    || compact.includes("titanium")
    || compact.includes("티타늄")
  ) {
    return "Titanium"
  }

  if (
    compact.includes("inconel")
    || compact.includes("hastelloy")
    || compact.includes("superalloy")
    || compact.includes("인코넬")
    || compact.includes("초내열")
    || compact.includes("내열합금")
  ) {
    return "Inconel"
  }

  if (compact === "frp" || compact === "cfrp" || compact.includes("복합재")) {
    return "FRP"
  }

  if (compact.includes("graphite") || compact.includes("흑연")) {
    return "Graphite"
  }

  return trimmed
}

interface RawProductRow {
  edp_idx: string | null
  edp_no: string | null
  edp_brand_name: string | null
  edp_series_name: string | null
  edp_series_idx: string | null
  edp_root_category: string | null
  edp_unit: string | null
  option_z: string | null
  option_numberofflute: string | null
  option_drill_diameter: string | null
  option_d1: string | null
  option_dc: string | null
  option_d: string | null
  option_shank_diameter: string | null
  option_dcon: string | null
  option_flute_length: string | null
  option_loc: string | null
  option_overall_length: string | null
  option_oal: string | null
  option_r: string | null
  option_re: string | null
  option_taperangle: string | null
  option_coolanthole: string | null
  series_row_idx: string | null
  series_brand_name: string | null
  series_description: string | null
  series_feature: string | null
  series_tool_type: string | null
  series_product_type: string | null
  series_application_shape: string | null
  series_cutting_edge_shape: string | null
  country_codes: string[] | null
  material_tags: string[] | null
  milling_outside_dia: string | null
  milling_number_of_flute: string | null
  milling_coating: string | null
  milling_tool_material: string | null
  milling_shank_dia: string | null
  milling_length_of_cut: string | null
  milling_overall_length: string | null
  milling_helix_angle: string | null
  milling_ball_radius: string | null
  milling_taper_angle: string | null
  milling_coolant_hole: string | null
  milling_cutting_edge_shape: string | null
  milling_cutter_shape: string | null
  holemaking_outside_dia: string | null
  holemaking_number_of_flute: string | null
  holemaking_coating: string | null
  holemaking_tool_material: string | null
  holemaking_shank_dia: string | null
  holemaking_flute_length: string | null
  holemaking_overall_length: string | null
  holemaking_helix_angle: string | null
  holemaking_coolant_hole: string | null
  threading_outside_dia: string | null
  threading_number_of_flute: string | null
  threading_coating: string | null
  threading_tool_material: string | null
  threading_shank_dia: string | null
  threading_thread_length: string | null
  threading_overall_length: string | null
  threading_coolant_hole: string | null
  threading_flute_type: string | null
  threading_thread_shape: string | null
  holemaking_point_angle: string | null
  threading_pitch: string | null
  threading_tpi: string | null
  search_diameter_mm: number | null
  search_coating: string | null
  search_subtype: string | null
  search_shank_type: string | null
  milling_shank_type: string | null
  series_shank_type: string | null
  tooling_shank_type: string | null
  // Injected by ranked_products CTE (not in base table)
  material_rating_score?: number | null
}

export interface ProductSeriesOverview {
  seriesName: string
  count: number
  minDiameterMm: number | null
  maxDiameterMm: number | null
  materialTags: string[]
  coating: string | null
  featureText: string | null
  brand: string
}

interface ProductSearchOptions {
  input?: RecommendationInput
  filters?: AppliedFilter[]
  limit?: number
  offset?: number
  normalizedCode?: string
  seriesName?: string
}

export interface ProductSearchPageResult {
  products: CanonicalProduct[]
  totalCount: number
}

function resolveSingleIsoGroup(material: string | undefined): string | null {
  if (!material) return null

  const tags = Array.from(
    new Set(
      material
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => resolveMaterialTag(part))
        .filter((tag): tag is string => Boolean(tag))
    )
  )

  return tags.length === 1 ? tags[0] : null
}

function flattenActiveFilters(filters: AppliedFilter[] = []): AppliedFilter[] {
  const lastMaterialIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "material" ? index : lastIndex
  ), -1)

  return filters.flatMap((filter, index) => {
    if (
      (filter.field === "workPieceName" || filter.field === "edpBrandName" || filter.field === "edpSeriesName") &&
      lastMaterialIndex !== -1 &&
      index < lastMaterialIndex
    ) {
      return []
    }

    const sideFilters = ((filter as unknown as { _sideFilters?: AppliedFilter[] })._sideFilters ?? [])
      .filter(sideFilter => !(
        lastMaterialIndex !== -1 &&
        (sideFilter.field === "edpBrandName" || sideFilter.field === "edpSeriesName") &&
        index < lastMaterialIndex
      ))

    return [filter, ...sideFilters]
  })
}

interface DbQueryContext {
  operation: string
  limit?: number
  offset?: number
  whereCount?: number
  normalizedCode?: string
  seriesName?: string
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1ProductDbPool: Pool | undefined
  // eslint-disable-next-line no-var
  var __yg1ProductDbConfigLogged: boolean | undefined
}

const PRODUCT_BASE_QUERY = `
SELECT
  edp_idx,
  edp_no,
  edp_brand_name,
  edp_series_name,
  edp_series_idx,
  edp_root_category,
  edp_unit,
  option_z,
  option_numberofflute,
  option_drill_diameter,
  option_d1,
  option_dc,
  option_d,
  option_shank_diameter,
  option_dcon,
  option_flute_length,
  option_loc,
  option_overall_length,
  option_oal,
  option_r,
  option_re,
  option_taperangle,
  option_coolanthole,
  series_row_idx,
  series_brand_name,
  series_description,
  series_feature,
  series_tool_type,
  series_product_type,
  series_application_shape,
  series_cutting_edge_shape,
  country_codes,
  material_tags,
  milling_outside_dia,
  milling_number_of_flute,
  milling_coating,
  milling_tool_material,
  milling_shank_dia,
  milling_length_of_cut,
  milling_overall_length,
  milling_helix_angle,
  milling_ball_radius,
  milling_taper_angle,
  milling_coolant_hole,
  milling_cutting_edge_shape,
  milling_cutter_shape,
  holemaking_outside_dia,
  holemaking_number_of_flute,
  holemaking_coating,
  holemaking_tool_material,
  holemaking_shank_dia,
  holemaking_flute_length,
  holemaking_overall_length,
  holemaking_helix_angle,
  holemaking_coolant_hole,
  threading_outside_dia,
  threading_number_of_flute,
  threading_coating,
  threading_tool_material,
  threading_shank_dia,
  threading_thread_length,
  threading_overall_length,
  threading_coolant_hole,
  threading_flute_type,
  threading_thread_shape,
  -- The next three columns may or may not exist depending on the MV build
  -- (older MVs include them; the new compact build does not). Wrapping each
  -- in a NULL alias keeps the SELECT compatible with both schemas without a
  -- runtime introspection step. The row mapper already handles null values.
  NULL::numeric AS holemaking_point_angle,
  NULL::numeric AS threading_pitch,
  NULL::numeric AS threading_tpi,
  search_diameter_mm,
  search_coating,
  search_subtype,
  search_shank_type,
  milling_shank_type,
  series_shank_type,
  tooling_shank_type
FROM catalog_app.product_recommendation_mv
`

function dbConnectionString(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const host = process.env.PGHOST || process.env.POSTGRES_HOST
  const port = process.env.PGPORT || process.env.POSTGRES_PORT || "5432"
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB
  const user = process.env.PGUSER || process.env.POSTGRES_USER
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD

  if (!host || !database || !user || !password) return null
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

function redactConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString)
    const username = parsed.username ? decodeURIComponent(parsed.username) : ""
    const password = parsed.password ? ":****" : ""
    const auth = username ? `${username}${password}@` : ""
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`
  } catch {
    return "<invalid-connection-string>"
  }
}

function logDatabaseConfigOnce(connectionString: string): void {
  if (globalThis.__yg1ProductDbConfigLogged) return
  globalThis.__yg1ProductDbConfigLogged = true
  console.log(
    `[product-db] source=postgres enabled=true repo_source=${process.env.PRODUCT_REPO_SOURCE ?? ""} connection=${redactConnectionString(connectionString)}`
  )
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function shouldLogTimings(): boolean {
  return process.env.LOG_RECOMMEND_TIMINGS?.toLowerCase() !== "false"
}

function formatSqlForLog(query: string): string {
  return query.replace(/\s+/g, " ").trim()
}

function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL"
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`
  if (Buffer.isBuffer(value)) return `'<buffer:${value.length}>'`
  if (Array.isArray(value)) return `ARRAY[${value.map(item => formatSqlLiteral(item)).join(", ")}]`
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`
}

function interpolateSqlForLog(query: string, values: unknown[]): string {
  return query.replace(/\$(\d+)\b/g, (token, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10) - 1
    return index >= 0 && index < values.length ? formatSqlLiteral(values[index]) : token
  })
}

function formatQueryValuesForLog(values: unknown[]): string {
  return JSON.stringify(values, (_key, value) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Date) return value.toISOString()
    if (value === undefined) return null
    return value
  })
}

function formatEdpListForLog(products: Array<{ displayCode: string; normalizedCode?: string }>, maxItems = 50): string {
  const codes = products
    .map(product => product.displayCode || product.normalizedCode || "")
    .filter(Boolean)
  const visible = codes.slice(0, maxItems)
  const remainder = codes.length - visible.length
  return remainder > 0 ? `${visible.join(",")},...(+${remainder})` : visible.join(",")
}

function getPool(): Pool {
  const connectionString = dbConnectionString()
  if (!connectionString) {
    throw new Error("Database source requested but connection settings are missing")
  }

  logDatabaseConfigOnce(connectionString)

  // 단일 shared pool 로 통합 — 이전엔 product-db 가 별도 max=10 pool 을 만들어서
  // 다른 repo (brand/entity/evidence/inventory/series) pool 합쳐 총 28 conn 까지 열려
  // PG "too many clients already" 가 부하 시 발생. shared-pool 1개로 통합해 ceiling 고정.
  if (!globalThis.__yg1ProductDbPool) {
    console.log("[product-db] using shared pg pool")
    globalThis.__yg1ProductDbPool = getSharedPool() ?? new Pool({
      connectionString,
      max: parsePositiveInt(process.env.PRODUCT_DB_POOL_MAX, 10),
      idleTimeoutMillis: parsePositiveInt(process.env.PRODUCT_DB_POOL_IDLE_MS, 30_000),
      connectionTimeoutMillis: parsePositiveInt(process.env.PRODUCT_DB_CONNECT_TIMEOUT_MS, 5_000),
    })
  }

  return globalThis.__yg1ProductDbPool
}

async function executeLoggedQuery<T extends QueryResultRow>(
  query: string,
  values: unknown[],
  context: DbQueryContext
): Promise<QueryResult<T>> {
  const startedAt = Date.now()
  const normalizedQuery = query.trim()
  const compactQuery = formatSqlForLog(normalizedQuery)
  const interpolatedQuery = interpolateSqlForLog(compactQuery, values)
  const loggedValues = formatQueryValuesForLog(values)

  console.log(
    `[product-db] sql operation=${context.operation} query="${interpolatedQuery}" params=${loggedValues}`
  )
  traceRecommendation("db.product.executeLoggedQuery:input", {
    operation: context.operation,
    whereCount: context.whereCount ?? 0,
    limit: context.limit ?? null,
    offset: context.offset ?? 0,
    normalizedCode: context.normalizedCode ?? null,
    seriesName: context.seriesName ?? null,
    query: compactQuery,
    interpolatedQuery,
    valueCount: values.length,
  })

  await appendRuntimeLog({
    category: "db",
    event: "query.start",
    context: {
      ...context,
      sql: normalizedQuery,
      sqlInterpolated: interpolatedQuery,
      values,
    },
  })

  try {
    const result = await getPool().query<T>(query, values)
    const durationMs = Date.now() - startedAt

    console.log(
      `[product-db] sql:done operation=${context.operation} duration=${durationMs}ms rows=${result.rowCount ?? result.rows.length}`
    )
    traceRecommendation("db.product.executeLoggedQuery:output", {
      operation: context.operation,
      durationMs,
      rowCount: result.rowCount ?? result.rows.length,
    })

    await appendRuntimeLog({
      category: "db",
      event: "query.success",
      context: {
        ...context,
        sql: normalizedQuery,
        sqlInterpolated: interpolatedQuery,
        values,
        durationMs,
        rowCount: result.rowCount ?? result.rows.length,
      },
    })

    return result
  } catch (error) {
    traceRecommendationError("db.product.executeLoggedQuery:error", error, {
      context,
      query: normalizedQuery,
      interpolatedQuery,
      values,
    })
    const stats = getSharedPoolStats()
    const statsStr = stats ? ` pool={total:${stats.total},idle:${stats.idle},waiting:${stats.waiting}}` : ""
    console.error(
      `[product-db] sql:error operation=${context.operation} duration=${Date.now() - startedAt}ms message=${error instanceof Error ? error.message : String(error)}${statsStr}`
    )
    await logRuntimeError({
      category: "db",
      event: "query.error",
      error,
      context: {
        ...context,
        sql: normalizedQuery,
        sqlInterpolated: interpolatedQuery,
        values,
        durationMs: Date.now() - startedAt,
      },
    })
    throw error
  }
}

export function shouldUseDatabaseSource(): boolean {
  const enabled = process.env.PRODUCT_REPO_SOURCE?.toLowerCase() !== "json" && !!dbConnectionString()
  if (!enabled) {
    console.warn(
      `[product-db] source=postgres enabled=false repo_source=${process.env.PRODUCT_REPO_SOURCE ?? ""} has_connection=${!!dbConnectionString()}`
    )
  }
  return enabled
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (!value) continue
    const trimmed = value.trim()
    if (!trimmed || trimmed === "0" || trimmed === "NONE" || trimmed === "undefined" || trimmed === "-") continue
    return trimmed
  }
  return null
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-" || trimmed === "NONE" || trimmed === "undefined") return null

  const direct = Number(trimmed.replace(/,/g, ""))
  if (!Number.isNaN(direct)) return direct

  const match = trimmed.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function parseBoolean(value: string | null | undefined): boolean | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === "-" || normalized === "0" || normalized === "none") return null
  if (["y", "yes", "true", "1", "coolant", "through"].includes(normalized)) return true
  if (["n", "no", "false"].includes(normalized)) return false
  return null
}

function titleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

function normalizeToolType(raw: string | null, rootCategory: string | null): string | null {
  const source = firstNonEmpty(raw, rootCategory)
  if (!source) return null
  const lower = source.toLowerCase()
  if (lower.includes("solid")) return "Solid"
  if (lower.includes("indexable")) return "Indexable"
  if (lower.includes("holder")) return "Holder"
  if (lower.includes("insert")) return "Insert"
  if (lower.includes("milling")) return "Solid"
  return titleCase(source)
}

function normalizeToolSubtype(...candidates: Array<string | null | undefined>): string | null {
  const source = firstNonEmpty(...candidates)
  if (!source) return null
  const lower = source.toLowerCase()

  if (lower.includes("chamfer")) return "Chamfer"
  if (lower.includes("rough")) return "Roughing"
  if (lower.includes("taper")) return "Taper"
  if (lower.includes("ball")) return "Ball"
  if (lower.includes("corner radius") || lower === "radius" || lower.includes("radius")) return "Radius"
  if (lower.includes("square")) return "Square"

  return titleCase(source.replace(/_/g, " "))
}

function normalizeAppShapeToken(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "-" || trimmed === "NONE" || trimmed === "undefined") return null

  const map: Record<string, string> = {
    facing: "Facing",
    slotting: "Slotting",
    "die-sinking": "Die-Sinking",
    "die sinking": "Die-Sinking",
    profiling: "Profiling",
    "side milling": "Side_Milling",
    side_milling: "Side_Milling",
    "taper side milling": "Taper_Side_Milling",
    "helical interpolation": "Helical_Interpolation",
    "3d contouring": "3D_Contouring",
    "3d_contouring": "3D_Contouring",
    "heavy cutting": "Heavy_Cutting",
    heavy_cutting: "Heavy_Cutting",
    trochoidal: "Trochoidal",
    chamfering: "Chamfering",
    "corner radius": "Corner_Radius",
    "small part": "Small_Part",
  }

  const normalizedKey = trimmed.toLowerCase().replace(/_/g, " ")
  return map[normalizedKey] ?? trimmed.replace(/\s+/g, "_")
}

function normalizeApplicationShapes(raw: string | null | undefined): string[] {
  if (!raw) return []
  const parts = raw.split(",")
  const unique = new Set<string>()
  for (const part of parts) {
    const normalized = normalizeAppShapeToken(part)
    if (normalized) unique.add(normalized)
  }
  return [...unique]
}

function normalizeMaterialTags(tags: string[] | null | undefined): string[] {
  if (!tags) return []
  const unique = new Set<string>()
  for (const tag of tags) {
    const normalized = tag.trim().toUpperCase()
    if (/^[PMKNSH]$/.test(normalized)) unique.add(normalized)
  }
  return [...unique]
}

const TODO_PLACEHOLDER = "/images/series/todo-placeholder.svg"

// DB raw 코팅 값 normalize: AITiN(OCR/입력 오타) → AlTiN. 다른 typo 발견 시 여기 추가.
function normalizeCoatingValue(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  if (!trimmed) return null
  return trimmed
    .replace(/\bAITiN\b/g, "AlTiN")
    .replace(/\bAITIN\b/g, "AlTiN")
    .replace(/\bALTIN\b/gi, "AlTiN")
}

function resolveSeriesIconUrl(seriesName: string | null | undefined): string {
  if (!seriesName || !seriesName.trim()) return TODO_PLACEHOLDER
  const clean = seriesName.trim()
  return `/images/series/${clean}.jpg`
}

function computeCompletenessScore(product: Omit<CanonicalProduct, "dataCompletenessScore">): number {
  const checks = [
    product.seriesName,
    product.toolType,
    product.toolSubtype,
    product.diameterMm,
    product.fluteCount,
    product.coating,
    product.toolMaterial,
    product.shankDiameterMm,
    product.lengthOfCutMm,
    product.overallLengthMm,
    product.applicationShapes.length > 0 ? "1" : null,
    product.materialTags.length > 0 ? "1" : null,
    product.description,
    product.featureText,
  ]
  const filled = checks.filter(value => value !== null && value !== undefined).length
  return Number((filled / checks.length).toFixed(2))
}

function createFallbackId(): string {
  return randomBytes(8).toString("hex")
}

export function mapRowToProduct(row: RawProductRow): CanonicalProduct {
  const rawDiameter = firstNonEmpty(
    row.milling_outside_dia,
    row.holemaking_outside_dia,
    row.threading_outside_dia,
    row.option_drill_diameter,
    row.option_d1,
    row.option_dc,
    row.option_d,
  )
  const parsedDiameter = parseNumber(rawDiameter)
  const isInch = (row.edp_unit || "").trim().toUpperCase().includes("INCH")
  const diameterMm = parsedDiameter == null ? null : isInch ? Number((parsedDiameter * 25.4).toFixed(2)) : parsedDiameter
  const diameterInch = parsedDiameter == null ? null : isInch ? parsedDiameter : null

  const baseProduct = {
    id: `prod_edp:${row.edp_idx ?? row.edp_no ?? createFallbackId()}`,
    manufacturer: "YG-1",
    brand: firstNonEmpty(row.series_brand_name, row.edp_brand_name, "YG-1")!,
    sourcePriority: 2 as SourcePriority,
    sourceType: "catalog-csv" as SourceType,
    rawSourceFile: "raw_catalog.prod_edp",
    rawSourceSheet: null,
    normalizedCode: (row.edp_no ?? "").replace(/[\s-]/g, "").toUpperCase(),
    displayCode: row.edp_no ?? "",
    seriesName: firstNonEmpty(row.edp_series_name),
    productName: firstNonEmpty(row.series_description, row.series_product_type, row.milling_cutting_edge_shape),
    toolType: normalizeToolType(row.series_tool_type, row.edp_root_category),
    toolSubtype: normalizeToolSubtype(
      row.milling_cutting_edge_shape,
      row.series_cutting_edge_shape,
      row.milling_cutter_shape,
      row.threading_flute_type,
      row.threading_thread_shape,
    ),
    diameterMm,
    diameterInch,
    fluteCount: parseNumber(firstNonEmpty(
      row.milling_number_of_flute,
      row.holemaking_number_of_flute,
      row.threading_number_of_flute,
      row.option_numberofflute,
      row.option_z,
    )),
    coating: normalizeCoatingValue(firstNonEmpty(row.milling_coating, row.holemaking_coating, row.threading_coating, row.search_coating)),
    toolMaterial: firstNonEmpty(row.milling_tool_material, row.holemaking_tool_material, row.threading_tool_material),
    shankDiameterMm: parseNumber(firstNonEmpty(row.milling_shank_dia, row.holemaking_shank_dia, row.threading_shank_dia, row.option_shank_diameter, row.option_dcon)),
    shankType: firstNonEmpty(row.search_shank_type, row.milling_shank_type, row.series_shank_type, row.tooling_shank_type),
    lengthOfCutMm: parseNumber(firstNonEmpty(row.milling_length_of_cut, row.holemaking_flute_length, row.threading_thread_length, row.option_flute_length, row.option_loc)),
    overallLengthMm: parseNumber(firstNonEmpty(row.milling_overall_length, row.holemaking_overall_length, row.threading_overall_length, row.option_overall_length, row.option_oal)),
    helixAngleDeg: parseNumber(firstNonEmpty(row.milling_helix_angle, row.holemaking_helix_angle)),
    ballRadiusMm: parseNumber(firstNonEmpty(row.milling_ball_radius, row.option_r, row.option_re)),
    taperAngleDeg: parseNumber(firstNonEmpty(row.milling_taper_angle, row.option_taperangle)),
    coolantHole: parseBoolean(firstNonEmpty(row.milling_coolant_hole, row.holemaking_coolant_hole, row.threading_coolant_hole, row.option_coolanthole)),
    pointAngleDeg: parseNumber(row.holemaking_point_angle),
    threadPitchMm: parseNumber(row.threading_pitch),
    threadTpi: parseNumber(row.threading_tpi),
    applicationShapes: normalizeApplicationShapes(row.series_application_shape),
    materialTags: normalizeMaterialTags(row.material_tags),
    country: Array.isArray(row.country_codes) && row.country_codes.length > 0
      ? row.country_codes.map(v => String(v).toUpperCase()).join(",")
      : null,
    description: firstNonEmpty(row.series_description),
    featureText: firstNonEmpty(row.series_feature),
    seriesIconUrl: resolveSeriesIconUrl(row.edp_series_name),
    materialRatingScore: typeof row.material_rating_score === "number" ? row.material_rating_score : null,
    workpieceMatched: row.workpiece_name_matched === true,
    sourceConfidence: "medium",
    evidenceRefs: [],
  }

  return {
    ...baseProduct,
    dataCompletenessScore: computeCompletenessScore(baseProduct),
  }
}

interface ProductQueryClauseTrace {
  source: "input" | "filter" | "derived"
  field: string
  op: string
  value: string
  clause: string
}

interface ProductQueryDropTrace {
  field: string
  op: string
  value: string
  reason: string
}

interface ProductQueryDebugPlan {
  appliedClauses: ProductQueryClauseTrace[]
  skippedFilters: ProductQueryDropTrace[]
  droppedFilters: ProductQueryDropTrace[]
  finalWhereClauses: string[]
}

export function buildQueryOptions(options: ProductSearchOptions): {
  where: string[]
  values: unknown[]
  limit: number | undefined
  offset: number
  debugPlan: ProductQueryDebugPlan
} {
  const where: string[] = []
  const values: unknown[] = []
  const appliedClauses: ProductQueryClauseTrace[] = []
  const skippedFilters: ProductQueryDropTrace[] = []
  const droppedFilters: ProductQueryDropTrace[] = []
  const formatTraceValue = (value: unknown): string => (
    Array.isArray(value)
      ? value.map(item => String(item ?? "")).join(",")
      : String(value ?? "")
  )
  const next = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }

  const input = options.input
  if (options.normalizedCode) {
    const normalizedCode = options.normalizedCode.replace(/[\s-]/g, "").toUpperCase()
    const param = next(normalizedCode)
    const clause = `REPLACE(REPLACE(UPPER(COALESCE(edp_no, '')), ' ', ''), '-', '') = ${param}`
    where.push(clause)
    appliedClauses.push({ source: "input", field: "normalizedCode", op: "eq", value: normalizedCode, clause })
  }

  if (options.seriesName) {
    const param = next(`%${options.seriesName.toLowerCase()}%`)
    const clause = `LOWER(COALESCE(edp_series_name, '')) LIKE ${param}`
    where.push(clause)
    appliedClauses.push({ source: "input", field: "seriesName", op: "like", value: options.seriesName, clause })
  }

  if (input?.diameterMm != null) {
    if (isPrecisionMode()) {
      const eq = next(input.diameterMm)
      const clause = `search_diameter_mm = ${eq}`
      where.push(clause)
      appliedClauses.push({ source: "input", field: "diameterMm", op: "eq", value: String(input.diameterMm), clause })
    } else {
      const min = next(input.diameterMm - 2)
      const max = next(input.diameterMm + 2)
      const clause = `search_diameter_mm IS NOT NULL AND search_diameter_mm BETWEEN ${min} AND ${max}`
      where.push(clause)
      appliedClauses.push({ source: "input", field: "diameterMm", op: "between", value: String(input.diameterMm), clause })
    }
  }

  const materialTags = new Set<string>()
  if (input?.material) {
    for (const part of input.material.split(",").map(s => s.trim()).filter(Boolean)) {
      const tag = resolveMaterialTag(part)
      if (tag) materialTags.add(tag)
    }
  }
  console.log(`[DBG-mat] input.material=${JSON.stringify(input?.material)} resolvedTags=${JSON.stringify([...materialTags])}`)
  // input에서 이미 WHERE에 추가한 필드는 filter clause를 중복 생성하지 않는다.
  const inputHandledFields = new Set<string>()
  if (input?.diameterMm != null) inputHandledFields.add("diameterMm")

  for (const filter of flattenActiveFilters(options.filters ?? [])) {
    if (filter.field === "materialTag") {
      for (const part of String(filter.rawValue).split(",").map(s => s.trim().toUpperCase()).filter(Boolean)) {
        if (/^[PMKNSH]$/.test(part)) materialTags.add(part)
      }
    }
    // input에서 이미 처리한 필드는 filter DB clause 생략 (중복 방지)
    if (inputHandledFields.has(filter.field) || inputHandledFields.has(getFilterFieldDefinition(filter.field)?.canonicalField ?? "")) {
      skippedFilters.push({
        field: filter.field,
        op: filter.op,
        value: formatTraceValue(filter.rawValue ?? filter.value),
        reason: "handled_by_input",
      })
      continue
    }
    const clause = buildDbWhereClauseForFilter(filter, next)
    if (clause) {
      where.push(clause)
      appliedClauses.push({
        source: "filter",
        field: filter.field,
        op: filter.op,
        value: formatTraceValue(filter.rawValue ?? filter.value),
        clause,
      })
    } else {
      droppedFilters.push({
        field: filter.field,
        op: filter.op,
        value: formatTraceValue(filter.rawValue ?? filter.value),
        reason: "no_db_clause",
      })
    }
  }
  if (materialTags.size > 0) {
    const param = next([...materialTags])
    const clause = `COALESCE(material_tags, ARRAY[]::text[]) && ${param}::text[]`
    where.push(clause)
    appliedClauses.push({
      source: "derived",
      field: "materialTag",
      op: "overlap",
      value: [...materialTags].join(","),
      clause,
    })
  }

  if (input?.country && input.country !== "ALL") {
    // Region/multi-country: input.country can be comma-separated (e.g. "ENG,DEU,...")
    // from country.setInput(joinedFilterStringValue). Split → array overlap check.
    const codes = input.country.split(",").map(c => c.trim().toUpperCase()).filter(Boolean)
    if (codes.length > 0) {
      const param = next(codes)
      const clause = `COALESCE(country_codes, ARRAY[]::text[]) && ${param}::text[]`
      where.push(clause)
      appliedClauses.push({ source: "input", field: "country", op: "overlap", value: codes.join(","), clause })
    }
  }

  const requestedToolFamily = resolveRequestedToolFamilyInput(input?.toolType)
  if (requestedToolFamily) {
    const categoryParam = next(requestedToolFamily)
    const clause = `LOWER(BTRIM(COALESCE(edp_root_category, ''))) = LOWER(BTRIM(${categoryParam}))`
    where.push(clause)
    appliedClauses.push({ source: "input", field: "toolType", op: "eq", value: requestedToolFamily, clause })
  }

  // operationType은 application_shape LIKE 필터로 잡으면 DB ground truth와
  // 안 맞음 (Suchan finder는 operationType 안 씀). precisionMode에서는 skip.
  if (!isPrecisionMode()) {
    const operationShapeTexts = input?.operationType ? getOperationShapeSearchTexts(input.operationType) : []
    if (operationShapeTexts.length > 0) {
      const clauses: string[] = []
      for (const shape of operationShapeTexts) {
        const param = next(`%${shape.toLowerCase()}%`)
        clauses.push(`LOWER(COALESCE(series_application_shape, '')) LIKE ${param}`)
      }
      const clause = `(${clauses.join(" OR ")})`
      where.push(clause)
      appliedClauses.push({ source: "input", field: "operationType", op: "like", value: operationShapeTexts.join(","), clause })
    }
  }

  const limit = typeof options.limit === "number" && options.limit > 0 ? options.limit : undefined
  const offset = typeof options.offset === "number" && options.offset > 0 ? options.offset : 0
  return {
    where,
    values,
    limit,
    offset,
    debugPlan: {
      appliedClauses,
      skippedFilters,
      droppedFilters,
      finalWhereClauses: [...where],
    },
  }
}

function buildPagedProductQueryBase(where: string[]): string {
  return `
    WITH filtered_products AS (
      SELECT
        *,
        REPLACE(REPLACE(UPPER(COALESCE(edp_no, '')), ' ', ''), '-', '') AS normalized_code
      FROM (
        ${PRODUCT_BASE_QUERY}
      ) product_source
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ),
    deduped_products AS (
      SELECT DISTINCT ON (normalized_code) *
      FROM filtered_products
      ORDER BY normalized_code, edp_idx DESC
    )
  `
}

function buildProductDataQuery(
  input: RecommendationInput | undefined,
  where: string[],
  values: unknown[],
  limit?: number,
  offset = 0
): { query: string; values: unknown[] } {
  const queryBase = buildPagedProductQueryBase(where)
  const dataValues = [...values]
  const materialTag = resolveSingleIsoGroup(input?.material)
  const workPieceName = normalizeWorkPieceNameForDb(input?.workPieceName?.trim() || null)
  const materialTagParam = `$${dataValues.push(materialTag)}`
  const workPieceNameParam = `$${dataValues.push(workPieceName)}`
  const limitClause = limit != null ? `LIMIT $${dataValues.push(limit)}` : ""
  const offsetClause = offset > 0 ? `OFFSET $${dataValues.push(offset)}` : ""

  return {
    query: `
      ${queryBase}
      , ranked_products AS (
        SELECT
          deduped_products.*,
          status_lookup.material_rating,
          COALESCE(status_lookup.material_rating_score, 0) AS material_rating_score,
          COALESCE(status_lookup.workpiece_name_matched, FALSE) AS workpiece_name_matched,
          COALESCE(
            NULLIF(BTRIM(deduped_products.milling_tool_material), ''),
            NULLIF(BTRIM(deduped_products.holemaking_tool_material), ''),
            NULLIF(BTRIM(deduped_products.threading_tool_material), '')
          ) AS effective_tool_material
        FROM deduped_products
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN UPPER(COALESCE(status_row.material_rating, '')) = 'EXCELLENT' THEN 'EXCELLENT'
              WHEN UPPER(COALESCE(status_row.material_rating, '')) = 'GOOD' THEN 'GOOD'
              ELSE 'NULL'
            END AS material_rating,
            COALESCE(status_row.material_rating_score, 0)
              + CASE
                  WHEN ${workPieceNameParam}::text IS NOT NULL
                    AND (
                      status_row.normalized_work_piece_name = NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '')
                      OR status_row.normalized_work_piece_name LIKE '%' || NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') || '%'
                      OR NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') LIKE '%' || status_row.normalized_work_piece_name || '%'
                    )
                  THEN 10
                  ELSE 0
                END
              AS material_rating_score,
            CASE
              WHEN ${workPieceNameParam}::text IS NOT NULL
                AND (
                  status_row.normalized_work_piece_name = NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '')
                  OR status_row.normalized_work_piece_name LIKE '%' || NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') || '%'
                  OR NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') LIKE '%' || status_row.normalized_work_piece_name || '%'
                )
              THEN TRUE
              ELSE FALSE
            END AS workpiece_name_matched
          FROM catalog_app.series_profile_mv sp
          CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(sp.work_piece_statuses, '[]'::jsonb)) AS status_row(
            tag_name text,
            work_piece_name text,
            normalized_work_piece_name text,
            status text,
            material_rating text,
            material_rating_score integer
          )
          WHERE (${materialTagParam}::text IS NOT NULL OR ${workPieceNameParam}::text IS NOT NULL)
            AND sp.normalized_series_name = NULLIF(
              regexp_replace(UPPER(BTRIM(COALESCE(deduped_products.edp_series_name, ''))), '[\\s\\-·ㆍ\\./(),]+', '', 'g'),
              ''
            )
            AND (${materialTagParam}::text IS NULL OR status_row.tag_name = ${materialTagParam})
          ORDER BY
            CASE
              WHEN ${workPieceNameParam}::text IS NOT NULL
                AND (
                  status_row.normalized_work_piece_name = NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '')
                  OR status_row.normalized_work_piece_name LIKE '%' || NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') || '%'
                  OR NULLIF(regexp_replace(UPPER(BTRIM(${workPieceNameParam})), '[[:space:]]+', '', 'g'), '') LIKE '%' || status_row.normalized_work_piece_name || '%'
                )
              THEN 0
              ELSE 1
            END ASC,
            status_row.material_rating_score DESC,
            status_row.work_piece_name ASC NULLS LAST
          LIMIT 1
        ) status_lookup ON TRUE
      )
      SELECT *
      FROM ranked_products
      WHERE ${workPieceNameParam}::text IS NULL OR workpiece_name_matched = TRUE
      ORDER BY
        material_rating_score DESC,
        CASE material_rating
          WHEN 'EXCELLENT' THEN 0
          WHEN 'GOOD' THEN 1
          WHEN 'NULL' THEN 2
          ELSE 3
        END ASC,
        CASE WHEN 'KR' = ANY(COALESCE(country_codes, ARRAY[]::text[])) THEN 0 ELSE 1 END ASC,
        CASE
          WHEN UPPER(COALESCE(effective_tool_material, '')) = 'CARBIDE' THEN 0
          WHEN COALESCE(effective_tool_material, '') <> '' THEN 1
          ELSE 2
        END ASC,
        edp_idx DESC
      ${limitClause}
      ${offsetClause}
    `,
    values: dataValues,
  }
}

// ── In-process TTL cache to dedupe identical product queries ──
// LLM tool loops in chat-service repeatedly call ProductRepo.search with the same
// params; that hammered the DB with 15+ identical 700ms queries per request and
// pushed comparison/explanation requests over the 60s timeout (PUB-062 etc.).
// 10s TTL absorbs the spam without staling user-facing data.
type CacheEntry<T> = { value: T; expiresAt: number }
const PRODUCT_QUERY_CACHE_TTL_MS = 10_000
const PRODUCT_QUERY_CACHE_MAX = 256
const productQueryCache = new Map<string, CacheEntry<unknown>>()

function buildProductQueryCacheKey(prefix: string, options: ProductSearchOptions): string {
  // Stable key: sort top-level options keys, JSON-serialize filters as-is.
  const norm: Record<string, unknown> = {}
  for (const k of Object.keys(options).sort()) {
    const v = (options as Record<string, unknown>)[k]
    if (v !== undefined) norm[k] = v
  }
  return prefix + ":" + JSON.stringify(norm)
}

function readProductQueryCache<T>(key: string): T | undefined {
  const e = productQueryCache.get(key)
  if (!e) return undefined
  if (e.expiresAt <= Date.now()) {
    productQueryCache.delete(key)
    return undefined
  }
  // LRU touch
  productQueryCache.delete(key)
  productQueryCache.set(key, e)
  return e.value as T
}

function writeProductQueryCache<T>(key: string, value: T): void {
  if (productQueryCache.size >= PRODUCT_QUERY_CACHE_MAX) {
    const oldestKey = productQueryCache.keys().next().value
    if (oldestKey !== undefined) productQueryCache.delete(oldestKey)
  }
  productQueryCache.set(key, { value, expiresAt: Date.now() + PRODUCT_QUERY_CACHE_TTL_MS })
}

export async function queryProductsPageFromDatabase(options: ProductSearchOptions = {}): Promise<ProductSearchPageResult> {
  const cacheKey = buildProductQueryCacheKey("page", options)
  const cached = readProductQueryCache<ProductSearchPageResult>(cacheKey)
  if (cached) {
    if (shouldLogTimings()) {
      console.log(`[product-db] cache:hit op=page rows=${cached.products.length} total=${cached.totalCount}`)
    }
    return cached
  }
  const result = await queryProductsPageFromDatabaseUncached(options)
  writeProductQueryCache(cacheKey, result)
  return result
}

async function queryProductsPageFromDatabaseUncached(options: ProductSearchOptions = {}): Promise<ProductSearchPageResult> {
  traceRecommendation("db.product.queryProductsPageFromDatabase:input", {
    normalizedCode: options.normalizedCode ?? null,
    seriesName: options.seriesName ?? null,
    limit: options.limit ?? null,
    offset: options.offset ?? 0,
    hasInput: !!options.input,
    inputKeys: options.input ? Object.keys(options.input).filter(key => options.input?.[key as keyof typeof options.input] != null) : [],
    filterCount: options.filters?.length ?? 0,
  })
  const { where, values, limit, offset, debugPlan } = buildQueryOptions(options)
  const queryBase = buildPagedProductQueryBase(where)
  const countQuery = `
    ${queryBase}
    SELECT COUNT(*)::int AS total_count
    FROM deduped_products
  `
  const dataQuery = buildProductDataQuery(options.input, where, values, limit, offset)

  const startedAt = Date.now()
  console.log(
    `[product-db] query:start where=${where.length} values=${values.length} limit=${limit ?? "none"} offset=${offset} code=${options.normalizedCode ?? "-"} series=${options.seriesName ?? "-"}`
  )
  const countResult = await executeLoggedQuery<{ total_count: number | string }>(countQuery, values, {
    operation: "queryProductsCountFromDatabase",
    whereCount: where.length,
    limit,
    offset,
    normalizedCode: options.normalizedCode,
    seriesName: options.seriesName,
  })
  const totalCount = Number(countResult.rows[0]?.total_count ?? 0)
  const result = await executeLoggedQuery<RawProductRow>(dataQuery.query, dataQuery.values, {
    operation: "queryProductsFromDatabase",
    whereCount: where.length,
    limit,
    offset,
    normalizedCode: options.normalizedCode,
    seriesName: options.seriesName,
  })
  const mapped = result.rows
    .map(mapRowToProduct)
    .filter(product => !!product.normalizedCode)

  traceRecommendation("db.product.queryProductsPageFromDatabase:plan", {
    operation: "queryProductsPageFromDatabase",
    ...debugPlan,
    totalCount,
    pageCount: mapped.length,
    limit,
    offset,
  })

  const durationMs = Date.now() - startedAt
  if (shouldLogTimings()) {
    console.log(
      `[product-db] query=${durationMs}ms rows=${result.rowCount ?? mapped.length} mapped=${mapped.length} total=${totalCount} filters=${where.length} limit=${limit ?? "none"} offset=${offset}`
    )
    console.log(
      `[product-db] stage=db_fetch count=${mapped.length} edps=${formatEdpListForLog(mapped)}`
    )
  }

  // Slack DB 쿼리 알림 (비동기)
  notifyDbQuery({
    source: "PostgreSQL",
    filterCount: where.length,
    resultCount: mapped.length,
    durationMs,
    query: `code=${options.normalizedCode ?? "-"} series=${options.seriesName ?? "-"} filters=${where.length} limit=${limit} offset=${offset} total=${totalCount}`,
  }).catch(() => {})

  traceRecommendation("db.product.queryProductsPageFromDatabase:output", {
    normalizedCode: options.normalizedCode ?? null,
    seriesName: options.seriesName ?? null,
    totalCount,
    productCount: mapped.length,
    productPreview: mapped.slice(0, 6).map(product => ({
      code: product.displayCode || product.normalizedCode,
      seriesName: product.seriesName,
      brand: product.brand,
    })),
    durationMs,
  })
  return {
    products: mapped,
    totalCount,
  }
}

/**
 * Phase G — Execute a pre-compiled SQL (produced by compileProductQuery) and
 * map rows back into CanonicalProduct[]. Used only for specs that carry
 * sort / similarTo / tolerance features the legacy AppliedFilter[] path
 * cannot represent.
 *
 * This intentionally shares the same pool + logging pipeline as the legacy
 * path so the compiled-query path is not a separate DB connection.
 */
export async function executeCompiledProductQuery(
  sql: string,
  params: unknown[],
  opLabel: string = "executeCompiledProductQuery",
): Promise<{ products: CanonicalProduct[]; rowCount: number }> {
  if (!shouldUseDatabaseSource()) {
    console.warn(`[product-db] ${opLabel} skipped: DB source unavailable`)
    return { products: [], rowCount: 0 }
  }
  const result = await executeLoggedQuery<RawProductRow>(sql, params, {
    operation: opLabel,
  })
  const products = result.rows
    .map(mapRowToProduct)
    .filter(product => !!product.normalizedCode)
  return { products, rowCount: result.rowCount ?? products.length }
}

export async function queryProductsFromDatabase(options: ProductSearchOptions = {}): Promise<CanonicalProduct[]> {
  const cacheKey = buildProductQueryCacheKey("list", options)
  const cached = readProductQueryCache<CanonicalProduct[]>(cacheKey)
  if (cached) {
    if (shouldLogTimings()) {
      console.log(`[product-db] cache:hit op=list rows=${cached.length}`)
    }
    return cached
  }
  const result = await queryProductsFromDatabaseUncached(options)
  writeProductQueryCache(cacheKey, result)
  return result
}

async function queryProductsFromDatabaseUncached(options: ProductSearchOptions = {}): Promise<CanonicalProduct[]> {
  traceRecommendation("db.product.queryProductsFromDatabase:input", {
    normalizedCode: options.normalizedCode ?? null,
    seriesName: options.seriesName ?? null,
    limit: options.limit ?? null,
    offset: options.offset ?? 0,
    hasInput: !!options.input,
    inputKeys: options.input ? Object.keys(options.input).filter(key => options.input?.[key as keyof typeof options.input] != null) : [],
    filterCount: options.filters?.length ?? 0,
  })
  const { where, values, limit, offset, debugPlan } = buildQueryOptions(options)
  const dataQuery = buildProductDataQuery(options.input, where, values, limit, offset)

  const startedAt = Date.now()
  console.log(
    `[product-db] query:list:start where=${where.length} values=${dataQuery.values.length} limit=${limit ?? "none"} offset=${offset} code=${options.normalizedCode ?? "-"} series=${options.seriesName ?? "-"}`
  )
  const result = await executeLoggedQuery<RawProductRow>(dataQuery.query, dataQuery.values, {
    operation: "queryProductsListFromDatabase",
    whereCount: where.length,
    limit,
    offset,
    normalizedCode: options.normalizedCode,
    seriesName: options.seriesName,
  })
  const mapped = result.rows
    .map(mapRowToProduct)
    .filter(product => !!product.normalizedCode)

  traceRecommendation("db.product.queryProductsFromDatabase:plan", {
    operation: "queryProductsFromDatabase",
    ...debugPlan,
    productCount: mapped.length,
    limit,
    offset,
  })

  if (shouldLogTimings()) {
    console.log(
      `[product-db] query:list=${Date.now() - startedAt}ms rows=${result.rowCount ?? mapped.length} mapped=${mapped.length} filters=${where.length} limit=${limit ?? "none"} offset=${offset}`
    )
    console.log(
      `[product-db] stage=db_fetch count=${mapped.length} edps=${formatEdpListForLog(mapped)}`
    )
  }

  traceRecommendation("db.product.queryProductsFromDatabase:output", {
    normalizedCode: options.normalizedCode ?? null,
    seriesName: options.seriesName ?? null,
    productCount: mapped.length,
    productPreview: mapped.slice(0, 6).map(product => ({
      code: product.displayCode || product.normalizedCode,
      seriesName: product.seriesName,
      brand: product.brand,
    })),
    durationMs: Date.now() - startedAt,
  })
  return mapped
}

export async function getProductByCodeFromDatabase(code: string): Promise<CanonicalProduct | null> {
  const products = await queryProductsFromDatabase({ normalizedCode: code, limit: 1 })
  return products[0] ?? null
}

export async function getSeriesOverviewFromDatabase(limit = 120): Promise<ProductSeriesOverview[]> {
  const query = `
    WITH
    series_view AS (
      SELECT
        COALESCE(NULLIF(edp_series_name, ''), edp_no) AS series_name,
        COUNT(*) AS count,
        MIN(search_diameter_mm) AS min_diameter_mm,
        MAX(search_diameter_mm) AS max_diameter_mm,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT mt.tag), NULL) AS material_tags,
        MAX(search_coating) AS coating,
        MAX(series_feature) AS feature_text,
        MAX(COALESCE(NULLIF(series_brand_name, ''), NULLIF(edp_brand_name, ''), 'YG-1')) AS brand
      FROM catalog_app.product_recommendation_mv
      LEFT JOIN LATERAL unnest(COALESCE(material_tags, ARRAY[]::text[])) AS mt(tag)
        ON true
      GROUP BY COALESCE(NULLIF(edp_series_name, ''), edp_no)
    )
    SELECT *
    FROM series_view
    ORDER BY count DESC, series_name ASC
    LIMIT $1
  `

  const startedAt = Date.now()
  console.log(`[product-db] series-overview:start limit=${limit}`)
  const result = await executeLoggedQuery<{
    series_name: string
    count: string
    min_diameter_mm: number | null
    max_diameter_mm: number | null
    material_tags: string[] | null
    coating: string | null
    feature_text: string | null
    brand: string | null
  }>(query, [limit], {
    operation: "getSeriesOverviewFromDatabase",
    limit,
  })

  if (shouldLogTimings()) {
    console.log(`[product-db] series-overview=${Date.now() - startedAt}ms rows=${result.rowCount ?? 0} limit=${limit}`)
  }

  return result.rows.map(row => ({
    seriesName: row.series_name,
    count: Number(row.count),
    minDiameterMm: row.min_diameter_mm == null ? null : Number(row.min_diameter_mm),
    maxDiameterMm: row.max_diameter_mm == null ? null : Number(row.max_diameter_mm),
    materialTags: normalizeMaterialTags(row.material_tags),
    coating: row.coating,
    featureText: row.feature_text,
    brand: row.brand ?? "YG-1",
  }))
}
