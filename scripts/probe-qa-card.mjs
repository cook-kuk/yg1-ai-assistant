const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"

const scenarios = [
  "CE7659120 날장길이 얼마?",
  "CE7659120 절삭조건 알려줘",
  "CE7659120 코팅이 뭐야?",
  "CE7659120 재고 있어?",
  "스테인리스 10mm 4날",
  "알루미늄 6mm",
]

async function call(input) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engine: "serve",
      intakeForm: {},
      messages: [{ role: "user", text: input }],
      sessionState: null,
      displayedProducts: null,
      language: "ko",
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

for (const q of scenarios) {
  console.log(`\n===== "${q}" =====`)
  try {
    const r = await call(q)
    const cands = r.candidates ?? null
    const purpose = r.purpose ?? r.session?.engineState?.purpose ?? "?"
    const eng = r.session?.engineState || r.session?.publicState || null
    console.log(`purpose: ${purpose}`)
    console.log(`candidates: ${cands === null ? "null" : Array.isArray(cands) ? `array(${cands.length})` : typeof cands}`)
    console.log(`text(180): ${(r.text || "").slice(0, 180).replace(/\n/g, " ")}`)
    console.log(`filters: ${JSON.stringify(eng?.appliedFilters ?? [])}`)
  } catch (e) {
    console.log(`ERR: ${e.message}`)
  }
}
