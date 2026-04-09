const XLSX = require("xlsx")
const fs = require("fs")
const path = require("path")

const inFile = process.argv[2] || "test-results/smart-engine-v2.json"
const outFile = process.argv[3] || "test-results/smart-engine-v2.xlsx"

const data = JSON.parse(fs.readFileSync(inFile, "utf8"))

// vitest json: { numTotalTests, numPassedTests, numFailedTests, testResults: [{ name, status, assertionResults: [{ ancestorTitles, title, status, duration, failureMessages }] }] }

const detailRows = []
const fileRows = []
for (const file of data.testResults || []) {
  const rel = path.relative(process.cwd(), file.name).replace(/\\/g, "/")
  let pass = 0, fail = 0
  for (const t of file.assertionResults || []) {
    detailRows.push({
      파일: rel,
      "describe 블록": (t.ancestorTitles || []).join(" > "),
      테스트: t.title,
      상태: t.status === "passed" ? "✅ pass" : t.status === "failed" ? "❌ fail" : t.status,
      "소요(ms)": t.duration ?? "",
      에러: (t.failureMessages || []).join(" | ").slice(0, 500),
    })
    if (t.status === "passed") pass++
    else if (t.status === "failed") fail++
  }
  fileRows.push({
    파일: rel,
    "총 테스트": (file.assertionResults || []).length,
    pass,
    fail,
    상태: fail === 0 ? "✅" : "❌",
    "파일 소요(ms)": (file.endTime ?? 0) - (file.startTime ?? 0),
  })
}

const summaryRows = [
  { 항목: "총 파일", 값: data.numTotalTestSuites ?? fileRows.length },
  { 항목: "총 테스트", 값: data.numTotalTests ?? detailRows.length },
  { 항목: "통과", 값: data.numPassedTests ?? detailRows.filter(r => r.상태.includes("pass")).length },
  { 항목: "실패", 값: data.numFailedTests ?? detailRows.filter(r => r.상태.includes("fail")).length },
  { 항목: "시작", 값: new Date(data.startTime ?? Date.now()).toLocaleString("ko-KR") },
  { 항목: "성공률", 값: data.numTotalTests ? `${((data.numPassedTests / data.numTotalTests) * 100).toFixed(1)}%` : "" },
]

const wb = XLSX.utils.book_new()

const wsSum = XLSX.utils.json_to_sheet(summaryRows)
wsSum["!cols"] = [{ wch: 14 }, { wch: 26 }]
XLSX.utils.book_append_sheet(wb, wsSum, "요약")

const wsFiles = XLSX.utils.json_to_sheet(fileRows)
wsFiles["!cols"] = [{ wch: 60 }, { wch: 10 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 14 }]
XLSX.utils.book_append_sheet(wb, wsFiles, "파일별")

const wsDetail = XLSX.utils.json_to_sheet(detailRows)
wsDetail["!cols"] = [{ wch: 60 }, { wch: 30 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 60 }]
XLSX.utils.book_append_sheet(wb, wsDetail, "전체 케이스")

XLSX.writeFile(wb, outFile)
console.log(`✅ ${outFile} 생성 완료 (${detailRows.length} cases, ${fileRows.length} files)`)
