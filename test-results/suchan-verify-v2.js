/**
 * v2: raw_catalog 테이블 기준 정확한 ground truth 검증
 *
 * 핵심 테이블:
 *  - raw_catalog.prod_edp_option_milling/holemaking/threading/turning/tooling (95k/52k/33k/78k/72k)
 *  - raw_catalog.prod_series (23k) — series_idx ↔ tool_type/category
 *  - raw_catalog.prod_series_work_material_status — material P/M/K... 매핑
 *  - catalog_app.inventory_snapshot — 재고
 *
 * 모든 numeric 컬럼은 text라 ::numeric cast 필요. flag_del='N'으로 살아있는 것만.
 *
 * usage: node test-results/suchan-verify-v2.js [src.json] [out.xlsx]
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const arg = process.argv[2]
const srcJson = arg
  ? path.resolve(arg)
  : fs.readdirSync(dir)
      .filter(f => /^suchan-finder-stress-.*\.json$/.test(f) && !f.includes("verified"))
      .sort()
      .map(f => path.join(dir, f))
      .filter(p => {
        try { return JSON.parse(fs.readFileSync(p, "utf8")).target?.includes("20.119") }
        catch { return false }
      })
      .pop()

if (!srcJson) { console.error("source json not found"); process.exit(1) }
console.log("source:", srcJson)

const data = JSON.parse(fs.readFileSync(srcJson, "utf8"))
const outXlsx = process.argv[3] || srcJson.replace(/\.json$/, "-verified-v2.xlsx")

// ── helper: material P join 서브쿼리 ──
// prod_series_work_material_status 에서 status가 NULL/공백이 아니면 적용 가능 소재로 본다.
const matJoin = (tags) => `COALESCE(series_idx,'') <> '' AND series_idx::int IN (SELECT prod_series_idx::int FROM raw_catalog.prod_series_work_material_status WHERE flag_del='N' AND COALESCE(prod_series_idx,'') <> '' AND TRIM(COALESCE(status,'')) <> '' AND TRIM(tag_name) IN (${tags.map(t => `'${t}'`).join(",")}))`

// 재고 있는 series_idx (시리즈 단위로 본다 — edp 매칭은 normalize 이슈 있음)
const stockJoin = (edpCol) => `${edpCol} IN (SELECT DISTINCT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric > 0)`

// 활성 row 기본 조건
const ALIVE = `flag_del='N'`

// ── 25 케이스 SQL 명세 ──
const SPECS = [
  // 1. P 슬로팅 endmill 10mm
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])}`,
    label: "milling P φ10" },
  // 2. P+M+K 6mm
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=6 AND ${matJoin(["P","M","K"])}`,
    label: "milling P/M/K φ6" },
  // 3. 직경 8~12
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND ${matJoin(["P"])}`,
    label: "milling P φ8~12" },
  // 4. OAL ≥100
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND ${matJoin(["P"])}`,
    label: "milling P φ10 OAL≥100" },
  // 5. OAL ≤80
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric<=80 AND ${matJoin(["P"])}`,
    label: "milling P φ10 OAL≤80" },
  // 6. 4F
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}`,
    label: "milling P φ10 4F" },
  // 7. 5F+ S 12mm
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=12 AND option_milling_numberofflute ~ '^[0-9]+$' AND option_milling_numberofflute::int>=5 AND ${matJoin(["S"])}`,
    label: "milling S φ12 ≥5F" },
  // 8. T-Coating
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=8 AND option_milling_coating ILIKE '%T-Coating%' AND ${matJoin(["P"])}`,
    label: "milling P φ8 T-Coating" },
  // 9. uncoated
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=6 AND (option_milling_coating IS NULL OR TRIM(option_milling_coating)='' OR option_milling_coating ILIKE '%bright%' OR option_milling_coating ILIKE '%uncoat%') AND ${matJoin(["N"])}`,
    label: "milling N φ6 uncoated/bright" },
  // 10. 재고 있는 것
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])} AND ${stockJoin("m.edp_no")}`,
    label: "milling P φ10 + 재고>0" },
  // 11. 재고 즉시 출하 (≡ 재고)
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=8 AND ${matJoin(["M"])} AND ${stockJoin("m.edp_no")}`,
    label: "milling M φ8 + 재고>0" },
  // 12. X5070 brand (X5070은 series가 아니라 brand_name)
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND brand_name ILIKE '%X5070%' AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10`,
    label: "X5070 brand milling φ10" },
  // 13. ALU-POWER 제외
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=8 AND ${matJoin(["N"])} AND COALESCE(brand_name,'') NOT ILIKE '%ALU-POWER%'`,
    label: "milling N φ8 not ALU-POWER" },
  // 14. 4중 P φ10 4F OAL≥100 TiAlN
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P"])}`,
    label: "milling P φ10 4F OAL≥100 TiAlN" },
  // 15. 5중 + 재고
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=80 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P","M"])} AND ${stockJoin("m.edp_no")}`,
    label: "milling P/M φ8-12 4F OAL≥80 TiAlN 재고" },
  // 16. 헬릭스 ≥45°
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_helixangle ~ '^[0-9.]+$' AND option_milling_helixangle::numeric>=45 AND ${matJoin(["P"])}`,
    label: "milling P φ10 helix≥45" },
  // 17. shank 6~10
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=8 AND option_milling_shankdia ~ '^[0-9.]+$' AND option_milling_shankdia::numeric BETWEEN 6 AND 10 AND ${matJoin(["P"])}`,
    label: "milling P φ8 shank 6-10" },
  // 18. CL ≥20
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_lengthofcut ~ '^[0-9.]+$' AND option_milling_lengthofcut::numeric>=20 AND ${matJoin(["P"])}`,
    label: "milling P φ10 CL≥20" },
  // 19. drill point 140°
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=8 AND option_holemaking_pointangle ~ '140' AND ${matJoin(["P"])}`,
    label: "holemaking P φ8 pointangle=140" },
  // 20. drill OAL≥100 + 쿨런트홀
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=10 AND option_holemaking_overalllength ~ '^[0-9.]+$' AND option_holemaking_overalllength::numeric>=100 AND option_holemaking_coolanthole IN ('External','Internal','O') AND ${matJoin(["P"])}`,
    label: "holemaking P φ10 OAL≥100 + coolant" },
  // 21. tap M10 1.5pitch
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_threading WHERE ${ALIVE} AND option_threading_outsidedia ~ '^[0-9.]+$' AND option_threading_outsidedia::numeric=10 AND option_threading_pitch IN ('1.5','1.50') AND ${matJoin(["P"])}`,
    label: "threading P M10 P1.5" },
  // 22. 999mm
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=999`,
    label: "milling φ=999", expectZero: true },
  // 23. 모순
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric>=20 AND option_milling_outsidedia::numeric<=5`,
    label: "φ≥20 AND φ≤5", expectZero: true },
  // 24. 1/4인치 = 6.35
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric BETWEEN 6.3 AND 6.4 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}`,
    label: "milling P 6.35mm 4F" },
  // 25. KOREA + 풀필터 (country 필터 추가)
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND option_milling_outsidedia ~ '^[0-9.]+$' AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND COALESCE(country,'') ILIKE '%KOR%' AND ${matJoin(["P"])}`,
    label: "milling P φ10 4F TiAlN OAL≥100 KOREA" },
]

function verdict(spec, dbCount, suchanCount) {
  if (suchanCount == null) suchanCount = 0
  if (spec.expectZero) {
    return suchanCount === 0
      ? { tag: "✅정확", note: `DB ${dbCount} = endpoint 0` }
      : { tag: "❌오탐", note: `DB ${dbCount} → endpoint ${suchanCount}` }
  }
  if (dbCount === 0 && suchanCount === 0) return { tag: "✅정확", note: "둘 다 0" }
  if (dbCount === 0 && suchanCount > 0)
    return { tag: "❌오탐", note: `DB 0 / endpoint ${suchanCount}` }
  if (dbCount > 0 && suchanCount === 0)
    return { tag: "❌누락", note: `DB ${dbCount} / endpoint 0` }
  if (dbCount >= 50 && suchanCount >= 50) return { tag: "✅정확", note: `DB ${dbCount} / endpoint cap 50` }
  if (Math.abs(suchanCount - dbCount) <= Math.max(2, dbCount * 0.15))
    return { tag: "✅정확", note: `DB ${dbCount} / endpoint ${suchanCount}` }
  if (suchanCount > dbCount * 1.5)
    return { tag: "⚠️과다", note: `DB ${dbCount} / endpoint ${suchanCount}` }
  if (suchanCount < dbCount * 0.5)
    return { tag: "⚠️과소", note: `DB ${dbCount} / endpoint ${suchanCount}` }
  return { tag: "🟡차이", note: `DB ${dbCount} / endpoint ${suchanCount}` }
}

async function main() {
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()
  console.log("DB connected. Running 25 ground-truth queries against raw_catalog.*\n")

  const verified = []
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i]
    const spec = SPECS[i]
    let dbCount = null, dbErr = null
    try {
      const q = await c.query(spec.sql)
      dbCount = parseInt(q.rows[0].count, 10)
    } catch (e) { dbErr = e.message }
    const v = dbErr
      ? { tag: "❓DB오류", note: dbErr.slice(0, 120) }
      : verdict(spec, dbCount, r.candidateCount)
    verified.push({ ...r, dbCount, dbLabel: spec.label, verdict: v.tag, verdictNote: v.note, sql: spec.sql })
    console.log(`[${String(i + 1).padStart(2, "0")}] ${r.name.slice(0, 38).padEnd(38)} DB=${String(dbCount ?? "-").padStart(5)} EP=${String(r.candidateCount ?? 0).padStart(3)}  ${v.tag}`)
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

  // Sheet 1: 검증 결과
  const s1 = wb.addWorksheet("DB 검증 결과", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:L1")
  s1.getCell("A1").value = "수찬님 Product Finder × DB Ground Truth (raw_catalog 기준)"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 32
  s1.mergeCells("A2:L2")
  s1.getCell("A2").value = `Endpoint: ${data.target} | DB: smart_catalog (milling 95k + holemaking 52k + threading 33k + turning 78k + tooling 72k + inventory 115k) | RunAt: ${new Date().toISOString()}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF757575" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [
    { width: 5 }, { width: 36 }, { width: 38 }, { width: 8 },
    { width: 9 }, { width: 6 }, { width: 12 }, { width: 42 }, { width: 38 },
    { width: 18 }, { width: 8 }, { width: 6 },
  ]
  const headers = ["#", "케이스", "메시지", "ms", "DB", "EP", "verdict", "DB filter", "비고", "top1 series", "φ", "F"]
  const hr = s1.getRow(3)
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1)
    c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr.height = 24

  verified.forEach((r, i) => {
    const row = s1.getRow(i + 4)
    const t1 = r.sampleProducts[0] || {}
    row.values = [
      i + 1, r.name, r.msg, r.ms,
      r.dbCount ?? "", r.candidateCount ?? 0,
      r.verdict, r.dbLabel, r.verdictNote,
      t1.series ?? "", t1.diameterMm ?? "", t1.fluteCount ?? "",
    ]
    let fill = null
    if (r.verdict.startsWith("✅")) fill = G
    else if (r.verdict.startsWith("❌")) fill = R
    else if (r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")) fill = Y
    else fill = GY
    row.getCell(7).fill = fill
    for (let cc = 1; cc <= 12; cc++) {
      row.getCell(cc).border = BD
      row.getCell(cc).font = FT
      row.getCell(cc).alignment = { vertical: "middle", wrapText: true }
    }
    row.height = 32
  })

  const total = verified.length
  const correct = verified.filter(r => r.verdict.startsWith("✅")).length
  const wrong = verified.filter(r => r.verdict.startsWith("❌")).length
  const warn = verified.filter(r => r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")).length
  const err = verified.filter(r => r.verdict.startsWith("❓")).length
  const sumRow = total + 5
  s1.mergeCells(`A${sumRow}:L${sumRow}`)
  const sc = s1.getCell(`A${sumRow}`)
  sc.value = `통계  ✅정확 ${correct}/${total}   ❌오류 ${wrong}/${total}   ⚠️차이 ${warn}/${total}   ❓DB오류 ${err}/${total}`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 12, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(sumRow).height = 28

  // Sheet 2: SQL (재현용)
  const s2 = wb.addWorksheet("SQL 명세", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [{ header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "DB filter", width: 42 }, { header: "SQL", width: 130 }]
  const h2 = s2.getRow(1)
  h2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  verified.forEach((r, i) => {
    const row = s2.getRow(i + 2)
    row.values = [i + 1, r.name, r.dbLabel, r.sql]
    row.eachCell(c => { c.border = BD; c.font = { name: "Consolas", size: 9 }; c.alignment = { vertical: "top", wrapText: true } })
    row.height = 60
  })

  // Sheet 3: top-3 sample
  const s3 = wb.addWorksheet("Top-3 샘플", { views: [{ state: "frozen", ySplit: 1 }] })
  s3.columns = [
    { header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "rank", width: 6 },
    { header: "series", width: 18 }, { header: "brand", width: 22 }, { header: "φ", width: 8 },
    { header: "F", width: 6 }, { header: "OAL", width: 8 }, { header: "CL", width: 8 },
    { header: "coating", width: 18 },
  ]
  const h3 = s3.getRow(1)
  h3.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  let r3 = 2
  verified.forEach((r, i) => {
    const samples = r.sampleProducts.length ? r.sampleProducts : [{}]
    samples.forEach((p, j) => {
      const row = s3.getRow(r3++)
      row.values = [j === 0 ? i + 1 : "", j === 0 ? r.name : "", j + 1,
        p.series ?? "", p.brand ?? "", p.diameterMm ?? "", p.fluteCount ?? "",
        p.oal ?? "", p.cl ?? "", p.coating ?? ""]
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle" } })
    })
  })

  await wb.xlsx.writeFile(outXlsx)
  console.log("\nxlsx →", outXlsx)
  console.log(`✅${correct} ❌${wrong} ⚠️${warn} ❓${err} / ${total}`)
}

main().catch(e => { console.error(e); process.exit(1) })
