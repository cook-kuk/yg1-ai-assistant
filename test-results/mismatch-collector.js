/**
 * Production vs Shadow Planner 불일치 수집기
 * 실서버에 요청 → sessionState(production filters) + meta.debugTrace(shadow planner) 비교
 */
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

const CASES = [
  // materialGroup vs workpiece
  { id: 1,  msg: "P소재로 해줘", axis: "materialGroup vs workpiece" },
  { id: 2,  msg: "M소재 스테인리스", axis: "materialGroup vs workpiece" },
  { id: 3,  msg: "구리", axis: "materialGroup vs workpiece" },
  { id: 4,  msg: "알루미늄 고속가공", axis: "materialGroup vs workpiece" },
  // brand vs seriesName
  { id: 5,  msg: "CRX-S 추천해줘", axis: "brand vs seriesName" },
  { id: 6,  msg: "ALU-CUT", axis: "brand vs seriesName" },
  { id: 7,  msg: "GAA29 시리즈", axis: "brand vs seriesName" },
  // toolSubtype vs shankType
  { id: 8,  msg: "싱크 타입 플레인", axis: "subtype vs shankType" },
  { id: 9,  msg: "스퀘어 타입", axis: "subtype vs shankType" },
  { id: 10, msg: "볼 타입 엔드밀", axis: "subtype vs shankType" },
  // neq / exclusion
  { id: 11, msg: "TiAlN 빼고", axis: "neq" },
  { id: 12, msg: "4날 말고 다른거", axis: "neq" },
  { id: 13, msg: "TANK-POWER 제외", axis: "neq" },
  // bridge edge cases
  { id: 14, msg: "직경 8에서 12 사이", axis: "bridge:between" },
  { id: 15, msg: "10mm 이상", axis: "bridge:gte" },
]

async function run() {
  console.log("입력 | production 필터 | shadow planner | 불일치 | 축")
  console.log("---|---|---|---|---")

  for (const c of CASES) {
    try {
      const res = await post({
        engine: "serve",
        messages: [{ role: "user", text: c.msg }],
        sessionState: null,
        intakeForm: {},
      })
      if (!res) { console.log(`${c.msg} | ERROR | - | - | ${c.axis}`); continue }

      // Production filters
      const prodFilters = res.sessionState?.appliedFilters
        || res.session?.publicState?.appliedFilters
        || []
      const prodStr = prodFilters.length > 0
        ? prodFilters.map(f => `${f.field} ${f.op} ${f.rawValue ?? f.value}`).join("; ")
        : "(없음)"

      // Shadow planner from trace
      const trace = res.meta?.debugTrace?.events || res._build?.trace?.events || []
      const plannerTrace = trace.find(t => t.step === "query-planner-shadow")
      let shadowStr = "(trace 없음)"
      if (plannerTrace?.outputSummary) {
        const s = plannerTrace.outputSummary
        shadowStr = `intent=${s.intent} nav=${s.navigation} constraints=${JSON.stringify(s.constraints)}`
      } else if (plannerTrace?.inputSummary) {
        shadowStr = JSON.stringify(plannerTrace.inputSummary)
      }

      // Also check meta for planner shadow data
      if (shadowStr === "(trace 없음)" && res.meta?.debugTrace) {
        const dt = res.meta.debugTrace
        const pe = dt.events?.find(e => e.step?.includes("planner") || e.step?.includes("query-planner"))
        if (pe) shadowStr = JSON.stringify(pe).slice(0, 200)
      }

      // Check narrowingHistory for routing info
      const state = res.sessionState || res.session?.engineState
      let routeInfo = ""
      if (state?.narrowingHistory?.length > 0) {
        const last = state.narrowingHistory[state.narrowingHistory.length - 1]
        if (last.reasoning) routeInfo = ` [${last.reasoning.slice(0, 50)}]`
      }

      const mismatch = shadowStr === "(trace 없음)" ? "?" : "비교필요"

      console.log(`"${c.msg}" | ${prodStr}${routeInfo} | ${shadowStr.slice(0, 100)} | ${mismatch} | ${c.axis}`)
    } catch (e) {
      console.log(`"${c.msg}" | ERROR: ${e.message} | - | - | ${c.axis}`)
    }
  }
}

run().catch(e => console.error(e))
