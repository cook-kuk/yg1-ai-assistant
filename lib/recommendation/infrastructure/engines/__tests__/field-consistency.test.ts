import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildQuestionFieldOptions } from "../serve-engine-option-first"
import {
  didLatestNarrowingTurnSkip,
  extractRecommendationSummaryText,
  inferQuestionFieldFromText,
  shouldFallbackToDeterministicQuestionText,
} from "../serve-engine-response"
import type { DisplayedOption } from "@/lib/recommendation/domain/types"

describe("Field consistency guard", () => {
  it("buildQuestionFieldOptions produces options matching the given field", () => {
    const result = buildQuestionFieldOptions("coating", ["TiAlN (50개)", "AlCrN (30개)"], true)

    // All narrowing options must have field="coating"
    const narrowingOptions = result.displayedOptions.filter(
      opt => opt.field !== "_action" && opt.value !== "skip" && opt.value !== "undo"
    )
    expect(narrowingOptions.length).toBeGreaterThan(0)
    for (const opt of narrowingOptions) {
      expect(opt.field).toBe("coating")
    }

    // Chips should include the coating values
    expect(result.chips.some(c => c.includes("TiAlN"))).toBe(true)
    expect(result.chips.some(c => c.includes("AlCrN"))).toBe(true)
  })

  it("no fluteCount options remain when field transitions to coating", () => {
    // Simulate: previous turn had fluteCount options, now question is coating
    const coatingResult = buildQuestionFieldOptions("coating", ["TiAlN (50개)", "AlCrN (30개)"], true)

    // Verify no option has field="fluteCount"
    for (const opt of coatingResult.displayedOptions) {
      expect(opt.field).not.toBe("fluteCount")
    }

    // Verify chips don't contain flute patterns
    for (const chip of coatingResult.chips) {
      expect(chip).not.toMatch(/^\d+날/)
    }
  })

  it("chips are always derived from displayedOptions (no stale data)", () => {
    const result = buildQuestionFieldOptions("fluteCount", ["2날 (100개)", "3날 (80개)", "4날 (60개)"], false)

    // Every chip label must correspond to a displayedOption label (or action chip)
    const optionLabels = new Set(result.displayedOptions.map(opt => opt.label))
    for (const chip of result.chips) {
      expect(optionLabels.has(chip)).toBe(true)
    }
  })

  it("field consistency filter removes stale options from different field", () => {
    // Simulate stale options: mix of coating and fluteCount options
    const mixedOptions: DisplayedOption[] = [
      { index: 1, label: "4날 (60개)", field: "fluteCount", value: "4날", count: 60 },
      { index: 2, label: "6날 (40개)", field: "fluteCount", value: "6날", count: 40 },
      { index: 3, label: "TiAlN (50개)", field: "coating", value: "TiAlN", count: 50 },
      { index: 4, label: "상관없음", field: "_action", value: "skip", count: 0 },
    ]

    const currentField = "coating"
    const filtered = mixedOptions.filter(
      opt => !opt.field || opt.field === currentField || opt.field === "_action" || opt.field === "skip"
    )

    // Only coating and _action options remain
    expect(filtered.length).toBe(2)
    expect(filtered.every(opt => opt.field === "coating" || opt.field === "_action")).toBe(true)

    // Derive chips from filtered options
    const chips = filtered.map(opt => opt.label)
    expect(chips).not.toContain("4날 (60개)")
    expect(chips).not.toContain("6날 (40개)")
    expect(chips).toContain("TiAlN (50개)")
  })

  it("treats skip_field follow-ups as deterministic text candidates", () => {
    expect(didLatestNarrowingTurnSkip([
      {
        question: "세부 피삭재를 선택해주세요.",
        answer: "상관없음",
        extractedFilters: [
          { field: "workPieceName", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 },
        ],
        candidateCountBefore: 1852,
        candidateCountAfter: 1852,
      },
    ])).toBe(true)
  })

  it("does not mark normal option selection as skip follow-up", () => {
    expect(didLatestNarrowingTurnSkip([
      {
        question: "코팅 종류 선호가 있으신가요?",
        answer: "Bright Finish",
        extractedFilters: [
          { field: "coating", op: "eq", value: "Bright Finish", rawValue: "Bright Finish", appliedAt: 2 },
        ],
        candidateCountBefore: 1852,
        candidateCountAfter: 609,
      },
    ])).toBe(false)
  })

  it("infers generic diameter text as diameterMm field", () => {
    expect(inferQuestionFieldFromText("직경은 어느 정도 생각하고 계세요?")).toBe("diameterMm")
  })

  it("infers exact diameter clarification text as diameterRefine field", () => {
    expect(inferQuestionFieldFromText("직경 10mm 근처에 9.5mm, 10mm, 10.5mm가 있습니다. 정확한 직경을 선택해주세요.")).toBe("diameterRefine")
  })

  it("falls back to deterministic question text when response drifts to another field", () => {
    expect(shouldFallbackToDeterministicQuestionText({
      questionField: "workPieceName",
      questionText: "선택하신 소재는 ISO H군입니다. 세부 피삭재를 선택해주세요.",
      responseText: "직경은 어느 정도 생각하고 계세요?",
      displayedOptions: [
        { label: "고탄소강", field: "workPieceName", value: "고탄소강" },
        { label: "공구강", field: "workPieceName", value: "공구강" },
      ],
    })).toBe(true)
  })

  it("does not fall back when response remains aligned with workPieceName question", () => {
    expect(shouldFallbackToDeterministicQuestionText({
      questionField: "workPieceName",
      questionText: "선택하신 소재는 ISO H군입니다. 세부 피삭재를 선택해주세요.",
      responseText: "선택하신 소재는 ISO H군입니다. 세부 피삭재를 선택해주세요.",
      displayedOptions: [
        { label: "고탄소강", field: "workPieceName", value: "고탄소강" },
        { label: "공구강", field: "workPieceName", value: "공구강" },
      ],
    })).toBe(false)
  })

  it("extracts responseText from valid JSON recommendation summaries", () => {
    expect(extractRecommendationSummaryText("{\"responseText\":\"Square 3날 P 소재에는 ALU-CUT 시리즈를 추천드립니다.\"}"))
      .toBe("Square 3날 P 소재에는 ALU-CUT 시리즈를 추천드립니다.")
  })

  it("extracts responseText from truncated JSON recommendation summaries", () => {
    expect(extractRecommendationSummaryText("{\n  \"responseText\": \"추천 제품은 ALU-CUT입니다. 코팅은 Bright Finish입니다."))
      .toBe("추천 제품은 ALU-CUT입니다. 코팅은 Bright Finish입니다.")
  })

  it("returns plain text summaries as-is", () => {
    expect(extractRecommendationSummaryText("ALU-CUT 시리즈를 추천드립니다. Square 형상과 3날 조건에 가장 가깝습니다."))
      .toBe("ALU-CUT 시리즈를 추천드립니다. Square 형상과 3날 조건에 가장 가깝습니다.")
  })
})
