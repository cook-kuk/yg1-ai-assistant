/**
 * SQL Agent 실서버 테스트 - 상세 응답 확인용
 */
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
      timeout: 30000,
    }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch { resolve({ raw: Buffer.concat(chunks).toString().slice(0, 2000) }) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

async function main() {
  // Test 1: 단일 메시지로 응답 구조 확인
  console.log("=== Test: 응답 구조 확인 ===")
  const res1 = await post("/api/recommend", {
    engine: "serve",
    messages: [{ role: "user", text: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘" }],
    sessionState: null,
    intakeForm: {},
  })
  console.log("Top-level keys:", Object.keys(res1))
  console.log("sessionState keys:", res1.sessionState ? Object.keys(res1.sessionState) : "null")
  if (res1.sessionState?.appliedFilters) {
    console.log("appliedFilters:", JSON.stringify(res1.sessionState.appliedFilters, null, 2))
  }
  if (res1.sessionState?.narrowingHistory) {
    const last = res1.sessionState.narrowingHistory[res1.sessionState.narrowingHistory.length - 1]
    console.log("last narrowingHistory entry:", JSON.stringify(last, null, 2).slice(0, 500))
  }
  // Check session.publicState and session.engineState
  if (res1.session) {
    console.log("session keys:", Object.keys(res1.session))
    if (res1.session.publicState) console.log("publicState keys:", Object.keys(res1.session.publicState))
    if (res1.session.engineState) console.log("engineState keys:", Object.keys(res1.session.engineState))
  }

  // Dump relevant part of full response
  const dump = JSON.stringify(res1, null, 2)
  // Find appliedFilters anywhere in the response
  if (dump.includes("appliedFilter")) {
    const idx = dump.indexOf("appliedFilter")
    console.log("\nappliedFilter context:", dump.slice(Math.max(0, idx - 50), idx + 500))
  }

  // Check for trace/reasoning
  if (dump.includes("sql-agent") || dump.includes("kg:")) {
    console.log("\nFound routing info in response")
  }

  // Print response text
  const text = res1.question?.text || res1.response?.text || res1.answer || ""
  console.log("\n응답 텍스트:", text.slice(0, 200))
  console.log("\n후보 수:", res1.candidateCount ?? res1.candidates?.length ?? "없음")

  // Print first few candidates if exist
  if (res1.candidates?.length > 0) {
    console.log("첫 후보:", JSON.stringify(res1.candidates[0], null, 2).slice(0, 300))
  }

  // === Test 10: 4날 말고 다른거 (neq 확인) ===
  console.log("\n\n=== Test: 4날 말고 다른거 ===")
  const res10 = await post("/api/recommend", {
    engine: "serve",
    messages: [{ role: "user", text: "4날 말고 다른거" }],
    sessionState: null,
    intakeForm: {},
  })
  if (res10.sessionState?.appliedFilters) {
    console.log("appliedFilters:", JSON.stringify(res10.sessionState.appliedFilters, null, 2))
  }
  if (res10.session?.publicState?.appliedFilters) {
    console.log("publicState appliedFilters:", JSON.stringify(res10.session.publicState.appliedFilters, null, 2))
  }
  console.log("응답:", (res10.question?.text || res10.response?.text || res10.answer || "").slice(0, 200))

  // narrowingHistory에서 reasoning 확인
  const state10 = res10.sessionState || res10.session?.engineState
  if (state10?.narrowingHistory) {
    for (const h of state10.narrowingHistory) {
      if (h.reasoning) console.log("reasoning:", h.reasoning)
    }
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
