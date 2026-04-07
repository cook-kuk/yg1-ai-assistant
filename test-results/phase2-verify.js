const http = require("http")
const BASE = "http://20.119.98.136:3000"

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL("/api/recommend", BASE)
    const opts = { hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 60000 }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", c => chunks.push(c))
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { resolve(null) } })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data); req.end()
  })
}

const CASES = [
  { msg: "직경 8에서 12 사이", expect: "between 8~12 (planner override)" },
  { msg: "10mm 이상", expect: "gte 10 (planner override)" },
  { msg: "4날 말고", expect: "fluteCount neq 4 (KG)" },
  { msg: "구리 10mm 이상 2날", expect: "multi-constraint — override 안 됨" },
  { msg: "싱크 타입 플레인", expect: "shankType=Plain (KG)" },
  { msg: "CRX-S 추천해줘", expect: "brand=CRX S (KG)" },
]

async function main() {
  for (const c of CASES) {
    console.log(`\n=== "${c.msg}" ===`)
    console.log(`기대: ${c.expect}`)
    const start = Date.now()
    const res = await post({ engine: "serve", messages: [{ role: "user", text: c.msg }], sessionState: null, intakeForm: {} })
    const elapsed = Date.now() - start
    if (!res) { console.log("  ERROR: null"); continue }
    const filters = res.sessionState?.appliedFilters || []
    console.log(`  시간: ${elapsed}ms`)
    console.log(`  필터: ${filters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}${f.rawValue2 ? `~${f.rawValue2}` : ""}`).join(", ") || "(없음)"}`)
    console.log(`  후보: ${res.candidateCount ?? res.candidates?.length ?? "?"}`)
  }
}

main().catch(e => console.error(e))
