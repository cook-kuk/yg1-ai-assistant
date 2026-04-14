// Verifies the heartbeat hotfix: off-topic / pure-guidance messages should NOT
// stream all 5 heartbeat stages anymore. We hit /api/recommend/stream (SSE),
// parse the frames, and report timing + which 'thinking' events appeared.

const BASE = "http://localhost:3000"

const CASES = [
  {
    label: "off-topic — 신입사원 (45 chars, uncertainty + domain typo)",
    text: "난 아무것도 모르는 에이로스페이스 회사 신입사원이야 나는 어떻게 뭐부터 해야하는지 몰라",
  },
  {
    label: "off-topic — 채용 반응 (17 chars, no domain signal)",
    text: "나보고 너네 회사 들어가라고?",
  },
  {
    label: "domain — 스테인리스 10mm 4날 (should keep heartbeat)",
    text: "스테인리스 10mm 4날 엔드밀 추천해줘",
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
  // Mimic the real UI: exploration mode with a fully-"unknown" intake form +
  // one prior assistant turn (structured intake message). This forces the
  // /stream route through handleServeExploration (the path that bugged out),
  // not the simple-chat fallback.
  const intakeForm = {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unknown" },
    operationType: { status: "unknown" },
    machiningIntent: { status: "unknown" },
    toolTypeOrCurrentProduct: { status: "unknown" },
    diameterInfo: { status: "unknown" },
    country: { status: "known", value: "ALL" },
  }
  const priorStructuredUserMsg =
    "🧭 문의 목적: 신규 제품 추천\n🧱 가공 소재: 모름\n🛠️ 가공 방식: 모름\n📐 가공 형상: 모름\n📏 공구 직경: 모름\n🌐 국가: 전체 국가 (ALL)\n\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
  const priorAssistantMsg =
    "제품을 추천해 드리기 위해 몇 가지 정보가 필요합니다:\n\n피삭재(소재) — 예: 탄소강, 합금강, 스테인리스강…\n공구 직경 — 예: 6mm, 10mm, 12mm\n가공 방식 — 예: 밀링/드릴링/탭핑/선삭"
  const body = {
    messages: [
      { role: "user", text: priorStructuredUserMsg },
      { role: "ai", text: priorAssistantMsg },
      { role: "user", text: c.text },
    ],
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
  let gotCards = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const frames = parseSSE(dec.decode(value, { stream: true }), buf)
    for (const f of frames) {
      if (f.event === "thinking") {
        try {
          const payload = JSON.parse(f.data)
          thinkingEvents.push({
            t: Date.now() - t0,
            kind: payload.kind,
            delta: !!payload.delta,
            text: payload.text?.slice(0, 60),
          })
        } catch { /* ignore */ }
      } else if (f.event === "cards") {
        gotCards = true
      } else if (f.event === "final" || f.event === "response.final") {
        try {
          const payload = JSON.parse(f.data)
          finalText = (payload.text || "").slice(0, 200)
        } catch { /* ignore */ }
      }
    }
  }
  const total = Date.now() - t0
  console.log(`\n=== ${c.label} ===`)
  console.log(`total: ${total}ms · thinking frames: ${thinkingEvents.length} · cards: ${gotCards} · finalText: ${finalText.length} chars`)
  // Show unique stage texts only (delta chunks collapse)
  const stageTexts = thinkingEvents
    .filter(e => e.kind === "stage" && !e.delta)
    .map(e => `[t=${e.t}ms] ${e.text}`)
  stageTexts.slice(0, 10).forEach(t => console.log("  " + t))
  const deepCount = thinkingEvents.filter(e => e.kind === "deep").length
  if (deepCount) console.log(`  (deep frames: ${deepCount})`)
  console.log(`  finalText preview: ${finalText || "(empty)"}`)
}

for (const c of CASES) {
  try { await runCase(c) } catch (e) { console.log(`  ERROR: ${e?.message}`) }
}
