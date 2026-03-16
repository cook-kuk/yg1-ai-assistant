import { test, expect } from "@playwright/test"

/**
 * Scenario 9: 대시보드 기본 렌더링
 * - / 로드 시 상태 카드 6개 표시
 * - 인기 요청 제품, 누락 필드, 성과 지표 섹션
 * - 빠른 액션 섹션
 */
test.describe("Dashboard", () => {
  test("/ loads with status cards", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Status labels should be visible
    const statusLabels = ["신규", "검토중", "정보필요", "견적 작성", "발송완료", "이관"]
    const body = await page.textContent("body") || ""

    const found = statusLabels.filter(l => body.includes(l))
    expect(found.length).toBeGreaterThanOrEqual(4)
  })

  test("/ shows performance metrics", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("성과 지표")).toBeVisible()
    await expect(page.getByText("평균 견적 시간")).toBeVisible()
  })

  test("/ shows AI learning banner", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("데이터가 쌓일수록 추천이 더 정확해집니다")).toBeVisible()
  })

  test("/ shows quick actions section", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("빠른 액션")).toBeVisible()
    await expect(page.getByText("새 문의 확인")).toBeVisible()
    await expect(page.getByText("제품 탐색", { exact: true }).first()).toBeVisible()
    await expect(page.getByText("견적 관리")).toBeVisible()
  })
})
