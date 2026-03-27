import "server-only"

import { Pool } from "pg"

import { formatQueryValuesForLog, formatSqlForLog, interpolateSqlForLog } from "@/lib/data/sql-log"
import { getSharedPool } from "@/lib/data/shared-pool"

export type SeriesMaterialRating = "EXCELLENT" | "GOOD" | "NULL"
export interface SeriesMaterialStatusValue {
  rating: SeriesMaterialRating
  score: number
}

export interface SeriesMaterialStatusQuery {
  isoGroup: string
  seriesNames: string[]
  workPieceName?: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1SeriesMaterialStatusDbPool: Pool | undefined
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

  if (!globalThis.__yg1SeriesMaterialStatusDbPool) {
    const shared = getSharedPool()
    if (shared) {
      globalThis.__yg1SeriesMaterialStatusDbPool = shared
    } else {
      console.log("[series-material-status-db] creating pg pool (no shared pool)")
      globalThis.__yg1SeriesMaterialStatusDbPool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    }
  }

  return globalThis.__yg1SeriesMaterialStatusDbPool
}

function normalizeSeriesNames(seriesNames: string[]): string[] {
  return Array.from(
    new Set(
      seriesNames
        .map(value => String(value ?? "").trim())
        .filter(Boolean)
    )
  )
}

function normalizeSeriesName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-·ㆍ./(),]+/g, "")
}

function normalizeIsoGroup(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim().toUpperCase()
  return /^[PMKNSH]$/.test(trimmed) ? trimmed : null
}

function normalizeRating(value: string | null | undefined): SeriesMaterialRating {
  const normalized = String(value ?? "").trim().toUpperCase()
  if (normalized === "EXCELLENT") return "EXCELLENT"
  if (normalized === "GOOD") return "GOOD"
  return "NULL"
}

export const SeriesMaterialStatusRepo = {
  async findRatingsBySeries(query: SeriesMaterialStatusQuery): Promise<Map<string, SeriesMaterialStatusValue>> {
    const pool = getPool()
    if (!pool) {
      console.warn("[series-material-status-repo] query skipped: DB source unavailable")
      return new Map()
    }

    const isoGroup = normalizeIsoGroup(query.isoGroup)
    const seriesNames = normalizeSeriesNames(query.seriesNames)
    const workPieceName = String(query.workPieceName ?? "").trim() || null

    if (!isoGroup || seriesNames.length === 0) return new Map()

    const sql = `
      WITH requested_series AS (
        SELECT DISTINCT NULLIF(
          regexp_replace(UPPER(BTRIM(series_name)), '[\\s\\-·ㆍ\\./(),]+', '', 'g'),
          ''
        ) AS normalized_series
        FROM unnest($1::text[]) AS series_name
        WHERE BTRIM(series_name) <> ''
      ),
      ranked AS (
        SELECT
          sp.normalized_series_name,
          status_row.material_rating,
          status_row.material_rating_score,
          ROW_NUMBER() OVER (
            PARTITION BY sp.normalized_series_name
            ORDER BY
              CASE
                WHEN $3::text IS NOT NULL
                  AND status_row.normalized_work_piece_name = NULLIF(regexp_replace(UPPER(BTRIM($3)), '\\s+', '', 'g'), '')
                THEN 0
                ELSE 1
              END ASC,
              status_row.material_rating_score DESC,
              status_row.work_piece_name ASC NULLS LAST
          ) AS row_rank
        FROM catalog_app.series_profile_mv sp
        CROSS JOIN LATERAL jsonb_to_recordset(COALESCE(sp.work_piece_statuses, '[]'::jsonb)) AS status_row(
          tag_name text,
          work_piece_name text,
          normalized_work_piece_name text,
          status text,
          material_rating text,
          material_rating_score integer
        )
        WHERE sp.normalized_series_name IN (
          SELECT normalized_series
          FROM requested_series
          WHERE normalized_series IS NOT NULL
        )
          AND status_row.tag_name = $2
      )
      SELECT
        normalized_series_name,
        material_rating,
        material_rating_score
      FROM ranked
      WHERE row_rank = 1
    `

    const startedAt = Date.now()
    try {
      const values = [seriesNames, isoGroup, workPieceName]
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(`[series-material-status-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
      const result = await pool.query<{
        normalized_series_name: string
        material_rating: string
        material_rating_score: number | string
      }>(sql, values)
      console.log(
        `[series-material-status-db] iso=${isoGroup} workPiece=${workPieceName ?? "-"} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`
      )

      return new Map(
        result.rows.map(row => [
          normalizeSeriesName(row.normalized_series_name),
          {
            rating: normalizeRating(row.material_rating),
            score: Number(row.material_rating_score) || 1,
          },
        ])
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[series-material-status-db] query failed: ${message}`)
      return new Map()
    }
  },
}
