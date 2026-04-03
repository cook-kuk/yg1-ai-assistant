#!/usr/bin/env node
/**
 * E2E Auto-Agent 90-scenario test
 *
 * 90 multi-turn conversation scenarios against the live API.
 * Run 2 in parallel, 60s timeout per turn.
 *
 * Usage: node scripts/e2e-autoagent-90.js
 */

const API_URL = "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 60_000
const PARALLEL = 2

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function callRecommend(intakeForm, messages, prevEngineState = null) {
  const body = {
    intakeForm,
    messages,
    session: { publicState: null, engineState: prevEngineState },
    language: "ko",
  }
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
    const statusCode = res.status
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { error: `HTTP ${statusCode}: ${text.slice(0, 200)}`, statusCode }
    }
    const json = await res.json()
    json.statusCode = statusCode
    return json
  } catch (err) {
    clearTimeout(timer)
    return { error: err.message, statusCode: 0 }
  }
}

function parseResponse(response) {
  const engineState = response.session?.engineState || null
  const publicState = response.session?.publicState || null
  const filters = publicState?.appliedFilters || engineState?.appliedFilters || []
  const candidateCount = publicState?.candidateCount || engineState?.candidateCount || 0
  return {
    text: response.text || "",
    purpose: response.purpose || "",
    chips: response.chips || [],
    error: response.error || null,
    statusCode: response.statusCode || 200,
    engineState,
    publicState,
    filters,
    candidateCount,
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
  holemaking: { toolTypeOrCurrentProduct: { status: "known", value: "Holemaking" } },
  threading: { toolTypeOrCurrentProduct: { status: "known", value: "Threading" } },
  carbon: { material: { status: "known", value: "P" } },
  stainless: { material: { status: "known", value: "M" } },
  aluminum: { material: { status: "known", value: "N" } },
  castIron: { material: { status: "known", value: "K" } },
  superAlloy: { material: { status: "known", value: "S" } },
  hardened: { material: { status: "known", value: "H" } },
  d: (mm) => ({ diameterInfo: { status: "known", value: `${mm}mm` } }),
}

function addMsg(messages, role, text) {
  return [...messages, { role, text }]
}

// ═══════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════

function ok() { return { pass: true } }
function fail(reason) { return { pass: false, reason } }

function noError(r) { return !r.error ? ok() : fail(`error: ${r.error}`) }
function hasText(r) { return r.text?.length > 0 ? ok() : fail("empty text") }
function hasCandidates(r) { return r.candidateCount > 0 ? ok() : fail("candidateCount=0") }
function noServerError(r) { return r.statusCode !== 500 ? ok() : fail("HTTP 500") }

function filterApplied(field) {
  return (r) => r.filters.some(f => f.field === field || f.field?.includes(field))
    ? ok() : fail(`no ${field} filter`)
}

function filterValue(field, val) {
  return (r) => {
    const f = r.filters.find(f => f.field === field || f.field?.includes(field))
    if (!f) return fail(`no ${field} filter`)
    const fv = String(f.rawValue ?? f.value)
    return fv.includes(String(val)) ? ok() : fail(`${field}=${fv}, expected ${val}`)
  }
}

function filterNotPresent(field) {
  return (r) => r.filters.every(f => f.field !== field && !f.field?.includes(field))
    ? ok() : fail(`${field} filter still present`)
}

function filtersUnchanged(scenarioRef) {
  return (r) => {
    const prev = scenarioRef.savedFilterCount
    return r.filters.length === prev
      ? ok() : fail(`filters changed: ${prev} -> ${r.filters.length}`)
  }
}

function filtersReduced(scenarioRef) {
  return (r) => {
    const prev = scenarioRef.savedFilterCount
    return r.filters.length < prev
      ? ok() : fail(`filters not reduced: was ${prev}, now ${r.filters.length}`)
  }
}

function saveFilterCount(scenarioRef) {
  return (r) => { scenarioRef.savedFilterCount = r.filters.length; return ok() }
}

// ═══════════════════════════════════════════════════════════════
// 90 Scenarios
// ═══════════════════════════════════════════════════════════════

function buildScenarios() {
  const all = []

  // shared refs for stateful checks
  const refs = {}
  function ref(id) { if (!refs[id]) refs[id] = {}; return refs[id] }

  // ── Step 1: Basic Flows (10) ──────────────────────────────
  all.push({
    id: "1-1", name: "carbon+Milling+10mm+Square+4날",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 4날 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-2", name: "stainless+Milling+6mm+Ball",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(6) }),
    turns: [
      { user: "Ball 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-3", name: "aluminum+Milling+12mm+Radius",
    form: makeForm({ ...F.milling, ...F.aluminum, ...F.d(12) }),
    turns: [
      { user: "Radius 엔드밀 추천 부탁합니다.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-4", name: "hardened+Milling+8mm → shape question → Square",
    form: makeForm({ ...F.milling, ...F.hardened, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-5", name: "castIron+Milling+4mm+2날",
    form: makeForm({ ...F.milling, ...F.castIron, ...F.d(4) }),
    turns: [
      { user: "2날 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-6", name: "carbon+Holemaking+10mm → drill",
    form: makeForm({ ...F.holemaking, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "드릴 추천해주세요.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-7", name: "stainless+Threading → tap",
    form: makeForm({ ...F.threading, ...F.stainless }),
    turns: [
      { user: "탭 추천해주세요.", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-8", name: "no conditions → should ask",
    form: makeForm(),
    turns: [
      { user: "추천해주세요.", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-9", name: "엔드밀 추천해줘 (no material/diameter)",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "1-10", name: "10mm 4날 추천 (no material)",
    form: makeForm({ ...F.milling, ...F.d(10) }),
    turns: [
      { user: "10mm 4날 추천", validate: [noError, hasText] },
    ],
  })

  // ── Step 2: Multi-filter (10) ──────────────────────────────
  all.push({
    id: "2-1", name: "4날 TiAlN Square",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4날 TiAlN Square 추천해줘", validate: [noError, hasText, filterApplied("fluteCount")] },
    ],
  })
  all.push({
    id: "2-2", name: "6날 AlCrN Radius",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(10) }),
    turns: [
      { user: "6날 AlCrN Radius로 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-3", name: "2날 DLC Ball",
    form: makeForm({ ...F.milling, ...F.aluminum, ...F.d(8) }),
    turns: [
      { user: "2날 DLC Ball 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-4", name: "10mm 4날 Square TiAlN 탄소강",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "10mm 4날 Square TiAlN 탄소강으로 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-5", name: "8mm 2날 Ball",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "8mm 2날 Ball 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-6", name: "스테인리스 6날",
    form: makeForm({ ...F.milling, ...F.d(10) }),
    turns: [
      { user: "스테인리스 6날 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-7", name: "알루미늄 3날",
    form: makeForm({ ...F.milling, ...F.d(10) }),
    turns: [
      { user: "알루미늄 3날 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-8", name: "TiAlN 코팅 4날",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "TiAlN 코팅 4날 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-9", name: "블루코팅 2날",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "블루코팅 2날 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "2-10", name: "무코팅 Square 10mm",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "무코팅 Square 10mm 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })

  // ── Step 3: Negation/Removal (10) ──────────────────────────
  all.push({
    id: "3-1", name: "Apply Square → remove Square",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("3-1"))] },
      { user: "Square 빼고 나머지로 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-2", name: "Apply TiAlN → remove TiAlN",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "TiAlN 코팅 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "TiAlN 제외하고 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-3", name: "Apply 4날 → remove 4날",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4날 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "4날 말고 다른 거 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-4", name: "Ball 아닌 것들",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Ball 아닌 것들 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-5", name: "코팅 없는 거로",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "코팅 없는 거로 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-6", name: "Apply Square → replace to Radius",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "Square 말고 Radius로 변경해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-7", name: "Apply 6날 → remove 6날",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(10) }),
    turns: [
      { user: "6날 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "6날 제외해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-8", name: "Apply DLC → remove DLC + add TiAlN",
    form: makeForm({ ...F.milling, ...F.aluminum, ...F.d(8) }),
    turns: [
      { user: "DLC 코팅 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "DLC 빼고 TiAlN으로 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-9", name: "형상 조건 초기화",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "형상 조건 초기화해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "3-10", name: "Apply Roughing → remove Roughing",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "황삭용 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "Roughing 빼고 추천해줘", validate: [noError, hasText] },
    ],
  })

  // ── Step 4: Condition Change (10) ──────────────────────────
  all.push({
    id: "4-1", name: "Square → Ball로 바꿔줘",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "Ball로 바꿔줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-2", name: "4날 → 6날로 변경",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4날 Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "6날로 변경해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-3", name: "10mm → 8mm로",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "직경 8mm로 바꿔줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-4", name: "TiAlN → AlCrN으로 바꿔",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "TiAlN 코팅 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "AlCrN으로 바꿔줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-5", name: "carbon → stainless 변경",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "소재를 스테인리스로 변경해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-6", name: "직경을 12mm로 올려줘",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "직경을 12mm로 올려줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-7", name: "코팅 TiCN으로 교체",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "TiAlN 코팅 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "코팅 TiCN으로 교체해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-8", name: "형상 Taper로",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "형상 Taper로 바꿔줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-9", name: "3날로 줄여줘",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4날 Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "3날로 줄여줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "4-10", name: "아까 조건에서 직경만 6mm로",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4날 Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "아까 조건에서 직경만 6mm로 바꿔줘", validate: [noError, hasText] },
    ],
  })

  // ── Step 5: General Questions - No Filter Change (10) ──────
  all.push({
    id: "5-1", name: "Apply Square → ask about TiAlN → filters unchanged",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-1"))] },
      { user: "TiAlN이 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-1"))] },
    ],
  })
  all.push({
    id: "5-2", name: "4날이랑 6날 차이",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-2"))] },
      { user: "4날이랑 6날 차이가 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-2"))] },
    ],
  })
  all.push({
    id: "5-3", name: "코너 래디우스가 뭐야?",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-3"))] },
      { user: "코너 래디우스가 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-3"))] },
    ],
  })
  all.push({
    id: "5-4", name: "황삭이랑 정삭 차이",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-4"))] },
      { user: "황삭이랑 정삭 차이가 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-4"))] },
    ],
  })
  all.push({
    id: "5-5", name: "YG-1이 어떤 회사야?",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-5"))] },
      { user: "YG-1이 어떤 회사야?", validate: [noError, hasText, filtersUnchanged(ref("5-5"))] },
    ],
  })
  all.push({
    id: "5-6", name: "Square 엔드밀은 뭐에 쓰는 거야?",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-6"))] },
      { user: "Square 엔드밀은 뭐에 쓰는 거야?", validate: [noError, hasText, filtersUnchanged(ref("5-6"))] },
    ],
  })
  all.push({
    id: "5-7", name: "코팅 종류 알려줘",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-7"))] },
      { user: "코팅 종류 알려줘", validate: [noError, hasText, filtersUnchanged(ref("5-7"))] },
    ],
  })
  all.push({
    id: "5-8", name: "절삭속도가 뭐야?",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-8"))] },
      { user: "절삭속도가 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-8"))] },
    ],
  })
  all.push({
    id: "5-9", name: "헬릭스각이 중요해?",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-9"))] },
      { user: "헬릭스각이 중요해?", validate: [noError, hasText, filtersUnchanged(ref("5-9"))] },
    ],
  })
  all.push({
    id: "5-10", name: "엔드밀이랑 드릴 차이",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("5-10"))] },
      { user: "엔드밀이랑 드릴 차이가 뭐야?", validate: [noError, hasText, filtersUnchanged(ref("5-10"))] },
    ],
  })

  // ── Step 6: Skip/Delegation (5) ────────────────────────────
  all.push({
    id: "6-1", name: "상관없음 → skip",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "6-2", name: "아무거나 → skip",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "아무거나", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "6-3", name: "알아서 추천해줘 → skip or recommendation",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "알아서 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "6-4", name: "패스 → skip",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "패스", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "6-5", name: "넘어가 → skip",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "넘어가", validate: [noError, hasText] },
    ],
  })

  // ── Step 7: Complex Natural Language (15) ──────────────────
  all.push({
    id: "7-1", name: "구리 전용 2날 10mm",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "구리 전용 2날 10mm짜리 있어?", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-2", name: "알루미늄 고속가공용",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "알루미늄 고속가공용 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-3", name: "SUS304 황삭",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "SUS304 황삭할 건데 뭐가 좋아?", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-4", name: "스테인리스 마무리 가공용",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "스테인리스 마무리 가공용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-5", name: "금형 곡면 가공",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "금형 곡면 가공할 건데 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-6", name: "티타늄 가공 가능한 거",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "티타늄 가공 가능한 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-7", name: "인코넬용 엔드밀",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "인코넬용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-8", name: "칩 배출 좋은 엔드밀",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "칩 배출 좋은 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-9", name: "진동 적은 거",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "진동 적은 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-10", name: "긴 가공 깊이용",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "긴 가공 깊이용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-11", name: "측면 가공용 추천",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "측면 가공용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-12", name: "포켓 가공용",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "포켓 가공할 건데 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-13", name: "3D 곡면 가공",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "3D 곡면 가공용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-14", name: "깊은 홈 가공",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "깊은 홈 가공용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "7-15", name: "프리하든강 가공",
    form: makeForm({ ...F.milling }),
    turns: [
      { user: "프리하든강 가공용 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })

  // ── Step 8: Reset/Go Back (5) ──────────────────────────────
  all.push({
    id: "8-1", name: "Apply 2 filters → 처음부터 다시",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 4날 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("8-1"))] },
      { user: "처음부터 다시 추천해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "8-2", name: "Apply 2 filters → 이전 단계로",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "4날로 추천해줘", validate: [noError, hasText, saveFilterCount(ref("8-2"))] },
      { user: "이전 단계로 돌아가줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "8-3", name: "조건 초기화",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 4날 TiAlN 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "조건 초기화해줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "8-4", name: "돌아가줘",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "4날 추천해줘", validate: [noError, hasText] },
      { user: "돌아가줘", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "8-5", name: "Apply 3 filters → 이전",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Square 4날 TiAlN 엔드밀 추천해줘", validate: [noError, hasText, saveFilterCount(ref("8-5"))] },
      { user: "이전", validate: [noError, hasText] },
    ],
  })

  // ── Step 9: Edge Cases (5) ─────────────────────────────────
  all.push({
    id: "9-1", name: "Empty-ish message '...'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "...", validate: [noServerError] },
    ],
  })
  all.push({
    id: "9-2", name: "Very long message (200 chars)",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "탄소강 소재에 10mm 직경의 Square 형상 4날 엔드밀을 추천해주세요. TiAlN 코팅이 좋겠고 황삭과 정삭 모두 가능하면 좋겠습니다. 가공 깊이는 대략 30mm 정도이고 측면 가공과 슬로팅을 동시에 해야 합니다. 추천 부탁드립니다.", validate: [noServerError, noError, hasText] },
    ],
  })
  all.push({
    id: "9-3", name: "English input",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "4 flute TiAlN Square endmill 10mm", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "9-4", name: "ㅎㅎ 그냥 아무거나",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해줘", validate: [noError, hasText] },
      { user: "ㅎㅎ 그냥 아무거나", validate: [noError, hasText] },
    ],
  })
  all.push({
    id: "9-5", name: "10미리 4날",
    form: makeForm({ ...F.milling, ...F.carbon }),
    turns: [
      { user: "10미리 4날 엔드밀 추천해줘", validate: [noError, hasText] },
    ],
  })

  return all
}

// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════

async function runScenario(scenario) {
  const startTime = Date.now()
  const turnResults = []
  let messages = []
  let engineState = null
  let passed = true

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    const turnStart = Date.now()

    messages = addMsg(messages, "user", turn.user)
    const rawResponse = await callRecommend(scenario.form, messages, engineState)
    const r = parseResponse(rawResponse)
    const turnMs = Date.now() - turnStart

    // carry state forward
    if (r.engineState) engineState = r.engineState
    messages = addMsg(messages, "ai", r.text || "(no text)")

    // run validators
    const failures = []
    for (const v of turn.validate) {
      const result = v(r)
      if (!result.pass) failures.push(result.reason)
    }

    const turnPassed = failures.length === 0
    if (!turnPassed) passed = false

    const shortText = (r.text || "").slice(0, 60).replace(/\n/g, " ")
    turnResults.push({
      index: i + 1,
      passed: turnPassed,
      ms: turnMs,
      user: turn.user.slice(0, 40),
      purpose: r.purpose,
      chipCount: r.chips.length,
      candidateCount: r.candidateCount,
      filterCount: r.filters.length,
      shortText,
      failures,
    })
  }

  const totalMs = Date.now() - startTime
  return { scenario, passed, turnResults, totalMs }
}

function printResult(result) {
  const { scenario, passed, turnResults, totalMs } = result
  const tag = passed ? "[PASS]" : "[FAIL]"
  console.log(`${tag} ${scenario.id}: ${scenario.name}  (${turnResults.length} turns, ${totalMs}ms)`)

  for (const t of turnResults) {
    const icon = t.passed ? "[OK]" : "[NG]"
    const meta = `purpose=${t.purpose} chips=${t.chipCount} candidates=${t.candidateCount} filters=${t.filterCount}`
    console.log(`  ${icon} T${t.index} [${t.ms}ms] "${t.user}" => ${meta}`)
    if (!t.passed) {
      for (const f of t.failures) {
        console.log(`       reason: ${f}`)
      }
    }
  }
}

async function runAllSequentialWithParallel(scenarios, parallel) {
  const results = []
  let idx = 0

  while (idx < scenarios.length) {
    const batch = scenarios.slice(idx, idx + parallel)
    const batchResults = await Promise.all(batch.map(s => runScenario(s)))
    for (const r of batchResults) {
      printResult(r)
      results.push(r)
    }
    idx += parallel
  }

  return results
}

async function main() {
  const scenarios = buildScenarios()
  console.log(`\n=== E2E Auto-Agent 90 Scenarios ===`)
  console.log(`API: ${API_URL}`)
  console.log(`Timeout: ${TIMEOUT}ms | Parallel: ${PARALLEL}`)
  console.log(`Total scenarios: ${scenarios.length}\n`)

  const allResults = await runAllSequentialWithParallel(scenarios, PARALLEL)

  // Summary
  const passCount = allResults.filter(r => r.passed).length
  const failCount = allResults.length - passCount
  const pct = ((passCount / allResults.length) * 100).toFixed(1)

  console.log(`\n${"=".repeat(60)}`)
  console.log(`SUMMARY: ${passCount}/${allResults.length} passed (${pct}%)`)

  if (failCount > 0) {
    console.log(`\nFAILURES:`)
    for (const r of allResults.filter(r => !r.passed)) {
      const failedTurns = r.turnResults.filter(t => !t.passed)
      const reasons = failedTurns.flatMap(t => t.failures).join("; ")
      console.log(`  ${r.scenario.id}: ${r.scenario.name} -- ${reasons}`)
    }
  }

  console.log(`${"=".repeat(60)}\n`)

  // exit code
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(2)
})
