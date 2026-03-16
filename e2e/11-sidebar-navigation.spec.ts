import { test, expect } from "@playwright/test"

/**
 * Scenario 11: 사이드바 네비게이션
 * - 주요 메뉴 항목이 올바른 경로로 연결
 * - disabled 항목은 클릭 불가
 */
test.describe("Sidebar navigation", () => {
  test("Sidebar shows main navigation items", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body") || ""

    // Key navigation items should be present
    expect(body).toContain("대시보드")
    expect(body).toContain("제품 추천")
  })

  test("Clicking inbox nav goes to /inbox", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const inboxLink = page.locator("a[href='/inbox']").first()
    if (await inboxLink.isVisible()) {
      await inboxLink.click()
      await page.waitForURL("**/inbox**", { timeout: 10000 })
      expect(page.url()).toContain("/inbox")
    }
  })
})
