/**
 * SQL Agent Schema Cache
 * 서버 시작 시 1회 DB 스키마 로드, 1시간 캐시.
 * product_recommendation_mv 컬럼 + 샘플 값 + work_piece_statuses + 브랜드 목록.
 */

import fs from "fs"
import path from "path"
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
  /**
   * Brand ↔ ISO material group (P/M/K/N/S/H) 적합도 rating.
   * 소스: public.brand_material_affinity (rating_score DESC).
   * LLM 프롬프트 주입용 — 동일 후보 세트에서 brand ranking 힌트, hard filter 아님.
   */
  brandAffinity: Record<string, Array<{ brand: string; rating: string | null; score: number }>>
  /**
   * 시리즈별 × ISO그룹별 절삭조건 range(Vc/n/fz/vf/ap/ae).
   * 소스: data/normalized/evidence-chunks.json (13k+ chunks, raw_catalog.cutting_condition_table + PDF).
   * LLM 프롬프트 주입용 — rpm/이송/절삭속도 질의 시 실제 범위를 LLM 이 알 수 있게.
   */
  cuttingConditionSummary: Record<string, {
    isoGroups: Record<string, {
      Vc?: { min: number; max: number; count: number }
      n?: { min: number; max: number; count: number }
      fz?: { min: number; max: number; count: number }
      vf?: { min: number; max: number; count: number }
      ap?: { min: number; max: number; count: number }
      ae?: { min: number; max: number; count: number }
    }>
  }>
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
  // ── 식별자 / 기본 정보 ────────────────────────────────────────
  edp_idx: "EDP 내부 ID (PK)",
  edp_no: "EDP 번호 (제품 코드) — 브랜드별 유일",
  edp_brand_name: "브랜드명",
  edp_series_name: "시리즈명",
  edp_series_idx: "시리즈 내부 ID",
  edp_root_category: "최상위 가공 카테고리 (Milling/Holemaking/Threading/Tooling/Turning)",
  edp_unit: "치수 단위 (mm/inch)",
  normalized_code: "EDP 정규화 코드 (공백/하이픈 제거, 대문자)",

  // ── 시리즈 메타 ──────────────────────────────────────────────
  series_row_idx: "시리즈 row ID",
  series_brand_name: "시리즈 브랜드명",
  series_description: "시리즈 설명",
  series_feature: "시리즈 특징/feature",
  series_tool_type: "시리즈 공구 세부 형상 (End Mill/Drill/Tap 등)",
  series_product_type: "시리즈 제품 타입",
  series_application_shape: "시리즈 가공 용도 (Slotting/Profiling/Drilling 등)",
  series_cutting_edge_shape: "시리즈 절삭날 형상 (Ball/Square/Radius/Taper/Chamfer)",
  series_shank_type: "시리즈 샹크 타입 (Straight/HSK/BT)",

  // ── 국가 / 피삭재 ────────────────────────────────────────────
  country: "판매 가능 국가 (콤마 구분)",
  country_codes: "판매 가능 국가 코드 배열",
  material_tags: "적용 피삭재 ISO 코드 배열 (P/M/K/N/S/H)",

  // ── 직경 family ──────────────────────────────────────────────
  search_diameter_mm: "공구 외경(직경/지름/파이/ø) — mm, 통합 검색용",
  milling_outside_dia: "밀링 공구 외경 — mm",
  holemaking_outside_dia: "드릴/리머 외경 — mm",
  threading_outside_dia: "탭/나사 외경 — mm",
  option_dc: "외경(절삭부 직경) — mm",
  option_dcon: "샹크 직경(자루경) — mm",
  option_d: "외경/직경 — mm",
  option_d1: "외경/직경(d1) — mm",
  option_drill_diameter: "드릴 직경 — mm",
  option_shank_diameter: "자루경(샹크 직경) — mm",
  milling_shank_dia: "밀링 공구 자루경(샹크 직경) — mm",
  holemaking_shank_dia: "드릴 자루경(샹크 직경) — mm",
  threading_shank_dia: "탭 자루경(샹크 직경) — mm",

  // ── 길이 family ──────────────────────────────────────────────
  milling_overall_length: "전장(공구 전체 길이, OAL) — mm",
  holemaking_overall_length: "드릴 전장(OAL) — mm",
  threading_overall_length: "탭 전장(OAL) — mm",
  option_overall_length: "전장(공구 전체 길이, OAL) — mm",
  option_oal: "전장(OAL) — mm",
  milling_length_of_cut: "절삭장(날 길이, LOC) — mm",
  milling_effective_length: "밀링 유효장(effective length) — mm",
  holemaking_flute_length: "드릴 날 길이 — mm",
  holemaking_length_below_shank: "샹크 아래 돌출 길이 — mm",
  threading_thread_length: "나사 가공 길이 — mm",
  threading_l3: "탭 L3 길이 — mm",
  tooling_back_bore_l3: "툴링 back-bore L3 — mm",
  option_flute_length: "날 길이(LOC) — mm",
  option_loc: "절삭장(LOC) — mm",

  // ── 넥 ──────────────────────────────────────────────────────
  milling_neck_diameter: "밀링 넥 직경 — mm",

  // ── 반경 / 각도 ──────────────────────────────────────────────
  milling_ball_radius: "볼 노즈 반경 — mm",
  option_r: "코너R(corner radius) — mm",
  option_re: "인선 반경/코너R — mm",
  milling_taper_angle: "테이퍼 각도 — °",
  option_taperangle: "테이퍼 각도 — °",
  milling_helix_angle: "헬릭스(나선) 각도 — °",
  holemaking_helix_angle: "드릴 헬릭스 각도 — °",
  holemaking_taper_angle: "드릴 테이퍼 각도 — °",
  holemaking_point_angle: "드릴 포인트 각도 — °",

  // ── 나사 ────────────────────────────────────────────────────
  threading_pitch: "나사 피치 — mm",
  threading_tpi: "인치당 나사산 수(TPI)",

  // ── 날 수 / 쿨런트 ──────────────────────────────────────────
  option_z: "날 수 (Z)",
  option_numberofflute: "날 수",
  milling_number_of_flute: "밀링 날 수",
  holemaking_number_of_flute: "드릴 날 수",
  threading_number_of_flute: "탭 날 수",
  milling_coolant_hole: "쿨런트 홀(내부 냉각 구멍) 유무",
  holemaking_coolant_hole: "쿨런트 홀 유무",
  threading_coolant_hole: "쿨런트 홀 유무",
  option_coolanthole: "쿨런트 홀 유무",

  // ── 공차 ────────────────────────────────────────────────────
  option_tolofmilldia: "밀링 외경 공차",
  option_tolofshankdia: "밀링 샹크 공차",
  milling_diameter_tolerance: "밀링 외경 공차",
  milling_shank_diameter_tolerance: "밀링 샹크 공차",
  holemaking_diameter_tolerance: "드릴 외경 공차",
  holemaking_shank_diameter_tolerance: "드릴 샹크 공차",

  // ── 코팅 / 모재 / 형상 ───────────────────────────────────────
  search_coating: "코팅 (통합 검색용 정규화)",
  milling_coating: "밀링 코팅",
  holemaking_coating: "드릴 코팅",
  threading_coating: "탭 코팅",
  milling_tool_material: "밀링 공구 모재 (Carbide/HSS/PCD/Diamond)",
  holemaking_tool_material: "드릴 공구 모재",
  threading_tool_material: "탭 공구 모재",
  milling_shank_type: "밀링 샹크 타입",
  tooling_shank_type: "툴링 샹크 타입",
  search_shank_type: "샹크 타입 (통합 검색용 정규화)",
  search_subtype: "공구 세부 형상 (통합 검색용: Ball/Square/Radius/Taper/Chamfer)",
  milling_cutting_edge_shape: "밀링 절삭날 형상",
  milling_cutter_shape: "밀링 커터 형상",
  threading_flute_type: "탭 flute 타입",
  threading_thread_shape: "나사 형상",

  // ── 정규화 컬럼 (UPPER+TRIM SSOT, LLM 매칭용) ──────────────────
  norm_brand: "브랜드명 (대문자+trim 정규화)",
  norm_coating: "코팅 (대문자+trim 정규화)",
  norm_cutting_edge: "절삭날/커터 형상 (대문자+trim 정규화)",
  norm_application: "가공 용도 (대문자+trim 정규화)",
  norm_shank_type: "샹크 타입 (대문자+trim 정규화)",
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
  //
  // 추가: MV 컬럼 대부분이 text 로 저장된 "numeric-as-text"(전장/날장/넥경/코너R 등).
  // data_type 만으로 필터하면 search_diameter_mm 1개만 남음. 따라서 모든 컬럼을
  // 통합 쿼리(regex + CAST)로 샘플링 후, 80% 이상이 숫자로 파싱되면 numericStats 에 포함.
  const numericCandidates = columns
    .filter(c => !/jsonb|bytea|uuid|timestamp|date|time|bool/i.test(c.data_type))
    .map(c => c.column_name)

  const numericStats: Record<string, NumericStat> = {}
  for (const col of numericCandidates) {
    try {
      const stat = await queryNumericStats(pool, "catalog_app.product_recommendation_mv", col)
      if (stat) numericStats[col] = stat
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
    { schema: "catalog_app", table: "inventory_snapshot", alias: "catalog_app.inventory_snapshot" },
    { schema: "catalog_app", table: "series_profile_mv", alias: "catalog_app.series_profile_mv" },
    // Part 6: 브랜드-피삭재 적합도 — LLM 프롬프트 주입으로 ranking 힌트 (hard filter 아님)
    { schema: "public", table: "brand_material_affinity", alias: "public.brand_material_affinity" },
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
        const skipType = /jsonb|bytea|uuid|timestamp|date|time|bool/i.test(c.data_type)
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
        }
        if (!skipType) {
          try {
            const stat = await queryNumericStats(pool, fq, c.column_name)
            if (stat) nstats[c.column_name] = stat
          } catch { /* skip */ }
        }
      }
      if (Object.keys(samples).length > 0) auxSampleValues[t.alias] = samples
      if (Object.keys(nstats).length > 0) auxNumericStats[t.alias] = nstats
    } catch { /* table may not exist in this env */ }
  }

  // 6b. Brand ↔ ISO material affinity matrix — top brands per ISO code by rating_score.
  const brandAffinity: Record<string, Array<{ brand: string; rating: string | null; score: number }>> = {}
  try {
    const affRes = await pool.query<{ material_key: string; brand: string; rating: string | null; rating_score: number | null }>(`
      SELECT material_key, brand, rating, rating_score
      FROM public.brand_material_affinity
      WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
        AND material_key IS NOT NULL AND BTRIM(material_key) <> ''
      ORDER BY material_key, rating_score DESC NULLS LAST, brand
    `)
    for (const r of affRes.rows) {
      const key = String(r.material_key).toUpperCase().trim()
      if (!brandAffinity[key]) brandAffinity[key] = []
      brandAffinity[key].push({ brand: r.brand, rating: r.rating, score: Number(r.rating_score ?? 0) })
    }
  } catch { /* table may not exist — silently skip */ }

  // 6c. Cutting condition summary per series × ISO group — loaded from evidence-chunks.json.
  // Sourced from DB raw_catalog.cutting_condition_table + PDF corpus (13k+ chunks).
  // LLM 프롬프트에 주입되어 rpm/이송/Vc 질의 시 실제 범위를 참조하게 한다.
  const cuttingConditionSummary = loadCuttingConditionSummary()

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

  cached = { columns, columnDescriptions, sampleValues, numericStats, auxTables, auxSampleValues, auxNumericStats, brandAffinity, cuttingConditionSummary, workpieces, brands, countries, valueIndex, phoneticIndex, loadedAt: Date.now() }
  const auxSampleCount = Object.values(auxSampleValues).reduce((n, m) => n + Object.keys(m).length, 0)
  const auxNumCount = Object.values(auxNumericStats).reduce((n, m) => n + Object.keys(m).length, 0)
  const ccSeriesCount = Object.keys(cuttingConditionSummary).length
  console.log(`[sql-agent-schema] loaded: ${columns.length} cols, ${Object.keys(sampleValues).length} text-sampled, ${Object.keys(numericStats).length} numeric-sampled, ${Object.keys(auxTables).length} aux tables (${auxSampleCount} aux text-sampled, ${auxNumCount} aux numeric-sampled), ${workpieces.length} wp, ${brands.length} brands, ${countries.length} countries, ${ccSeriesCount} cc-series, ${Object.keys(valueIndex).length} indexed, ${phoneticIndex.length} phonetic`)
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

// ── Cutting condition summary loader ─────────────────────────

interface RawEvidenceChunk {
  seriesName: string | null
  isoGroup: string | null
  conditions?: {
    Vc?: string | null; n?: string | null; fz?: string | null
    vf?: string | null; ap?: string | null; ae?: string | null
  }
}

let _ccSummaryCache: DbSchema["cuttingConditionSummary"] | null = null

function loadCuttingConditionSummary(): DbSchema["cuttingConditionSummary"] {
  if (_ccSummaryCache) return _ccSummaryCache
  const filePath = path.join(process.cwd(), "data", "normalized", "evidence-chunks.json")
  if (!fs.existsSync(filePath)) {
    console.warn("[sql-agent-schema] evidence-chunks.json not found — cuttingConditionSummary empty")
    _ccSummaryCache = {}
    return _ccSummaryCache
  }
  let chunks: RawEvidenceChunk[] = []
  try {
    chunks = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RawEvidenceChunk[]
  } catch (err) {
    console.warn(`[sql-agent-schema] evidence-chunks.json parse failed: ${err instanceof Error ? err.message : err}`)
    _ccSummaryCache = {}
    return _ccSummaryCache
  }

  const parseNum = (v: string | null | undefined): number | null => {
    if (v == null) return null
    const m = String(v).match(/-?\d+(?:\.\d+)?/)
    if (!m) return null
    const n = Number.parseFloat(m[0])
    return Number.isFinite(n) && n > 0 ? n : null
  }

  type Range = { min: number; max: number; count: number }
  const agg: Record<string, Record<string, Record<string, Range>>> = {}

  for (const c of chunks) {
    const series = (c.seriesName ?? "").trim()
    if (!series) continue
    const iso = (c.isoGroup ?? "").trim().toUpperCase() || "?"
    const cond = c.conditions ?? {}
    const keys: Array<keyof typeof cond> = ["Vc", "n", "fz", "vf", "ap", "ae"]
    if (!agg[series]) agg[series] = {}
    if (!agg[series][iso]) agg[series][iso] = {}
    for (const k of keys) {
      const n = parseNum(cond[k] ?? null)
      if (n == null) continue
      const slot = agg[series][iso]
      const prev = slot[k]
      if (!prev) slot[k] = { min: n, max: n, count: 1 }
      else {
        if (n < prev.min) prev.min = n
        if (n > prev.max) prev.max = n
        prev.count++
      }
    }
  }

  const out: DbSchema["cuttingConditionSummary"] = {}
  for (const series of Object.keys(agg)) {
    const iso = agg[series]
    const isoGroups: Record<string, Record<string, Range>> = {}
    for (const g of Object.keys(iso)) {
      const slot = iso[g]
      if (Object.keys(slot).length === 0) continue
      isoGroups[g] = slot
    }
    if (Object.keys(isoGroups).length > 0) {
      out[series] = { isoGroups: isoGroups as DbSchema["cuttingConditionSummary"][string]["isoGroups"] }
    }
  }
  _ccSummaryCache = out
  return out
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
 * Regex for PG `~` that accepts signed integers and decimals (no thousands separator).
 * Kept identical to the SQL literal so DB detection and JS-side validation agree.
 */
const NUMERIC_RE_SQL = String.raw`^-?[0-9]*\.?[0-9]+$`

/**
 * Query MIN/MAX/percentile/distinct-count for `col` in `tableFq`.
 *  - Works on both numeric and text columns (text stored as numeric-looking strings).
 *  - Filters rows by `col::text ~ '^-?[0-9]*\.?[0-9]+$'` so non-numeric text noise
 *    (e.g. "N/A", "TiAlN", "Cemented Carbide") is excluded.
 *  - Requires ≥ 80% of non-empty values to parse as numeric — otherwise returns null
 *    (treat the column as text, not a numeric distribution).
 *    Loosened from 90% → 80% to include more numeric-dominant columns with
 *    occasional text noise (e.g. "Multi Flute" mixed into flute-count fields).
 *  - Single round-trip per column to keep boot cost bounded.
 */
async function queryNumericStats(
  pool: Pool,
  tableFq: string,
  col: string,
): Promise<NumericStat | null> {
  const qCol = quoteIdent(col)
  const qColText = `${qCol}::text`
  const res = await pool.query<{
    total: string | null; nn: string | null
    mn: number | null; mx: number | null
    p10: number | null; p25: number | null; p50: number | null; p75: number | null; p90: number | null
    dc: string | null
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE ${qCol} IS NOT NULL AND BTRIM(${qColText}) <> '') AS total,
       COUNT(*) FILTER (WHERE ${qColText} ~ '${NUMERIC_RE_SQL}') AS nn,
       MIN(CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS mn,
       MAX(CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS mx,
       PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS p10,
       PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS p25,
       PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS p50,
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS p75,
       PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText}::float8 END) AS p90,
       COUNT(DISTINCT CASE WHEN ${qColText} ~ '${NUMERIC_RE_SQL}' THEN ${qColText} END) AS dc
     FROM ${tableFq}`,
  )
  const row = res.rows[0]
  if (!row) return null
  const total = Number(row.total ?? 0)
  const nn = Number(row.nn ?? 0)
  if (nn === 0 || total === 0) return null
  if (nn / total < 0.8) return null
  if (row.mn == null || row.mx == null) return null
  return buildNumericStat({
    min: Number(row.mn), max: Number(row.mx),
    p10: Number(row.p10), p25: Number(row.p25), p50: Number(row.p50), p75: Number(row.p75), p90: Number(row.p90),
    nonNullCount: nn, distinctCount: Number(row.dc ?? 0),
  })
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
