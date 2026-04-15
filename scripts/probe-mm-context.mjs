// 시나리오 2/3/4: 숫자+mm 단독 입력 시 가공 맥락 기반 직경 추정 검증
const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const scenarios = [
  { name: "시나리오2: 스테인리스 10mm 4날 (맥락 있음 → diameterMm=10 + fluteCount=4 즉시)", input: "스테인리스 10mm 4날" },
  { name: "시나리오3: 4mm (맥락 없음 → 칩으로 확인 정상)", input: "4mm" },
  { name: "시나리오4: 넥경 4mm (neckDiameter cue → diameter 아님)", input: "넥경 4mm" },
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
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

for (const s of scenarios) {
  console.log(`\n===== ${s.name} =====`)
  console.log(`input: "${s.input}"`)
  try {
    const r = await call(s.input)
    const eng = r?.session?.engineState || r?.session?.publicState || null
    const filters = eng?.appliedFilters || []
    const chips = eng?.displayedChips || r?.chips || []
    console.log("appliedFilters:", JSON.stringify(filters))
    console.log("chips:", chips.slice(0, 8).join(" | "))
    console.log("text(180):", (r.text || "").slice(0, 180).replace(/\n/g, " "))
    console.log("candCount:", eng?.candidateCount, "| status:", eng?.resolutionStatus, "| asked:", eng?.lastAskedField)
  } catch (e) {
    console.log("ERR:", e.message)
  }
}
