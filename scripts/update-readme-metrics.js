#!/usr/bin/env node
/**
 * update-readme-metrics.js
 *
 * Merge/push 전에 실행: reports/latest-metrics.xlsx 를 읽어 요약 표를 만들고
 * README.md 상단의 <!-- METRICS:START --> ~ <!-- METRICS:END --> 블록을 교체.
 *
 * 사용법:
 *   node scripts/update-readme-metrics.js                 # 기본 파일 사용
 *   node scripts/update-readme-metrics.js path/to.xlsx    # 다른 xlsx 지정
 *
 * 동작:
 *   1) 지정한 xlsx를 reports/latest-metrics.xlsx 로 복사 (경로가 다를 때만)
 *   2) "요약" 시트 + "25 케이스 비교" 시트를 파싱
 *   3) README 상단 블록 갱신 — 파일 클릭 링크 + 요약 표 + 총평 1줄
 */

const fs = require("fs")
const path = require("path")
const XLSX = require("xlsx")

const ROOT = path.resolve(__dirname, "..")
const README = path.join(ROOT, "README.md")
const REPORT_DIR = path.join(ROOT, "reports")
const DEFAULT_XLSX = path.join(REPORT_DIR, "latest-metrics.xlsx")

const START_MARK = "<!-- METRICS:START -->"
const END_MARK = "<!-- METRICS:END -->"

function main() {
  const argPath = process.argv[2]
  if (argPath) {
    if (!fs.existsSync(argPath)) {
      console.error(`[metrics] file not found: ${argPath}`)
      process.exit(1)
    }
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.copyFileSync(argPath, DEFAULT_XLSX)
    console.log(`[metrics] copied → ${path.relative(ROOT, DEFAULT_XLSX)}`)
  }
  if (!fs.existsSync(DEFAULT_XLSX)) {
    console.error(`[metrics] no xlsx at ${DEFAULT_XLSX}`)
    process.exit(1)
  }

  const block = buildBlock(DEFAULT_XLSX)
  const readme = fs.readFileSync(README, "utf8")
  const next = injectBlock(readme, block)
  if (next === readme) {
    console.log("[metrics] README unchanged")
    return
  }
  fs.writeFileSync(README, next)
  console.log("[metrics] README updated")
}

function buildBlock(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath)
  const relXlsx = path.relative(ROOT, xlsxPath).replace(/\\/g, "/")
  const mtime = fs.statSync(xlsxPath).mtime.toISOString().slice(0, 10)

  // 요약 시트 (있으면)
  let summaryLines = []
  if (wb.SheetNames.includes("요약")) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["요약"], { header: 1, defval: "" })
    for (const r of rows) {
      const cells = r.map(c => String(c).trim()).filter(Boolean)
      if (cells.length) summaryLines.push(cells.join(" | "))
    }
  }

  // 25 케이스 — 승패/누락 집계
  let caseTable = ""
  let verdict = ""
  const caseSheetName = wb.SheetNames.find(n => /케이스/.test(n))
  if (caseSheetName) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[caseSheetName], { defval: "" })
    const total = rows.length
    let exact = 0, under = 0, over = 0, miss = 0
    let diffSum = 0, diffN = 0
    for (const r of rows) {
      const v = String(r["내 verdict"] ?? "")
      if (v.includes("✅")) exact++
      else if (v.includes("과소")) under++
      else if (v.includes("과다")) over++
      else if (v.includes("누락")) miss++
      const d = Number(r["|내-DB|"])
      if (Number.isFinite(d)) { diffSum += d; diffN++ }
    }
    const avgDiff = diffN ? Math.round(diffSum / diffN) : 0
    caseTable = [
      "| 지표 | 값 |",
      "|---|---|",
      `| 총 케이스 | ${total} |`,
      `| ✅ 정확 매칭 | ${exact} |`,
      `| ⚠️ 과소 | ${under} |`,
      `| ⚠️ 과다 | ${over} |`,
      `| ❌ 누락 (0건) | ${miss} |`,
      `| 평균 \\|내-DB\\| | ${avgDiff} |`,
    ].join("\n")
    verdict = `**정확도 ${exact}/${total}** · 누락 ${miss}건 · 평균 오차 ${avgDiff}`
  }

  const parts = []
  parts.push(START_MARK)
  parts.push("")
  parts.push(`## 📊 최신 Metric (자동 갱신)`)
  parts.push("")
  parts.push(`- 📎 **리포트 파일**: [\`${relXlsx}\`](${relXlsx}) _(클릭하여 열기, 갱신일 ${mtime})_`)
  if (verdict) parts.push(`- 🎯 ${verdict}`)
  parts.push("")
  if (caseTable) {
    parts.push("<details><summary>25 케이스 요약 표</summary>")
    parts.push("")
    parts.push(caseTable)
    parts.push("")
    if (summaryLines.length) {
      parts.push("**원본 요약 시트**")
      parts.push("")
      parts.push("```")
      parts.push(...summaryLines)
      parts.push("```")
    }
    parts.push("</details>")
    parts.push("")
  }
  parts.push("---")
  parts.push("")
  parts.push(END_MARK)
  return parts.join("\n")
}

function injectBlock(readme, block) {
  const startIdx = readme.indexOf(START_MARK)
  const endIdx = readme.indexOf(END_MARK)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return readme.slice(0, startIdx) + block + readme.slice(endIdx + END_MARK.length)
  }
  // 첫 h1 다음에 삽입
  const firstLineEnd = readme.indexOf("\n")
  if (firstLineEnd === -1) return readme + "\n\n" + block + "\n"
  // 첫 ">" 인용 블록까지 건너뛰고 삽입
  const lines = readme.split("\n")
  let insertAt = 1
  while (insertAt < lines.length && (lines[insertAt].startsWith(">") || lines[insertAt].trim() === "")) {
    insertAt++
  }
  // 구분선(---) 이 있으면 그 다음
  if (lines[insertAt] && lines[insertAt].trim() === "---") insertAt++
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt++
  const head = lines.slice(0, insertAt).join("\n")
  const tail = lines.slice(insertAt).join("\n")
  return head + "\n\n" + block + "\n\n" + tail
}

main()
