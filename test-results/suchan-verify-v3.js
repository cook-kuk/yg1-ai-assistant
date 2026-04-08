/**
 * v3: v2 결과 + 제품별 verdict 컬럼 추가
 *
 * 각 케이스의 조건(diameter/flute/OAL/CL/coating/brand)을 정의하고
 * top-3 샘플 제품이 실제로 만족하는지 자동 체크.
 *
 * usage: node test-results/suchan-verify-v3.js
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const argFile = process.argv[2]
const srcJson = argFile
  ? path.resolve(argFile)
  : fs.readdirSync(dir)
      .filter(f => /^suchan-finder-stress-.*\.json$/.test(f) && !f.includes("verified"))
      .sort()
      .map(f => path.join(dir, f))
      .filter(p => { try { return JSON.parse(fs.readFileSync(p, "utf8")).target?.includes(":2999") } catch { return false } })
      .pop()

if (!srcJson) { console.error("source not found"); process.exit(1) }
const data = JSON.parse(fs.readFileSync(srcJson, "utf8"))
const outXlsx = srcJson.replace(/\.json$/, "-verified-v3.xlsx")

// ── 케이스별 조건 (per-product 검증용) ──
// 각 조건: { key, label, check(product) → ✓ / ✗ / "—" (해당없음/검증불가) }
const num = v => (v == null || v === "" ? null : Number(v))
const ok = "✓", no = "✗", na = "—"
const inRange = (v, lo, hi) => v == null ? na : (v >= lo && v <= hi ? ok : no)
const eq = (v, t) => v == null ? na : (v === t ? ok : no)
const gte = (v, t) => v == null ? na : (v >= t ? ok : no)
const lte = (v, t) => v == null ? na : (v <= t ? ok : no)
const ilike = (v, sub) => v == null ? na : (String(v).toLowerCase().includes(sub.toLowerCase()) ? ok : no)

const CONSTRAINTS = [
  // 1
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }] },
  // 2
  { conds: [{ k: "φ=6", f: p => eq(num(p.diameterMm), 6) }] },
  // 3
  { conds: [{ k: "φ ∈ [8,12]", f: p => inRange(num(p.diameterMm), 8, 12) }] },
  // 4
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }] },
  // 5
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≤80", f: p => lte(num(p.oal), 80) }] },
  // 6
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "F=4", f: p => eq(num(p.fluteCount), 4) }] },
  // 7
  { conds: [{ k: "φ=12", f: p => eq(num(p.diameterMm), 12) }, { k: "F≥5", f: p => gte(num(p.fluteCount), 5) }] },
  // 8
  { conds: [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "coating~T-Coating", f: p => ilike(p.coating, "T-Coating") }] },
  // 9
  { conds: [{ k: "φ=6", f: p => eq(num(p.diameterMm), 6) }, { k: "uncoated/bright", f: p => p.coating == null || p.coating === "" || /bright|uncoat/i.test(p.coating) ? ok : no }] },
  // 10
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "stock>0 (sample미노출)", f: () => na }] },
  // 11
  { conds: [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "stock>0 (sample미노출)", f: () => na }] },
  // 12
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "brand~X5070", f: p => ilike(p.brand, "X5070") }] },
  // 13
  { conds: [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "brand≠ALU-POWER", f: p => p.brand == null ? na : (/ALU-POWER/i.test(p.brand) ? no : ok) }] },
  // 14
  { conds: [
    { k: "φ=10", f: p => eq(num(p.diameterMm), 10) },
    { k: "F=4", f: p => eq(num(p.fluteCount), 4) },
    { k: "OAL≥100", f: p => gte(num(p.oal), 100) },
    { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") },
  ] },
  // 15
  { conds: [
    { k: "φ ∈ [8,12]", f: p => inRange(num(p.diameterMm), 8, 12) },
    { k: "F=4", f: p => eq(num(p.fluteCount), 4) },
    { k: "OAL≥80", f: p => gte(num(p.oal), 80) },
    { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") },
  ] },
  // 16
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "helix≥45 (sample미노출)", f: () => na }] },
  // 17
  { conds: [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "shank∈[6,10] (sample미노출)", f: () => na }] },
  // 18
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "CL≥20", f: p => gte(num(p.cl), 20) }] },
  // 19
  { conds: [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "point=140 (sample미노출)", f: () => na }] },
  // 20
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }, { k: "coolanthole (sample미노출)", f: () => na }] },
  // 21
  { conds: [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "pitch=1.5 (sample미노출)", f: () => na }] },
  // 22
  { conds: [{ k: "φ=999", f: p => eq(num(p.diameterMm), 999) }] },
  // 23
  { conds: [{ k: "모순(검증불가)", f: () => na }] },
  // 24
  { conds: [{ k: "φ ∈ [6.3,6.4]", f: p => inRange(num(p.diameterMm), 6.3, 6.4) }] },
  // 25
  { conds: [
    { k: "φ=10", f: p => eq(num(p.diameterMm), 10) },
    { k: "F=4", f: p => eq(num(p.fluteCount), 4) },
    { k: "OAL≥100", f: p => gte(num(p.oal), 100) },
    { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") },
  ] },
]

function evalProduct(caseIdx, p) {
  const c = CONSTRAINTS[caseIdx]
  if (!c) return { tag: "—", details: "" }
  const checks = c.conds.map(cond => ({ k: cond.k, r: cond.f(p) }))
  const fails = checks.filter(x => x.r === no)
  const passes = checks.filter(x => x.r === ok)
  const naCount = checks.filter(x => x.r === na).length
  let tag
  if (fails.length > 0) tag = "✗FAIL"
  else if (passes.length === 0) tag = "—N/A"
  else tag = "✅PASS"
  const details = checks.map(x => `${x.k}:${x.r}`).join("  ")
  return { tag, details }
}

// ── DB ground truth 재계산 (v2의 핵심 수치만 가져오기 위해) ──
async function getDbCounts(c) {
  // v2 결과 파일 있으면 재사용 — 없으면 0
  const v2 = fs.readdirSync(dir).find(f => /verified-v2\.xlsx$/.test(f))
  // 단순화: v2 verifier 재실행 결과를 메모리에 받기 위해 SPECS 복붙은 너무 길어서, JSON 캐시 안 만들었으므로 0 처리.
  // 시트1엔 케이스별 verdict만 보여주고 DB count는 v2 xlsx로 안내한다.
  return data.results.map(() => null)
}

async function main() {
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

  // ── Sheet 1: 용어 설명 ──
  const s0 = wb.addWorksheet("📖 용어 설명")
  s0.columns = [{ width: 20 }, { width: 90 }]
  const rows0 = [
    ["용어", "의미"],
    ["케이스 verdict", "endpoint가 반환한 개수 vs DB ground truth 개수 비교 결과 (시트2)"],
    ["✅정확", "DB count ≈ EP count (또는 DB ≥ 50인데 EP cap 50). 갯수상 문제 없음."],
    ["❌오탐", "DB=0인데 EP가 결과를 반환. 존재하지 않는 매칭을 만들어냄 = 환각/필터 무시."],
    ["❌누락", "DB에 결과 충분히 있는데 EP=0. 카테고리/필터가 죽음."],
    ["⚠️과소", "EP가 cap(50) 영향 없이 DB보다 훨씬 적게 반환. 좋은 후보를 사용자에게 안 보여줌. 보여준 것이 틀렸다는 뜻은 아님."],
    ["⚠️과다", "EP가 DB보다 많이 반환. 필터 누락 의심."],
    ["", ""],
    ["제품별 verdict", "endpoint가 반환한 각 제품(top-3)이 케이스 조건을 실제로 만족하는지 (시트3)"],
    ["✅PASS", "모든 검증 가능한 조건 충족 (적어도 1개 이상)"],
    ["✗FAIL", "최소 1개 조건 위반 → 이 제품은 결과로 나오면 안 됨"],
    ["—N/A", "샘플 응답에 컬럼 없어서 검증 불가 (예: helix angle, shank dia, point angle)"],
    ["", ""],
    ["케이스 verdict ≠ 제품 verdict", "과소(시트2)여도 보여준 제품들이 ✅PASS면 '잘 골랐지만 더 보여줄 수 있었다'는 의미. 오탐(시트2)이면 보여준 제품들이 ✗FAIL일 가능성 높음."],
  ]
  rows0.forEach((r, i) => {
    const row = s0.getRow(i + 1)
    row.values = r
    if (i === 0) {
      row.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center", vertical: "middle" } })
    } else {
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    }
    if (i > 0) row.height = 30
  })

  // ── Sheet 2: Top-3 + 제품별 verdict ──
  const s2 = wb.addWorksheet("Top-3 + 검증", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [
    { header: "#", width: 5 },
    { header: "케이스", width: 36 },
    { header: "rank", width: 6 },
    { header: "verdict", width: 11 },
    { header: "조건 상세 (조건:✓/✗/—)", width: 70 },
    { header: "series", width: 18 },
    { header: "brand", width: 22 },
    { header: "φ", width: 7 },
    { header: "F", width: 5 },
    { header: "OAL", width: 7 },
    { header: "CL", width: 7 },
    { header: "coating", width: 18 },
  ]
  const h2 = s2.getRow(1)
  h2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  h2.height = 22

  let r2 = 2
  const productStats = { pass: 0, fail: 0, na: 0, total: 0 }
  data.results.forEach((r, i) => {
    const samples = r.sampleProducts.length ? r.sampleProducts : []
    if (samples.length === 0) {
      const row = s2.getRow(r2++)
      row.values = [i + 1, r.name, "-", "—없음", "(샘플 없음 — endpoint candidates=0)", "", "", "", "", "", "", ""]
      row.eachCell(c => { c.border = BD; c.font = FT; c.fill = GY })
      return
    }
    samples.forEach((p, j) => {
      const v = evalProduct(i, p)
      productStats.total++
      if (v.tag === "✅PASS") productStats.pass++
      else if (v.tag === "✗FAIL") productStats.fail++
      else productStats.na++
      const row = s2.getRow(r2++)
      row.values = [
        j === 0 ? i + 1 : "",
        j === 0 ? r.name : "",
        j + 1,
        v.tag,
        v.details,
        p.series ?? "",
        p.brand ?? "",
        p.diameterMm ?? "",
        p.fluteCount ?? "",
        p.oal ?? "",
        p.cl ?? "",
        p.coating ?? "",
      ]
      let fill = null
      if (v.tag === "✅PASS") fill = G
      else if (v.tag === "✗FAIL") fill = R
      else fill = GY
      row.getCell(4).fill = fill
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
      row.height = 22
    })
  })

  // 통계 행
  const sumRow = r2 + 1
  s2.mergeCells(`A${sumRow}:L${sumRow}`)
  const sc = s2.getCell(`A${sumRow}`)
  sc.value = `제품별 통계  ✅PASS ${productStats.pass}   ✗FAIL ${productStats.fail}   —N/A ${productStats.na}   /  total ${productStats.total}`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 12, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s2.getRow(sumRow).height = 28

  await wb.xlsx.writeFile(outXlsx)
  console.log("xlsx →", outXlsx)
  console.log(`제품별: ✅${productStats.pass} ✗${productStats.fail} —${productStats.na} / ${productStats.total}`)
}

main().catch(e => { console.error(e); process.exit(1) })
