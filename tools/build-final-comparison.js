/**
 * Build final comparison xlsx — main vs suchan based on latest hard-test runs.
 * Uses hard-test-report.json (current main) and hard-test-report-suchan.json
 */
const ExcelJS = require("exceljs"), fs = require("fs"), path = require("path")

const MAIN_JSON = "test-results/hard-test-report.json"  // current main run
const SUCHAN_JSON = "test-results/hard-test-report-suchan.json"
const OUT = "test-results/main_test_grind_final.xlsx"

if (!fs.existsSync(MAIN_JSON)) { console.error("missing", MAIN_JSON); process.exit(1) }
if (!fs.existsSync(SUCHAN_JSON)) { console.error("missing", SUCHAN_JSON); process.exit(1) }

const main = JSON.parse(fs.readFileSync(MAIN_JSON, "utf8"))
const suchan = JSON.parse(fs.readFileSync(SUCHAN_JSON, "utf8"))

// Index by id
const mainById = Object.fromEntries((main.items || []).map(i => [i.id, i]))
const suchanById = Object.fromEntries((suchan.items || []).map(i => [i.id, i]))
const allIds = new Set([...Object.keys(mainById), ...Object.keys(suchanById)])

const rows = []
const summary = { mainPass: 0, mainFail: 0, mainErr: 0, sPass: 0, sFail: 0, sErr: 0, mWin: 0, sWin: 0, tie: 0 }
for (const id of allIds) {
  const m = mainById[id] || {}
  const s = suchanById[id] || {}
  const mv = m.verdict || "-"
  const sv = s.verdict || "-"
  if (mv === "PASS") summary.mainPass++; else if (mv === "FAIL") summary.mainFail++; else if (mv === "ERROR") summary.mainErr++
  if (sv === "PASS") summary.sPass++; else if (sv === "FAIL") summary.sFail++; else if (sv === "ERROR") summary.sErr++
  let cmp = "="
  if (mv === "PASS" && sv !== "PASS") { cmp = "내가 ↑"; summary.mWin++ }
  else if (sv === "PASS" && mv !== "PASS") { cmp = "수찬 ↑"; summary.sWin++ }
  else summary.tie++
  rows.push({
    id, src: m.case?.source || s.case?.source || "?",
    cmp, mv, sv,
    mReason: m.reason || "", sReason: s.reason || "",
    userIn: (m.case?.turns?.[m.case.turns.length - 1] || s.case?.turns?.[s.case?.turns?.length - 1] || "").slice(0, 100),
  })
}

;(async () => {
  const wb = new ExcelJS.Workbook()
  const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } }
  const G = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }
  const R = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
  const Y = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } }
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
  const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
  const FT = { name: "Malgun Gothic", size: 10 }

  const s0 = wb.addWorksheet("요약")
  s0.columns = [{ width: 30 }, { width: 30 }, { width: 30 }]
  s0.mergeCells("A1:C1")
  s0.getCell("A1").value = "내 (cook_ver1) vs 수찬님 — 최종 빡센 테스트 비교 (밤샘 grind 후)"
  s0.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s0.getCell("A1").alignment = { horizontal: "center" }
  s0.getRow(1).height = 32
  s0.addRow([])
  const data = [
    ["", "내 배포 (3000)", "수찬님 배포 (2999)"],
    ["총 케이스", String(allIds.size), String(allIds.size)],
    ["PASS", `${summary.mainPass} (${(summary.mainPass / allIds.size * 100).toFixed(1)}%)`, `${summary.sPass} (${(summary.sPass / allIds.size * 100).toFixed(1)}%)`],
    ["FAIL", String(summary.mainFail), String(summary.sFail)],
    ["ERROR", String(summary.mainErr), String(summary.sErr)],
    ["", "", ""],
    ["케이스별 우열", "", ""],
    ["내가 이긴 케이스", String(summary.mWin), ""],
    ["수찬님이 이긴 케이스", String(summary.sWin), ""],
    ["동률", String(summary.tie), ""],
  ]
  data.forEach((r, i) => {
    const row = s0.addRow(r)
    if (i === 0) row.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
    else { row.eachCell(c => { c.font = FT; c.border = BD }); row.height = 22 }
  })

  // Sheet 2: details
  const s1 = wb.addWorksheet("케이스별 비교", { views: [{ state: "frozen", ySplit: 1 }] })
  s1.columns = [
    { header: "ID", width: 18 }, { header: "소스", width: 14 }, { header: "비교", width: 10 },
    { header: "내 판정", width: 9 }, { header: "수찬 판정", width: 9 },
    { header: "내 사유", width: 28 }, { header: "수찬 사유", width: 28 },
    { header: "사용자 입력", width: 60 },
  ]
  const h1 = s1.getRow(1)
  h1.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  rows.sort((a, b) => {
    // Wins first, then fails
    const order = { "내가 ↑": 0, "수찬 ↑": 1, "=": 2 }
    return order[a.cmp] - order[b.cmp]
  })
  rows.forEach((r, i) => {
    const row = s1.getRow(i + 2)
    row.values = [r.id, r.src, r.cmp, r.mv, r.sv, r.mReason, r.sReason, r.userIn]
    if (r.cmp === "내가 ↑") row.getCell(3).fill = G
    else if (r.cmp === "수찬 ↑") row.getCell(3).fill = R
    if (r.mv === "PASS") row.getCell(4).fill = G
    else if (r.mv === "FAIL") row.getCell(4).fill = R
    else if (r.mv === "ERROR") row.getCell(4).fill = Y
    if (r.sv === "PASS") row.getCell(5).fill = G
    else if (r.sv === "FAIL") row.getCell(5).fill = R
    else if (r.sv === "ERROR") row.getCell(5).fill = Y
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle", wrapText: true } })
    row.height = 22
  })

  await wb.xlsx.writeFile(OUT)
  console.log("✓", OUT)
  console.log(`내: PASS ${summary.mainPass}/${allIds.size} (${(summary.mainPass / allIds.size * 100).toFixed(1)}%)`)
  console.log(`수찬: PASS ${summary.sPass}/${allIds.size} (${(summary.sPass / allIds.size * 100).toFixed(1)}%)`)
  console.log(`내가 이긴 ${summary.mWin}, 수찬 이긴 ${summary.sWin}, 동률 ${summary.tie}`)
})().catch(e => console.error(e))
