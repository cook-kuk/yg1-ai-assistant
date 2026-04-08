/**
 * 25 케이스를 PG DB로 직접 쿼리해서 ground truth와 수찬님 응답 비교.
 * 출력: xlsx에 verdict 컬럼 추가.
 *
 * usage: node test-results/suchan-verify-against-db.js [json-file] [out-xlsx]
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
      .filter(f => /^suchan-finder-stress-.*\.json$/.test(f))
      .sort()
      .map(f => path.join(dir, f))
      .filter(p => {
        try { return JSON.parse(fs.readFileSync(p, "utf8")).target?.includes("20.119") }
        catch { return false }
      })
      .pop()

if (!srcJson) { console.error("source json not found"); process.exit(1) }
const data = JSON.parse(fs.readFileSync(srcJson, "utf8"))
const outXlsx = process.argv[3] || srcJson.replace(/\.json$/, "-verified.xlsx")

// ── 각 케이스의 SQL 명세 ──
// {sql, params, label, unverifiable?, expectZero?}
const SPECS = [
  // 1
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND 'milling'=ANY(operation_types)`,
    label: "endmill P φ10 milling" },
  // 2
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=6 AND (suitable_material_groups && ARRAY['P','M','K']::varchar[]) AND 'milling'=ANY(operation_types)`,
    label: "endmill 6mm P/M/K milling" },
  // 3 직경 8~12 슬로팅
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter BETWEEN 8 AND 12 AND 'P'=ANY(suitable_material_groups) AND 'milling'=ANY(operation_types)`,
    label: "endmill P φ8-12 milling" },
  // 4 OAL≥100
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND 'milling'=ANY(operation_types) AND overall_length>=100`,
    label: "endmill P φ10 OAL≥100" },
  // 5 OAL≤80
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND 'milling'=ANY(operation_types) AND overall_length<=80`,
    label: "endmill P φ10 OAL≤80" },
  // 6 4F
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND 'milling'=ANY(operation_types) AND flute_count=4`,
    label: "endmill P φ10 4F" },
  // 7 5날 이상 S 12mm
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=12 AND 'S'=ANY(suitable_material_groups) AND flute_count>=5`,
    label: "endmill S φ12 ≥5F" },
  // 8 T-Coating (TiAlN family)
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=8 AND 'P'=ANY(suitable_material_groups) AND coating_material ILIKE '%TiAlN%'`,
    label: "endmill P φ8 TiAlN" },
  // 9 bright finish (no coating)
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=6 AND 'N'=ANY(suitable_material_groups) AND (coating_material IS NULL OR coating_material='')`,
    label: "endmill N φ6 uncoated" },
  // 10/11 stock — no column → unverifiable
  { unverifiable: "재고 컬럼 없음" },
  { unverifiable: "재고 컬럼 없음" },
  // 12 X5070
  { sql: `SELECT count(*) FROM products WHERE is_active AND series='X5070' AND diameter=10 AND 'milling'=ANY(operation_types)`,
    label: "series=X5070 φ10 milling" },
  // 13 ALU-POWER 제외 (negative filter — DB 전체 모집단으로 봄)
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=8 AND 'N'=ANY(suitable_material_groups) AND series NOT ILIKE '%ALU-POWER%' AND (name NOT ILIKE '%ALU-POWER%' OR name IS NULL)`,
    label: "endmill N φ8 not ALU-POWER" },
  // 14 4중 φ10 OAL≥100 4F TiAlN
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND flute_count=4 AND overall_length>=100 AND coating_material ILIKE '%TiAlN%'`,
    label: "endmill P φ10 4F OAL≥100 TiAlN" },
  // 15 5중 φ8~12 OAL≥80 4F P/M TiAlN
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter BETWEEN 8 AND 12 AND (suitable_material_groups && ARRAY['P','M']::varchar[]) AND flute_count=4 AND overall_length>=80 AND coating_material ILIKE '%TiAlN%'`,
    label: "endmill P/M φ8-12 4F OAL≥80 TiAlN" },
  // 16 헬릭스 ≥45°
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND helix_angle>=45`,
    label: "endmill P φ10 helix≥45" },
  // 17 shank 6~10
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=8 AND 'P'=ANY(suitable_material_groups) AND shank_diameter BETWEEN 6 AND 10`,
    label: "endmill P φ8 shank 6-10" },
  // 18 CL ≥20mm (flute_length)
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND flute_length>=20`,
    label: "endmill P φ10 CL≥20" },
  // 19 drill point 140° — no column
  { unverifiable: "point_angle 컬럼 없음" },
  // 20 drill OAL≥100 + 쿨런트홀 — no coolant_hole column
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='drill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND overall_length>=100`,
    label: "drill P φ10 OAL≥100 (쿨런트홀 검증불가)" },
  // 21 tap M10 1.5
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='tap' AND diameter=10 AND 'P'=ANY(suitable_material_groups)`,
    label: "tap P φ10 (pitch 검증불가)" },
  // 22 999mm — should be 0
  { sql: `SELECT count(*) FROM products WHERE is_active AND diameter=999`,
    label: "diameter=999", expectZero: true },
  // 23 모순 — should be 0
  { sql: `SELECT count(*) FROM products WHERE is_active AND diameter>=20 AND diameter<=5`,
    label: "diameter ≥20 AND ≤5", expectZero: true },
  // 24 1/4인치 = 6.35mm
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter BETWEEN 6.3 AND 6.4 AND 'P'=ANY(suitable_material_groups) AND flute_count=4`,
    label: "endmill P 6.35mm 4F" },
  // 25 KOREA + 풀필터 (country 컬럼 없음)
  { sql: `SELECT count(*) FROM products WHERE is_active AND tool_type='endmill' AND diameter=10 AND 'P'=ANY(suitable_material_groups) AND flute_count=4 AND coating_material ILIKE '%TiAlN%' AND overall_length>=100`,
    label: "endmill P φ10 4F TiAlN OAL≥100 (KOREA 검증불가)" },
]

function verdict(spec, dbCount, suchanCount) {
  if (spec.unverifiable) return { tag: "검증불가", note: spec.unverifiable }
  if (suchanCount == null) suchanCount = 0
  if (spec.expectZero) {
    return suchanCount === 0
      ? { tag: "✅정확", note: `DB ${dbCount} = endpoint 0` }
      : { tag: "❌오탐", note: `DB ${dbCount} 인데 endpoint ${suchanCount}건 (오탐)` }
  }
  if (dbCount === 0 && suchanCount === 0) return { tag: "✅정확", note: "둘 다 0" }
  if (dbCount === 0 && suchanCount > 0)
    return { tag: "❌오탐", note: `DB 0 / endpoint ${suchanCount}` }
  if (dbCount > 0 && suchanCount === 0)
    return { tag: "❌누락", note: `DB ${dbCount} / endpoint 0` }
  // both >0 — 비율 비교
  const ratio = suchanCount / dbCount
  // endpoint는 50건 cap이라 dbCount > 50이면 50 반환이 정상
  if (dbCount >= 50 && suchanCount >= 50) return { tag: "✅정확", note: `DB ${dbCount} / endpoint cap 50` }
  if (Math.abs(suchanCount - dbCount) <= Math.max(2, dbCount * 0.1))
    return { tag: "✅정확", note: `DB ${dbCount} / endpoint ${suchanCount}` }
  if (suchanCount > dbCount * 1.5)
    return { tag: "⚠️과다", note: `DB ${dbCount} / endpoint ${suchanCount} (필터 누락 의심)` }
  if (suchanCount < dbCount * 0.5)
    return { tag: "⚠️과소", note: `DB ${dbCount} / endpoint ${suchanCount}` }
  return { tag: "🟡차이", note: `DB ${dbCount} / endpoint ${suchanCount}` }
}

async function main() {
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()
  console.log("DB connected.")

  const verified = []
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i]
    const spec = SPECS[i] || { unverifiable: "spec 없음" }
    let dbCount = null, dbErr = null
    if (!spec.unverifiable) {
      try {
        const q = await c.query(spec.sql)
        dbCount = parseInt(q.rows[0].count, 10)
      } catch (e) { dbErr = e.message }
    }
    const v = dbErr
      ? { tag: "❓DB오류", note: dbErr }
      : verdict(spec, dbCount, r.candidateCount)
    verified.push({ ...r, dbCount, dbLabel: spec.label || "", verdict: v.tag, verdictNote: v.note })
    console.log(`[${String(i + 1).padStart(2, "0")}] ${r.name}  →  DB=${dbCount ?? "-"} / EP=${r.candidateCount ?? 0}  ${v.tag}`)
  }
  await c.end()

  // ── xlsx 빌드 ──
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

  const s1 = wb.addWorksheet("DB 검증 결과", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:L1")
  s1.getCell("A1").value = "수찬님 Product Finder × DB Ground Truth 검증"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 32
  s1.mergeCells("A2:L2")
  s1.getCell("A2").value = `Endpoint: ${data.target} | DB: smart_catalog@20.119.98.136 (4983 products) | RunAt: ${new Date().toISOString()}  ⚠ 수찬님 endpoint가 이 DB와 다른 데이터 소스를 볼 가능성 있음 (E2750 등 우리 DB에 없음)`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF757575" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [
    { width: 5 }, { width: 36 }, { width: 38 }, { width: 8 },
    { width: 8 }, { width: 8 }, { width: 12 }, { width: 38 }, { width: 50 },
    { width: 18 }, { width: 8 }, { width: 8 },
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
    row.height = 30
  })

  // 통계
  const total = verified.length
  const correct = verified.filter(r => r.verdict.startsWith("✅")).length
  const wrong = verified.filter(r => r.verdict.startsWith("❌")).length
  const warn = verified.filter(r => r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")).length
  const skip = verified.filter(r => r.verdict.startsWith("검증불가") || r.verdict.startsWith("❓")).length
  const sumRow = total + 5
  s1.mergeCells(`A${sumRow}:L${sumRow}`)
  const sc = s1.getCell(`A${sumRow}`)
  sc.value = `통계  ✅정확 ${correct}/${total}   ❌오류 ${wrong}/${total}   ⚠️차이 ${warn}/${total}   검증불가 ${skip}/${total}`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 12, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(sumRow).height = 28

  await wb.xlsx.writeFile(outXlsx)
  console.log("\nxlsx →", outXlsx)
  console.log(`✅${correct} ❌${wrong} ⚠️${warn} 검증불가${skip} / ${total}`)
}

main().catch(e => { console.error(e); process.exit(1) })
