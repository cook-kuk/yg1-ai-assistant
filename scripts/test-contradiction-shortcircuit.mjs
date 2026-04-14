#!/usr/bin/env node
/**
 * Smoke test for the session-contradiction short-circuit.
 *
 * Hits /api/recommend/stream with 3 contradiction patterns against an empty
 * session (no applied filters, no displayed candidates). Each should return
 * a clarification message without running the LLM tool-use pipeline.
 */

const HOST = process.env.API_HOST || "20.119.98.136:3000"
const BASE = HOST.startsWith("http") ? HOST : `http://${HOST}`

const cases = [
  { label: "modify",  text: "기존 조건 수정해줘" },
  { label: "compare", text: "비교해줘" },
  { label: "undo",    text: "삭제해줘" },
]

async function runCase({ label, text }) {
  const t0 = Date.now()
  const payload = {
    language: "ko",
    messages: [{ role: "user", text }],
    intakeForm: {
      material: null, operation: null, productType: null,
      diameterMm: null, fluteCount: null, pitchMm: null,
    },
    sessionState: {
      appliedFilters: [],
      candidateCount: 0,
      resolutionStatus: "pending",
      displayedOptions: [],
    },
  }

  const res = await fetch(`${BASE}/api/recommend/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
    body: JSON.stringify(payload),
  })

  if (!res.ok || !res.body) {
    console.log(`❌ [${label}] HTTP ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const stages = []
  const agentLines = []
  let finalText = ""
  let finalType = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "")
      let event = "message"
      const dataLines = []
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      let parsed
      try { parsed = JSON.parse(dataLines.join("\n")) } catch { continue }
      if (event === "thinking") {
        if (parsed?.kind === "stage") stages.push(parsed.text)
        else if (parsed?.kind === "agent") agentLines.push(parsed.text.trim())
      } else if (event === "final") {
        finalText = parsed?.text ?? ""
        finalType = parsed?.purpose ?? parsed?.responseType ?? null
      }
    }
  }
  const ms = Date.now() - t0
  const shortCircuit = stages.some(s => s.includes("단축회로") || s.includes("shortCircuit")) ||
                       agentLines.some(a => a.includes("단축회로"))
  const mark = shortCircuit ? "✅" : "❌"
  console.log(`${mark} [${label}] ${ms}ms | stages=${stages.length} agent=${agentLines.length} | shortCircuit=${shortCircuit}`)
  console.log(`   final(${finalType}): ${finalText.slice(0, 120)}`)
  if (agentLines.length) console.log(`   agent: ${agentLines[0].slice(0, 120)}`)
  if (stages.length) console.log(`   stages: ${stages.slice(0, 3).join(" → ")}`)
}

;(async () => {
  console.log(`target: ${BASE}`)
  for (const c of cases) {
    try { await runCase(c) }
    catch (err) { console.log(`❌ [${c.label}] ${err.message}`) }
  }
})()
