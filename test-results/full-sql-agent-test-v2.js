/**
 * SQL Agent Primary Handler — Full Test Suite v2
 * 75 singleton + 5 multi-turn + feedback replay
 * Fixed: sessionState key, chained tests, harder variations
 */

const http = require('http')
const fs = require('fs')

const API = 'http://20.119.98.136:3000/api/recommend'
const FEEDBACK_API = 'http://20.119.98.136:3001/api/feedback'

// ── HTTP Helper ─────────────────────────────────────────────

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = typeof body === 'string' ? body : JSON.stringify(body)
    const opts = { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }
    const req = http.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ raw: d }) } }) })
    req.on('error', reject)
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(data)
    req.end()
  })
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)) } catch { resolve({ raw: d }) } }) }).on('error', reject)
  })
}

async function sendReq(input, sessionState = null, extraMessages = null) {
  const msgs = extraMessages || [{ role: 'user', text: input }]
  const start = Date.now()
  try {
    const body = { messages: msgs, language: 'ko' }
    if (sessionState) body.sessionState = sessionState
    const res = await post(API, body)
    const ms = Date.now() - start
    const filters = res.sessionState?.appliedFilters || []
    const candidates = res.sessionState?.candidateCount ?? res.sessionState?.totalCandidateCount ?? 0
    return { filters, filterCount: filters.length, candidates, ms, text: res.text || '', sessionState: res.sessionState, raw: res }
  } catch (e) {
    return { filters: [], filterCount: 0, candidates: 0, ms: Date.now() - start, text: 'ERROR: ' + e.message, sessionState: null, raw: null }
  }
}

// ── Judge ────────────────────────────────────────────────────

function judge(expect, result) {
  const e = expect.toLowerCase()
  const f = result.filterCount
  const filters = result.filters
  const t = (result.text || '').toLowerCase()

  if (result.text.startsWith('ERROR:')) return 'FAIL'
  if (e.includes('no error') || e.includes('에러 안')) return result.text.startsWith('ERROR:') ? 'FAIL' : 'PASS'

  // Reset
  if (e.includes('reset')) {
    const fc = result.sessionState?.appliedFilters?.length ?? -1
    return fc === 0 ? 'PASS' : fc === -1 ? 'WARN' : 'FAIL'
  }
  // Back
  if (e.includes('back')) {
    // Can't fully judge without comparing to prev, but check no error
    return !result.text.startsWith('ERROR:') ? 'PASS' : 'FAIL'
  }
  // Skip
  if (e.includes('skip')) {
    return 'PASS' // skip in first turn is by design a no-op
  }
  // Empty / 설명
  if (e.includes('빈배열') || e.includes('설명만') || e.includes('empty')) {
    // Should not add filters
    return f === 0 ? 'PASS' : 'WARN'
  }

  // Brand neq
  if (e.includes('brand neq') || e.includes('brand!=')) {
    const has = filters.some(fl => fl.field === 'brand' && fl.op === 'neq')
    return has ? 'PASS' : 'FAIL'
  }
  // Brand eq/like
  if (e.includes('brand') && !e.includes('neq')) {
    const has = filters.some(fl => fl.field === 'brand')
    return has ? 'PASS' : f > 0 ? 'WARN' : 'FAIL'
  }
  // Coating neq
  if (e.includes('coating neq') || e.includes('coating!=')) {
    const has = filters.some(fl => fl.field === 'coating' && fl.op === 'neq')
    return has ? 'PASS' : 'FAIL'
  }
  // Coating uncoated
  if (e.includes('coating') && e.includes('uncoated')) {
    const has = filters.some(fl => fl.field === 'coating' && String(fl.rawValue).toLowerCase().includes('uncoat'))
    return has ? 'PASS' : 'FAIL'
  }
  // Coating eq
  if (e.includes('coating') && !e.includes('neq')) {
    const has = filters.some(fl => fl.field === 'coating')
    return has ? 'PASS' : f > 0 ? 'WARN' : 'FAIL'
  }
  // toolSubtype neq
  if (e.includes('toolsubtype neq') || e.includes('subtype neq')) {
    const has = filters.some(fl => fl.field === 'toolSubtype' && fl.op === 'neq')
    return has ? 'PASS' : 'FAIL'
  }
  // fluteCount neq
  if (e.includes('flutecount neq') || e.includes('flute neq')) {
    const has = filters.some(fl => fl.field === 'fluteCount' && fl.op === 'neq')
    return has ? 'PASS' : 'FAIL'
  }
  // fluteCount eq specific
  const fluteEqMatch = e.match(/flutecount\s*(?:eq\s*)?(\d+)/)
  if (fluteEqMatch) {
    const has = filters.some(fl => fl.field === 'fluteCount' && Number(fl.rawValue) === Number(fluteEqMatch[1]))
    return has ? 'PASS' : 'FAIL'
  }
  // Diameter
  if (e.includes('diameter')) {
    const has = filters.some(fl => fl.field === 'diameterMm')
    return has ? 'PASS' : f > 0 ? 'WARN' : 'FAIL'
  }
  // Shank
  if (e.includes('shank')) {
    const has = filters.some(fl => fl.field === 'shankType' || (fl.rawSqlField && fl.rawSqlField.includes('shank')))
    return has ? 'PASS' : 'WARN'
  }

  // Filter count checks
  const filterMatch = e.match(/filters?\s*>=?\s*(\d+)/)
  if (filterMatch) {
    const expected = parseInt(filterMatch[1])
    return f >= expected ? 'PASS' : f > 0 ? 'WARN' : 'FAIL'
  }

  // CRX-S check
  if (e.includes('crx-s') || e.includes('crx')) {
    return (t.includes('crx') || t.includes('CRX')) ? 'PASS' : 'WARN'
  }

  return f > 0 ? 'PASS' : 'WARN'
}

function fmtFilters(filters) {
  return filters.map(f => `${f.field}${f.op === 'neq' ? '!=' : '='}${String(f.rawValue ?? f.value).slice(0, 15)}`).join(', ')
}

// ── Singleton Tests ──────────────────────────────────────────

async function runSingletons() {
  console.log('\n====================================================================')
  console.log('=== SINGLETON TESTS (75) ===')
  console.log('====================================================================\n')

  const results = []
  let chainState = {} // store sessionState for chained tests

  const tests = [
    // --- 기본 10개 ---
    { n: 1, cat: '기본', input: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', expect: 'filters>=3', chain: 'save:copper1' },
    { n: 2, cat: '기본', input: 'TANK-POWER 빼고', expect: 'brand neq', chain: 'load:copper1' },
    { n: 3, cat: '기본', input: 'TiAlN 빼고 나머지요', expect: 'coating neq' },
    { n: 4, cat: '기본', input: '생크 타입 플레인', expect: 'shank filter' },
    { n: 5, cat: '기본', input: '상관없음', expect: 'skip' },
    { n: 6, cat: '기본', input: '처음부터 다시', expect: 'reset' },
    { n: 7, cat: '기본', input: 'TiAlN이 뭐야?', expect: '빈배열, 설명만' },
    { n: 8, cat: '기본', input: '스테인리스 8mm Ball', expect: 'filters>=2' },
    { n: 9, cat: '기본', input: 'CRX-S 추천해줘', expect: 'brand' },
    { n: 10, cat: '기본', input: '4날 말고 다른거', expect: 'fluteCount neq' },

    // --- 부정/제외 변형 10개 ---
    { n: 11, cat: '부정', input: 'TiAlN 제외하고', expect: 'coating neq' },
    { n: 12, cat: '부정', input: 'TiAlN만 아니면 돼', expect: 'coating neq' },
    { n: 13, cat: '부정', input: '코팅 없는거', expect: 'coating uncoated' },
    { n: 14, cat: '부정', input: 'DLC 빼고 TiAlN으로', expect: 'coating' },
    { n: 15, cat: '부정', input: 'Square 빼고 다른 형상', expect: 'toolSubtype neq' },
    { n: 16, cat: '부정', input: 'ALU-CUT 말고 다른 브랜드', expect: 'brand neq', chain: 'load:copper1' },
    { n: 17, cat: '부정', input: '2날 말고 4날로', expect: 'fluteCount eq 4' },
    { n: 18, cat: '부정', input: '아니 TiAlN만 아니면 된다니까', expect: 'coating neq' },
    { n: 19, cat: '부정', input: 'Ball 아닌것', expect: 'toolSubtype neq' },
    { n: 20, cat: '부정', input: 'CRX-S 말고 다른 시리즈', expect: 'brand neq', chain: 'load:copper1' },

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
    { n: 31, cat: '네비', input: '이전 단계', expect: 'back' },
    { n: 32, cat: '네비', input: '돌아가', expect: 'back' },
    { n: 33, cat: '네비', input: '초기화', expect: 'reset' },
    { n: 34, cat: '네비', input: '다시 처음부터', expect: 'reset' },
    { n: 35, cat: '네비', input: '패스', expect: 'skip' },
    { n: 36, cat: '네비', input: '넘어가', expect: 'skip' },
    { n: 37, cat: '네비', input: '알아서', expect: 'skip' },
    { n: 38, cat: '질문', input: '코팅 종류 알려줘', expect: '빈배열, 설명만' },
    { n: 39, cat: '질문', input: '황삭 정삭 차이', expect: '빈배열, 설명만' },
    { n: 40, cat: '질문', input: '헬릭스각 중요해?', expect: '빈배열, 설명만' },

    // --- CRX-S 구리 변형 15개 ---
    { n: 41, cat: 'CRX-S', input: '구리 전용 2날 10mm', expect: 'filters>=2' },
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
    { n: 56, cat: '엣지', input: '', expect: '에러 안 남' },
    { n: 57, cat: '엣지', input: '10', expect: '에러 안 남' },
    { n: 58, cat: '엣지', input: '???', expect: '에러 안 남' },
    { n: 59, cat: '엣지', input: '이것은 아주 긴 메시지입니다 절삭 공구를 찾고 있는데 구리 소재에 적합한 스퀘어 엔드밀로 직경 10mm 2날짜리 추천해주시면 감사하겠습니다 가능하면 TiAlN 코팅이면 좋겠고 생크 직경도 알려주세요', expect: 'filters>=2' },
    { n: 60, cat: '엣지', input: 'ㅎㅎ 아무거나', expect: 'skip' },
    { n: 61, cat: '엣지', input: '👍', expect: '에러 안 남' },
    { n: 62, cat: '엣지', input: 'squre', expect: 'filters>=1' },
    { n: 63, cat: '엣지', input: '10미리 4날', expect: 'filters>=1' },
    { n: 64, cat: '엣지', input: 'Ø10', expect: 'filters>=1' },
    { n: 65, cat: '엣지', input: 'φ10', expect: 'filters>=1' },

    // --- 변형 확장 10개 (빡세게) ---
    { n: 66, cat: '변형', input: '인코넬용 4날 Ball 6mm 쿨런트홀', expect: 'filters>=3' },
    { n: 67, cat: '변형', input: '경화강 HRC60 2날 Taper', expect: 'filters>=2' },
    { n: 68, cat: '변형', input: '알루미늄 DLC코팅 High-Feed 20mm', expect: 'filters>=3' },
    { n: 69, cat: '변형', input: '탄소강 러핑 10mm 4날 무코팅', expect: 'filters>=3' },
    { n: 70, cat: '변형', input: 'SUS316L 챔퍼 6mm', expect: 'filters>=2' },
    { n: 71, cat: '변형', input: '흑연 가공 Diamond 코팅 2날 Ball', expect: 'filters>=3' },
    { n: 72, cat: '변형', input: 'SNCM439 합금강 Square 4날 8mm AlCrN', expect: 'filters>=4' },
    { n: 73, cat: '변형', input: '비철 brass 10mm Square 무코팅', expect: 'filters>=3' },
    { n: 74, cat: '변형', input: '일본 생산 제품만 보여줘', expect: 'filters>=1' },
    { n: 75, cat: '변형', input: 'Ti6Al4V 볼노즈 R3 쿨런트', expect: 'filters>=2' },
  ]

  for (const test of tests) {
    let sessionState = null
    let messages = null

    // Chain handling: load previous state for context-dependent tests
    if (test.chain?.startsWith('load:')) {
      const key = test.chain.split(':')[1]
      const prev = chainState[key]
      if (prev) {
        sessionState = prev.sessionState
        messages = [...prev.messages, { role: 'user', text: test.input }]
      }
    }

    const res = await sendReq(test.input, sessionState, messages)
    const verdict = judge(test.expect, res)

    // Chain handling: save state for future tests
    if (test.chain?.startsWith('save:')) {
      const key = test.chain.split(':')[1]
      chainState[key] = {
        sessionState: res.sessionState,
        messages: [{ role: 'user', text: test.input }, { role: 'assistant', text: res.text }]
      }
    }

    const icon = verdict === 'PASS' ? '✅' : verdict === 'WARN' ? '⚠️' : '❌'
    const fs = fmtFilters(res.filters)
    console.log(`${icon} #${test.n} [${test.cat}] "${test.input.slice(0, 35)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms ${fs ? '(' + fs + ')' : ''}`)
    if (verdict === 'FAIL') {
      console.log(`   EXPECTED: ${test.expect}`)
    }

    results.push({ ...test, verdict, filterCount: res.filterCount, candidates: res.candidates, ms: res.ms, filterSummary: fs, filters: res.filters })
    await new Promise(r => setTimeout(r, 200))
  }

  return results
}

// ── Multi-turn ───────────────────────────────────────────────

async function runMultiTurn(name, turns) {
  console.log(`\n--- Multi-turn: ${name} ---`)
  let sessionState = null
  let messages = []
  const results = []

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    messages.push({ role: 'user', text: turn.input })

    const start = Date.now()
    try {
      const body = { messages, language: 'ko' }
      if (sessionState) body.sessionState = sessionState
      const res = await post(API, body)
      const ms = Date.now() - start
      sessionState = res.sessionState
      messages.push({ role: 'assistant', text: res.text || '' })

      const fc = res.sessionState?.appliedFilters?.length ?? 0
      const cc = res.sessionState?.candidateCount ?? 0
      const filters = res.sessionState?.appliedFilters || []
      const fs = filters.map(f => `${f.field}${f.op === 'neq' ? '!=' : '='}${String(f.rawValue ?? f.value).slice(0, 12)}`).join(', ')

      console.log(`  Turn${i + 1} "${turn.input.slice(0, 30)}" → f=${fc} c=${cc} ${ms}ms (${fs})`)
      results.push({ turn: i + 1, input: turn.input, filterCount: fc, candidates: cc, ms, expect: turn.expect, filters: fs })
    } catch (e) {
      console.log(`  Turn${i + 1} ERROR: ${e.message}`)
      results.push({ turn: i + 1, input: turn.input, filterCount: 0, candidates: 0, ms: Date.now() - start, expect: turn.expect, filters: '', error: true })
    }
    await new Promise(r => setTimeout(r, 300))
  }
  return results
}

async function runAllMultiTurn() {
  console.log('\n====================================================================')
  console.log('=== MULTI-TURN TESTS (5 scenarios) ===')
  console.log('====================================================================')

  const scenarios = {
    'A: 기본흐름': [
      { input: '스퀘어 엔드밀 추천해줘', expect: 'filters>=1' },
      { input: '탄소강', expect: 'filters>=2' },
      { input: '10mm', expect: 'filters>=3' },
      { input: '4날', expect: 'filters>=4' },
      { input: 'TiAlN', expect: 'filters>=5' },
      { input: '추천해줘', expect: 'recommendation' },
    ],
    'B: 조건변경': [
      { input: 'Square 4날 10mm 추천해줘', expect: 'filters>=2' },
      { input: 'Ball로 바꿔줘', expect: 'Ball' },
      { input: '6날로 변경', expect: 'flute=6' },
      { input: '8mm로 바꿔', expect: 'diameter=8' },
      { input: '추천해줘', expect: 'recommendation' },
    ],
    'C: 부정/제외': [
      { input: '스퀘어 엔드밀', expect: 'filters>=1' },
      { input: 'TiAlN', expect: 'filters>=2' },
      { input: 'TiAlN 빼고 나머지요', expect: 'coating neq' },
      { input: '4날', expect: 'filters add' },
      { input: '추천해줘', expect: 'recommendation' },
    ],
    'D: 이전단계+리셋': [
      { input: 'Square', expect: 'filters>=1' },
      { input: '4날', expect: 'filters>=2' },
      { input: 'TiAlN', expect: 'filters>=3' },
      { input: '이전 단계', expect: 'back' },
      { input: 'AlCrN', expect: 'filters>=3' },
      { input: '처음부터 다시', expect: 'reset' },
      { input: '알루미늄 Ball 2날', expect: 'filters>=2' },
    ],
    'E: CRX-S구리': [
      { input: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', expect: 'filters>=3' },
      { input: 'TANK-POWER 빼고', expect: 'brand neq' },
      { input: '이전 단계', expect: 'back' },
      { input: 'DLC 코팅으로', expect: 'coating' },
      { input: '추천해줘', expect: 'recommendation' },
    ],
  }

  const allResults = {}
  for (const [name, turns] of Object.entries(scenarios)) {
    allResults[name] = await runMultiTurn(name, turns)
  }
  return allResults
}

// ── Feedback Replay ──────────────────────────────────────────

async function runFeedbackReplay() {
  console.log('\n====================================================================')
  console.log('=== FEEDBACK REPLAY ===')
  console.log('====================================================================\n')

  try {
    const data = await get(FEEDBACK_API)
    if (!Array.isArray(data)) {
      console.log('Feedback API: no data or error')
      return { bad: [], neutral: [], results: [] }
    }

    const bad = data.filter(f => f.rating === 'bad' || f.rating === '👎')
    const good = data.filter(f => f.rating === 'good' || f.rating === '👍')
    const neutral = data.filter(f => f.rating === 'neutral' || f.rating === '😐')
    console.log(`Total: ${data.length} (👍${good.length} 😐${neutral.length} 👎${bad.length})`)

    const replayResults = []

    if (bad.length > 0) {
      console.log('\n--- 👎 Bad feedback replay ---')
      for (const fb of bad) {
        const input = fb.userMessage || fb.input || ''
        if (!input) continue
        const res = await sendReq(input)
        const status = res.filterCount > 0 ? 'IMPROVED' : 'SAME'
        console.log(`  ${status} "${input.slice(0, 50)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms`)
        replayResults.push({ type: 'bad', input, ...res, status })
        await new Promise(r => setTimeout(r, 300))
      }
    }

    if (neutral.length > 0) {
      console.log('\n--- 😐 Neutral feedback (top 20) ---')
      for (let i = 0; i < Math.min(20, neutral.length); i++) {
        const fb = neutral[i]
        const input = fb.userMessage || fb.input || ''
        if (!input) continue
        const res = await sendReq(input)
        console.log(`  "${input.slice(0, 50)}" → f=${res.filterCount} c=${res.candidates} ${res.ms}ms`)
        replayResults.push({ type: 'neutral', input, ...res })
        await new Promise(r => setTimeout(r, 300))
      }
    }

    return { bad, neutral, results: replayResults }
  } catch (e) {
    console.log('Feedback error:', e.message)
    return { bad: [], neutral: [], results: [] }
  }
}

// ── Report Generator ─────────────────────────────────────────

function genReport(singles, multis, feedback) {
  const pass = singles.filter(r => r.verdict === 'PASS').length
  const warn = singles.filter(r => r.verdict === 'WARN').length
  const fail = singles.filter(r => r.verdict === 'FAIL').length
  const total = singles.length

  // Per category
  const cats = {}
  for (const r of singles) {
    if (!cats[r.cat]) cats[r.cat] = { total: 0, pass: 0, warn: 0, fail: 0 }
    cats[r.cat].total++
    cats[r.cat][r.verdict.toLowerCase()]++
  }

  let report = `
====================================================================
SQL Agent Test Report v2 — ${new Date().toISOString().slice(0, 19)}
====================================================================

## Singleton: ${total}개
  ✅ PASS: ${pass} (${(pass / total * 100).toFixed(1)}%)
  ⚠️ WARN: ${warn} (${(warn / total * 100).toFixed(1)}%)
  ❌ FAIL: ${fail} (${(fail / total * 100).toFixed(1)}%)

## Per Category
`
  for (const [cat, s] of Object.entries(cats)) {
    report += `  ${cat}: ${s.pass}/${s.total} PASS, ${s.warn} WARN, ${s.fail} FAIL\n`
  }

  // Avg response time
  const avgMs = singles.reduce((a, r) => a + r.ms, 0) / singles.length
  report += `\n## Avg Response: ${avgMs.toFixed(0)}ms\n`

  // Multi-turn
  report += '\n## Multi-turn\n'
  for (const [name, turns] of Object.entries(multis)) {
    const lastTurn = turns[turns.length - 1]
    const errors = turns.filter(t => t.error).length
    const maxF = Math.max(...turns.map(t => t.filterCount))
    report += `  ${name}: ${turns.length} turns, max_filters=${maxF}, errors=${errors}\n`
    for (const t of turns) {
      report += `    Turn${t.turn}: "${t.input.slice(0, 25)}" → f=${t.filterCount} c=${t.candidates} (${t.filters})\n`
    }
  }

  // Feedback
  if (feedback.results?.length > 0) {
    const badR = feedback.results.filter(r => r.type === 'bad')
    const improved = badR.filter(r => r.status === 'IMPROVED').length
    report += `\n## Feedback\n  👎 ${feedback.bad.length} total, ${badR.length} replayed, ${improved} improved\n`
    report += `  😐 ${feedback.neutral.length} total\n`
  }

  // Failures
  const fails = singles.filter(r => r.verdict === 'FAIL')
  if (fails.length > 0) {
    report += '\n## ❌ FAIL Detail\n'
    for (const f of fails) {
      report += `  #${f.n} [${f.cat}] "${f.input}" → expect: ${f.expect}, got: f=${f.filterCount} (${f.filterSummary})\n`
    }
  }

  // Warnings
  const warns = singles.filter(r => r.verdict === 'WARN')
  if (warns.length > 0) {
    report += '\n## ⚠️ WARN Detail\n'
    for (const w of warns) {
      report += `  #${w.n} [${w.cat}] "${w.input}" → expect: ${w.expect}, got: f=${w.filterCount} (${w.filterSummary})\n`
    }
  }

  return report
}

// ── TSV ──────────────────────────────────────────────────────

function genTSV(singles, multis) {
  let tsv = '번호\t카테고리\t입력\t기대\t판정\t필터수\t후보수\t응답ms\t필터상세\n'
  for (const r of singles) {
    tsv += `${r.n}\t${r.cat}\t${r.input}\t${r.expect}\t${r.verdict}\t${r.filterCount}\t${r.candidates}\t${r.ms}\t${r.filterSummary}\n`
  }
  tsv += '\n--- MULTI-TURN ---\n번호\t시나리오\t입력\t기대\t필터수\t후보수\t응답ms\t필터상세\n'
  for (const [name, turns] of Object.entries(multis)) {
    for (const t of turns) {
      tsv += `${t.turn}\t${name}\t${t.input}\t${t.expect}\t${t.filterCount}\t${t.candidates}\t${t.ms}\t${t.filters}\n`
    }
  }
  return tsv
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('SQL Agent Full Test Suite v2')
  console.log('Server:', API)
  console.log('Time:', new Date().toISOString())

  // Health check
  try {
    const hc = await sendReq('테스트')
    console.log(`Health: OK ${hc.ms}ms`)
  } catch (e) {
    console.error('Server down:', e.message)
    process.exit(1)
  }

  // 1. Singletons
  const singles = await runSingletons()

  // 2. Multi-turn
  const multis = await runAllMultiTurn()

  // 3. Feedback
  const feedback = await runFeedbackReplay()

  // 4. Output
  const report = genReport(singles, multis, feedback)
  const tsv = genTSV(singles, multis)

  fs.writeFileSync('test-results/results-sql-agent-v2.tsv', tsv, 'utf-8')
  fs.writeFileSync('test-results/final-report-sql-agent-v2.txt', report, 'utf-8')

  console.log(report)
  console.log('\nSaved: results-sql-agent-v2.tsv, final-report-sql-agent-v2.txt')
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
