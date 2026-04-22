import { test, expect } from "@playwright/test"

test.describe("Machine Impact Lab 스모크", () => {
  test("탭 진입 시 잠긴 배너 + KPI 4-카드가 즉시 렌더된다", async ({ page }) => {
    await page.goto("/simulator_v2")

    await page.getByRole("button", { name: /Machine Impact Lab/ }).click()

    await expect(page.getByText("고정 (Locked)")).toBeVisible()

    const kpiLabels = ["RPM", "MRR", "Tool Life", "Chatter"]
    for (const label of kpiLabels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }

    await expect(page.getByText("한계 체크 (Limit Check)")).toBeVisible()
    await expect(page.getByText("계산 흐름 (Calculation Flow)")).toBeVisible()
    await expect(page.getByText("머신 설정 (Machine Config)")).toBeVisible()
    await expect(page.getByText("시나리오 비교 (Scenario Compare)")).toBeVisible()
  })

  test("DISASTER 프리셋 로드 → HIGH 채터 + 다수 경고가 가시화된다", async ({ page }) => {
    await page.goto("/simulator_v2")
    await page.getByRole("button", { name: /Machine Impact Lab/ }).click()

    // MachineConfigPanel 의 "최악 조합" 칩 클릭
    await page.getByRole("button", { name: /🔥 최악 조합/ }).first().click()

    // KPI strip 내 chatter 카드가 HIGH 로 뜨는지
    await expect(page.getByText("HIGH", { exact: true }).first()).toBeVisible()

    // 한계 체크 패널에 경고 3개 이상 존재 (ld / workholding-loose / low-mrr / chatter 중 최소 3)
    const limitRows = page.locator("section:has-text('한계 체크') li")
    await expect(limitRows).toHaveCount(await limitRows.count())
    expect(await limitRows.count()).toBeGreaterThanOrEqual(3)
  })

  test("시나리오 비교 표가 6개 행을 모두 보여준다", async ({ page }) => {
    await page.goto("/simulator_v2")
    await page.getByRole("button", { name: /Machine Impact Lab/ }).click()

    const table = page.locator("section:has-text('시나리오 비교') table")
    await expect(table).toBeVisible()
    await expect(table.locator("tbody tr")).toHaveCount(6)
    await expect(table.getByText("⚡ BASELINE (PDF 권장)")).toBeVisible()
    await expect(table.getByText("🔥 최악 조합")).toBeVisible()
  })

  test("프리미엄 프리셋 Load 버튼 → MRR 배지 vs BASE 가 +로 뜬다", async ({ page }) => {
    await page.goto("/simulator_v2")
    await page.getByRole("button", { name: /Machine Impact Lab/ }).click()

    const premiumRow = page.locator("section:has-text('시나리오 비교') tr", {
      hasText: "💎 프리미엄",
    })
    await premiumRow.getByRole("button", { name: "Load" }).click()

    // 라이브 KPI 스트립의 MRR 카드에 "+N% vs BASE" 배지가 나타나야 함
    const mrrCard = page.locator("div").filter({ hasText: /^MRR/ }).first()
    await expect(mrrCard.getByText(/\+\d+% vs BASE/)).toBeVisible()
  })
})
