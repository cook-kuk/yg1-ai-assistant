import { test, expect, type Page } from "@playwright/test"

/**
 * Full UI E2E Stress Tests — 실제 서버 통신 + UI 상태 검증
 *
 * 실행:
 *   BASE_URL=http://20.119.98.136:3000 npx playwright test e2e/20-full-ui-stress.spec.ts --workers=4
 *
 * 검증 항목:
 *   - 채팅 UI 렌더링 (메시지, 칩, CTA 버튼)
 *   - 오른쪽 후보 카드 패널
 *   - 사이드바 필터/조건 표시
 *   - session state 유지 (resolvedInput, candidateCount, artifacts)
 *   - resolution 상태 뱃지 변화
 *   - 멀티턴 대화 흐름
 */

test.describe.configure({ mode: "parallel" })

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

const CHAT_INPUT = /추가 질문이나 조건을 입력하세요|Enter additional questions or conditions/
const TIMEOUT = { timeout: 60_000 }

interface TurnResult {
  purpose?: string
  chips: string[]
  candidateCount: number
  text: string
  sessionState: Record<string, unknown> | null
  recommendation: Record<string, unknown> | null
}

/** 한국어 intake 양식을 채우고 추천 시작. API 응답 캡처 후 반환. */
async function startRecommendation(page: Page, opts: {
  material: string
  diameter: string
  operation?: string
  toolType?: string
}): Promise<TurnResult> {
  await page.goto("/products")
  await page.waitForLoadState("networkidle")

  // 한국어 모드 — 기본 유지 (이미 한국어)
  const sections = page.locator("div.bg-white.rounded-2xl.border.border-gray-200.p-4.space-y-3")

  // 1. 목적 — 신규 제품 추천
  await sections.nth(0).getByRole("button").first().click()

  // 2. 소재
  const materialBtn = sections.nth(1).getByRole("button", { name: new RegExp(opts.material, "i") })
  await materialBtn.click()

  // 3. 가공 방법
  if (opts.operation) {
    const opBtn = sections.nth(2).getByRole("button", { name: new RegExp(opts.operation, "i") })
    await opBtn.click()
  } else {
    await sections.nth(2).getByRole("button").first().click()
  }

  // 4. 공구 타입
  if (opts.toolType) {
    const toolBtn = sections.nth(3).getByRole("button", { name: new RegExp(opts.toolType, "i") })
    await toolBtn.click()
  } else {
    await sections.nth(3).getByRole("button").first().click()
  }

  // 5. 직경
  const diaBtn = sections.nth(4).getByRole("button", { name: new RegExp(opts.diameter) })
  await diaBtn.click()

  // 6. 국가 — 첫 번째 선택
  await sections.nth(5).locator("button").first().click()

  // 조건 확인 → 추천 시작
  const reviewBtn = page.getByRole("button", { name: /조건 확인|Review Conditions/ })
  await expect(reviewBtn).toBeEnabled()
  await reviewBtn.click()

  return captureRecommendResponse(page, async () => {
    await page.getByRole("button", { name: /추천 시작|Start Recommendation/ }).click()
  })
}

/** 채팅 메시지 전송 + API 응답 캡처 */
async function sendChat(page: Page, message: string): Promise<TurnResult> {
  const input = page.getByPlaceholder(CHAT_INPUT)
  await expect(input).toBeVisible(TIMEOUT)
  await expect(input).toBeEnabled(TIMEOUT)
  await input.fill(message)

  return captureRecommendResponse(page, async () => {
    await input.press("Enter")
  })
}

/** /api/recommend 응답 캡처 */
async function captureRecommendResponse(page: Page, trigger: () => Promise<void>): Promise<TurnResult> {
  const responsePromise = page.waitForResponse(
    res => res.url().includes("/api/recommend") && res.request().method() === "POST",
    TIMEOUT,
  )
  await trigger()
  const response = await responsePromise
  const data = await response.json()

  // 입력 다시 활성화될 때까지 대기
  await expect(page.getByPlaceholder(CHAT_INPUT)).toBeEnabled(TIMEOUT)

  return {
    purpose: data.purpose,
    chips: data.chips ?? [],
    candidateCount: data.sessionState?.candidateCount ?? 0,
    text: data.text ?? "",
    sessionState: data.sessionState ?? null,
    recommendation: data.recommendation ?? null,
  }
}

/** UI에 AI 메시지가 렌더링됐는지 확인 */
async function expectAiMessage(page: Page, pattern: RegExp | string) {
  const regex = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : pattern
  const messages = page.locator(".markdown-content, .whitespace-pre-wrap")
  await expect(messages.last()).toContainText(regex, TIMEOUT)
}

/** 칩이 UI에 렌더링됐는지 확인 */
async function expectChipsVisible(page: Page, minCount: number) {
  const chips = page.locator("button.rounded-full")
  await expect(chips.first()).toBeVisible(TIMEOUT)
  const count = await chips.count()
  expect(count).toBeGreaterThanOrEqual(minCount)
}

/** 한글자 칩이 없는지 확인 */
async function expectNoSingleCharChips(page: Page) {
  const chips = page.locator("button.rounded-full")
  const count = await chips.count()
  for (let i = 0; i < count; i++) {
    const text = await chips.nth(i).textContent()
    if (text && text.trim().length <= 1) {
      throw new Error(`Single-char chip detected: "${text}" at index ${i}`)
    }
  }
}

/** 후보 카드가 오른쪽 패널에 표시되는지 확인 */
async function expectCandidateCards(page: Page, minCount: number) {
  // 후보 패널은 lg 브라우저에서 보임
  const cards = page.locator("[class*='font-mono'][class*='font-bold'][class*='text-gray-900']")
  if (minCount > 0) {
    await expect(cards.first()).toBeVisible(TIMEOUT)
  }
  const count = await cards.count()
  expect(count).toBeGreaterThanOrEqual(minCount)
}

/** session state 검증 */
function expectValidSession(result: TurnResult, checks: {
  hasCandidates?: boolean
  hasFilters?: boolean
  resolvedMaterial?: RegExp
  resolvedDiameter?: number
  mode?: string
}) {
  const ss = result.sessionState as Record<string, unknown> | null
  expect(ss).toBeTruthy()
  if (!ss) return

  if (checks.hasCandidates) {
    expect(ss.candidateCount as number).toBeGreaterThan(0)
  }
  if (checks.hasFilters) {
    expect(Array.isArray(ss.appliedFilters) && (ss.appliedFilters as unknown[]).length > 0).toBeTruthy()
  }
  if (checks.resolvedMaterial) {
    const ri = ss.resolvedInput as Record<string, unknown> | undefined
    expect(String(ri?.material ?? "")).toMatch(checks.resolvedMaterial)
  }
  if (checks.resolvedDiameter) {
    const ri = ss.resolvedInput as Record<string, unknown> | undefined
    expect(ri?.diameterMm).toBe(checks.resolvedDiameter)
  }
  if (checks.mode) {
    expect(ss.currentMode).toBe(checks.mode)
  }
}

// ═══════════════════════════════════════════════════════════
// Test Scenarios
// ═══════════════════════════════════════════════════════════

test.describe("A. 기본 멀티턴 플로우 + UI 검증", () => {
  test("A1: 탄소강 10mm → Square → 4날 → 코팅 → 추천 (풀 플로우)", async ({ page }) => {
    test.setTimeout(180_000)

    // 1. 추천 시작
    const t1 = await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    expect(t1.chips.length).toBeGreaterThan(0)
    await expectChipsVisible(page, 2)

    // 2. Square 선택
    const t2 = await sendChat(page, "Square")
    await expectAiMessage(page, /날|flute|선택/i)
    await expectNoSingleCharChips(page)
    expectValidSession(t2, { resolvedMaterial: /탄소강|carbon/i, resolvedDiameter: 10 })

    // 3. 4날 선택
    const t3 = await sendChat(page, "4날")
    await expectChipsVisible(page, 2)
    await expectNoSingleCharChips(page)

    // 4. 코팅 skip
    const t4 = await sendChat(page, "상관없음")
    await expectNoSingleCharChips(page)

    // session state 유지 확인
    expectValidSession(t4, {
      hasCandidates: true,
      hasFilters: true,
      resolvedMaterial: /탄소강|carbon/i,
      resolvedDiameter: 10,
    })

    // 후보 카드 패널 확인 (추천 결과 있으면)
    if (t4.candidateCount > 0) {
      await expectCandidateCards(page, 1)
    }
  })

  test("A2: 알루미늄 4mm → Ball → 2날 → 추천 결과 검증", async ({ page }) => {
    test.setTimeout(180_000)

    const t1 = await startRecommendation(page, { material: "알루미늄", diameter: "4mm" })
    const t2 = await sendChat(page, "Ball")
    const t3 = await sendChat(page, "2날")
    const t4 = await sendChat(page, "상관없음")

    // 추천 결과에 recommendation 객체가 있어야 함
    if (t4.recommendation) {
      expect(t4.purpose).toBe("recommendation")
    }

    // resolvedInput 유지
    expectValidSession(t4, {
      resolvedMaterial: /알루미늄|aluminum|non.?ferrous/i,
      resolvedDiameter: 4,
      hasCandidates: true,
    })
  })

  test("A3: 스테인리스 8mm → 상관없음 x3 → 빠른 추천", async ({ page }) => {
    test.setTimeout(180_000)

    const t1 = await startRecommendation(page, { material: "스테인리스", diameter: "8mm" })
    const t2 = await sendChat(page, "상관없음")
    const t3 = await sendChat(page, "상관없음")
    const t4 = await sendChat(page, "상관없음")

    expectValidSession(t4, { hasCandidates: true })
    await expectNoSingleCharChips(page)
  })
})

test.describe("B. Revision + 필터 교체 UI 검증", () => {
  test("B1: Square → Ball로 변경 — 칩/상태/카드 검증", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    const t3 = await sendChat(page, "4날")
    expect(t3.candidateCount).toBeGreaterThan(0)

    // revision: Ball로 변경
    const t4 = await sendChat(page, "Ball로 바꿔주세요")
    await expectNoSingleCharChips(page)
    await expectAiMessage(page, /Ball|변경|바꿔/i)

    // session state에 toolSubtype 필터가 Ball로 변경됐는지
    const filters = (t4.sessionState?.appliedFilters ?? []) as Array<{ field: string; value: string }>
    const subtypeFilter = filters.find(f => f.field === "toolSubtype")
    if (subtypeFilter) {
      expect(subtypeFilter.value).toMatch(/Ball/i)
    }
  })

  test("B2: 4날 → 2날 변경 — 후보 수 변화", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    const t3 = await sendChat(page, "4날")
    const before = t3.candidateCount

    const t4 = await sendChat(page, "2날로 변경해주세요")
    await expectNoSingleCharChips(page)

    // 후보 수가 변해야 함 (4날 → 2날)
    expect(t4.candidateCount).not.toBe(before)
    expectValidSession(t4, { hasCandidates: true })
  })

  test("B3: 코팅 변경 TiAlN → DLC", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "알루미늄", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "2날")
    await sendChat(page, "TiAlN")

    const t5 = await sendChat(page, "TiAlN 말고 DLC로 변경해주세요")
    await expectNoSingleCharChips(page)
    expectValidSession(t5, { hasCandidates: true, hasFilters: true })
  })

  test("B4: 직경 변경 10mm → 8mm", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")

    const t3 = await sendChat(page, "직경 8mm로 바꿔줘")
    await expectNoSingleCharChips(page)

    const ri = t3.sessionState?.resolvedInput as Record<string, unknown> | undefined
    // 직경이 변경되거나 필터에 반영
    if (ri?.diameterMm) {
      expect(ri.diameterMm).toBe(8)
    }
  })

  test("B5: 소재 변경 알루미늄 → 주철", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "알루미늄", diameter: "10mm" })
    await sendChat(page, "Square")

    const t3 = await sendChat(page, "소재를 주철로 변경해줘")
    await expectNoSingleCharChips(page)
    expectValidSession(t3, { hasCandidates: true })
  })
})

test.describe("C. Side Question + 상태 보존", () => {
  test("C1: 코팅 질문 → 답변 → 원래 질문 복귀", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    const t2 = await sendChat(page, "Square")
    const beforeCount = t2.candidateCount

    // side question
    const t3 = await sendChat(page, "코팅이 뭐야?")
    await expectAiMessage(page, /코팅|coating/i)
    await expectNoSingleCharChips(page)

    // 후보 수 보존
    expect(t3.candidateCount).toBe(beforeCount)

    // 원래 흐름 복귀
    const t4 = await sendChat(page, "4날")
    expectValidSession(t4, { hasCandidates: true })
  })

  test("C2: YG-1 회사 질문 → 필터 보존", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "4날")

    const t4 = await sendChat(page, "YG-1이 어떤 회사야?")
    await expectNoSingleCharChips(page)

    // 필터 유지
    const filters = (t4.sessionState?.appliedFilters ?? []) as Array<{ field: string }>
    expect(filters.length).toBeGreaterThan(0)
  })

  test("C3: 가격/납기 질문 → hallucination 없음", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")

    const t3 = await sendChat(page, "가격 얼마야?")
    const forbidden = ["원", "달러", "USD", "KRW", "만원"]
    for (const word of forbidden) {
      expect(t3.text).not.toContain(word)
    }

    const t4 = await sendChat(page, "납기일 알려줘")
    const forbiddenDelivery = ["영업일", "일 소요", "주 소요", "배송"]
    for (const word of forbiddenDelivery) {
      expect(t4.text).not.toContain(word)
    }
  })
})

test.describe("D. 비교 + 상세 분석", () => {
  test("D1: 추천 후 1번 2번 비교", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "4날")
    await sendChat(page, "상관없음")

    const t5 = await sendChat(page, "1번이랑 2번 비교해줘")
    await expectAiMessage(page, /비교|compare/i)
    await expectNoSingleCharChips(page)
  })

  test("D2: 추천 후 절삭조건 질문", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "4날")
    await sendChat(page, "상관없음")

    const t5 = await sendChat(page, "절삭조건 알려줘")
    await expectNoSingleCharChips(page)
    // 절삭조건 관련 키워드 확인
    await expectAiMessage(page, /절삭|cutting|속도|이송|rpm/i)
  })
})

test.describe("E. 스트레스 — 7턴+ 풀 플로우", () => {
  test("E1: 추천→비교→revision→재추천 (7턴)", async ({ page }) => {
    test.setTimeout(300_000)

    // Turn 1-4: 기본 추천
    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "4날")
    const t4 = await sendChat(page, "상관없음")
    expectValidSession(t4, { hasCandidates: true })

    // Turn 5: 비교
    const t5 = await sendChat(page, "1번이랑 2번 비교해줘")
    await expectNoSingleCharChips(page)

    // Turn 6: revision
    const t6 = await sendChat(page, "Ball로 바꿔줘")
    await expectNoSingleCharChips(page)
    expectValidSession(t6, { hasCandidates: true })

    // Turn 7: 재추천
    const t7 = await sendChat(page, "추천해줘")
    await expectNoSingleCharChips(page)
  })

  test("E2: 10턴 극한 스트레스 (추천→side question→revision→비교→재추천)", async ({ page }) => {
    test.setTimeout(600_000)

    // 기본 플로우
    await startRecommendation(page, { material: "스테인리스", diameter: "10mm" })
    await sendChat(page, "Square")
    await sendChat(page, "4날")
    await sendChat(page, "상관없음")

    // side question
    await sendChat(page, "이 코팅의 특징이 뭐야?")

    // revision
    const t6 = await sendChat(page, "Ball로 바꿔줘")
    await expectNoSingleCharChips(page)

    // 다시 narrowing
    await sendChat(page, "2날")
    await sendChat(page, "상관없음")

    // 비교
    const t9 = await sendChat(page, "상위 3개 비교해줘")
    await expectNoSingleCharChips(page)

    // 최종 추천
    const t10 = await sendChat(page, "1번으로 해줘")
    await expectNoSingleCharChips(page)
    expectValidSession(t10, { hasCandidates: true })
  })
})

test.describe("F. UI 상태 뱃지 + 사이드바 검증", () => {
  test("F1: resolution 상태 변화 (탐색→축소→매칭)", async ({ page }) => {
    test.setTimeout(180_000)

    const t1 = await startRecommendation(page, { material: "탄소강", diameter: "10mm" })

    // 초기: broad or narrowing
    const status1 = t1.sessionState?.resolutionStatus as string
    expect(["broad", "narrowing"]).toContain(status1)

    await sendChat(page, "Square")
    await sendChat(page, "4날")
    const t4 = await sendChat(page, "상관없음")

    // 추천 후: resolved
    if (t4.purpose === "recommendation") {
      const status4 = t4.sessionState?.resolutionStatus as string
      expect(status4).toMatch(/resolved/)
    }
  })

  test("F2: appliedFilters 누적 확인", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })

    const t2 = await sendChat(page, "Square")
    const filters2 = (t2.sessionState?.appliedFilters ?? []) as unknown[]
    const filterCount2 = filters2.length

    const t3 = await sendChat(page, "4날")
    const filters3 = (t3.sessionState?.appliedFilters ?? []) as unknown[]
    // 필터 수가 늘어나야 함
    expect(filters3.length).toBeGreaterThanOrEqual(filterCount2)

    const t4 = await sendChat(page, "TiAlN")
    const filters4 = (t4.sessionState?.appliedFilters ?? []) as unknown[]
    expect(filters4.length).toBeGreaterThanOrEqual(filters3.length)
  })

  test("F3: candidateCount 감소 확인 (narrowing)", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })

    const t2 = await sendChat(page, "Square")
    const count2 = t2.candidateCount

    const t3 = await sendChat(page, "4날")
    const count3 = t3.candidateCount

    // 필터 적용 시 후보 수 감소 (또는 유지)
    if (count2 > 0 && count3 > 0) {
      expect(count3).toBeLessThanOrEqual(count2)
    }
  })
})

test.describe("G. Edge Cases + 방어", () => {
  test("G1: 영어 입력 → 정상 처리", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    const t2 = await sendChat(page, "Square endmill please")
    await expectNoSingleCharChips(page)
    expectValidSession(t2, { hasCandidates: true })
  })

  test("G2: 의미없는 입력 → 에러 없이 복구", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    const t2 = await sendChat(page, "asdfghjkl")
    // 에러 없이 응답
    expect(t2.text).toBeTruthy()
    await expectNoSingleCharChips(page)

    // 정상 입력으로 복구
    const t3 = await sendChat(page, "Square")
    expectValidSession(t3, { hasCandidates: true })
  })

  test("G3: 모순 입력 → 에러 없이 처리", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    const t2 = await sendChat(page, "Square이면서 Ball인 엔드밀")
    await expectNoSingleCharChips(page)
    expect(t2.text).toBeTruthy()
  })

  test("G4: 같은 답 연속 입력", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "Square")
    const t3 = await sendChat(page, "Square")
    await expectNoSingleCharChips(page)
    expect(t3.text).toBeTruthy()
  })

  test("G5: 경쟁사 제품 대체 추천", async ({ page }) => {
    test.setTimeout(180_000)

    const t1 = await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    const t2 = await sendChat(page, "OSG AE-VMS 대체품 추천해줘")
    await expectNoSingleCharChips(page)
    expect(t2.text).toBeTruthy()
  })
})

test.describe("H. 위임 표현 + Skip 연속", () => {
  test("H1: 아무거나 / 알아서 / 패스", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "탄소강", diameter: "10mm" })
    await sendChat(page, "아무거나")
    await sendChat(page, "알아서 해줘")
    const t4 = await sendChat(page, "패스")

    await expectNoSingleCharChips(page)
    expectValidSession(t4, { hasCandidates: true })
  })

  test("H2: 모르겠어요 연속", async ({ page }) => {
    test.setTimeout(180_000)

    await startRecommendation(page, { material: "알루미늄", diameter: "10mm" })
    await sendChat(page, "모르겠어요")
    await sendChat(page, "모르겠어요")
    const t4 = await sendChat(page, "모르겠어요")

    await expectNoSingleCharChips(page)
    expectValidSession(t4, { hasCandidates: true })
  })
})
