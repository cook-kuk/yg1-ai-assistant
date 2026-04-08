#!/usr/bin/env node
/**
 * 최신 suchan-finder-stress JSON + 어제 xlsx의 DB ground truth 를 합쳐
 * reports/ 에 25케이스 리포트 xlsx 를 생성.
 * 사용: node scripts/build-25case-xlsx.mjs <latest.json> [out.xlsx]
 */
import fs from "node:fs"
import path from "node:path"
import XLSX from "xlsx"

const latestPath = process.argv[2]
const outPath = process.argv[3] || path.join("reports", `finder-25cases-${new Date().toISOString().slice(0,10)}.xlsx`)
if (!latestPath || !fs.existsSync(latestPath)) {
  console.error("usage: node scripts/build-25case-xlsx.mjs <latest.json>")
  process.exit(1)
}

const baselineXlsx = "C:/Users/kuksh/Downloads/20260407_report/finder-25케이스-비교-precision.xlsx"
const wb0 = XLSX.readFile(baselineXlsx)
const baseRows = XLSX.utils.sheet_to_json(wb0.Sheets["25 케이스 비교"], { defval: "" })
const latest = JSON.parse(fs.readFileSync(latestPath, "utf8"))
const results = Array.isArray(latest) ? latest : (latest.results || [])

function verdict(db, ep) {
  if (db === 0 && ep === 0) return "✅"
  if (Math.abs(ep - db) <= 2) return "✅"
  if (ep > db) return "⚠️과다"
  if (ep > 0) return "⚠️과소"
  return "❌누락"
}

const outRows = [["#", "케이스", "메시지", "DB", "내 EP", "|내-DB|", "내 verdict", "ms"]]
let exact=0, under=0, over=0, miss=0, sum=0, n=0
for (let i = 0; i < baseRows.length; i++) {
  const r = baseRows[i]
  const db = Number(r.DB) || 0
  const cur = Number(results[i]?.candidateCount ?? results[i]?.cand ?? 0)
  const ms = Number(results[i]?.ms ?? results[i]?.latencyMs ?? 0)
  const v = verdict(db, cur)
  if (v === "✅") exact++
  else if (v.includes("과소")) under++
  else if (v.includes("과다")) over++
  else miss++
  sum += Math.abs(cur - db); n++
  outRows.push([i+1, r["케이스"], r["메시지"], db, cur, Math.abs(cur-db), v, ms])
}

const summary = [
  ["Finder 25 케이스 — DB vs 내(:3000)", "", ""],
  ["", "DB ground truth", "내 (:3000)"],
  ["총 케이스", "25", "25"],
  ["DB 정확 매칭", "—", String(exact)],
  ["정확도", "—", `${Math.round(exact/25*100)}%`],
  ["verdict 분포", "내", ""],
  ["✅", String(exact), ""],
  ["⚠️과다", String(over), ""],
  ["⚠️과소", String(under), ""],
  ["❌누락", String(miss), ""],
  ["평균 |오차|", String(Math.round(sum/n)), ""],
]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "요약")
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(outRows), "25 케이스 비교")

fs.mkdirSync(path.dirname(outPath), { recursive: true })
XLSX.writeFile(wb, outPath)
console.log(`[xlsx] ${outPath}`)
console.log(`[summary] exact=${exact} under=${under} over=${over} miss=${miss} avgDiff=${Math.round(sum/n)}`)
