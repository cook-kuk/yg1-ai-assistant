// Focused repro: STRESS-7T 5 times against given API_URL
const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 300_000

const turns = [
  "위 조건에 맞는 YG-1 제품을 추천해 주세요.",
  "Square",
  "4날",
  "상관없음",
  "1번이랑 2번 비교",
  "Ball로 바꿔줘",
  "절삭조건 알려줘",
]

const form = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "탄소강" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "known", value: "10mm" },
  country: { status: "unanswered" },
}

async function call(messages, prevSession) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intakeForm: form, messages, session: prevSession, language: "ko" }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, json, text: text.slice(0, 400) }
  } catch (e) {
    clearTimeout(t)
    return { status: 0, error: String(e) }
  }
}

for (let run = 1; run <= 5; run++) {
  console.log(`\n===== RUN ${run} =====`)
  let messages = []
  let session = null
  for (let i = 0; i < turns.length; i++) {
    messages = [...messages, { role: "user", text: turns[i] }]
    const res = await call(messages, session)
    const ok = res.status === 200 && res.json
    const sess = res.json?.session ?? null
    const cand = sess?.candidateCount ?? "?"
    const purpose = res.json?.purpose ?? "?"
    console.log(`T${i+1} [${res.status}] purpose=${purpose} cand=${cand} "${turns[i]}"${ok ? "" : "  ⚠ " + (res.error || res.text)}`)
    if (!ok) break
    if (res.json?.text) messages = [...messages, { role: "ai", text: res.json.text }]
    session = sess
  }
}
