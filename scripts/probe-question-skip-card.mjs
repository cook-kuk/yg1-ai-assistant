const URL = "http://localhost:3000/api/recommend"

async function probe(label, text) {
  const payload = {
    messages: [{ role: "user", text }],
    form: { query: text, locale: "ko" },
    prevState: null,
    displayedProducts: null,
    pagination: null,
  }
  const t0 = Date.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
  const text_ = await res.text()
  let json = null
  try { json = JSON.parse(text_) } catch { /* SSE? */ }
  const latency = Date.now() - t0
  if (!json) {
    const lines = text_.split("\n").filter(l => l.startsWith("data:"))
    const last = lines[lines.length - 1]
    if (last) {
      try { json = JSON.parse(last.slice(5)) } catch { /* no-op */ }
    }
  }
  console.log(`\n=== ${label} (${latency}ms) ===`)
  console.log(`input : ${text}`)
  if (!json) { console.log("!! no JSON body parsed, head=", text_.slice(0, 200)); return }
  console.log(`purpose         = ${json.purpose}`)
  console.log(`candidates      = ${Array.isArray(json.candidates) ? `[${json.candidates.length}]` : json.candidates}`)
  console.log(`recommendation  = ${json.recommendation ? "present" : "null"}`)
  console.log(`isComplete      = ${json.isComplete}`)
  console.log(`text head       = ${(json.text || "").slice(0, 120)}`)
}

(async () => {
  await probe("Q1 question (제품코드+필드)", "CE7659120 날장길이 얼마?")
  await probe("Q2 recommendation (스펙)", "스테인리스 10mm 4날")
  await probe("Q3 recommendation (명시적)", "스테인리스 10mm 4날 엔드밀 추천해줘")
})().catch(e => { console.error(e); process.exit(1) })
