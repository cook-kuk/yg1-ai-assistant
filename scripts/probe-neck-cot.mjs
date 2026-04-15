#!/usr/bin/env node
/** "넥경 4mm" → 모든 SSE 이벤트 덤프 (CoT, filters, reasoning 관찰용). */
const BASE = "http://localhost:3000"
const msg = "넥경 4mm"

const payload = {
  intakeForm: {
    inquiryPurpose: { status: "unanswered" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "unanswered" },
    diameterInfo: { status: "unanswered" },
    country: { status: "known", value: "ALL" },
  },
  messages: [{ role: "user", text: msg }],
  session: null,
  displayedProducts: [],
  pagination: { page: 0, pageSize: 20 },
  language: "ko",
}

const res = await fetch(`${BASE}/api/recommend/stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
  body: JSON.stringify(payload),
})
console.log(`HTTP ${res.status}`)
if (!res.ok) { console.log(await res.text()); process.exit(1) }

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ""
const events = []
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let idx
  while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
    const frame = buf.slice(0, idx)
    buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "")
    let event = "message"
    const dl = []
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) dl.push(line.slice(5).trim())
    }
    if (dl.length === 0) continue
    let d; try { d = JSON.parse(dl.join("\n")) } catch { d = dl.join("\n") }
    events.push({ event, data: d })
  }
}

const types = {}
for (const e of events) types[e.event] = (types[e.event] ?? 0) + 1
console.log(`\n총 ${events.length}건 — 타입:`, types)

// 1) thinking (CoT)
console.log(`\n════════ THINKING / CoT ════════`)
for (const e of events.filter(x => x.event === "thinking")) {
  const s = typeof e.data === "string" ? e.data : (e.data?.text ?? e.data?.content ?? JSON.stringify(e.data))
  console.log(`[thinking] ${s.slice(0, 800)}`)
}

// 2) final (filters 확인)
const finals = events.filter(e => e.event === "final" || e.event === "cards")
for (const e of finals) {
  console.log(`\n════════ ${e.event.toUpperCase()} ════════`)
  const d = e.data ?? {}
  console.log(`filters:`, JSON.stringify(d.filters ?? d.recommendation?.filters ?? [], null, 2))
  const rec = d.recommendation ?? {}
  console.log(`mode: ${rec.mode ?? d.mode ?? "?"}`)
  console.log(`message: ${(rec.message ?? d.message ?? "").slice(0, 300)}`)
  console.log(`candidates: ${(d.candidates ?? rec.candidates ?? []).length}`)
  if (d.debug) console.log(`debug keys:`, Object.keys(d.debug))
  if (d.trace) console.log(`trace: ${JSON.stringify(d.trace).slice(0, 500)}`)
}
