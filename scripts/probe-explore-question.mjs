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
  const body = await res.text()
  let json = null
  try { json = JSON.parse(body) } catch { /* SSE */ }
  if (!json) {
    const lines = body.split("\n").filter(l => l.startsWith("data:"))
    const last = lines[lines.length - 1]
    if (last) { try { json = JSON.parse(last.slice(5)) } catch { /* no-op */ } }
  }
  const ms = Date.now() - t0
  console.log(`\n=== ${label} (${ms}ms) ===`)
  console.log(`input         : ${text}`)
  if (!json) { console.log("!! no JSON body, head=", body.slice(0, 200)); return }
  console.log(`purpose       : ${json.purpose}`)
  console.log(`intent        : ${json.intent ?? "(n/a)"}`)
  console.log(`candidates    : ${Array.isArray(json.candidates) ? `[${json.candidates.length}]` : json.candidates}`)
  console.log(`recommendation: ${json.recommendation ? "present" : "null"}`)
  console.log(`chips         : ${Array.isArray(json.chips) ? JSON.stringify(json.chips) : json.chips}`)
  console.log(`text          : ${(json.text || "").slice(0, 300)}`)
}

(async () => {
  await probe("탐색형: 브랜드", "브랜드 뭐가 있어?")
  await probe("정보조회: 날장 얼마", "날장 얼마?")
  await probe("정보조회: 제품코드+필드", "CE7659120 날장 얼마?")
})().catch(e => { console.error(e); process.exit(1) })
