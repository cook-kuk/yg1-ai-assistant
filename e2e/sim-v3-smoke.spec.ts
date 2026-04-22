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

  test("LIVE 상관관계 팝업 + 주요 파라미터 맵 고정", async ({ page }) => {
    await page.goto("/simulator_v2")

    const correlationTrigger = page.getByTestId("live-correlation-trigger")
    await expect(correlationTrigger).toBeVisible()
    await correlationTrigger.click()

    const correlationPopover = page.getByTestId("live-correlation-popover")
    await expect(correlationPopover).toBeVisible()
    await expect(correlationPopover.getByText("LIVE 상관관계 상세")).toBeVisible()
    await expect(correlationPopover.getByText(/Coolant/)).toBeVisible()
    await expect(correlationPopover.getByText(/Coating/)).toBeVisible()

    const parameterMap = page.getByTestId("primary-parameter-map")
    await expect(parameterMap).toBeVisible()
    await expect(parameterMap).toHaveCSS("position", "sticky")
    await expect(parameterMap.getByText("핵심 파라미터 맵")).toBeVisible()
  })

  test("실시간 검증 미리보기는 X로 닫히고 배지는 남음", async ({ page }) => {
    await page.goto("/simulator_v2")

    const maxRpmInput = page.locator("label", { hasText: "MAX RPM" }).locator("..").locator('input[type="number"]')
    await maxRpmInput.fill("1000")
    await maxRpmInput.dispatchEvent("change")

    const previewClose = page.getByLabel("경고 미리보기 닫기")
    await expect(previewClose).toBeVisible()
    await previewClose.click()
    await expect(previewClose).toBeHidden()

    await expect(page.getByRole("button", { name: /검증 경고/ })).toBeVisible()
  })

  test("YG-1 실 가공 영상 패널은 공식 연동 준비 상태만 보여줌", async ({ page }) => {
    await page.goto("/simulator_v2")

    await page.getByRole("button", { name: /가공영상/ }).click()

    const panel = page.getByTestId("yg1-video-panel")
    await expect(panel).toBeVisible()
    await expect(panel.getByText("공식 영상 연동 준비중")).toBeVisible()
    await expect(panel.locator("iframe")).toHaveCount(0)
  })

  test("Harvey 대체 시뮬레이션은 Harvey/Sandvik/YG-1 3분할과 보기 모드를 보여줌", async ({ page }) => {
    await page.goto("/simulator_v2")

    const dual = page.getByTestId("dual-replacement-sim")
    await expect(dual).toBeVisible()
    await expect(dual.getByText("A · Harvey 기준")).toBeVisible()
    await expect(dual.getByText("B · Sandvik 비교")).toBeVisible()
    await expect(dual.getByText("C · YG-1 대체품")).toBeVisible()
    await expect(dual.getByRole("button", { name: "날수 보기" })).toBeVisible()
    await expect(page.getByTestId("ab-visual-split")).toBeVisible()
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
