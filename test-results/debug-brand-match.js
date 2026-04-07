const http = require("http")
const BASE = "http://20.119.98.136:3000"

// First, let's check what the server thinks about CRX-S
// Send a simple request and check if brand filter gets applied
async function main() {
  // Test 1: "CRX-S" alone (no 추천해줘)
  console.log("=== Test: CRX-S alone ===")
  let res = await post({ engine: "serve", messages: [{ role: "user", text: "CRX-S" }], sessionState: null, intakeForm: {} })
  printFilters(res)

  // Test 2: "CRX-S 추천해줘"
  console.log("\n=== Test: CRX-S 추천해줘 ===")
  res = await post({ engine: "serve", messages: [{ role: "user", text: "CRX-S 추천해줘" }], sessionState: null, intakeForm: {} })
  printFilters(res)

  // Test 3: "ALU-CUT 추천해줘"
  console.log("\n=== Test: ALU-CUT 추천해줘 ===")
  res = await post({ engine: "serve", messages: [{ role: "user", text: "ALU-CUT 추천해줘" }], sessionState: null, intakeForm: {} })
  printFilters(res)

  // Test 4: "TANK-POWER" alone
  console.log("\n=== Test: TANK-POWER ===")
  res = await post({ engine: "serve", messages: [{ role: "user", text: "TANK-POWER" }], sessionState: null, intakeForm: {} })
  printFilters(res)
}

function printFilters(res) {
  if (!res) { console.log("  null response"); return }
  const filters = res.sessionState?.appliedFilters || []
  console.log("  filters:", filters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`).join(", ") || "(없음)")
  console.log("  candidates:", res.candidateCount ?? res.candidates?.length ?? "?")
  // Check narrowingHistory reasoning
  const state = res.sessionState
  if (state?.narrowingHistory?.length > 0) {
    const last = state.narrowingHistory[state.narrowingHistory.length - 1]
    if (last.reasoning) console.log("  routing:", last.reasoning.slice(0, 80))
  }
}

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL("/api/recommend", BASE)
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 60000 }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { resolve(null) } })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data); req.end()
  })
}

main().catch(e => console.error(e))
