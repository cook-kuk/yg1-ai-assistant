/**
 * E2E: Chip Edge Cases — Deeper stress scenarios
 *
 * Tests more nuanced interaction patterns that commonly cause chip/option divergence.
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

// Different material for variety
const STEEL_FORM = {
  material: { status: "known", value: "스테인리스" },
  operationType: { status: "known", value: "측면가공" },
  toolTypeOrCurrentProduct: { status: "known", value: "엔드밀" },
  diameterInfo: { status: "known", value: "10mm" },
  country: { status: "unknown" },
  machiningIntent: { status: "unknown" },
  purpose: "new_product_recommendation",
}

const MINIMAL_FORM = {
  material: { status: "unknown" },
  operationType: { status: "unknown" },
  toolTypeOrCurrentProduct: { status: "known", value: "엔드밀" },
  diameterInfo: { status: "unknown" },
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
  const res = await page.request.post(API_URL, { data: body, timeout: 60000 })
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  return {
    text: json.text ?? "",
    chips: json.chips ?? [],
    sessionState: json.sessionState ?? null,
    purpose: json.purpose ?? undefined,
  }
}

function ss(r: TurnResult) { return r.sessionState as any }
function field(r: TurnResult) { return ss(r)?.lastAskedField as string | undefined }
function mode(r: TurnResult) { return ss(r)?.currentMode as string | undefined }
function action(r: TurnResult) { return ss(r)?.lastAction as string | undefined }
function filters(r: TurnResult) { return (ss(r)?.appliedFilters ?? []) as Array<{ field: string; value: string; op: string }> }
function opts(r: TurnResult) { return (ss(r)?.displayedOptions ?? []) as Array<{ label: string; value: string; field: string }> }
function candidates(r: TurnResult) { return ss(r)?.candidateCount as number | undefined }

function log(scenario: string, turn: number, r: TurnResult, msg = "") {
  const f = filters(r).map(f => `${f.field}=${f.value}(${f.op})`).join(", ") || "none"
  const o = opts(r).map(o => o.label).slice(0, 5).join(", ") || "none"
  console.log(`[${scenario}:T${turn}] ${msg}`)
  console.log(`  text: ${r.text.slice(0, 80).replace(/\n/g, " ")}...`)
  console.log(`  chips(${r.chips.length}): [${r.chips.slice(0, 6).join(", ")}${r.chips.length > 6 ? "..." : ""}]`)
  console.log(`  field=${field(r)} mode=${mode(r)} action=${action(r)} cands=${candidates(r)}`)
  console.log(`  filters: ${f}`)
  console.log(`  opts(${opts(r).length}): ${o}`)
}

function checkChipOptionAlignment(scenario: string, turn: number, r: TurnResult) {
  const metaChips = new Set(["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요", "⟵ 이전 단계로 돌아가기"])
  const o = opts(r)
  if (o.length === 0) return // no structured options to compare

  const orphans: string[] = []
  for (const chip of r.chips) {
    if (metaChips.has(chip)) continue
    const hasOpt = o.some(opt => opt.label === chip || chip.startsWith(opt.value) || opt.value === chip.replace(/\s*\(\d+개\)\s*$/, ""))
    if (!hasOpt) orphans.push(chip)
  }
  if (orphans.length > 0) {
    console.warn(`  ⚠ ORPHAN chips: [${orphans.join(", ")}]`)
  }

  // Check if options have mixed fields (a sign of bad planning)
  const optFields = new Set(o.map(opt => opt.field))
  if (optFields.size > 2 && !["recommendation", "comparison"].includes(mode(r) ?? "")) {
    console.warn(`  ⚠ MIXED fields in options: ${[...optFields].join(", ")}`)
  }
}

// ════════════════════════════════════════════════════════════════
// E1: Repeat same answer twice
// ════════════════════════════════════════════════════════════════

test("E1: repeating same answer", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E1", 1, t1, "initial")

  if (!t1.sessionState) return
  const t2 = await send(page, "2날", t1.sessionState)
  log("E1", 2, t2, "select 2날")
  checkChipOptionAlignment("E1", 2, t2)

  if (!t2.sessionState) return
  // Repeat same answer
  const t3 = await send(page, "2날", t2.sessionState)
  log("E1", 3, t3, "repeat 2날")
  checkChipOptionAlignment("E1", 3, t3)
})

// ════════════════════════════════════════════════════════════════
// E2: Empty input mid-conversation
// ════════════════════════════════════════════════════════════════

test("E2: empty/whitespace input mid-conversation", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E2", 1, t1, "initial")
  if (!t1.sessionState) return

  const t2 = await send(page, "2날", t1.sessionState)
  log("E2", 2, t2, "select 2날")
  if (!t2.sessionState) return

  // Send empty-ish input
  const t3 = await send(page, " ", t2.sessionState)
  log("E2", 3, t3, "whitespace input")
  checkChipOptionAlignment("E2", 3, t3)

  expect(t3.chips.length).toBeGreaterThan(0)
})

// ════════════════════════════════════════════════════════════════
// E3: Contradicting previous selection
// ════════════════════════════════════════════════════════════════

test("E3: contradict previous selection", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E3", 1, t1, "initial")
  if (!t1.sessionState) return

  const t2 = await send(page, "2날", t1.sessionState)
  log("E3", 2, t2, "select 2날")
  if (!t2.sessionState) return

  // Now say "4날로 바꿔줘"
  const t3 = await send(page, "4날로 바꿔줘", t2.sessionState)
  log("E3", 3, t3, "contradict: 4날로 바꿔줘")
  checkChipOptionAlignment("E3", 3, t3)
})

// ════════════════════════════════════════════════════════════════
// E4: Multiple values in one message
// ════════════════════════════════════════════════════════════════

test("E4: multiple values in one message", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E4", 1, t1, "initial")
  if (!t1.sessionState) return

  const t2 = await send(page, "2날 DLC 코팅으로", t1.sessionState)
  log("E4", 2, t2, "2날 DLC 코팅으로")
  checkChipOptionAlignment("E4", 2, t2)
})

// ════════════════════════════════════════════════════════════════
// E5: Steel form — different candidate pool
// ════════════════════════════════════════════════════════════════

test("E5: steel form narrowing", async ({ page }) => {
  const t1 = await send(page, "", null, STEEL_FORM)
  log("E5", 1, t1, "steel initial")
  checkChipOptionAlignment("E5", 1, t1)

  if (!t1.sessionState) return
  const t2 = await send(page, "4날", t1.sessionState, STEEL_FORM)
  log("E5", 2, t2, "4날 selected")
  checkChipOptionAlignment("E5", 2, t2)

  if (!t2.sessionState) return
  const t3 = await send(page, "상관없음", t2.sessionState, STEEL_FORM)
  log("E5", 3, t3, "skip")
  checkChipOptionAlignment("E5", 3, t3)
})

// ════════════════════════════════════════════════════════════════
// E6: Minimal form — almost no info
// ════════════════════════════════════════════════════════════════

test("E6: minimal form (only tool type known)", async ({ page }) => {
  const t1 = await send(page, "", null, MINIMAL_FORM)
  log("E6", 1, t1, "minimal initial")
  checkChipOptionAlignment("E6", 1, t1)

  if (!t1.sessionState) return
  const t2 = await send(page, "알루미늄", t1.sessionState, MINIMAL_FORM)
  log("E6", 2, t2, "알루미늄")
  checkChipOptionAlignment("E6", 2, t2)

  if (!t2.sessionState) return
  const t3 = await send(page, "10mm", t2.sessionState, MINIMAL_FORM)
  log("E6", 3, t3, "10mm")
  checkChipOptionAlignment("E6", 3, t3)
})

// ════════════════════════════════════════════════════════════════
// E7: Emoji/special character input
// ════════════════════════════════════════════════════════════════

test("E7: emoji and special characters", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E7", 1, t1, "initial")
  if (!t1.sessionState) return

  const inputs = ["👍", "ㅋㅋㅋ", "???", "!!!"]
  let state = t1.sessionState
  let turn = 1
  for (const input of inputs) {
    if (!state) break
    turn++
    const t = await send(page, input, state)
    log("E7", turn, t, `"${input}"`)
    checkChipOptionAlignment("E7", turn, t)
    expect(t.chips.length).toBeGreaterThan(0)
    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// E8: Asking about specific product codes
// ════════════════════════════════════════════════════════════════

test("E8: asking about product codes", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E8", 1, t1, "initial")
  if (!t1.sessionState) return

  const t2 = await send(page, "2날", t1.sessionState)
  log("E8", 2, t2, "2날")
  if (!t2.sessionState) return

  // Ask about a product code - should NOT become a filter
  const t3 = await send(page, "E5D70이 뭐야?", t2.sessionState)
  log("E8", 3, t3, "E5D70이 뭐야?")
  checkChipOptionAlignment("E8", 3, t3)

  // Should not have E5D70 as a filter
  const badFilter = filters(t3).find(f => f.value.includes("E5D70") && f.op !== "skip")
  if (badFilter) {
    console.error(`  ✗ FAIL: "E5D70이 뭐야?" was committed as filter: ${JSON.stringify(badFilter)}`)
  } else {
    console.log(`  ✓ OK: product code question was NOT committed as filter`)
  }
})

// ════════════════════════════════════════════════════════════════
// E9: Rapid undo chain
// ════════════════════════════════════════════════════════════════

test("E9: rapid undo chain", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return
  log("E9", 1, t1, "initial")

  const t2 = await send(page, "2날", t1.sessionState)
  log("E9", 2, t2, "2날")
  if (!t2.sessionState) return

  const t3 = await send(page, "상관없음", t2.sessionState)
  log("E9", 3, t3, "skip")
  if (!t3.sessionState) return

  // Undo twice
  const t4 = await send(page, "이전으로", t3.sessionState)
  log("E9", 4, t4, "undo 1")
  checkChipOptionAlignment("E9", 4, t4)
  if (!t4.sessionState) return

  const t5 = await send(page, "이전으로", t4.sessionState)
  log("E9", 5, t5, "undo 2")
  checkChipOptionAlignment("E9", 5, t5)

  // Should be back to initial state
  console.log(`  filters after double undo: ${filters(t5).map(f => `${f.field}=${f.value}`).join(", ") || "none"}`)
})

// ════════════════════════════════════════════════════════════════
// E10: Post-rec "처음부터 다시" then full flow again
// ════════════════════════════════════════════════════════════════

test("E10: reset then restart", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  // Fast forward to recommendation
  let state = t1.sessionState
  for (let i = 0; i < 5; i++) {
    const t = await send(page, "상관없음", state)
    state = t.sessionState
    if (!state) break
    if (ss({ sessionState: state } as any)?.resolutionStatus?.startsWith("resolved")) break
  }
  if (!state) return

  // Reset
  const tReset = await send(page, "처음부터 다시", state)
  log("E10", 6, tReset, "reset")

  // Start again - should be clean
  const tNew = await send(page, "추천해주세요", null)
  log("E10", 7, tNew, "fresh start after reset")
  checkChipOptionAlignment("E10", 7, tNew)

  expect(filters(tNew).length).toBe(0)
})

// ════════════════════════════════════════════════════════════════
// E11: "이거 말고 다른 거" — vague revision
// ════════════════════════════════════════════════════════════════

test("E11: vague revision requests", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  const t2 = await send(page, "2날", t1.sessionState)
  if (!t2.sessionState) return

  const revisions = [
    "이거 말고 다른 거",
    "마음에 안 들어",
    "다른 거 보여줘",
  ]

  let state = t2.sessionState
  let turn = 2
  for (const rev of revisions) {
    if (!state) break
    turn++
    const t = await send(page, rev, state)
    log("E11", turn, t, `"${rev}"`)
    checkChipOptionAlignment("E11", turn, t)
    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// E12: Asking meta questions about the system
// ════════════════════════════════════════════════════════════════

test("E12: meta questions about the system", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  const metaQuestions = [
    "너 뭐야?",
    "점수는 어떻게 매기는 거야?",
    "몇 개 제품이 있어?",
  ]

  let state = t1.sessionState
  let turn = 1
  for (const q of metaQuestions) {
    if (!state) break
    turn++
    const t = await send(page, q, state)
    log("E12", turn, t, `"${q}"`)
    checkChipOptionAlignment("E12", turn, t)

    // Pending question should be preserved
    if (field(t1) && field(t) !== field(t1)) {
      console.warn(`  ⚠ Pending field changed: ${field(t1)} → ${field(t)}`)
    }
    state = t.sessionState
  }
})

// ════════════════════════════════════════════════════════════════
// E13: Very long input
// ════════════════════════════════════════════════════════════════

test("E13: very long user input", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  const longInput = "알루미늄 소재로 4mm 직경 엔드밀을 찾고 있는데 코팅은 DLC가 좋을 것 같고 날수는 2날이나 3날로 하고 싶은데 재고가 있는 제품으로 추천해주세요. 참고로 슬롯가공이고 정삭 위주입니다. CNC 장비는 Brother TC-S2DN 사용합니다."

  const t2 = await send(page, longInput, t1.sessionState)
  log("E13", 2, t2, "long input")
  checkChipOptionAlignment("E13", 2, t2)
})

// ════════════════════════════════════════════════════════════════
// E14: Switching language mid-conversation
// ════════════════════════════════════════════════════════════════

test("E14: switching to English mid-conversation", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  if (!t1.sessionState) return

  const t2 = await send(page, "2 flutes please", t1.sessionState)
  log("E14", 2, t2, "English: 2 flutes")
  checkChipOptionAlignment("E14", 2, t2)

  if (!t2.sessionState) return
  const t3 = await send(page, "DLC coating", t2.sessionState)
  log("E14", 3, t3, "English: DLC coating")
  checkChipOptionAlignment("E14", 3, t3)
})

// ════════════════════════════════════════════════════════════════
// E15: Chip click simulation (exact chip value)
// ════════════════════════════════════════════════════════════════

test("E15: exact chip value selection", async ({ page }) => {
  const t1 = await send(page, "추천해주세요")
  log("E15", 1, t1, "initial")
  if (!t1.sessionState) return

  // Send exactly what a chip says (simulating click)
  for (const chip of t1.chips.slice(0, 3)) {
    if (chip === "상관없음") continue
    const t = await send(page, chip, t1.sessionState)
    log("E15", 2, t, `chip click: "${chip}"`)
    checkChipOptionAlignment("E15", 2, t)
    break // just test first non-meta chip
  }
})
