import { describe, it, expect } from "vitest"
import { orchestrateTurnV2, createInitialSessionState } from "../turn-orchestrator"

const stub = { available: () => false, complete: async () => "" } as any

describe("Boundary Value Attacks", () => {
  // Input boundary tests
  const BOUNDARY_INPUTS = [
    { name: "empty string", input: "" },
    { name: "whitespace only", input: "   \t\n  " },
    { name: "special chars", input: "!@#$%^&*()" },
    { name: "SQL injection", input: "'; DROP TABLE products; --" },
    { name: "XSS attempt", input: "<script>alert('x')</script>" },
    { name: "very long input (5000 chars)", input: "알루미늄 ".repeat(1250) },
    { name: "single character", input: "?" },
    { name: "numbers only", input: "12345" },
    { name: "emoji input", input: "🔧 알루미늄 추천해줘 🎯" },
    { name: "control characters", input: "test\t\n\r\0end" },
    { name: "unicode mixed", input: "铝合金 10mm アルミニウム aluminium" },
    { name: "repeated chars", input: "ㅋ".repeat(100) },
    { name: "URL input", input: "https://yg1.kr/products?id=123" },
    { name: "JSON input", input: '{"attack": true}' },
    { name: "markdown injection", input: "# Title\n```js\nalert(1)\n```" },
  ]

  for (const { name, input } of BOUNDARY_INPUTS) {
    it(`handles ${name} without crash`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(input, state, stub)
      expect(result).toBeDefined()
      expect(result.answer).toBeDefined()
      expect(result.sessionState.turnCount).toBe(1)
    })
  }

  // State boundary tests
  describe("State boundaries", () => {
    it("handles state with deep constraint tree", async () => {
      const state = createInitialSessionState()
      // Fill with many constraints
      for (let i = 0; i < 20; i++) {
        state.constraints.base[`field_${i}`] = `value_${i}`
        state.constraints.refinements[`ref_${i}`] = `refval_${i}`
      }
      const result = await orchestrateTurnV2("test", state, stub)
      expect(result.sessionState.turnCount).toBe(1)
    })

    it("handles state with very high turnCount", async () => {
      const state = createInitialSessionState()
      state.turnCount = 999
      const result = await orchestrateTurnV2("test", state, stub)
      expect(result.sessionState.turnCount).toBe(1000)
    })

    it("handles state with many revision nodes", async () => {
      const state = createInitialSessionState()
      for (let i = 0; i < 50; i++) {
        state.revisionNodes.push({
          revisionId: `rev-${i}`,
          parentRevisionId: i > 0 ? `rev-${i-1}` : null,
          action: { type: "no_op", field: null, oldValue: null, newValue: null },
          constraintsBefore: { base: {}, refinements: {} },
          constraintsAfter: { base: {}, refinements: {} },
          candidateCountBefore: 100,
          candidateCountAfter: 90,
          timestamp: Date.now(),
        })
      }
      const result = await orchestrateTurnV2("test", state, stub)
      expect(result.sessionState.turnCount).toBe(1)
    })

    it("handles state with null resultContext", async () => {
      const state = createInitialSessionState()
      state.resultContext = null
      const result = await orchestrateTurnV2("결과 보여줘", state, stub)
      expect(result).toBeDefined()
    })

    it("handles state with empty candidates in resultContext", async () => {
      const state = createInitialSessionState()
      state.resultContext = {
        candidates: [],
        totalConsidered: 0,
        searchTimestamp: Date.now(),
        constraintsUsed: { base: {}, refinements: {} },
      }
      const result = await orchestrateTurnV2("재고 확인", state, stub)
      expect(result).toBeDefined()
    })
  })
})
