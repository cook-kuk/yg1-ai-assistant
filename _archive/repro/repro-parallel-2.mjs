const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const makeForm = (overrides) => ({
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "unanswered" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "unanswered" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
  ...overrides,
})

const I4_FORM = makeForm({
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  material: { status: "known", value: "M" },
  diameterInfo: { status: "known", value: "10mm" },
})
const B2_FORM = makeForm({
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  material: { status: "known", value: "N" },
  diameterInfo: { status: "known", value: "10mm" },
})

async function callOnce(form, messages, prev) {
  const t0 = Date.now()
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "serve", intakeForm: form, messages, sessionState: prev, displayedProducts: null, language: "ko" }),
  })
  const j = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  const st = j?.session?.engineState || null
  return { ms, cc: st?.candidateCount || 0, status: st?.resolutionStatus || "?", text: (j?.text || "").slice(0, 80), state: st }
}

async function runScenario(id, form, userTurns) {
  const tAll = Date.now()
  const log = []
  let msgs = []
  let state = null
  for (let i = 0; i < userTurns.length; i++) {
    msgs = [...msgs, { role: "user", text: userTurns[i] }]
    const r = await callOnce(form, msgs, state)
    log.push(`  T${i + 1} "${userTurns[i]}" ${r.ms}ms cc=${r.cc} ${r.status}`)
    if (r.text) msgs = [...msgs, { role: "ai", text: r.text }]
    state = r.state
  }
  const total = Date.now() - tAll
  return { id, total, log }
}

console.log(`[fire-parallel] ${new Date().toISOString()}`)
const tStart = Date.now()
const [i4, b2] = await Promise.all([
  runScenario("I4", I4_FORM, ["엔드밀", "Square", "4날", "상관없음"]),
  runScenario("B2", B2_FORM, ["엔드밀", "CRX s 브랜드도 소개해주세요"]),
])
const wall = Date.now() - tStart

for (const r of [i4, b2]) {
  console.log(`[${r.id}] total ${r.total}ms`)
  r.log.forEach(l => console.log(l))
}
console.log(`[wall] ${wall}ms (parallel)`)
