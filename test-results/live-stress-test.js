/**
 * SQL Agent 실서버 스트레스 테스트
 * - 10개 시나리오를 동시 병렬 실행 (각각 독립 세션)
 * - 3라운드 반복 (총 30 요청)
 * - 응답시간, 성공률, p50/p95/max 측정
 */
const http = require("http")
const BASE = "http://20.119.98.136:3000"

function post(body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL("/api/recommend", BASE)
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs,
    }
    const start = Date.now()
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        const elapsed = Date.now() - start
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString())
          resolve({ ok: true, status: res.statusCode, elapsed, body: json })
        } catch {
          resolve({ ok: false, status: res.statusCode, elapsed, error: "parse error" })
        }
      })
    })
    req.on("error", (e) => resolve({ ok: false, elapsed: Date.now() - start, error: e.message }))
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, elapsed: Date.now() - start, error: "timeout" }) })
    req.write(data)
    req.end()
  })
}

function makeReq(text) {
  return { engine: "serve", messages: [{ role: "user", text }], sessionState: null, intakeForm: {} }
}

function getFilters(res) {
  const state = res.body?.sessionState
  if (state?.appliedFilters?.length > 0) {
    return state.appliedFilters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`).join(" | ")
  }
  return null
}

const SCENARIOS = [
  { id: 1,  msg: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘", expect: "멀티 필터" },
  { id: 2,  msg: "TANK-POWER 빼고",                              expect: "brand neq" },
  { id: 3,  msg: "TiAlN 빼고 나머지요",                           expect: "coating neq" },
  { id: 4,  msg: "싱크 타입 플레인",                               expect: "shank_type" },
  { id: 5,  msg: "상관없음",                                      expect: "skip" },
  { id: 6,  msg: "처음부터 다시",                                  expect: "reset" },
  { id: 7,  msg: "TiAlN이 뭐야?",                                expect: "answer" },
  { id: 8,  msg: "스테인리스 8mm Ball",                            expect: "3 필터" },
  { id: 9,  msg: "CRX-S 추천해줘",                                expect: "brand like" },
  { id: 10, msg: "4날 말고 다른거",                                expect: "fluteCount neq" },
]

const ROUNDS = 3
const CONCURRENCY = 10 // 동시 요청 수

async function runRound(roundNum) {
  console.log(`\n── Round ${roundNum} (${CONCURRENCY}개 동시) ──`)
  const promises = SCENARIOS.map(s => post(makeReq(s.msg)).then(r => ({ ...s, ...r })))
  const results = await Promise.all(promises)

  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL"
    const filters = r.ok ? getFilters(r) : null
    const detail = filters || r.error || "no filters"
    console.log(`  [${status}] #${r.id} ${r.msg.slice(0, 25).padEnd(25)} ${String(r.elapsed).padStart(6)}ms  ${detail}`)
  }
  return results
}

async function main() {
  console.log("=".repeat(80))
  console.log("SQL Agent 스트레스 테스트")
  console.log(`서버: ${BASE}`)
  console.log(`시나리오: ${SCENARIOS.length}개 × ${ROUNDS}라운드 = ${SCENARIOS.length * ROUNDS}요청`)
  console.log(`동시성: ${CONCURRENCY}개 병렬`)
  console.log(`시간: ${new Date().toLocaleString("ko-KR")}`)
  console.log("=".repeat(80))

  const allResults = []

  for (let r = 1; r <= ROUNDS; r++) {
    const results = await runRound(r)
    allResults.push(...results)
    // 라운드 사이 1초 간격
    if (r < ROUNDS) await new Promise(ok => setTimeout(ok, 1000))
  }

  // ── 통계 ──
  const oks = allResults.filter(r => r.ok)
  const fails = allResults.filter(r => !r.ok)
  const times = oks.map(r => r.elapsed).sort((a, b) => a - b)

  const p50 = times[Math.floor(times.length * 0.5)] || 0
  const p95 = times[Math.floor(times.length * 0.95)] || 0
  const max = times[times.length - 1] || 0
  const min = times[0] || 0
  const avg = Math.round(times.reduce((s, t) => s + t, 0) / (times.length || 1))

  console.log("\n" + "=".repeat(80))
  console.log("최종 리포트")
  console.log("=".repeat(80))
  console.log(`총 요청: ${allResults.length}`)
  console.log(`성공:    ${oks.length} (${Math.round(oks.length / allResults.length * 100)}%)`)
  console.log(`실패:    ${fails.length}`)
  console.log("")
  console.log(`응답시간:`)
  console.log(`  min:  ${min}ms`)
  console.log(`  avg:  ${avg}ms`)
  console.log(`  p50:  ${p50}ms`)
  console.log(`  p95:  ${p95}ms`)
  console.log(`  max:  ${max}ms`)

  if (fails.length > 0) {
    console.log("\n실패 상세:")
    for (const f of fails) {
      console.log(`  #${f.id} Round${Math.ceil(allResults.indexOf(f) / SCENARIOS.length + 0.1)}: ${f.error} (${f.elapsed}ms)`)
    }
  }

  // 시나리오별 통계
  console.log("\n시나리오별 평균:")
  for (const s of SCENARIOS) {
    const scenarioResults = oks.filter(r => r.id === s.id)
    const avgT = scenarioResults.length > 0
      ? Math.round(scenarioResults.reduce((sum, r) => sum + r.elapsed, 0) / scenarioResults.length)
      : "N/A"
    const successRate = `${scenarioResults.length}/${ROUNDS}`
    console.log(`  #${String(s.id).padStart(2)} ${s.msg.slice(0, 30).padEnd(30)} ${successRate}  avg=${avgT}ms`)
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
