// Inspect the broken golden multiturn cases via real API
const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 300_000

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
    const json = await r.json().catch(() => null)
    return { status: r.status, json }
  } catch (e) {
    clearTimeout(t)
    return { status: 0, error: String(e?.message || e) }
  }
}

async function trace(label, turns) {
  console.log(`\n===== ${label} =====`)
  let messages = []
  let session = null
  for (let i = 0; i < turns.length; i++) {
    messages = [...messages, { role: "user", text: turns[i] }]
    const res = await call(messages, session)
    const sess = res.json?.session?.engineState ?? res.json?.session?.publicState ?? null
    const cand = sess?.candidateCount ?? "?"
    const filters = sess?.appliedFilters ?? []
    const action = sess?.lastAction ?? "?"
    const mode = sess?.currentMode ?? "?"
    console.log(`T${i+1} [${res.status}] cand=${cand} mode=${mode} action=${action}`)
    console.log(`     filters: ${JSON.stringify(filters.map(f => `${f.field}${f.op === "neq" ? "!=" : "="}${f.value}`))}`)
    console.log(`     input: "${turns[i]}"`)
    if (res.status !== 200) break
    if (res.json?.text) messages = [...messages, { role: "ai", text: res.json.text }]
    session = res.json?.session ?? null
  }
}

await trace("MFM04 (CRX-S 빼고)", ["인코넬 헬리컬 10mm", "CRX-S 빼고", "재고 많은 순으로"])
await trace("MFM08 (한 단계 뒤로)", ["알루미늄 4날", "아니 한 단계 뒤로", "스테인리스로 다시"])
await trace("MFM10 (국내 제품)", ["주철 페이스밀링", "16mm", "5날 이상", "국내 제품"])
