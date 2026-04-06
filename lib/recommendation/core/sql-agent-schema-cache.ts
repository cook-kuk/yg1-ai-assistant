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
  workpieces: { tag_name: string; normalized_work_piece_name: string }[]
  brands: string[]
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
  const colRes = await pool.query<{ column_name: string; data_type: string }>(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'catalog_app' AND table_name = 'product_recommendation_mv'
    ORDER BY ordinal_position
  `)
  const columns = colRes.rows

  // 2. Sample values for text columns (top 20 each)
  const textCols = columns
    .filter(c => c.data_type.startsWith("character") || c.data_type === "text")
    .map(c => c.column_name)
    .slice(0, 30) // cap to avoid too many queries

  const sampleValues: Record<string, string[]> = {}
  for (const col of textCols) {
    try {
      const res = await pool.query<{ v: string }>(
        `SELECT DISTINCT ${quoteIdent(col)} AS v
         FROM catalog_app.product_recommendation_mv
         WHERE ${quoteIdent(col)} IS NOT NULL AND BTRIM(${quoteIdent(col)}) <> ''
         ORDER BY v LIMIT 20`
      )
      sampleValues[col] = res.rows.map(r => r.v)
    } catch { /* skip columns that fail */ }
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

  cached = { columns, sampleValues, workpieces, brands, loadedAt: Date.now() }
  console.log(`[sql-agent-schema] loaded: ${columns.length} columns, ${workpieces.length} workpieces, ${brands.length} brands`)
  return cached
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
