import { expect, test } from "@playwright/test"

import {
  escapeRegex,
  FULL_REASONING_RE,
  installReasoningScenarioStreamRoute,
  REASONING_TOGGLE_RE,
  startReasoningRecommendationHarness,
} from "./reasoning-visibility-helpers"

  test.describe("YG-1 recommendation reasoning visibility", () => {
  test.setTimeout(120_000)

  test("FAST representative sentence keeps reasoning UI hidden", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)
    try {
      await installReasoningScenarioStreamRoute(page, {
        prompt: "10mm 이상",
        finalText: "10mm 이상 조건을 바로 적용했습니다.",
        reasoningVisibility: "hidden",
      })

      const payload = await harness.sendChat("10mm 이상")

      expect(payload?.reasoningVisibility ?? null).toBe("hidden")
      expect(payload?.thinkingProcess ?? null).toBeNull()
      expect(payload?.thinkingDeep ?? null).toBeNull()
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toHaveCount(0)
      await expect(page.getByText(FULL_REASONING_RE)).toHaveCount(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("NORMAL representative sentence renders only simple reasoning", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)
    const stageTrace = "NORMAL ROUTE STAGE TRACE"

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
      expect(payload?.thinkingProcess ?? "").toContain(stageTrace)
      expect(payload?.thinkingDeep ?? null).toBeNull()
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(stageTrace)))).toBeVisible()
      await expect(page.getByText(FULL_REASONING_RE)).toHaveCount(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("DEEP representative sentence renders stage and full reasoning", async ({ page }, testInfo) => {
    const harness = await startReasoningRecommendationHarness(page, testInfo)
    const stageTrace = "DEEP ROUTE STAGE TRACE"
    const deepTrace = "DEEP ROUTE FULL TRACE"

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
      expect(payload?.thinkingProcess ?? "").toContain(stageTrace)
      expect(payload?.thinkingDeep ?? "").toContain(deepTrace)
      await expect(page.getByRole("button", { name: REASONING_TOGGLE_RE })).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(stageTrace)))).toBeVisible()
      await expect(page.getByText(new RegExp(escapeRegex(deepTrace)))).toBeVisible()
      await expect(page.getByText(FULL_REASONING_RE)).toBeVisible()
    } finally {
      await harness.attachFailureArtifacts()
    }
  })
})
