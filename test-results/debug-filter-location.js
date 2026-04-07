const http = require("http")
const BASE = "http://20.119.98.136:3000"

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL("/api/recommend", BASE)
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
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch { resolve(null) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

function findFilters(obj, path = "") {
  if (!obj || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0]?.field && obj[0]?.op) {
      console.log(`  ${path}: ${JSON.stringify(obj.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`))}`)
    }
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "appliedFilters" || k === "filters" || k === "narrowingHistory") {
      if (Array.isArray(v) && v.length > 0) {
        if (k === "narrowingHistory") {
          const withFilters = v.filter(h => h.filter || h.appliedFilter)
          if (withFilters.length > 0) {
            console.log(`  ${path}.${k}: ${withFilters.length} entries with filters`)
            for (const h of withFilters) {
              const f = h.filter || h.appliedFilter
              if (f) console.log(`    → ${f.field} ${f.op} ${f.rawValue ?? f.value} (reasoning: ${(h.reasoning||"").slice(0,60)})`)
            }
          }
        } else {
          console.log(`  ${path}.${k}: ${JSON.stringify(v.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`))}`)
        }
      }
    }
    if (typeof v === "object" && v !== null) findFilters(v, `${path}.${k}`)
  }
}

async function test(msg) {
  console.log(`\n"${msg}"`)
  const res = await post({ engine: "serve", messages: [{ role: "user", text: msg }], sessionState: null, intakeForm: {} })
  if (!res) { console.log("  null response"); return }
  findFilters(res, "res")
  // Also check candidates
  const cands = res.candidates?.length ?? res.candidateCount ?? "none"
  console.log(`  candidates: ${cands}`)
  console.log(`  text: ${(res.text || res.question?.text || res.answer || "").slice(0, 120)}`)
}

async function main() {
  await test("피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘")
  await test("스테인리스 8mm Ball")
  await test("CRX-S 추천해줘")
  await test("싱크 타입 플레인")
}

main().catch(e => console.error(e))
