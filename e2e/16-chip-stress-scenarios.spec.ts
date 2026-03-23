/**
 * E2E: Chip Consistency Stress Scenarios
 *
 * Auto-generated edge cases that are most likely to expose chip/option divergence.
 * Each scenario logs detailed diagnostics for debugging.
 */

import { test, expect } from "@playwright/test"

const API_URL = "/api/recommend"

const DEFAULT_FORM = {
  material: { status: "known", value: "알루미늄" },
  operationType: { status: "known", value: "슬롯" },
  toolTypeOrCurrentProduct: { status: "known", value: "엔드밀" },
  diameterInfo: { status: "known", value: "4mm" },
  country: { status: "unknown" },
  machiningIntent: { status: "unknown" },
  purpose: "new_product_recommendation",
}

interface TurnResult {
  text: string
  chips: string[]
  sessionState: Record<string, unknown> | null
  purpose?: string
}

async function send(
  page: import("@playwright/test").Page,
  message: string,
  prevState: Record<string, unknown> | null = null,
  form = DEFAULT_FORM
): Promise<TurnResult> {
  const body = {
    engine: "serve",
    intakeForm: form,
    messages: message ? [{ role: "user", text: message }] : [],
    sessionState: prevState,
    displayedProducts: null,
    language: "ko",
    mode: "serve",
  }
  const res = await page.request.post(API_URL, { data: body, timeout: 30000 })
  expect(res.ok()).toBeTruthy()
  const json = await response(res)
  return {
    text: json.text ?? "",
    chips: json.chips ?? [],
    sessionState: json.sessionState ?? null,
    purpose: json.purpose ?? undefined,
  }
}

async function response(res: import("@playwright/test").APIResponse) {
  return await res.json()
}

function ss(r: TurnResult) { return r.sessionState as Record<string, unknown> | null }
function field(r: TurnResult) { return (ss(r) as any)?.lastAskedField as string | undefined }
function mode(r: TurnResult) { return (ss(r) as any)?.currentMode as string | undefined }
function action(r: TurnResult) { return (ss(r) as any)?.lastAction as string | undefined }
function filters(r: TurnResult) { return ((ss(r) as any)?.appliedFilters ?? []) as Array<{ field: string; value: string; op: string }> }
function options(r: TurnResult) { return ((ss(r) as any)?.displayedOptions ?? []) as Array<{ label: string; value: string; field: string }> }
function candidates(r: TurnResult) { return (ss(r) as any)?.candidateCount as number | undefined }

function log(scenario: string, turn: number, r: TurnResult, msg = "") {
  console.log(`[${scenario}:T${turn}] ${msg}`)
  console.log(`  text: ${r.text.slice(0, 80).replace(/\n/g, " ")}...`)
  console.log(`  chips: [${r.chips.join(", ")}]`)
  console.log(`  field: ${field(r)}, mode: ${mode(r)}, action: ${action(r)}, candidates: ${candidates(r)}`)
  console.log(`  filters: ${filters(r).map(f => `${f.field}=${f.value}(${f.op})`).join(", ") || "none"}`)
  console.log(`  options: ${options(r).map(o => o.label).join(", ") || "none"}`)
}

// ════════════════════════════════════════════════════════════════
// S1: Multi-turn narrowing → recommendation (happy path)
// ════════════════════════════════════════════════════════════════

test("S1: full narrowing to recommendation", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("S1", 1, t1, "initial")

  // Answer with first chip if available
  const firstValue = t1.chips.find(c => !["상관없음", "처음부터 다시", "추천해주세요"].includes(c))
  if (!firstValue || !t1.sessionState) return

  const t2 = await send(page, firstValue, t1.sessionState)
  log("S1", 2, t2, `selected "${firstValue}"`)

  if (!t2.sessionState) return
  const t3 = await send(page, "상관없음", t2.sessionState)
  log("S1", 3, t3, "skip")

  if (!t3.sessionState) return
  const t4 = await send(page, "상관없음", t3.sessionState)
  log("S1", 4, t4, "skip again")

  // Should eventually reach recommendation
  expect(t4.chips.length).toBeGreaterThan(0)
})

// ════════════════════════════════════════════════════════════════
// S2: Number-only answers ("2", "3")
// ════════════════════════════════════════════════════════════════

test("S2: number-only answers for flute count", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S2", 1, t1)

  // Skip until we get to fluteCount question
  let state = t1.sessionState
  let turn = 1
  while (turn < 5) {
    const f = (state as any)?.lastAskedField
    if (f === "fluteCount") break
    const next = await send(page, "상관없음", state)
    turn++
    state = next.sessionState
    log("S2", turn, next, `skip to find fluteCount`)
    if (!state) break
  }

  if ((state as any)?.lastAskedField === "fluteCount") {
    const t = await send(page, "2", state)
    log("S2", turn + 1, t, 'answered "2" for fluteCount')

    const fluteFilter = filters(t).find(f => f.field === "fluteCount")
    if (fluteFilter) {
      console.log(`[S2] OK: fluteCount filter applied: ${JSON.stringify(fluteFilter)}`)
    } else {
      console.warn(`[S2] WARN: "2" was not applied as fluteCount filter`)
    }
  }
})

// ════════════════════════════════════════════════════════════════
// S3: Korean informal answers
// ════════════════════════════════════════════════════════════════

test("S3: informal Korean answers", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S3", 1, t1)

  const informalAnswers = [
    "그냥 2날로 해줘",
    "DLC 괜찮을 듯",
    "아 몰라 알아서 해",
  ]

  let state = t1.sessionState
  let turn = 1
  for (const answer of informalAnswers) {
    if (!state) break
    turn++
    const t = await send(page, answer, state)
    log("S3", turn, t, `"${answer}"`)
    state = t.sessionState

    // Check chips aren't empty
    expect(t.chips.length).toBeGreaterThan(0)
  }
})

// ════════════════════════════════════════════════════════════════
// S4: Exploratory questions mid-narrowing
// ════════════════════════════════════════════════════════════════

test("S4: exploratory questions during narrowing", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S4", 1, t1)

  const exploratoryQuestions = [
    "코팅 종류가 뭐가 있어?",
    "DLC랑 AlTiN 차이가 뭐야?",
    "3날이랑 4날 뭐가 좋아?",
  ]

  let state = t1.sessionState
  let turn = 1
  for (const q of exploratoryQuestions) {
    if (!state) break
    turn++
    const t = await send(page, q, state)
    log("S4", turn, t, `"${q}"`)

    // These should NOT create filters
    const filtersBefore = filters({ ...t1, sessionState: state } as TurnResult).length
    const filtersAfter = filters(t).filter(f => f.op !== "skip").length

    if (filtersAfter > filtersBefore) {
      console.warn(`[S4] WARN: "${q}" added a filter! before=${filtersBefore} after=${filtersAfter}`)
    } else {
      console.log(`[S4] OK: "${q}" did NOT add filter`)
    }

    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// S5: Rapid skip → undo → skip
// ════════════════════════════════════════════════════════════════

test("S5: skip → undo → skip sequence", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S5", 1, t1)

  // Skip
  const t2 = await send(page, "상관없음", t1.sessionState)
  log("S5", 2, t2, "skip")

  if (!t2.sessionState) return
  // Undo
  const t3 = await send(page, "이전으로", t2.sessionState)
  log("S5", 3, t3, "undo")

  if (!t3.sessionState) return
  // Skip again
  const t4 = await send(page, "패스", t3.sessionState)
  log("S5", 4, t4, "skip again")

  expect(t4.chips.length).toBeGreaterThan(0)
})

// ════════════════════════════════════════════════════════════════
// S6: Post-recommendation follow-ups
// ════════════════════════════════════════════════════════════════

test("S6: post-recommendation conversation", async ({ page }) => {
  // Get to recommendation fast
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  let state = t1.sessionState
  for (let i = 0; i < 4; i++) {
    const t = await send(page, "상관없음", state)
    state = t.sessionState
    if (!state) break
    if ((state as any)?.resolutionStatus?.startsWith("resolved")) {
      log("S6", i + 2, t, "reached recommendation")
      break
    }
  }

  if (!state) return

  // Post-recommendation questions
  const followUps = [
    "이 제품 재고 있어?",
    "절삭조건 알려줘",
    "다른 코팅은?",
    "안녕",
  ]

  let turn = 6
  for (const q of followUps) {
    if (!state) break
    turn++
    const t = await send(page, q, state)
    log("S6", turn, t, `post-rec: "${q}"`)

    // Chips should never be empty after recommendation
    expect(t.chips.length).toBeGreaterThan(0)

    // Check for suspicious chips (random field values)
    const suspicious = t.chips.filter(c =>
      /^[A-Z][a-z]+\s[A-Z]/.test(c) || /^\d$/.test(c)
    )
    if (suspicious.length > 0) {
      console.warn(`[S6] SUSPICIOUS chips after "${q}": ${suspicious.join(", ")}`)
    }

    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// S7: Ambiguous single-word inputs
// ════════════════════════════════════════════════════════════════

test("S7: ambiguous inputs (네, 좋아, 그래, ㅇㅇ)", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S7", 1, t1)

  const ambiguous = ["네", "좋아", "그래", "ㅇㅇ", "응"]
  let state = t1.sessionState
  let turn = 1

  for (const input of ambiguous) {
    if (!state) break
    turn++
    const t = await send(page, input, state)
    log("S7", turn, t, `"${input}"`)

    expect(t.chips.length).toBeGreaterThan(0)
    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// S8: Mixed language inputs
// ════════════════════════════════════════════════════════════════

test("S8: mixed Korean/English inputs", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("S8", 1, t1)

  const mixed = [
    "DLC coating으로",
    "4 flute",
    "Square endmill",
    "ball nose는?",
  ]

  let state = t1.sessionState
  let turn = 1
  for (const input of mixed) {
    if (!state) break
    turn++
    const t = await send(page, input, state)
    log("S8", turn, t, `"${input}"`)
    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// S9: Comparison request then continue
// ════════════════════════════════════════════════════════════════

test("S9: comparison then continue narrowing", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  // Get some candidates
  let state = t1.sessionState
  const t2 = await send(page, "상관없음", state)
  state = t2.sessionState
  if (!state) return
  log("S9", 2, t2)

  // Ask for comparison
  const t3 = await send(page, "1번이랑 2번 비교해줘", state)
  log("S9", 3, t3, "comparison request")

  if (!t3.sessionState) return
  // Continue after comparison
  const t4 = await send(page, "추천해주세요", t3.sessionState)
  log("S9", 4, t4, "continue after comparison")

  expect(t4.chips.length).toBeGreaterThan(0)
})

// ════════════════════════════════════════════════════════════════
// S10: Long conversation (8+ turns)
// ════════════════════════════════════════════════════════════════

test("S10: long conversation stability", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  const conversation = [
    "상관없음",
    "2날",
    "DLC",
    "절삭조건 알려줘",
    "다른 코팅은 없어?",
    "AlTiN으로 바꿔줘",
    "재고 있는 거로",
    "처음부터 다시",
  ]

  let state = t1.sessionState
  let turn = 1
  for (const msg of conversation) {
    if (!state && turn > 2) break
    turn++
    const t = await send(page, msg, state)
    log("S10", turn, t, `"${msg}"`)

    // Chips should never be empty
    expect(t.chips.length).toBeGreaterThan(0)

    // Check chip/option alignment
    const opts = options(t)
    if (opts.length > 0) {
      const metaChips = new Set(["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요", "⟵ 이전 단계로 돌아가기"])
      const orphanChips = t.chips.filter(c => !metaChips.has(c) && !opts.some(o => o.label === c))
      if (orphanChips.length > 0) {
        console.warn(`[S10:T${turn}] ORPHAN chips: ${orphanChips.join(", ")}`)
      }
    }

    state = t.sessionState
  }
})
