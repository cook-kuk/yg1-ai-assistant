import { test, expect } from "@playwright/test"

test.describe("YG-1 Simulator v3 스모크", () => {
  test("페이지 로드 + 핵심 요소 렌더", async ({ page }) => {
    await page.goto("/simulator_v2")
    await expect(page).toHaveTitle(/YG-1/)
    await expect(page.getByText("가공조건 시뮬레이터")).toBeVisible()
    await expect(page.getByText("Director-Ready")).toBeVisible()
    await expect(page.getByText("Harvey MAP")).toBeVisible()
    await expect(page.getByText("YG-1 Original")).toBeVisible()
  })

  test("비주얼 토글 스트립 존재", async ({ page }) => {
    await page.goto("/simulator_v2")
    await expect(page.getByText("🎬 실시간 절삭")).toBeVisible()
    await expect(page.getByText("🔄 3D 엔드밀")).toBeVisible()
    await expect(page.getByText("📐 도면")).toBeVisible()
    await expect(page.getByText("💰 Break-Even")).toBeVisible()
  })

  test("모드 토글 (초보→전문가→교육)", async ({ page }) => {
    await page.goto("/simulator_v2")
    await page.getByRole("button", { name: /전문가/ }).click()
    await page.getByRole("button", { name: /교육/ }).click()
    await page.getByRole("button", { name: /초보/ }).click()
  })

  test("용어사전 페이지", async ({ page }) => {
    await page.goto("/simulator_v2/glossary")
    await expect(page.getByText(/CNC 용어 사전/)).toBeVisible()
  })

  test("파라미터 슬라이더 존재", async ({ page }) => {
    await page.goto("/simulator_v2")
    await expect(page.getByText("Stick Out L")).toBeVisible()
    await expect(page.getByText("Vc (절삭속도)")).toBeVisible()
    await expect(page.getByText("fz (날당이송)")).toBeVisible()
  })
})
