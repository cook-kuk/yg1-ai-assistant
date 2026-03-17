import "server-only"

import { Pool, type QueryResult, type QueryResultRow } from "pg"
import { notifyDbQuery } from "@/lib/slack-notifier"
import { appendRuntimeLog, logRuntimeError } from "@/lib/runtime-logger"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { CanonicalProduct, RecommendationInput, SourcePriority, SourceType } from "@/lib/types/canonical"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import { getAppShapesForOperation } from "@/lib/domain/operation-resolver"

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
  search_diameter_mm: number | null
  search_coating: string | null
  search_subtype: string | null
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
  normalizedCode?: string
  seriesName?: string
}

interface DbQueryContext {
  operation: string
  limit?: number
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
  search_diameter_mm,
  search_coating,
  search_subtype
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

  if (!globalThis.__yg1ProductDbPool) {
    console.log("[product-db] creating pg pool")
    globalThis.__yg1ProductDbPool = new Pool({
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
    console.error(
      `[product-db] sql:error operation=${context.operation} duration=${Date.now() - startedAt}ms message=${error instanceof Error ? error.message : String(error)}`
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

function mapRowToProduct(row: RawProductRow): CanonicalProduct {
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
    id: `prod_edp:${row.edp_idx ?? row.edp_no ?? crypto.randomUUID()}`,
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
    coating: firstNonEmpty(row.milling_coating, row.holemaking_coating, row.threading_coating),
    toolMaterial: firstNonEmpty(row.milling_tool_material, row.holemaking_tool_material, row.threading_tool_material),
    shankDiameterMm: parseNumber(firstNonEmpty(row.milling_shank_dia, row.holemaking_shank_dia, row.threading_shank_dia, row.option_shank_diameter, row.option_dcon)),
    lengthOfCutMm: parseNumber(firstNonEmpty(row.milling_length_of_cut, row.holemaking_flute_length, row.threading_thread_length, row.option_flute_length, row.option_loc)),
    overallLengthMm: parseNumber(firstNonEmpty(row.milling_overall_length, row.holemaking_overall_length, row.threading_overall_length, row.option_overall_length, row.option_oal)),
    helixAngleDeg: parseNumber(firstNonEmpty(row.milling_helix_angle, row.holemaking_helix_angle)),
    ballRadiusMm: parseNumber(firstNonEmpty(row.milling_ball_radius, row.option_r, row.option_re)),
    taperAngleDeg: parseNumber(firstNonEmpty(row.milling_taper_angle, row.option_taperangle)),
    coolantHole: parseBoolean(firstNonEmpty(row.milling_coolant_hole, row.holemaking_coolant_hole, row.threading_coolant_hole, row.option_coolanthole)),
    applicationShapes: normalizeApplicationShapes(row.series_application_shape),
    materialTags: normalizeMaterialTags(row.material_tags),
    region: firstNonEmpty(row.region) ?? null,
    description: firstNonEmpty(row.series_description),
    featureText: firstNonEmpty(row.series_feature),
    seriesIconUrl: null,
    sourceConfidence: "medium",
    evidenceRefs: [],
  }

  return {
    ...baseProduct,
    dataCompletenessScore: computeCompletenessScore(baseProduct),
  }
}

function buildQueryOptions(options: ProductSearchOptions): { where: string[]; values: unknown[]; limit: number } {
  const where: string[] = []
  const values: unknown[] = []
  const next = (value: unknown) => {
    values.push(value)
    return `$${values.length}`
  }

  const input = options.input
  if (options.normalizedCode) {
    const normalizedCode = options.normalizedCode.replace(/[\s-]/g, "").toUpperCase()
    const param = next(normalizedCode)
    where.push(`REPLACE(REPLACE(UPPER(COALESCE(edp_no, '')), ' ', ''), '-', '') = ${param}`)
  }

  if (options.seriesName) {
    const param = next(`%${options.seriesName.toLowerCase()}%`)
    where.push(`LOWER(COALESCE(edp_series_name, '')) LIKE ${param}`)
  }

  if (input?.diameterMm != null) {
    const min = next(input.diameterMm - 2)
    const max = next(input.diameterMm + 2)
    where.push(`search_diameter_mm IS NOT NULL AND search_diameter_mm BETWEEN ${min} AND ${max}`)
  }

  const materialTags = new Set<string>()
  if (input?.material) {
    for (const part of input.material.split(",").map(s => s.trim()).filter(Boolean)) {
      const tag = resolveMaterialTag(part)
      if (tag) materialTags.add(tag)
    }
  }
  for (const filter of options.filters ?? []) {
    if (filter.field === "materialTag") {
      for (const part of String(filter.rawValue).split(",").map(s => s.trim().toUpperCase()).filter(Boolean)) {
        if (/^[PMKNSH]$/.test(part)) materialTags.add(part)
      }
    }
  }
  if (materialTags.size > 0) {
    const param = next([...materialTags])
    where.push(`COALESCE(material_tags, ARRAY[]::text[]) && ${param}::text[]`)
  }

  // Region filter (KOREA / GLOBAL) — applied only when region column exists in DB view
  if (input?.region && input.region !== "ALL") {
    const param = next(input.region)
    where.push(`COALESCE(region, '') = ${param}`)
  }

  // Unit system filter (METRIC / INCH)
  if (input?.unitSystem && input.unitSystem !== "ALL") {
    if (input.unitSystem === "INCH") {
      where.push(`UPPER(COALESCE(edp_unit, '')) LIKE '%INCH%'`)
    } else {
      // METRIC: exclude INCH products
      where.push(`UPPER(COALESCE(edp_unit, '')) NOT LIKE '%INCH%'`)
    }
  }

  const appShapes = input?.operationType ? getAppShapesForOperation(input.operationType) : []
  if (appShapes.length > 0) {
    const clauses: string[] = []
    for (const shape of appShapes) {
      const param = next(`%${shape.toLowerCase().replace(/_/g, " ")}%`)
      clauses.push(`LOWER(REPLACE(COALESCE(series_application_shape, ''), '_', ' ')) LIKE ${param}`)
    }
    where.push(`(${clauses.join(" OR ")})`)
  }

  // ── Narrowing filters (fluteCount, coating, toolSubtype, seriesName) ──
  // NOT applied in DB WHERE clause. Applied in-memory by runHybridRetrieval.
  // This ensures candidate counts match exactly what the question engine shows.
  // See: hybrid-retrieval.ts lines 106-166 for in-memory filter application.

  const hasStructuredFilters = where.length > 0
  const filteredLimit = parsePositiveInt(process.env.PRODUCT_QUERY_LIMIT_FILTERED, 2000)
  const broadLimit = parsePositiveInt(process.env.PRODUCT_QUERY_LIMIT_BROAD, 800)
  const limit = options.limit ?? (hasStructuredFilters ? filteredLimit : broadLimit)
  return { where, values, limit }
}

export async function queryProductsFromDatabase(options: ProductSearchOptions = {}): Promise<CanonicalProduct[]> {
  const { where, values, limit } = buildQueryOptions(options)
  const query = `
    SELECT *
    FROM (
      ${PRODUCT_BASE_QUERY}
    ) product_source
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY edp_idx DESC
    LIMIT ${limit}
  `

  const startedAt = Date.now()
  console.log(
    `[product-db] query:start where=${where.length} values=${values.length} limit=${limit} code=${options.normalizedCode ?? "-"} series=${options.seriesName ?? "-"}`
  )
  const result = await executeLoggedQuery<RawProductRow>(query, values, {
    operation: "queryProductsFromDatabase",
    whereCount: where.length,
    limit,
    normalizedCode: options.normalizedCode,
    seriesName: options.seriesName,
  })
  const mapped = result.rows
    .map(mapRowToProduct)
    .filter(product => !!product.normalizedCode)

  const durationMs = Date.now() - startedAt
  if (shouldLogTimings()) {
    console.log(
      `[product-db] query=${durationMs}ms rows=${result.rowCount ?? mapped.length} mapped=${mapped.length} filters=${where.length} limit=${limit}`
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
    query: `code=${options.normalizedCode ?? "-"} series=${options.seriesName ?? "-"} filters=${where.length} limit=${limit}`,
  }).catch(() => {})

  return mapped
}

export async function getProductByCodeFromDatabase(code: string): Promise<CanonicalProduct | null> {
  const products = await queryProductsFromDatabase({ normalizedCode: code, limit: 1 })
  return products[0] ?? null
}

export async function getSeriesOverviewFromDatabase(limit = 120): Promise<ProductSeriesOverview[]> {
  const query = `
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
