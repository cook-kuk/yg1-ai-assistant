import { test, expect } from "@playwright/test"

/**
 * Scenario 7: 다국어 데이터 픽스처 검증
 * - /inbox에 한국어, 영어, 일본어, 중국어, 독일어 문의 존재
 * - 모두 DEMO 접두어 익명화
 */
test.describe("Multilingual fixtures", () => {
  test("/inbox contains multilingual demo entries", async ({ page }) => {
    await page.goto("/inbox")
    await page.waitForLoadState("networkidle")

    const body = await page.textContent("body") || ""

    // Korean demo entries
    expect(body).toContain("데모-A")

    // Check for various DEMO company patterns (multilingual)
    const multilingualPatterns = [
      "DEMO반도체",       // Korean
      "DEMO Aerospace",  // English
      "DEMO自動車JP",     // Japanese
      "DEMO汽车CN",       // Chinese
      "DEMO Auto EU",    // German/European
    ]

    const found = multilingualPatterns.filter(p => body.includes(p))
    // At least 3 of these should be visible
    expect(found.length).toBeGreaterThanOrEqual(3)
  })
})
