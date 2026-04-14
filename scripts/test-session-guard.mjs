// Verifies session-consistency-guard short-circuits + heartbeat timer removal.
// Hits /api/recommend/stream (SSE) and reports thinking frames + latency.

const BASE = "http://localhost:3000"

const CASES = [
  {
    label: "no-filters + refine request (expect clarify_no_filters, no LLM)",
    text: "기존 조건 바꿔줘",
    expectBlocked: true,
  },
  {
    label: "missing selection context (expect clarify_missing_selection_context)",
    text: "1번으로 할게",
    expectBlocked: true,
  },
  {
    label: "missing compare targets (expect clarify_missing_compare_targets)",
    text: "둘 중 뭐가 더 나아?",
    expectBlocked: true,
  },
  {
    label: "domain recommendation (should pass through, stages are real)",
    text: "알루미늄 2mm 황삭 측면가공 추천",
    expectBlocked: false,
  },
]

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

async function runCase(c) {
  const t0 = Date.now()
  const intakeForm = {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unknown" },
    operationType: { status: "unknown" },
    machiningIntent: { status: "unknown" },
    toolTypeOrCurrentProduct: { status: "unknown" },
    diameterInfo: { status: "unknown" },
    country: { status: "known", value: "ALL" },
  }
  const body = {
    messages: [{ role: "user", text: c.text }],
    intakeForm,
    language: "ko",
  }
  const res = await fetch(`${BASE}/api/recommend/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    console.log(`  HTTP ${res.status}`)
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const buf = { raw: "" }
  const thinkingEvents = []
  let finalText = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const frames = parseSSE(dec.decode(value, { stream: true }), buf)
    for (const f of frames) {
      if (f.event === "thinking") {
        try {
          const p = JSON.parse(f.data)
          thinkingEvents.push({ t: Date.now() - t0, kind: p.kind, delta: !!p.delta, text: (p.text || "").slice(0, 60) })
        } catch { /* ignore */ }
      } else if (f.event === "final" || f.event === "response.final") {
        try {
          const p = JSON.parse(f.data)
          finalText = (p.text || "").slice(0, 200)
        } catch { /* ignore */ }
      }
    }
  }
  const total = Date.now() - t0
  console.log(`\n=== ${c.label} ===`)
  console.log(`total: ${total}ms · thinking frames: ${thinkingEvents.length}`)
  thinkingEvents.filter(e => !e.delta && e.kind === "stage").slice(0, 6).forEach(e => console.log(`  [t=${e.t}ms] ${e.text}`))
  console.log(`  finalText: ${finalText || "(empty)"}`)
}

for (const c of CASES) {
  try { await runCase(c) } catch (e) { console.log(`  ERROR: ${e?.message}`) }
}
