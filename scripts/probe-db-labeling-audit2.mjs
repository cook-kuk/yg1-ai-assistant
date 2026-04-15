#!/usr/bin/env node
/**
 * 보완 조사:
 * (A) MV 86개 실제 컬럼 full list — point_angle / threading_pitch / tpi 존재 여부
 * (B) ISO 코드(P/K/M/N/S/H) ↔ 브랜드 매핑
 * (C) prod_series_work_material_status 경유 세부 work_piece_name ↔ 브랜드
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

const out = []
function log(s = "") { console.log(s); out.push(s) }

async function main() {
  const env = {
    ...readEnv(".env"), ...readEnv(".env.local"), ...readEnv(".env.vercel"), ...process.env,
  }
  const cfg = env.DATABASE_URL ? { connectionString: env.DATABASE_URL }
    : { host: env.PGHOST, port: Number(env.PGPORT || 5432), database: env.PGDATABASE, user: env.PGUSER, password: env.PGPASSWORD }
  const c = new Client(cfg); await c.connect()
  const q = async (s, p = []) => (await c.query(s, p)).rows

  log(`# DB 라벨링 전수 조사 — 보완편\n`)

  // (A) MV 실제 컬럼 리스트
  log(`## A. product_recommendation_mv 실제 컬럼 86개\n`)
  const cols = await q(`
    SELECT a.attname AS c, format_type(a.atttypid, a.atttypmod) AS t
    FROM pg_attribute a
    WHERE a.attrelid='catalog_app.product_recommendation_mv'::regclass AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `)
  for (const r of cols) log(`- \`${r.c}\` (${r.t})`)
  const colSet = new Set(cols.map(r => r.c))
  log(`\n### 누락 의혹 컬럼 재확인:`)
  for (const target of ["holemaking_point_angle", "threading_pitch", "threading_tpi", "point_angle"]) {
    log(`- ${target}: ${colSet.has(target) ? "✅ 존재" : "❌ 없음"}`)
  }

  // (B) ISO 코드 × 브랜드 매핑
  log(`\n## B. ISO material group (P/K/M/N/S/H) × 브랜드 분포\n`)
  const isoCodes = ["P", "M", "K", "N", "S", "H"]
  for (const code of isoCodes) {
    log(`\n### ${code} — (${{P:"강/Steel",M:"스테인리스/Stainless",K:"주철/Cast Iron",N:"비철/Al,Cu",S:"내열/Ti,Inconel",H:"경질/Hardened"}[code]})`)
    const total = Number((await q(`SELECT COUNT(*)::bigint AS n FROM catalog_app.product_recommendation_mv WHERE $1 = ANY(material_tags)`, [code]))[0].n)
    log(`- 레코드: ${total.toLocaleString()}`)
    const rows = await q(`
      SELECT edp_brand_name AS brand, COUNT(*)::bigint AS cnt
      FROM catalog_app.product_recommendation_mv
      WHERE $1 = ANY(material_tags) AND edp_brand_name IS NOT NULL AND BTRIM(edp_brand_name) <> ''
      GROUP BY edp_brand_name ORDER BY cnt DESC LIMIT 10
    `, [code])
    log("| brand | count | share |")
    log("|---|---:|---:|")
    for (const r of rows) log(`| ${r.brand} | ${r.cnt} | ${total ? (100*Number(r.cnt)/total).toFixed(1) : 0}% |`)
  }

  // (C) work_piece_name 경유 세부 피삭재 ↔ 브랜드
  log(`\n## C. 세부 피삭재 (prod_series_work_material_status.work_piece_name) 전수\n`)
  const wpRows = await q(`
    SELECT work_piece_name, COUNT(DISTINCT prod_series_idx)::bigint AS series_cnt, COUNT(*)::bigint AS rows
    FROM raw_catalog.prod_series_work_material_status
    WHERE status IS NOT NULL AND status <> '' AND work_piece_name IS NOT NULL
    GROUP BY work_piece_name ORDER BY rows DESC
  `)
  log(`- distinct work_piece_name: ${wpRows.length}`)
  log("| work_piece_name | series_cnt | rows |")
  log("|---|---:|---:|")
  for (const r of wpRows.slice(0, 60)) log(`| ${r.work_piece_name} | ${r.series_cnt} | ${r.rows} |`)

  log(`\n## D. 세부 피삭재 → 브랜드 top (series_idx 조인)\n`)
  const targets = [
    { kr: "구리", expected: "CRX S / CRX-S", re: /copper|구리/i },
    { kr: "알루미늄", expected: "Alu-Cut / Alu-Power", re: /alumin|알루미/i },
    { kr: "티타늄", expected: "Titanox Power", re: /titan|티타/i },
    { kr: "스테인리스", expected: "(검증)", re: /stainless|스테인/i },
    { kr: "주철", expected: "(검증)", re: /cast\s*iron|ductile|nodular|주철/i },
    { kr: "열처리강/경화강", expected: "(검증)", re: /harden|HRC|열처리|경화/i },
    { kr: "탄소강", expected: "(검증)", re: /carbon\s*steel|탄소/i },
    { kr: "인코넬", expected: "(검증)", re: /inconel|인코/i },
    { kr: "합금강", expected: "(검증)", re: /alloy\s*steel|합금/i },
  ]
  for (const t of targets) {
    const matched = wpRows.filter(r => t.re.test(r.work_piece_name || "")).map(r => r.work_piece_name)
    log(`\n### ${t.kr} (기대: ${t.expected})`)
    log(`- 매칭된 work_piece_name: ${matched.length ? matched.map(m => `\`${m}\``).join(", ") : "없음"}`)
    if (!matched.length) continue
    const rows = await q(`
      SELECT p.edp_brand_name AS brand, COUNT(*)::bigint AS cnt
      FROM catalog_app.product_recommendation_mv p
      JOIN raw_catalog.prod_series_work_material_status w ON w.prod_series_idx = p.edp_series_idx
      WHERE w.work_piece_name = ANY($1)
        AND w.status IS NOT NULL AND w.status <> ''
        AND p.edp_brand_name IS NOT NULL
      GROUP BY p.edp_brand_name ORDER BY cnt DESC LIMIT 15
    `, [matched])
    const total = rows.reduce((s, r) => s + Number(r.cnt), 0)
    log(`- 전체 (브랜드 있는 건) 합계: ${total.toLocaleString()}`)
    if (!rows.length) { log(`- ⚠️ 데이터 없음`); continue }
    log("| brand | count | share |")
    log("|---|---:|---:|")
    for (const r of rows) log(`| ${r.brand} | ${r.cnt} | ${total ? (100*Number(r.cnt)/total).toFixed(1) : 0}% |`)
    const top3 = rows.slice(0, 3).map(r => String(r.brand).toLowerCase().replace(/[\s\-_]+/g, ""))
    if (!t.expected.includes("검증")) {
      const exp = t.expected.toLowerCase().split("/").map(s => s.trim().replace(/[\s\-_]+/g, ""))
      const hit = top3.some(b => exp.some(e => b.includes(e)))
      log(`- 판정: ${hit ? "✅ 기대 브랜드 top3 포함" : "🔴 기대 브랜드 top3 에 없음"}`)
    }
  }

  const outPath = path.join(process.cwd(), "reports", "db-labeling-audit-2.md")
  fs.writeFileSync(outPath, out.join("\n"), "utf8")
  console.error(`\n[saved] ${outPath}`)
  await c.end()
}
main().catch(e => { console.error(e); process.exit(1) })
