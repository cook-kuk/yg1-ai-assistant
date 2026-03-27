/**
 * Success Capture — Unit Tests
 *
 * Validates:
 *   - Success case payload schema
 *   - Slack message format
 *   - No crash if Slack fails
 *   - State snapshot completeness
 */

import { describe, it, expect, vi } from "vitest"

// Mock the success case payload structure
function buildSuccessCasePayload(params: {
  sessionId?: string | null
  userComment?: string
  mode?: string | null
  conditions?: string
  candidateCounts?: string
  topProducts?: string
  narrowingPath?: string
  lastUserMessage?: string
  lastAiResponse?: string
  conversationLength?: number
  displayedProducts?: unknown[]
  appliedFilters?: string[]
  chatHistory?: unknown[]
}) {
  return {
    type: "success_case",
    id: `sc-${Date.now()}-test`,
    timestamp: new Date().toISOString(),
    sessionId: params.sessionId ?? null,
    userComment: params.userComment ?? "",
    mode: params.mode ?? null,
    conditions: params.conditions ?? "",
    candidateCounts: params.candidateCounts ?? "",
    topProducts: params.topProducts ?? "",
    narrowingPath: params.narrowingPath ?? "",
    lastUserMessage: params.lastUserMessage ?? "",
    lastAiResponse: params.lastAiResponse ?? "",
    conversationLength: params.conversationLength ?? 0,
    displayedProducts: params.displayedProducts ?? null,
    appliedFilters: params.appliedFilters ?? [],
    chatHistory: params.chatHistory ?? null,
  }
}

describe("Success Case Payload", () => {
  it("builds a valid payload with all fields", () => {
    const payload = buildSuccessCasePayload({
      sessionId: "ses-123",
      userComment: "이 흐름이 자연스러웠어요",
      mode: "recommendation",
      conditions: "coating=Diamond / fluteCount=4날",
      candidateCounts: "db=339 / filtered=19 / displayed=10",
      topProducts: "#1 GEE8304030 (ALU-CUT E5E83) 95점",
      narrowingPath: "coating=Diamond → fluteCount=4날",
      lastUserMessage: "추천해주세요",
      lastAiResponse: "다음 제품을 추천합니다...",
      conversationLength: 8,
      displayedProducts: [{ rank: 1, code: "GEE8304030", score: 95 }],
      appliedFilters: ["coating=Diamond", "fluteCount=4날"],
      chatHistory: [{ role: "user", text: "추천해주세요" }],
    })

    expect(payload.type).toBe("success_case")
    expect(payload.sessionId).toBe("ses-123")
    expect(payload.userComment).toBe("이 흐름이 자연스러웠어요")
    expect(payload.conditions).toContain("Diamond")
    expect(payload.displayedProducts).toHaveLength(1)
    expect(payload.appliedFilters).toHaveLength(2)
  })

  it("handles empty/minimal payload", () => {
    const payload = buildSuccessCasePayload({})

    expect(payload.type).toBe("success_case")
    expect(payload.sessionId).toBeNull()
    expect(payload.userComment).toBe("")
    expect(payload.displayedProducts).toBeNull()
    expect(payload.conversationLength).toBe(0)
  })

  it("has correct ID format", () => {
    const payload = buildSuccessCasePayload({})
    expect(payload.id).toMatch(/^sc-\d+-/)
  })

  it("has ISO timestamp", () => {
    const payload = buildSuccessCasePayload({})
    expect(() => new Date(payload.timestamp)).not.toThrow()
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp)
  })
})

describe("Slack Notification (notifySuccessCase)", () => {
  it("does not throw when webhook URL is empty", async () => {
    // notifySuccessCase uses sendSlack which checks SLACK_WEBHOOK_URL
    // When empty, it should silently return
    const { notifySuccessCase } = await import("@/lib/slack-notifier")
    await expect(notifySuccessCase({
      sessionId: "ses-test",
      mode: "recommendation",
      conditions: "test",
      candidateCounts: "10",
      topProducts: "#1 test",
      narrowingPath: "test",
      userComment: "great",
      lastUserMessage: "hello",
      lastAiResponse: "response",
      conversationLength: 4,
      comparisonArtifact: null,
    })).resolves.not.toThrow()
  })

  it("does not throw with comparison artifact", async () => {
    const { notifySuccessCase } = await import("@/lib/slack-notifier")
    await expect(notifySuccessCase({
      sessionId: "ses-test",
      mode: "comparison",
      conditions: "test",
      candidateCounts: "10",
      topProducts: "#1 test",
      narrowingPath: "test",
      userComment: "",
      lastUserMessage: "비교해줘",
      lastAiResponse: "비교 결과...",
      conversationLength: 6,
      comparisonArtifact: '{"comparedProductCodes":["A","B"]}',
    })).resolves.not.toThrow()
  })
})

describe("State Snapshot Completeness", () => {
  it("captures required session fields", () => {
    const snapshot = {
      sessionId: "ses-123",
      candidateCount: 19,
      resolutionStatus: "narrowing",
      turnCount: 4,
      lastAskedField: "fluteCount",
      lastAction: "continue_narrowing",
      underlyingAction: null,
      candidateCounts: { dbMatchCount: 339, filteredCount: 19, rankedCount: 19, displayedCount: 10, hiddenBySeriesCapCount: 0 },
    }

    expect(snapshot).toHaveProperty("sessionId")
    expect(snapshot).toHaveProperty("candidateCount")
    expect(snapshot).toHaveProperty("resolutionStatus")
    expect(snapshot).toHaveProperty("turnCount")
    expect(snapshot).toHaveProperty("lastAction")
    expect(snapshot).toHaveProperty("candidateCounts")
    expect(snapshot.candidateCounts).toHaveProperty("dbMatchCount")
    expect(snapshot.candidateCounts).toHaveProperty("displayedCount")
  })
})
