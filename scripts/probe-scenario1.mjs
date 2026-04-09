// 시나리오 1 재현 — 초기 셋팅: 엔드밀/스텐/6mm
const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const form = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "M" }, // 스테인리스
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "known", value: "6mm" },
  country: { status: "unanswered" },
}

const turns = [
  "4날짜리로 골라줘",
  "코팅은 TiAlN으로",
  "아 소재 잘못 골랐다 인코넬로 바꿔줘",
  "직경도 8mm로",
  "처음 조건 다 잊고 스테인리스 6mm로 돌아가",
]

async function call(messages, prev) {
  const body = { engine: "serve", intakeForm: form, messages, sessionState: prev, displayedProducts: null, language: "ko" }
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

let messages = []
let prev = null
for (let i = 0; i < turns.length; i++) {
  messages = [...messages, { role: "user", text: turns[i] }]
  console.log(`\n===== TURN ${i + 1}: ${turns[i]} =====`)
  try {
    const r = await call(messages, prev)
    const eng = r?.session?.engineState || null
    prev = eng
    if (r.text) messages = [...messages, { role: "ai", text: r.text }]
    console.log("text:", (r.text || "").slice(0, 200))
    console.log("purpose:", r.purpose, "| candCount:", eng?.candidateCount, "| status:", eng?.resolutionStatus, "| asked:", eng?.lastAskedField)
    console.log("appliedFilters:", JSON.stringify(eng?.appliedFilters || [], null, 2))
    console.log("candidates(top3):", (r.candidates || []).slice(0, 3).map(c => c.code || c.productCode))
  } catch (e) {
    console.log("ERR:", e.message)
    break
  }
}
