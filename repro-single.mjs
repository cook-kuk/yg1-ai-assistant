const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const body = {
  engine: "serve",
  intakeForm: {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "known", value: "P" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    country: { status: "unanswered" },
  },
  messages: [{ role: "user", text: "엔드밀 추천" }],
  sessionState: null,
  displayedProducts: null,
  language: "ko",
}
const fireAt = new Date()
console.log(`[fire] ${fireAt.toISOString()}`)
const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), 90_000)
try {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
  clearTimeout(timer)
  const j = await res.json().catch(() => ({}))
  console.log(`[ok] ${Date.now() - t0}ms`, j?.session?.engineState?.resolutionStatus, j?.session?.engineState?.candidateCount)
} catch (e) {
  clearTimeout(timer)
  console.log(`[err] ${Date.now() - t0}ms ${e.name}: ${e.message}`)
}
