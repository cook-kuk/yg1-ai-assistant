/**
 * suchan_test_v2.xlsx — mv 기반 Ground Truth로 재작성
 *
 * v1과의 차이:
 *   - v1: raw_catalog.prod_edp_option_milling 직접 쿼리 (raw 71,705행, dedup 없음)
 *   - v2: catalog_app.product_recommendation_mv + DISTINCT ON normalized_code dedup
 *         → 2999/3000 finder가 실제로 보는 base pool과 동일
 *
 *   v1 dbCount는 raw 기준이라 finder의 candidateCount와 비교 불가능했음.
 *   v2는 mv-dedup 기준이므로 finder candidateCount와 직접 비교 가능.
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const SRC = path.join(dir, "suchan-finder-stress-2026-04-07T08-28-24-599Z.json")
const OUT = path.join(dir, "suchan_test_v1.xlsx")  // 사용자가 지정한 파일명으로 덮어쓰기
const data = JSON.parse(fs.readFileSync(SRC, "utf8"))

// ── mv 기반 SPECS ──
// 모든 쿼리는 다음 패턴으로 감싸서 finder dedup과 동일하게 카운트한다:
//   SELECT count(*) FROM (
//     SELECT DISTINCT ON (normalized_code) *
//     FROM catalog_app.product_recommendation_mv
//     WHERE <조건>
//     ORDER BY normalized_code, edp_idx DESC
//   ) x
const W = (cond) => `
SELECT count(*) FROM (
  SELECT DISTINCT ON (normalized_code) *
  FROM catalog_app.product_recommendation_mv
  WHERE ${cond}
  ORDER BY normalized_code, edp_idx DESC
) x`

// material_tags && ARRAY['P'] 식. 단일은 '=ANY(material_tags)' 가능
const matAny = (tags) => `material_tags && ARRAY[${tags.map((t) => `'${t}'`).join(",")}]::text[]`
// 재고 join (mv 의 edp_no 는 inventory_snapshot.normalized_edp 와 join)
const STOCK = `edp_no IN (SELECT DISTINCT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric > 0)`

// 카테고리 가드
const MILL = `edp_root_category='Milling'`
const HOLE = `edp_root_category='Holemaking'`
const THRD = `edp_root_category='Threading'`
const MF = `milling_number_of_flute ~ '^[0-9]+$'`
// 코팅: search_coating(normalized) 우선. TiAlN은 'TiAlN' 정확매칭 (AlTiN과 구분)
// uncoated: 'Bright Finish','UNCOATED' 또는 NULL
const UNCOATED = `(search_coating IS NULL OR search_coating IN ('Bright Finish','UNCOATED'))`

const SPECS = [
  // #1 Milling P φ10
  { sql: W(`${MILL} AND search_diameter_mm=10 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10  [search_diameter_mm=10]" },
  // #2 Milling P/M/K φ6
  { sql: W(`${MILL} AND search_diameter_mm=6 AND ${matAny(["P","M","K"])}`),
    label: "mv: Milling P/M/K φ6  [search_diameter_mm=6]" },
  // #3 Milling P φ8~12
  { sql: W(`${MILL} AND search_diameter_mm BETWEEN 8 AND 12 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ8~12  [BETWEEN 8 AND 12]" },
  // #4 Milling P φ10 OAL≥100
  { sql: W(`${MILL} AND search_diameter_mm=10 AND milling_overall_length ~ '^[0-9.]+$' AND milling_overall_length::numeric>=100 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 OAL≥100" },
  // #5 Milling P φ10 OAL≤80
  { sql: W(`${MILL} AND search_diameter_mm=10 AND milling_overall_length ~ '^[0-9.]+$' AND milling_overall_length::numeric<=80 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 OAL≤80" },
  // #6 Milling P φ10 4F
  { sql: W(`${MILL} AND search_diameter_mm=10 AND ${MF} AND milling_number_of_flute::int=4 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 4F" },
  // #7 Milling S φ12 ≥5F
  { sql: W(`${MILL} AND search_diameter_mm=12 AND ${MF} AND milling_number_of_flute::int>=5 AND ${matAny(["S"])}`),
    label: "mv: Milling S φ12 ≥5F" },
  // #8 Milling P φ8 T-Coating  (search_coating='T-Coating' 정확매칭)
  { sql: W(`${MILL} AND search_diameter_mm=8 AND search_coating='T-Coating' AND ${matAny(["P"])}`),
    label: "mv: Milling P φ8 T-Coating  [search_coating='T-Coating']" },
  // #9 Milling N φ6 uncoated
  { sql: W(`${MILL} AND search_diameter_mm=6 AND ${UNCOATED} AND ${matAny(["N"])}`),
    label: "mv: Milling N φ6 uncoated  [search_coating IN ('Bright Finish','UNCOATED') OR NULL]" },
  // #10 Milling P φ10 +재고
  { sql: W(`${MILL} AND search_diameter_mm=10 AND ${matAny(["P"])} AND ${STOCK}`),
    label: "mv: Milling P φ10 + 재고>0" },
  // #11 Milling M φ8 +재고
  { sql: W(`${MILL} AND search_diameter_mm=8 AND ${matAny(["M"])} AND ${STOCK}`),
    label: "mv: Milling M φ8 + 재고>0" },
  // #12 X5070 brand φ10
  { sql: W(`${MILL} AND search_diameter_mm=10 AND (edp_brand_name ILIKE '%X5070%' OR series_brand_name ILIKE '%X5070%')`),
    label: "mv: Milling X5070 brand φ10" },
  // #13 Milling N φ8 not ALU-POWER
  { sql: W(`${MILL} AND search_diameter_mm=8 AND ${matAny(["N"])} AND COALESCE(edp_brand_name,'') NOT ILIKE '%ALU-POWER%' AND COALESCE(series_brand_name,'') NOT ILIKE '%ALU-POWER%'`),
    label: "mv: Milling N φ8 not ALU-POWER" },
  // #14 Milling P φ10 4F OAL≥100 TiAlN  (TiAlN 정확매칭, AlTiN 제외)
  { sql: W(`${MILL} AND search_diameter_mm=10 AND ${MF} AND milling_number_of_flute::int=4 AND milling_overall_length ~ '^[0-9.]+$' AND milling_overall_length::numeric>=100 AND search_coating='TiAlN' AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 4F OAL≥100 TiAlN  [search_coating='TiAlN']" },
  // #15 Milling P/M φ8-12 4F OAL≥80 TiAlN +재고
  { sql: W(`${MILL} AND search_diameter_mm BETWEEN 8 AND 12 AND ${MF} AND milling_number_of_flute::int=4 AND milling_overall_length ~ '^[0-9.]+$' AND milling_overall_length::numeric>=80 AND search_coating='TiAlN' AND ${matAny(["P","M"])} AND ${STOCK}`),
    label: "mv: Milling P/M φ8-12 4F OAL≥80 TiAlN +재고" },
  // #16 Milling P φ10 helix≥45
  { sql: W(`${MILL} AND search_diameter_mm=10 AND milling_helix_angle ~ '^[0-9.]+$' AND milling_helix_angle::numeric>=45 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 helix≥45" },
  // #17 Milling P φ8 shank 6-10
  { sql: W(`${MILL} AND search_diameter_mm=8 AND milling_shank_dia ~ '^[0-9.]+$' AND milling_shank_dia::numeric BETWEEN 6 AND 10 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ8 shank 6-10" },
  // #18 Milling P φ10 CL≥20
  { sql: W(`${MILL} AND search_diameter_mm=10 AND milling_length_of_cut ~ '^[0-9.]+$' AND milling_length_of_cut::numeric>=20 AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 CL≥20" },
  // #19 Holemaking P φ8 (point=140 컬럼 없음 → 직경+P만, 상한선)
  { sql: W(`${HOLE} AND search_diameter_mm=8 AND ${matAny(["P"])}`),
    label: "mv: Holemaking P φ8  ⚠️상한선",
    note: "mv에 point_angle 컬럼 없음 — 진짜 ground truth는 더 작음" },
  // #20 Holemaking P φ10 OAL≥100 +coolant
  { sql: W(`${HOLE} AND search_diameter_mm=10 AND holemaking_overall_length ~ '^[0-9.]+$' AND holemaking_overall_length::numeric>=100 AND holemaking_coolant_hole IS NOT NULL AND TRIM(holemaking_coolant_hole) <> '' AND ${matAny(["P"])}`),
    label: "mv: Holemaking P φ10 OAL≥100 +coolant" },
  // #21 Threading P M10 (pitch 컬럼 없음 → 직경+P만, 상한선)
  { sql: W(`${THRD} AND search_diameter_mm=10 AND ${matAny(["P"])}`),
    label: "mv: Threading P M10  ⚠️상한선",
    note: "mv에 threading_pitch 컬럼 없음 — 진짜 ground truth는 더 작음" },
  // #22 φ=999
  { sql: W(`${MILL} AND search_diameter_mm=999`),
    label: "mv: Milling φ=999", expectZero: true },
  // #23 모순 ≥20 ∧ ≤5
  { sql: W(`${MILL} AND search_diameter_mm>=20 AND search_diameter_mm<=5`),
    label: "mv: Milling 모순 φ≥20 ∧ φ≤5", expectZero: true },
  // #24 1/4인치 (6.35mm) 4F P
  { sql: W(`${MILL} AND search_diameter_mm BETWEEN 6.3 AND 6.4 AND ${MF} AND milling_number_of_flute::int=4 AND ${matAny(["P"])}`),
    label: "mv: Milling P 6.35mm 4F  [search_diameter_mm BETWEEN 6.3 AND 6.4]" },
  // #25 KOREA + φ10 4F TiAlN OAL≥100 P
  { sql: W(`${MILL} AND search_diameter_mm=10 AND ${MF} AND milling_number_of_flute::int=4 AND milling_overall_length ~ '^[0-9.]+$' AND milling_overall_length::numeric>=100 AND search_coating='TiAlN' AND COALESCE(country,'') ILIKE '%KOREA%' AND ${matAny(["P"])}`),
    label: "mv: Milling P φ10 4F TiAlN OAL≥100 KOREA" },
]

function caseVerdict(spec, dbCount, ep) {
  if (ep == null) ep = 0
  if (spec.expectZero) {
    return ep === 0
      ? { tag: "✅정확", note: `DB ${dbCount} = ep 0` }
      : { tag: "❌오탐", note: `DB ${dbCount} → ep ${ep}` }
  }
  if (dbCount === 0 && ep === 0) return { tag: "✅정확", note: "둘 다 0" }
  if (dbCount === 0 && ep > 0) return { tag: "❌오탐", note: `DB 0 / ep ${ep}` }
  if (dbCount > 0 && ep === 0) return { tag: "❌누락", note: `DB ${dbCount} / ep 0` }
  if (dbCount >= 50 && ep >= 50) return { tag: "✅정확", note: `DB ${dbCount} / cap 50` }
  if (Math.abs(ep - dbCount) <= Math.max(2, dbCount * 0.15)) return { tag: "✅정확", note: `DB ${dbCount} / ep ${ep}` }
  if (ep > dbCount * 1.5) return { tag: "⚠️과다", note: `DB ${dbCount} / ep ${ep}` }
  if (ep < dbCount * 0.5) return { tag: "⚠️과소", note: `DB ${dbCount} / ep ${ep}` }
  return { tag: "🟡차이", note: `DB ${dbCount} / ep ${ep}` }
}

async function main() {
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()

  // base pool 정보
  const basePoolRow = (await c.query(`SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' ORDER BY normalized_code, edp_idx DESC) x`)).rows[0]
  const basePool = parseInt(basePoolRow.count, 10)

  const verified = []
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i]
    const spec = SPECS[i] || { sql: "SELECT 0 AS count", label: "(없음)" }
    let dbCount = null
    try { dbCount = parseInt((await c.query(spec.sql)).rows[0].count, 10) }
    catch (e) { dbCount = `ERR:${e.message.slice(0, 60)}` }
    const v = typeof dbCount === "number" ? caseVerdict(spec, dbCount, r.candidateCount) : { tag: "❓DB오류", note: dbCount }
    verified.push({ ...r, dbCount: typeof dbCount === "number" ? dbCount : null, dbLabel: spec.label, dbNote: spec.note || "", sql: spec.sql, verdict: v.tag, verdictNote: v.note })
  }
  await c.end()

  const wb = new ExcelJS.Workbook()
  const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } }
  const G = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }
  const R = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
  const Y = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } }
  const GY = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }
  const TI = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1C4E9" } }
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
  const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
  const FT = { name: "Malgun Gothic", size: 10 }
  const FTB = { name: "Malgun Gothic", size: 10, bold: true }

  // ─ 시트1: 설명 ─
  const s0 = wb.addWorksheet("📖 설명", { views: [{ state: "frozen", ySplit: 0 }] })
  s0.columns = [{ width: 22 }, { width: 100 }]
  const sec = (label) => {
    const row = s0.addRow([label, ""])
    s0.mergeCells(`A${row.number}:B${row.number}`)
    row.getCell(1).fill = TI
    row.getCell(1).font = { name: "Malgun Gothic", size: 12, bold: true, color: { argb: "FF1A237E" } }
    row.height = 26
  }
  const kv = (k, v) => {
    const row = s0.addRow([k, v])
    row.getCell(1).font = FTB; row.getCell(2).font = FT
    row.getCell(1).border = BD; row.getCell(2).border = BD
    row.getCell(2).alignment = { vertical: "middle", wrapText: true }
    row.height = Math.max(20, Math.ceil(String(v).length / 90) * 18)
  }
  s0.mergeCells("A1:B1")
  s0.getCell("A1").value = "수찬님 Product Finder 검증 v2 (mv-dedup ground truth)"
  s0.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s0.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s0.getRow(1).height = 36
  s0.addRow([])
  sec("v1 검증 정밀도 정책")
  kv("핵심", "finder(:3000)가 실제로 보는 mv + dedup + search_* normalized 컬럼 기반으로 ground truth 산출")
  kv("base", "catalog_app.product_recommendation_mv + DISTINCT ON normalized_code")
  kv("직경", "search_diameter_mm (NUMERIC) — 단위/text 캐스트 문제 회피, 6.35mm 등 inch도 정확 매칭")
  kv("코팅", "search_coating (normalized) — 'T-Coating','TiAlN','Bright Finish','UNCOATED' 등 정확매칭. TiAlN ≠ AlTiN 구분")
  kv("소재", "material_tags::text[] (P/M/K/N/S/H 대문자)")
  kv("재고", "edp_no IN (SELECT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric>0)")
  kv("base pool", `Milling dedup 기준 ${basePool}개 (UI '33728→' 화면과 정확 일치)`)
  s0.addRow([])
  sec("DB 정보")
  kv("호스트", "20.119.98.136:5432 / smart_catalog / smart_catalog")
  kv("주 테이블", "catalog_app.product_recommendation_mv (mv)")
  kv("dedup 키", "normalized_code (= REPLACE(REPLACE(UPPER(edp_no),' ',''),'-',''))")
  kv("소재", "material_tags::text[] && ARRAY['P'] (P/M/K/N/S/H)")
  kv("재고", "edp_no IN (SELECT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity>0)")
  kv("국가", "country (콤마구분 텍스트) ILIKE '%KOREA%'")
  s0.addRow([])
  sec("⚠️ mv에 컬럼이 없는 케이스")
  kv("#19 point=140", "mv에 holemaking_point_angle 없음 → 직경+소재만 카운트")
  kv("#21 pitch 1.5", "mv에 threading_pitch 없음 → 직경+소재만 카운트")
  kv("의미", "이 두 케이스는 endpoint가 더 작게 나와야 정상 (mv ground truth는 상한선)")
  s0.addRow([])
  sec("verdict 정의")
  kv("✅정확", "DB ≈ ep (오차 ≤ max(2, 15%)) 또는 둘 다 ≥50 cap 도달")
  kv("❌오탐", "DB=0인데 ep>0 (있지도 않은 결과를 반환)")
  kv("❌누락", "DB>0인데 ep=0 (라우팅/카테고리 죽음)")
  kv("⚠️과다", "ep > DB×1.5 (필터 무시 의심)")
  kv("⚠️과소", "ep < DB×0.5 (좋은 후보를 못 보여줌)")
  kv("🟡차이", "기타 작은 차이")
  s0.addRow([])

  const correct = verified.filter(r => r.verdict.startsWith("✅")).length
  const wrong = verified.filter(r => r.verdict.startsWith("❌")).length
  const warn = verified.filter(r => r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")).length
  sec("종합 결과")
  kv("케이스 verdict", `✅${correct} / ❌${wrong} / ⚠️🟡${warn}  (총 ${verified.length})`)

  // ─ 시트2: DB 검증 결과 ─
  const s1 = wb.addWorksheet("DB 검증 결과 v2", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:I1")
  s1.getCell("A1").value = "케이스별 DB 검증 (mv-dedup ground truth)"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center" }
  s1.getRow(1).height = 30
  s1.mergeCells("A2:I2")
  s1.getCell("A2").value = `Endpoint: ${data.target} | DB: catalog_app.product_recommendation_mv (dedup) | base=${basePool} | ✅${correct} ❌${wrong} ⚠️${warn}/${verified.length}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF555555" } })
  s1.getCell("A2").alignment = { horizontal: "center" }
  s1.columns = [{ width: 5 }, { width: 36 }, { width: 38 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 42 }, { width: 32 }, { width: 8 }]
  const hdrs = ["#", "케이스", "메시지", "DB", "EP", "verdict", "DB filter (mv)", "비고", "ms"]
  const hr1 = s1.getRow(3)
  hdrs.forEach((h, i) => {
    const c = hr1.getCell(i + 1); c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr1.height = 24
  verified.forEach((r, i) => {
    const row = s1.getRow(i + 4)
    row.values = [i + 1, r.name, r.msg, r.dbCount ?? "", r.candidateCount ?? 0, r.verdict, r.dbLabel, r.verdictNote + (r.dbNote ? `  · ${r.dbNote}` : ""), r.ms]
    let fill = GY
    if (r.verdict.startsWith("✅")) fill = G
    else if (r.verdict.startsWith("❌")) fill = R
    else if (r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")) fill = Y
    row.getCell(6).fill = fill
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 32
  })

  // ─ 시트3: SQL 명세 ─
  const s2 = wb.addWorksheet("SQL 명세 v2", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [{ header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "DB filter", width: 42 }, { header: "SQL (재현용)", width: 140 }]
  const hr2 = s2.getRow(1)
  hr2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  verified.forEach((r, i) => {
    const row = s2.getRow(i + 2)
    row.values = [i + 1, r.name, r.dbLabel, r.sql]
    row.eachCell(c => { c.border = BD; c.font = { name: "Consolas", size: 9 }; c.alignment = { vertical: "top", wrapText: true } })
    row.height = 70
  })

  // 콘솔 요약
  console.log("\n=== v2 결과 요약 ===")
  console.log(`base Milling pool (dedup): ${basePool}`)
  verified.forEach((r, i) => {
    console.log(`#${(i + 1).toString().padStart(2)} ${r.verdict}  DB=${String(r.dbCount).padStart(5)}  EP=${String(r.candidateCount ?? 0).padStart(4)}  ${r.name}`)
  })
  console.log(`\n케이스 verdict: ✅${correct} / ❌${wrong} / ⚠️🟡${warn}  (총 ${verified.length})`)

  await wb.xlsx.writeFile(OUT)
  console.log("\nxlsx →", OUT)
}

main().catch(e => { console.error(e); process.exit(1) })
