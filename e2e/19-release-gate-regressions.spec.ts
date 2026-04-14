import { expect, test } from "@playwright/test"

import {
  escapeRegex,
  FULL_REASONING_RE,
  installReasoningScenarioStreamRoute,
  REASONING_TOGGLE_RE,
  startReasoningRecommendationHarness,
} from "./reasoning-visibility-helpers"

test.describe.configure({ mode: "serial" })

test.describe("Release gate regressions", () => {
  test.setTimeout(120_000)

  test("/feedback stays accessible without admin gating", async ({ page }) => {
    await page.goto("/feedback")
    await page.waitForLoadState("networkidle")

    await expect(page.getByRole("button", { name: /Back|돌아가기/ })).toBeVisible()
  })

  test("sidebar keeps /products labeled as product recommendation", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    const productNav = page.locator("nav").first().locator("a[href='/products']").first()
    await expect(productNav).toContainText(/제품 추천|Product Recommendation/i)
  })

  test("release gate: FAST reasoning stays hidden in the UI", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)

    try {
      await installReasoningScenarioStreamRoute(page, {
        prompt: "10mm 이상",
        finalText: "10mm 이상 조건을 바로 적용했습니다.",
        reasoningVisibility: "hidden",
      })

      const payload = await harness.sendChat("10mm 이상")

      expect(payload?.reasoningVisibility ?? null).toBe("hidden")
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toHaveCount(0)
      await expect(page.getByText(FULL_REASONING_RE)).toHaveCount(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("release gate: NORMAL reasoning shows only the simple trace", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)
    const stageTrace = "RELEASE GATE NORMAL TRACE"

    try {
      await installReasoningScenarioStreamRoute(page, {
        prompt: "4날 스퀘어 추천해줘",
        finalText: "4날 스퀘어 추천 조건으로 정리했습니다.",
        reasoningVisibility: "simple",
        stageFrames: [stageTrace],
        thinkingProcess: stageTrace,
      })

      const payload = await harness.sendChat("4날 스퀘어 추천해줘")

      expect(payload?.reasoningVisibility ?? null).toBe("simple")
      expect(payload?.thinkingDeep ?? null).toBeNull()
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(stageTrace)))).toBeVisible()
      await expect(page.getByText(FULL_REASONING_RE)).toHaveCount(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("release gate: DEEP reasoning exposes the full trace", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)
    const stageTrace = "RELEASE GATE DEEP STAGE TRACE"
    const deepTrace = "RELEASE GATE DEEP FULL TRACE"

    try {
      await installReasoningScenarioStreamRoute(page, {
        prompt: "티타늄 말고 뭐가 좋아?",
        finalText: "티타늄을 제외한 대안을 비교해 정리했습니다.",
        reasoningVisibility: "full",
        stageFrames: [stageTrace],
        deepFrames: [deepTrace],
        thinkingProcess: stageTrace,
        thinkingDeep: deepTrace,
      })

      const payload = await harness.sendChat("티타늄 말고 뭐가 좋아?")

      expect(payload?.reasoningVisibility ?? null).toBe("full")
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(stageTrace)))).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(deepTrace)))).toBeVisible()
      await expect(page.getByText(FULL_REASONING_RE)).toBeVisible()
    } finally {
      await harness.attachFailureArtifacts()
    }
  })
})
