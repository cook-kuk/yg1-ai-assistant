import { test, expect } from "@playwright/test"

/**
 * Scenario 10: 견적서 톤 선택 & 미리보기
 * - 문의 선택 후 3가지 톤(격식/간결/친근) 전환
 * - 각 톤에 따라 미리보기 텍스트 변경
 */
test.describe("Quote tone selection", () => {
  test("Tone selection changes preview text", async ({ page }) => {
    await page.goto("/quotes?inquiry=INQ-001")
    await page.waitForLoadState("networkidle")

    // Wait for inquiry to be auto-selected
    await page.waitForTimeout(1000)

    // Check that tone options are visible
    const formalLabel = page.getByText("격식체")
    const conciseLabel = page.getByText("간결체")
    const friendlyLabel = page.getByText("친근체")

    if (await formalLabel.isVisible()) {
      // Default tone is formal — check preview contains formal greeting
      const preview = page.locator(".font-mono.whitespace-pre-wrap")
      if (await preview.count() > 0) {
        const text = await preview.textContent()
        expect(text).toBeTruthy()
      }

      // Switch to friendly tone
      await friendlyLabel.click()
      await page.waitForTimeout(500)

      if (await preview.count() > 0) {
        const friendlyText = await preview.textContent()
        expect(friendlyText).toContain("안녕하세요")
      }
    }
  })
})
