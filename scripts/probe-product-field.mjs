// Probe: CE 제품코드 + 다양한 단일 필드 질의 → 카드 없이 단일 필드 텍스트만
const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const cases = [
  { name: "날장길이",   input: "CE7659120 날장길이 얼마?" },
  { name: "넥 직경",    input: "CE7659120 넥경 얼마야?" },
  { name: "테이퍼 각도", input: "CE7659120 테이퍼 각도 알려줘" },
  { name: "코너 R",     input: "CE7659120 코너R 얼마?" },
  { name: "형상 (sanity)", input: "CE7659120 형상 뭐야?" },
]

async function call(input) {
  const body = {
    engine: "serve",
    intakeForm: {},
    messages: [{ role: "user", text: input }],
    sessionState: null,
    displayedProducts: null,
    language: "ko",
  }
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

for (const c of cases) {
  console.log(`\n===== ${c.name} =====`)
  console.log(`input: "${c.input}"`)
  try {
    const r = await call(c.input)
    const cardCount = (r.candidateSnapshot?.length ?? 0) + (r.recommendation ? 1 : 0)
    console.log("purpose:", r.purpose, "| cards:", cardCount)
    console.log("text:", (r.text || "").slice(0, 300).replace(/\n/g, " | "))
  } catch (e) {
    console.log("ERR:", e.message)
  }
}
