import { test, expect } from "@playwright/test"

/**
 * Scenario 4: 제품 탐색 페이지 렌더링
 * - /products 로드 및 기본 UI 확인
 * - 준비 중 항목이 disabled 상태인지 확인
 */
test.describe("Products page", () => {
  test("/products loads successfully", async ({ page }) => {
    await page.goto("/products")
    await page.waitForLoadState("networkidle")

    // Page should render without a visible 404 error
    const notFoundHeading = page.locator("h1:has-text('404')")
    await expect(notFoundHeading).toBeHidden()

    // Should show the products page content
    const heading = page.locator("h1, h2").first()
    await expect(heading).toBeVisible()
  })

  test("/products shows main heading", async ({ page }) => {
    await page.goto("/products")
    await page.waitForLoadState("networkidle")

    // The product exploration page should have a heading
    const heading = page.locator("h1, h2").first()
    await expect(heading).toBeVisible()
  })

  test("/products shows reference-style tool and material selectors", async ({ page }) => {
    await page.goto("/products")
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("button", { name: /Holemaking.*Process/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /Threading.*Process/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /Milling.*Process/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /Turning.*Process/i })).toBeVisible()

    await expect(page.locator("text=/\\bP\\b/").first()).toBeVisible()
    await expect(page.locator("text=/\\bM\\b/").first()).toBeVisible()
    await expect(page.locator("text=/\\bK\\b/").first()).toBeVisible()
    await expect(page.locator("text=/\\bN\\b/").first()).toBeVisible()
    await expect(page.locator("text=/\\bS\\b/").first()).toBeVisible()
    await expect(page.locator("text=/\\bH\\b/").first()).toBeVisible()
  })
})
