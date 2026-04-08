/**
 * Suchan stress test JSON → xlsx
 * usage: node test-results/suchan-stress-to-xlsx.js [json-file]
 */
const ExcelJS = require("exceljs")
const fs = require("fs")
const path = require("path")

// 최신 suchan json 자동 선택
const dir = __dirname
const arg = process.argv[2]
const file = arg
  ? path.resolve(arg)
  : fs.readdirSync(dir)
      .filter(f => /^suchan-finder-stress-.*\.json$/.test(f))
      .sort()
      .map(f => path.join(dir, f))
      .filter(p => {
        try { const d = JSON.parse(fs.readFileSync(p, "utf8")); return d.target && d.target.includes("20.119") }
        catch { return false }
      })
      .pop()

if (!file) { console.error("suchan json 파일 못 찾음"); process.exit(1) }
console.log("source:", file)

const data = JSON.parse(fs.readFileSync(file, "utf8"))

async function main() {
  const wb = new ExcelJS.Workbook()
  const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } }
  const G = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5F5E3" } }
  const R = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
  const Y = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF9E7" } }
  const LB = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAF6" } }
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, size: 11, name: "Malgun Gothic" }
  const BD = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }
  const FT = { name: "Malgun Gothic", size: 10 }

  // ── Sheet 1: 결과 요약 ──
  const s1 = wb.addWorksheet("결과 요약", { views: [{ state: "frozen", ySplit: 3 }] })
  s1.mergeCells("A1:L1")
  s1.getCell("A1").value = "수찬님 Product Finder 스트레스 테스트"
  s1.getCell("A1").font = { name: "Malgun Gothic", size: 16, bold: true, color: { argb: "FF1A237E" } }
  s1.getCell("A1").alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(1).height = 32
  s1.mergeCells("A2:L2")
  s1.getCell("A2").value = `Target: ${data.target} | RunAt: ${data.runAt} | Total: ${data.results.length}`
  s1.getCell("A2").font = Object.assign({}, FT, { color: { argb: "FF757575" } })
  s1.getCell("A2").alignment = { horizontal: "center" }

  s1.columns = [
    { width: 5 }, { width: 36 }, { width: 38 }, { width: 8 },
    { width: 9 }, { width: 14 }, { width: 22 }, { width: 8 },
    { width: 18 }, { width: 8 }, { width: 8 }, { width: 8 },
  ]
  const headers = ["#", "케이스", "메시지", "HTTP", "ms", "purpose", "orchestrator", "cand", "top1 series", "φ", "F", "OAL"]
  const hr = s1.getRow(3)
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1)
    c.value = h; c.fill = HDR; c.font = WF; c.border = BD
    c.alignment = { horizontal: "center", vertical: "middle" }
  })
  hr.height = 24

  data.results.forEach((r, i) => {
    const row = s1.getRow(i + 4)
    const t1 = r.sampleProducts[0] || {}
    row.getCell(1).value = i + 1
    row.getCell(2).value = r.name
    row.getCell(3).value = r.msg
    row.getCell(4).value = r.status
    row.getCell(5).value = r.ms
    row.getCell(6).value = r.purpose
    row.getCell(7).value = r.orchestrator
    row.getCell(8).value = r.candidateCount
    row.getCell(9).value = t1.series
    row.getCell(10).value = t1.diameterMm
    row.getCell(11).value = t1.fluteCount
    row.getCell(12).value = t1.oal

    // 색상: cand 0이면 빨강, narrowing(<50)이면 초록, 50이면 노랑
    const cand = r.candidateCount
    let fill = null
    if (cand === 0 || cand == null) fill = R
    else if (cand >= 50) fill = Y
    else fill = G
    row.getCell(8).fill = fill

    for (let c = 1; c <= 12; c++) {
      row.getCell(c).border = BD
      row.getCell(c).font = FT
      row.getCell(c).alignment = { vertical: "middle", wrapText: true }
    }
    row.height = 28
  })

  // 요약 통계
  const total = data.results.length
  const ok = data.results.filter(r => r.status === 200 && !r.error).length
  const withCand = data.results.filter(r => (r.candidateCount ?? 0) > 0).length
  const noResult = data.results.filter(r => r.candidateCount === 0 || r.candidateCount == null).length
  const avg = Math.round(data.results.reduce((s, r) => s + r.ms, 0) / total)
  const summaryRow = total + 5
  s1.mergeCells(`A${summaryRow}:L${summaryRow}`)
  const sc = s1.getCell(`A${summaryRow}`)
  sc.value = `합계  HTTP200: ${ok}/${total}   |   candidates>0: ${withCand}/${total}   |   no_results: ${noResult}/${total}   |   avg latency: ${avg}ms`
  sc.fill = LB
  sc.font = { name: "Malgun Gothic", size: 11, bold: true }
  sc.alignment = { horizontal: "center", vertical: "middle" }
  s1.getRow(summaryRow).height = 26

  // ── Sheet 2: top-3 sample products ──
  const s2 = wb.addWorksheet("Top-3 샘플", { views: [{ state: "frozen", ySplit: 1 }] })
  s2.columns = [
    { header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "rank", width: 6 },
    { header: "series", width: 18 }, { header: "brand", width: 22 }, { header: "φ mm", width: 8 },
    { header: "F", width: 6 }, { header: "OAL", width: 8 }, { header: "CL", width: 8 },
    { header: "coating", width: 18 }, { header: "stock", width: 8 },
  ]
  const h2 = s2.getRow(1)
  h2.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  h2.height = 22

  let r2 = 2
  data.results.forEach((r, i) => {
    const samples = r.sampleProducts.length ? r.sampleProducts : [{}]
    samples.forEach((p, j) => {
      const row = s2.getRow(r2++)
      row.values = [
        j === 0 ? i + 1 : "",
        j === 0 ? r.name : "",
        j + 1,
        p.series ?? "",
        p.brand ?? "",
        p.diameterMm ?? "",
        p.fluteCount ?? "",
        p.oal ?? "",
        p.cl ?? "",
        p.coating ?? "",
        p.stock ?? "",
      ]
      row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "middle" } })
    })
  })

  // ── Sheet 3: 응답 텍스트 ──
  const s3 = wb.addWorksheet("응답 텍스트", { views: [{ state: "frozen", ySplit: 1 }] })
  s3.columns = [{ header: "#", width: 5 }, { header: "케이스", width: 36 }, { header: "응답 text (200자)", width: 90 }]
  const h3 = s3.getRow(1)
  h3.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: "center" } })
  data.results.forEach((r, i) => {
    const row = s3.getRow(i + 2)
    row.values = [i + 1, r.name, r.text || ""]
    row.eachCell(c => { c.border = BD; c.font = FT; c.alignment = { vertical: "top", wrapText: true } })
    row.height = 40
  })

  const out = file.replace(/\.json$/, ".xlsx")
  await wb.xlsx.writeFile(out)
  console.log("xlsx →", out)
}

main().catch(e => { console.error(e); process.exit(1) })
