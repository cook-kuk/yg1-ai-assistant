/**
 * SQL Agent Schema Cache
 * 서버 시작 시 1회 DB 스키마 로드, 1시간 캐시.
 * product_recommendation_mv 컬럼 + 샘플 값 + work_piece_statuses + 브랜드 목록.
 */

import { Pool } from "pg"

// ── Types ────────────────────────────────────────────────────

export interface DbSchema {
  columns: { column_name: string; data_type: string }[]
  sampleValues: Record<string, string[]>
  /** Numeric column stats (min/max/distinct samples) — drives range matching without hardcoded labels */
  numericStats: Record<string, { min: number; max: number; samples: number[] }>
  /** Auxiliary tables (cutting conditions, inventory, series profile) — exposed to LLM for joins */
  auxTables: Record<string, { column_name: string; data_type: string }[]>
  workpieces: { tag_name: string; normalized_work_piece_name: string }[]
  brands: string[]
  /** Distinct country codes from product_recommendation_mv.country_codes (text[] array, unnested) */
  countries: string[]
  /**
   * Reverse index: lowercased value → MV column names that contain it.
   * Built from sampleValues + brands + countries + workpieces. Used by
   * deterministic SCR to auto-resolve unqualified tokens (e.g. "titanium")
   * to a filter slot without the user naming the field.
   */
  valueIndex: Record<string, string[]>
  loadedAt: number
}

// ── Cache ────────────────────────────────────────────────────

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
let cached: DbSchema | null = null

/**
 * Reuse the same global pool that product-db-source.ts creates.
 * Falls back to creating a minimal pool from DATABASE_URL if the global isn't ready yet.
 */
function getPool(): Pool {
  // product-db-source.ts stores its pool here
  if (globalThis.__yg1ProductDbPool) return globalThis.__yg1ProductDbPool

  const connStr = process.env.DATABASE_URL
    || (process.env.PGHOST
      ? `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE}`
      : null)
  if (!connStr) throw new Error("[sql-agent-schema] No database connection configured")

  return new Pool({ connectionString: connStr, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1ProductDbPool: Pool | undefined
}

// ── Public API ───────────────────────────────────────────────

export async function getDbSchema(): Promise<DbSchema> {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached

  const pool = getPool()

  // 1. Column metadata
  // NOTE: product_recommendation_mv is a MATERIALIZED VIEW, which information_schema.columns
  // does NOT include (only base tables / regular views). We must read from pg_attribute
  // directly. Earlier this query returned 0 rows, leaving the LLM without any column
  // knowledge and causing hallucinated column names like `milling_point_angle`.
  const colRes = await pool.query<{ column_name: string; data_type: string }>(`
    SELECT
      attname AS column_name,
      format_type(atttypid, atttypmod) AS data_type
    FROM pg_attribute
    WHERE attrelid = 'catalog_app.product_recommendation_mv'::regclass
      AND attnum > 0
      AND NOT attisdropped
    ORDER BY attnum
  `)
  const columns = colRes.rows

  // 2. Sample values for ALL text columns (no cap — every column the DB has must be visible to the LLM)
  const textCols = columns
    .filter(c => c.data_type.startsWith("character") || c.data_type === "text")
    .map(c => c.column_name)

  const sampleValues: Record<string, string[]> = {}
  for (const col of textCols) {
    try {
      const res = await pool.query<{ v: string }>(
        `SELECT DISTINCT ${quoteIdent(col)} AS v
         FROM catalog_app.product_recommendation_mv
         WHERE ${quoteIdent(col)} IS NOT NULL
           AND BTRIM(${quoteIdent(col)}) <> ''
           AND length(${quoteIdent(col)}) <= 64
         ORDER BY v LIMIT 500`
      )
      sampleValues[col] = res.rows.map(r => r.v)
    } catch { /* skip columns that fail */ }
  }

  // 2b. Numeric column stats (min/max/sample) — lets LLM pick the right numeric column without hardcoded labels
  const numericCols = columns
    .filter(c => /int|numeric|double|real|decimal|float/i.test(c.data_type))
    .map(c => c.column_name)

  const numericStats: Record<string, { min: number; max: number; samples: number[] }> = {}
  for (const col of numericCols) {
    try {
      const res = await pool.query<{ mn: number | null; mx: number | null }>(
        `SELECT MIN(${quoteIdent(col)})::float8 AS mn, MAX(${quoteIdent(col)})::float8 AS mx
         FROM catalog_app.product_recommendation_mv
         WHERE ${quoteIdent(col)} IS NOT NULL`
      )
      const mn = res.rows[0]?.mn
      const mx = res.rows[0]?.mx
      if (mn == null || mx == null) continue
      const sampleRes = await pool.query<{ v: number }>(
        `SELECT DISTINCT ${quoteIdent(col)}::float8 AS v
         FROM catalog_app.product_recommendation_mv
         WHERE ${quoteIdent(col)} IS NOT NULL
         ORDER BY v LIMIT 12`
      )
      numericStats[col] = { min: Number(mn), max: Number(mx), samples: sampleRes.rows.map(r => Number(r.v)) }
    } catch { /* skip */ }
  }

  // 3. Workpiece materials from series_profile_mv
  const wpRes = await pool.query<{ tag_name: string; normalized_work_piece_name: string }>(`
    SELECT DISTINCT status_row.tag_name, status_row.normalized_work_piece_name
    FROM catalog_app.series_profile_mv sp
    CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(sp.work_piece_statuses, '[]'::jsonb)) AS status_row(
      tag_name text, normalized_work_piece_name text
    )
    WHERE status_row.normalized_work_piece_name IS NOT NULL
    ORDER BY status_row.tag_name, status_row.normalized_work_piece_name
  `)
  const workpieces = wpRes.rows

  // 4. Brand names
  const brandRes = await pool.query<{ v: string }>(`
    SELECT DISTINCT edp_brand_name AS v
    FROM catalog_app.product_recommendation_mv
    WHERE edp_brand_name IS NOT NULL AND BTRIM(edp_brand_name) <> ''
    ORDER BY v
  `)
  const brands = brandRes.rows.map(r => r.v)

  // 5. Country codes (unnest text[] column — text filter would miss ARRAY columns)
  let countries: string[] = []
  try {
    const countryRes = await pool.query<{ v: string }>(`
      SELECT DISTINCT unnest(country_codes) AS v
      FROM catalog_app.product_recommendation_mv
      WHERE country_codes IS NOT NULL
      ORDER BY v
    `)
    countries = countryRes.rows.map(r => r.v).filter(Boolean)
  } catch {
    // Column may not exist in older schemas — fall back silently.
  }

  // 6. Auxiliary tables (cutting conditions, inventory, series profile) — joinable with the main MV
  const auxTables: Record<string, { column_name: string; data_type: string }[]> = {}
  const AUX_TABLE_TARGETS: Array<{ schema: string; table: string; alias: string }> = [
    { schema: "raw_catalog", table: "cutting_condition_table", alias: "raw_catalog.cutting_condition_table" },
    { schema: "catalog_app", table: "product_inventory_summary_mv", alias: "catalog_app.product_inventory_summary_mv" },
    { schema: "catalog_app", table: "series_profile_mv", alias: "catalog_app.series_profile_mv" },
  ]
  for (const t of AUX_TABLE_TARGETS) {
    try {
      const auxRes = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [t.schema, t.table],
      )
      if (auxRes.rows.length > 0) auxTables[t.alias] = auxRes.rows
    } catch { /* table may not exist in this env */ }
  }

  // 7. Build value→column reverse index for unqualified-token routing.
  const valueIndex = buildValueIndex({ sampleValues, brands, countries, workpieces })

  cached = { columns, sampleValues, numericStats, auxTables, workpieces, brands, countries, valueIndex, loadedAt: Date.now() }
  console.log(`[sql-agent-schema] loaded: ${columns.length} cols, ${Object.keys(sampleValues).length} text-sampled, ${Object.keys(numericStats).length} numeric-sampled, ${Object.keys(auxTables).length} aux tables, ${workpieces.length} wp, ${brands.length} brands, ${countries.length} countries, ${Object.keys(valueIndex).length} indexed`)
  return cached
}

/**
 * Returns the MV column names where `token` appears as a distinct value.
 * Sync — relies on the in-memory cache. Empty array if cache cold or no match.
 * Particles/whitespace are normalized; caller may pass either raw user token
 * or a pre-normalized form.
 */
export function findColumnsForToken(token: string): string[] {
  if (!cached) return []
  const key = normalizeIndexKey(token)
  if (!key) return []
  return cached.valueIndex[key] ?? []
}

export function getDbSchemaSync(): DbSchema | null {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached
  return null
}

// ── Helpers ──────────────────────────────────────────────────

function quoteIdent(name: string): string {
  // simple identifier quoting — prevents SQL injection in column names
  return `"${name.replace(/"/g, '""')}"`
}

// ── Reverse index helpers ────────────────────────────────────

/** Lowercase, trim, collapse whitespace. Index keys and lookup keys go through here. */
function normalizeIndexKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function addIndexEntry(index: Record<string, string[]>, value: string, column: string): void {
  const key = normalizeIndexKey(value)
  if (!key || key.length < 2) return
  // Skip pure numeric / single-char tokens — too noisy as NL routing keys.
  if (/^-?\d+(?:\.\d+)?$/.test(key)) return
  const cols = index[key]
  if (!cols) {
    index[key] = [column]
  } else if (!cols.includes(column)) {
    cols.push(column)
  }
}

function buildValueIndex(args: {
  sampleValues: Record<string, string[]>
  brands: string[]
  countries: string[]
  workpieces: { tag_name: string; normalized_work_piece_name: string }[]
}): Record<string, string[]> {
  const index: Record<string, string[]> = {}
  for (const [col, values] of Object.entries(args.sampleValues)) {
    for (const v of values) addIndexEntry(index, v, col)
  }
  for (const b of args.brands) addIndexEntry(index, b, "edp_brand_name")
  for (const c of args.countries) addIndexEntry(index, c, "country_codes")
  // Workpieces map to the canonical workPieceName slot — stored under a
  // synthetic column that DB_COL_TO_FILTER_FIELD will resolve to workPieceName.
  for (const wp of args.workpieces) {
    addIndexEntry(index, wp.tag_name, "_workPieceName")
    addIndexEntry(index, wp.normalized_work_piece_name, "_workPieceName")
  }
  return index
}
