import "server-only"

import { Pool } from "pg"
import { formatQueryValuesForLog, formatSqlForLog, interpolateSqlForLog } from "@/lib/data/sql-log"
import { getSharedPool } from "@/lib/data/shared-pool"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

export interface BrandReferenceRecord {
  tagName: string
  workPieceName: string
  hardnessMinHrc: number | null
  hardnessMaxHrc: number | null
  brandName: string
  sourceFile: string
}

export interface BrandReferenceQuery {
  isoGroup?: string | null
  workPieceQuery?: string | null
  hardnessMinHrc?: number | null
  hardnessMaxHrc?: number | null
  limit?: number
}

export interface DistinctWorkPieceQuery {
  isoGroup: string
  limit?: number
}

export interface DistinctBrandQuery {
  isoGroup: string
  workPieceName: string
  limit?: number
}

export interface DistinctSeriesQuery {
  isoGroup: string
  workPieceName: string
  limit?: number
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1BrandReferenceDbPool: Pool | undefined
}

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

function getPool(): Pool | null {
  const connectionString = dbConnectionString()
  if (!connectionString) return null

  if (!globalThis.__yg1BrandReferenceDbPool) {
    const shared = getSharedPool()
    if (shared) {
      globalThis.__yg1BrandReferenceDbPool = shared
    } else {
      console.log("[brand-reference-db] creating pg pool (no shared pool)")
      globalThis.__yg1BrandReferenceDbPool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    }
  }

  return globalThis.__yg1BrandReferenceDbPool
}

function toNullableUpper(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed.toUpperCase() : null
}

function toNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export const BrandReferenceRepo = {
  async listDistinctWorkPieceNames(query: DistinctWorkPieceQuery): Promise<string[]> {
    traceRecommendation("db.brandReference.listDistinctWorkPieceNames:input", {
      isoGroup: query.isoGroup ?? null,
      limit: query.limit ?? null,
    })
    const pool = getPool()
    if (!pool) {
      console.warn("[brand-reference-repo] distinct work piece query skipped: DB source unavailable")
      return []
    }

    const isoGroup = toNullableUpper(query.isoGroup)
    if (!isoGroup) return []

    const limit = typeof query.limit === "number" && query.limit > 0 ? Math.min(query.limit, 30) : 12
    const sql = `
      SELECT DISTINCT work_piece_name
      FROM catalog_app.brand_reference
      WHERE UPPER(tag_name) = $1
        AND work_piece_name IS NOT NULL
        AND BTRIM(work_piece_name) <> ''
      ORDER BY work_piece_name ASC
      LIMIT $2
    `

    const startedAt = Date.now()
    try {
      const values = [isoGroup, limit]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[brand-reference-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query(sql, values)
      console.log(
        `[brand-reference-db] distinct-work-piece iso=${isoGroup} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )
      const rows = result.rows
        .map(row => String(row.work_piece_name ?? "").trim())
        .filter(Boolean)
      traceRecommendation("db.brandReference.listDistinctWorkPieceNames:output", {
        isoGroup,
        durationMs: Date.now() - startedAt,
        rowCount: rows.length,
        preview: rows.slice(0, 6),
      })
      return rows
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      traceRecommendationError("db.brandReference.listDistinctWorkPieceNames:error", error, { query })
      console.warn(`[brand-reference-db] distinct work piece query failed: ${message}`)
      return []
    }
  },

  async listDistinctBrandNames(query: DistinctBrandQuery): Promise<string[]> {
    const pool = getPool()
    if (!pool) {
      console.warn("[brand-reference-repo] distinct brand query skipped: DB source unavailable")
      return []
    }

    const isoGroup = toNullableUpper(query.isoGroup)
    const workPieceName = String(query.workPieceName ?? "").trim()
    if (!isoGroup || !workPieceName) return []

    const limit = typeof query.limit === "number" && query.limit > 0 ? Math.min(query.limit, 50) : 20
    const sql = `
      SELECT DISTINCT brand_name
      FROM catalog_app.brand_reference
      WHERE UPPER(tag_name) = $1
        AND (
          normalized_work_piece_name = regexp_replace(UPPER($2), '[[:space:]]+', '', 'g')
          OR normalized_work_piece_name LIKE '%' || regexp_replace(UPPER($2), '[[:space:]]+', '', 'g') || '%'
          OR regexp_replace(UPPER($2), '[[:space:]]+', '', 'g') LIKE '%' || normalized_work_piece_name || '%'
        )
        AND brand_name IS NOT NULL
        AND BTRIM(brand_name) <> ''
      ORDER BY brand_name ASC
      LIMIT $3
    `

    const startedAt = Date.now()
    try {
      const values = [isoGroup, workPieceName, limit]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[brand-reference-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query(sql, values)
      console.log(
        `[brand-reference-db] distinct-brand iso=${isoGroup} workPiece=${workPieceName} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )
      return result.rows
        .map(row => String(row.brand_name ?? "").trim())
        .filter(Boolean)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[brand-reference-db] distinct brand query failed: ${message}`)
      return []
    }
  },

  async listDistinctSeriesNames(query: DistinctSeriesQuery): Promise<string[]> {
    traceRecommendation("db.brandReference.listDistinctSeriesNames:input", {
      isoGroup: query.isoGroup ?? null,
      workPieceName: query.workPieceName ?? null,
      limit: query.limit ?? null,
    })
    const pool = getPool()
    if (!pool) {
      console.warn("[brand-reference-repo] distinct series query skipped: DB source unavailable")
      return []
    }

    const isoGroup = toNullableUpper(query.isoGroup)
    const workPieceName = String(query.workPieceName ?? "").trim()
    if (!isoGroup || !workPieceName) return []

    const limit = typeof query.limit === "number" && query.limit > 0 ? Math.min(query.limit, 80) : 30
    const sql = `
      SELECT DISTINCT series_name
      FROM catalog_app.brand_reference
      WHERE UPPER(tag_name) = $1
        AND (
          normalized_work_piece_name = regexp_replace(UPPER($2), '[[:space:]]+', '', 'g')
          OR normalized_work_piece_name LIKE '%' || regexp_replace(UPPER($2), '[[:space:]]+', '', 'g') || '%'
          OR regexp_replace(UPPER($2), '[[:space:]]+', '', 'g') LIKE '%' || normalized_work_piece_name || '%'
        )
        AND series_name IS NOT NULL
        AND BTRIM(series_name) <> ''
      ORDER BY series_name ASC
      LIMIT $3
    `

    const startedAt = Date.now()
    try {
      const values = [isoGroup, workPieceName, limit]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[brand-reference-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query(sql, values)
      console.log(
        `[brand-reference-db] distinct-series iso=${isoGroup} workPiece=${workPieceName} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )
      const rows = result.rows
        .map(row => String(row.series_name ?? "").trim())
        .filter(Boolean)
      traceRecommendation("db.brandReference.listDistinctSeriesNames:output", {
        isoGroup,
        workPieceName,
        durationMs: Date.now() - startedAt,
        rowCount: rows.length,
        preview: rows.slice(0, 6),
      })
      return rows
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      traceRecommendationError("db.brandReference.listDistinctSeriesNames:error", error, { query })
      console.warn(`[brand-reference-db] distinct series query failed: ${message}`)
      return []
    }
  },

  async countProductsByWorkPiece(isoGroupRaw: string): Promise<Map<string, number>> {
    const pool = getPool()
    if (!pool) {
      console.warn("[brand-reference-repo] countProductsByWorkPiece skipped: DB source unavailable")
      return new Map()
    }

    const isoGroup = toNullableUpper(isoGroupRaw)
    if (!isoGroup) return new Map()

    const sql = `
      SELECT br.work_piece_name, COUNT(DISTINCT p.edp_no) AS product_count
      FROM catalog_app.brand_reference br
      JOIN catalog_app.product_recommendation_mv p
        ON UPPER(br.series_name) = UPPER(p.edp_series_name)
      WHERE UPPER(br.tag_name) = $1
        AND br.work_piece_name IS NOT NULL
        AND BTRIM(br.work_piece_name) <> ''
      GROUP BY br.work_piece_name
      HAVING COUNT(DISTINCT p.edp_no) > 0
      ORDER BY br.work_piece_name ASC
    `

    const startedAt = Date.now()
    try {
      const values = [isoGroup]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[brand-reference-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query(sql, values)
      console.log(
        `[brand-reference-db] countProductsByWorkPiece iso=${isoGroup} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )
      const map = new Map<string, number>()
      for (const row of result.rows) {
        const name = String(row.work_piece_name ?? "").trim()
        const count = Number(row.product_count ?? 0)
        if (name) map.set(name, count)
      }
      return map
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[brand-reference-db] countProductsByWorkPiece failed: ${message}`)
      return new Map()
    }
  },

  async findMatches(query: BrandReferenceQuery): Promise<BrandReferenceRecord[]> {
    const pool = getPool()
    if (!pool) {
      console.warn("[brand-reference-repo] query skipped: DB source unavailable")
      return []
    }

    const isoGroup = toNullableUpper(query.isoGroup)
    const workPieceQuery = String(query.workPieceQuery ?? "").trim() || null
    const hardnessMin = toNullableNumber(query.hardnessMinHrc)
    const hardnessMax = toNullableNumber(query.hardnessMaxHrc)
    const limit = typeof query.limit === "number" && query.limit > 0 ? Math.min(query.limit, 100) : 30

    const sql = `
      SELECT
        tag_name,
        work_piece_name,
        hardness_min_hrc,
        hardness_max_hrc,
        brand_name,
        source_file
      FROM catalog_app.brand_reference
      WHERE ($1::text IS NULL OR UPPER(tag_name) = $1)
        AND (
          $2::text IS NULL
          OR normalized_work_piece_name LIKE '%' || regexp_replace(UPPER($2), '[[:space:]]+', '', 'g') || '%'
        )
        AND (
          ($3::numeric IS NULL AND $4::numeric IS NULL)
          OR (
            COALESCE(hardness_max_hrc, 9999) >= COALESCE($3::numeric, -9999)
            AND COALESCE(hardness_min_hrc, -9999) <= COALESCE($4::numeric, 9999)
          )
        )
      ORDER BY
        CASE
          WHEN $2::text IS NOT NULL
            AND normalized_work_piece_name = regexp_replace(UPPER($2), '[[:space:]]+', '', 'g')
          THEN 0
          ELSE 1
        END,
        CASE WHEN hardness_min_hrc IS NULL AND hardness_max_hrc IS NULL THEN 1 ELSE 0 END,
        hardness_min_hrc ASC NULLS LAST,
        hardness_max_hrc ASC NULLS LAST,
        brand_name ASC
      LIMIT $5
    `

    const startedAt = Date.now()
    try {
      const values = [isoGroup, workPieceQuery, hardnessMin, hardnessMax, limit]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[brand-reference-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query(sql, values)
      console.log(
        `[brand-reference-db] iso=${isoGroup ?? "-"} workPiece=${workPieceQuery ?? "-"} ` +
        `hardness=${hardnessMin ?? "-"}~${hardnessMax ?? "-"} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )
      return result.rows.map(row => ({
        tagName: String(row.tag_name ?? "").trim(),
        workPieceName: String(row.work_piece_name ?? "").trim(),
        hardnessMinHrc: row.hardness_min_hrc == null ? null : Number(row.hardness_min_hrc),
        hardnessMaxHrc: row.hardness_max_hrc == null ? null : Number(row.hardness_max_hrc),
        brandName: String(row.brand_name ?? "").trim(),
        sourceFile: String(row.source_file ?? "brand_reference"),
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[brand-reference-db] query failed: ${message}`)
      return []
    }
  },
}
