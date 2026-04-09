// Reproduce duplicate gte/lte filter bug
const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 60_000

const baseForm = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "unanswered" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
}

async function call(messages, prevSession) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intakeForm: baseForm, messages, session: prevSession, language: "ko" }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    return await r.json()
  } catch (e) {
    clearTimeout(t)
    return { error: String(e?.message || e) }
  }
}

async function trace(label, turns) {
  console.log(`\n===== ${label} =====`)
  let messages = []
  let session = null
  for (let i = 0; i < turns.length; i++) {
    messages = [...messages, { role: "user", text: turns[i] }]
    const r = await call(messages, session)
    const sess = r.session?.engineState ?? null
    const fs = sess?.appliedFilters ?? []
    console.log(`T${i+1} cand=${sess?.candidateCount ?? "?"} filters=${fs.length}`)
    fs.forEach(f => console.log(`     ${f.field} ${f.op || "eq"} ${JSON.stringify(f.value)} (raw=${JSON.stringify(f.rawValue)})`))
    console.log(`     input: "${turns[i]}"`)
    if (r.text) messages = [...messages, { role: "ai", text: r.text }]
    session = r.session ?? null
  }
}

await trace("한 발화에 gte+lte (range 의도)", ["직경 10mm 이상 20mm 이하"])
await trace("이상이상 (말 더듬)", ["직경 10mm 이상이상"])
await trace("LOC + OAL (다른 필드 같은 op)", ["LOC 30mm 이상 OAL 100mm 이상"])
await trace("같은 필드 gte+lte 동시", ["직경 5mm 이상 그리고 20mm 이하"])
await trace("이상 두 번 다른 필드", ["직경 10mm 이상 날수 4개 이상"])
await trace("재고 50 이상 두 번", ["재고 50개 이상", "재고 50개 이상"])
