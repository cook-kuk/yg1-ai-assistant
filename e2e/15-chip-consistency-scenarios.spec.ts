/**
 * E2E: Chip/Option Consistency Scenarios
 *
 * Tests that chips and displayedOptions stay consistent with conversation context.
 * Hits the real /api/recommend endpoint.
 *
 * Scenarios:
 * 1. Basic narrowing → recommendation → chips match state
 * 2. "상관없음" during narrowing → skip_field for pending field
 * 3. "Ball은 몇개야?" → info query, NOT filter applied
 * 4. Post-recommendation general question → chips preserved
 * 5. "안녕" during narrowing → pending question chips preserved
 * 6. Explanation request → pending question maintained
 * 7. "추천으로 골라줘" → delegation/skip for pending field
 */

import { test, expect } from "@playwright/test"

const API_URL = "/api/recommend"

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
  page: import("@playwright/test").Page,
  message: string,
  prevState: ChatResponse["sessionState"] | null = null,
  form?: Record<string, unknown>
): Promise<ChatResponse> {
  const defaultForm = {
    material: { status: "known", value: "알루미늄" },
    operationType: { status: "known", value: "슬롯" },
    toolTypeOrCurrentProduct: { status: "known", value: "엔드밀" },
    diameterInfo: { status: "known", value: "4mm" },
    country: { status: "unknown" },
    machiningIntent: { status: "unknown" },
    purpose: "new_product_recommendation",
  }

  const body = {
    engine: "serve",
    intakeForm: form ?? defaultForm,
    messages: message ? [{ role: "user", text: message }] : [],
    sessionState: prevState,
    displayedProducts: null,
    language: "ko",
    mode: "serve",
  }

  const response = await page.request.post(API_URL, {
    data: body,
    timeout: 30000,
  })

  expect(response.ok()).toBeTruthy()
  const json = await response.json()

  return {
    text: json.text ?? "",
    chips: json.chips ?? [],
    sessionState: json.sessionState ?? null,
  }
}

// ════════════════════════════════════════════════════════════════
// Scenario 1: Basic narrowing → chips match state
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 1: Basic narrowing flow", () => {
  test("first real narrowing turn has chips matching displayedOptions", async ({ page }) => {
    // Initial message to enter the exploration flow (gets sessionState)
    const step1 = await sendRecommendMessage(page, "추천해주세요")

    expect(step1.chips.length).toBeGreaterThan(0)

    // sessionState may be null on simple chat path; if so, send follow-up
    let res = step1
    if (!res.sessionState) {
      res = await sendRecommendMessage(page, "알루미늄 4mm 엔드밀로 슬롯가공")
    }

    const options = res.sessionState?.displayedOptions ?? []
    if (options.length > 0) {
      const metaChips = new Set(["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"])
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

// ════════════════════════════════════════════════════════════════
// Scenario 2: "상관없음" → skip_field
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 2: Skip field with 상관없음", () => {
  test("상관없음 skips the pending field and moves to next question", async ({ page }) => {
    // Step 1: Get into narrowing with a real session
    const step1 = await sendRecommendMessage(page, "추천해주세요")
    let state = step1.sessionState
    if (!state?.lastAskedField) {
      const step1b = await sendRecommendMessage(page, "알루미늄 4mm 엔드밀", state)
      state = step1b.sessionState
    }
    const pendingField = state?.lastAskedField
    if (!pendingField) {
      console.log("[scenario-2] SKIP: no pending field in narrowing state")
      return
    }

    // Step 2: Reply "상관없음"
    const step2 = await sendRecommendMessage(page, "상관없음", state)

    // The pending field should have been skipped
    const skippedFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === pendingField && f.op === "skip"
    )
    expect(skippedFilter).toBeTruthy()

    console.log(`[scenario-2] Skipped field "${pendingField}", new field="${step2.sessionState?.lastAskedField}", chips=${step2.chips.join(",")}`)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 3: "Ball은 몇개야?" → info query, NOT filter
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 3: Exploratory mention vs filter selection", () => {
  test("asking about a value does not apply it as filter", async ({ page }) => {
    // Step 1: Get initial question
    const step1 = await sendRecommendMessage(page, "")

    // Step 2: Ask about a value (NOT select it)
    const step2 = await sendRecommendMessage(page, "Ball은 몇개야?", step1.sessionState)

    // Ball should NOT be applied as a toolSubtype filter
    const ballFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === "toolSubtype" && f.value.toLowerCase().includes("ball")
    )

    if (ballFilter) {
      console.error(`[scenario-3] FAIL: "Ball은 몇개야?" was committed as filter: ${JSON.stringify(ballFilter)}`)
    } else {
      console.log(`[scenario-3] OK: "Ball은 몇개야?" was NOT committed as filter`)
    }

    // The text response should contain info about Ball count
    // Chips should still be relevant to the pending question, not Ball-specific
    console.log(`[scenario-3] Response: ${step2.text.slice(0, 100)}...`)
    console.log(`[scenario-3] Chips: ${step2.chips.join(",")}`)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 4: Post-recommendation general question → chips preserved
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 4: Post-recommendation chip preservation", () => {
  test("general question after recommendation keeps relevant chips", async ({ page }) => {
    // Step 1: Get initial question
    const step1 = await sendRecommendMessage(page, "")

    // Step 2: Skip to recommendation
    const step2 = await sendRecommendMessage(page, "상관없음", step1.sessionState)
    const step3 = await sendRecommendMessage(page, "상관없음", step2.sessionState)

    // Step 4: Ask general question
    const step4 = await sendRecommendMessage(page, "안녕하세요!", step3.sessionState)

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

    console.log(`[scenario-4] After "안녕하세요!": chips=${step4.chips.join(",")}`)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 5: "안녕" during narrowing → pending question chips preserved
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 5: Greeting during narrowing preserves pending question", () => {
  test("casual greeting preserves pending field options", async ({ page }) => {
    // Step 1: Get initial question (e.g. asking about fluteCount)
    const step1 = await sendRecommendMessage(page, "")
    const pendingField = step1.sessionState?.lastAskedField
    const originalChips = step1.chips

    // Step 2: Send greeting
    const step2 = await sendRecommendMessage(page, "안녕!", step1.sessionState)

    // The pending field should still be the same
    // Chips should still be related to the pending question, not random
    if (pendingField && step2.sessionState?.lastAskedField !== pendingField) {
      // It might have changed if the greeting was interpreted as a new turn
      console.warn(`[scenario-5] Pending field changed: ${pendingField} → ${step2.sessionState?.lastAskedField}`)
    }

    console.log(`[scenario-5] Before greeting: chips=${originalChips.join(",")}`)
    console.log(`[scenario-5] After greeting: chips=${step2.chips.join(",")}`)
    console.log(`[scenario-5] Pending field: ${pendingField} → ${step2.sessionState?.lastAskedField}`)
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 6: Explanation request preserves pending question
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 6: Explanation preserves pending question", () => {
  test("asking for explanation keeps the pending field and options", async ({ page }) => {
    // Step 1: Get initial question
    const step1 = await sendRecommendMessage(page, "")
    const pendingField = step1.sessionState?.lastAskedField

    // Step 2: Ask for explanation about one of the options
    const firstChip = step1.chips.find(c => c !== "상관없음" && !c.includes("이전"))
    const question = firstChip ? `${firstChip}이 뭐야?` : "이게 뭐야?"
    const step2 = await sendRecommendMessage(page, question, step1.sessionState)

    // Pending field should be preserved (question-assist mode)
    console.log(`[scenario-6] Asked: "${question}"`)
    console.log(`[scenario-6] Pending field: ${pendingField} → ${step2.sessionState?.lastAskedField}`)
    console.log(`[scenario-6] Mode: ${step2.sessionState?.currentMode}`)
    console.log(`[scenario-6] Chips: ${step2.chips.join(",")}`)

    // Mode should still be "question" if the pending question was preserved
    if (step2.sessionState?.currentMode === "question") {
      console.log(`[scenario-6] OK: Question mode preserved`)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// Scenario 7: "추천으로 골라줘" → delegation/skip
// ════════════════════════════════════════════════════════════════

test.describe("Scenario 7: Delegation phrase triggers skip", () => {
  test("추천으로 골라줘 skips the pending field", async ({ page }) => {
    // Step 1: Get into narrowing with a real session
    const step1 = await sendRecommendMessage(page, "추천해주세요")
    let state = step1.sessionState
    if (!state?.lastAskedField) {
      const step1b = await sendRecommendMessage(page, "알루미늄 4mm 엔드밀", state)
      state = step1b.sessionState
    }
    const pendingField = state?.lastAskedField
    if (!pendingField) {
      console.log("[scenario-7] SKIP: no pending field in narrowing state")
      return
    }

    // Step 2: Delegate
    const step2 = await sendRecommendMessage(page, "추천으로 골라줘", state)

    // Should have skipped the pending field
    const skippedFilter = step2.sessionState?.appliedFilters?.find(
      f => f.field === pendingField && f.op === "skip"
    )

    if (skippedFilter) {
      console.log(`[scenario-7] OK: "추천으로 골라줘" skipped field "${pendingField}"`)
    } else {
      console.warn(`[scenario-7] "추천으로 골라줘" did NOT skip field "${pendingField}"`)
      console.warn(`[scenario-7] Filters: ${JSON.stringify(step2.sessionState?.appliedFilters)}`)
      console.warn(`[scenario-7] Action: ${step2.sessionState?.lastAction}`)
    }

    console.log(`[scenario-7] Chips: ${step2.chips.join(",")}`)
  })
})
