// 멀티턴 골든세트 빡센 러너 — extra-hard.multiTurn 12 cases
// Usage: API_URL=... node scripts/golden-multiturn-runner.mjs [--parallel N]
import fs from "node:fs"
import path from "node:path"

const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 300_000
const PARALLEL = parseInt(process.argv.find(a => a.startsWith("--parallel="))?.split("=")[1] ?? "3", 10)

const dataset = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "testset", "golden-set-extra-hard.json"), "utf8"),
)
const cases = dataset.multiTurn

const baseForm = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "unanswered" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
}

async function call(messages, prevSession) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intakeForm: baseForm, messages, session: prevSession, language: "ko" }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, snippet: text.slice(0, 200) }
  } catch (e) {
    clearTimeout(t)
    return { status: 0, error: String(e?.message || e) }
  }
}

function evaluate(turnRes, turnIdx) {
  const issues = []
  if (turnRes.status !== 200) {
    issues.push(`HTTP ${turnRes.status} ${turnRes.error || turnRes.snippet}`)
    return issues
  }
  const j = turnRes.json
  if (!j) { issues.push("empty json"); return issues }
  const text = j.text || ""
  if (!text || text.length < 5) issues.push("text too short")
  if (text.includes("오류가 발생") || text.includes("처리 중 오류")) issues.push("error message in response")
  const sess = j.session?.engineState ?? j.session?.publicState ?? null
  const cand = sess?.candidateCount ?? null
  const mode = sess?.currentMode ?? "?"
  if (mode === "narrowing" && cand === 0) issues.push("narrowing with 0 cand")
  return { issues, cand, mode, purposeOk: !!j.purpose }
}

async function runCase(c) {
  const log = []
  let messages = []
  let session = null
  let pass = true
  const allIssues = []
  for (let i = 0; i < c.turns.length; i++) {
    messages = [...messages, { role: "user", text: c.turns[i] }]
    const res = await call(messages, session)
    const ev = evaluate(res, i)
    const issues = Array.isArray(ev) ? ev : ev.issues
    log.push(`  T${i+1} status=${res.status} mode=${ev.mode || "?"} cand=${ev.cand ?? "?"} ${issues.length ? "❌ " + issues.join("; ") : "✓"} "${c.turns[i]}"`)
    if (issues.length > 0) {
      pass = false
      allIssues.push(`T${i+1}: ${issues.join("; ")}`)
    }
    if (res.status !== 200) break
    if (res.json?.text) messages = [...messages, { role: "ai", text: res.json.text }]
    session = res.json?.session ?? null
  }
  return { id: c.id, name: c.name, pass, issues: allIssues, log }
}

async function main() {
  console.log(`▶ ${cases.length} multi-turn golden cases against ${API_URL} (parallel=${PARALLEL})`)
  const results = []
  let idx = 0
  async function worker() {
    while (idx < cases.length) {
      const i = idx++
      const r = await runCase(cases[i])
      console.log(`\n[${r.pass ? "PASS" : "FAIL"}] ${r.id}: ${r.name}`)
      r.log.forEach(l => console.log(l))
      if (!r.pass) console.log(`  🔴 ${r.issues.join(" | ")}`)
      results[i] = r
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  const pass = results.filter(r => r.pass).length
  console.log(`\n${"=".repeat(60)}\nGolden Multiturn: ${pass}/${cases.length} passed (${(pass*100/cases.length).toFixed(1)}%)\n${"=".repeat(60)}`)
  const fails = results.filter(r => !r.pass)
  if (fails.length > 0) {
    console.log(`\n🔴 Failed cases:`)
    fails.forEach(r => console.log(`  ${r.id} ${r.name}\n    ${r.issues.join("\n    ")}`))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
