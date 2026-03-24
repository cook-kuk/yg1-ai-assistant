/**
 * Memory Compressor — Regression tests
 *
 * Verifies:
 * 1. Recent raw turns remain available
 * 2. Older turns compress into episodic summaries
 * 3. Unresolved threads survive compression
 * 4. Resolved facts and active filters survive compression
 * 5. Correction/revision/frustration signals survive compression
 */

import { describe, it, expect } from "vitest"
import {
  compressOlderTurns,
  recordTurn,
  createEmptyConversationLog,
  type ConversationTurn,
} from "../memory-compressor"
import type { ConversationMemory } from "../conversation-memory"

function makeTurns(count: number): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  for (let i = 0; i < count; i++) {
    turns.push({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `턴 ${i + 1} 메시지`,
      turn: i + 1,
    })
  }
  return turns
}

function makeMemory(items: Array<{ field: string; value: string; status: string; turnCreated: number }>): ConversationMemory {
  return {
    items: items.map(item => ({
      key: `${item.field}_${item.turnCreated}`,
      field: item.field,
      value: item.value,
      source: "narrowing" as const,
      status: item.status as any,
      priority: 5,
      turnCreated: item.turnCreated,
      turnUpdated: item.turnCreated,
    })),
    recommendationContext: { primaryProductCode: null, primarySeriesName: null, alternativeCount: 0, lastComparedProducts: [], matchStatus: null },
    followUp: { lastAskedField: null, pendingDecisionType: null, currentOptionFamily: null, turnsSinceRecommendation: 0 },
    softPreferences: [],
    highlights: [],
    userSignals: { confusedFields: [], skippedFields: [], revisedFields: [], prefersDelegate: false, prefersExplanation: false, frustrationCount: 0 },
    recentQA: [],
  }
}

// ════════════════════════════════════════════════════════════════
// TEST 1: Recent raw turns remain available
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: recent turns preserved", () => {
  it("keeps all turns when under threshold", () => {
    const turns = makeTurns(10)
    const result = compressOlderTurns(turns, null, null)

    expect(result.recentTurns.length).toBe(10)
    expect(result.episodicSummaries.length).toBe(0)
  })

  it("keeps last 16 turns raw when over threshold", () => {
    const turns = makeTurns(24)
    const result = compressOlderTurns(turns, null, null)

    expect(result.recentTurns.length).toBe(16)
    // Each recent turn should have the latest turn numbers
    expect(result.recentTurns[0].turn).toBe(9) // turn 9 is first of last 16
    expect(result.recentTurns[result.recentTurns.length - 1].turn).toBe(24)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Older turns compress into episodic summaries
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: episodic summaries", () => {
  it("compresses older turns into episodes of 6", () => {
    const turns = makeTurns(30)
    const result = compressOlderTurns(turns, null, null)

    expect(result.episodicSummaries.length).toBeGreaterThan(0)
    // Each episode covers 6 turns
    for (const ep of result.episodicSummaries) {
      expect(ep.span.toTurn - ep.span.fromTurn).toBeLessThanOrEqual(5)
    }
  })

  it("episodic summaries have structured fields", () => {
    const turns = makeTurns(30)
    const result = compressOlderTurns(turns, null, null)

    for (const ep of result.episodicSummaries) {
      expect(ep).toHaveProperty("id")
      expect(ep).toHaveProperty("summary")
      expect(ep).toHaveProperty("resolvedFacts")
      expect(ep).toHaveProperty("unresolvedThreads")
      expect(ep).toHaveProperty("correctionSignals")
      expect(ep).toHaveProperty("referencedProducts")
    }
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Unresolved threads survive compression
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: unresolved threads", () => {
  it("extracts unresolved questions from older turns", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "DLC가 뭐야?", turn: 1 },
      { role: "assistant", text: "DLC는 Diamond-Like Carbon입니다.", turn: 2 },
      { role: "user", text: "그럼 AlTiN은 뭐야?", turn: 3 },
      { role: "assistant", text: "AlTiN은 알루미늄 티타늄 질화물입니다.", turn: 4 },
      ...makeTurns(20).map(t => ({ ...t, turn: t.turn + 4 })),
    ]
    const result = compressOlderTurns(turns, null, null)

    // The questions should be in episodic summaries as unresolved threads
    const allThreads = result.episodicSummaries.flatMap(ep => ep.unresolvedThreads)
    expect(allThreads.some(t => t.includes("뭐야"))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: Resolved facts and active filters survive
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: facts and filters", () => {
  it("resolved facts from memory survive in episodic summaries", () => {
    const turns = makeTurns(24)
    const memory = makeMemory([
      { field: "material", value: "알루미늄", status: "resolved", turnCreated: 1 },
      { field: "coating", value: "DLC", status: "active", turnCreated: 3 },
    ])
    const result = compressOlderTurns(turns, memory, null)

    const allFacts = result.episodicSummaries.flatMap(ep => ep.resolvedFacts)
    expect(allFacts.some(f => f.field === "material" && f.value === "알루미늄")).toBe(true)
    // Active filters also preserved with prefix
    expect(allFacts.some(f => f.field === "filter:coating" && f.value === "DLC")).toBe(true)
  })

  it("session applied filters are preserved", () => {
    const turns = makeTurns(24)
    const sessionState = {
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "2날", rawValue: 2, appliedAt: 2 },
        { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 4 },
      ],
    } as any

    const result = compressOlderTurns(turns, null, sessionState)

    const allFacts = result.episodicSummaries.flatMap(ep => ep.resolvedFacts)
    expect(allFacts.some(f => f.field === "fluteCount" && f.value === "2날")).toBe(true)
    // Skip filters are NOT preserved (op === "skip")
    expect(allFacts.every(f => f.value !== "상관없음")).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Correction/frustration signals survive
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: correction and frustration", () => {
  it("correction signals extracted from user turns", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "아니 그게 아니라 4날로 바꿔줘", turn: 1 },
      { role: "assistant", text: "4날로 변경합니다.", turn: 2 },
      ...makeTurns(22).map(t => ({ ...t, turn: t.turn + 2 })),
    ]
    const result = compressOlderTurns(turns, null, null)

    const allSignals = result.episodicSummaries.flatMap(ep => ep.correctionSignals)
    expect(allSignals.some(s => s.includes("바꿔"))).toBe(true)
  })

  it("frustration signals extracted from user turns", () => {
    const turns: ConversationTurn[] = [
      { role: "user", text: "왜 안 나와? 짜증나", turn: 1 },
      { role: "assistant", text: "죄송합니다. 다시 검색해보겠습니다.", turn: 2 },
      ...makeTurns(22).map(t => ({ ...t, turn: t.turn + 2 })),
    ]
    const result = compressOlderTurns(turns, null, null)

    const allSignals = result.episodicSummaries.flatMap(ep => ep.correctionSignals)
    expect(allSignals.some(s => s.includes("불만"))).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 6: ConversationLog auto-compression
// ════════════════════════════════════════════════════════════════

describe("memory-compressor: ConversationLog", () => {
  it("recordTurn keeps recent turns and compresses old ones", () => {
    let log = createEmptyConversationLog()

    // Record 15 turns
    for (let i = 0; i < 15; i++) {
      log = recordTurn(
        log,
        `유저 메시지 ${i + 1}`,
        `어시스턴트 응답 ${i + 1}`,
        {
          chips: ["칩1", "칩2"],
          displayedOptions: [],
          mode: "narrowing",
          lastAskedField: "fluteCount",
          lastAction: "continue_narrowing",
          candidateCount: 100,
          displayedProductCodes: [],
          hasRecommendation: false,
          hasComparison: false,
          appliedFilters: [],
          visibleUIBlocks: ["chips_bar", "question_prompt"],
        }
      )
    }

    // Should have 12 recent rich turns (compressed 3)
    expect(log.recentRichTurns.length).toBe(12)
    expect(log.compressedTurns.length).toBe(3)
    expect(log.totalTurnsRecorded).toBe(15)
  })

  it("compressed turns have key signals extracted", () => {
    let log = createEmptyConversationLog()

    // Record turn with skip signal
    log = recordTurn(log, "상관없음", "다음 질문입니다.", {
      chips: [], displayedOptions: [], mode: "narrowing",
      lastAskedField: "fluteCount", lastAction: "skip_field",
      candidateCount: 100, displayedProductCodes: [],
      hasRecommendation: false, hasComparison: false, appliedFilters: [], visibleUIBlocks: ["question_prompt"],
    })

    // Record 14 more to trigger compression
    for (let i = 0; i < 14; i++) {
      log = recordTurn(log, `메시지 ${i}`, `응답 ${i}`, {
        chips: [], displayedOptions: [], mode: "narrowing",
        lastAskedField: null, lastAction: "continue_narrowing",
        candidateCount: 100, displayedProductCodes: [],
        hasRecommendation: false, hasComparison: false, appliedFilters: [], visibleUIBlocks: ["question_prompt"],
      })
    }

    // First turn should now be compressed
    if (log.compressedTurns.length > 0) {
      const first = log.compressedTurns[0]
      expect(first.keySignals).toContain("skip")
    }
  })

  it("recordTurn keeps process trace and visible UI blocks", () => {
    let log = createEmptyConversationLog()

    log = recordTurn(
      log,
      "Ball 말고 설명해줘",
      "현재 보이는 옵션 기준으로 설명드리겠습니다.",
      {
        chips: ["Ball", "Square"],
        displayedOptions: [{ label: "Ball", value: "Ball", field: "toolSubtype" }],
        mode: "question",
        lastAskedField: "toolSubtype",
        lastAction: "explain_product",
        candidateCount: 24,
        displayedProductCodes: ["CE123"],
        hasRecommendation: false,
        hasComparison: false,
        appliedFilters: [{ field: "coating", value: "DLC", op: "includes" }],
        visibleUIBlocks: ["question_prompt", "chips_bar", "explanation_block"],
      },
      {
        routeAction: "explain_product",
        pendingQuestionField: "toolSubtype",
        recentFrameRelation: "detail_request",
        optionFamiliesGenerated: ["toolSubtype"],
        selectedOptionIds: ["toolSubtype:Ball"],
        validatorRewrites: ["Ball 비교 보기"],
        memoryTransitions: [{ field: "toolSubtype", from: "pending", to: "explained" }],
      },
    )

    expect(log.recentRichTurns[0].processTrace.routeAction).toBe("explain_product")
    expect(log.recentRichTurns[0].uiSnapshot.visibleUIBlocks).toContain("explanation_block")
  })
})
