#!/usr/bin/env node
/**
 * Step 4.5 — DB 라벨링 전수 조사 (실제 MV 컬럼 구조 기반)
 * MV: catalog_app.product_recommendation_mv — milling/holemaking/threading 접두 + search_* 통합
 */
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"

function readEnv(p) {
  if (!fs.existsSync(p)) return {}
  const o = {}
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const i = t.indexOf("=")
    o[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return o
}

// 사용자 요구 컬럼 ↔ 실제 MV 컬럼 매핑
const COL_MAP = {
  // 단일 매핑
  brand: ["edp_brand_name", "series_brand_name"],
  material_tags: ["material_tags"],          // text[]
  tool_type: ["series_tool_type"],
  product_type: ["series_product_type"],
  application_shape: ["series_application_shape"],
  cutting_edge_shape: ["series_cutting_edge_shape", "search_subtype"],
  shank_type: ["series_shank_type", "search_shank_type"],
  // COALESCE 3-way (milling/holemaking/threading) 전부 점검
  diameter_mm: ["search_diameter_mm", "milling_outside_dia", "holemaking_outside_dia", "threading_outside_dia"],
  flute_count: ["milling_number_of_flute", "holemaking_number_of_flute", "threading_number_of_flute"],
  length_of_cut: ["milling_length_of_cut", "holemaking_flute_length"],
  overall_length: ["milling_overall_length", "holemaking_overall_length", "threading_overall_length"],
  shank_diameter: ["milling_shank_dia", "holemaking_shank_dia", "threading_shank_dia"],
  neck_diameter: ["milling_neck_diameter"],
  effective_length: ["milling_effective_length"],
  ball_radius: ["milling_ball_radius"],
  helix_angle: ["milling_helix_angle", "holemaking_helix_angle"],
  taper_angle: ["milling_taper_angle", "holemaking_taper_angle"],
  point_angle: ["holemaking_point_angle"],
  thread_pitch: ["threading_pitch"],
  thread_tpi: ["threading_tpi"],
  coating: ["search_coating", "milling_coating", "holemaking_coating", "threading_coating"],
  tool_material: ["milling_tool_material", "holemaking_tool_material", "threading_tool_material"],
}

const out = []
function log(s = "") { console.log(s); out.push(s) }
function h1(s) { log(`\n# ${s}\n`) }
function h2(s) { log(`\n## ${s}\n`) }

async function main() {
  const env = {
    ...readEnv(path.join(process.cwd(), ".env")),
    ...readEnv(path.join(process.cwd(), ".env.local")),
    ...readEnv(path.join(process.cwd(), ".env.vercel")),
    ...process.env,
  }
  const cfg = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : { host: env.PGHOST, port: Number(env.PGPORT || 5432), database: env.PGDATABASE, user: env.PGUSER, password: env.PGPASSWORD }
  const c = new Client(cfg)
  await c.connect()
  console.error("[probe] connected")
  const q = async (sql, p = []) => (await c.query(sql, p)).rows

  const mvTotal = Number((await q(`SELECT COUNT(*)::bigint AS n FROM catalog_app.product_recommendation_mv`))[0].n)
  h1(`DB 라벨링 전수 조사 — product_recommendation_mv (총 ${mvTotal.toLocaleString()} 건)`)

  // MV는 information_schema.columns 에 안 나옴. pg_attribute 사용.
  const cols = await q(`
    SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type
    FROM pg_attribute a
    WHERE a.attrelid = 'catalog_app.product_recommendation_mv'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `)
  const colInfo = new Map(cols.map(r => [r.column_name, r]))
  log(`- MV 컬럼 총 ${cols.length}개 발견`)

  // ═══ 조사 1A: NULL 비율 ═══════════════════════════════════════
  h2("조사 1A — NULL/빈값 비율")
  log("| 논리 컬럼 | 실제 MV 컬럼 | type | total | null수 | null% | 판정 |")
  log("|---|---|---|---:|---:|---:|---|")
  for (const [logical, actuals] of Object.entries(COL_MAP)) {
    for (const actual of actuals) {
      const info = colInfo.get(actual)
      if (!info) { log(`| ${logical} | ${actual} | — | — | — | — | ❌MISSING |`); continue }
      const isArray = info.data_type === "ARRAY"
      const isText = /text|char|varying/i.test(info.data_type)
      let nullExpr
      if (isArray) nullExpr = `COUNT(*) FILTER (WHERE "${actual}" IS NULL OR cardinality("${actual}")=0)`
      else if (isText) nullExpr = `COUNT(*) FILTER (WHERE "${actual}" IS NULL OR BTRIM("${actual}"::text)='')`
      else nullExpr = `COUNT(*) FILTER (WHERE "${actual}" IS NULL)`
      const r = (await q(`SELECT ${nullExpr}::bigint AS nulls FROM catalog_app.product_recommendation_mv`))[0]
      const nulls = Number(r.nulls)
      const pct = mvTotal ? (100 * nulls / mvTotal) : 0
      const verdict = pct >= 80 ? "🔴" : pct >= 50 ? "🟠" : pct >= 20 ? "🟡" : "🟢"
      log(`| ${logical} | ${actual} | ${info.data_type} | ${mvTotal} | ${nulls} | ${pct.toFixed(1)}% | ${verdict} |`)
    }
  }

  // ═══ 조사 1B: 정규화 불일치 ══════════════════════════════════
  h2("조사 1B — 값 정규화 불일치")
  const distinctTargets = [
    { logical: "brand", col: "edp_brand_name" },
    { logical: "brand(series)", col: "series_brand_name" },
    { logical: "tool_type", col: "series_tool_type" },
    { logical: "product_type", col: "series_product_type" },
    { logical: "application_shape", col: "series_application_shape" },
    { logical: "cutting_edge_shape", col: "series_cutting_edge_shape" },
    { logical: "search_subtype", col: "search_subtype" },
    { logical: "search_coating", col: "search_coating" },
    { logical: "milling_coating", col: "milling_coating" },
    { logical: "milling_tool_material", col: "milling_tool_material" },
    { logical: "search_shank_type", col: "search_shank_type" },
  ]
  for (const { logical, col } of distinctTargets) {
    if (!colInfo.has(col)) { log(`\n### ${logical} (${col}) — MISSING`); continue }
    const rows = await q(`
      SELECT "${col}"::text AS v, COUNT(*)::bigint AS cnt
      FROM catalog_app.product_recommendation_mv
      WHERE "${col}" IS NOT NULL AND BTRIM("${col}"::text) <> ''
      GROUP BY "${col}" ORDER BY cnt DESC
    `)
    log(`\n### ${logical} (${col}) — distinct ${rows.length}개`)
    // 정규화 이슈 탐지
    const norm = new Map()
    for (const r of rows) {
      const k = r.v.toLowerCase().replace(/[\s\-_./]+/g, "").replace(/s$/, "")
      if (!norm.has(k)) norm.set(k, [])
      norm.get(k).push({ v: r.v, cnt: Number(r.cnt) })
    }
    const conflicts = [...norm.values()].filter(g => g.length >= 2)
    if (conflicts.length) {
      log("| normalized-key | 표기 변형 (count) |")
      log("|---|---|")
      for (const g of conflicts.slice(0, 30)) {
        const k = g[0].v.toLowerCase().replace(/[\s\-_./]+/g, "").replace(/s$/, "")
        log(`| \`${k}\` | ${g.map(x => `\`${x.v}\`(${x.cnt})`).join(" / ")} |`)
      }
      if (conflicts.length > 30) log(`- ... ${conflicts.length - 30} more conflicts`)
    } else log("- ✅ 정규화 이슈 없음")
    // top 15 샘플
    log(`- top: ${rows.slice(0, 15).map(r => `\`${r.v}\`(${r.cnt})`).join(", ")}`)
  }

  // material_tags 는 array 라서 unnest
  h2("조사 1B-2 — material_tags (array) 값 분포")
  if (colInfo.has("material_tags")) {
    const rows = await q(`
      SELECT tag, COUNT(*)::bigint AS cnt
      FROM catalog_app.product_recommendation_mv, unnest(COALESCE(material_tags, ARRAY[]::text[])) AS tag
      GROUP BY tag ORDER BY cnt DESC
    `)
    log(`- distinct tags: ${rows.length}`)
    log("| tag | count |")
    log("|---|---:|")
    for (const r of rows.slice(0, 60)) log(`| ${r.tag} | ${r.cnt} |`)
    if (rows.length > 60) log(`- ... ${rows.length - 60} more`)
    // 정규화 충돌
    const norm = new Map()
    for (const r of rows) {
      const k = r.tag.toLowerCase().replace(/[\s\-_./]+/g, "").replace(/s$/, "")
      if (!norm.has(k)) norm.set(k, [])
      norm.get(k).push({ v: r.tag, cnt: Number(r.cnt) })
    }
    const conflicts = [...norm.values()].filter(g => g.length >= 2)
    if (conflicts.length) {
      log("\n| normalized | 변형 |")
      log("|---|---|")
      for (const g of conflicts) log(`| \`${g[0].v.toLowerCase().replace(/[\s\-_./]+/g, "").replace(/s$/, "")}\` | ${g.map(x => `\`${x.v}\`(${x.cnt})`).join(" / ")} |`)
    }
  }

  // ═══ 조사 1C: 수치 이상값 ═══════════════════════════════════
  h2("조사 1C — 수치 이상값")
  // MV 컬럼은 대부분 text — 숫자 변환 후 범위 체크
  const numChecks = [
    { col: "search_diameter_mm", min: 0, max: 1000 },
    { col: "milling_outside_dia", min: 0, max: 1000 },
    { col: "holemaking_outside_dia", min: 0, max: 1000 },
    { col: "milling_number_of_flute", min: 0, max: 20 },
    { col: "holemaking_number_of_flute", min: 0, max: 20 },
    { col: "milling_overall_length", min: 0, max: 2000 },
    { col: "holemaking_overall_length", min: 0, max: 2000 },
    { col: "milling_length_of_cut", min: 0, max: 2000 },
    { col: "milling_shank_dia", min: 0, max: 1000 },
    { col: "milling_neck_diameter", min: 0, max: 1000 },
    { col: "milling_ball_radius", min: -0.01, max: 50 },
    { col: "milling_helix_angle", min: -0.01, max: 90 },
    { col: "milling_taper_angle", min: -0.01, max: 360 },
    { col: "holemaking_point_angle", min: -0.01, max: 360 },
    { col: "threading_pitch", min: 0, max: 20 },
  ]
  log("| 컬럼 | 유효범위 | numeric 변환 실패 | 범위 밖 | 샘플 이상값 |")
  log("|---|---|---:|---:|---|")
  for (const chk of numChecks) {
    if (!colInfo.has(chk.col)) { log(`| ${chk.col} | — | MISSING | | |`); continue }
    const info = colInfo.get(chk.col)
    const isNum = /numeric|double|integer|real|bigint/i.test(info.data_type)
    let badNum, oor, samples
    if (isNum) {
      const r = (await q(`SELECT COUNT(*) FILTER (WHERE "${chk.col}" <= ${chk.min} OR "${chk.col}" >= ${chk.max})::bigint AS n FROM catalog_app.product_recommendation_mv WHERE "${chk.col}" IS NOT NULL`))[0]
      badNum = 0; oor = Number(r.n)
      const s = await q(`SELECT "${chk.col}" AS v FROM catalog_app.product_recommendation_mv WHERE "${chk.col}" <= ${chk.min} OR "${chk.col}" >= ${chk.max} LIMIT 5`)
      samples = s.map(x => x.v).join(", ")
    } else {
      // text → 숫자로 변환 안되는 것, 범위밖인 것
      const r = (await q(`
        WITH base AS (
          SELECT "${chk.col}"::text AS raw,
                 NULLIF(substring("${chk.col}"::text FROM '(-?[0-9]+(?:\\.[0-9]+)?)'), '') AS m
          FROM catalog_app.product_recommendation_mv
          WHERE "${chk.col}" IS NOT NULL AND BTRIM("${chk.col}"::text) <> ''
        )
        SELECT
          COUNT(*) FILTER (WHERE m IS NULL)::bigint AS bad_num,
          COUNT(*) FILTER (WHERE m IS NOT NULL AND (m::numeric <= ${chk.min} OR m::numeric >= ${chk.max}))::bigint AS oor
        FROM base
      `))[0]
      badNum = Number(r.bad_num); oor = Number(r.oor)
      const s = await q(`
        SELECT "${chk.col}"::text AS v FROM catalog_app.product_recommendation_mv
        WHERE "${chk.col}" IS NOT NULL AND BTRIM("${chk.col}"::text) <> ''
          AND (
            NULLIF(substring("${chk.col}"::text FROM '(-?[0-9]+(?:\\.[0-9]+)?)'), '') IS NULL
            OR NULLIF(substring("${chk.col}"::text FROM '(-?[0-9]+(?:\\.[0-9]+)?)'), '')::numeric <= ${chk.min}
            OR NULLIF(substring("${chk.col}"::text FROM '(-?[0-9]+(?:\\.[0-9]+)?)'), '')::numeric >= ${chk.max}
          )
        LIMIT 5
      `)
      samples = s.map(x => `\`${x.v}\``).join(", ")
    }
    log(`| ${chk.col} | (${chk.min}, ${chk.max}) | ${badNum} | ${oor} | ${samples} |`)
  }

  // ═══ 조사 2A: MV 참조 테이블 ══════════════════════════════
  h2("조사 2A — MV가 참조하는 소스 테이블")
  const mvDef = (await q(`SELECT pg_get_viewdef('catalog_app.product_recommendation_mv'::regclass, true) AS def`))[0].def || ""
  const fromMatches = [...mvDef.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z_][\w.]*)/gi)]
  const sources = [...new Set(fromMatches.map(m => m[1]))].sort()
  log(`- MV definition 참조: ${sources.length}개`)
  for (const s of sources) log(`  - \`${s}\``)

  // ═══ 조사 2B: 조인 가능 후보 테이블 ═══════════════════════
  h2("조사 2B — 조인 가능 후보 테이블 (raw_catalog + catalog_app 전수)")
  const tables = await q(`
    SELECT table_schema, table_name, table_type
    FROM information_schema.tables
    WHERE table_schema IN ('raw_catalog','catalog_app')
    ORDER BY table_schema, table_name
  `)
  const joinKeys = ["normalized_edp","normalized_code","series_idx","edp_no","edp","series_code","series_name","brand_name"]
  const tblCols = await q(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema IN ('raw_catalog','catalog_app') AND lower(column_name) = ANY($1)
  `, [joinKeys])
  const jm = new Map()
  for (const r of tblCols) {
    const k = `${r.table_schema}.${r.table_name}`
    if (!jm.has(k)) jm.set(k, [])
    jm.get(k).push(r.column_name)
  }
  log(`- 총 ${tables.length}개`)
  log("| schema.table | type | 조인키 존재 | 키 |")
  log("|---|---|---|---|")
  for (const t of tables) {
    const k = `${t.table_schema}.${t.table_name}`
    const keys = jm.get(k) || []
    log(`| ${k} | ${t.table_type} | ${keys.length ? "✅" : "—"} | ${keys.join(", ")} |`)
  }

  // ═══ 조사 2C: 주요 보조 테이블 매칭률 ═══════════════════
  h2("조사 2C — 주요 보조 테이블 매칭률")
  const mvDistinctEdp = Number((await q(`SELECT COUNT(DISTINCT edp_no)::bigint AS n FROM catalog_app.product_recommendation_mv WHERE edp_no IS NOT NULL`))[0].n)
  const mvDistinctSeriesIdx = Number((await q(`SELECT COUNT(DISTINCT edp_series_idx)::bigint AS n FROM catalog_app.product_recommendation_mv`))[0].n)
  log(`- MV distinct edp_no: ${mvDistinctEdp.toLocaleString()}`)
  log(`- MV distinct series_idx: ${mvDistinctSeriesIdx.toLocaleString()}`)

  const candidates = [
    { schema: "raw_catalog", name: "cutting_condition_table", onKey: null, desc: "절삭조건 (RPM/feed)" },
    { schema: "catalog_app", name: "inventory_snapshot", onKey: "edp_no", desc: "재고 스냅샷" },
    { schema: "raw_catalog", name: "yg1_stock_data", onKey: "edp", desc: "YG-1 재고" },
    { schema: "raw_catalog", name: "prod_edp", onKey: "edp_no", desc: "기본 EDP" },
    { schema: "raw_catalog", name: "prod_series", onKey: "idx↔series_idx", desc: "시리즈 마스터" },
    { schema: "raw_catalog", name: "prod_series_work_material_status", onKey: "series_idx", desc: "피삭재 상태" },
    { schema: "raw_catalog", name: "prod_edp_option_milling", onKey: "edp_no", desc: "밀링 옵션(이미 조인)" },
    { schema: "raw_catalog", name: "prod_edp_option_holemaking", onKey: "edp_no", desc: "홀메이킹(이미 조인)" },
    { schema: "raw_catalog", name: "prod_edp_option_threading", onKey: "edp_no", desc: "쓰레딩(이미 조인)" },
    { schema: "raw_catalog", name: "prod_edp_option_turning", onKey: "edp_no", desc: "터닝 (MV에서 누락)" },
    { schema: "raw_catalog", name: "prod_icons", onKey: null, desc: "아이콘" },
    { schema: "raw_catalog", name: "prod_series_icons", onKey: null, desc: "시리즈 아이콘" },
    { schema: "raw_catalog", name: "iso_detail_list", onKey: null, desc: "ISO 상세" },
    { schema: "raw_catalog", name: "kennametal_alu_cut_data_clean", onKey: "series_code", desc: "경쟁사 Kennametal Alu-Cut" },
    { schema: "raw_catalog", name: "prod_work_piece_by_category", onKey: null, desc: "피삭재-카테고리" },
  ]
  for (const cand of candidates) {
    const exists = tables.some(t => t.table_schema === cand.schema && t.table_name === cand.name)
    log(`\n### ${cand.schema}.${cand.name} — ${cand.desc}`)
    if (!exists) { log("- ❌ 존재하지 않음"); continue }
    const colsX = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [cand.schema, cand.name])
    log(`- 컬럼 (${colsX.length}): ${colsX.map(x => x.column_name).join(", ")}`)
    let total = 0
    try { total = Number((await q(`SELECT COUNT(*)::bigint AS n FROM ${cand.schema}.${cand.name}`))[0].n) } catch {}
    log(`- 총 레코드: ${total.toLocaleString()}`)
    // 매칭률 시도
    const colset = new Set(colsX.map(x => x.column_name))
    if (colset.has("edp_no")) {
      const r = await q(`
        SELECT COUNT(DISTINCT p.edp_no)::bigint AS m, COUNT(DISTINCT c.edp_no)::bigint AS s
        FROM catalog_app.product_recommendation_mv p
        LEFT JOIN ${cand.schema}.${cand.name} c ON c.edp_no = p.edp_no
        WHERE c.edp_no IS NOT NULL
      `)
      const matched = Number(r[0].m)
      const rate = mvDistinctEdp ? 100 * matched / mvDistinctEdp : 0
      log(`- MV→이 테이블 매칭 (by edp_no): ${matched}/${mvDistinctEdp} = ${rate.toFixed(1)}%`)
    } else if (colset.has("edp")) {
      const r = await q(`
        SELECT COUNT(DISTINCT p.edp_no)::bigint AS m
        FROM catalog_app.product_recommendation_mv p
        JOIN ${cand.schema}.${cand.name} c ON c.edp::text = p.edp_no::text
      `)
      const matched = Number(r[0].m)
      const rate = mvDistinctEdp ? 100 * matched / mvDistinctEdp : 0
      log(`- MV→이 테이블 매칭 (by edp): ${matched}/${mvDistinctEdp} = ${rate.toFixed(1)}%`)
    } else if (colset.has("series_idx")) {
      const r = await q(`
        SELECT COUNT(DISTINCT p.edp_series_idx)::bigint AS m
        FROM catalog_app.product_recommendation_mv p
        JOIN ${cand.schema}.${cand.name} c ON c.series_idx = p.edp_series_idx
      `)
      const matched = Number(r[0].m)
      const rate = mvDistinctSeriesIdx ? 100 * matched / mvDistinctSeriesIdx : 0
      log(`- MV→이 테이블 매칭 (by series_idx): ${matched}/${mvDistinctSeriesIdx} = ${rate.toFixed(1)}%`)
    } else if (cand.name === "cutting_condition_table") {
      // series_name 기반 매칭 시도
      const r = await q(`
        SELECT COUNT(DISTINCT p.edp_series_name)::bigint AS m
        FROM catalog_app.product_recommendation_mv p
        JOIN ${cand.schema}.${cand.name} c ON lower(BTRIM(c.series_name)) = lower(BTRIM(p.edp_series_name))
      `)
      const matched = Number(r[0].m)
      const mvSeries = Number((await q(`SELECT COUNT(DISTINCT edp_series_name)::bigint AS n FROM catalog_app.product_recommendation_mv WHERE edp_series_name IS NOT NULL`))[0].n)
      log(`- MV→cutting_condition 매칭 (by series_name): ${matched}/${mvSeries} = ${mvSeries ? (100*matched/mvSeries).toFixed(1):0}%`)
    } else {
      log("- ⚠️ 조인키 없음 / 수동 검토 필요")
    }
  }

  // ═══ 조사 3: 피삭재 ↔ 브랜드 매핑 ═════════════════════
  h2("조사 3 — 피삭재 ↔ 브랜드 매핑 실태 (material_tags 기반)")
  const mapping = [
    { mat: "구리/Copper", expected: "CRX S / CRX-S", tagRe: /copper|구리/i },
    { mat: "알루미늄/Aluminum", expected: "Alu-Cut / Alu-Power", tagRe: /alumi|알루미/i },
    { mat: "티타늄/Titanium", expected: "Titanox Power", tagRe: /titan|티타/i },
    { mat: "스테인리스/Stainless", expected: "(검증대상)", tagRe: /stainless|스테인/i },
    { mat: "주철/Cast Iron", expected: "(검증대상)", tagRe: /cast\s*iron|주철/i },
    { mat: "열처리강/Hardened", expected: "(검증대상)", tagRe: /harden|HRC|열처리/i },
    { mat: "탄소강/Carbon Steel", expected: "(검증대상)", tagRe: /carbon\s*steel|탄소강/i },
  ]
  // 먼저 material_tags 전체 수집
  const allTags = (await q(`
    SELECT DISTINCT tag FROM catalog_app.product_recommendation_mv, unnest(COALESCE(material_tags, ARRAY[]::text[])) AS tag
  `)).map(r => r.tag)
  for (const m of mapping) {
    const matchedTags = allTags.filter(t => m.tagRe.test(t))
    log(`\n### ${m.mat} (기대 브랜드: ${m.expected})`)
    log(`- 매칭 태그: ${matchedTags.length ? matchedTags.map(t => `\`${t}\``).join(", ") : "없음"}`)
    if (!matchedTags.length) continue
    const rows = await q(`
      SELECT edp_brand_name AS brand, COUNT(*)::bigint AS cnt
      FROM catalog_app.product_recommendation_mv
      WHERE material_tags && $1::text[]
        AND edp_brand_name IS NOT NULL AND BTRIM(edp_brand_name) <> ''
      GROUP BY edp_brand_name ORDER BY cnt DESC LIMIT 15
    `, [matchedTags])
    const total = Number((await q(`SELECT COUNT(*)::bigint AS n FROM catalog_app.product_recommendation_mv WHERE material_tags && $1::text[]`, [matchedTags]))[0].n)
    log(`- 총 레코드: ${total.toLocaleString()}`)
    if (!rows.length) { log(`- ⚠️ 브랜드 데이터 없음`); continue }
    log("| brand | count | share |")
    log("|---|---:|---:|")
    for (const r of rows) log(`| ${r.brand} | ${r.cnt} | ${total ? (100*Number(r.cnt)/total).toFixed(1) : 0}% |`)
    // 판정
    const topBrands = rows.slice(0, 3).map(r => r.brand)
    const expected = m.expected.toLowerCase()
    if (!expected.includes("검증")) {
      const hit = topBrands.some(b => {
        const bn = String(b).toLowerCase().replace(/[\s\-_]+/g, "")
        return expected.split("/").some(e => bn.includes(e.trim().toLowerCase().replace(/[\s\-_]+/g, "")))
      })
      log(`- 판정: ${hit ? "✅ 일치" : "🔴 불일치"} (top3=${topBrands.join(", ")} vs 기대=${m.expected})`)
    }
  }

  h1("끝")
  const outPath = path.join(process.cwd(), "reports", "db-labeling-audit.md")
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, out.join("\n"), "utf8")
  console.error(`\n[saved] ${outPath}`)
  await c.end()
}

main().catch(e => { console.error(e); process.exit(1) })
