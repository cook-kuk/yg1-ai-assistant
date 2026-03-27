import { expect, test } from "@playwright/test"

import { RecommendationHarness } from "./recommendation-test-helpers"

test.describe("YG-1 recommendation state regressions", () => {
  test.setTimeout(120_000)

  test("full view clears focused series without dropping persisted artifacts", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")
      const focused = await harness.sendChat("E5D70")
      harness.expectMode("group_focus", focused)
      harness.expectActiveSeries("E5D70", focused)
      harness.expectDisplayedCount(2, focused)

      const fullView = await harness.sendChat("Full View")
      harness.expectMode("restore", fullView)
      harness.expectActiveSeries(null, fullView)
      harness.expectPersistedArtifacts(fullView)
      harness.expectNoSilentReset(fullView)
      harness.expectDisplayedCount(5, fullView)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("series switching remains deterministic across repeated focus changes", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")

      const e5d70 = await harness.sendChat("E5D70")
      harness.expectActiveSeries("E5D70", e5d70)
      harness.expectDisplayedCount(2, e5d70)

      const fullView = await harness.sendChat("Full View")
      harness.expectPersistedArtifacts(fullView)

      const menu = await harness.sendChat("Another Series")
      const nextSeries = harness.pickAnotherSeries(["E5D70"], menu)
      expect(nextSeries).toBeTruthy()

      const secondFocus = await harness.sendChat(nextSeries!)
      harness.expectMode("group_focus", secondFocus)
      harness.expectActiveSeries(nextSeries, secondFocus)
      harness.expectNoSilentReset(secondFocus)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("repeated recommendation requests are idempotent over persisted state", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      const first = await harness.sendChat("Recommend")
      const second = await harness.sendChat("Recommend")
      const third = await harness.sendChat("Recommend")

      for (const payload of [first, second, third]) {
        harness.expectPersistedArtifacts(payload)
        harness.expectNoSilentReset(payload)
        harness.expectMode("recommendation", payload)
      }

      expect(first?.sessionState?.displayedProducts?.map(c => c.displayCode)).toEqual(
        second?.sessionState?.displayedProducts?.map(c => c.displayCode),
      )
      expect(second?.sessionState?.displayedProducts?.map(c => c.displayCode)).toEqual(
        third?.sessionState?.displayedProducts?.map(c => c.displayCode),
      )
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("comparison artifact survives explanation and returns to table mode", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      const compare = await harness.sendChat("Compare Top 3")
      harness.expectMode("comparison", compare)
      expect(compare?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBe(3)

      const explanation = await harness.sendChat("Explain coating types")
      harness.expectMode("general_chat", explanation)
      harness.expectPersistedArtifacts(explanation)
      expect(explanation?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBe(3)

      const table = await harness.sendChat("table")
      harness.expectMode("comparison", table)
      expect(table?.text ?? "").toContain("| Code | Series | Coating | Stock |")
      expect(table?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBe(3)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("side chat does not break recommendation restoration", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")
      const focus = await harness.sendChat("EI880")
      harness.expectActiveSeries("EI880", focus)

      const sideChat = await harness.sendChat("lunch")
      harness.expectMode("general_chat", sideChat)
      expect(sideChat?.sessionState?.underlyingAction).toBe("show_recommendation")

      const restored = await harness.sendChat("Recommend")
      harness.expectMode("recommendation", restored)
      harness.expectPersistedArtifacts(restored)
      harness.expectNoSilentReset(restored)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("why no candidates response must never silently zero the session", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")
      await harness.sendChat("E5D70")
      const payload = await harness.sendChat("why no candidates")

      harness.expectMode("general_chat", payload)
      harness.expectPersistedArtifacts(payload)
      harness.expectNoSilentReset(payload)
      expect(payload?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("meta context question restores original diameter and material after detours", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Radius")
      await harness.sendChat("Series Search")
      await harness.sendChat("E5D70")
      await harness.sendChat("Full View")
      await harness.sendChat("Another Series")
      await harness.sendChat("EI880")
      await harness.sendChat("lunch")

      const context = await harness.sendChat("What diameter and material did I choose?")
      harness.expectMode("general_chat", context)
      harness.expectOriginalContext(context)
      harness.expectPersistedArtifacts(context)
      await harness.expectLastMessageContains(/Aluminum|4mm/i)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("series menu keeps displayedOptions aligned with series groups", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      const menu = await harness.sendChat("Series Search")
      harness.expectMode("group_menu", menu)
      harness.expectPersistedArtifacts(menu)

      const options = menu?.sessionState?.displayedOptions ?? []
      const groups = menu?.sessionState?.displayedSeriesGroups ?? menu?.sessionState?.displayedGroups ?? []
      expect(options.length).toBe(groups.length)
      expect(options.map(option => option.value)).toEqual(groups.map(group => group.seriesName))
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("focused group recommendation stays on the focused displayed set", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")
      const focused = await harness.sendChat("E5D70")
      harness.expectDisplayedCount(2, focused)

      const recommendation = await harness.sendChat("Recommend")
      harness.expectMode("recommendation", recommendation)
      harness.expectDisplayedCount(2, recommendation)
      expect(recommendation?.recommendation?.primaryProduct).toBeTruthy()
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("full view after comparison still keeps comparison artifact and recommendation artifact", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)
    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      const compare = await harness.sendChat("Compare Top 3")
      expect(compare?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBe(3)

      const fullView = await harness.sendChat("Full View")
      harness.expectPersistedArtifacts(fullView)
      harness.expectNoSilentReset(fullView)
      expect(fullView?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBe(3)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })
})
