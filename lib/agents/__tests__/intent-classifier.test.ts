/**
 * Intent Classifier — Deterministic Regression Tests
 *
 * These tests verify that common user inputs are classified
 * WITHOUT hitting the LLM (deterministic path only).
 *
 * If a test fails, it means the input would go to Haiku LLM,
 * making the response slower and less predictable.
 */

import { describe, it, expect } from "vitest"
import { classifyIntent } from "../intent-classifier"
import type { ExplorationSessionState, DisplayedOption } from "@/lib/types/exploration"

// Mock LLM provider that should NOT be called for deterministic cases
const mockProvider = {
  available: () => false,
  complete: async () => { throw new Error("LLM should not be called for deterministic cases") },
  completeWithTools: async () => { throw new Error("LLM should not be called") },
} as any

// Minimal session state for tests that need it
const activeSession: ExplorationSessionState = {
  sessionId: "test",
  candidateCount: 50,
  appliedFilters: [
    { field: "coating", op: "includes", value: "Diamond", rawValue: "Diamond", appliedAt: 1 },
  ],
  narrowingHistory: [],
  stageHistory: [],
  resolutionStatus: "narrowing",
  resolvedInput: { manufacturerScope: "yg1-only", locale: "ko" } as any,
  turnCount: 2,
  lastAskedField: "fluteCount",
  displayedCandidates: [],
  displayedChips: ["2날 (15개)", "4날 (30개)", "상관없음"],
  displayedOptions: [
    { index: 1, label: "2날 (15개)", field: "fluteCount", value: "2", count: 15 },
    { index: 2, label: "4날 (30개)", field: "fluteCount", value: "4", count: 30 },
  ] as DisplayedOption[],
}

describe("Deterministic Intent Classification (no LLM)", () => {

  // ── Reset ──
  describe("Reset patterns", () => {
    const cases = ["처음부터 다시", "다시 시작", "리셋", "처음부터", "새로 시작", "초기화", "reset"]
    for (const input of cases) {
      it(`"${input}" → RESET_SESSION`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("RESET_SESSION")
        expect(r.confidence).toBeGreaterThanOrEqual(0.9)
      })
    }
  })

  // ── Skip ──
  describe("Skip patterns", () => {
    const cases = ["상관없음", "모름", "패스", "스킵", "아무거나"]
    for (const input of cases) {
      it(`"${input}" → SELECT_OPTION (skip)`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("SELECT_OPTION")
        expect(r.extractedValue).toBe("상관없음")
      })
    }
  })

  // ── Nonsense ──
  describe("Nonsense patterns", () => {
    const cases = ["ㅋㅋㅋ", "ㅎㅎ", "...", ""]
    for (const input of cases) {
      it(`"${input}" → OUT_OF_SCOPE`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("OUT_OF_SCOPE")
      })
    }
  })

  // ── Numbered option in active session ──
  describe("Numbered option selection", () => {
    it('"2번" with active session → SELECT_OPTION', async () => {
      const r = await classifyIntent("2번", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
      // value may be "2" (chip match) or "4" (numbered option) depending on matching order
      expect(["2", "4"]).toContain(r.extractedValue)
    })

    it('"1번" with active session → SELECT_OPTION', async () => {
      const r = await classifyIntent("1번", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
      expect(["2", "1"]).toContain(r.extractedValue)
    })
  })

  // ── Chip text matching ──
  describe("Chip text matching", () => {
    it('"4날 (30개)" chip → SELECT_OPTION', async () => {
      const r = await classifyIntent("4날 (30개)", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
    })

    it('"4날" partial chip → SELECT_OPTION', async () => {
      const r = await classifyIntent("4날", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
    })
  })

})
