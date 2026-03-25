/**
 * Phase 7 Performance Optimization Tests
 *
 * Validates: TurnPerfLogger metrics tracking, SessionCache TTL + dedup,
 * and V2 orchestrator single-LLM-call contract.
 */

import { describe, it, expect } from "vitest"
import { TurnPerfLogger } from "../perf/turn-perf-logger"
import { SessionCache } from "../cache/session-cache"

// ─── TurnPerfLogger ───────────────────────────────────────────────

describe("TurnPerfLogger", () => {
  it("tracks total elapsed time", () => {
    const perf = new TurnPerfLogger("test-1")
    const metrics = perf.finish()
    expect(metrics.totalMs).toBeGreaterThanOrEqual(0)
    expect(metrics.turnId).toBe("test-1")
  })

  it("tracks named steps", () => {
    const perf = new TurnPerfLogger()
    perf.startStep("llm_decision")
    perf.endStep("llm_decision")
    perf.startStep("search")
    perf.endStep("search")
    const metrics = perf.finish()
    expect(metrics.steps.llm_decision).toBeGreaterThanOrEqual(0)
    expect(metrics.steps.search).toBeGreaterThanOrEqual(0)
  })

  it("counts LLM calls, DB queries, and cache hits", () => {
    const perf = new TurnPerfLogger()
    perf.recordLlmCall()
    perf.recordLlmCall()
    perf.recordDbQuery()
    perf.recordDbQuery()
    perf.recordDbQuery()
    perf.recordCacheHit()
    const metrics = perf.finish()
    expect(metrics.llmCallCount).toBe(2)
    expect(metrics.dbQueryCount).toBe(3)
    expect(metrics.cacheHitCount).toBe(1)
  })

  it("records phase", () => {
    const perf = new TurnPerfLogger()
    perf.setPhase("narrowing")
    expect(perf.finish().phase).toBe("narrowing")
  })
})

// ─── SessionCache ─────────────────────────────────────────────────

describe("SessionCache", () => {
  it("returns cached value on second call", async () => {
    const cache = new SessionCache()
    let fetchCount = 0
    const fetcher = async () => {
      fetchCount++
      return { name: "ALU-POWER" }
    }

    const result1 = await cache.getOrFetch("series:ALU-POWER", fetcher)
    const result2 = await cache.getOrFetch("series:ALU-POWER", fetcher)

    expect(result1).toEqual({ name: "ALU-POWER" })
    expect(result2).toEqual({ name: "ALU-POWER" })
    expect(fetchCount).toBe(1) // Only fetched once
  })

  it("expires after TTL", async () => {
    const cache = new SessionCache(50) // 50ms TTL
    let fetchCount = 0
    const fetcher = async () => {
      fetchCount++
      return "data"
    }

    await cache.getOrFetch("key", fetcher)
    expect(fetchCount).toBe(1)

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 60))

    await cache.getOrFetch("key", fetcher)
    expect(fetchCount).toBe(2) // Fetched again after TTL
  })

  it("has() returns true for cached keys", () => {
    const cache = new SessionCache()
    cache.set("key", "value")
    expect(cache.has("key")).toBe(true)
    expect(cache.has("other")).toBe(false)
  })

  it("clear() removes all entries", () => {
    const cache = new SessionCache()
    cache.set("a", 1)
    cache.set("b", 2)
    expect(cache.stats().size).toBe(2)
    cache.clear()
    expect(cache.stats().size).toBe(0)
  })

  it("get() returns undefined for missing keys", () => {
    const cache = new SessionCache()
    expect(cache.get("missing")).toBeUndefined()
  })

  it("stats() returns correct size and keys", () => {
    const cache = new SessionCache()
    cache.set("a", 1)
    cache.set("b", 2)
    const s = cache.stats()
    expect(s.size).toBe(2)
    expect(s.keys).toContain("a")
    expect(s.keys).toContain("b")
  })
})

// ─── V2 Orchestrator single-LLM-call contract ────────────────────

describe("V2 orchestrator single LLM call", () => {
  it("orchestrateTurnV2 makes at most 1 LLM call with stub provider", async () => {
    const {
      orchestrateTurnV2,
      createInitialSessionState,
    } = await import("@/lib/recommendation/core/turn-orchestrator")

    let llmCallCount = 0
    const countingProvider = {
      available: () => true,
      complete: async () => {
        llmCallCount++
        return JSON.stringify({
          phaseInterpretation: {
            currentPhase: "narrowing",
            confidence: 0.8,
          },
          actionInterpretation: {
            type: "continue_narrowing",
            rationale: "test",
            confidence: 0.8,
          },
          answerIntent: {
            topic: "narrowing",
            needsGroundedFact: false,
            shouldUseCurrentResultContext: false,
            shouldResumePendingQuestion: false,
          },
          uiPlan: { optionMode: "question_options" },
          answerDraft: "테스트 답변입니다.",
          suggestedChips: [
            { label: "옵션1", type: "option" },
            { label: "상관없음", type: "navigation" },
          ],
        })
      },
    }

    const state = createInitialSessionState()
    await orchestrateTurnV2(
      "알루미늄 10mm 밀링",
      state,
      countingProvider as any
    )

    expect(llmCallCount).toBe(1) // Single LLM call
  })
})
