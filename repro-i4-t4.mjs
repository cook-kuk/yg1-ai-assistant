// Isolated repro: I4 scenario, focus on T4 "상관없음" (the 42s spike)
const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const form = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "M" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "known", value: "10mm" },
  country: { status: "unanswered" },
}

async function call(messages, prev) {
  const t0 = Date.now()
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "serve", intakeForm: form, messages, sessionState: prev, displayedProducts: null, language: "ko" }),
  })
  const j = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  const st = j?.session?.engineState || null
  return { ms, cc: st?.candidateCount || 0, status: st?.resolutionStatus || "?", text: (j?.text || "").slice(0, 120), state: st, lastAsked: st?.lastAskedField, filters: (st?.appliedFilters || []).map(f => `${f.field}=${f.value}${f.op && f.op !== "eq" ? "[" + f.op + "]" : ""}`).join("|") }
}

let msgs = []
let state = null
const turns = ["엔드밀", "Square", "4날", "상관없음"]
for (let i = 0; i < turns.length; i++) {
  msgs = [...msgs, { role: "user", text: turns[i] }]
  const markStart = new Date().toISOString()
  console.log(`\n=== T${i + 1} "${turns[i]}" START ${markStart}`)
  const r = await call(msgs, state)
  console.log(`    ${r.ms}ms cc=${r.cc} ${r.status} lastAsked=${r.lastAsked}`)
  console.log(`    filters=[${r.filters}]`)
  console.log(`    text="${r.text}"`)
  if (r.text) msgs = [...msgs, { role: "ai", text: r.text }]
  state = r.state
}
