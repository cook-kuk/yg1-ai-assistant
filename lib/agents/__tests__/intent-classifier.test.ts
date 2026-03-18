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

  // ── Recommendation ──
  describe("Recommendation patterns", () => {
    const cases = ["추천해주세요", "결과 보기", "바로 보여주세요", "추천해줘", "결과보기"]
    for (const input of cases) {
      it(`"${input}" → ASK_RECOMMENDATION`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("ASK_RECOMMENDATION")
      })
    }
  })

  // ── Comparison ──
  describe("Comparison patterns", () => {
    const cases = [
      "1번이랑 2번 비교해줘",
      "상위 3개 비교",
      "비교해줘",
      "1번 하고 3번 비교",
    ]
    for (const input of cases) {
      it(`"${input}" → ASK_COMPARISON`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("ASK_COMPARISON")
      })
    }
  })

  // ── Explanation ──
  describe("Explanation patterns", () => {
    const cases = [
      "DLC가 뭐야?",
      "코팅 종류 알려줘",
      "그게 뭐야",
      "설명해줘",
      "장단점 알려줘",
    ]
    for (const input of cases) {
      it(`"${input}" → ASK_EXPLANATION`, async () => {
        const r = await classifyIntent(input, null, mockProvider)
        expect(r.intent).toBe("ASK_EXPLANATION")
      })
    }
  })

  // ── Explanation with option values (MUST NOT become filter/recommendation) ──
  describe("Explanation with option values (critical regression)", () => {
    const cases = [
      "Bright(무코팅), Diamond, DLC 에 대해서 설명해줘",
      "Bright, Diamond, DLC에 대해 설명해줘",
      "코팅 종류에 대해 설명해줘",
      "DLC랑 Diamond 차이 설명해줘",
      "각각 설명해줘",
      "TiAlN이랑 AlCrN 장단점 알려줘",
    ]
    for (const input of cases) {
      it(`"${input}" → ASK_EXPLANATION (not filter!)`, async () => {
        const r = await classifyIntent(input, activeSession, mockProvider)
        expect(r.intent).toBe("ASK_EXPLANATION")
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

  // ── Deterministic parameter extraction in session ──
  describe("Parameter extraction (no LLM)", () => {
    it('"diamond" → SELECT_OPTION (coating)', async () => {
      const r = await classifyIntent("diamond", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
      expect(r.extractedValue?.toLowerCase()).toContain("diamond")
    })

    it('"square" → SELECT_OPTION (subtype)', async () => {
      const r = await classifyIntent("square", activeSession, mockProvider)
      expect(r.intent).toBe("SELECT_OPTION")
      expect(r.extractedValue?.toLowerCase()).toContain("square")
    })
  })

  // ── Scope confirmation ──
  describe("Scope/summary patterns", () => {
    it('"지금 어떤 상태야?" → ASK_EXPLANATION (confirm_scope)', async () => {
      const r = await classifyIntent("지금 어떤 상태야?", null, mockProvider)
      expect(r.intent).toBe("ASK_EXPLANATION")
      expect(r.extractedValue).toBe("__confirm_scope__")
    })

    it('"지금까지 정리해줘" → ASK_EXPLANATION (summarize)', async () => {
      const r = await classifyIntent("지금까지 정리해줘", null, mockProvider)
      expect(r.intent).toBe("ASK_EXPLANATION")
      expect(r.extractedValue).toBe("__summarize_task__")
    })
  })

  // ── Side conversation ──
  describe("Side conversation patterns", () => {
    it('"안녕하세요" → START_NEW_TOPIC', async () => {
      const r = await classifyIntent("안녕하세요", null, mockProvider)
      expect(r.intent).toBe("START_NEW_TOPIC")
    })

    it('"고마워" → START_NEW_TOPIC', async () => {
      const r = await classifyIntent("고마워", null, mockProvider)
      expect(r.intent).toBe("START_NEW_TOPIC")
    })
  })

  // ── Meta questions ──
  describe("Meta questions", () => {
    it('"왜 이거 추천했어?" → ASK_EXPLANATION', async () => {
      const r = await classifyIntent("왜 이거 추천했어?", null, mockProvider)
      expect(r.intent).toBe("ASK_EXPLANATION")
    })
  })
})
