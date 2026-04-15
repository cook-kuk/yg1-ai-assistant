import "server-only"

import { Pool } from "pg"

import { formatQueryValuesForLog, formatSqlForLog, interpolateSqlForLog } from "@/lib/data/sql-log"
import { getSharedPool } from "@/lib/data/shared-pool"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

/**
 * Brand × (workPieceName | ISO group) 적합도 repo.
 *
 * 소스: public.brand_material_affinity
 *   - material_kind='workpiece' : material_key ∈ {ALUMINUM, COPPER, TITANIUM, ...}, rating_score 0~100
 *   - material_kind='iso_group' : material_key ∈ {P,M,K,N,S,H}, rating_score 0~1 (낮은 해상도)
 *
 * 본 repo 는 읽기 전용. 하이브리드 retrieval 의 Stage 2 스코어 boost 용.
 */

export type BrandMaterialAffinityKind = "workpiece" | "iso_group"

export interface BrandMaterialAffinityEntry {
  brand: string            // 원본 brand (대소문자 보존)
  normalizedBrand: string  // upper + 공백/구두점 제거
  kind: BrandMaterialAffinityKind
  materialKey: string      // upper 적용 값
  rating: string | null    // EXCELLENT / GOOD / FAIR / excellent / good ... (원본 보존)
  score: number            // rating_score numeric 보존 (kind 별 스케일 상이)
}

export interface BrandMaterialAffinityQuery {
  brands: string[]
  /** 구체 피삭재명 (예: "Aluminum"). 우선순위 1. */
  workPieceName?: string | null
  /** ISO 그룹 (P/M/K/N/S/H). workPieceName 미매칭 시 fallback 으로만 사용. */
  isoGroup?: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1BrandMaterialAffinityDbPool: Pool | undefined
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

  if (!globalThis.__yg1BrandMaterialAffinityDbPool) {
    const shared = getSharedPool()
    if (shared) {
      globalThis.__yg1BrandMaterialAffinityDbPool = shared
    } else {
      console.log("[brand-material-affinity-db] creating pg pool (no shared pool)")
      globalThis.__yg1BrandMaterialAffinityDbPool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    }
  }

  return globalThis.__yg1BrandMaterialAffinityDbPool
}

export function normalizeBrandKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s\-·ㆍ./(),]+/g, "")
}

function normalizeMaterialKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase()
}

function normalizeIsoGroup(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim().toUpperCase()
  return /^[PMKNSH]$/.test(trimmed) ? trimmed : null
}

function dedupeBrands(brands: string[]): string[] {
  return Array.from(
    new Set(
      brands
        .map(value => String(value ?? "").trim())
        .filter(Boolean)
    )
  )
}

export const BrandMaterialAffinityRepo = {
  /**
   * 주어진 brands 중 (workPieceName | isoGroup) 과 매칭되는 affinity 엔트리 조회.
   * 반환: normalizedBrand → entry 맵. 미매칭 brand 는 맵에 없음 (caller 가 0 처리).
   * workPieceName 매칭이 있으면 그것을 사용, 없으면 isoGroup (material_kind='iso_group') fallback.
   */
  async findByBrands(query: BrandMaterialAffinityQuery): Promise<Map<string, BrandMaterialAffinityEntry>> {
    traceRecommendation("db.brandMaterialAffinity.findByBrands:input", {
      brandCount: query.brands.length,
      brandPreview: query.brands.slice(0, 6),
      workPieceName: query.workPieceName ?? null,
      isoGroup: query.isoGroup ?? null,
    })

    const result = new Map<string, BrandMaterialAffinityEntry>()
    const brands = dedupeBrands(query.brands)
    if (brands.length === 0) return result

    const pool = getPool()
    if (!pool) {
      console.warn("[brand-material-affinity-repo] query skipped: DB source unavailable")
      return result
    }

    const workPieceName = String(query.workPieceName ?? "").trim() || null
    const isoGroup = normalizeIsoGroup(query.isoGroup)

    if (!workPieceName && !isoGroup) return result

    // 한 번의 쿼리로 workpiece + iso_group 양쪽 모두 가져와서 app 단에서 우선순위 적용.
    const sql = `
      SELECT brand, material_kind, material_key, rating, rating_score
      FROM public.brand_material_affinity
      WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
        AND (
          (
            $2::text IS NOT NULL
            AND material_kind = 'workpiece'
            AND UPPER(BTRIM(material_key)) = UPPER(BTRIM($2))
          )
          OR (
            $3::text IS NOT NULL
            AND material_kind = 'iso_group'
            AND UPPER(BTRIM(material_key)) = $3
          )
        )
        AND UPPER(BTRIM(regexp_replace(brand, '[\\s\\-·ㆍ\\./(),]+', '', 'g'))) = ANY($1::text[])
    `

    const normalizedBrandKeys = brands.map(normalizeBrandKey).filter(Boolean)
    if (normalizedBrandKeys.length === 0) return result

    const values: [string[], string | null, string | null] = [
      normalizedBrandKeys,
      workPieceName,
      isoGroup,
    ]
    const startedAt = Date.now()

    try {
      const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
      console.log(
        `[brand-material-affinity-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`
      )
      const rows = await pool.query<{
        brand: string
        material_kind: string
        material_key: string
        rating: string | null
        rating_score: number | string | null
      }>(sql, values)

      // workpiece 우선: 같은 brand 에 대해 두 kind 가 함께 반환되면 workpiece 를 선택.
      const byBrand = new Map<string, BrandMaterialAffinityEntry>()
      for (const row of rows.rows) {
        const normBrand = normalizeBrandKey(row.brand)
        const existing = byBrand.get(normBrand)
        const kind: BrandMaterialAffinityKind = row.material_kind === "iso_group" ? "iso_group" : "workpiece"
        const entry: BrandMaterialAffinityEntry = {
          brand: row.brand,
          normalizedBrand: normBrand,
          kind,
          materialKey: normalizeMaterialKey(row.material_key),
          rating: row.rating,
          score: Number(row.rating_score) || 0,
        }
        if (!existing || (existing.kind === "iso_group" && kind === "workpiece")) {
          byBrand.set(normBrand, entry)
        }
      }

      for (const [brand, entry] of byBrand) result.set(brand, entry)

      console.log(
        `[brand-material-affinity-db] wpn=${workPieceName ?? "-"} iso=${isoGroup ?? "-"} requested=${brands.length} matched=${result.size} duration=${Date.now() - startedAt}ms`
      )
      traceRecommendation("db.brandMaterialAffinity.findByBrands:output", {
        workPieceName,
        isoGroup,
        durationMs: Date.now() - startedAt,
        matched: result.size,
        preview: Array.from(result.values()).slice(0, 6).map(e => ({
          brand: e.brand,
          kind: e.kind,
          rating: e.rating,
          score: e.score,
        })),
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      traceRecommendationError("db.brandMaterialAffinity.findByBrands:error", error, { query })
      console.warn(`[brand-material-affinity-db] query failed: ${message}`)
      return result
    }
  },
}
