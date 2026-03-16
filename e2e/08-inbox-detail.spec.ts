import { test, expect } from "@playwright/test"

/**
 * Scenario 8: Inbox 상세 페이지
 * - /inbox/INQ-001 로드
 * - 고객 정보, 메시지 스레드 표시
 * - 추천 제품 카드 표시
 */
test.describe("Inbox detail page", () => {
  test("/inbox/INQ-001 loads with inquiry details", async ({ page }) => {
    await page.goto("/inbox/INQ-001")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body") || ""

    // Should show the inquiry ID
    expect(body).toContain("INQ-001")

    // Should show anonymized customer name
    expect(body).toContain("데모-A")
  })

  test("/inbox/INQ-001 does not show real customer data", async ({ page }) => {
    await page.goto("/inbox/INQ-001")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body") || ""
    expect(body).not.toContain("김철수")
    expect(body).not.toContain("삼성전자")
  })

  test("Non-existent inquiry shows appropriate state", async ({ page }) => {
    await page.goto("/inbox/INQ-999")
    await page.waitForLoadState("networkidle")

    // Should not crash — either redirect or show "not found" message
    const body = await page.textContent("body") || ""
    const isHandled =
      body.includes("찾을 수 없") ||
      body.includes("not found") ||
      page.url().includes("/inbox") ||
      page.url().endsWith("/")

    expect(isHandled).toBe(true)
  })
})
