#!/usr/bin/env node
/**
 * E2E Multi-turn 50-scenario test
 *
 * 50 multi-turn conversation scenarios against the live API.
 * Each scenario: 3-8 turns, run 2 in parallel.
 *
 * Usage: node scripts/e2e-multiturn-50.js
 */

const API_URL = "https://yg1-ai-assistant.vercel.app/api/recommend"
const TIMEOUT = 90_000
const PARALLEL = 2

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function callRecommend(intakeForm, messages, prevEngineState = null) {
  const body = {
    intakeForm,
    messages,
    session: {
      publicState: null,
      engineState: prevEngineState,
    },
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
  const engineState = response.session?.engineState || null
  const publicState = response.session?.publicState || null
  const filters = engineState?.appliedFilters || publicState?.appliedFilters || []
  const candidateCount = engineState?.candidateCount || publicState?.candidateCount || 0
  return {
    text: response.text || "",
    purpose: response.purpose || "",
    chips: response.chips || [],
    chipGroups: response.chipGroups || [],
    candidates: response.candidates || [],
    isComplete: response.isComplete || false,
    error: response.error || null,
    engineState,
    publicState,
    filters,
    candidateCount,
    resolutionStatus: publicState?.resolutionStatus || engineState?.resolutionStatus || "none",
    lastAskedField: publicState?.lastAskedField || engineState?.lastAskedField || null,
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
  turning: { toolTypeOrCurrentProduct: { status: "known", value: "Turning" } },
  carbon: { material: { status: "known", value: "P" } },
  stainless: { material: { status: "known", value: "M" } },
  castIron: { material: { status: "known", value: "K" } },
  nonFerrous: { material: { status: "known", value: "N" } },
  superAlloy: { material: { status: "known", value: "S" } },
  hardened: { material: { status: "known", value: "H" } },
  d: (mm) => ({ diameterInfo: { status: "known", value: `${mm}mm` } }),
  matUnknown: { material: { status: "unknown" } },
  diaUnknown: { diameterInfo: { status: "unknown" } },
  allUnknown: {
    material: { status: "unknown" },
    operationType: { status: "unknown" },
    toolTypeOrCurrentProduct: { status: "unknown" },
    diameterInfo: { status: "unknown" },
  },
}

function addMsg(messages, role, text) {
  return [...messages, { role, text }]
}

// ═══════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════

function ok() { return { pass: true } }
function fail(reason) { return { pass: false, reason } }

function noError(r) {
  return r.error ? fail(`error: ${r.error}`) : ok()
}
function hasChips(r) {
  return r.chips.length > 0 ? ok() : fail("no chips")
}
function hasText(r) {
  return r.text.length > 0 ? ok() : fail("empty text")
}
function hasCandidates(r) {
  return r.candidateCount > 0 ? ok() : fail(`candidateCount=0`)
}
function purposeIs(expected) {
  return (r) => r.purpose === expected ? ok() : fail(`purpose=${r.purpose}, expected=${expected}`)
}
function filterContains(field) {
  return (r) => {
    const found = r.filters.some(f => f.field === field || f.field?.includes(field))
    return found ? ok() : fail(`no filter with field containing "${field}"`)
  }
}
function filterValueContains(substr) {
  return (r) => {
    const found = r.filters.some(f =>
      (typeof f.value === "string" && f.value.toLowerCase().includes(substr.toLowerCase())) ||
      (typeof f.rawValue === "string" && f.rawValue.toLowerCase().includes(substr.toLowerCase()))
    )
    return found ? ok() : fail(`no filter value containing "${substr}"`)
  }
}
function candidateCountChanged(prevCount) {
  return (r) => r.candidateCount !== prevCount ? ok() : fail(`candidateCount unchanged (${prevCount})`)
}
function filtersPreserved(prevFilters) {
  return (r) => {
    // At least as many filters as before (side question should not remove filters)
    return r.filters.length >= prevFilters.length
      ? ok()
      : fail(`filters reduced from ${prevFilters.length} to ${r.filters.length}`)
  }
}

// ═══════════════════════════════════════════════════════════════
// 50 Scenarios
// ═══════════════════════════════════════════════════════════════

const scenarios = [
  // ── Group A: Basic flows (10) ──────────────────────────────
  {
    id: "A1", name: "Milling+10mm -> Square -> 4 flute -> TiAlN -> recommend",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "위 조건에 맞는 엔드밀을 추천해주세요.", validate: [noError, hasText, hasChips] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "TiAlN", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "A2", name: "Milling+8mm -> Ball -> 2 flute -> skip coating",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천 부탁합니다.", validate: [noError, hasText] },
      { user: "Ball", validate: [noError, hasText] },
      { user: "2날", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
    ],
  },
  {
    id: "A3", name: "Milling+12mm -> Roughing -> 3 flute -> AlCrN",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(12) }),
    turns: [
      { user: "스테인리스용 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "황삭", validate: [noError, hasText] },
      { user: "3날", validate: [noError, hasText] },
      { user: "AlCrN", validate: [noError, hasText] },
    ],
  },
  {
    id: "A4", name: "All unknown -> skip x3 -> recommend",
    form: makeForm({ ...F.milling, ...F.allUnknown }),
    turns: [
      { user: "엔드밀 추천해주세요. 조건은 잘 모르겠어요.", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
    ],
  },
  {
    id: "A5", name: "Milling+6mm carbon steel basic",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(6) }),
    turns: [
      { user: "탄소강 6mm 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Side Milling", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "A6", name: "Milling+4mm non-ferrous",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(4) }),
    turns: [
      { user: "알루미늄 4mm 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "2날", validate: [noError, hasText] },
    ],
  },
  {
    id: "A7", name: "Milling+2mm hardened",
    form: makeForm({ ...F.milling, ...F.hardened, ...F.d(2) }),
    turns: [
      { user: "고경도강 2mm 엔드밀 찾아주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "A8", name: "Milling+10mm cast iron",
    form: makeForm({ ...F.milling, ...F.castIron, ...F.d(10) }),
    turns: [
      { user: "주철 10mm 밀링 추천해주세요.", validate: [noError, hasText] },
      { user: "Slotting", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "A9", name: "Holemaking+8mm carbon",
    form: makeForm({ ...F.holemaking, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "탄소강 8mm 드릴 추천 부탁드립니다.", validate: [noError, hasText] },
      { user: "Drilling", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "A10", name: "Milling+12mm super alloy",
    form: makeForm({ ...F.milling, ...F.superAlloy, ...F.d(12) }),
    turns: [
      { user: "초내열합금 12mm 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },

  // ── Group B: Revision mid-flow (10) ────────────────────────
  {
    id: "B1", name: "Square -> change to Ball",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "Square 말고 Ball로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B2", name: "4 flute -> change to 2 flute",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천 부탁합니다.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "2날로 변경해주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B3", name: "TiAlN -> change to DLC",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(6) }),
    turns: [
      { user: "알루미늄 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "2날", validate: [noError, hasText] },
      { user: "TiAlN", validate: [noError, hasText] },
      { user: "TiAlN 말고 DLC로 변경해주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B4", name: "Change diameter 10mm -> 8mm",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "직경을 8mm로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B5", name: "Change material carbon -> stainless",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "소재를 스테인리스로 변경해주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B6", name: "Change shape Slotting -> Side Milling",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Slotting", validate: [noError, hasText] },
      { user: "Slotting 말고 Side Milling으로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B7", name: "Multiple revisions in sequence",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "2날로 변경", validate: [noError, hasText] },
      { user: "Ball로 변경", validate: [noError, hasText] },
    ],
  },
  {
    id: "B8", name: "Roughing -> Finishing revision",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(8) }),
    turns: [
      { user: "스테인리스 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "황삭", validate: [noError, hasText] },
      { user: "황삭 말고 정삭으로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B9", name: "Revise after reaching recommendation",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
      { user: "Ball로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },
  {
    id: "B10", name: "Change flute count after coating",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(6) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "TiAlN", validate: [noError, hasText] },
      { user: "날수를 3날로 바꿔주세요.", validate: [noError, hasText] },
    ],
  },

  // ── Group C: Side questions (10) ───────────────────────────
  {
    id: "C1", name: "Shape question + side: what is coating",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "코팅이 뭐야?", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "C2", name: "Flute question + side: check stock",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "재고 있어?", validate: [noError, hasText] },
    ],
  },
  {
    id: "C3", name: "Ask about material difference",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "탄소강이랑 스테인리스 차이가 뭐야?", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "C4", name: "Ask what is Ball endmill",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(6) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Ball 엔드밀이 뭐야?", validate: [noError, hasText] },
      { user: "Ball", validate: [noError, hasText] },
    ],
  },
  {
    id: "C5", name: "Ask about YG-1 brand mid-flow",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "YG-1이 어떤 회사야?", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "C6", name: "Ask about TiAlN vs AlCrN",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
      { user: "TiAlN이랑 AlCrN 차이가 뭐야?", validate: [noError, hasText] },
      { user: "TiAlN", validate: [noError, hasText] },
    ],
  },
  {
    id: "C7", name: "Ask about helix angle",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "헬릭스각이 뭐야?", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "C8", name: "Ask about cutting speed",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(10) }),
    turns: [
      { user: "스테인리스 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "가공 속도는 어떻게 되나요?", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "C9", name: "Ask about roughing vs finishing mid-flow",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(12) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "황삭이랑 정삭 차이가 뭐야?", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "C10", name: "Ask about specific series mid-flow",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "X5070 시리즈가 뭐야?", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },

  // ── Group D: Skip / delegation (10) ────────────────────────
  {
    id: "D1", name: "Skip: 'anything'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "아무거나", validate: [noError, hasText] },
      { user: "아무거나", validate: [noError, hasText] },
    ],
  },
  {
    id: "D2", name: "Skip: 'decide for me'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "알아서 추천해주세요.", validate: [noError, hasText] },
      { user: "알아서", validate: [noError, hasText] },
    ],
  },
  {
    id: "D3", name: "Skip: 'pass'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "패스", validate: [noError, hasText] },
      { user: "패스", validate: [noError, hasText] },
    ],
  },
  {
    id: "D4", name: "Skip: 'don't know'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "모르겠어요", validate: [noError, hasText] },
      { user: "모르겠어요", validate: [noError, hasText] },
    ],
  },
  {
    id: "D5", name: "Skip: 'skip' repeated",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(8) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "건너뛰기", validate: [noError, hasText] },
      { user: "건너뛰기", validate: [noError, hasText] },
      { user: "건너뛰기", validate: [noError, hasText] },
    ],
  },
  {
    id: "D6", name: "Skip: mix of skip expressions",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(6) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "아무거나", validate: [noError, hasText] },
      { user: "패스", validate: [noError, hasText] },
      { user: "상관없음", validate: [noError, hasText] },
    ],
  },
  {
    id: "D7", name: "Skip: 'just recommend best'",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "가장 좋은 걸로 추천해줘", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "D8", name: "Skip: 'no preference' x3",
    form: makeForm({ ...F.milling, ...F.castIron, ...F.d(8) }),
    turns: [
      { user: "주철 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "선호 없음", validate: [noError, hasText] },
      { user: "선호 없음", validate: [noError, hasText] },
      { user: "선호 없음", validate: [noError, hasText] },
    ],
  },
  {
    id: "D9", name: "Skip: 'whatever' korean style",
    form: makeForm({ ...F.milling, ...F.nonFerrous, ...F.d(4) }),
    turns: [
      { user: "알루미늄 엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "뭐든 좋아", validate: [noError, hasText] },
      { user: "뭐든 좋아", validate: [noError, hasText] },
    ],
  },
  {
    id: "D10", name: "Skip: delegate after partial answer",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "나머지는 알아서 해줘", validate: [noError, hasText] },
    ],
  },

  // ── Group E: Error recovery / edge cases (10) ──────────────
  {
    id: "E1", name: "Nonsense input then recover",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "asdfghjkl", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "E2", name: "Empty-ish input then recover",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "...", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "E3", name: "Contradictory input",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square이면서 Ball인 엔드밀", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "E4", name: "Very long input",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "탄소강에서 사용하는 10mm Square 엔드밀을 찾고 있는데 4날이면서 TiAlN 코팅이 된 것을 원하고 가능하면 재고가 많은 것으로 추천해주세요. 이전에 사용하던 제품이 마모가 심해서 교체하려고 합니다.", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "E5", name: "Number-only input",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "4", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "E6", name: "English input in Korean context",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "Please recommend an endmill.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4 flute", validate: [noError, hasText] },
    ],
  },
  {
    id: "E7", name: "Repeat same answer twice",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "4날", validate: [noError, hasText] },
    ],
  },
  {
    id: "E8", name: "Greeting then start",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "안녕하세요", validate: [noError, hasText] },
      { user: "엔드밀 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
    ],
  },
  {
    id: "E9", name: "Competitor product reference",
    form: makeForm({ ...F.milling, ...F.carbon, ...F.d(10) }),
    turns: [
      { user: "OSG AE-VMS 10mm 대체품 추천해주세요.", validate: [noError, hasText] },
      { user: "Square", validate: [noError, hasText] },
      { user: "추천해줘", validate: [noError, hasText] },
    ],
  },
  {
    id: "E10", name: "Mixed Korean-English tokens",
    form: makeForm({ ...F.milling, ...F.stainless, ...F.d(8) }),
    turns: [
      { user: "스테인리스 milling 추천해주세요.", validate: [noError, hasText] },
      { user: "square endmill", validate: [noError, hasText] },
      { user: "4 flute 날수로 해줘", validate: [noError, hasText] },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════

async function runScenario(scenario) {
  const turnResults = []
  let messages = []
  let engineState = null
  const scenarioStart = Date.now()

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    messages = addMsg(messages, "user", turn.user)

    const turnStart = Date.now()
    try {
      const raw = await callRecommend(scenario.form, messages, engineState)
      const elapsed = Date.now() - turnStart
      const r = parseResponse(raw)

      // Chain session state
      engineState = r.engineState || engineState

      // Add AI response to messages
      if (r.text) {
        messages = addMsg(messages, "ai", r.text)
      }

      // Run validations
      const checks = turn.validate.map(fn => {
        const result = fn(r)
        return { name: fn.name || "check", ...result }
      })

      const allPass = checks.every(c => c.pass)

      turnResults.push({
        turn: i + 1,
        user: turn.user.slice(0, 60),
        elapsed,
        pass: allPass,
        checks,
        purpose: r.purpose,
        chips: r.chips.length,
        candidateCount: r.candidateCount,
        text: r.text.slice(0, 80),
      })
    } catch (err) {
      turnResults.push({
        turn: i + 1,
        user: turn.user.slice(0, 60),
        elapsed: Date.now() - turnStart,
        pass: false,
        checks: [{ name: "fetch", pass: false, reason: err.message }],
        purpose: null,
        chips: 0,
        candidateCount: 0,
        text: "",
      })
    }
  }

  const totalElapsed = Date.now() - scenarioStart
  const passCount = turnResults.filter(t => t.pass).length
  const failCount = turnResults.filter(t => !t.pass).length
  const allPass = failCount === 0

  return {
    id: scenario.id,
    name: scenario.name,
    turnCount: scenario.turns.length,
    pass: allPass,
    passCount,
    failCount,
    elapsed: totalElapsed,
    turnResults,
  }
}

async function runInBatches(items, batchSize, fn) {
  const results = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

async function main() {
  console.log("")
  console.log("=".repeat(70))
  console.log("  E2E Multi-turn 50 Scenario Test")
  console.log("=".repeat(70))
  console.log(`  Target:     ${API_URL}`)
  console.log(`  Scenarios:  ${scenarios.length}`)
  console.log(`  Total turns: ${scenarios.reduce((a, s) => a + s.turns.length, 0)}`)
  console.log(`  Parallel:   ${PARALLEL}`)
  console.log(`  Timeout:    ${TIMEOUT}ms per turn`)
  console.log("=".repeat(70))
  console.log("")

  const startTime = Date.now()
  const results = await runInBatches(scenarios, PARALLEL, runScenario)
  const totalElapsed = Date.now() - startTime

  // ── Print results ──────────────────────────────────────────
  let totalPass = 0
  let totalFail = 0
  let totalError = 0

  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL"
    const statusMark = r.pass ? "[PASS]" : "[FAIL]"

    console.log(`${statusMark} ${r.id}: ${r.name}  (${r.turnCount} turns, ${r.elapsed}ms)`)

    for (const t of r.turnResults) {
      const turnMark = t.pass ? "  [OK]" : "  [NG]"
      const failReasons = t.checks.filter(c => !c.pass).map(c => c.reason || c.name).join(", ")
      const failStr = failReasons ? ` -- ${failReasons}` : ""
      console.log(`${turnMark} T${t.turn} [${t.elapsed}ms] "${t.user}" => purpose=${t.purpose} chips=${t.chips} candidates=${t.candidateCount}${failStr}`)
    }

    if (r.pass) {
      totalPass++
    } else if (r.turnResults.some(t => t.checks.some(c => c.reason && c.reason.includes("HTTP")))) {
      totalError++
    } else {
      totalFail++
    }
    console.log("")
  }

  // ── Summary ────────────────────────────────────────────────
  const totalScenarios = results.length
  const turnPassCount = results.reduce((a, r) => a + r.passCount, 0)
  const turnFailCount = results.reduce((a, r) => a + r.failCount, 0)
  const totalTurns = turnPassCount + turnFailCount

  console.log("=".repeat(70))
  console.log("  SUMMARY")
  console.log("=".repeat(70))
  console.log(`  Scenarios:  ${totalScenarios}`)
  console.log(`    Pass:     ${totalPass}`)
  console.log(`    Fail:     ${totalFail}`)
  console.log(`    Error:    ${totalError}`)
  console.log(`  Turns:      ${totalTurns}`)
  console.log(`    Pass:     ${turnPassCount}`)
  console.log(`    Fail:     ${turnFailCount}`)
  console.log(`  Score:      ${totalTurns > 0 ? ((turnPassCount / totalTurns) * 100).toFixed(1) : 0}%`)
  console.log(`  Elapsed:    ${(totalElapsed / 1000).toFixed(1)}s`)
  console.log("=".repeat(70))
  console.log("")

  process.exit(totalFail + totalError > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("Fatal error:", err.message)
  process.exit(1)
})
