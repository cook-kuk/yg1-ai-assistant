import fs from "node:fs"
import X from "xlsx"
const wb = X.readFile("test-results/suchan_test_v1.xlsx")
const rows = X.utils.sheet_to_json(wb.Sheets["DB 검증 결과 v2"], { defval: "", header: 1 })
const db = []
for (const r of rows) if (typeof r[0] === "number" && r[1]) db.push({ no: r[0], name: r[1], dbCount: r[3] })

// Pick latest :3000 result automatically
const files = fs.readdirSync("test-results")
  .filter(f => f.startsWith("suchan-finder-stress-") && f.endsWith(".json"))
  .map(f => { try { return { f, d: JSON.parse(fs.readFileSync("test-results/" + f, "utf8")) } } catch { return null } })
  .filter(x => x && x.d.target?.includes(":3000"))
  .sort((a, b) => (b.d.runAt || "").localeCompare(a.d.runAt || ""))
const mine = files[0].d
console.log("source:", files[0].f, "runAt:", mine.runAt, "\n")
console.log(" # | name(40)                                  | DB    | EP    | diff%   | verdict")
console.log("-".repeat(95))
db.forEach((c, i) => {
  const ep = mine.results[i]?.candidateCount
  const err = mine.results[i]?.error
  const diff = (ep != null && c.dbCount != null && c.dbCount > 0) ? `${(((ep - c.dbCount) / c.dbCount) * 100).toFixed(0)}%` : "-"
  let verdict = "?"
  if (err) verdict = "💥 " + err.slice(0, 25)
  else if (c.dbCount === 0 && ep === 0) verdict = "✅"
  else if (c.dbCount === 0 && ep > 0) verdict = "❌오탐"
  else if (ep === 0 && c.dbCount > 0) verdict = "❌누락"
  else if (ep != null && c.dbCount > 0) {
    const ratio = ep / c.dbCount
    if (ratio >= 0.85 && ratio <= 1.15) verdict = "✅±15%"
    else if (ratio >= 0.5 && ratio <= 2.0) verdict = "⚠️ 1.5x"
    else verdict = `❌ ${ratio.toFixed(1)}x`
  }
  console.log(String(c.no).padStart(2), "|", (c.name || "").padEnd(40).slice(0, 40), "|", String(c.dbCount ?? "-").padStart(5), "|", String(ep ?? "-").padStart(5), "|", diff.padStart(7), "|", verdict)
})
