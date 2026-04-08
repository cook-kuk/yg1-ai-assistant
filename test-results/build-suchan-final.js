/**
 * suchan_test_v1.xlsx 통합본
 *  - 시트1: 📖 설명 (테스트 목적, verdict 정의, 읽는 법)
 *  - 시트2: DB 검증 결과 (케이스별 ✅/❌/⚠️)
 *  - 시트3: Top-3 + 제품별 검증 (✅PASS/✗FAIL/—N/A + 조건 상세)
 *  - 시트4: SQL 명세 (재현용)
 */
const { Client } = require("pg")
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

const dir = __dirname
const SRC = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dir, "suchan-finder-stress-2026-04-07T08-28-24-599Z.json")
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(dir, "suchan_test_v1.xlsx")
const data = JSON.parse(fs.readFileSync(SRC, "utf8"))

// ── DB SPECS (v2와 동일) ──
const ALIVE = `flag_del='N'`
const matJoin = (tags) => `COALESCE(series_idx,'') <> '' AND series_idx::int IN (SELECT prod_series_idx::int FROM raw_catalog.prod_series_work_material_status WHERE flag_del='N' AND COALESCE(prod_series_idx,'') <> '' AND TRIM(COALESCE(status,'')) <> '' AND TRIM(tag_name) IN (${tags.map(t => `'${t}'`).join(",")}))`
const stockJoin = (edpCol) => `${edpCol} IN (SELECT DISTINCT normalized_edp FROM catalog_app.inventory_snapshot WHERE quantity::numeric > 0)`
const D = `option_milling_outsidedia ~ '^[0-9.]+$'`

const SPECS = [
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])}`, label: "milling P φ10" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=6 AND ${matJoin(["P","M","K"])}`, label: "milling P/M/K φ6" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND ${matJoin(["P"])}`, label: "milling P φ8~12" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND ${matJoin(["P"])}`, label: "milling P φ10 OAL≥100" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric<=80 AND ${matJoin(["P"])}`, label: "milling P φ10 OAL≤80" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}`, label: "milling P φ10 4F" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=12 AND option_milling_numberofflute ~ '^[0-9]+$' AND option_milling_numberofflute::int>=5 AND ${matJoin(["S"])}`, label: "milling S φ12 ≥5F" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND option_milling_coating ILIKE '%T-Coating%' AND ${matJoin(["P"])}`, label: "milling P φ8 T-Coating" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=6 AND (option_milling_coating IS NULL OR TRIM(option_milling_coating)='' OR option_milling_coating ILIKE '%bright%' OR option_milling_coating ILIKE '%uncoat%') AND ${matJoin(["N"])}`, label: "milling N φ6 uncoated" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND ${matJoin(["P"])} AND ${stockJoin("m.edp_no")}`, label: "milling P φ10 + 재고>0" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND ${matJoin(["M"])} AND ${stockJoin("m.edp_no")}`, label: "milling M φ8 + 재고>0" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND brand_name ILIKE '%X5070%' AND ${D} AND option_milling_outsidedia::numeric=10`, label: "X5070 brand milling φ10" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND ${matJoin(["N"])} AND COALESCE(brand_name,'') NOT ILIKE '%ALU-POWER%'`, label: "milling N φ8 not ALU-POWER" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P"])}`, label: "milling P φ10 4F OAL≥100 TiAlN" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling m WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 8 AND 12 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=80 AND option_milling_coating ILIKE '%TiAlN%' AND ${matJoin(["P","M"])} AND ${stockJoin("m.edp_no")}`, label: "milling P/M φ8-12 4F OAL≥80 TiAlN 재고" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_helixangle ~ '^[0-9.]+$' AND option_milling_helixangle::numeric>=45 AND ${matJoin(["P"])}`, label: "milling P φ10 helix≥45" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=8 AND option_milling_shankdia ~ '^[0-9.]+$' AND option_milling_shankdia::numeric BETWEEN 6 AND 10 AND ${matJoin(["P"])}`, label: "milling P φ8 shank 6-10" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_lengthofcut ~ '^[0-9.]+$' AND option_milling_lengthofcut::numeric>=20 AND ${matJoin(["P"])}`, label: "milling P φ10 CL≥20" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=8 AND option_holemaking_pointangle ~ '140' AND ${matJoin(["P"])}`, label: "holemaking P φ8 point=140" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_holemaking WHERE ${ALIVE} AND option_holemaking_outsidedia ~ '^[0-9.]+$' AND option_holemaking_outsidedia::numeric=10 AND option_holemaking_overalllength ~ '^[0-9.]+$' AND option_holemaking_overalllength::numeric>=100 AND option_holemaking_coolanthole IN ('External','Internal','O') AND ${matJoin(["P"])}`, label: "holemaking P φ10 OAL≥100 + coolant" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_threading WHERE ${ALIVE} AND option_threading_outsidedia ~ '^[0-9.]+$' AND option_threading_outsidedia::numeric=10 AND option_threading_pitch IN ('1.5','1.50') AND ${matJoin(["P"])}`, label: "threading P M10 P1.5" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=999`, label: "milling φ=999", expectZero: true },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric>=20 AND option_milling_outsidedia::numeric<=5`, label: "φ≥20 AND φ≤5", expectZero: true },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric BETWEEN 6.3 AND 6.4 AND option_milling_numberofflute='4' AND ${matJoin(["P"])}`, label: "milling P 6.35mm 4F" },
  { sql: `SELECT count(*) FROM raw_catalog.prod_edp_option_milling WHERE ${ALIVE} AND ${D} AND option_milling_outsidedia::numeric=10 AND option_milling_numberofflute='4' AND option_milling_overalllength ~ '^[0-9.]+$' AND option_milling_overalllength::numeric>=100 AND option_milling_coating ILIKE '%TiAlN%' AND COALESCE(country,'') ILIKE '%KOR%' AND ${matJoin(["P"])}`, label: "milling P φ10 4F TiAlN OAL≥100 KOREA" },
]

// ── Per-product 조건 ──
const num = v => (v == null || v === "" ? null : Number(v))
const ok = "✓", no = "✗", na = "—"
const inRange = (v, lo, hi) => v == null ? na : (v >= lo && v <= hi ? ok : no)
const eq = (v, t) => v == null ? na : (v === t ? ok : no)
const gte = (v, t) => v == null ? na : (v >= t ? ok : no)
const lte = (v, t) => v == null ? na : (v <= t ? ok : no)
const ilike = (v, sub) => v == null ? na : (String(v).toLowerCase().includes(sub.toLowerCase()) ? ok : no)
const notLike = (v, sub) => v == null ? na : (String(v).toLowerCase().includes(sub.toLowerCase()) ? no : ok)

const CONSTRAINTS = [
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }],
  [{ k: "φ=6", f: p => eq(num(p.diameterMm), 6) }],
  [{ k: "φ ∈ [8,12]", f: p => inRange(num(p.diameterMm), 8, 12) }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≤80", f: p => lte(num(p.oal), 80) }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "F=4", f: p => eq(num(p.fluteCount), 4) }],
  [{ k: "φ=12", f: p => eq(num(p.diameterMm), 12) }, { k: "F≥5", f: p => gte(num(p.fluteCount), 5) }],
  [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "coating~T-Coating", f: p => ilike(p.coating, "T-Coating") }],
  [{ k: "φ=6", f: p => eq(num(p.diameterMm), 6) }, { k: "uncoated", f: p => p.coating == null || p.coating === "" || /bright|uncoat/i.test(p.coating) ? ok : no }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "stock>0 (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "stock>0 (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "brand~X5070", f: p => ilike(p.brand, "X5070") }],
  [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "brand≠ALU-POWER", f: p => notLike(p.brand, "ALU-POWER") }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "F=4", f: p => eq(num(p.fluteCount), 4) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }, { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") }],
  [{ k: "φ ∈ [8,12]", f: p => inRange(num(p.diameterMm), 8, 12) }, { k: "F=4", f: p => eq(num(p.fluteCount), 4) }, { k: "OAL≥80", f: p => gte(num(p.oal), 80) }, { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "helix≥45 (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "shank∈[6,10] (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "CL≥20", f: p => gte(num(p.cl), 20) }],
  [{ k: "φ=8", f: p => eq(num(p.diameterMm), 8) }, { k: "point=140 (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }, { k: "coolanthole (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "pitch=1.5 (응답에 컬럼없음)", f: () => na }],
  [{ k: "φ=999", f: p => eq(num(p.diameterMm), 999) }],
  [{ k: "모순(검증불가)", f: () => na }],
  [{ k: "φ ∈ [6.3,6.4]", f: p => inRange(num(p.diameterMm), 6.3, 6.4) }],
  [{ k: "φ=10", f: p => eq(num(p.diameterMm), 10) }, { k: "F=4", f: p => eq(num(p.fluteCount), 4) }, { k: "OAL≥100", f: p => gte(num(p.oal), 100) }, { k: "coating~TiAlN", f: p => ilike(p.coating, "TiAlN") }],
]

function evalProduct(i, p) {
  const conds = CONSTRAINTS[i] || []
  const checks = conds.map(c => ({ k: c.k, r: c.f(p) }))
  const fails = checks.filter(x => x.r === no).length
  const passes = checks.filter(x => x.r === ok).length
  let tag
  if (fails > 0) tag = "✗FAIL"
  else if (passes === 0) tag = "—N/A"
  else tag = "✅PASS"
  return { tag, details: checks.map(x => `${x.k}:${x.r}`).join("  ") }
}

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
  if (dbCount >= 50 && ep >= 50) return { tag: "✅정확", note: `DB ${dbCount} / cap 50` }
  if (Math.abs(ep - dbCount) <= Math.max(2, dbCount * 0.15)) return { tag: "✅정확", note: `DB ${dbCount} / endpoint ${ep}` }
  if (ep > dbCount * 1.5) return { tag: "⚠️과다", note: `DB ${dbCount} / endpoint ${ep}` }
  if (ep < dbCount * 0.5) return { tag: "⚠️과소", note: `DB ${dbCount} / endpoint ${ep}` }
  return { tag: "🟡차이", note: `DB ${dbCount} / endpoint ${ep}` }
}

async function main() {
  const c = new Client({ host: "20.119.98.136", port: 5432, user: "smart_catalog", password: "smart_catalog", database: "smart_catalog" })
  await c.connect()
  const verified = []
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i]
    const spec = SPECS[i]
    let dbCount = null
    try { dbCount = parseInt((await c.query(spec.sql)).rows[0].count, 10) }
    catch (e) { dbCount = `ERR:${e.message.slice(0, 30)}` }
    const v = typeof dbCount === "number" ? caseVerdict(spec, dbCount, r.candidateCount) : { tag: "❓DB오류", note: dbCount }
    verified.push({ ...r, dbCount: typeof dbCount === "number" ? dbCount : null, dbLabel: spec.label, sql: spec.sql, verdict: v.tag, verdictNote: v.note })
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
  const TI = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1C4E9" } }
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
  const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
  const FT = { name: "Malgun Gothic", size: 10 }
  const FTB = { name: "Malgun Gothic", size: 10, bold: true }

  // ═════ 시트1: 📖 설명 ═════
  const s0 = wb.addWorksheet("📖 설명", { views: [{ state: "frozen", ySplit: 0 }] })
  s0.columns = [{ width: 22 }, { width: 95 }]

  const sec = (label, fill = TI) => {
    const row = s0.addRow([label, ""])
    s0.mergeCells(`A${row.number}:B${row.number}`)
    row.getCell(1).fill = fill
    row.getCell(1).font = { name: "Malgun Gothic", size: 12, bold: true, color: { argb: "FF1A237E" } }
    row.getCell(1).alignment = { vertical: "middle" }
    row.height = 26
  }
  const kv = (k, v) => {
    const row = s0.addRow([k, v])
    row.getCell(1).font = FTB; row.getCell(1).alignment = { vertical: "middle" }
    row.getCell(2).font = FT; row.getCell(2).alignment = { vertical: "middle", wrapText: true }
    row.getCell(1).border = BD; row.getCell(2).border = BD
    row.height = Math.max(20, Math.ceil(String(v).length / 80) * 18)
  }

  // 헤더
  s0.mergeCells("A1:B1")
  s0.getCell("A1").value = "수찬님 Product Finder 스트레스 테스트 + DB Ground Truth 검증"
  s0.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s0.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s0.getRow(1).height = 36
  s0.addRow([])

  sec("1. 테스트 개요")
  kv("일시", "2026-04-07")
  kv("타겟", `${data.target}`)
  kv("DB", "smart_catalog @ 20.119.98.136:5432 (raw_catalog 스키마)")
  kv("케이스 수", `${data.results.length}`)
  kv("방식", "각 케이스마다 단발(single-shot) POST /api/recommend. intakeForm + user 메시지 1개. 멀티턴 X.")
  kv("스크립트", "test-results/suchan-finder-stress.js (요청), build-suchan-final.js (검증+xlsx 빌드)")
  s0.addRow([])

  sec("2. 무엇을 테스트했나")
  kv("의도", "Product Finder가 다양한 multi-filter 조건(직경/날수/전장/코팅/소재/브랜드/재고/범위)을 정확히 처리하는지")
  kv("케이스 분류", "단순필터 (#1~3, 6, 8) | 범위필터 (#4, 5, 7, 16~18) | 다중필터 (#14, 15, 25) | 부정필터 (#9, 13) | 카테고리 (#19~21) | 엣지케이스 (#22~24)")
  kv("주의", "재고/헬릭스/생크/포인트각/피치 등 일부 조건은 endpoint 응답에 컬럼이 없어서 제품 수준 검증은 불가 (DB 수준 검증은 함). 시트3 N/A 표시")
  s0.addRow([])

  sec("3. 검증 방법 — 두 단계")
  kv("Step 1 (시트2)", "케이스별: endpoint가 반환한 cand 개수를 DB ground truth와 비교 → 케이스 verdict 부여")
  kv("Step 2 (시트3)", "제품별: endpoint top-3 각 제품이 케이스 조건을 실제로 만족하는지 컬럼별 ✓/✗/— 체크 → 제품 verdict 부여")
  kv("DB 출처", "raw_catalog.prod_edp_option_milling/holemaking/threading (95k+52k+33k rows). 소재는 prod_series_work_material_status 조인. 재고는 catalog_app.inventory_snapshot.")
  s0.addRow([])

  sec("4. 케이스 verdict 정의 (시트2)", { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } })
  kv("✅정확", "DB count ≈ endpoint count (또는 DB ≥ 50인데 endpoint cap 50). 갯수 차원에서 문제 없음.")
  kv("❌오탐", "DB=0인데 endpoint가 결과 반환 → 존재하지 않는 매칭을 만들어냄 (필터 무시 / 환각). 100% 틀림.")
  kv("❌누락", "DB에 결과 충분히 있는데 endpoint=0 → 카테고리/필터가 죽음. 100% 틀림.")
  kv("⚠️과소", "endpoint < DB × 0.5 (cap 영향 없음). 좋은 후보를 사용자에게 안 보여줌. 보여준 것이 틀렸다는 뜻은 아님 — 더 보여줄 수 있는데 적게 보여줌.")
  kv("⚠️과다", "endpoint > DB × 1.5. 필터 누락 의심 (특정 조건이 무시됨).")
  kv("🟡차이", "위 어디에도 안 드는 작은 차이. 검토 필요.")
  s0.addRow([])

  sec("5. 제품 verdict 정의 (시트3)", { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } })
  kv("✅PASS", "검증 가능한 모든 조건을 만족 (적어도 하나 이상 조건이 ✓)")
  kv("✗FAIL", "최소 1개 조건을 위반 → 이 제품은 결과로 나오면 안 되는데 나옴")
  kv("—N/A", "endpoint 응답에 해당 컬럼이 없어서 검증 불가 (helix angle, shank dia, point angle, pitch, stock)")
  s0.addRow([])

  sec("6. 케이스 verdict ≠ 제품 verdict — 어떻게 읽나", { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } })
  kv("두 차원이 다름", "케이스 verdict는 '몇 개를 보여주는가'(개수). 제품 verdict는 '보여준 것이 조건에 맞는가'(품질). 둘 다 같이 봐야 함.")
  kv("⚠️과소 + ✅PASS", "보여준 것은 잘 골랐는데 양이 적음. 사용자가 선택지가 부족하다고 느낄 수 있음. (예: #14 — 1개 보여줬는데 그 1개는 정확히 맞음)")
  kv("❌오탐 + ✗FAIL", "있지도 않은 결과를 만들어내고, 그 결과들도 조건 위반. 명백한 버그. (예: #23, #24)")
  kv("❌오탐 + ✅PASS", "있어선 안 되는 결과지만 보여준 제품 자체는 우연히 case 조건에 맞음. 필터 누락이지만 사용자는 눈치 못 챌 수도.")
  kv("✅정확 + ✗FAIL", "개수는 맞는데 어떤 제품이 조건 위반. 정렬/스코어링 버그 가능성.")
  s0.addRow([])

  sec("7. 종합 결과 한눈에", { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } })
  const correct = verified.filter(r => r.verdict.startsWith("✅")).length
  const wrong = verified.filter(r => r.verdict.startsWith("❌")).length
  const warn = verified.filter(r => r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")).length
  kv("케이스 verdict", `✅정확 ${correct} / ❌오류 ${wrong} / ⚠️차이 ${warn}  (총 ${verified.length})`)

  let pp = 0, pf = 0, pn = 0
  verified.forEach((r, i) => {
    (r.sampleProducts || []).forEach(p => {
      const v = evalProduct(i, p)
      if (v.tag === "✅PASS") pp++
      else if (v.tag === "✗FAIL") pf++
      else pn++
    })
  })
  kv("제품 verdict (top-3 기준)", `✅PASS ${pp} / ✗FAIL ${pf} / —N/A ${pn}  (총 ${pp + pf + pn})`)
  s0.addRow([])

  sec("8. 주요 발견 (요약)", { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } })
  kv("🔴 카테고리 죽음", "#19 Drill point, #20 Drill+coolant, #21 Tap M10 → DB에 87/121/355건 있는데 endpoint 0건. Holemaking/Threading 라우팅 자체가 죽어있음.")
  kv("🔴 필터 무시", "#23 모순(≥20 ≤5), #24 1/4인치(6.35) → DB=0인데 50건 반환. 직경 조건 자체가 무시됨.")
  kv("🟠 narrowing 과도", "#14 (DB 15→1), #16 (DB 214→17). 좋은 후보를 사용자가 못 봄.")
  kv("🟠 shank 파싱", "#17 Shank 6~10 → DB 1742건인데 0건. 생크 직경 범위 표현 인식 실패.")
  kv("🟢 잘 되는 것", "단순 직경/소재/4F/T-Coating 등 단일 필터, X5070 brand 매칭, 999mm 정직한 0건 — 모두 정상")
  s0.addRow([])

  sec("9. 시트 안내")
  kv("시트1 (이 시트)", "📖 설명 — 테스트 목적, verdict 정의, 결과 요약, 읽는 법")
  kv("시트2", "DB 검증 결과 — 25개 케이스의 케이스 verdict (✅/❌/⚠️) + DB count + endpoint count")
  kv("시트3", "Top-3 + 제품별 검증 — 각 케이스 top-3 제품의 PASS/FAIL + 조건별 ✓/✗ 상세")
  kv("시트4", "SQL 명세 — 재현용 DB 쿼리 (raw_catalog 기준)")

  // ═════ 시트2: DB 검증 결과 ═════
  const s1 = wb.addWorksheet("DB 검증 결과", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:I1")
  s1.getCell("A1").value = "케이스별 DB 검증"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 30
  s1.mergeCells("A2:I2")
  s1.getCell("A2").value = `Endpoint: ${data.target} | DB: smart_catalog (raw_catalog) | ✅${correct} ❌${wrong} ⚠️${warn} / ${verified.length}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF555555" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [{ width: 5 }, { width: 36 }, { width: 38 }, { width: 8 }, { width: 8 }, { width: 12 }, { width: 38 }, { width: 38 }, { width: 8 }]
  const hdrs1 = ["#", "케이스", "메시지", "DB", "EP", "verdict", "DB filter", "비고", "ms"]
  const hr1 = s1.getRow(3)
  hdrs1.forEach((h, i) => {
    const c = hr1.getCell(i + 1); c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr1.height = 24

  verified.forEach((r, i) => {
    const row = s1.getRow(i + 4)
    row.values = [i + 1, r.name, r.msg, r.dbCount ?? "", r.candidateCount ?? 0, r.verdict, r.dbLabel, r.verdictNote, r.ms]
    let fill = GY
    if (r.verdict.startsWith("✅")) fill = G
    else if (r.verdict.startsWith("❌")) fill = R
    else if (r.verdict.startsWith("⚠️") || r.verdict.startsWith("🟡")) fill = Y
    row.getCell(6).fill = fill
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 32
  })

  // ═════ 시트3: Top-3 + 제품별 검증 ═════
  const s2 = wb.addWorksheet("Top-3 + 제품별 검증", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [
    { header: "#", width: 5 }, { header: "케이스", width: 36 },
    { header: "rank", width: 6 }, { header: "verdict", width: 11 },
    { header: "조건 상세 (조건:✓/✗/—)", width: 70 },
    { header: "series", width: 18 }, { header: "brand", width: 22 },
    { header: "φ", width: 7 }, { header: "F", width: 5 },
    { header: "OAL", width: 7 }, { header: "CL", width: 7 }, { header: "coating", width: 18 },
  ]
  const hr2 = s2.getRow(1)
  hr2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  hr2.height = 22

  let r2 = 2
  verified.forEach((r, i) => {
    const samples = r.sampleProducts.length ? r.sampleProducts : []
    if (samples.length === 0) {
      const row = s2.getRow(r2++)
      row.values = [i + 1, r.name, "-", "—없음", "(샘플 없음 — endpoint candidates=0)", "", "", "", "", "", "", ""]
      row.eachCell(c => { c.border = BD; c.font = FT; c.fill = GY })
      return
    }
    samples.forEach((p, j) => {
      const v = evalProduct(i, p)
      const row = s2.getRow(r2++)
      row.values = [
        j === 0 ? i + 1 : "", j === 0 ? r.name : "",
        j + 1, v.tag, v.details,
        p.series ?? "", p.brand ?? "", p.diameterMm ?? "",
        p.fluteCount ?? "", p.oal ?? "", p.cl ?? "", p.coating ?? "",
      ]
      let fill = GY
      if (v.tag === "✅PASS") fill = G
      else if (v.tag === "✗FAIL") fill = R
      row.getCell(4).fill = fill
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
      row.height = 22
    })
  })

  // ═════ 시트4: SQL 명세 ═════
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

  await wb.xlsx.writeFile(OUT)
  console.log("xlsx →", OUT)
  console.log(`케이스: ✅${correct} ❌${wrong} ⚠️${warn} / ${verified.length}`)
  console.log(`제품:   ✅${pp} ✗${pf} —${pn}`)
}

main().catch(e => { console.error(e); process.exit(1) })
