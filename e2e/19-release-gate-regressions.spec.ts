import { expect, test } from "@playwright/test"

test.describe("Release gate regressions", () => {
  test("/feedback stays accessible without admin gating", async ({ page }) => {
    await page.goto("/feedback")
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible()
    await expect(page.getByRole("button", { name: "돌아가기" })).toBeVisible()
  })

  test("sidebar keeps /products labeled as 제품 추천", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const productNav = page.locator("nav").first().locator("a[href='/products']").first()
    await expect(productNav).toContainText("제품 추천")
  })
})
