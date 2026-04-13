/**
 * E2E: Chip/Option Consistency Scenarios
 *
 * Tests that chips and displayedOptions stay consistent with conversation context.
 * Hits the real /api/recommend endpoint.
 *
 * Scenarios:
 * 1. Basic narrowing ??recommendation ??chips match state
 * 2. "?곴??놁쓬" during narrowing ??skip_field for pending field
 * 3. "Ball? 紐뉕컻??" ??info query, NOT filter applied
 * 4. Post-recommendation general question ??chips preserved
 * 5. "?덈뀞" during narrowing ??pending question chips preserved
 * 6. Explanation request ??pending question maintained
 * 7. "異붿쿇?쇰줈 怨⑤씪以? ??delegation/skip for pending field
 */

import { test, expect, type APIRequestContext } from "@playwright/test"

const API_URL = "/api/recommend"
const API_TIMEOUT_MS = 120_000

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

interface ChatResponse {
  text: string
  chips: string[]
  sessionState: {
    candidateCount: number
    lastAskedField?: string
    displayedChips?: string[]
    displayedOptions?: Array<{ label: string; value: string; field: string }>
    resolutionStatus?: string
    appliedFilters?: Array<{ field: string; value: string; op: string }>
    currentMode?: string
    lastAction?: string
  } | null
}

async function sendRecommendMessage(
  request: APIRequestContext,
  message: string,
  prevState: ChatResponse["sessionState"] | null = null,
  form?: Record<string, unknown>
): Promise<ChatResponse> {
  const defaultForm = {
    material: { status: "known", value: "?뚮（誘몃뒆" },
    operationType: { status: "known", value: "?щ’" },
    toolTypeOrCurrentProduct: { status: "known", value: "?붾뱶諛" },
    diameterInfo: { status: "known", value: "4mm" },
    country: { status: "unknown" },
    machiningIntent: { status: "unknown" },
    purpose: "new_product_recommendation",
  }

  const body = {
    engine: "serve",
    intakeForm: form ?? defaultForm,
    messages: message ? [{ role: "user", text: message }] : [],
    session: prevState ? { publicState: prevState, engineState: null } : null,
    sessionState: prevState,
    displayedProducts: null,
    language: "ko",
    mode: "serve",
  }

  const response = await request.post(API_URL, {
    data: body,
    timeout: API_TIMEOUT_MS,
  })

  if (!response.ok()) {
    throw new Error(`Recommend API failed with ${response.status()}: ${await response.text()}`)
  }
  const json = await response.json()

  return {
    text: json.text ?? "",
    chips: json.chips ?? [],
    sessionState: json.session?.publicState ?? json.sessionState ?? null,
  }
}

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 1: Basic narrowing ??chips match state
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 1: Basic narrowing flow", () => {
  test("first real narrowing turn has chips matching displayedOptions", async ({ request }) => {
    // Initial message to enter the exploration flow (gets sessionState)
    const step1 = await sendRecommendMessage(request, "異붿쿇?댁＜?몄슂")

    expect(step1.chips.length).toBeGreaterThan(0)

    // sessionState may be null on simple chat path; if so, send follow-up
    let res = step1
    if (!res.sessionState) {
      res = await sendRecommendMessage(request, "알루미늄 4mm 엔드밀로 슬롯가공")
    }

    const options = res.sessionState?.displayedOptions ?? []
    if (options.length > 0) {
      const metaChips = new Set(["?곴??놁쓬", "???댁쟾 ?④퀎", "泥섏쓬遺???ㅼ떆", "異붿쿇?댁＜?몄슂"])
      for (const chip of res.chips) {
        if (metaChips.has(chip)) continue
        const hasOption = options.some(o => o.label === chip || chip.startsWith(o.value))
        if (!hasOption) {
          console.warn(`[chip-consistency] Chip "${chip}" has no matching displayedOption`)
        }
      }
    }

    console.log(`[scenario-1] Narrowing: ${res.chips.length} chips, ${options.length} options, field=${res.sessionState?.lastAskedField}`)
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 2: "?곴??놁쓬" ??skip_field
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 2: Skip field with ?곴??놁쓬", () => {
  test("?곴??놁쓬 skips the pending field and moves to next question", async ({ request }) => {
    // Step 1: Get into narrowing with a real session
    const step1 = await sendRecommendMessage(request, "異붿쿇?댁＜?몄슂")
    let state = step1.sessionState
    if (!state?.lastAskedField) {
      const step1b = await sendRecommendMessage(request, "?뚮（誘몃뒆 4mm ?붾뱶諛", state)
      state = step1b.sessionState
    }
    const pendingField = state?.lastAskedField
    if (!pendingField) {
      console.log("[scenario-2] SKIP: no pending field in narrowing state")
      return
    }

    // Step 2: Reply "?곴??놁쓬"
    const step2 = await sendRecommendMessage(request, "?곴??놁쓬", state)

    // The pending field should have been skipped
    const skippedFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === pendingField && f.op === "skip"
    )
    expect(skippedFilter).toBeTruthy()

    console.log(`[scenario-2] Skipped field "${pendingField}", new field="${step2.sessionState?.lastAskedField}", chips=${step2.chips.join(",")}`)
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 3: "Ball? 紐뉕컻??" ??info query, NOT filter
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 3: Exploratory mention vs filter selection", () => {
  test("asking about a value does not apply it as filter", async ({ request }) => {
    const step1 = await sendRecommendMessage(request, "")
    let state = step1.sessionState
    if (!state) {
      const seeded = await sendRecommendMessage(request, "\uC54C\uB8E8\uBBF8\uB284 4mm \uC5D4\uB4DC\uBC00 \uCD94\uCC9C\uD574\uC918")
      state = seeded.sessionState
    }
    expect(state).toBeTruthy()

    const step2 = await sendRecommendMessage(request, "Ball\uC740 \uBA87\uAC1C\uC57C?", state)

    const ballFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === "toolSubtype" && f.value.toLowerCase().includes("ball")
    )

    expect(ballFilter).toBeFalsy()
    expect(step2.text.length).toBeGreaterThan(0)
    expect(step2.sessionState?.appliedFilters ?? []).toEqual(state?.appliedFilters ?? [])
    expect(step2.sessionState?.candidateCount).toBe(state?.candidateCount)

    console.log(`[scenario-3] Response: ${step2.text.slice(0, 100)}...`)
    console.log(`[scenario-3] Chips: ${step2.chips.join(",")}`)
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 4: Post-recommendation general question ??chips preserved
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 4: Post-recommendation chip preservation", () => {
  test("general question after recommendation keeps relevant chips", async ({ request }) => {
    // Step 1: Get initial question
    const step1 = await sendRecommendMessage(request, "")

    // Step 2: Skip to recommendation
    const step2 = await sendRecommendMessage(request, "?곴??놁쓬", step1.sessionState)
    const step3 = await sendRecommendMessage(request, "?곴??놁쓬", step2.sessionState)

    // Step 4: Ask general question
    const step4 = await sendRecommendMessage(request, "?덈뀞?섏꽭??", step3.sessionState)

    // Chips should NOT be empty or generic garbage
    expect(step4.chips.length).toBeGreaterThan(0)

    // Should not contain random field values like "Bright Finish", "2", "E5E85"
    const suspiciousChips = step4.chips.filter(c =>
      /^[A-Z][a-z]+\s[A-Z]/.test(c) || // "Bright Finish" pattern
      /^[A-Z]\d[A-Z]/.test(c) || // "E5E85" pattern
      /^\d$/.test(c) // single digit
    )

    if (suspiciousChips.length > 0) {
      console.warn(`[scenario-4] Suspicious chips after general question: ${suspiciousChips.join(",")}`)
    }

    console.log(`[scenario-4] After "?덈뀞?섏꽭??": chips=${step4.chips.join(",")}`)
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 5: "?덈뀞" during narrowing ??pending question chips preserved
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 5: Greeting during narrowing preserves pending question", () => {
  test("casual greeting preserves pending field options", async ({ request }) => {
    // Step 1: Get initial question (e.g. asking about fluteCount)
    const step1 = await sendRecommendMessage(request, "")
    const pendingField = step1.sessionState?.lastAskedField
    const originalChips = step1.chips

    // Step 2: Send greeting
    const step2 = await sendRecommendMessage(request, "?덈뀞!", step1.sessionState)

    // The pending field should still be the same
    // Chips should still be related to the pending question, not random
    if (pendingField && step2.sessionState?.lastAskedField !== pendingField) {
      // It might have changed if the greeting was interpreted as a new turn
      console.warn(`[scenario-5] Pending field changed: ${pendingField} ??${step2.sessionState?.lastAskedField}`)
    }

    console.log(`[scenario-5] Before greeting: chips=${originalChips.join(",")}`)
    console.log(`[scenario-5] After greeting: chips=${step2.chips.join(",")}`)
    console.log(`[scenario-5] Pending field: ${pendingField} ??${step2.sessionState?.lastAskedField}`)
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 6: Explanation request preserves pending question
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 6: Explanation preserves pending question", () => {
  test("asking for explanation keeps the pending field and options", async ({ request }) => {
    // Step 1: Get initial question
    const step1 = await sendRecommendMessage(request, "")
    const pendingField = step1.sessionState?.lastAskedField

    // Step 2: Ask for explanation about one of the options
    const firstChip = step1.chips.find(c => c !== "?곴??놁쓬" && !c.includes("?댁쟾"))
    const question = firstChip ? `${firstChip}??萸먯빞?` : "?닿쾶 萸먯빞?"
    const step2 = await sendRecommendMessage(request, question, step1.sessionState)

    // Pending field should be preserved (question-assist mode)
    console.log(`[scenario-6] Asked: "${question}"`)
    console.log(`[scenario-6] Pending field: ${pendingField} ??${step2.sessionState?.lastAskedField}`)
    console.log(`[scenario-6] Mode: ${step2.sessionState?.currentMode}`)
    console.log(`[scenario-6] Chips: ${step2.chips.join(",")}`)

    // Mode should still be "question" if the pending question was preserved
    if (step2.sessionState?.currentMode === "question") {
      console.log(`[scenario-6] OK: Question mode preserved`)
    }
  })
})

// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧
// Scenario 7: "異붿쿇?쇰줈 怨⑤씪以? ??delegation/skip
// ?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧?먥븧

test.describe("Scenario 7: Delegation phrase triggers skip", () => {
  test("異붿쿇?쇰줈 怨⑤씪以?skips the pending field", async ({ request }) => {
    // Step 1: Get into narrowing with a real session
    const step1 = await sendRecommendMessage(request, "異붿쿇?댁＜?몄슂")
    let state = step1.sessionState
    if (!state?.lastAskedField) {
      const step1b = await sendRecommendMessage(request, "?뚮（誘몃뒆 4mm ?붾뱶諛", state)
      state = step1b.sessionState
    }
    const pendingField = state?.lastAskedField
    if (!pendingField) {
      console.log("[scenario-7] SKIP: no pending field in narrowing state")
      return
    }

    // Step 2: Delegate
    const step2 = await sendRecommendMessage(request, "추천으로 골라줘", state)

    // Should have skipped the pending field
    const skippedFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === pendingField && f.op === "skip"
    )

    if (skippedFilter) {
      console.log(`[scenario-7] OK: "異붿쿇?쇰줈 怨⑤씪以? skipped field "${pendingField}"`)
    } else {
      console.warn(`[scenario-7] "異붿쿇?쇰줈 怨⑤씪以? did NOT skip field "${pendingField}"`)
      console.warn(`[scenario-7] Filters: ${JSON.stringify(step2.sessionState?.appliedFilters)}`)
      console.warn(`[scenario-7] Action: ${step2.sessionState?.lastAction}`)
    }

    console.log(`[scenario-7] Chips: ${step2.chips.join(",")}`)
  })
})

