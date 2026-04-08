/**
 * Multi-turn 결과 + DB ground truth → xlsx 3개:
 *   1. suchan_test_v3_multiturn.xlsx
 *   2. main_test_v1_multiturn.xlsx
 *   3. suchan_vs_main_multiturn.xlsx
 *
 * 비교 기준: response.session.publicState.candidateCount (UI 화면 narrowing 결과)
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const SUCHAN_JSON = fs.readdirSync(dir).filter(f => /^multiturn-suchan-C-\d.*\.json$/.test(f)).sort().pop()
const MINE_JSON = fs.readdirSync(dir).filter(f => /^multiturn-mine-C-\d.*\.json$/.test(f)).sort().pop()

if (!SUCHAN_JSON || !MINE_JSON) { console.error("multi-turn json not found"); process.exit(1) }
console.log("suchan:", SUCHAN_JSON)
console.log("main:  ", MINE_JSON)

const suchan = JSON.parse(fs.readFileSync(path.join(dir, SUCHAN_JSON), "utf8"))
const mainData = JSON.parse(fs.readFileSync(path.join(dir, MINE_JSON), "utf8"))

// ── DB SPECS — catalog_app.product_recommendation_mv (endpoint가 보는 진짜 테이블) ──
// 베이스라인 검증: case #1 (P Slotting Milling 10mm) → 290 = endpoint 수찬님 일치 ✓
const MV = "catalog_app.product_recommendation_mv"
const COUNT = `SELECT count(DISTINCT edp_no) FROM ${MV}`
// numeric cast 안전 wrapper: 컬럼 ~ '^[0-9.]+$' 만 cast
const N = (col) => `${col} ~ '^[0-9.]+$'`
// stock join (mv는 edp_no, inventory_snapshot은 normalized_edp)
const STOCK = `edp_no IN (SELECT DISTINCT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric > 0)`

const SPECS = [
  // 1. baseline: Milling P φ10 Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%'`,
    label: "Milling P φ10 Slotting" },
  // 2. P/M/K Side Milling 6mm
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=6 AND material_tags && ARRAY['P','M','K']::text[] AND series_application_shape ILIKE '%Side%'`,
    label: "Milling P/M/K φ6 Side Milling" },
  // 3. φ8~12 Slotting P
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm BETWEEN 8 AND 12 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%'`,
    label: "Milling P φ8~12 Slotting" },
  // 4. OAL ≥100 (Side Milling per case)
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND ${N("milling_overall_length")} AND milling_overall_length::numeric>=100`,
    label: "Milling P φ10 Side OAL≥100" },
  // 5. OAL ≤80
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND ${N("milling_overall_length")} AND milling_overall_length::numeric<=80`,
    label: "Milling P φ10 Side OAL≤80" },
  // 6. 4F Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND milling_number_of_flute='4'`,
    label: "Milling P φ10 Slotting 4F" },
  // 7. F≥5 S 12mm
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=12 AND 'S'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND ${N("milling_number_of_flute")} AND milling_number_of_flute::int>=5`,
    label: "Milling S φ12 Slotting ≥5F" },
  // 8. T-Coating P 8mm Side
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=8 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND milling_coating ILIKE '%T-Coating%'`,
    label: "Milling P φ8 Side T-Coating" },
  // 9. uncoated N 6mm Side
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=6 AND 'N'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND (milling_coating IS NULL OR TRIM(milling_coating)='' OR milling_coating ILIKE '%bright%' OR milling_coating ILIKE '%uncoat%')`,
    label: "Milling N φ6 Side uncoated" },
  // 10. 재고 P 10mm Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND ${STOCK}`,
    label: "Milling P φ10 Slotting + 재고" },
  // 11. 재고 M 8mm Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=8 AND 'M'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND ${STOCK}`,
    label: "Milling M φ8 Slotting + 재고" },
  // 12. X5070 brand 10mm Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND edp_brand_name ILIKE '%X5070%' AND series_application_shape ILIKE '%Slotting%'`,
    label: "X5070 brand Milling φ10 Slotting" },
  // 13. NOT ALU-POWER N 8mm Side
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=8 AND 'N'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND COALESCE(edp_brand_name,'') NOT ILIKE '%ALU-POWER%'`,
    label: "Milling N φ8 Side not ALU-POWER" },
  // 14. 4중: P 10 4F OAL≥100 TiAlN Side
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND milling_number_of_flute='4' AND ${N("milling_overall_length")} AND milling_overall_length::numeric>=100 AND milling_coating ILIKE '%TiAlN%'`,
    label: "Milling P φ10 Side 4F OAL≥100 TiAlN" },
  // 15. 5중: P/M 8-12 4F OAL≥80 TiAlN 재고 Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm BETWEEN 8 AND 12 AND material_tags && ARRAY['P','M']::text[] AND series_application_shape ILIKE '%Slotting%' AND milling_number_of_flute='4' AND ${N("milling_overall_length")} AND milling_overall_length::numeric>=80 AND milling_coating ILIKE '%TiAlN%' AND ${STOCK}`,
    label: "Milling P/M φ8-12 Slotting 4F OAL≥80 TiAlN 재고" },
  // 16. helix≥45 P 10mm Side
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND ${N("milling_helix_angle")} AND milling_helix_angle::numeric>=45`,
    label: "Milling P φ10 Side helix≥45" },
  // 17. shank 6-10 P 8mm Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=8 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND ${N("milling_shank_dia")} AND milling_shank_dia::numeric BETWEEN 6 AND 10`,
    label: "Milling P φ8 Slotting shank 6-10" },
  // 18. CL≥20 P 10mm Slotting
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND ${N("milling_length_of_cut")} AND milling_length_of_cut::numeric>=20`,
    label: "Milling P φ10 Slotting CL≥20" },
  // 19. drill point 140 — point_angle 컬럼 mv에 없음. 가까운 대체: Drilling + φ8 + P
  { sql: `${COUNT} WHERE edp_root_category='Holemaking' AND search_diameter_mm=8 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Drilling%'`,
    label: "Holemaking P φ8 Drilling (point_angle 컬럼 없음 — 베이스만)" },
  // 20. drill OAL≥100 + coolant P 10mm Drilling
  { sql: `${COUNT} WHERE edp_root_category='Holemaking' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Drilling%' AND ${N("holemaking_overall_length")} AND holemaking_overall_length::numeric>=100 AND holemaking_coolant_hole IN ('External','Internal','O')`,
    label: "Holemaking P φ10 Drilling OAL≥100 + coolant" },
  // 21. tap M10 P1.5 — pitch 컬럼 mv에 없음. 베이스 Threading + φ10 + P
  { sql: `${COUNT} WHERE edp_root_category='Threading' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Threading%'`,
    label: "Threading P φ10 (pitch 컬럼 없음 — 베이스만)" },
  // 22. 999mm
  { sql: `${COUNT} WHERE search_diameter_mm=999`, label: "diameter=999", expectZero: true },
  // 23. 모순 ≥20 ≤5
  { sql: `${COUNT} WHERE search_diameter_mm>=20 AND search_diameter_mm<=5`, label: "diameter ≥20 AND ≤5", expectZero: true },
  // 24. 6.35mm Side P 4F
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm BETWEEN 6.3 AND 6.4 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Side%' AND milling_number_of_flute='4'`,
    label: "Milling P 6.35mm Side 4F" },
  // 25. KOREA + 풀필터
  { sql: `${COUNT} WHERE edp_root_category='Milling' AND search_diameter_mm=10 AND 'P'=ANY(material_tags) AND series_application_shape ILIKE '%Slotting%' AND milling_number_of_flute='4' AND ${N("milling_overall_length")} AND milling_overall_length::numeric>=100 AND milling_coating ILIKE '%TiAlN%' AND 'KOREA'=ANY(country_codes)`,
    label: "Milling P φ10 Slotting 4F TiAlN OAL≥100 KOREA" },
]

function caseVerdict(spec, dbCount, ep) {
  if (ep == null) ep = 0
  if (spec.expectZero) {
    return ep === 0
      ? { tag: "✅정확", note: `DB ${dbCount} = endpoint 0` }
      : { tag: "❌오탐", note: `DB ${dbCount} → endpoint ${ep}` }
  }
  if (dbCount === 0 && ep === 0) return { tag: "✅정확", note: "둘 다 0" }
  if (dbCount === 0 && ep > 0) return { tag: "❌오탐", note: `DB 0 / endpoint ${ep}` }
  if (dbCount > 0 && ep === 0) return { tag: "❌누락", note: `DB ${dbCount} / endpoint 0` }
  if (Math.abs(ep - dbCount) <= Math.max(2, dbCount * 0.15)) return { tag: "✅정확", note: `DB ${dbCount} / endpoint ${ep}` }
  if (ep > dbCount * 1.5) return { tag: "⚠️과다", note: `DB ${dbCount} / endpoint ${ep}` }
  if (ep < dbCount * 0.5) return { tag: "⚠️과소", note: `DB ${dbCount} / endpoint ${ep}` }
  return { tag: "🟡차이", note: `DB ${dbCount} / endpoint ${ep}` }
}

function changeTag(v1, v2) {
  if (v1 === v2) return "= 동일"
  const score = v => v.startsWith("✅") ? 3 : v.startsWith("🟡") ? 2 : v.startsWith("⚠️") ? 1 : 0
  const s1 = score(v1), s2 = score(v2)
  if (s2 > s1) return "↑ main이 나음"
  if (s2 < s1) return "↓ main이 못함"
  return "↔ 다름"
}

// ── 색상/스타일 ──
const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } }
const G = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }
const R = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
const Y = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } }
const GY = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }
const LB = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } }
const TI = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1C4E9" } }
const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
const FT = { name: "Malgun Gothic", size: 10 }
const FTB = { name: "Malgun Gothic", size: 10, bold: true }

const verdictFill = v => {
  if (v.startsWith("✅")) return G
  if (v.startsWith("❌")) return R
  if (v.startsWith("⚠️") || v.startsWith("🟡")) return Y
  return GY
}

// ── 단독 xlsx 빌더 ──
async function buildSingleXlsx(label, jsonData, verified, outPath) {
  const wb = new ExcelJS.Workbook()

  // 시트1: 설명
  const s0 = wb.addWorksheet("📖 설명")
  s0.columns = [{ width: 22 }, { width: 95 }]
  s0.mergeCells("A1:B1")
  s0.getCell("A1").value = `${label} Multi-turn UI 미러 테스트 (DB Ground Truth 검증)`
  s0.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s0.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s0.getRow(1).height = 36

  const sec = label => {
    const row = s0.addRow([label, ""])
    s0.mergeCells(`A${row.number}:B${row.number}`)
    row.getCell(1).fill = TI
    row.getCell(1).font = { name: "Malgun Gothic", size: 12, bold: true, color: { argb: "FF1A237E" } }
    row.height = 26
  }
  const kv = (k, v) => {
    const row = s0.addRow([k, v])
    row.getCell(1).font = FTB; row.getCell(2).font = FT
    row.getCell(1).alignment = { vertical: "middle" }
    row.getCell(2).alignment = { vertical: "middle", wrapText: true }
    row.getCell(1).border = BD; row.getCell(2).border = BD
    row.height = Math.max(20, Math.ceil(String(v).length / 80) * 18)
  }

  s0.addRow([])
  sec("1. 테스트 개요")
  kv("Endpoint", jsonData.endpoint)
  kv("실행 시각", jsonData.runAt)
  kv("케이스 수", `${jsonData.results.length}`)
  kv("방식", "Multi-turn UI 미러: Turn 0 (form submit, messages=[]) → Turn 1+ (NL with history + session 누적). UI 캡처 payload와 동일 형식.")
  kv("displayedProducts", "C 모드 (생략) — session.publicState만으로 narrowing 정상 동작 검증 완료")
  kv("비교 기준", "session.publicState.candidateCount (UI 화면의 narrowing 결과 숫자)")
  s0.addRow([])

  sec("2. DB Ground Truth")
  kv("DB", "smart_catalog @ 20.119.98.136 / raw_catalog 스키마")
  kv("주 테이블", "prod_edp_option_milling/holemaking/threading (95k+52k+33k rows) + prod_series_work_material_status (소재) + catalog_app.inventory_snapshot (재고)")
  s0.addRow([])

  sec("3. 케이스 verdict 정의", { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } })
  kv("✅정확", "DB count ≈ endpoint count (±15% 또는 ±2건)")
  kv("❌오탐", "DB=0인데 endpoint > 0 (있어선 안 되는 결과 반환)")
  kv("❌누락", "DB > 0인데 endpoint = 0 (있어야 할 결과 누락)")
  kv("⚠️과소", "endpoint < DB × 0.5 (narrowing 너무 강함)")
  kv("⚠️과다", "endpoint > DB × 1.5 (필터 누락)")
  kv("🟡차이", "위 어디에도 안 드는 작은 차이")
  s0.addRow([])

  sec("4. 종합 결과", { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } })
  const correct = verified.filter(r => r.verdict.startsWith("✅")).length
  const wrong = verified.filter(r => r.verdict.startsWith("❌")).length
  const warn = verified.filter(r => r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")).length
  kv("케이스 verdict", `✅정확 ${correct} / ❌오류 ${wrong} / ⚠️차이 ${warn}  (총 ${verified.length})`)
  kv("평균 latency", `${Math.round(jsonData.results.reduce((s, r) => s + (r.ms || 0), 0) / jsonData.results.length)}ms`)
  s0.addRow([])

  sec("5. 시트 안내")
  kv("시트2", "DB 검증 결과 — 케이스별 verdict + DB count + endpoint count + 적용된 필터")
  kv("시트3", "Turn 상세 — 각 케이스의 turn별 narrowing 추이 (290 → 80 → 44 같은 식)")
  kv("시트4", "SQL 명세 — 재현용 DB 쿼리")

  // 시트2: DB 검증 결과
  const s1 = wb.addWorksheet("DB 검증 결과", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:I1")
  s1.getCell("A1").value = `${label} 케이스별 DB 검증`
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 30
  s1.mergeCells("A2:I2")
  s1.getCell("A2").value = `Endpoint: ${jsonData.endpoint} | ✅${correct} ❌${wrong} ⚠️${warn} / ${verified.length}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF555555" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [{ width: 5 }, { width: 36 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 38 }, { width: 38 }, { width: 9 }, { width: 18 }]
  const hdrs = ["#", "케이스", "DB", "EP", "verdict", "DB filter", "비고", "ms", "applied filters"]
  const hr = s1.getRow(3)
  hdrs.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr.height = 24

  verified.forEach((r, i) => {
    const row = s1.getRow(i + 4)
    const filterStr = (r.appliedFilters || []).map(f => `${f.field}:${f.op}:${f.rawValue ?? f.value}`).join("\n")
    row.values = [i + 1, r.name, r.dbCount ?? "", r.epCount ?? 0, r.verdict, r.dbLabel, r.verdictNote, r.ms, filterStr]
    row.getCell(5).fill = verdictFill(r.verdict)
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 36
  })

  // 시트3: Turn 상세
  const s2 = wb.addWorksheet("Turn 상세", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [
    { header: "#", width: 5 }, { header: "케이스", width: 36 },
    { header: "turn", width: 6 }, { header: "NL 입력", width: 38 },
    { header: "candidate count", width: 14 }, { header: "applied filters", width: 50 },
    { header: "AI preview", width: 50 },
  ]
  const hr2 = s2.getRow(1)
  hr2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  let r2 = 2
  verified.forEach((r, i) => {
    (r.turns || []).forEach((t, j) => {
      const row = s2.getRow(r2++)
      const filterStr = (t.appliedFilters || []).map(f => `${f.field}:${f.op}:${f.rawValue ?? f.value}`).join("; ")
      row.values = [
        j === 0 ? i + 1 : "",
        j === 0 ? r.name : "",
        t.turn,
        t.nl || "(form submit)",
        t.candidateCount ?? "",
        filterStr,
        t.aiPreview || "",
      ]
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
      row.height = 26
    })
  })

  // 시트4: SQL 명세
  const s3 = wb.addWorksheet("SQL 명세", { views: [{ state: "frozen", ySplit: 1 }] })
  s3.columns = [{ header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "DB filter", width: 42 }, { header: "SQL", width: 130 }]
  const hr3 = s3.getRow(1)
  hr3.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  verified.forEach((r, i) => {
    const row = s3.getRow(i + 2)
    row.values = [i + 1, r.name, r.dbLabel, r.sql]
    row.eachCell(c => { c.border = BD; c.font = { name: "Consolas", size: 9 }; c.alignment = { vertical: "top", wrapText: true } })
    row.height = 60
  })

  await wb.xlsx.writeFile(outPath)
  console.log(`✓ ${label} → ${outPath}  (✅${correct} ❌${wrong} ⚠️${warn})`)
  return { correct, wrong, warn }
}

// ── 비교 xlsx 빌더 ──
async function buildCompareXlsx(suchanVerified, mainVerified, outPath) {
  const wb = new ExcelJS.Workbook()

  // 시트1: 설명
  const s0 = wb.addWorksheet("📖 설명")
  s0.columns = [{ width: 22 }, { width: 95 }]
  s0.mergeCells("A1:B1")
  s0.getCell("A1").value = "수찬님 vs company main — Multi-turn UI 미러 비교"
  s0.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s0.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s0.getRow(1).height = 36

  const sec = label => {
    const row = s0.addRow([label, ""])
    s0.mergeCells(`A${row.number}:B${row.number}`)
    row.getCell(1).fill = TI
    row.getCell(1).font = { name: "Malgun Gothic", size: 12, bold: true, color: { argb: "FF1A237E" } }
    row.height = 26
  }
  const kv = (k, v) => {
    const row = s0.addRow([k, v])
    row.getCell(1).font = FTB; row.getCell(2).font = FT
    row.getCell(1).alignment = { vertical: "middle" }
    row.getCell(2).alignment = { vertical: "middle", wrapText: true }
    row.getCell(1).border = BD; row.getCell(2).border = BD
    row.height = Math.max(20, Math.ceil(String(v).length / 80) * 18)
  }

  s0.addRow([])
  sec("1. 비교 대상")
  kv("수찬님", `${suchan.endpoint} (브랜치 company/scjung/rebuilding, c6d45b9 빌드)`)
  kv("company main", `${mainData.endpoint} (수찬님 PR 머지된 main 브랜치)`)
  s0.addRow([])

  sec("2. 방식")
  kv("미러 모드", "Multi-turn UI 미러 (캡처 payload 형식 그대로). Turn 0 form → Turn 1+ NL with session 누적.")
  kv("비교 기준", "session.publicState.candidateCount (UI 화면 narrowing 결과)")
  kv("DB 정답", "raw_catalog.prod_edp_option_* + prod_series_work_material_status + inventory_snapshot")
  s0.addRow([])

  const sCount = (arr, prefix) => arr.filter(r => r.verdict.startsWith(prefix)).length
  const sCorrect = sCount(suchanVerified, "✅"), sWrong = sCount(suchanVerified, "❌"), sWarn = sCount(suchanVerified, "⚠️") + sCount(suchanVerified, "🟡")
  const mCorrect = sCount(mainVerified, "✅"), mWrong = sCount(mainVerified, "❌"), mWarn = sCount(mainVerified, "⚠️") + sCount(mainVerified, "🟡")

  sec("3. 종합 결과", { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } })
  kv("수찬님", `✅정확 ${sCorrect} / ❌오류 ${sWrong} / ⚠️차이 ${sWarn}  (총 ${suchanVerified.length})`)
  kv("company main", `✅정확 ${mCorrect} / ❌오류 ${mWrong} / ⚠️차이 ${mWarn}  (총 ${mainVerified.length})`)
  s0.addRow([])

  // 시트2: 비교
  const s1 = wb.addWorksheet("비교", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:K1")
  s1.getCell("A1").value = "수찬 vs main 케이스별 비교"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 30
  s1.mergeCells("A2:K2")
  s1.getCell("A2").value = `수찬: ✅${sCorrect} ❌${sWrong} ⚠️${sWarn}  /  main: ✅${mCorrect} ❌${mWrong} ⚠️${mWarn}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF555555" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [
    { width: 5 }, { width: 36 }, { width: 8 }, { width: 9 }, { width: 11 }, { width: 9 }, { width: 11 }, { width: 14 },
    { width: 9 }, { width: 9 }, { width: 38 },
  ]
  const hdrs = ["#", "케이스", "DB", "수찬 EP", "수찬 verdict", "main EP", "main verdict", "변화", "수찬 ms", "main ms", "DB filter"]
  const hr = s1.getRow(3)
  hdrs.forEach((h, i) => {
    const c = hr.getCell(i + 1); c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr.height = 24

  let mainBetter = 0, suchanBetter = 0, sameRows = 0, differ = 0
  for (let i = 0; i < suchanVerified.length; i++) {
    const s = suchanVerified[i], m = mainVerified[i]
    const change = changeTag(s.verdict, m.verdict)
    if (change.startsWith("↑")) mainBetter++
    else if (change.startsWith("↓")) suchanBetter++
    else if (change.startsWith("=")) sameRows++
    else differ++

    const row = s1.getRow(i + 4)
    row.values = [i + 1, s.name, s.dbCount ?? "", s.epCount ?? 0, s.verdict, m.epCount ?? 0, m.verdict, change, s.ms, m.ms, s.dbLabel]
    row.getCell(5).fill = verdictFill(s.verdict)
    row.getCell(7).fill = verdictFill(m.verdict)
    if (change.startsWith("↑")) row.getCell(8).fill = G
    else if (change.startsWith("↓")) row.getCell(8).fill = R
    else if (change.startsWith("↔")) row.getCell(8).fill = Y
    else row.getCell(8).fill = GY
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 32
  }

  const sumRow = suchanVerified.length + 5
  s1.mergeCells(`A${sumRow}:K${sumRow}`)
  const sc = s1.getCell(`A${sumRow}`)
  sc.value = `↑ main이 나음 ${mainBetter}   ↓ 수찬이 나음 ${suchanBetter}   = 동일 ${sameRows}   ↔ 다름 ${differ}`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 12, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(sumRow).height = 28

  await wb.xlsx.writeFile(outPath)
  console.log(`✓ Compare → ${outPath}`)
  console.log(`  ↑main:${mainBetter} ↓suchan:${suchanBetter} =${sameRows} ↔${differ}`)
}

async function main() {
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()
  console.log("DB connected. Running ground-truth queries...\n")

  // DB ground truth (한 번만 — 양쪽 동일)
  const dbCounts = []
  for (let i = 0; i < SPECS.length; i++) {
    try {
      const q = await c.query(SPECS[i].sql)
      dbCounts.push(parseInt(q.rows[0].count, 10))
    } catch (e) {
      console.error(`DB query #${i + 1} ERR:`, e.message.slice(0, 80))
      dbCounts.push(null)
    }
  }
  await c.end()

  // verified rows
  const buildVerified = (jsonData) => jsonData.results.map((r, i) => {
    const spec = SPECS[i]
    const epCount = r.finalCandidateCount ?? null
    const v = dbCounts[i] == null
      ? { tag: "❓DB오류", note: "" }
      : caseVerdict(spec, dbCounts[i], epCount)
    return {
      name: r.name,
      dbCount: dbCounts[i],
      dbLabel: spec.label,
      sql: spec.sql,
      epCount,
      ms: r.ms,
      verdict: v.tag,
      verdictNote: v.note,
      appliedFilters: r.finalAppliedFilters || [],
      turns: r.turns || [],
    }
  })

  const suchanVerified = buildVerified(suchan)
  const mainVerified = buildVerified(mainData)

  // 3개 xlsx 빌드
  await buildSingleXlsx("수찬님", suchan, suchanVerified, path.join(dir, "suchan_test_v3_multiturn.xlsx"))
  await buildSingleXlsx("company main", mainData, mainVerified, path.join(dir, "main_test_v1_multiturn.xlsx"))
  await buildCompareXlsx(suchanVerified, mainVerified, path.join(dir, "suchan_vs_main_multiturn.xlsx"))
}

main().catch(e => { console.error(e); process.exit(1) })
