#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import ExcelJS from "exceljs"

const ROOT = path.resolve(process.cwd())
const logPath = path.join(ROOT, "test-results", "tsc-errors-20260414.log")
const outPath = path.join(ROOT, "test-results", "tsc-errors-20260414.xlsx")

const raw = fs.readFileSync(logPath, "utf8").split(/\r?\n/)

// parse: path(line,col): error TSxxxx: message
const rowRe = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.*)$/
const records = []
let current = null
for (const line of raw) {
  const m = line.match(rowRe)
  if (m) {
    if (current) records.push(current)
    current = {
      file: m[1].replace(/\\/g, "/"),
      line: Number(m[2]),
      col: Number(m[3]),
      code: m[4],
      message: m[5],
    }
  } else if (current && line.startsWith("  ")) {
    current.message += "\n" + line.trim()
  }
}
if (current) records.push(current)

const classify = (file) => {
  if (/\/__tests__\/|\.test\.ts$|\.spec\.ts$|^e2e\//.test(file)) return "test"
  if (/^lib\/deploy\//.test(file) && /\.test\.ts$/.test(file)) return "test"
  if (/^lib\/recommendation\/infrastructure\/engines\/serve-engine-/.test(file)) return "engine-runtime"
  if (/^lib\/recommendation\/infrastructure\/http\//.test(file)) return "http"
  if (/^lib\/recommendation\/core\//.test(file)) return "resolver-core"
  if (/^lib\/recommendation\/domain\//.test(file)) return "domain"
  if (/^lib\/recommendation\/shared\//.test(file)) return "shared"
  if (/^lib\/recommendation\/infrastructure\/llm\//.test(file)) return "prompt-llm"
  if (/^lib\/llm\//.test(file)) return "llm-provider"
  if (/^lib\/chat\//.test(file)) return "chat"
  if (/^lib\/data\//.test(file)) return "data"
  if (/^app\/api\//.test(file)) return "api-route"
  return "other"
}

const severity = (code, file) => {
  if (classify(file) === "test" && (code === "TS2582" || code === "TS2304" || code === "TS2552")) return "low (test globals)"
  if (code === "TS2339" || code === "TS2322" || code === "TS2345" || code === "TS2554") return "high (real bug)"
  if (code === "TS18046" || code === "TS18047" || code === "TS2532") return "medium (null/unknown guard)"
  if (code === "TS2352") return "medium (cast)"
  return "medium"
}

const rows = records.map(r => ({
  ...r,
  category: classify(r.file),
  severity: severity(r.code, r.file),
}))

const wb = new ExcelJS.Workbook()
wb.creator = "Claude Code"
wb.created = new Date()

// Sheet 1: Summary
const summary = wb.addWorksheet("Summary")
summary.columns = [
  { header: "항목", key: "k", width: 32 },
  { header: "값", key: "v", width: 20 },
]
summary.addRow({ k: "생성 시각", v: new Date().toISOString() })
summary.addRow({ k: "총 에러 수", v: rows.length })
summary.addRow({ k: "영향 파일 수", v: new Set(rows.map(r => r.file)).size })
summary.addRow({})
summary.addRow({ k: "카테고리별 에러 수", v: "" })
const byCat = {}
rows.forEach(r => { byCat[r.category] = (byCat[r.category] || 0) + 1 })
Object.entries(byCat).sort((a,b) => b[1]-a[1]).forEach(([k, v]) => summary.addRow({ k, v }))
summary.addRow({})
summary.addRow({ k: "심각도별 에러 수", v: "" })
const bySev = {}
rows.forEach(r => { bySev[r.severity] = (bySev[r.severity] || 0) + 1 })
Object.entries(bySev).sort((a,b) => b[1]-a[1]).forEach(([k, v]) => summary.addRow({ k, v }))
summary.addRow({})
summary.addRow({ k: "TS 코드별 Top 15", v: "" })
const byCode = {}
rows.forEach(r => { byCode[r.code] = (byCode[r.code] || 0) + 1 })
Object.entries(byCode).sort((a,b) => b[1]-a[1]).slice(0, 15).forEach(([k, v]) => summary.addRow({ k, v }))
summary.getRow(1).font = { bold: true }

// Sheet 2: By File
const byFile = wb.addWorksheet("By File")
byFile.columns = [
  { header: "File", key: "file", width: 80 },
  { header: "Category", key: "category", width: 16 },
  { header: "Error Count", key: "count", width: 12 },
]
const fileMap = {}
rows.forEach(r => {
  if (!fileMap[r.file]) fileMap[r.file] = { file: r.file, category: r.category, count: 0 }
  fileMap[r.file].count++
})
Object.values(fileMap).sort((a,b) => b.count - a.count).forEach(v => byFile.addRow(v))
byFile.getRow(1).font = { bold: true }
byFile.autoFilter = { from: "A1", to: "C1" }

// Sheet 3: All Errors
const all = wb.addWorksheet("All Errors")
all.columns = [
  { header: "File", key: "file", width: 60 },
  { header: "Line", key: "line", width: 8 },
  { header: "Col", key: "col", width: 6 },
  { header: "Code", key: "code", width: 10 },
  { header: "Category", key: "category", width: 16 },
  { header: "Severity", key: "severity", width: 22 },
  { header: "Message", key: "message", width: 100 },
]
rows.forEach(r => all.addRow(r))
all.getRow(1).font = { bold: true }
all.autoFilter = { from: "A1", to: "G1" }
all.views = [{ state: "frozen", ySplit: 1 }]

// Sheet 4: By Code
const byCodeSheet = wb.addWorksheet("By Code")
byCodeSheet.columns = [
  { header: "TS Code", key: "code", width: 10 },
  { header: "Count", key: "count", width: 8 },
  { header: "Sample Message", key: "sample", width: 120 },
]
const codeMap = {}
rows.forEach(r => {
  if (!codeMap[r.code]) codeMap[r.code] = { code: r.code, count: 0, sample: r.message.split("\n")[0] }
  codeMap[r.code].count++
})
Object.values(codeMap).sort((a,b) => b.count - a.count).forEach(v => byCodeSheet.addRow(v))
byCodeSheet.getRow(1).font = { bold: true }

await wb.xlsx.writeFile(outPath)
console.log("Wrote", outPath)
console.log("Total errors:", rows.length, "across", new Set(rows.map(r => r.file)).size, "files")
