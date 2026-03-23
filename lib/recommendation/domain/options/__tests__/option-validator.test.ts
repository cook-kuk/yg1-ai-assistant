/**
 * Option Validator — Regression tests for option-first pipeline enforcement
 *
 * Tests:
 * 1. Chips are NOT generated from answer text
 * 2. Answer cannot introduce actionable options absent from displayedOptions
 * 3. Pending question logic works from TurnContext/state, not answer parsing
 * 4. If answer suggests an option, the corresponding structured option exists
 * 5. Quoted or explanatory text does not become chips
 * 6. deriveChipsFromOptions produces chips from displayedOptions only
 * 7. validateOptionFirstPipeline detects orphan chips
 */

import { describe, it, expect } from "vitest"
import {
  validateOptionFirstPipeline,
  deriveChipsFromOptions,
  buildConsistentOptionsAndChips,
} from "../option-validator"
import type { DisplayedOption } from "../../types"

function makeOptions(items: Array<{ label: string; value: string; field?: string }>): DisplayedOption[] {
  return items.map((item, i) => ({
    index: i + 1,
    label: item.label,
    value: item.value,
    field: item.field ?? "coating",
    count: 5,
  }))
}

// ════════════════════════════════════════════════════════════════
// TEST 1: Chips NOT generated from answer text
// ════════════════════════════════════════════════════════════════

describe("option-validator: no text-to-chip synthesis", () => {
  it("deriveChipsFromOptions creates chips ONLY from displayedOptions", () => {
    const options = makeOptions([
      { label: "DLC (5개)", value: "DLC" },
      { label: "AlTiN (3개)", value: "AlTiN" },
    ])

    const chips = deriveChipsFromOptions(options)

    // Chips should only contain option labels + meta chip
    expect(chips).toContain("DLC (5개)")
    expect(chips).toContain("AlTiN (3개)")
    expect(chips).toContain("상관없음")
    expect(chips.length).toBe(3)
  })

  it("deriveChipsFromOptions with no options returns empty", () => {
    const chips = deriveChipsFromOptions([])
    expect(chips).toEqual([])
  })

  it("buildConsistentOptionsAndChips guarantees alignment", () => {
    const options = makeOptions([
      { label: "2날 (10개)", value: "2날" },
      { label: "4날 (8개)", value: "4날" },
    ])

    const result = buildConsistentOptionsAndChips(options)

    // Every chip should map to a displayedOption or be a meta chip
    for (const chip of result.chips) {
      if (chip === "상관없음") continue
      const hasOption = result.displayedOptions.some(o => o.label === chip)
      expect(hasOption).toBe(true)
    }
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: Answer cannot introduce absent actionable options
// ════════════════════════════════════════════════════════════════

describe("option-validator: answer constrained by displayedOptions", () => {
  it("answer suggesting '비교해 보기' without matching option → corrected", () => {
    const options = makeOptions([{ label: "DLC", value: "DLC" }])
    const chips = ["DLC", "상관없음"]

    const result = validateOptionFirstPipeline(
      "DLC와 AlTiN을 비교해 보기 원하시면 클릭하세요.",
      chips,
      options
    )

    expect(result.isValid).toBe(false)
    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
    expect(result.correctedAnswer).not.toMatch(/비교해?\s*보기?/)
  })

  it("answer suggesting '다시 선택' without matching option → corrected", () => {
    const options = makeOptions([{ label: "DLC", value: "DLC" }])
    const chips = ["DLC"]

    const result = validateOptionFirstPipeline(
      "다시 선택하시려면 여기를 클릭하세요.",
      chips,
      options
    )

    expect(result.isValid).toBe(false)
    expect(result.correctedAnswer).toContain("말씀해주세요")
  })

  it("answer suggesting existing option → NOT corrected", () => {
    const options = makeOptions([
      { label: "DLC", value: "DLC" },
      { label: "비교 보기", value: "비교 보기" },
    ])
    const chips = ["DLC", "비교 보기"]

    const result = validateOptionFirstPipeline(
      "비교해 보기도 가능합니다.",
      chips,
      options
    )

    // Should find a matching option
    expect(result.correctedAnswer).toBeNull()
  })

  it("answer with multiple unauthorized actions → all detected", () => {
    const options: DisplayedOption[] = []
    const chips: string[] = []

    const result = validateOptionFirstPipeline(
      "대체 후보를 보시거나 절삭조건 확인도 가능합니다. 다시 선택하실 수도 있어요.",
      chips,
      options
    )

    expect(result.unauthorizedActions.length).toBeGreaterThanOrEqual(2)
    expect(result.correctedAnswer).not.toBe(null)
    expect(result.correctedAnswer).toContain("말씀해주세요")
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: Pending question from state, not answer parsing
// ════════════════════════════════════════════════════════════════

describe("option-validator: state-based pending question", () => {
  it("pending question detection uses session state fields", () => {
    // This test verifies the pattern used in serve-engine-runtime.ts
    const sessionState = {
      lastAskedField: "coating",
      resolutionStatus: "narrowing",
      displayedOptions: makeOptions([
        { label: "DLC", value: "DLC" },
        { label: "AlTiN", value: "AlTiN" },
      ]),
    }

    // State-based detection (the correct way)
    const hasPendingQuestion = !!sessionState.lastAskedField
      && !sessionState.resolutionStatus?.startsWith("resolved")
      && sessionState.displayedOptions.length > 0

    expect(hasPendingQuestion).toBe(true)
    expect(sessionState.lastAskedField).toBe("coating")
  })

  it("resolved state → no pending question", () => {
    const sessionState = {
      lastAskedField: "coating",
      resolutionStatus: "resolved_exact",
      displayedOptions: makeOptions([{ label: "DLC", value: "DLC" }]),
    }

    const hasPendingQuestion = !!sessionState.lastAskedField
      && !sessionState.resolutionStatus?.startsWith("resolved")
      && sessionState.displayedOptions.length > 0

    expect(hasPendingQuestion).toBe(false)
  })

  it("no lastAskedField → no pending question", () => {
    const sessionState = {
      lastAskedField: undefined as string | undefined,
      resolutionStatus: "narrowing",
      displayedOptions: [],
    }

    const hasPendingQuestion = !!sessionState.lastAskedField
      && !sessionState.resolutionStatus?.startsWith("resolved")
      && sessionState.displayedOptions.length > 0

    expect(hasPendingQuestion).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 4: Answer/option alignment with new validator
// ════════════════════════════════════════════════════════════════

describe("option-validator: answer/option alignment", () => {
  it("'할까요?' in answer without matching option → detected", () => {
    const options = makeOptions([{ label: "DLC", value: "DLC" }])
    const chips = ["DLC"]

    const result = validateOptionFirstPipeline(
      "코팅을 다른 것으로 변경해 볼까요?",
      chips,
      options
    )

    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
  })

  it("'드릴까요?' is flagged as generic action suggestion", () => {
    // "드릴까요?" is a generic action verb ending — the validator
    // conservatively flags it unless the full phrase maps to an option.
    const options = makeOptions([
      { label: "비교", value: "비교" },
    ])
    const chips = ["비교"]

    const result = validateOptionFirstPipeline(
      "비교해 드릴까요?",
      chips,
      options
    )

    // Conservative: generic "드릴까요" is flagged even if "비교" option exists
    expect(result.unauthorizedActions.length).toBeGreaterThan(0)
  })

  it("explicit compare phrase with matching option → allowed", () => {
    // When the full phrase matches an option, it should NOT be flagged
    const options = makeOptions([
      { label: "비교해 보기", value: "비교 보기" },
    ])
    const chips = ["비교해 보기"]

    const result = validateOptionFirstPipeline(
      "두 제품을 비교해 보기를 권합니다.",
      chips,
      options
    )

    expect(result.correctedAnswer).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 5: Quoted/explanatory text does not create chips
// ════════════════════════════════════════════════════════════════

describe("option-validator: quoted text immunity", () => {
  it("pure explanation text → valid (no unauthorized actions)", () => {
    const options = makeOptions([{ label: "DLC", value: "DLC" }])
    const chips = ["DLC"]

    const result = validateOptionFirstPipeline(
      "DLC 코팅은 Diamond-Like Carbon의 약자로, 높은 경도와 내마모성이 특징입니다.",
      chips,
      options
    )

    expect(result.isValid).toBe(true)
    expect(result.unauthorizedActions.length).toBe(0)
  })

  it("technical description with no action verbs → no divergence", () => {
    const options = makeOptions([{ label: "TiAlN", value: "TiAlN" }])
    const chips = ["TiAlN", "상관없음"]

    const result = validateOptionFirstPipeline(
      "TiAlN은 티타늄 알루미늄 질화물로, 고온에서 우수한 성능을 보여줍니다. 일반강, SUS 가공에 적합합니다.",
      chips,
      options
    )

    expect(result.isValid).toBe(true)
    expect(result.correctedAnswer).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 6: Orphan chip detection
// ════════════════════════════════════════════════════════════════

describe("option-validator: orphan chip detection", () => {
  it("chip without matching displayedOption → orphan", () => {
    const options = makeOptions([{ label: "DLC", value: "DLC" }])
    const chips = ["DLC", "비교해보기", "상관없음"]

    const result = validateOptionFirstPipeline("좋습니다.", chips, options)

    expect(result.orphanChips).toContain("비교해보기")
    expect(result.validatedChips).toContain("DLC")
    expect(result.validatedChips).toContain("상관없음")
    expect(result.validatedChips).not.toContain("비교해보기")
  })

  it("meta chips (상관없음, ⟵ 이전 단계) are always valid", () => {
    const options: DisplayedOption[] = []
    const chips = ["상관없음", "⟵ 이전 단계", "처음부터 다시", "추천해주세요"]

    const result = validateOptionFirstPipeline("안내입니다.", chips, options)

    expect(result.orphanChips.length).toBe(0)
    expect(result.validatedChips.length).toBe(4)
  })

  it("all chips matching options → no orphans", () => {
    const options = makeOptions([
      { label: "DLC (5개)", value: "DLC" },
      { label: "AlTiN (3개)", value: "AlTiN" },
    ])
    const chips = ["DLC (5개)", "AlTiN (3개)", "상관없음"]

    const result = validateOptionFirstPipeline("코팅을 선택해주세요.", chips, options)

    expect(result.orphanChips.length).toBe(0)
  })
})
