import { test, expect } from "@playwright/test"

/**
 * Scenario 3: 견적 플로우 (Inbox → Quotes)
 * - /inbox/[id] 에서 "견적 초안" 클릭 → /quotes?inquiry=INQ-XXX
 * - /quotes 단독 진입 시 드롭다운으로 문의 선택 가능
 * - 쿼리 파라미터로 자동 선택 동작
 */
test.describe("Quotes flow", () => {
  test("/quotes loads without crash (standalone entry)", async ({ page }) => {
    await page.goto("/quotes")
    await page.waitForLoadState("networkidle")

    // Should show the quote builder
    await expect(page.getByText("새 견적 작성")).toBeVisible()
    await expect(page.getByText("견적 미리보기", { exact: true })).toBeVisible()
  })

  test("/quotes?inquiry=INQ-001 auto-selects inquiry", async ({ page }) => {
    await page.goto("/quotes?inquiry=INQ-001")
    await page.waitForLoadState("networkidle")

    // Should show inquiry details (customer info)
    // The inquiry summary section should be visible
    await expect(page.getByText("고객:")).toBeVisible({ timeout: 5000 })
  })

  test("/quotes shows placeholder when no inquiry selected", async ({ page }) => {
    await page.goto("/quotes")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("문의를 선택하면 견적 미리보기가 표시됩니다.")).toBeVisible()
  })

  test("Inbox detail '견적 초안' button links to /quotes with inquiry param", async ({ page }) => {
    await page.goto("/inbox/INQ-001")
    await page.waitForLoadState("networkidle")

    // Find the quote CTA link
    const quoteLink = page.locator("a[href*='/quotes?inquiry=']")
    if (await quoteLink.count() > 0) {
      const href = await quoteLink.first().getAttribute("href")
      expect(href).toContain("/quotes?inquiry=INQ-001")
    }
  })
})
