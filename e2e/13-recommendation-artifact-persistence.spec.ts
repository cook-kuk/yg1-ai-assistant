import { test, expect } from "@playwright/test"

import { RecommendationHarness } from "./recommendation-test-helpers"

test.describe("YG-1 recommendation artifact persistence", () => {
  test.setTimeout(120_000)

  test("persists recommendation context across series focus, full restore, and re-recommendation", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)

    try {
      const initial = await harness.startAluminum4mmSideMillingRecommendation()
      harness.expectOriginalContext(initial)
      harness.expectPersistedArtifacts(initial)
      await harness.expectInputContextVisible()

      const radius = await harness.sendChat("Radius")
      harness.expectOriginalContext(radius)
      harness.expectPersistedArtifacts(radius)

      const seriesSearch = await harness.sendChat("시리즈 검색")
      harness.expectOriginalContext(seriesSearch)
      await harness.expectLastMessageContains(/시리즈|series/i)

      const e5d70 = await harness.sendChat("E5D70")
      harness.expectOriginalContext(e5d70)
      harness.expectPersistedArtifacts(e5d70)
      expect(harness.getSeriesNames(e5d70).some(series => /E5D70/i.test(series)) || JSON.stringify(e5d70).includes("E5D70")).toBeTruthy()

      const fullView = await harness.sendChat("전체 보기")
      harness.expectOriginalContext(fullView)
      harness.expectPersistedArtifacts(fullView)
      expect(fullView?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)

      const groupMenu = await harness.sendChat("다른 시리즈 보기")
      harness.expectOriginalContext(groupMenu)
      const anotherSeries = harness.pickAnotherSeries(["E5D70"], groupMenu)
      expect(anotherSeries, "Expected another persisted series group after returning to full view").toBeTruthy()

      const anotherSeriesView = await harness.sendChat(anotherSeries!)
      harness.expectOriginalContext(anotherSeriesView)
      harness.expectPersistedArtifacts(anotherSeriesView)

      const recommendation = await harness.sendChat("추천해주세요")
      harness.expectOriginalContext(recommendation)
      harness.expectPersistedArtifacts(recommendation)
      expect(recommendation?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)

      const whyNoCandidates = await harness.sendChat("왜 후보가 없나요?")
      harness.expectOriginalContext(whyNoCandidates)
      harness.expectPersistedArtifacts(whyNoCandidates)

      const originalContext = await harness.sendChat("처음에 선택한 직경과 소재가 뭐였지?")
      harness.expectOriginalContext(originalContext)
      harness.expectPersistedArtifacts(originalContext)
      await harness.expectLastMessageContains(/4\s*mm|알루미늄/i)
      await harness.expectInputContextVisible()
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("persists comparison artifacts for top-3 compare and table follow-up", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)

    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.ensureRecommendationResponse()

      const compare = await harness.sendChat("상위 3개 비교해줘")
      harness.expectOriginalContext(compare)
      expect(compare?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBeGreaterThan(0)

      const compareTable = await harness.sendChat("표로 비교해줘")
      harness.expectOriginalContext(compareTable)
      harness.expectPersistedArtifacts(compareTable)
      expect(compareTable?.sessionState?.lastComparisonArtifact?.comparedProductCodes?.length ?? 0).toBeGreaterThan(0)
      expect(compareTable?.text ?? "").toContain("|")
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("preserves recommendation session through explanation mode and side chat restore", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)

    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      const recommendation = await harness.ensureRecommendationResponse()
      harness.expectOriginalContext(recommendation)

      const explanation = await harness.sendChat("왜 이 제품이 추천됐어?")
      harness.expectOriginalContext(explanation)
      harness.expectPersistedArtifacts(explanation)

      const returnToRecommendation = await harness.sendChat("추천해주세요")
      harness.expectOriginalContext(returnToRecommendation)
      harness.expectPersistedArtifacts(returnToRecommendation)
      expect(returnToRecommendation?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)

      const sideChat = await harness.sendChat("오늘 점심 뭐 먹지?")
      harness.expectOriginalContext(sideChat)
      expect(sideChat?.sessionState?.underlyingAction ?? sideChat?.sessionState?.lastAction).toBeTruthy()

      const restoreTask = await harness.sendChat("원래 작업으로 돌아가자")
      harness.expectOriginalContext(restoreTask)
      harness.expectPersistedArtifacts(restoreTask)
      expect(restoreTask?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("restores previous group and task context from persisted artifacts", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)

    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Radius")

      const groupMenu = await harness.sendChat("다른 시리즈 보기")
      const selectedSeries = harness.pickAnotherSeries([], groupMenu)
      expect(selectedSeries, "Expected at least one series group to choose from").toBeTruthy()

      const focusedSeries = await harness.sendChat(selectedSeries!)
      harness.expectOriginalContext(focusedSeries)
      const focusedCount = focusedSeries?.sessionState?.candidateCount ?? 0

      const previousGroup = await harness.sendChat("이전 단계")
      harness.expectOriginalContext(previousGroup)
      harness.expectPersistedArtifacts(previousGroup)
      expect(previousGroup?.sessionState?.candidateCount ?? 0).toBeGreaterThanOrEqual(focusedCount)

      const detour = await harness.sendChat("잠깐 다른 얘기인데 오늘 날씨 어때?")
      harness.expectOriginalContext(detour)

      const previousTask = await harness.sendChat("이전 작업으로 돌아가자")
      harness.expectOriginalContext(previousTask)
      harness.expectPersistedArtifacts(previousTask)
      expect(previousTask?.sessionState?.candidateCount ?? 0).toBeGreaterThan(0)
    } finally {
      await harness.attachFailureArtifacts()
    }
  })

  test("renders candidate UI from persisted session artifacts instead of stale payload snapshots", async ({ page }, testInfo) => {
    const harness = new RecommendationHarness(page, testInfo)

    try {
      await harness.startAluminum4mmSideMillingRecommendation()
      await harness.sendChat("Series Search")
      await harness.sendChat("E5D70")

      const syncCheck = await harness.sendChat("recommend sync check")
      const followUp = await harness.sendChat("why no candidates")
      const displayedProducts = syncCheck?.sessionState?.displayedProducts ?? syncCheck?.sessionState?.displayedCandidates ?? []
      const staleSnapshot = syncCheck?.candidateSnapshot ?? []
      const requestBody = harness.latestInteraction()?.requestBody as {
        displayedProducts?: Array<{ code?: string; series?: string | null }>
      } | null

      expect(displayedProducts.length).toBe(2)
      expect(staleSnapshot.length).toBeGreaterThan(displayedProducts.length)
      expect(followUp?.sessionState?.displayedProducts?.length ?? followUp?.sessionState?.displayedCandidates?.length ?? 0).toBe(2)
      expect(requestBody?.displayedProducts?.length ?? 0).toBe(2)
      expect(requestBody?.displayedProducts?.map(product => product.code)).toEqual(["E5D7004010", "E5D7004020"])
    } finally {
      await harness.attachFailureArtifacts()
    }
  })
})
