/**
 * suchan v1 vs v2 diff xlsx
 * usage: node test-results/build-suchan-diff.js
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const V1 = path.join(dir, "suchan-finder-stress-2026-04-07T08-28-24-599Z.json")
const V2 = path.join(dir, "suchan-finder-stress-2026-04-07T11-04-19-972Z.json")
const OUT = path.join(dir, "suchan_test_diff_v1_v2.xlsx")

// Reuse SPECS from build-suchan-final
const ALIVE = `flag_del='N'`
const matJoin = (tags) => `COALESCE(series_idx,'') <> '' AND series_idx::int IN (SELECT prod_series_idx::int FROM raw_catalog.prod_series_work_material_status WHERE flag_del='N' AND COALESCE(prod_series_idx,'') <> '' AND TRIM(COALESCE(status,'')) <> '' AND TRIM(tag_name) IN (${tags.map(t => `'${t}'`).join(",")}))`
const stockJoin = (edpCol) => `${edpCol} IN (SELECT DISTINCT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric > 0)`
const D = `option_milling_outsidedia ~ '^[0-9.]+$'`

const SPECS = [
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=6 AND ${matJoin(["P","M","K"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric<=80 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=12 AND option_milling_numberofflute ~ '^[0-9]+$' AND option_milling_numberofflute::int>=5 AND ${matJoin(["S"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND option_milling_coating ILIKE '%T-Coating%' AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=6 AND (option_milling_coating IS NULL OR TRIM(option_milling_coating)='' OR option_milling_coating ILIKE '%bright%' OR option_milling_coating ILIKE '%uncoat%') AND ${matJoin(["N"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])} AND ${stockJoin("m.edp_no")}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND ${matJoin(["M"])} AND ${stockJoin("m.edp_no")}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND brand_name ILIKE '%X5070%' AND ${D} AND option_milling_outsidedia::numeric=10` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND ${matJoin(["N"])} AND COALESCE(brand_name,'') NOT ILIKE '%ALU-POWER%'` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=80 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P","M"])} AND ${stockJoin("m.edp_no")}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_helixangle ~ '^[0-9.]+$' AND option_milling_helixangle::numeric>=45 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND option_milling_shankdia ~ '^[0-9.]+$' AND option_milling_shankdia::numeric BETWEEN 6 AND 10 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_lengthofcut ~ '^[0-9.]+$' AND option_milling_lengthofcut::numeric>=20 AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=8 AND option_holemaking_pointangle ~ '140' AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=10 AND option_holemaking_overalllength ~ '^[0-9.]+$' AND option_holemaking_overalllength::numeric>=100 AND option_holemaking_coolanthole IN ('External','Internal','O') AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_threading WHERE ${ALIVE} AND option_threading_outsidedia ~ '^[0-9.]+$' AND option_threading_outsidedia::numeric=10 AND option_threading_pitch IN ('1.5','1.50') AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=999`, expectZero: true },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric>=20 AND option_milling_outsidedia::numeric<=5`, expectZero: true },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 6.3 AND 6.4 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}` },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND COALESCE(country,'') ILIKE '%KOR%' AND ${matJoin(["P"])}` },
]

function caseVerdict(spec, dbCount, ep) {
  if (ep == null) ep = 0
  if (spec.expectZero) return ep === 0 ? "✅정확" : "❌오탐"
  if (dbCount === 0 && ep === 0) return "✅정확"
  if (dbCount === 0 && ep > 0) return "❌오탐"
  if (dbCount > 0 && ep === 0) return "❌누락"
  if (dbCount >= 50 && ep >= 50) return "✅정확"
  if (Math.abs(ep - dbCount) <= Math.max(2, dbCount * 0.15)) return "✅정확"
  if (ep > dbCount * 1.5) return "⚠️과다"
  if (ep < dbCount * 0.5) return "⚠️과소"
  return "🟡차이"
}

function changeTag(v1, v2) {
  if (v1 === v2) return "= 동일"
  const score = v => v.startsWith("✅") ? 3 : v.startsWith("🟡") ? 2 : v.startsWith("⚠️") ? 1 : 0
  const s1 = score(v1), s2 = score(v2)
  if (s2 > s1) return "↑ 개선"
  if (s2 < s1) return "↓ 회귀"
  return "↔ 변경"
}

async function main() {
  const v1 = JSON.parse(fs.readFileSync(V1, "utf8"))
  const v2 = JSON.parse(fs.readFileSync(V2, "utf8"))
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()

  const rows = []
  for (let i = 0; i < v1.results.length; i++) {
    const r1 = v1.results[i], r2 = v2.results[i]
    const spec = SPECS[i]
    let db = null
    try { db = parseInt((await c.query(spec.sql)).rows[0].count, 10) } catch { db = null }
    const v1Verdict = db == null ? "❓" : caseVerdict(spec, db, r1.candidateCount)
    const v2Verdict = db == null ? "❓" : caseVerdict(spec, db, r2.candidateCount)
    rows.push({
      i: i + 1, name: r1.name, db,
      v1Cand: r1.candidateCount, v2Cand: r2.candidateCount,
      v1Verdict, v2Verdict,
      change: changeTag(v1Verdict, v2Verdict),
      v1Ms: r1.ms, v2Ms: r2.ms,
    })
  }
  await c.end()

  // ── xlsx ──
  const wb = new ExcelJS.Workbook()
  const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } }
  const G = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }
  const R = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
  const Y = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } }
  const GY = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }
  const LB = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } }
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
  const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
  const FT = { name: "Malgun Gothic", size: 10 }

  const s = wb.addWorksheet("v1 vs v2 diff", { views: [{ state: "frozen", ySplit: 3 }] })
  s.mergeCells("A1:J1")
  s.getCell("A1").value = "수찬님 endpoint v1 vs v2 비교"
  s.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s.getRow(1).height = 30

  const improved = rows.filter(r => r.change.startsWith("↑")).length
  const regressed = rows.filter(r => r.change.startsWith("↓")).length
  const same = rows.filter(r => r.change.startsWith("=")).length
  const sideways = rows.filter(r => r.change.startsWith("↔")).length
  s.mergeCells("A2:J2")
  s.getCell("A2").value = `v1: ${path.basename(V1)} | v2: ${path.basename(V2)} | ↑개선 ${improved} / ↓회귀 ${regressed} / =동일 ${same} / ↔변경 ${sideways}`
  s.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF555555" } })
  s.getCell("A2").alignment = { horizontal: "center" }

  s.columns = [
    { width: 5 }, { width: 36 }, { width: 8 },
    { width: 9 }, { width: 9 }, { width: 11 }, { width: 11 },
    { width: 12 }, { width: 10 }, { width: 10 },
  ]
  const hdrs = ["#", "케이스", "DB", "v1 cand", "v2 cand", "v1 verdict", "v2 verdict", "change", "v1 ms", "v2 ms"]
  const hr = s.getRow(3)
  hdrs.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr.height = 24

  const verdictFill = v => {
    if (v.startsWith("✅")) return G
    if (v.startsWith("❌")) return R
    if (v.startsWith("⚠️") || v.startsWith("🟡")) return Y
    return GY
  }
  const changeFill = c => {
    if (c.startsWith("↑")) return G
    if (c.startsWith("↓")) return R
    if (c.startsWith("↔")) return Y
    return GY
  }

  rows.forEach((r, i) => {
    const row = s.getRow(i + 4)
    row.values = [r.i, r.name, r.db ?? "", r.v1Cand ?? 0, r.v2Cand ?? 0, r.v1Verdict, r.v2Verdict, r.change, r.v1Ms, r.v2Ms]
    row.getCell(6).fill = verdictFill(r.v1Verdict)
    row.getCell(7).fill = verdictFill(r.v2Verdict)
    row.getCell(8).fill = changeFill(r.change)
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 26
  })

  // 통계 행
  const sumRow = rows.length + 5
  s.mergeCells(`A${sumRow}:J${sumRow}`)
  const sc = s.getCell(`A${sumRow}`)
  const v1Avg = Math.round(rows.reduce((s, r) => s + r.v1Ms, 0) / rows.length)
  const v2Avg = Math.round(rows.reduce((s, r) => s + r.v2Ms, 0) / rows.length)
  sc.value = `↑개선 ${improved}   ↓회귀 ${regressed}   =동일 ${same}   ↔변경 ${sideways}     |     avg latency  v1 ${v1Avg}ms → v2 ${v2Avg}ms (${v2Avg > v1Avg ? "+" : ""}${v2Avg - v1Avg}ms)`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 12, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s.getRow(sumRow).height = 28

  await wb.xlsx.writeFile(OUT)
  console.log("xlsx →", OUT)
  console.log(`↑${improved} ↓${regressed} =${same} ↔${sideways}`)
}

main().catch(e => { console.error(e); process.exit(1) })
