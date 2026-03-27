import { describe, it, expect } from "vitest"
import { orchestrateTurnV2, createInitialSessionState } from "../turn-orchestrator"

const stub = { available: () => false, complete: async () => "" } as any

describe("ISO Material Group Coverage", () => {
  const ISO_GROUPS = [
    { group: "P", ko: "탄소강", input: "탄소강 10mm 밀링" },
    { group: "M", ko: "스테인리스", input: "SUS304 10mm side milling" },
    { group: "K", ko: "주철", input: "주철 10mm 밀링" },
    { group: "N", ko: "비철금속", input: "알루미늄 10mm 밀링" },
    { group: "S", ko: "내열합금", input: "티타늄 10mm 밀링" },
    { group: "H", ko: "고경도", input: "경화강 HRC55 10mm 밀링" },
  ]

  for (const { group, ko, input } of ISO_GROUPS) {
    it(`handles ISO ${group} (${ko}) without error`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(input, state, stub)
      expect(result).toBeDefined()
      expect(result.answer).toBeTruthy()
      expect(result.sessionState.turnCount).toBe(1)
    })
  }

  // Multi-turn for each ISO group
  it("handles 3-turn flow for each ISO group", async () => {
    for (const { input } of ISO_GROUPS) {
      let state = createInitialSessionState()
      const r1 = await orchestrateTurnV2(input, state, stub)
      const r2 = await orchestrateTurnV2("추천해줘", r1.sessionState, stub)
      const r3 = await orchestrateTurnV2("재고 확인", r2.sessionState, stub)
      expect(r3.sessionState.turnCount).toBe(3)
    }
  })
})

describe("Extreme Diameter Tests", () => {
  const DIAMETERS = [
    { name: "micro 0.5mm", input: "알루미늄 0.5mm 엔드밀" },
    { name: "micro 1mm", input: "탄소강 1mm 엔드밀" },
    { name: "standard 3mm", input: "SUS304 3mm 밀링" },
    { name: "standard 10mm", input: "알루미늄 10mm 밀링" },
    { name: "large 20mm", input: "탄소강 20mm 밀링" },
    { name: "large 25mm", input: "주철 25mm 엔드밀" },
    { name: "very large 32mm", input: "알루미늄 32mm 엔드밀" },
    { name: "extreme 50mm", input: "탄소강 50mm 밀링" },
    { name: "decimal 6.5mm", input: "알루미늄 6.5mm 밀링" },
    { name: "decimal 10.5mm", input: "SUS304 10.5mm 밀링" },
  ]

  for (const { name, input } of DIAMETERS) {
    it(`handles ${name} without error`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(input, state, stub)
      expect(result).toBeDefined()
      expect(result.answer).toBeTruthy()
      expect(result.sessionState.turnCount).toBe(1)
    })
  }
})

describe("Machining Type Coverage", () => {
  const TYPES = [
    "Side Milling", "Slot Milling", "Pocket Milling", "Face Milling",
    "Plunge Milling", "Drilling", "Tapping", "Reaming",
  ]

  for (const type of TYPES) {
    it(`handles ${type} without error`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(`알루미늄 10mm ${type}`, state, stub)
      expect(result).toBeDefined()
      expect(result.sessionState.turnCount).toBe(1)
    })
  }
})
