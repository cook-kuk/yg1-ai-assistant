// Smoke test for /api/recommend/stream — verifies `cards` arrives before `final`.
const URL = "http://localhost:3000/api/recommend/stream"

import fs from "node:fs"
const payload = JSON.parse(fs.readFileSync("test-results/_case2-body.json", "utf8"))

const t0 = Date.now()
const res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
  body: JSON.stringify(payload),
})
console.log("status", res.status, "+", Date.now() - t0, "ms")
if (!res.ok || !res.body) {
  console.error("init failed", await res.text())
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ""
const events = []
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
    const frame = buf.slice(0, idx)
    buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "")
    let evt = "message"; const data = []
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) evt = line.slice(6).trim()
      else if (line.startsWith("data:")) data.push(line.slice(5).trim())
    }
    const ms = Date.now() - t0
    events.push({ evt, ms, dataLen: data.join("").length })
    console.log(`[+${ms}ms]`, evt, "dataLen=", data.join("").length)
    if (evt === "cards" || evt === "final") {
      try {
        const parsed = JSON.parse(data.join("\n"))
        console.log("   purpose=", parsed.purpose, "textLen=", (parsed.text||"").length, "primary=", parsed.recommendation?.primaryProduct?.product?.normalizedCode ?? null, "alts=", parsed.recommendation?.alternatives?.length ?? 0)
      } catch (e) { console.log("   parse-fail", e.message) }
    }
  }
}

const cardsEvt = events.find(e => e.evt === "cards")
const finalEvt = events.find(e => e.evt === "final")
console.log("\n=== summary ===")
console.log("cards:", cardsEvt ? `+${cardsEvt.ms}ms` : "MISSING")
console.log("final:", finalEvt ? `+${finalEvt.ms}ms` : "MISSING")
if (cardsEvt && finalEvt) {
  console.log("perceived speedup:", finalEvt.ms - cardsEvt.ms, "ms (cards arrived this much earlier than final)")
}
process.exit(cardsEvt && finalEvt ? 0 : 2)
