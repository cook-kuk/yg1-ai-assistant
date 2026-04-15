#!/usr/bin/env node
/**
 * DB 전수 조사 — JOIN 가능한 모든 테이블/컬럼 파악.
 * 코드 수정 없음, 조사 결과만 출력.
 */
import pg from "pg"
import fs from "node:fs"
import path from "node:path"

const { Pool } = pg
const pool = new Pool({
  host: "20.119.98.136", port: 5432, database: "smart_catalog",
  user: "smart_catalog", password: "smart_catalog",
  max: 4, idleTimeoutMillis: 5000,
})
async function q(sql, p = []) { return (await pool.query(sql, p)).rows }

const SCHEMAS = ["catalog_app", "raw_catalog", "public"]
const out = []
const log = (...args) => { const s = args.join(" "); console.log(s); out.push(s) }

async function safeCount(fq) {
  try { const r = await q(`SELECT COUNT(*)::bigint AS c FROM ${fq}`); return Number(r[0].c) }
  catch (e) { return `err: ${e.message.slice(0, 60)}` }
}

async function main() {
  // ─────────────────────────────────────
  // 조사 1: 전체 테이블 맵
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 1: 전체 테이블 맵")
  log("━".repeat(80))

  // tables + matviews (MV는 information_schema에 안 보임)
  const baseTables = await q(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = ANY($1)
    ORDER BY table_schema, table_name
  `, [SCHEMAS])
  const mvs = await q(`
    SELECT schemaname AS table_schema, matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type
    FROM pg_matviews
    WHERE schemaname = ANY($1)
    ORDER BY schemaname, matviewname
  `, [SCHEMAS])
  const allRels = [...baseTables, ...mvs]

  log(`총 ${allRels.length} 개 (tables=${baseTables.length}, MVs=${mvs.length})`)
  const relInfo = []
  for (const t of allRels) {
    const fq = `${t.table_schema}.${t.table_name}`
    const cnt = await safeCount(`"${t.table_schema}"."${t.table_name}"`)
    let cols = []
    if (t.table_type === "MATERIALIZED VIEW") {
      cols = await q(`
        SELECT attname AS column_name, format_type(atttypid, atttypmod) AS data_type
        FROM pg_attribute WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum
      `, [fq]).catch(() => [])
    } else {
      cols = await q(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position
      `, [t.table_schema, t.table_name])
    }
    relInfo.push({ ...t, fq, count: cnt, columns: cols })
  }

  log(`\n[ schema.table | type | 레코드수 | 컬럼수 ]`)
  for (const r of relInfo) {
    log(`  ${r.fq.padEnd(45)} ${String(r.table_type).padEnd(20)} ${String(r.count).padStart(10)}  ${r.columns.length} cols`)
  }

  const findRel = (fqLike) => relInfo.find(r => r.fq === fqLike)
  const MV = findRel("catalog_app.product_recommendation_mv")
  const SP = findRel("catalog_app.series_profile_mv")
  const INV = findRel("catalog_app.product_inventory_summary_mv")
  const BP = findRel("catalog_app.brand_profile_mv")
  const CC = relInfo.find(r => r.table_name.includes("cutting_condition"))

  // ─────────────────────────────────────
  // 조사 2: JOIN 키 매핑
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 2: JOIN 키 후보 — 같은 컬럼명 다른 테이블")
  log("━".repeat(80))

  const KEY_NAMES = [
    "edp_idx", "edp_no", "normalized_code", "normalized_edp",
    "series_idx", "series_row_idx", "edp_series_idx", "normalized_series_name",
    "series_name", "edp_brand_name", "primary_brand_name",
    "edp_root_category", "primary_root_category",
  ]
  log(`\n조인키 후보 컬럼별 분포:`)
  for (const kn of KEY_NAMES) {
    const hits = relInfo.filter(r => r.columns.some(c => c.column_name === kn))
    if (hits.length === 0) continue
    log(`\n  ${kn}:`)
    for (const h of hits) log(`    · ${h.fq}`)
  }

  // 매칭률 계산: MV 기준
  log(`\n[ JOIN 매칭률 (catalog_app.product_recommendation_mv 기준) ]`)
  const mvTotal = MV?.count ?? 0
  log(`MV total = ${mvTotal}`)

  async function joinRate(label, sql) {
    try {
      const r = await q(sql)
      const matched = Number(r[0].matched ?? 0)
      const otherTotal = Number(r[0].other_total ?? 0)
      const rate = mvTotal > 0 ? (matched / mvTotal * 100).toFixed(1) : "N/A"
      log(`  ${label.padEnd(60)} mv=${mvTotal}  other=${otherTotal}  matched=${matched}  → ${rate}%`)
    } catch (e) { log(`  ${label.padEnd(60)} ERR: ${e.message.slice(0, 80)}`) }
  }

  if (SP) await joinRate("MV.edp_series_idx → series_profile_mv.??(sample)", `
    SELECT (SELECT COUNT(*) FROM catalog_app.series_profile_mv) AS other_total,
           COUNT(DISTINCT p.edp_series_idx) AS matched
    FROM catalog_app.product_recommendation_mv p
    JOIN catalog_app.series_profile_mv s
      ON s.normalized_series_name = COALESCE(NULLIF(p.edp_series_name, ''), '_x_')
  `)
  if (INV) await joinRate("MV.edp_no → product_inventory_summary_mv.??", `
    SELECT (SELECT COUNT(*) FROM catalog_app.product_inventory_summary_mv) AS other_total,
           COUNT(*) AS matched
    FROM catalog_app.product_recommendation_mv p
    JOIN catalog_app.product_inventory_summary_mv i ON i.edp_no = p.edp_no
  `)
  if (CC) {
    const ccCols = CC.columns.map(c => c.column_name)
    log(`  cutting_conditions cols: ${ccCols.slice(0, 20).join(", ")}${ccCols.length > 20 ? "..." : ""}`)
    // 추정 join key 시도
    for (const k of ["edp_no", "normalized_code", "series_name", "normalized_series_name"]) {
      if (!ccCols.includes(k)) continue
      const mvHasIt = MV?.columns.some(c => c.column_name === k)
      if (!mvHasIt) continue
      await joinRate(`MV.${k} → ${CC.fq}.${k}`, `
        SELECT (SELECT COUNT(*) FROM ${CC.fq}) AS other_total,
               COUNT(*) AS matched
        FROM catalog_app.product_recommendation_mv p
        JOIN ${CC.fq} c ON c.${k} = p.${k}
      `)
    }
  }
  if (BP) {
    const bpCols = BP.columns.map(c => c.column_name)
    for (const k of ["edp_brand_name", "primary_brand_name", "brand_name"]) {
      if (!bpCols.includes(k)) continue
      const mvKey = MV?.columns.some(c => c.column_name === "edp_brand_name") ? "edp_brand_name" : null
      if (!mvKey) continue
      await joinRate(`MV.${mvKey} → ${BP.fq}.${k}`, `
        SELECT (SELECT COUNT(*) FROM ${BP.fq}) AS other_total,
               COUNT(*) FILTER (WHERE b.${k} IS NOT NULL) AS matched
        FROM catalog_app.product_recommendation_mv p
        LEFT JOIN ${BP.fq} b ON b.${k} = p.${mvKey}
      `)
    }
  }

  // ─────────────────────────────────────
  // 조사 3: 핵심 테이블 상세
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 3: 핵심 테이블 상세")
  log("━".repeat(80))

  for (const tag of ["A. cutting_condition", "B. product_inventory_summary_mv", "C. series_profile_mv", "D. brand_profile_mv"]) {
    const target =
      tag.startsWith("A") ? CC :
      tag.startsWith("B") ? INV :
      tag.startsWith("C") ? SP : BP
    if (!target) { log(`\n[${tag}] (없음)`); continue }
    log(`\n[${tag}] ${target.fq}  rows=${target.count}  cols=${target.columns.length}`)
    log(`  컬럼:`)
    for (const c of target.columns) log(`    · ${c.column_name.padEnd(40)} ${c.data_type}`)
    try {
      const sample = await q(`SELECT * FROM ${target.fq} LIMIT 3`)
      log(`  샘플 ${sample.length} 행 (첫 3 컬럼만 요약):`)
      for (const row of sample) {
        const keys = Object.keys(row).slice(0, 5)
        log(`    · ${keys.map(k => `${k}=${JSON.stringify(row[k]).slice(0, 60)}`).join("  ")}`)
      }
    } catch (e) { log(`  sample err: ${e.message}`) }
  }

  // series_profile_mv: work_piece_statuses JSONB 펼치기 + primary_tool_type 분포
  if (SP) {
    log(`\n[ series_profile_mv.work_piece_statuses 구조 (1행 펼침) ]`)
    try {
      const wp = await q(`
        SELECT jsonb_array_length(work_piece_statuses) AS n,
               work_piece_statuses->0 AS first_elem
        FROM catalog_app.series_profile_mv
        WHERE jsonb_array_length(work_piece_statuses) > 0
        LIMIT 1
      `)
      log(`  n=${wp[0]?.n}, first_elem=${JSON.stringify(wp[0]?.first_elem)}`)
    } catch (e) { log(`  err: ${e.message}`) }
    log(`\n[ primary_tool_type 분포 ]`)
    for (const r of await q(`
      SELECT primary_tool_type, COUNT(*) AS c
      FROM catalog_app.series_profile_mv
      GROUP BY primary_tool_type ORDER BY c DESC LIMIT 15
    `)) log(`    ${String(r.primary_tool_type ?? "(null)").padEnd(40)} ${r.c}`)
    log(`\n[ tool_subtypes (jsonb) 샘플 ]`)
    for (const r of await q(`
      SELECT tool_subtypes FROM catalog_app.series_profile_mv
      WHERE tool_subtypes IS NOT NULL LIMIT 5
    `)) log(`    ${JSON.stringify(r.tool_subtypes).slice(0, 100)}`)
  }

  // 기타 catalog/product/edp/series 이름 들어간 테이블 전수
  log(`\n[ D. 기타 발견 테이블 (catalog/product/edp/series 키워드) ]`)
  for (const r of relInfo) {
    if (/catalog|product|edp|series|cutting|inventory|stock|brand/i.test(r.table_name) === false) continue
    if ([MV, SP, INV, BP, CC].some(x => x?.fq === r.fq)) continue
    log(`  ${r.fq.padEnd(50)} rows=${String(r.count).padStart(10)}  cols=${r.columns.length}`)
    log(`    cols(전체): ${r.columns.map(c => c.column_name).join(", ").slice(0, 200)}${r.columns.length > 15 ? "..." : ""}`)
  }

  // ─────────────────────────────────────
  // 조사 4: 유효장 (effective length) 추적
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 4: 유효장 (effective length) 추적")
  log("━".repeat(80))

  const effCols = await q(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = ANY($1) AND column_name ILIKE '%effective%'
    ORDER BY table_schema, table_name, column_name
  `, [SCHEMAS])
  log(`information_schema.columns 검색 결과: ${effCols.length} 건`)
  for (const r of effCols) log(`  ${r.table_schema}.${r.table_name}.${r.column_name}  (${r.data_type})`)

  // pg_attribute 기반 (MV 컬럼 포함)
  log(`\npg_attribute 기반(matview 포함) effective 검색:`)
  for (const r of relInfo) {
    const hits = r.columns.filter(c => /effective/i.test(c.column_name))
    for (const h of hits) log(`  ${r.fq}.${h.column_name}  (${h.data_type})`)
  }

  // milling_effective_length 통계
  if (MV?.columns.some(c => c.column_name === "milling_effective_length")) {
    const stat = await q(`
      SELECT COUNT(*) AS total,
             COUNT(milling_effective_length) AS non_null,
             COUNT(*) FILTER (WHERE milling_effective_length::text ~ '^-?[0-9.]+$') AS numeric_like,
             MIN(NULLIF(milling_effective_length, '')) AS mn_text,
             MAX(NULLIF(milling_effective_length, '')) AS mx_text
      FROM catalog_app.product_recommendation_mv
    `)
    log(`\nMV.milling_effective_length: total=${stat[0].total} non_null=${stat[0].non_null} numericLike=${stat[0].numeric_like} mn="${stat[0].mn_text}" mx="${stat[0].mx_text}"`)
    const samp = await q(`
      SELECT DISTINCT milling_effective_length
      FROM catalog_app.product_recommendation_mv
      WHERE milling_effective_length IS NOT NULL AND BTRIM(milling_effective_length) <> ''
      LIMIT 15
    `)
    log(`  샘플값: ${samp.map(r => JSON.stringify(r.milling_effective_length)).join(", ")}`)
  }

  // ─────────────────────────────────────
  // 조사 5: MV에 없는데 사용자가 물어볼 만한 필드 키워드 검색
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 5: 키워드별 컬럼 분포 (전체 스키마)")
  log("━".repeat(80))

  const KEYWORDS = ["rpm", "feed", "speed", "cutting", "stock", "inventory",
    "effective", "catalog", "image", "video", "price", "tolerance", "grade", "country",
    "neck", "point_angle", "pitch", "tpi", "hardness", "hrc", "iso"]
  for (const kw of KEYWORDS) {
    // information_schema (regular tables)
    const isRows = await q(`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = ANY($1) AND column_name ILIKE $2
    `, [SCHEMAS, `%${kw}%`])
    // pg_attribute (matviews) — 일부 중복 제거
    const seen = new Set(isRows.map(r => `${r.table_schema}.${r.table_name}.${r.column_name}`))
    const mvRows = []
    for (const r of relInfo) {
      if (r.table_type !== "MATERIALIZED VIEW") continue
      for (const c of r.columns) {
        if (!c.column_name.toLowerCase().includes(kw)) continue
        const k = `${r.table_schema}.${r.table_name}.${c.column_name}`
        if (!seen.has(k)) { mvRows.push({ table_schema: r.table_schema, table_name: r.table_name, column_name: c.column_name, data_type: c.data_type }); seen.add(k) }
      }
    }
    const all = [...isRows, ...mvRows]
    if (all.length === 0) { log(`  [${kw}] (없음)`); continue }
    log(`\n  [${kw}] ${all.length} 건:`)
    for (const r of all) log(`    · ${r.table_schema}.${r.table_name}.${r.column_name}  (${r.data_type})`)
  }

  // ─────────────────────────────────────
  // 조사 6: 한글 설명 누락 현황
  // ─────────────────────────────────────
  log("\n" + "━".repeat(80))
  log("## 조사 6: COLUMN_KO_DESCRIPTIONS vs MV 실제 컬럼 비교")
  log("━".repeat(80))

  const COLUMN_KO = {
    search_diameter_mm: 1, milling_outside_dia: 1, holemaking_outside_dia: 1, threading_outside_dia: 1,
    option_dc: 1, option_dcon: 1, milling_shank_dia: 1, holemaking_shank_dia: 1, threading_shank_dia: 1,
    option_shank_diameter: 1, milling_overall_length: 1, holemaking_overall_length: 1,
    threading_overall_length: 1, option_overall_length: 1, option_oal: 1,
    milling_length_of_cut: 1, holemaking_flute_length: 1, threading_thread_length: 1,
    option_flute_length: 1, option_loc: 1, option_neck_diameter: 1, option_neck_length: 1,
    milling_neck_diameter: 1, milling_neck_length: 1, milling_ball_radius: 1,
    option_r: 1, option_re: 1, milling_taper_angle: 1, option_taperangle: 1,
    milling_helix_angle: 1, holemaking_helix_angle: 1, holemaking_point_angle: 1, option_pointangle: 1,
    threading_pitch: 1, option_pitch: 1, threading_tpi: 1, option_tpi: 1,
    milling_flutes: 1, holemaking_flutes: 1, option_flutecount: 1,
    milling_coolant_hole: 1, holemaking_coolant_hole: 1, threading_coolant_hole: 1, option_coolanthole: 1,
    coating: 1, search_coating: 1, tool_material: 1, edp_brand_name: 1, series_name: 1,
    tool_subtype: 1, machining_category: 1,
  }
  const mvCols = new Set(MV?.columns.map(c => c.column_name) ?? [])
  const koKeys = Object.keys(COLUMN_KO)
  const orphan = koKeys.filter(k => !mvCols.has(k))
  const noKO = MV?.columns.filter(c => !COLUMN_KO[c.column_name]) ?? []
  log(`\n[ orphan (KO 설명 있는데 MV에 없는 컬럼) ${orphan.length}개 ]`)
  for (const k of orphan) log(`    · ${k}`)
  log(`\n[ MV에 있는데 KO 설명 없는 컬럼 ${noKO.length}/${MV?.columns.length}개 ]`)
  for (const c of noKO) log(`    · ${c.column_name.padEnd(40)} ${c.data_type}`)

  // 파일로도 저장
  await pool.end()
  const outPath = path.resolve("scripts/db-audit-output.txt")
  fs.writeFileSync(outPath, out.join("\n"), "utf-8")
  console.log(`\n\n[saved] ${outPath}`)
}

main().catch(e => { console.error("CRASH:", e); pool.end(); process.exit(1) })
