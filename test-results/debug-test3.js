const http = require("http")
const BASE = "http://20.119.98.136:3000"

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(path, BASE)
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 60000,
    }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }) }
        catch { resolve({ status: res.statusCode, raw: Buffer.concat(chunks).toString().slice(0, 1000) }) }
      })
    })
    req.on("error", (e) => reject(e))
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout 60s")) })
    req.write(data)
    req.end()
  })
}

async function main() {
  console.log("=== Test 3 재시도: TiAlN 빼고 나머지요 ===")
  const start = Date.now()
  try {
    const res = await post("/api/recommend", {
      engine: "serve",
      messages: [{ role: "user", text: "TiAlN 빼고 나머지요" }],
      sessionState: null,
      intakeForm: {},
    })
    const elapsed = Date.now() - start
    console.log(`Status: ${res.status}, Time: ${elapsed}ms`)
    if (res.body) {
      const state = res.body.sessionState
      if (state?.appliedFilters) {
        console.log("Filters:", JSON.stringify(state.appliedFilters, null, 2))
      }
      console.log("Text:", (res.body.text || res.body.question?.text || "").slice(0, 200))
      console.log("Candidates:", res.body.candidateCount ?? res.body.candidates?.length ?? "N/A")
      // Check narrowingHistory for reasoning
      if (state?.narrowingHistory) {
        for (const h of state.narrowingHistory) {
          if (h.reasoning) console.log("Reasoning:", h.reasoning)
        }
      }
    } else {
      console.log("Raw:", res.raw)
    }
  } catch (e) {
    const elapsed = Date.now() - start
    console.log(`ERROR after ${elapsed}ms: ${e.message}`)
  }
}

main()
