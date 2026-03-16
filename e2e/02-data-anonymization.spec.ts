import { test, expect } from "@playwright/test"

/**
 * Scenario 2: 민감 데이터 익명화 검증
 * - /inbox에 실제 기업명/인명이 노출되지 않아야 함
 * - DEMO 접두어가 붙은 익명화 데이터만 표시
 */

const REAL_NAMES = [
  "김철수", "삼성전자",
  "박영희", "현대자동차",
  "이준호", "SK하이닉스",
  "정민수", "LG디스플레이",
  "최지영", "두산인프라코어",
  "John Smith", "Boeing",
  "田中太郎", "Toyota",
  "王明", "BYD",
  "Hans Mueller", "BMW",
  "김영수", "POSCO",
  "Pierre Dubois", "Airbus",
  "이서연", "한화에어로스페이스",
]

const DEMO_PATTERNS = [
  "DEMO반도체", "DEMO자동차", "DEMO전자부품",
  "DEMO디스플레이", "DEMO중공업", "DEMO Aerospace",
  "데모-A", "데모-B", "데모-C",
]

test.describe("Data anonymization", () => {
  test("/inbox should NOT contain real company/person names", async ({ page }) => {
    await page.goto("/inbox")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body")

    for (const name of REAL_NAMES) {
      expect(body, `Found real name: ${name}`).not.toContain(name)
    }
  })

  test("/inbox should contain anonymized DEMO names", async ({ page }) => {
    await page.goto("/inbox")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body")

    // At least some DEMO patterns should be visible
    const found = DEMO_PATTERNS.filter(p => body?.includes(p))
    expect(found.length).toBeGreaterThan(0)
  })

  test("Dashboard should not leak real names either", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body")
    for (const name of REAL_NAMES) {
      expect(body, `Dashboard leaked: ${name}`).not.toContain(name)
    }
  })
})
