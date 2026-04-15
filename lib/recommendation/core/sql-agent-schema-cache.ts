/**
 * SQL Agent Schema Cache
 * 서버 시작 시 1회 DB 스키마 로드, 1시간 캐시.
 * product_recommendation_mv 컬럼 + 샘플 값 + work_piece_statuses + 브랜드 목록.
 */

import { Pool } from "pg"
import { SCHEMA_CACHE } from "@/lib/recommendation/infrastructure/config/cache-config"
import { DB_POOL_CONFIG } from "@/lib/recommendation/infrastructure/config/runtime-config"
import { phoneticKey } from "./phonetic-match"

// ── Types ────────────────────────────────────────────────────

export interface NumericStat {
  min: number
  max: number
  /** PERCENTILE_CONT distribution representatives — LLM 이 값이 분포 어디쯤인지 판단 */
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  /** Number of distinct non-null values (for chip cardinality hints) */
  distinctCount: number
  /** Number of non-null rows (for prompt context) */
  nonNullCount: number
  /** Auto-detected distribution anomaly hint (unit mixing suspected). Null when distribution looks clean. */
  unitWarning?: string
}

export interface DbSchema {
  columns: { column_name: string; data_type: string }[]
  /**
   * Korean one-line description per column — physical meaning for LLM self-mapping.
   * Fallback map used when DB COMMENT is missing. Keys are DB column names
   * (or their MV equivalents). No hardcoded Korean→field dictionaries; this is
   * pure column semantics for the LLM to reason over.
   */
  columnDescriptions: Record<string, string>
  sampleValues: Record<string, string[]>
  /** Numeric column stats (min/max/percentile distribution) — drives range matching without hardcoded labels */
  numericStats: Record<string, NumericStat>
  /** Auxiliary tables (cutting conditions, inventory, series profile) — exposed to LLM for joins */
  auxTables: Record<string, { column_name: string; data_type: string }[]>
  /** Sample values for aux table text columns — gives LLM eyes into joinable tables */
  auxSampleValues: Record<string, Record<string, string[]>>
  /** Numeric stats for aux table numeric columns */
  auxNumericStats: Record<string, Record<string, NumericStat>>
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
  /**
   * Phonetic index: every DB value's consonant skeleton paired with its
   * original form and source column. Lets deterministic SCR catch Korean
   * transliterations (엑스파워 → X-POWER) for any column without per-field
   * hardcoded alias maps. Built once at cache load.
   */
  phoneticIndex: PhoneticEntry[]
  loadedAt: number
}

export interface PhoneticEntry {
  /** Consonant-skeleton phonetic key (≥ 3 chars) */
  key: string
  /** Original DB value (used for emit) */
  original: string
  /** MV column name (or synthetic _workPieceName / country_codes) */
  column: string
}

// ── Column Korean descriptions (fallback when DB COMMENT is missing) ─────────
// 물리적 의미 한 줄 요약 — LLM이 사용자 표현("직경/전장/절삭장/넥/코너R" 등)을
// 컬럼에 정확히 self-map 하도록 돕는다. 하드코딩 Korean→field dictionary가
// 아니라 컬럼 semantic metadata. 새 컬럼은 가능하면 DB COMMENT로 관리.
const COLUMN_KO_DESCRIPTIONS: Record<string, string> = {
  // Diameter family
  search_diameter_mm: "공구 외경(직경/지름/파이/ø) — mm",
  milling_outside_dia: "밀링 공구 외경 — mm",
  holemaking_outside_dia: "드릴/리머 외경 — mm",
  threading_outside_dia: "탭/나사 외경 — mm",
  option_dc: "외경(절삭부 직경) — mm",
  option_dcon: "샹크 직경(자루경) — mm",
  milling_shank_dia: "밀링 공구 자루경(샹크 직경) — mm",
  holemaking_shank_dia: "드릴 자루경(샹크 직경) — mm",
  threading_shank_dia: "탭 자루경(샹크 직경) — mm",
  option_shank_diameter: "자루경(샹크 직경) — mm",
  // Length family
  milling_overall_length: "전장(공구 전체 길이, OAL) — mm",
  holemaking_overall_length: "드릴 전장(OAL) — mm",
  threading_overall_length: "탭 전장(OAL) — mm",
  option_overall_length: "전장(공구 전체 길이, OAL) — mm",
  option_oal: "전장(OAL) — mm",
  milling_length_of_cut: "절삭장(날 길이, LOC) — mm",
  holemaking_flute_length: "드릴 날 길이 — mm",
  threading_thread_length: "나사 가공 길이 — mm",
  option_flute_length: "날 길이(LOC) — mm",
  option_loc: "절삭장(LOC) — mm",
  // Neck
  option_neck_diameter: "넥 직경 — mm",
  option_neck_length: "넥 길이(유효장 확보용) — mm",
  milling_neck_diameter: "밀링 넥 직경 — mm",
  milling_neck_length: "밀링 넥 길이 — mm",
  // Radii / angles
  milling_ball_radius: "볼 노즈 반경 — mm",
  option_r: "코너R(corner radius) — mm",
  option_re: "인선 반경/코너R — mm",
  milling_taper_angle: "테이퍼 각도 — °",
  option_taperangle: "테이퍼 각도 — °",
  milling_helix_angle: "헬릭스(나선) 각도 — °",
  holemaking_helix_angle: "드릴 헬릭스 각도 — °",
  holemaking_point_angle: "드릴 포인트 각도 — °",
  option_pointangle: "포인트 각도 — °",
  // Thread
  threading_pitch: "나사 피치 — mm",
  option_pitch: "나사 피치 — mm",
  threading_tpi: "인치당 나사산 수(TPI)",
  option_tpi: "인치당 나사산 수(TPI)",
  // Flute / coolant
  milling_flutes: "밀링 날 수",
  holemaking_flutes: "드릴 날 수",
  option_flutecount: "날 수",
  milling_coolant_hole: "쿨런트 홀(내부 냉각 구멍) 유무",
  holemaking_coolant_hole: "쿨런트 홀 유무",
  threading_coolant_hole: "쿨런트 홀 유무",
  option_coolanthole: "쿨런트 홀 유무",
  // Attributes
  coating: "표면 코팅 (TiAlN/AlCrN/DLC/Y-Coating 등)",
  search_coating: "코팅 (검색용 정규화)",
  tool_material: "공구 모재 (Carbide/HSS/PCD/Diamond 등)",
  edp_brand_name: "브랜드명",
  series_name: "시리즈명",
  tool_subtype: "공구 세부 형상 (Ball/Square/Radius/Taper/Chamfer/Roughing/High-Feed)",
  machining_category: "가공 카테고리 (Milling/Holemaking/Threading)",
}

// ── Cache ────────────────────────────────────────────────────
// TTL 은 cache-config.ts 에서 관리 (SCHEMA_CACHE.ttlMs, 기본 1시간).

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

  return new Pool({
    connectionString: connStr,
    max: DB_POOL_CONFIG.max,
    idleTimeoutMillis: DB_POOL_CONFIG.idleTimeoutMs,
    connectionTimeoutMillis: DB_POOL_CONFIG.connectionTimeoutMs,
  })
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1ProductDbPool: Pool | undefined
}

// ── Public API ───────────────────────────────────────────────

export async function getDbSchema(): Promise<DbSchema> {
  if (cached && Date.now() - cached.loadedAt < SCHEMA_CACHE.ttlMs) return cached

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

  // 2b. Numeric column stats — min/max + percentile distribution.
  // 이전엔 "ORDER BY col LIMIT 12" 로 최저값만 샘플링해서 LLM이 범위 오판(최저값 12개만 보고
  // 정상 범위 값을 이상치로 거부)하는 구조적 버그가 있었음. 이제 PERCENTILE_CONT 로 분포
  // 대표값을 뽑아 어떤 컬럼이든 일관된 스케일 정보 제공.
  const numericCols = columns
    .filter(c => /int|numeric|double|real|decimal|float/i.test(c.data_type))
    .map(c => c.column_name)

  const numericStats: Record<string, NumericStat> = {}
  for (const col of numericCols) {
    try {
      const res = await pool.query<{
        mn: number | null; mx: number | null
        p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null
        nn: string | null; dc: string | null
      }>(
        `SELECT
           MIN(${quoteIdent(col)})::float8 AS mn,
           MAX(${quoteIdent(col)})::float8 AS mx,
           PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY ${quoteIdent(col)}::float8) AS p10,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${quoteIdent(col)}::float8) AS p25,
           PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${quoteIdent(col)}::float8) AS p50,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${quoteIdent(col)}::float8) AS p75,
           PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${quoteIdent(col)}::float8) AS p90,
           COUNT(*) FILTER (WHERE ${quoteIdent(col)} IS NOT NULL) AS nn,
           COUNT(DISTINCT ${quoteIdent(col)}) AS dc
         FROM catalog_app.product_recommendation_mv
         WHERE ${quoteIdent(col)} IS NOT NULL`
      )
      const row = res.rows[0]
      if (!row || row.mn == null || row.mx == null) continue
      numericStats[col] = buildNumericStat({
        min: Number(row.mn), max: Number(row.mx),
        p10: Number(row.p10), p25: Number(row.p25), p50: Number(row.p50), p75: Number(row.p75), p90: Number(row.p90),
        nonNullCount: Number(row.nn ?? 0), distinctCount: Number(row.dc ?? 0),
      })
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
  const auxSampleValues: Record<string, Record<string, string[]>> = {}
  const auxNumericStats: Record<string, Record<string, NumericStat>> = {}
  for (const t of AUX_TABLE_TARGETS) {
    try {
      const auxRes = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [t.schema, t.table],
      )
      if (auxRes.rows.length === 0) continue
      auxTables[t.alias] = auxRes.rows

      const fq = `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`
      const samples: Record<string, string[]> = {}
      const nstats: Record<string, NumericStat> = {}

      for (const c of auxRes.rows) {
        const isText = /character|text/i.test(c.data_type)
        const isNum = /int|numeric|double|real|decimal|float/i.test(c.data_type)
        if (isText) {
          try {
            const r = await pool.query<{ v: string }>(
              `SELECT DISTINCT ${quoteIdent(c.column_name)}::text AS v
               FROM ${fq}
               WHERE ${quoteIdent(c.column_name)} IS NOT NULL
                 AND BTRIM(${quoteIdent(c.column_name)}::text) <> ''
                 AND length(${quoteIdent(c.column_name)}::text) <= 64
               ORDER BY v LIMIT 80`,
            )
            if (r.rows.length > 0) samples[c.column_name] = r.rows.map(x => x.v)
          } catch { /* skip */ }
        } else if (isNum) {
          try {
            const r = await pool.query<{
              mn: number | null; mx: number | null
              p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null
              nn: string | null; dc: string | null
            }>(
              `SELECT
                 MIN(${quoteIdent(c.column_name)})::float8 AS mn,
                 MAX(${quoteIdent(c.column_name)})::float8 AS mx,
                 PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY ${quoteIdent(c.column_name)}::float8) AS p10,
                 PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${quoteIdent(c.column_name)}::float8) AS p25,
                 PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${quoteIdent(c.column_name)}::float8) AS p50,
                 PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${quoteIdent(c.column_name)}::float8) AS p75,
                 PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${quoteIdent(c.column_name)}::float8) AS p90,
                 COUNT(*) FILTER (WHERE ${quoteIdent(c.column_name)} IS NOT NULL) AS nn,
                 COUNT(DISTINCT ${quoteIdent(c.column_name)}) AS dc
               FROM ${fq}
               WHERE ${quoteIdent(c.column_name)} IS NOT NULL`,
            )
            const row = r.rows[0]
            if (!row || row.mn == null || row.mx == null) continue
            nstats[c.column_name] = buildNumericStat({
              min: Number(row.mn), max: Number(row.mx),
              p10: Number(row.p10), p25: Number(row.p25), p50: Number(row.p50), p75: Number(row.p75), p90: Number(row.p90),
              nonNullCount: Number(row.nn ?? 0), distinctCount: Number(row.dc ?? 0),
            })
          } catch { /* skip */ }
        }
      }
      if (Object.keys(samples).length > 0) auxSampleValues[t.alias] = samples
      if (Object.keys(nstats).length > 0) auxNumericStats[t.alias] = nstats
    } catch { /* table may not exist in this env */ }
  }

  // 7. Build value→column reverse index for unqualified-token routing.
  const valueIndex = buildValueIndex({ sampleValues, brands, countries, workpieces })

  // 8. Phonetic index — consonant-skeleton keys for all DB values, enables
  // Korean transliteration matching across every column without hardcoded
  // alias maps.
  const phoneticIndex = buildPhoneticIndex({ sampleValues, brands, countries, workpieces })

  // Column Korean descriptions — fallback map (no DB COMMENT read yet).
  // 실제 MV 에 없는 phantom 키는 자동 skip + drift 경고. 스키마가 바뀌어도 이 map 은 drift 안 남음.
  const actualColSet = new Set(columns.map(c => c.column_name))
  const columnDescriptions: Record<string, string> = {}
  const phantomHintKeys: string[] = []
  for (const [key, desc] of Object.entries(COLUMN_KO_DESCRIPTIONS)) {
    if (actualColSet.has(key)) columnDescriptions[key] = desc
    else phantomHintKeys.push(key)
  }
  if (phantomHintKeys.length > 0) {
    console.log(`[schema-cache] skipped ${phantomHintKeys.length} orphan column descriptions: ${phantomHintKeys.join(", ")}`)
  }

  cached = { columns, columnDescriptions, sampleValues, numericStats, auxTables, auxSampleValues, auxNumericStats, workpieces, brands, countries, valueIndex, phoneticIndex, loadedAt: Date.now() }
  const auxSampleCount = Object.values(auxSampleValues).reduce((n, m) => n + Object.keys(m).length, 0)
  const auxNumCount = Object.values(auxNumericStats).reduce((n, m) => n + Object.keys(m).length, 0)
  console.log(`[sql-agent-schema] loaded: ${columns.length} cols, ${Object.keys(sampleValues).length} text-sampled, ${Object.keys(numericStats).length} numeric-sampled, ${Object.keys(auxTables).length} aux tables (${auxSampleCount} aux text-sampled, ${auxNumCount} aux numeric-sampled), ${workpieces.length} wp, ${brands.length} brands, ${countries.length} countries, ${Object.keys(valueIndex).length} indexed, ${phoneticIndex.length} phonetic`)
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
  if (cached && Date.now() - cached.loadedAt < SCHEMA_CACHE.ttlMs) return cached
  return null
}

// ── Helpers ──────────────────────────────────────────────────

function quoteIdent(name: string): string {
  // simple identifier quoting — prevents SQL injection in column names
  return `"${name.replace(/"/g, '""')}"`
}

// ── Numeric stat helpers ─────────────────────────────────────

function roundStat(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n
}

/**
 * Normalize percentile row + run unit-mix detection. Centralizes the shape so
 * main MV loop and aux-table loop share identical behavior.
 */
function buildNumericStat(row: {
  min: number; max: number
  p10: number; p25: number; p50: number; p75: number; p90: number
  nonNullCount: number; distinctCount: number
}): NumericStat {
  const stat: NumericStat = {
    min: roundStat(row.min), max: roundStat(row.max),
    p10: roundStat(row.p10), p25: roundStat(row.p25), p50: roundStat(row.p50),
    p75: roundStat(row.p75), p90: roundStat(row.p90),
    nonNullCount: row.nonNullCount, distinctCount: row.distinctCount,
  }
  const warn = detectUnitMix(stat)
  if (warn) stat.unitWarning = warn
  return stat
}

/**
 * Auto-detect distribution anomalies suggesting unit mixing (e.g., mm vs inch
 * stored in the same column). Column-agnostic — any numeric column that trips
 * any condition gets a warning. No hardcoded column list.
 */
function detectUnitMix(s: NumericStat): string | null {
  const reasons: string[] = []
  const { min, max, p10, p90 } = s
  if (min > 0 && Number.isFinite(max / min) && max / min > 1000) {
    reasons.push("max/min>1000")
  }
  if (p10 > 0 && Number.isFinite(p90 / p10) && p90 / p10 > 100) {
    reasons.push("p90/p10>100")
  }
  if (p90 > 0 && Number.isFinite(max / p90) && max / p90 > 10) {
    reasons.push("max/p90>10 (극단 아웃라이어)")
  }
  if (p10 > 0 && p10 < 1 && p90 > 10) {
    reasons.push("0~1 범위와 10+ 범위 값 공존")
  }
  if (reasons.length === 0) return null
  return `⚠️ inch/mm 혼입 의심 (${reasons.join(", ")}). 사용자 값은 mm 기준으로 해석.`
}

/**
 * Full distribution line for main schema prompts.
 * Format: "  col: min=X max=Y 분포(p10/p25/p50/p75/p90)=[a/b/c/d/e] 고유값N개 총M행 [unitWarning]"
 */
export function formatNumericStatsLine(col: string, s: NumericStat): string {
  const dist = `${s.p10}/${s.p25}/${s.p50}/${s.p75}/${s.p90}`
  const warn = s.unitWarning ? ` ${s.unitWarning}` : ""
  return `  ${col}: min=${s.min} max=${s.max} 분포(p10/p25/p50/p75/p90)=[${dist}] 고유값${s.distinctCount}개 총${s.nonNullCount}행${warn}`
}

/**
 * Compact distribution line for resolver/fallback prompts (tighter token budget).
 * Format: "- col (min~max, p50=X)[ unitWarning]"
 */
export function formatNumericStatsCompact(col: string, s: NumericStat): string {
  const warn = s.unitWarning ? ` ${s.unitWarning}` : ""
  return `- ${col} (${s.min}~${s.max}, p50=${s.p50}, 고유${s.distinctCount})${warn}`
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

// ── Phonetic index helpers ───────────────────────────────────

function buildPhoneticIndex(args: {
  sampleValues: Record<string, string[]>
  brands: string[]
  countries: string[]
  workpieces: { tag_name: string; normalized_work_piece_name: string }[]
}): PhoneticEntry[] {
  const out: PhoneticEntry[] = []
  const dedupe = new Set<string>()

  function add(value: string, column: string): void {
    const v = (value ?? "").trim()
    if (!v || v.length < 2) return
    if (/^-?\d+(?:\.\d+)?$/.test(v)) return // pure number
    const key = phoneticKey(v)
    // Min 3 to limit false positives — 2-char skeletons are too generic.
    if (!key || key.length < 3) return
    const dedupeKey = `${column}::${key}::${v.toLowerCase()}`
    if (dedupe.has(dedupeKey)) return
    dedupe.add(dedupeKey)
    out.push({ key, original: v, column })
  }

  for (const [col, values] of Object.entries(args.sampleValues)) {
    for (const v of values) add(v, col)
  }
  for (const b of args.brands) add(b, "edp_brand_name")
  for (const c of args.countries) add(c, "country_codes")
  for (const wp of args.workpieces) {
    add(wp.tag_name, "_workPieceName")
    add(wp.normalized_work_piece_name, "_workPieceName")
  }
  return out
}

export interface PhoneticMatch {
  column: string
  value: string
  similarity: number
  /** The user input token that produced the match */
  matchedToken: string
}

/**
 * Find the best phonetic match for any token inside `text` against the
 * full DB phonetic index. Sync, no DB call. Returns null if cache cold or
 * no token clears the threshold.
 *
 * Strategy: tokenize on whitespace + Korean particles, romanize each token,
 * compare against the phonetic index using length-aware containment +
 * similarity scoring. Prefers longer + more specific matches to reduce
 * false positives.
 */
export function findValueByPhonetic(text: string, threshold = 0.85): PhoneticMatch | null {
  if (!cached || cached.phoneticIndex.length === 0) return null
  if (!text) return null

  // Tokenize: split on whitespace and Korean particles to isolate brand-like
  // chunks. Particles like 으로/로/는/은/이/가/을/를 are stripped from token tails.
  const tokens = text
    .split(/[\s,.\/\-()[\]]+/)
    .map(t => t.replace(/(?:으로|로|은|는|이|가|을|를|의|에|에서|만)$/u, ""))
    .filter(t => t.length >= 2)

  let best: PhoneticMatch | null = null

  for (const tok of tokens) {
    const tokKey = phoneticKey(tok)
    if (!tokKey || tokKey.length < 3) continue

    for (const entry of cached.phoneticIndex) {
      // Containment in either direction (handles user typing more/less than
      // the canonical brand)
      const a = tokKey
      const b = entry.key
      let sim = 0
      if (a === b) {
        sim = 1
      } else if (a.includes(b)) {
        sim = b.length / a.length
      } else if (b.includes(a)) {
        sim = a.length / b.length
      } else {
        // Cheap prefix similarity for near-matches
        let common = 0
        const lim = Math.min(a.length, b.length)
        for (let i = 0; i < lim && a[i] === b[i]; i++) common++
        if (common >= 3) sim = common / Math.max(a.length, b.length)
      }

      if (sim >= threshold && (!best || sim > best.similarity || (sim === best.similarity && entry.key.length > (best ? phoneticKey(best.value).length : 0)))) {
        best = { column: entry.column, value: entry.original, similarity: sim, matchedToken: tok }
      }
    }
  }

  return best
}
