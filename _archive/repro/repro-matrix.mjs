const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 120_000

function mkForm(overrides = {}) {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "unanswered" },
    diameterInfo: { status: "unanswered" },
    country: { status: "unanswered" },
    ...overrides,
  }
}
const MILL = { toolTypeOrCurrentProduct: { status: "known", value: "Milling" } }
const D10 = { diameterInfo: { status: "known", value: "10mm" } }
const MAT_P = { material: { status: "known", value: "P" } }
const MAT_M = { material: { status: "known", value: "M" } }
const MAT_N = { material: { status: "known", value: "N" } }

// 5 scenarios: baselines that passed (I2 equivalent) + 3 failing patterns
const cases = [
  { id: "I2-baseline", form: mkForm({ ...MILL, ...D10 }),          text: "엔드밀 추천" }, // no material, passed fast
  { id: "I1-repro",    form: mkForm({ ...MILL, ...MAT_P, ...D10 }), text: "엔드밀 추천" }, // FAIL expected
  { id: "I4-repro",    form: mkForm({ ...MILL, ...MAT_M, ...D10 }), text: "엔드밀" },     // FAIL expected
  { id: "B2-repro",    form: mkForm({ ...MILL, ...MAT_N, ...D10 }), text: "엔드밀" },     // FAIL expected
  { id: "B1-baseline", form: mkForm({ ...MILL, ...MAT_N, ...D10 }), text: "알루미늄 10mm 엔드밀" }, // same filters as B2 but with material word → should PASS
]

for (const c of cases) {
  const body = { engine: "serve", intakeForm: c.form, messages: [{ role: "user", text: c.text }], sessionState: null, displayedProducts: null, language: "ko" }
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await res.json().catch(() => ({}))
    const el = Date.now() - t0
    const cc = j?.session?.engineState?.candidateCount
    const rs = j?.session?.engineState?.resolutionStatus
    const txt = (j.text || "").slice(0, 60).replace(/\n/g, " ")
    console.log(`[OK ] ${c.id.padEnd(14)} ${String(el).padStart(6)}ms  cc=${cc ?? "?"} status=${rs ?? "?"}  text="${txt}..."`)
  } catch (e) {
    clearTimeout(timer)
    const el = Date.now() - t0
    console.log(`[ERR] ${c.id.padEnd(14)} ${String(el).padStart(6)}ms  ${e.name}: ${e.message}`)
  }
}
