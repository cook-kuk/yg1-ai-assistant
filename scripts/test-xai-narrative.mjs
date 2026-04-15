// Verify xaiNarrative generation for 3 scenarios
const BASE = "http://localhost:3000"

const baseIntake = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "unknown" },
  operationType: { status: "unknown" },
  machiningIntent: { status: "unknown" },
  toolTypeOrCurrentProduct: { status: "unknown" },
  diameterInfo: { status: "unknown" },
  country: { status: "known", value: "ALL" },
}

const scenarios = [
  {
    name: "S1 스테인리스 10mm 4날",
    messages: [{ role: "user", text: "스테인리스 10mm 4날 추천해줘" }],
  },
  {
    name: "S2 DLC로 (0건 도메인 근거)",
    messages: [{ role: "user", text: "스테인리스 10mm 4날 DLC 코팅으로 추천해줘" }],
  },
  {
    name: "S3 재고 300개 이상",
    messages: [{ role: "user", text: "스테인리스 10mm 4날 재고 300개 이상만" }],
  },
]

async function run(s) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: s.messages,
      intakeForm: baseIntake,
      language: "ko",
    }),
  })
  const json = await res.json()
  const dt = Date.now() - t0

  const cands = json.candidateSnapshot ?? []
  const top1 = cands[0]
  const xai = top1?.xaiNarrative ?? null

  console.log(`\n========================================`)
  console.log(`${s.name}  (${dt}ms, HTTP ${res.status})`)
  console.log(`========================================`)
  console.log(`purpose: ${json.purpose}`)
  console.log(`candidates: ${cands.length}`)
  console.log(`status: ${json.recommendation?.status}`)
  console.log(`\n--- text (head 400) ---`)
  console.log((json.text ?? "").slice(0, 400))
  console.log(`\n--- xaiNarrative on top-1 ---`)
  if (top1) {
    console.log(`top1.displayCode: ${top1.displayCode}`)
    console.log(`top1.rank: ${top1.rank}`)
    console.log(`xaiNarrative: ${xai ? `"${xai}"` : "(null)"}`)
  } else {
    console.log(`(no top-1 — 0건 or error)`)
    const warnings = json.recommendation?.warnings ?? []
    console.log(`warnings: ${JSON.stringify(warnings)}`)
  }
  console.log(`\n--- appliedFilters ---`)
  console.log(JSON.stringify(json.sessionState?.appliedFilters ?? [], null, 2).slice(0, 500))

  return { scenario: s.name, ms: dt, candidates: cands.length, hasXai: !!xai, xai, top1Code: top1?.displayCode, text: json.text }
}

const results = []
for (const s of scenarios) {
  try {
    const r = await run(s)
    results.push(r)
  } catch (err) {
    console.error(`[${s.name}] ERROR:`, err.message)
    results.push({ scenario: s.name, error: err.message })
  }
}

console.log(`\n\n========================================`)
console.log(`SUMMARY`)
console.log(`========================================`)
for (const r of results) {
  if (r.error) {
    console.log(`❌ ${r.scenario}: ${r.error}`)
    continue
  }
  const xaiFlag = r.hasXai ? "✅" : "❌"
  const candFlag = r.candidates > 0 ? `${r.candidates}건` : "0건"
  console.log(`${xaiFlag} ${r.scenario} — ${candFlag}, top1=${r.top1Code ?? "—"}, xai=${r.hasXai ? "YES" : "NO"}, ${r.ms}ms`)
}
