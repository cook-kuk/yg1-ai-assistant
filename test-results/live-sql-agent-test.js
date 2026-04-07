/**
 * SQL Agent Primary Handler 실서버 테스트
 * 서버: http://20.119.98.136:3000
 *
 * 테스트 시나리오 10개:
 * 1. 멀티 필터: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘"
 * 2. 브랜드 제외: "TANK-POWER 빼고"
 * 3. 코팅 제외: "TiAlN 빼고 나머지요"
 * 4. rawSqlField: "싱크 타입 플레인"
 * 5. skip: "상관없음"
 * 6. reset: "처음부터 다시"
 * 7. 사이드 질문: "TiAlN이 뭐야?"
 * 8. 3개 동시: "스테인리스 8mm Ball"
 * 9. 브랜드 like: "CRX-S 추천해줘"
 * 10. neq: "4날 말고 다른거"
 */

const http = require("http")

const BASE = "http://20.119.98.136:3000"

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const url = new URL(path, BASE)
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 30000,
    }
    const req = http.request(opts, (res) => {
      let chunks = []
      res.on("data", (c) => chunks.push(c))
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch { resolve({ raw: Buffer.concat(chunks).toString().slice(0, 500) }) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data)
    req.end()
  })
}

// 대화 상태 유지용
let sessionState = null
let messages = []
let displayedProducts = null

async function send(text) {
  messages.push({ role: "user", text })
  const body = {
    engine: "serve",
    messages,
    sessionState,
    displayedProducts,
    intakeForm: {},
  }
  const res = await post("/api/recommend", body)

  // 세션 상태 업데이트
  if (res.sessionState) sessionState = res.sessionState
  if (res.session?.engineState) sessionState = res.session.engineState
  if (res.displayedProducts) displayedProducts = res.displayedProducts
  if (res.candidates) displayedProducts = res.candidates

  // AI 응답을 messages에 추가
  const aiText = res.response?.text || res.question?.text || res.answer || ""
  if (aiText) messages.push({ role: "ai", text: aiText })

  return res
}

function resetSession() {
  sessionState = null
  messages = []
  displayedProducts = null
}

// ── 결과 분석 ──
function analyzeResult(res) {
  const info = {
    question: res.question?.text?.slice(0, 80) || null,
    answer: res.answer?.slice(0, 80) || res.response?.text?.slice(0, 80) || null,
    filters: [],
    candidates: res.candidateCount ?? res.candidates?.length ?? null,
    status: res.status || res.resolutionStatus || null,
    reasoning: null,
  }

  // 필터 추출
  const state = res.sessionState || res.session?.engineState
  if (state?.appliedFilters) {
    info.filters = state.appliedFilters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`)
  }
  if (state?.narrowingHistory) {
    const last = state.narrowingHistory[state.narrowingHistory.length - 1]
    if (last?.reasoning) info.reasoning = last.reasoning.slice(0, 100)
  }

  // trace에서 reasoning 추출
  if (res.trace) {
    const sqlAgent = res.trace.find(t => t.name === "sql-agent")
    const kg = res.trace.find(t => t.name === "knowledge-graph")
    if (sqlAgent) info.reasoning = `[sql-agent] filters=${sqlAgent.data?.filterCount}`
    if (kg && kg.data?.confidence >= 0.9) info.reasoning = `[kg] conf=${kg.data?.confidence} src=${kg.data?.source}`
  }

  return info
}

// ── 테스트 실행 ──
const tests = [
  {
    id: 1,
    name: "멀티 필터 (구리 SQUARE 2날 10mm)",
    msg: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘",
    expect: "CRX-S 1위, 여러 필터 적용",
    fresh: true,
  },
  {
    id: 2,
    name: "브랜드 제외 (TANK-POWER 빼고)",
    msg: "TANK-POWER 빼고",
    expect: "brand neq (코팅 아님!)",
    fresh: false,
  },
  {
    id: 3,
    name: "코팅 제외 (TiAlN 빼고)",
    msg: "TiAlN 빼고 나머지요",
    expect: "coating neq TiAlN",
    fresh: true,
  },
  {
    id: 4,
    name: "rawSqlField (싱크 타입 플레인)",
    msg: "싱크 타입 플레인",
    expect: "shank_type like plain",
    fresh: true,
  },
  {
    id: 5,
    name: "skip (상관없음)",
    msg: "상관없음",
    expect: "skip action",
    fresh: false,
  },
  {
    id: 6,
    name: "reset (처음부터 다시)",
    msg: "처음부터 다시",
    expect: "reset_session",
    fresh: false,
  },
  {
    id: 7,
    name: "사이드 질문 (TiAlN이 뭐야?)",
    msg: "TiAlN이 뭐야?",
    expect: "빈배열 → 설명만",
    fresh: true,
  },
  {
    id: 8,
    name: "3개 동시 (스테인리스 8mm Ball)",
    msg: "스테인리스 8mm Ball",
    expect: "3개 필터 동시",
    fresh: true,
  },
  {
    id: 9,
    name: "브랜드 like (CRX-S 추천해줘)",
    msg: "CRX-S 추천해줘",
    expect: "brand like CRX",
    fresh: true,
  },
  {
    id: 10,
    name: "neq (4날 말고 다른거)",
    msg: "4날 말고 다른거",
    expect: "fluteCount neq 4",
    fresh: true,
  },
]

async function runTests() {
  console.log("=" .repeat(70))
  console.log("SQL Agent Primary Handler 실서버 테스트")
  console.log(`서버: ${BASE}`)
  console.log(`시간: ${new Date().toLocaleString("ko-KR")}`)
  console.log("=".repeat(70))

  const results = []

  for (const t of tests) {
    if (t.fresh) resetSession()

    console.log(`\n── Test ${t.id}: ${t.name} ──`)
    console.log(`입력: "${t.msg}"`)
    console.log(`기대: ${t.expect}`)

    try {
      const start = Date.now()
      const res = await send(t.msg)
      const elapsed = Date.now() - start
      const info = analyzeResult(res)

      console.log(`시간: ${elapsed}ms`)
      console.log(`필터: ${info.filters.length > 0 ? info.filters.join(" | ") : "(없음)"}`)
      console.log(`후보: ${info.candidates ?? "N/A"}`)
      console.log(`라우팅: ${info.reasoning ?? "N/A"}`)
      if (info.question) console.log(`질문: ${info.question}`)
      if (info.answer) console.log(`응답: ${info.answer}`)
      console.log(`상태: ${info.status ?? "N/A"}`)

      results.push({ ...t, elapsed, info, pass: true })
    } catch (e) {
      console.log(`❌ ERROR: ${e.message}`)
      results.push({ ...t, elapsed: 0, info: null, pass: false, error: e.message })
    }
  }

  // ── 리포트 ──
  console.log("\n" + "=".repeat(70))
  console.log("결과 리포트")
  console.log("=".repeat(70))
  console.log(`통과: ${results.filter(r => r.pass).length}/${results.length}`)
  console.log(`평균 응답시간: ${Math.round(results.filter(r => r.pass).reduce((s, r) => s + r.elapsed, 0) / results.filter(r => r.pass).length)}ms`)
  console.log("")

  for (const r of results) {
    const status = r.pass ? "OK" : "FAIL"
    const filters = r.info?.filters?.join(", ") || r.error || "N/A"
    console.log(`[${status}] #${r.id} ${r.name} (${r.elapsed}ms) → ${filters}`)
  }
}

runTests().catch(e => { console.error("Fatal:", e); process.exit(1) })
