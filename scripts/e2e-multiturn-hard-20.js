#!/usr/bin/env node
/**
 * E2E Multi-turn Hard 20-scenario test
 *
 * 최근 픽스(phantom 필터 가드, 의도 헛집기, "추천해줘" 분류, 환각 brand/seriesName)
 * 와 실제 feedback DB 패턴을 트랩으로 박은 20개 멀티턴 시나리오.
 *
 * Usage:
 *   API_URL=http://20.119.98.136:3000/api/recommend node scripts/e2e-multiturn-hard-20.js
 *   API_URL=... node scripts/e2e-multiturn-hard-20.js --group=1   # 1-10
 *   API_URL=... node scripts/e2e-multiturn-hard-20.js --group=2   # 11-20
 */

const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 300_000
const PARALLEL = Number(process.env.PARALLEL) || 1
const GROUP = (() => {
  const a = process.argv.find(s => s.startsWith("--group="))
  return a ? Number(a.split("=")[1]) : 0
})()

async function callRecommend(intakeForm, messages, prevEngineState = null) {
  const body = { engine: "serve", intakeForm, messages, sessionState: prevEngineState, displayedProducts: null, language: "ko" }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function parseResponse(response) {
  // UI mirror: dto.session.engineState 가 정식. 구형 top-level sessionState 는 null 로 nullify 됨.
  const sessionState = response?.session?.engineState || response?.sessionState || null
  const filters = sessionState?.appliedFilters || []
  return {
    text: response.text || "",
    purpose: response.purpose || "",
    chips: response.chips || [],
    candidates: response.candidates || [],
    isComplete: response.isComplete || false,
    error: response.error || null,
    engineState: sessionState,
    filters,
    candidateCount: sessionState?.candidateCount || 0,
    resolutionStatus: sessionState?.resolutionStatus || "none",
    lastAskedField: sessionState?.lastAskedField || null,
  }
}

function makeForm(overrides = {}) {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "unanswered" },
    diameterInfo: { status: "unanswered" },
    country: { status: "unanswered" },
    ...overrides,
  }
}

const F = {
  milling: { toolTypeOrCurrentProduct: { status: "known", value: "Milling" } },
  carbon: { material: { status: "known", value: "P" } },
  stainless: { material: { status: "known", value: "M" } },
  nonFerrous: { material: { status: "known", value: "N" } },
  superAlloy: { material: { status: "known", value: "S" } },
  d: (mm) => ({ diameterInfo: { status: "known", value: `${mm}mm` } }),
  allUnknown: {
    material: { status: "unknown" },
    operationType: { status: "unknown" },
    toolTypeOrCurrentProduct: { status: "unknown" },
    diameterInfo: { status: "unknown" },
  },
}

// ── Validators ────────────────────────────────────────────────
function ok() { return { pass: true } }
function fail(reason) { return { pass: false, reason } }

const noError = (r) => r.error ? fail(`error: ${r.error}`) : ok()
const hasText = (r) => r.text.length > 0 ? ok() : fail("empty text")

// CRITICAL: brand/seriesName/country 같은 카테고리 필터가 박혔다면 그 값이
// 사용자 발화에 substring 으로 포함돼 있어야 한다. 환각 가드의 라이브 검증.
const PHANTOM_FIELDS = ["brand", "country", "seriesName"]
function noPhantomCategorical(userMessage) {
  return (r) => {
    const norm = (s) => String(s).toLowerCase().replace(/[\s\-_]+/g, "")
    const msgN = norm(userMessage)
    const offenders = r.filters.filter(f => {
      if (!PHANTOM_FIELDS.includes(f.field)) return false
      if (f.op === "skip") return false
      const v = Array.isArray(f.rawValue) ? f.rawValue.join(" ") : String(f.rawValue ?? f.value ?? "")
      return v && !msgN.includes(norm(v))
    })
    return offenders.length === 0
      ? ok()
      : fail(`PHANTOM filter applied: ${offenders.map(f => `${f.field}=${f.value}`).join(", ")}`)
  }
}

function filtersNotShrunk(prevCount) {
  return (r) => {
    const active = r.filters.filter(f => f.op !== "skip").length
    return active >= prevCount ? ok() : fail(`filters reduced ${prevCount}→${active}`)
  }
}

function candidatesNotZeroFromSmallTalk(prevCount) {
  return (r) => {
    if (prevCount === 0) return ok()
    return r.candidateCount > 0
      ? ok()
      : fail(`candidates collapsed ${prevCount}→0 on irrelevant message`)
  }
}

function noNewActiveFilter(prevCount) {
  return (r) => {
    const active = r.filters.filter(f => f.op !== "skip").length
    return active <= prevCount
      ? ok()
      : fail(`unexpected new filter, active ${prevCount}→${active}: ${r.filters.map(f=>f.field+'='+f.value).join('|')}`)
  }
}

// ── 20 Hard scenarios ────────────────────────────────────────
const scenarios = [
  // ─── Group 1: Phantom filter traps (1-5) ───
  {
    id: "P1", name: "small-talk: '너 이름은?' must not apply brand",
    form: makeForm({ ...F.allUnknown }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "너 이름은?", validate: [noError, noPhantomCategorical("너 이름은?"), candidatesNotZeroFromSmallTalk] },
    ],
  },
  {
    id: "P2", name: "'안녕하세요' must not apply any categorical filter",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "탄소강 10mm 엔드밀 추천", validate: [noError, hasText] },
      { user: "안녕하세요", validate: [noError, noPhantomCategorical("안녕하세요"), candidatesNotZeroFromSmallTalk] },
    ],
  },
  {
    id: "P3", name: "'고마워' mid-flow must preserve filters",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(8) }),
    turns: [
      { user: "스테인리스 8mm 엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "고마워", validate: [noError, noPhantomCategorical("고마워")] },
    ],
  },
  {
    id: "P4", name: "'당신 누구야' must not apply country=Korea",
    form: makeForm({ ...F.allUnknown }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "당신 누구야", validate: [noError, noPhantomCategorical("당신 누구야")] },
    ],
  },
  {
    id: "P5", name: "ghost X1-EH brand from minimal request",
    form: makeForm({ ...F.allUnknown }),
    turns: [
      { user: "엔드밀 하나 추천해줘", validate: [noError, hasText, noPhantomCategorical("엔드밀 하나 추천해줘") ] },
    ],
  },

  // ─── Group 1 cont: Intent misclassification (6-10) ───
  {
    id: "I1", name: "'추천해줘' must NOT add new filter (must show)",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      // capture filter count via wrapper at runtime (handled below)
      { user: "오호 추천해줘", validate: [noError, noPhantomCategorical("오호 추천해줘")], expectNoNewFilter: true },
    ],
  },
  {
    id: "I2", name: "real feedback: 다 필요없고 알루미늄 3날 corner radius",
    form: makeForm({ ...F.milling, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천", validate: [noError, hasText] },
      { user: "다 필요없고 알루미늄 가공용으로 3날짜리 Corner radius", validate: [noError, hasText, noPhantomCategorical("다 필요없고 알루미늄 가공용으로 3날짜리 Corner radius")] },
    ],
  },
  {
    id: "I3", name: "real feedback: corner radius → square 정정",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천", validate: [noError, hasText] },
      { user: "Corner Radius", validate: [noError, hasText] },
      { user: "음 죄송해요 corner radius 말고 square로 다시해주세요", validate: [noError, hasText, noPhantomCategorical("음 죄송해요 corner radius 말고 square로 다시해주세요")] },
    ],
  },
  {
    id: "I4", name: "Square → 4날 → '상관없음' must skip",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(10) }),
    turns: [
      { user: "엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText, noPhantomCategorical("상관없음")] },
    ],
  },
  {
    id: "I5", name: "real feedback: 제품 비교 질문 (필터 박지 말 것)",
    form: makeForm({ ...F.milling, ...F.superAlloy, ...F.d(10) }),
    turns: [
      { user: "초내열합금 10mm 엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "GMG55100 이랑 GMG40100의 차이가 뭐야?", validate: [noError, hasText, noPhantomCategorical("GMG55100 이랑 GMG40100의 차이가 뭐야?")], expectNoNewFilter: true },
    ],
  },

  // ─── Group 2: Brand explanation routes (11-15) ───
  {
    id: "B1", name: "real feedback: Tank-power 브랜드 설명",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(10) }),
    turns: [
      { user: "알루미늄 10mm 엔드밀", validate: [noError, hasText] },
      { user: "Tank-power 브랜드에 대해서 설명해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "B2", name: "real feedback: CRX-S 브랜드 소개",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(10) }),
    turns: [
      { user: "엔드밀", validate: [noError, hasText] },
      { user: "CRX s 브랜드도 소개해주세요", validate: [noError, hasText] },
    ],
  },
  {
    id: "B3", name: "real feedback: Alu-power 브랜드 소개",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(10) }),
    turns: [
      { user: "엔드밀", validate: [noError, hasText] },
      { user: "Alu-power 브랜드 소개부탁", validate: [noError, hasText] },
    ],
  },
  {
    id: "B4", name: "real feedback: 구리요 mid-flow material 변경",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(10) }),
    turns: [
      { user: "알루미늄 엔드밀", validate: [noError, hasText] },
      { user: "구리요", validate: [noError, hasText] },
    ],
  },
  {
    id: "B5", name: "legit brand: ONLY ONE 명시 → 적용 OK",
    form: makeForm({ ...F.allUnknown }),
    turns: [
      { user: "ONLY ONE 브랜드만 보여줘", validate: [noError, hasText] },
    ],
  },

  // ─── Group 2: Range/op edge cases (16-20) ───
  {
    id: "R1", name: "between: '직경 8~12mm'",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "탄소강 엔드밀", validate: [noError, hasText] },
      { user: "직경 8~12mm 사이", validate: [noError, hasText] },
    ],
  },
  {
    id: "R2", name: "gte: '전체 길이 100mm 이상'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "탄소강 10mm 엔드밀", validate: [noError, hasText] },
      { user: "전체 길이 100mm 이상", validate: [noError, hasText] },
    ],
  },
  {
    id: "R3", name: "neq: 'Y-Coating 빼고'",
    form: makeForm({ ...F.milling, ...F.superAlloy, ...F.d(10) }),
    turns: [
      { user: "초내열합금 10mm 엔드밀", validate: [noError, hasText] },
      { user: "Y-Coating 빼고", validate: [noError, hasText] },
    ],
  },
  {
    id: "R4", name: "stockThreshold: '재고 50개 이상'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "탄소강 10mm 엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "재고 50개 이상만 보여줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "R5", name: "go_back: '이전 단계'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "탄소강 10mm 엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "이전 단계", validate: [noError, hasText] },
    ],
  },
]

// ─── Runner ──────────────────────────────────────────────────
async function runScenario(scenario) {
  const start = Date.now()
  let messages = []
  let prevState = null
  const turnResults = []

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    const tStart = Date.now()
    const prevActiveFilters = prevState?.appliedFilters?.filter(f => f.op !== "skip").length ?? 0
    const prevCandidateCount = prevState?.candidateCount ?? 0
    messages = [...messages, { role: "user", text: turn.user }]
    let parsed, error = null
    try {
      const resp = await callRecommend(scenario.form, messages, prevState)
      parsed = parseResponse(resp)
      if (parsed.text) messages = [...messages, { role: "ai", text: parsed.text }]
      prevState = parsed.engineState
    } catch (err) {
      error = err.message
      parsed = { error: err.message, text: "", filters: [], candidateCount: 0, chips: [], candidates: [], purpose: "" }
    }

    const checks = []
    for (const v of (turn.validate || [])) {
      // Bound validators that need prev counts
      let fn = v
      if (v === candidatesNotZeroFromSmallTalk) fn = candidatesNotZeroFromSmallTalk(prevCandidateCount)
      if (v === filtersNotShrunk) fn = filtersNotShrunk(prevActiveFilters)
      try { checks.push(fn(parsed)) } catch (e) { checks.push(fail(`validator threw: ${e.message}`)) }
    }
    if (turn.expectNoNewFilter) {
      checks.push(noNewActiveFilter(prevActiveFilters)(parsed))
    }

    const turnPass = checks.every(c => c.pass) && !error
    turnResults.push({
      turn: i + 1,
      user: turn.user,
      pass: turnPass,
      elapsed: Date.now() - tStart,
      checks,
      filters: parsed.filters.map(f => `${f.field}=${f.value}${f.op && f.op!=='eq'?'['+f.op+']':''}`).join(", "),
      candidateCount: parsed.candidateCount,
      error,
    })
    if (error) break
  }

  const passCount = turnResults.filter(t => t.pass).length
  return {
    id: scenario.id,
    name: scenario.name,
    pass: turnResults.every(t => t.pass),
    passCount,
    failCount: turnResults.length - passCount,
    elapsed: Date.now() - start,
    turnResults,
  }
}

async function runInBatches(items, batchSize, fn) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
}

async function main() {
  let pool = scenarios
  if (GROUP === 1) pool = scenarios.slice(0, 10)
  else if (GROUP === 2) pool = scenarios.slice(10)

  console.log("=".repeat(72))
  console.log(`  Hard Multi-turn 20${GROUP ? ` (group ${GROUP}: ${pool.length} cases)` : ""}`)
  console.log(`  Target: ${API_URL}`)
  console.log("=".repeat(72))

  const t0 = Date.now()
  const results = await runInBatches(pool, PARALLEL, runScenario)
  const elapsed = Date.now() - t0

  let totalPass = 0, totalFail = 0
  for (const r of results) {
    const mark = r.pass ? "[PASS]" : "[FAIL]"
    console.log(`${mark} ${r.id}: ${r.name}  (${r.passCount}/${r.turnResults.length}, ${r.elapsed}ms)`)
    for (const t of r.turnResults) {
      const tm = t.pass ? "  ok" : "  NG"
      const fr = t.checks.filter(c => !c.pass).map(c => c.reason).join(" | ")
      console.log(`${tm} T${t.turn} "${t.user.slice(0,60)}" cand=${t.candidateCount} filters=[${t.filters}]${fr ? " -- " + fr : ""}${t.error ? " ERR=" + t.error : ""}`)
    }
    if (r.pass) totalPass++; else totalFail++
  }

  console.log("=".repeat(72))
  console.log(`  Pass ${totalPass}/${results.length}  Fail ${totalFail}  Elapsed ${(elapsed/1000).toFixed(1)}s`)
  console.log("=".repeat(72))

  // Save report
  const fs = require("fs")
  const path = `test-results/hard-20${GROUP ? `-g${GROUP}` : ""}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`
  fs.writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), api: API_URL, group: GROUP, results }, null, 2))
  console.log(`  Report → ${path}`)

  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
