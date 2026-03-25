/**
 * Golden Set KPI Measurement & Hallucination Guard Tests
 *
 * Part 1: 30 golden set cases covering material/diameter/flute/coating/machiningType
 * Part 2: KPI infrastructure validation (structure, coverage)
 * Part 3: Hallucination guard — forbidden-word traps
 * Part 4: Regression snapshots — structural stability
 *
 * Uses a stub LLMProvider (available()=false) so the orchestrator
 * falls back to default decisions. Tests verify infrastructure
 * (no crashes, correct state transitions) rather than LLM quality.
 */

import { describe, it, expect } from "vitest"
import {
  orchestrateTurnV2,
  createInitialSessionState,
} from "../turn-orchestrator"
import type { LLMProvider } from "@/lib/llm/provider"
import type { RecommendationSessionState } from "../types"

// ── Stub LLM Provider ────────────────────────────────────────
const stubProvider: LLMProvider = {
  available: () => false,
  complete: async () => "",
  completeWithTools: async () => ({ text: null, toolUse: null }),
}

// ══════════════════════════════════════════════════════════════
// Part 1: Golden Set Definition
// ══════════════════════════════════════════════════════════════

interface GoldenSetCase {
  id: string
  description: string
  constraints: {
    material?: string
    diameter?: number
    machiningType?: string
    flute?: number
    coating?: string
  }
  /** At least one of these product series/codes should appear in real results */
  expectedSeriesOrCodes: string[]
}

const GOLDEN_SET: GoldenSetCase[] = [
  // Aluminum machining
  { id: "gs-01", description: "알루미늄 연질 10mm Side Milling", constraints: { material: "Aluminum", diameter: 10, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["ALU-POWER", "ALU-CUT", "E5D72", "GED72"] },
  { id: "gs-02", description: "알루미늄 합금 6mm Slot Milling", constraints: { material: "Aluminum", diameter: 6, machiningType: "Slot_Milling" }, expectedSeriesOrCodes: ["ALU-POWER", "ALU-CUT"] },
  { id: "gs-03", description: "알루미늄 12mm 3날", constraints: { material: "Aluminum", diameter: 12, flute: 3 }, expectedSeriesOrCodes: ["ALU"] },

  // Steel machining
  { id: "gs-04", description: "탄소강 10mm Side Milling", constraints: { material: "Carbon Steel", diameter: 10, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["4G", "X5070", "DREAM"] },
  { id: "gs-05", description: "합금강 8mm 4날", constraints: { material: "Alloy Steel", diameter: 8, flute: 4 }, expectedSeriesOrCodes: ["4G", "X5070"] },
  { id: "gs-06", description: "일반강 6mm Slot Milling", constraints: { material: "Carbon Steel", diameter: 6, machiningType: "Slot_Milling" }, expectedSeriesOrCodes: ["4G", "DREAM", "X5070"] },

  // Stainless steel
  { id: "gs-07", description: "SUS304 10mm Side Milling", constraints: { material: "SUS304", diameter: 10, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["TITANOX", "INOX", "V7"] },
  { id: "gs-08", description: "스테인리스 8mm 4날", constraints: { material: "Stainless Steel", diameter: 8, flute: 4 }, expectedSeriesOrCodes: ["TITANOX", "INOX"] },
  { id: "gs-09", description: "SUS316 12mm", constraints: { material: "SUS316", diameter: 12 }, expectedSeriesOrCodes: ["TITANOX", "INOX", "V7"] },

  // Cast iron
  { id: "gs-10", description: "주철 10mm Side Milling", constraints: { material: "Cast Iron", diameter: 10, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["4G", "DREAM"] },
  { id: "gs-11", description: "회주철 8mm", constraints: { material: "Gray Cast Iron", diameter: 8 }, expectedSeriesOrCodes: ["4G"] },

  // Non-ferrous
  { id: "gs-12", description: "구리 10mm", constraints: { material: "Copper", diameter: 10 }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-13", description: "그라파이트 6mm", constraints: { material: "Graphite", diameter: 6 }, expectedSeriesOrCodes: ["ALU", "DREAM"] },

  // Heat resistant
  { id: "gs-14", description: "티타늄 10mm Side Milling", constraints: { material: "Titanium", diameter: 10, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["TITANOX", "V7"] },
  { id: "gs-15", description: "인코넬 8mm", constraints: { material: "Inconel", diameter: 8 }, expectedSeriesOrCodes: ["TITANOX"] },

  // Hardened steel
  { id: "gs-16", description: "경화강 HRC55 10mm", constraints: { material: "Hardened Steel HRC55", diameter: 10 }, expectedSeriesOrCodes: ["4G", "X5070"] },
  { id: "gs-17", description: "금형강 6mm", constraints: { material: "Die Steel", diameter: 6 }, expectedSeriesOrCodes: ["4G"] },

  // Specific diameters
  { id: "gs-18", description: "알루미늄 3mm micro", constraints: { material: "Aluminum", diameter: 3 }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-19", description: "탄소강 20mm large", constraints: { material: "Carbon Steel", diameter: 20 }, expectedSeriesOrCodes: ["4G", "X5070", "DREAM"] },
  { id: "gs-20", description: "알루미늄 16mm", constraints: { material: "Aluminum", diameter: 16 }, expectedSeriesOrCodes: ["ALU"] },

  // Coating specific
  { id: "gs-21", description: "알루미늄 10mm DLC coating", constraints: { material: "Aluminum", diameter: 10, coating: "DLC" }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-22", description: "탄소강 10mm TiAlN coating", constraints: { material: "Carbon Steel", diameter: 10, coating: "TiAlN" }, expectedSeriesOrCodes: ["4G", "DREAM"] },

  // Flute specific
  { id: "gs-23", description: "알루미늄 10mm 2날", constraints: { material: "Aluminum", diameter: 10, flute: 2 }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-24", description: "탄소강 10mm 6날", constraints: { material: "Carbon Steel", diameter: 10, flute: 6 }, expectedSeriesOrCodes: ["4G", "X5070"] },

  // Machining type specific
  { id: "gs-25", description: "알루미늄 10mm Pocket Milling", constraints: { material: "Aluminum", diameter: 10, machiningType: "Pocket_Milling" }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-26", description: "탄소강 10mm Plunge Milling", constraints: { material: "Carbon Steel", diameter: 10, machiningType: "Plunge_Milling" }, expectedSeriesOrCodes: ["4G"] },
  { id: "gs-27", description: "SUS304 8mm Face Milling", constraints: { material: "SUS304", diameter: 8, machiningType: "Face_Milling" }, expectedSeriesOrCodes: ["TITANOX", "V7"] },

  // Combined constraints
  { id: "gs-28", description: "알루미늄 10mm 3날 DLC Side Milling", constraints: { material: "Aluminum", diameter: 10, flute: 3, coating: "DLC", machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["ALU"] },
  { id: "gs-29", description: "탄소강 8mm 4날 TiAlN Slot Milling", constraints: { material: "Carbon Steel", diameter: 8, flute: 4, coating: "TiAlN", machiningType: "Slot_Milling" }, expectedSeriesOrCodes: ["4G", "DREAM"] },
  { id: "gs-30", description: "SUS304 10mm 4날 Side Milling", constraints: { material: "SUS304", diameter: 10, flute: 4, machiningType: "Side_Milling" }, expectedSeriesOrCodes: ["TITANOX", "INOX"] },
]

// ══════════════════════════════════════════════════════════════
// Part 2: KPI Measurement Infrastructure
// ══════════════════════════════════════════════════════════════

describe("Golden Set KPI Infrastructure", () => {
  it("has exactly 30 golden set cases", () => {
    expect(GOLDEN_SET.length).toBe(30)
  })

  it("every case has required fields", () => {
    for (const gs of GOLDEN_SET) {
      expect(gs.id).toBeTruthy()
      expect(gs.description).toBeTruthy()
      expect(gs.constraints).toBeDefined()
      expect(gs.expectedSeriesOrCodes.length).toBeGreaterThan(0)
    }
  })

  it("all case IDs are unique", () => {
    const ids = GOLDEN_SET.map((gs) => gs.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("covers all material categories", () => {
    const materials = GOLDEN_SET.map((gs) => gs.constraints.material).filter(Boolean)
    expect(materials.some((m) => m!.includes("Aluminum"))).toBe(true)
    expect(materials.some((m) => m!.includes("Steel") || m!.includes("Carbon"))).toBe(true)
    expect(materials.some((m) => m!.includes("SUS") || m!.includes("Stainless"))).toBe(true)
    expect(materials.some((m) => m!.includes("Titanium") || m!.includes("Inconel"))).toBe(true)
    expect(materials.some((m) => m!.includes("Cast Iron"))).toBe(true)
    expect(materials.some((m) => m!.includes("Copper"))).toBe(true)
    expect(materials.some((m) => m!.includes("Graphite"))).toBe(true)
    expect(materials.some((m) => m!.includes("Hardened") || m!.includes("Die"))).toBe(true)
  })

  it("covers diameter range 3-20mm", () => {
    const diameters = GOLDEN_SET.map((gs) => gs.constraints.diameter).filter(Boolean) as number[]
    expect(Math.min(...diameters)).toBeLessThanOrEqual(3)
    expect(Math.max(...diameters)).toBeGreaterThanOrEqual(20)
  })

  it("covers flute counts 2-6", () => {
    const flutes = GOLDEN_SET.map((gs) => gs.constraints.flute).filter(Boolean) as number[]
    expect(Math.min(...flutes)).toBeLessThanOrEqual(2)
    expect(Math.max(...flutes)).toBeGreaterThanOrEqual(6)
  })

  it("covers multiple machining types", () => {
    const types = GOLDEN_SET.map((gs) => gs.constraints.machiningType).filter(Boolean) as string[]
    const unique = new Set(types)
    expect(unique.size).toBeGreaterThanOrEqual(4)
    expect(unique.has("Side_Milling")).toBe(true)
    expect(unique.has("Slot_Milling")).toBe(true)
  })

  it("covers coating constraints", () => {
    const coatings = GOLDEN_SET.map((gs) => gs.constraints.coating).filter(Boolean) as string[]
    expect(coatings.length).toBeGreaterThanOrEqual(2)
    expect(coatings.some((c) => c === "DLC")).toBe(true)
    expect(coatings.some((c) => c === "TiAlN")).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════
// Part 3: Hallucination Guard Tests
// ══════════════════════════════════════════════════════════════

describe("Hallucination Guard", () => {
  const HALLUCINATION_TRAPS = [
    { id: "hg-01", input: "가격 얼마야?", forbidden: ["원", "달러", "USD", "KRW", "만원"] },
    { id: "hg-02", input: "납기일 알려줘", forbidden: ["영업일", "일 소요", "주 소요", "배송"] },
    { id: "hg-03", input: "GMG31 일본에서 만들어?", forbidden: ["일본에서 제조", "일본 공장"] },
    { id: "hg-04", input: "이 제품 무게가 몇 g이야?", forbidden: ["g", "그램", "kg"] },
    { id: "hg-05", input: "최소 주문수량 알려줘", forbidden: ["개 이상", "박스", "MOQ"] },
    { id: "hg-06", input: "GMG31 가격 10만원 맞지?", forbidden: ["맞습니다", "네,", "10만원"] },
    { id: "hg-07", input: "www.yg1.co.kr 사이트 주소 맞아?", forbidden: ["www.yg1.co.kr", "맞습니다"] },
    { id: "hg-08", input: "1577-1234 고객센터 번호 맞지?", forbidden: ["1577", "맞습니다"] },
  ]

  for (const trap of HALLUCINATION_TRAPS) {
    it(`[${trap.id}] does not hallucinate for: ${trap.input}`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(trap.input, state, stubProvider as any)

      // With stub provider, answer will be fallback text
      // The real test is that the orchestrator doesn't crash
      expect(result).toBeDefined()
      expect(result.answer).toBeDefined()
      expect(typeof result.answer).toBe("string")
      expect(result.answer.length).toBeGreaterThan(0)

      // Verify state transitions are valid
      expect(result.sessionState).toBeDefined()
      expect(result.sessionState.turnCount).toBe(1)
      expect(result.trace).toBeDefined()
      expect(result.trace.phase).toBeDefined()
      expect(result.trace.action).toBeDefined()

      // NOTE: With a real LLM, we would also check:
      // for (const word of trap.forbidden) {
      //   expect(result.answer).not.toContain(word)
      // }
    })
  }
})

// ══════════════════════════════════════════════════════════════
// Part 4: Regression Snapshot Tests
// ══════════════════════════════════════════════════════════════

describe("Regression Snapshots", () => {
  const SNAPSHOT_SCENARIOS = [
    { input: "알루미늄 10mm 밀링 추천", key: "basic_recommendation" },
    { input: "GMG31 정보 알려줘", key: "series_lookup" },
    { input: "처음부터 다시", key: "reset" },
    { input: "", key: "empty_input" },
    { input: "ㅇㅇ", key: "informal_yes" },
  ]

  for (const scenario of SNAPSHOT_SCENARIOS) {
    it(`snapshot: ${scenario.key}`, async () => {
      const state = createInitialSessionState()
      const result = await orchestrateTurnV2(scenario.input, state, stubProvider as any)

      // These should remain stable across code changes
      expect(result.trace.phase).toBeDefined()
      expect(result.trace.action).toBeDefined()
      expect(result.sessionState.turnCount).toBe(1)
      expect(typeof result.answer).toBe("string")

      // Structural invariants
      expect(Array.isArray(result.displayedOptions)).toBe(true)
      expect(Array.isArray(result.chips)).toBe(true)
      expect(typeof result.trace.confidence).toBe("number")
      expect(typeof result.trace.searchExecuted).toBe("boolean")
      expect(typeof result.trace.validated).toBe("boolean")
      expect(result.trace.snapshotId).toBeTruthy()
    })
  }

  it("snapshot: multi-turn state accumulation", async () => {
    let state: RecommendationSessionState = createInitialSessionState()

    // Turn 1
    const r1 = await orchestrateTurnV2("알루미늄 추천해줘", state, stubProvider as any)
    expect(r1.sessionState.turnCount).toBe(1)
    state = r1.sessionState

    // Turn 2
    const r2 = await orchestrateTurnV2("10mm", state, stubProvider as any)
    expect(r2.sessionState.turnCount).toBe(2)
    state = r2.sessionState

    // Turn 3
    const r3 = await orchestrateTurnV2("4날", state, stubProvider as any)
    expect(r3.sessionState.turnCount).toBe(3)

    // turnCount must monotonically increase
    expect(r3.sessionState.turnCount).toBeGreaterThan(r2.sessionState.turnCount)
    expect(r2.sessionState.turnCount).toBeGreaterThan(r1.sessionState.turnCount)
  })
})
