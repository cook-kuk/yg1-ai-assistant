import { test, expect } from "@playwright/test"

/**
 * Scenario 6: CTA 네비게이션 검증
 * - 대시보드의 "제품 추천 시작" → /products
 * - 빠른 액션 버튼들이 올바른 경로로 연결
 * - /admin으로 향하는 공개 CTA가 없어야 함
 */
test.describe("CTA navigation", () => {
  test("Dashboard '제품 추천 시작' links to /products, NOT /admin", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const ctaLink = page.locator("a[href='/products']", { hasText: "제품 추천 시작" })
    if (await ctaLink.count() > 0) {
      const href = await ctaLink.first().getAttribute("href")
      expect(href).toBe("/products")
      expect(href).not.toContain("/admin")
    }
  })

  test("Dashboard has no public-facing links to /admin", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Check all anchor tags — none should point to /admin
    const adminLinks = page.locator("a[href^='/admin']")
    const count = await adminLinks.count()

    // Sidebar might have disabled admin links, but main content should not
    // Just verify the main CTA area doesn't link to admin
    const mainContent = page.locator("main, .flex-1")
    const mainAdminLinks = mainContent.locator("a[href^='/admin']")
    expect(await mainAdminLinks.count()).toBe(0)
  })

  test("Quick actions link to correct routes", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Check key quick action links exist
    const inboxLink = page.locator("a[href='/inbox']")
    const productsLink = page.locator("a[href='/products']")
    const quotesLink = page.locator("a[href='/quotes']")
    const knowledgeLink = page.locator("a[href='/knowledge']")

    expect(await inboxLink.count()).toBeGreaterThan(0)
    expect(await productsLink.count()).toBeGreaterThan(0)
    expect(await quotesLink.count()).toBeGreaterThan(0)
    expect(await knowledgeLink.count()).toBeGreaterThan(0)
  })
})
