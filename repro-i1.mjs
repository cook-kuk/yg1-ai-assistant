const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = Number(process.env.TIMEOUT_MS) || 90_000

const intakeForm = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "P" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "known", value: "10mm" },
  country: { status: "unanswered" },
}
const messages = [{ role: "user", text: "엔드밀 추천" }]
const body = { engine: "serve", intakeForm, messages, sessionState: null, displayedProducts: null, language: "ko" }

console.log("POST", API, "timeout=", TIMEOUT, "ms")
console.log("body:", JSON.stringify(body).slice(0, 300))
const t0 = Date.now()
const ctrl = new AbortController()
const timer = setTimeout(() => { console.log(`[client] aborting at ${Date.now() - t0}ms`); ctrl.abort() }, TIMEOUT)
try {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
  clearTimeout(timer)
  const elapsed = Date.now() - t0
  const text = await res.text()
  console.log(`[ok] HTTP ${res.status} in ${elapsed}ms, bytes=${text.length}`)
  try {
    const j = JSON.parse(text)
    console.log("candidates:", j.candidates?.length, "text:", (j.text || "").slice(0, 120))
    console.log("purpose:", j.purpose, "isComplete:", j.isComplete)
    console.log("candidateCount:", j.session?.engineState?.candidateCount)
    console.log("resolutionStatus:", j.session?.engineState?.resolutionStatus)
  } catch {
    console.log("raw:", text.slice(0, 400))
  }
} catch (e) {
  const elapsed = Date.now() - t0
  console.log(`[err] ${elapsed}ms: ${e.name}: ${e.message}`)
}
