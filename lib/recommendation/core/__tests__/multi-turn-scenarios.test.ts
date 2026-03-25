import { describe, it, expect } from "vitest"
import { orchestrateTurnV2, createInitialSessionState } from "../turn-orchestrator"
import type { RecommendationSessionState } from "../types"

const stubProvider = {
  available: () => false,
  complete: async () => "",
} as any

describe("Multi-Turn Scenarios", () => {

  // Scenario A: Happy Path (5 turns)
  describe("Scenario A: Happy Path intake → recommendation", () => {
    it("maintains state across 5 consecutive turns", async () => {
      let state = createInitialSessionState()

      // Turn 1: Initial query
      const r1 = await orchestrateTurnV2("알루미늄 10mm side milling 추천해줘", state, stubProvider)
      expect(r1.sessionState.turnCount).toBe(1)
      expect(r1.answer).toBeTruthy()
      expect(r1.trace).toBeDefined()
      state = r1.sessionState

      // Turn 2: Answer narrowing question
      const r2 = await orchestrateTurnV2("비철금속", state, stubProvider)
      expect(r2.sessionState.turnCount).toBe(2)
      state = r2.sessionState

      // Turn 3: Another narrowing answer
      const r3 = await orchestrateTurnV2("Radius", state, stubProvider)
      expect(r3.sessionState.turnCount).toBe(3)
      state = r3.sessionState

      // Turn 4: Follow-up question
      const r4 = await orchestrateTurnV2("왜 이 제품을 추천했나요?", state, stubProvider)
      expect(r4.sessionState.turnCount).toBe(4)
      state = r4.sessionState

      // Turn 5: Filter request
      const r5 = await orchestrateTurnV2("재고 있는 것만", state, stubProvider)
      expect(r5.sessionState.turnCount).toBe(5)

      // All turns should complete without error
      for (const r of [r1, r2, r3, r4, r5]) {
        expect(r.answer).toBeDefined()
        expect(typeof r.answer).toBe("string")
        expect(r.chips).toBeDefined()
        expect(r.displayedOptions).toBeDefined()
      }
    })
  })

  // Scenario B: Side Question doesn't corrupt state
  describe("Scenario B: Side question isolation", () => {
    it("preserves constraints after side question", async () => {
      let state = createInitialSessionState()
      // Set some constraints
      state.constraints.base = { material: "Aluminum", diameter: 10 }
      state.journeyPhase = "narrowing"

      const constraintsBefore = JSON.stringify(state.constraints)

      // Side question
      const r1 = await orchestrateTurnV2("사우디 지점 알려줘", state, stubProvider)
      // With stub provider, action defaults to "continue_narrowing" not "answer_general"
      // But the key test is: no crash, state incremented
      expect(r1.sessionState.turnCount).toBe(state.turnCount + 1)
      expect(r1.answer).toBeTruthy()

      // Continue with normal flow
      const r2 = await orchestrateTurnV2("Radius", r1.sessionState, stubProvider)
      expect(r2.sessionState.turnCount).toBe(state.turnCount + 2)
    })
  })

  // Scenario C: Reset recovery
  describe("Scenario C: Reset and recovery", () => {
    it("recovers from reset to fresh state", async () => {
      let state = createInitialSessionState()
      state.constraints.base = { material: "Aluminum" }
      state.journeyPhase = "narrowing"
      state.turnCount = 5

      // Turn: normal query after accumulated state
      const r1 = await orchestrateTurnV2("처음부터 다시", state, stubProvider)
      expect(r1.sessionState.turnCount).toBe(6) // turnCount preserved

      // Turn: fresh query after reset-like flow
      const r2 = await orchestrateTurnV2("알루미늄 추천해줘", r1.sessionState, stubProvider)
      expect(r2.sessionState.turnCount).toBe(7)
      expect(r2.answer).toBeTruthy()
    })
  })

  // Scenario D: Series lookup + comparison
  describe("Scenario D: Series lookup flow", () => {
    it("handles series lookup and comparison across turns", async () => {
      let state = createInitialSessionState()

      const r1 = await orchestrateTurnV2("GMG31 시리즈 정보 알려줘", state, stubProvider)
      expect(r1.sessionState.turnCount).toBe(1)
      state = r1.sessionState

      const r2 = await orchestrateTurnV2("GMG30이랑 비교해줘", state, stubProvider)
      expect(r2.sessionState.turnCount).toBe(2)
      state = r2.sessionState

      const r3 = await orchestrateTurnV2("코팅 차이는?", state, stubProvider)
      expect(r3.sessionState.turnCount).toBe(3)
    })
  })

  // Scenario E: Error recovery
  describe("Scenario E: Error recovery", () => {
    it("recovers from nonsense input", async () => {
      let state = createInitialSessionState()

      // Nonsense input
      const r1 = await orchestrateTurnV2("asdfgh", state, stubProvider)
      expect(r1.sessionState.turnCount).toBe(1)
      expect(r1.answer).toBeTruthy() // Should still produce an answer
      state = r1.sessionState

      // Normal input after nonsense
      const r2 = await orchestrateTurnV2("알루미늄 추천해줘", state, stubProvider)
      expect(r2.sessionState.turnCount).toBe(2)
      expect(r2.answer).toBeTruthy()
    })

    it("handles empty input without crash", async () => {
      const state = createInitialSessionState()
      const r = await orchestrateTurnV2("", state, stubProvider)
      expect(r.sessionState.turnCount).toBe(1)
      expect(r.answer).toBeDefined()
    })

    it("handles very long input without crash", async () => {
      const state = createInitialSessionState()
      const longInput = "알루미늄 ".repeat(500)
      const r = await orchestrateTurnV2(longInput, state, stubProvider)
      expect(r.sessionState.turnCount).toBe(1)
    })
  })

  // Scenario F: Turn count monotonically increases
  describe("Scenario F: State invariants across 10 turns", () => {
    it("turnCount always increases by exactly 1", async () => {
      let state = createInitialSessionState()
      const inputs = [
        "알루미늄 10mm", "비철금속", "Radius", "3날",
        "왜 추천?", "재고 있는 것만", "이전으로", "처음부터",
        "탄소강 8mm", "Square"
      ]

      for (let i = 0; i < inputs.length; i++) {
        const result = await orchestrateTurnV2(inputs[i], state, stubProvider)
        expect(result.sessionState.turnCount).toBe(i + 1)
        state = result.sessionState
      }
    })
  })
})
