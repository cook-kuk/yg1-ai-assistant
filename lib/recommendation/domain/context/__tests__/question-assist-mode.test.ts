/**
 * Question Assist Mode — Regression tests
 *
 * Verifies:
 * 1. Question assist mode keeps pending field alive
 * 2. Novice/help messages do not reset flow
 * 3. "상관없음" maps to skip for the pending field
 * 4. "추천으로 골라줘" maps to delegation for the pending field
 * 5. Helper chips remain question-aligned
 */

import { describe, it, expect } from "vitest"
import { detectUserState } from "../user-understanding-detector"

// ════════════════════════════════════════════════════════════════
// TEST 1: Question assist keeps pending field alive
// ════════════════════════════════════════════════════════════════

describe("question-assist: pending field preserved", () => {
  it("confusion is bound to pending field", () => {
    const result = detectUserState("이게 뭐야?", "coating")
    expect(result.state).toBe("wants_explanation")
    expect(result.boundField).toBe("coating")
  })

  it("explanation request is bound to pending field", () => {
    const result = detectUserState("DLC랑 AlTiN 차이가 뭐야?", "coating")
    expect(result.state).toBe("wants_explanation")
    expect(result.boundField).toBe("coating")
    expect(result.confusedAbout).toBe("dlc랑 altin")
  })

  it("delegation is bound to pending field", () => {
    const result = detectUserState("추천으로 골라줘", "fluteCount")
    expect(result.state).toBe("wants_delegation")
    expect(result.boundField).toBe("fluteCount")
  })

  it("skip is bound to pending field", () => {
    const result = detectUserState("상관없음", "coating")
    expect(result.state).toBe("wants_skip")
    expect(result.boundField).toBe("coating")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Novice/help does not reset flow
// ════════════════════════════════════════════════════════════════

describe("question-assist: novice/help handling", () => {
  it("잘 모르겠어요 is confusion, not clear", () => {
    const result = detectUserState("잘 모르겠어요", "fluteCount")
    expect(result.state).not.toBe("clear")
    expect(result.boundField).toBe("fluteCount")
  })

  it("초보인데요 is detected as confusion/novice", () => {
    const result = detectUserState("초보인데요", "toolSubtype")
    expect(result.state).toBe("confused")
    expect(result.boundField).toBe("toolSubtype")
  })

  it("도와줘 is detected as novice help signal", () => {
    const result = detectUserState("도와줘", "coating")
    expect(result.state).toBe("confused")
    expect(result.boundField).toBe("coating")
  })

  it("뭘 골라야 하는지 모르겠어 is not clear", () => {
    const result = detectUserState("뭘 골라야 하는지 모르겠어", "fluteCount")
    expect(["confused", "wants_explanation", "wants_delegation", "wants_skip"]).toContain(result.state)
    expect(result.boundField).toBe("fluteCount")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: 상관없음 maps to skip for current field
// ════════════════════════════════════════════════════════════════

describe("question-assist: field-bound skip", () => {
  // Note: "몰라" hits confusion patterns first (correct — it IS confusion, handled by question-assist interceptor)
  const skipPhrases = ["상관없음", "패스", "스킵", "넘어가자", "다음", "됐어"]

  for (const phrase of skipPhrases) {
    it(`"${phrase}" with pending field → wants_skip + boundField`, () => {
      const result = detectUserState(phrase, "coating")
      expect(result.state).toBe("wants_skip")
      expect(result.boundField).toBe("coating")
    })
  }
})

// ════════════════════════════════════════════════════════════════
// TEST 4: 추천으로 골라줘 maps to field-bound delegate
// ════════════════════════════════════════════════════════════════

describe("question-assist: field-bound delegation", () => {
  const delegatePhrases = [
    "추천으로 골라줘",
    "알아서 해줘",
    "네가 정해줘",
    "아무거나",
    "무난한 걸로",
    "그냥 추천해줘",
    "적당한 걸로",
  ]

  for (const phrase of delegatePhrases) {
    it(`"${phrase}" with pending field → wants_delegation + boundField`, () => {
      const result = detectUserState(phrase, "fluteCount")
      expect(result.state).toBe("wants_delegation")
      expect(result.boundField).toBe("fluteCount")
    })
  }

  it("delegation without pending field → boundField is null", () => {
    const result = detectUserState("추천으로 골라줘")
    expect(result.state).toBe("wants_delegation")
    expect(result.boundField).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Helper chips remain question-aligned
// ════════════════════════════════════════════════════════════════

describe("question-assist: helper chip alignment", () => {
  it("buildQuestionAssistOptions produces field-aligned options", async () => {
    const { buildQuestionAssistOptions } = await import("../../../infrastructure/engines/serve-engine-option-first")

    const mockState = {
      lastAskedField: "coating",
      displayedOptions: [],
      displayedChips: [],
      displayedCandidates: [
        { displayCode: "A", fluteCount: 2, coating: "DLC", seriesName: "S1", diameterMm: 4, toolMaterial: "Carbide" },
        { displayCode: "B", fluteCount: 2, coating: "AlTiN", seriesName: "S1", diameterMm: 4, toolMaterial: "Carbide" },
      ],
    } as any

    const mockCandidates = [
      { product: { fluteCount: 2, coating: "DLC", seriesName: "S1", toolSubtype: "Square", toolMaterial: "Carbide", diameterMm: 4 } },
      { product: { fluteCount: 2, coating: "AlTiN", seriesName: "S1", toolSubtype: "Square", toolMaterial: "Carbide", diameterMm: 4 } },
    ] as any[]

    const result = buildQuestionAssistOptions({
      prevState: mockState,
      currentCandidates: mockCandidates,
      confusedAbout: null,
      includeHelpers: true,
    })

    expect(result.options.length).toBeGreaterThan(0)

    const fieldOptions = result.options.filter(o => o.field === "coating")
    expect(fieldOptions.length).toBeGreaterThan(0)
    expect(fieldOptions.some(o => o.value === "DLC")).toBe(true)
    expect(fieldOptions.some(o => o.value === "AlTiN")).toBe(true)
  })
})
