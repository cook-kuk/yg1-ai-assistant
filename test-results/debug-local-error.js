// 로컬 서버(localhost:3000)에서 에러 재현
const http = require("http")

function post(base, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL("/api/recommend", base)
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 120000,
    }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString()
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, raw: raw.slice(0, 2000) }) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

async function test(base, msg) {
  console.log(`\n"${msg}"`)
  try {
    const start = Date.now()
    const res = await post(base, { engine: "serve", messages: [{ role: "user", text: msg }], sessionState: null, intakeForm: {} })
    const elapsed = Date.now() - start
    console.log(`  ${elapsed}ms, status=${res.status}`)
    if (res.body) {
      const text = res.body.text || res.body.question?.text || ""
      const isError = text.includes("오류") || text.includes("error")
      console.log(`  error: ${isError}`)
      console.log(`  text: ${text.slice(0, 150)}`)
      // filters
      const filters = res.body.sessionState?.appliedFilters || res.body.session?.publicState?.appliedFilters || []
      if (filters.length > 0) console.log(`  filters: ${filters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`).join(", ")}`)
      if (res.body.error) console.log(`  error detail: ${JSON.stringify(res.body.error).slice(0, 500)}`)
      if (res.body.detail) console.log(`  detail: ${JSON.stringify(res.body.detail).slice(0, 500)}`)
    } else {
      console.log(`  raw: ${res.raw}`)
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`)
  }
}

async function main() {
  const base = process.argv[2] || "http://20.119.98.136:3000"
  console.log(`Server: ${base}`)

  // 에러 나는 2개
  await test(base, "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘")
  await test(base, "스테인리스 8mm Ball")
}

main().catch(e => console.error(e))
