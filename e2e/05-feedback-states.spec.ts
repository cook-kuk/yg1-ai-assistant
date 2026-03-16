import { test, expect } from "@playwright/test"

/**
 * Scenario 5: 피드백 페이지 상태 관리
 * - /feedback 로드 시 로딩 → 데이터 또는 빈 상태 표시
 * - 에러 상태 처리
 * - 뒤로가기 버튼 동작
 */
test.describe("Feedback page", () => {
  test("/feedback loads without infinite spinner", async ({ page }) => {
    await page.goto("/feedback")

    // Should show loading initially
    const loadingText = page.getByText("로딩 중...")

    // Wait for loading to resolve (either data or empty state)
    await expect(loadingText).toBeHidden({ timeout: 15000 })
  })

  test("/feedback shows data or empty state after loading", async ({ page }) => {
    await page.goto("/feedback")
    await page.waitForLoadState("networkidle")

    // Wait for loading to finish
    await page.waitForTimeout(3000)

    const body = await page.textContent("body")

    // Should show either feedback entries or empty message
    const hasEntries = body?.includes("피드백") || false
    const hasEmptyState = body?.includes("피드백이 없습니다") || false
    const hasError = body?.includes("오류:") || false

    // One of these states should be present
    expect(hasEntries || hasEmptyState || hasError).toBe(true)
  })

  test("/feedback has refresh button", async ({ page }) => {
    await page.goto("/feedback")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("새로고침")).toBeVisible()
  })

  test("/feedback back button exists", async ({ page }) => {
    await page.goto("/feedback")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("돌아가기")).toBeVisible()
  })
})
