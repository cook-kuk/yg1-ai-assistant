// 서버 반영 검증 — 4 시나리오
const API = "http://localhost:3000/api/recommend"

const baseForm = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "P" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
}

async function probe(label, userText) {
  const body = {
    engine: "serve",
    intakeForm: baseForm,
    messages: [{ role: "user", text: userText }],
    sessionState: null,
    displayedProducts: null,
    language: "ko",
  }
  const t0 = Date.now()
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const ms = Date.now() - t0
  if (!res.ok) return { label, err: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
  const j = await res.json()
  const eng = j?.session?.engineState
  return {
    label,
    userText,
    ms,
    purpose: j.purpose,
    candCount: eng?.candidateCount,
    status: eng?.resolutionStatus,
    asked: eng?.lastAskedField,
    appliedFilters: eng?.appliedFilters ?? [],
    smartChips: j.smartChips ?? j.chips ?? null,
    textSnippet: (j.text ?? "").slice(0, 240),
  }
}

const cases = [
  { label: "S1 넥경 4mm", q: "넥경 4mm" },
  { label: "S2 4mm only", q: "4mm" },
  { label: "S3 전장 100mm 이상", q: "전장 100mm 이상" },
  { label: "S4 직경 10mm", q: "직경 10mm" },
]

for (const c of cases) {
  const r = await probe(c.label, c.q)
  console.log(`\n===== ${r.label} | "${r.userText}" | ${r.ms}ms =====`)
  if (r.err) { console.log("ERR:", r.err); continue }
  console.log("purpose:", r.purpose, "| candCount:", r.candCount, "| asked:", r.asked, "| status:", r.status)
  console.log("appliedFilters:", JSON.stringify(r.appliedFilters, null, 2))
  if (r.smartChips) console.log("smartChips:", JSON.stringify(r.smartChips, null, 2))
  console.log("text:", r.textSnippet)
}
