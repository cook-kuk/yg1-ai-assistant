/**
 * Unfilterable Chip Guard — Regression tests
 *
 * Tests for:
 * 1. isUnfilterableChip blocks chips referencing non-filterable DB fields
 * 2. buildFinalChipsFromLLM removes unfilterable chips
 * 3. FILTERABLE_FIELDS whitelist contains all hybrid-retrieval filter handlers
 */

import { describe, it, expect } from "vitest"
import {
  isUnfilterableChip,
  FILTERABLE_FIELDS,
  buildFinalChipsFromLLM,
  type LlmSuggestedChip,
} from "../llm-chip-pipeline"

// ════════════════════════════════════════════════════════════════
// TEST 1: isUnfilterableChip detection
// ════════════════════════════════════════════════════════════════

describe("isUnfilterableChip", () => {
  it("blocks RPM/회전수 chips", () => {
    expect(isUnfilterableChip("회전수(RPM) 범위 좁히기")).toBe(true)
    expect(isUnfilterableChip("RPM 범위 선택")).toBe(true)
    expect(isUnfilterableChip("rpm으로 필터")).toBe(true)
  })

  it("blocks other non-filterable fields", () => {
    expect(isUnfilterableChip("이송속도 조정")).toBe(true)
    expect(isUnfilterableChip("절삭속도(Vc) 선택")).toBe(true)
    expect(isUnfilterableChip("가격 범위")).toBe(true)
    expect(isUnfilterableChip("납기 확인")).toBe(true)
    expect(isUnfilterableChip("스핀들 속도")).toBe(true)
  })

  it("allows valid filterable chips", () => {
    expect(isUnfilterableChip("3날")).toBe(false)
    expect(isUnfilterableChip("코팅별 비교")).toBe(false)
    expect(isUnfilterableChip("Square")).toBe(false)
    expect(isUnfilterableChip("재고 있는 것만")).toBe(false)
    expect(isUnfilterableChip("추천 근거 알려줘")).toBe(false)
    expect(isUnfilterableChip("절삭조건 보기")).toBe(false)  // action, not filter
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 2: buildFinalChipsFromLLM removes unfilterable chips
// ════════════════════════════════════════════════════════════════

describe("buildFinalChipsFromLLM blocks unfilterable", () => {
  it("removes chips with RPM/회전수 from LLM suggestions", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "추천 근거", type: "action" },
      { label: "회전수 범위 좁히기", type: "filter" },
      { label: "코팅 비교", type: "action" },
      { label: "RPM 선택", type: "filter" },
    ]

    const result = buildFinalChipsFromLLM(llmChips, null, [], [])

    const labels = result.chips
    expect(labels).toContain("추천 근거")
    expect(labels).toContain("코팅 비교")
    expect(labels).not.toContain("회전수 범위 좁히기")
    expect(labels).not.toContain("RPM 선택")
  })

  it("keeps all action chips when none are unfilterable", () => {
    const llmChips: LlmSuggestedChip[] = [
      { label: "비교하기", type: "action" },
      { label: "더 보기", type: "action" },
      { label: "조건 변경", type: "action" },
    ]

    const result = buildFinalChipsFromLLM(llmChips, null, [], [])
    expect(result.chips.length).toBe(3)
  })
})

// ════════════════════════════════════════════════════════════════
// TEST 3: FILTERABLE_FIELDS whitelist completeness
// ════════════════════════════════════════════════════════════════

describe("FILTERABLE_FIELDS whitelist", () => {
  it("contains all fields used in hybrid-retrieval filter switch", () => {
    const expectedFields = [
      "fluteCount",
      "coating",
      "materialTag",
      "toolSubtype",
      "seriesName",
      "toolMaterial",
      "toolType",
      "brand",
      "coolantHole",
      "shankDiameterMm",
      "lengthOfCutMm",
      "overallLengthMm",
      "helixAngleDeg",
    ]

    for (const field of expectedFields) {
      expect(FILTERABLE_FIELDS.has(field)).toBe(true)
    }
  })

  it("does NOT contain non-filterable fields", () => {
    const nonFilterable = [
      "rpm",
      "spindleSpeed",
      "feedRate",
      "cuttingSpeed",
      "price",
      "weight",
    ]

    for (const field of nonFilterable) {
      expect(FILTERABLE_FIELDS.has(field)).toBe(false)
    }
  })
})
