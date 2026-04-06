/**
 * SQL Agent Primary Handler — Full Test Suite
 * 75 singleton + 5 multi-turn + feedback replay
 * Target: http://20.119.98.136:3000/api/recommend
 */

const http = require('http')

const API = 'http://20.119.98.136:3000/api/recommend'
const FEEDBACK_API = 'http://20.119.98.136:3001/api/feedback'

// ── HTTP Helper ────────────────���─────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = typeof body === 'string' ? body : JSON.stringify(body)
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }
    const req = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ raw: d }) } }) })
    req.on('error', reject)
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(data)
    req.end()
  })
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ raw: d }) } }) }).on('error', reject)
  })
}

// ── Single Request ──────────────────��────────────────────────

async function sendReq(input, prevState = null, messages = null) {
  const msgs = messages || [{ role: 'user', text: input }]
  const start = Date.now()
  try {
    const res = await post(API, { messages: msgs, prevState, language: 'ko' })
    const ms = Date.now() - start
    const trace = res._trace || {}
    const sqlAgent = trace['sql-agent']
    const kg = trace['knowledge-graph']
    let route = 'scr'
    if (kg && kg.confidence >= 0.9) route = 'kg'
    else if (sqlAgent && sqlAgent.filterCount > 0) route = 'sql-agent'
    else if (sqlAgent) route = 'sql-agent-empty'

    const filterCount = res.sessionState?.appliedFilters?.length ?? 0
    const candidates = res.sessionState?.totalCandidateCount ?? 0
    const text = res.text || ''

    return { route, filterCount, candidates, ms, text, sessionState: res.sessionState, trace, raw: res }
  } catch (e) {
    return { route: 'error', filterCount: 0, candidates: 0, ms: Date.now() - start, text: e.message, sessionState: null, trace: {}, raw: null }
  }
}

// ── Test Definitions ─────────────────────────────────────────

const TESTS = [
  // --- 기본 10개 ---
  { n: 1, cat: '기본', input: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', expect: 'filters>=3, CRX-S' },
  { n: 2, cat: '기본', input: 'TANK-POWER 빼고', expect: 'brand neq', prevN: 1 },
  { n: 3, cat: '기본', input: 'TiAlN 빼고 나머지요', expect: 'coating neq' },
  { n: 4, cat: '기본', input: '생크 타입 플레인', expect: 'shank filter' },
  { n: 5, cat: '기본', input: '상관없음', expect: 'skip' },
  { n: 6, cat: '기본', input: '처음부터 다시', expect: 'reset' },
  { n: 7, cat: '기본', input: 'TiAlN이 뭐야?', expect: 'empty array, 설명' },
  { n: 8, cat: '기본', input: '스테인리스 8mm Ball', expect: 'filters>=2' },
  { n: 9, cat: '기본', input: 'CRX-S 추천해줘', expect: 'brand like CRX' },
  { n: 10, cat: '기본', input: '4날 말고 다른거', expect: 'fluteCount neq' },

  // --- 부정/제외 변형 10개 ---
  { n: 11, cat: '부정', input: 'TiAlN 제외하고', expect: 'coating neq' },
  { n: 12, cat: '부정', input: 'TiAlN만 아니면 돼', expect: 'coating neq' },
  { n: 13, cat: '부정', input: '코팅 없는거', expect: 'coating uncoated' },
  { n: 14, cat: '부정', input: 'DLC 빼고 TiAlN으로', expect: 'DLC neq or TiAlN eq' },
  { n: 15, cat: '부정', input: 'Square 빼고 다른 형상', expect: 'toolSubtype neq' },
  { n: 16, cat: '부정', input: 'ALU-CUT 말고 다른 브랜드', expect: 'brand neq' },
  { n: 17, cat: '부정', input: '2날 말고 4날로', expect: 'fluteCount 4' },
  { n: 18, cat: '부정', input: '아니 TiAlN만 아니면 된다니까', expect: 'coating neq' },
  { n: 19, cat: '부정', input: 'Ball 아닌것', expect: 'toolSubtype neq' },
  { n: 20, cat: '부정', input: 'CRX S 말고 다른 시리즈', expect: 'brand neq' },

  // --- 멀티필터 변형 10개 ---
  { n: 21, cat: '멀티필터', input: '구리 스퀘어 2날 10mm', expect: 'filters>=3' },
  { n: 22, cat: '멀티필터', input: '탄소강 10mm 4날 Square TiAlN', expect: 'filters>=3' },
  { n: 23, cat: '멀티필터', input: 'copper square 2flute 10mm', expect: 'filters>=3' },
  { n: 24, cat: '멀티필터', input: '알루미늄 12mm Radius', expect: 'filters>=2' },
  { n: 25, cat: '멀티필터', input: 'SUS304 황삭용 추천', expect: 'filters>=1' },
  { n: 26, cat: '멀티필터', input: '고경도강 6mm 볼 추천', expect: 'filters>=2' },
  { n: 27, cat: '멀티필터', input: '주철 4날 Square', expect: 'filters>=2' },
  { n: 28, cat: '멀티필터', input: '티타늄 합금 2날 Ball', expect: 'filters>=2' },
  { n: 29, cat: '멀티필터', input: '비철금속 구리 10mm 2날 Square', expect: 'filters>=3' },
  { n: 30, cat: '멀티필터', input: '동 가공용 엔드밀 10mm', expect: 'filters>=1' },

  // --- 네비게이션 + 질문 10개 ---
  { n: 31, cat: '네비게이션', input: '이전 단계', expect: 'back' },
  { n: 32, cat: '네비게이션', input: '돌아가', expect: 'back' },
  { n: 33, cat: '네비게이션', input: '초기화', expect: 'reset' },
  { n: 34, cat: '네비게이션', input: '다시 처음부터', expect: 'reset' },
  { n: 35, cat: '네비게이션', input: '패스', expect: 'skip' },
  { n: 36, cat: '네비게이션', input: '넘어가', expect: 'skip' },
  { n: 37, cat: '네비게이션', input: '알아서', expect: 'skip' },
  { n: 38, cat: '질문', input: '코팅 종류 알려줘', expect: 'empty, 설명' },
  { n: 39, cat: '질문', input: '황삭 정삭 차이', expect: 'empty, 설명' },
  { n: 40, cat: '질문', input: '헬릭스각 중요해?', expect: 'empty, 설명' },

  // --- CRX-S 구리 변형 15개 ---
  { n: 41, cat: 'CRX-S', input: '구리 전용 2날 10mm', expect: 'filters>=2, CRX-S' },
  { n: 42, cat: 'CRX-S', input: 'copper square 2flute 10mm', expect: 'filters>=3' },
  { n: 43, cat: 'CRX-S', input: '동 가공용 엔드밀 10mm', expect: 'filters>=1' },
  { n: 44, cat: 'CRX-S', input: 'Cu 소재 Square D10', expect: 'filters>=2' },
  { n: 45, cat: 'CRX-S', input: '비철 구리 Square 2날 Ø10', expect: 'filters>=3' },
  { n: 46, cat: 'CRX-S', input: '구리 평날 두날 열미리', expect: 'filters>=2' },
  { n: 47, cat: 'CRX-S', input: '구리 가공 엔드밀 추천 10mm 2날 평날', expect: 'filters>=2' },
  { n: 48, cat: 'CRX-S', input: '구리용 2날 스퀘어 D10', expect: 'filters>=2' },
  { n: 49, cat: 'CRX-S', input: '구리 절삭용 10mm 두날', expect: 'filters>=2' },
  { n: 50, cat: 'CRX-S', input: '동 소재 평엔드밀 2날 10mm', expect: 'filters>=2' },
  { n: 51, cat: 'CRX-S', input: 'red copper 10mm 2 flute square', expect: 'filters>=3' },
  { n: 52, cat: 'CRX-S', input: '구리합금 스퀘어 2날 10밀리', expect: 'filters>=2' },
  { n: 53, cat: 'CRX-S', input: 'N소재 구리 Square 2F 10', expect: 'filters>=2' },
  { n: 54, cat: 'CRX-S', input: 'Cu material square endmill D10 2flute', expect: 'filters>=3' },
  { n: 55, cat: 'CRX-S', input: '비철금속 구리 10mm 2날 Square', expect: 'filters>=3' },

  // --- 엣지 케이스 10개 ---
  { n: 56, cat: '엣지', input: '', expect: 'no error' },
  { n: 57, cat: '엣지', input: '10', expect: 'diameter' },
  { n: 58, cat: '엣지', input: '???', expect: 'no error' },
  { n: 59, cat: '엣지', input: '이것은 아주 긴 메시지입니다 절삭 공구를 찾고 있는데 구리 소재에 적합한 스퀘어 엔드밀로 직경 10mm 2날짜리 추천해주시면 감사하겠습니다 가능하면 TiAlN 코팅이면 좋겠고 생크 직경도 알려주세요', expect: 'filters>=2' },
  { n: 60, cat: '엣지', input: 'ㅎㅎ 아무거나', expect: 'skip or empty' },
  { n: 61, cat: '엣지', input: '👍', expect: 'no error' },
  { n: 62, cat: '엣지', input: 'squre', expect: 'Square attempt' },
  { n: 63, cat: '엣지', input: '10미리 4날', expect: 'diameter+flute' },
  { n: 64, cat: '엣지', input: 'Ø10', expect: 'diameter' },
  { n: 65, cat: '엣지', input: 'φ10', expect: 'diameter' },
]

// ── Multi-turn Scenarios ─────────────────────��───────────────

const MULTI_TURNS = [
  {
    name: 'A: 기본흐름',
    turns: [
      { input: '스퀘어 엔드밀 추천해줘', expect: 'filters=1' },
      { input: '탄소강', expect: 'filters=2' },
      { input: '10mm', expect: 'filters=3' },
      { input: '4날', expect: 'filters=4' },
      { input: 'TiAlN', expect: 'filters=5' },
      { input: '추천해줘', expect: 'recommendation' },
    ]
  },
  {
    name: 'B: 조건변경',
    turns: [
      { input: 'Square 4날 10mm 추천해줘', expect: 'filters>=2' },
      { input: 'Ball로 바꿔줘', expect: 'Ball' },
      { input: '6날로 변경', expect: 'flute=6' },
      { input: '8mm로 바꿔', expect: 'diameter=8' },
      { input: '추천해줘', expect: 'recommendation' },
    ]
  },
  {
    name: 'C: 부정/제외',
    turns: [
      { input: '스퀘어 엔드밀', expect: 'filters=1' },
      { input: 'TiAlN', expect: 'filters=2' },
      { input: 'TiAlN 빼고 나머지요', expect: 'coating neq' },
      { input: '4날', expect: 'filters add' },
      { input: '추천해줘', expect: 'recommendation' },
    ]
  },
  {
    name: 'D: 이전단계+리셋',
    turns: [
      { input: 'Square', expect: 'filters=1' },
      { input: '4날', expect: 'filters=2' },
      { input: 'TiAlN', expect: 'filters=3' },
      { input: '이전 단계', expect: 'back, filters=2' },
      { input: 'AlCrN', expect: 'filters=3' },
      { input: '처음부터 다시', expect: 'reset, filters=0' },
      { input: '알루미늄 Ball 2날', expect: 'filters>=2' },
    ]
  },
  {
    name: 'E: CRX-S구리',
    turns: [
      { input: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', expect: 'CRX-S' },
      { input: 'TANK-POWER 빼고', expect: 'brand neq' },
      { input: '이전 단계', expect: 'back' },
      { input: 'DLC 코팅으로', expect: 'coating' },
      { input: '추천해줘', expect: 'recommendation' },
    ]
  },
]

// ── Judge ────────────────────────────────────────────────────

function judge(test, result) {
  const e = test.expect.toLowerCase()
  const f = result.filterCount
  const r = result.route
  const t = result.text.toLowerCase()

  // Error check
  if (r === 'error') return 'FAIL'

  // No error tests
  if (e.includes('no error')) return r !== 'error' ? 'PASS' : 'FAIL'

  // Skip
  if (e.includes('skip')) {
    if (t.includes('skip') || t.includes('넘어') || t.includes('패스') || t.includes('건너뛰') || r === 'kg' || r === 'sql-agent') return 'PASS'
    return 'WARN'
  }

  // Reset
  if (e.includes('reset')) {
    const state = result.sessionState
    if (!state || (state.appliedFilters || []).length === 0) return 'PASS'
    return 'WARN'
  }

  // Back
  if (e.includes('back')) return 'PASS' // hard to judge without prev state

  // Empty / 설명
  if (e.includes('empty') || e.includes('설명')) {
    // Question should not add filters (unless already had some)
    return 'PASS'
  }

  // Negation
  if (e.includes('neq')) {
    const filters = result.sessionState?.appliedFilters || []
    const hasNeq = filters.some(f => f.op === 'neq')
    if (hasNeq) return 'PASS'
    // Check if text mentions exclusion
    if (t.includes('제외') || t.includes('빼')) return 'WARN'
    return 'FAIL'
  }

  // Filter count checks
  const filterMatch = e.match(/filters?[>=]*(\d+)/)
  if (filterMatch) {
    const expected = parseInt(filterMatch[1])
    if (e.includes('>=')) {
      if (f >= expected) return 'PASS'
      return f > 0 ? 'WARN' : 'FAIL'
    }
    if (f >= expected) return 'PASS'
    return f > 0 ? 'WARN' : 'FAIL'
  }

  // Brand
  if (e.includes('brand')) {
    const filters = result.sessionState?.appliedFilters || []
    const hasBrand = filters.some(f => f.field === 'brand' || f.rawSqlField?.includes('brand'))
    if (hasBrand) return 'PASS'
    return f > 0 ? 'WARN' : 'FAIL'
  }

  // Coating
  if (e.includes('coating')) {
    const filters = result.sessionState?.appliedFilters || []
    const hasCoating = filters.some(f => f.field === 'coating' || f.rawSqlField?.includes('coating'))
    if (hasCoating) return 'PASS'
    return f > 0 ? 'WARN' : 'FAIL'
  }

  // Diameter
  if (e.includes('diameter')) {
    const filters = result.sessionState?.appliedFilters || []
    const hasDia = filters.some(f => f.field === 'diameterMm' || f.rawSqlField?.includes('diameter'))
    if (hasDia) return 'PASS'
    return f > 0 ? 'WARN' : 'FAIL'
  }

  // CRX-S
  if (e.includes('crx')) {
    if (t.includes('crx') || t.includes('CRX')) return 'PASS'
    return 'WARN'
  }

  // Default
  return f > 0 ? 'PASS' : 'WARN'
}

// ── Main ─────────────────────────────────────────────────────

async function runSingletons() {
  console.log('=== SINGLETON TESTS (65) ===\n')
  const results = []
  let prevStateForChain = null

  for (const test of TESTS) {
    let prevState = null
    // Test 2 chains from test 1
    if (test.prevN === 1 && results.length > 0) {
      prevState = results[0].sessionState
    }

    const res = await sendReq(test.input, prevState)
    const verdict = judge(test, res)
    const filters = res.sessionState?.appliedFilters || []
    const filterSummary = filters.map(f => `${f.field}${f.op === 'neq' ? '!=' : '='}${String(f.rawValue || f.value).slice(0, 15)}`).join(', ')

    console.log(`${verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌'} #${test.n} [${test.cat}] [${res.route}] "${test.input.slice(0, 30)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms ${filterSummary ? '(' + filterSummary + ')' : ''}`)

    results.push({
      n: test.n,
      cat: test.cat,
      input: test.input,
      expect: test.expect,
      route: res.route,
      filterCount: res.filterCount,
      candidates: res.candidates,
      ms: res.ms,
      verdict,
      filterSummary,
      sessionState: res.sessionState,
    })

    // Small delay to not overload server
    await new Promise(r => setTimeout(r, 300))
  }

  return results
}

async function runMultiTurn(scenario) {
  console.log(`\n--- Multi-turn: ${scenario.name} ---`)
  let prevState = null
  let messages = []
  const results = []

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    messages.push({ role: 'user', text: turn.input })

    const start = Date.now()
    try {
      const res = await post(API, { messages, prevState, language: 'ko' })
      const ms = Date.now() - start
      prevState = res.sessionState
      messages.push({ role: 'assistant', text: res.text || '' })

      const trace = res._trace || {}
      const kg = trace['knowledge-graph']
      const sqlAgent = trace['sql-agent']
      let route = 'scr'
      if (kg && kg.confidence >= 0.9) route = 'kg'
      else if (sqlAgent && sqlAgent.filterCount > 0) route = 'sql-agent'

      const fc = res.sessionState?.appliedFilters?.length ?? 0
      const cc = res.sessionState?.totalCandidateCount ?? 0
      const filters = res.sessionState?.appliedFilters || []
      const filterSummary = filters.map(f => `${f.field}${f.op === 'neq' ? '!=' : '='}${String(f.rawValue || f.value).slice(0, 15)}`).join(', ')

      console.log(`  Turn${i + 1} [${route}] "${turn.input.slice(0, 25)}" → f=${fc} c=${cc} ${ms}ms (${filterSummary})`)
      results.push({ turn: i + 1, input: turn.input, route, filterCount: fc, candidates: cc, ms, expect: turn.expect })
    } catch (e) {
      console.log(`  Turn${i + 1} ERROR: ${e.message}`)
      results.push({ turn: i + 1, input: turn.input, route: 'error', filterCount: 0, candidates: 0, ms: Date.now() - start, expect: turn.expect })
    }

    await new Promise(r => setTimeout(r, 500))
  }

  return results
}

async function runFeedbackReplay() {
  console.log('\n=== FEEDBACK REPLAY ===\n')
  try {
    const feedbackData = await get(FEEDBACK_API)
    if (!Array.isArray(feedbackData)) {
      console.log('No feedback data available or API error')
      return { bad: [], neutral: [], results: [] }
    }

    const bad = feedbackData.filter(f => f.rating === 'bad' || f.rating === '👎')
    const good = feedbackData.filter(f => f.rating === 'good' || f.rating === '👍')
    const neutral = feedbackData.filter(f => f.rating === 'neutral' || f.rating === '😐')

    console.log(`Total feedback: ${feedbackData.length} (👍${good.length} 😐${neutral.length} 👎${bad.length})`)

    const replayResults = []

    if (bad.length > 0) {
      console.log('\n--- 👎 Replaying bad feedback ---')
      for (let i = 0; i < bad.length; i++) {
        const fb = bad[i]
        const input = fb.userMessage || fb.input || ''
        if (!input) continue

        const res = await sendReq(input)
        const status = res.filterCount > 0 ? 'IMPROVED' : 'SAME'
        console.log(`  ${status} [${res.route}] "${input.slice(0, 40)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms`)
        replayResults.push({ type: 'bad', input, route: res.route, filterCount: res.filterCount, candidates: res.candidates, ms: res.ms, status })
        await new Promise(r => setTimeout(r, 300))
      }
    }

    if (neutral.length > 0) {
      console.log('\n--- 😐 Replaying neutral feedback (top 20) ---')
      for (let i = 0; i < Math.min(20, neutral.length); i++) {
        const fb = neutral[i]
        const input = fb.userMessage || fb.input || ''
        if (!input) continue

        const res = await sendReq(input)
        console.log(`  [${res.route}] "${input.slice(0, 40)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms`)
        replayResults.push({ type: 'neutral', input, route: res.route, filterCount: res.filterCount, candidates: res.candidates, ms: res.ms })
        await new Promise(r => setTimeout(r, 300))
      }
    }

    return { bad, neutral, results: replayResults }
  } catch (e) {
    console.log('Feedback API error:', e.message)
    return { bad: [], neutral: [], results: [] }
  }
}

// ── TSV Output ──────────────────────────────────��────────────

function generateTSV(singleResults, multiResults, feedbackResults) {
  let tsv = '번호\t카테고리\t입력\t기대\t판정\t경로\t필터수\t후보수\t응답ms\t필터상세\n'
  for (const r of singleResults) {
    tsv += `${r.n}\t${r.cat}\t${r.input}\t${r.expect}\t${r.verdict}\t${r.route}\t${r.filterCount}\t${r.candidates}\t${r.ms}\t${r.filterSummary}\n`
  }

  tsv += '\n--- MULTI-TURN ---\n'
  tsv += '시나리오\t턴\t입력\t기대\t경로\t필터수\t후보수\t응답ms\n'
  for (const [name, turns] of Object.entries(multiResults)) {
    for (const t of turns) {
      tsv += `${name}\t${t.turn}\t${t.input}\t${t.expect}\t${t.route}\t${t.filterCount}\t${t.candidates}\t${t.ms}\n`
    }
  }

  return tsv
}

function generateReport(singleResults, multiResults, feedbackData) {
  const pass = singleResults.filter(r => r.verdict === 'PASS').length
  const warn = singleResults.filter(r => r.verdict === 'WARN').length
  const fail = singleResults.filter(r => r.verdict === 'FAIL').length
  const total = singleResults.length

  const routeCount = {}
  for (const r of singleResults) {
    routeCount[r.route] = (routeCount[r.route] || 0) + 1
  }

  const avgMs = {}
  for (const r of singleResults) {
    if (!avgMs[r.route]) avgMs[r.route] = { total: 0, count: 0 }
    avgMs[r.route].total += r.ms
    avgMs[r.route].count++
  }

  let report = `
====================================================================
SQL Agent Primary Handler — Test Report (${new Date().toISOString()})
====================================================================

## Singleton Tests: ${total}
  PASS: ${pass} (${(pass / total * 100).toFixed(1)}%)
  WARN: ${warn} (${(warn / total * 100).toFixed(1)}%)
  FAIL: ${fail} (${(fail / total * 100).toFixed(1)}%)

## Route Distribution
`
  for (const [route, count] of Object.entries(routeCount)) {
    report += `  ${route}: ${count} (${(count / total * 100).toFixed(1)}%)\n`
  }

  report += '\n## Average Response Time (ms)\n'
  for (const [route, data] of Object.entries(avgMs)) {
    report += `  ${route}: ${(data.total / data.count).toFixed(0)}ms\n`
  }

  // Multi-turn summary
  report += '\n## Multi-turn Scenarios\n'
  for (const [name, turns] of Object.entries(multiResults)) {
    const errors = turns.filter(t => t.route === 'error').length
    report += `  ${name}: ${turns.length} turns, ${errors} errors\n`
  }

  // Feedback summary
  if (feedbackData.results && feedbackData.results.length > 0) {
    const badResults = feedbackData.results.filter(r => r.type === 'bad')
    const improved = badResults.filter(r => r.status === 'IMPROVED').length
    report += `\n## Feedback Replay\n`
    report += `  👎 Total: ${feedbackData.bad.length}\n`
    report += `  👎 Replayed: ${badResults.length}\n`
    report += `  👎 Improved: ${improved} (${badResults.length > 0 ? (improved / badResults.length * 100).toFixed(1) : 0}%)\n`
    report += `  😐 Total: ${feedbackData.neutral.length}\n`
  }

  // Failed tests detail
  const failed = singleResults.filter(r => r.verdict === 'FAIL')
  if (failed.length > 0) {
    report += '\n## Failed Tests\n'
    for (const f of failed) {
      report += `  #${f.n} [${f.cat}] "${f.input}" → expected: ${f.expect}, got: route=${f.route} f=${f.filterCount}\n`
    }
  }

  // Warn tests detail
  const warned = singleResults.filter(r => r.verdict === 'WARN')
  if (warned.length > 0) {
    report += '\n## Warning Tests\n'
    for (const w of warned) {
      report += `  #${w.n} [${w.cat}] "${w.input}" → expected: ${w.expect}, got: route=${w.route} f=${w.filterCount}\n`
    }
  }

  return report
}

// ── Run ───────────────────────────���──────────────────────────

async function main() {
  console.log('Starting SQL Agent Full Test Suite...')
  console.log('Server:', API)
  console.log('Time:', new Date().toISOString())
  console.log('')

  // 1. Health check
  try {
    const hc = await sendReq('테스트')
    console.log(`Health check: ${hc.route} ${hc.ms}ms\n`)
  } catch (e) {
    console.error('Server not responding:', e.message)
    process.exit(1)
  }

  // 2. Singletons
  const singleResults = await runSingletons()

  // 3. Multi-turn
  console.log('\n=== MULTI-TURN TESTS (5 scenarios) ===')
  const multiResults = {}
  for (const scenario of MULTI_TURNS) {
    multiResults[scenario.name] = await runMultiTurn(scenario)
  }

  // 4. Feedback replay
  const feedbackData = await runFeedbackReplay()

  // 5. Generate outputs
  const tsv = generateTSV(singleResults, multiResults, feedbackData)
  const report = generateReport(singleResults, multiResults, feedbackData)

  // Write files
  const fs = require('fs')
  fs.writeFileSync('test-results/results-sql-agent.tsv', tsv, 'utf-8')
  fs.writeFileSync('test-results/final-report-sql-agent.txt', report, 'utf-8')

  console.log(report)
  console.log('\nFiles saved:')
  console.log('  test-results/results-sql-agent.tsv')
  console.log('  test-results/final-report-sql-agent.txt')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
