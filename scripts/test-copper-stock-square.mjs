// Reproduce: "피삭재는 구리고 재고 10개 이상인 제품만 추천해줘 날은 Square 타입이야"
const BASE = "http://localhost:3000"

const body = {
  messages: [{ role: "user", text: "피삭재는 구리고 재고 10개 이상인 제품만 추천해줘 날은 Square 타입이야" }],
  intakeForm: {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unknown" },
    operationType: { status: "unknown" },
    machiningIntent: { status: "unknown" },
    toolTypeOrCurrentProduct: { status: "unknown" },
    diameterInfo: { status: "unknown" },
    country: { status: "known", value: "ALL" },
  },
  language: "ko",
}

function parseSSE(chunk, buf) {
  buf.raw += chunk
  const out = []
  let idx
  while ((idx = buf.raw.indexOf("\n\n")) !== -1) {
    const frame = buf.raw.slice(0, idx)
    buf.raw = buf.raw.slice(idx + 2)
    const lines = frame.split("\n")
    let event = "message"
    let data = ""
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim()
      else if (line.startsWith("data:")) data += line.slice(5).trim()
    }
    out.push({ event, data })
  }
  return out
}

const t0 = Date.now()
const res = await fetch(`${BASE}/api/recommend/stream`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify(body),
})
const reader = res.body.getReader()
const dec = new TextDecoder()
const buf = { raw: "" }
const thinkingEvents = []
let finalJson = null
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  const frames = parseSSE(dec.decode(value, { stream: true }), buf)
  for (const f of frames) {
    if (f.event === "thinking") {
      try {
        const p = JSON.parse(f.data)
        thinkingEvents.push({ t: Date.now() - t0, kind: p.kind, delta: !!p.delta, text: p.text })
      } catch { /* ignore */ }
    } else if (f.event === "final") {
      try { finalJson = JSON.parse(f.data) } catch { /* ignore */ }
    }
  }
}

console.log(`total=${Date.now() - t0}ms thinking=${thinkingEvents.length}`)
console.log("\n=== STAGE events ===")
for (const e of thinkingEvents.filter(x => !x.delta && x.kind === "stage")) {
  console.log(`  [t=${e.t}ms] ${e.text}`)
}
console.log("\n=== DEEP frames (full SQL agent reasoning) ===")
let deepText = ""
for (const e of thinkingEvents.filter(x => x.kind === "deep")) {
  deepText += e.delta ? e.text : `\n[BLOCK]\n${e.text}\n[/BLOCK]\n`
}
console.log(deepText.slice(0, 3000))

console.log("\n=== appliedFilters ===")
console.log(JSON.stringify(finalJson?.sessionState?.appliedFilters ?? [], null, 2))
console.log("\n=== text (head) ===")
console.log((finalJson?.text ?? "").slice(0, 500))
console.log("\n=== candidateSnapshot.length ===", (finalJson?.candidateSnapshot ?? []).length)

console.log("\n=== purpose ===", finalJson?.purpose)
console.log("\n=== isComplete ===", finalJson?.isComplete)
console.log("\n=== session.publicState.appliedFilters ===", JSON.stringify(finalJson?.session?.publicState?.appliedFilters ?? [], null, 2))
console.log("\n=== session.engineState.appliedFilters ===", JSON.stringify(finalJson?.session?.engineState?.appliedFilters ?? [], null, 2))
console.log("\n=== session.engineState.lastAction ===", finalJson?.session?.engineState?.lastAction)
console.log("\n=== session.engineState.currentMode ===", finalJson?.session?.engineState?.currentMode)
console.log("\n=== session.engineState.narrowingHistory ===", JSON.stringify(finalJson?.session?.engineState?.narrowingHistory ?? [], null, 2).slice(0, 500))
console.log("\n=== session.publicState.lastAction ===", finalJson?.session?.publicState?.lastAction)
console.log("\n=== meta ===", JSON.stringify(finalJson?.meta ?? {}, null, 2).slice(0, 600))
