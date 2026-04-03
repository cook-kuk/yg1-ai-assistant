import { describe, it, expect } from "vitest"
import {
  getIntakeFieldLabel,
  localizeIntakeText,
  getIntakeDisplayValue,
  canonicalizeToolCategorySelection,
  getMachiningCategoryDisplayValue,
  canonicalizeMaterialSelection,
  getMaterialDisplayValue,
  canonicalizeIntakeSearchText,
} from "../intake-localization"
import type { AnswerState } from "@/lib/types/intake"

// ════════════════════════════════════════════════════════════════
// Field Label Localization
// ════════════════════════════════════════════════════════════════

describe("getIntakeFieldLabel", () => {
  it("returns Korean label for 'material'", () => {
    expect(getIntakeFieldLabel("material", "ko")).toBe("가공 소재")
  })
  it("returns English label for 'material'", () => {
    expect(getIntakeFieldLabel("material", "en")).toBe("Workpiece Material")
  })
  it("returns Korean label for 'diameterInfo'", () => {
    expect(getIntakeFieldLabel("diameterInfo", "ko")).toBe("공구 직경")
  })
  it("returns English label for 'diameterInfo'", () => {
    expect(getIntakeFieldLabel("diameterInfo", "en")).toBe("Tool Diameter")
  })
  it("returns Korean label for 'advanced'", () => {
    expect(getIntakeFieldLabel("advanced", "ko")).toBe("고급 조건")
  })
  it("returns English label for 'advanced'", () => {
    expect(getIntakeFieldLabel("advanced", "en")).toBe("Advanced Filters")
  })
  it("returns Korean label for 'country'", () => {
    expect(getIntakeFieldLabel("country", "ko")).toBe("국가")
  })
  it("returns English label for 'inquiryPurpose'", () => {
    expect(getIntakeFieldLabel("inquiryPurpose", "en")).toBe("Inquiry Purpose")
  })
})

// ════════════════════════════════════════════════════════════════
// localizeIntakeText
// ════════════════════════════════════════════════════════════════

describe("localizeIntakeText", () => {
  it("returns Korean text as-is when language is ko", () => {
    expect(localizeIntakeText("탄소강", "ko")).toBe("탄소강")
  })
  it("translates Korean text to English", () => {
    expect(localizeIntakeText("탄소강", "en")).toBe("Carbon Steel")
  })
  it("returns machining category display label for 'Milling' in ko", () => {
    expect(localizeIntakeText("Milling", "ko")).toBe("Milling")
  })
  it("returns machining category display label for 'Turning' in en", () => {
    expect(localizeIntakeText("Turning", "en")).toBe("Turning")
  })
  it("returns unmatched English text as-is for en", () => {
    expect(localizeIntakeText("SomeRandomText", "en")).toBe("SomeRandomText")
  })
})

// ════════════════════════════════════════════════════════════════
// Machining Category
// ════════════════════════════════════════════════════════════════

describe("canonicalizeToolCategorySelection", () => {
  it("returns empty string for empty input", () => {
    expect(canonicalizeToolCategorySelection("")).toBe("")
  })
  it("returns empty string for whitespace-only input", () => {
    expect(canonicalizeToolCategorySelection("   ")).toBe("")
  })
  it("passes through known category directly", () => {
    expect(canonicalizeToolCategorySelection("Holemaking")).toBe("Holemaking")
  })
  it("passes through known category with extra spaces", () => {
    expect(canonicalizeToolCategorySelection("  Milling  ")).toBe("Milling")
  })
})

describe("getMachiningCategoryDisplayValue", () => {
  it("returns 'Turning' for 'Tooling System' in en", () => {
    expect(getMachiningCategoryDisplayValue("Tooling System", "en")).toBe("Turning")
  })
  it("returns value as-is when not in mapping", () => {
    expect(getMachiningCategoryDisplayValue("Unknown", "en")).toBe("Unknown")
  })
})

// ════════════════════════════════════════════════════════════════
// Material Functions
// ════════════════════════════════════════════════════════════════

describe("canonicalizeMaterialSelection", () => {
  it("uppercases ISO material tokens", () => {
    expect(canonicalizeMaterialSelection("p,m,k")).toBe("P,M,K")
  })
  it("handles single ISO token", () => {
    expect(canonicalizeMaterialSelection("s")).toBe("S")
  })
  it("translates Korean material names to English", () => {
    expect(canonicalizeMaterialSelection("탄소강")).toBe("Carbon Steel")
  })
  it("handles mixed non-ISO tokens", () => {
    expect(canonicalizeMaterialSelection("탄소강, 주철")).toBe("Carbon Steel, Cast Iron")
  })
})

describe("getMaterialDisplayValue", () => {
  it("displays ISO token P as Korean label", () => {
    expect(getMaterialDisplayValue("P", "ko")).toBe("탄소강")
  })
  it("displays ISO token P as English label", () => {
    expect(getMaterialDisplayValue("P", "en")).toBe("Carbon Steel")
  })
  it("displays multiple ISO tokens comma-separated (ko)", () => {
    expect(getMaterialDisplayValue("P,M", "ko")).toBe("탄소강, 스테인리스강")
  })
  it("displays multiple ISO tokens comma-separated (en)", () => {
    expect(getMaterialDisplayValue("P,M", "en")).toBe("Carbon Steel, Stainless Steel")
  })
  it("handles empty string", () => {
    expect(getMaterialDisplayValue("", "ko")).toBe("")
  })
})

// ════════════════════════════════════════════════════════════════
// canonicalizeIntakeSearchText
// ════════════════════════════════════════════════════════════════

describe("canonicalizeIntakeSearchText", () => {
  it("translates Korean field names to English", () => {
    expect(canonicalizeIntakeSearchText("가공 소재")).toBe("Workpiece Material")
  })
  it("translates '모름' to 'Unknown'", () => {
    expect(canonicalizeIntakeSearchText("모름")).toBe("Unknown")
  })
})

// ════════════════════════════════════════════════════════════════
// getIntakeDisplayValue (integration)
// ════════════════════════════════════════════════════════════════

describe("getIntakeDisplayValue", () => {
  it("returns '미입력' for advanced key (ko)", () => {
    const state: AnswerState<string> = { status: "unanswered" }
    expect(getIntakeDisplayValue("advanced", state, "ko")).toBe("미입력")
  })
  it("returns 'Not provided' for advanced key (en)", () => {
    const state: AnswerState<string> = { status: "unanswered" }
    expect(getIntakeDisplayValue("advanced", state, "en")).toBe("Not provided")
  })
  it("returns '모름' for unknown status (ko)", () => {
    const state: AnswerState<string> = { status: "unknown" }
    expect(getIntakeDisplayValue("material", state, "ko")).toBe("모름")
  })
  it("returns 'Unknown' for unknown status (en)", () => {
    const state: AnswerState<string> = { status: "unknown" }
    expect(getIntakeDisplayValue("material", state, "en")).toBe("Unknown")
  })
  it("returns '미입력' for unanswered status (ko)", () => {
    const state: AnswerState<string> = { status: "unanswered" }
    expect(getIntakeDisplayValue("material", state, "ko")).toBe("미입력")
  })
  it("returns localized inquiry purpose (ko)", () => {
    const state: AnswerState<string> = { status: "known", value: "new" }
    expect(getIntakeDisplayValue("inquiryPurpose", state, "ko")).toBe("신규 제품 추천")
  })
  it("returns localized inquiry purpose (en)", () => {
    const state: AnswerState<string> = { status: "known", value: "substitute" }
    expect(getIntakeDisplayValue("inquiryPurpose", state, "en")).toBe("Find a YG-1 Substitute")
  })
  it("returns localized machining intent (ko)", () => {
    const state: AnswerState<string> = { status: "known", value: "roughing" }
    expect(getIntakeDisplayValue("machiningIntent", state, "ko")).toBe("황삭")
  })
  it("returns localized machining intent (en)", () => {
    const state: AnswerState<string> = { status: "known", value: "finishing" }
    expect(getIntakeDisplayValue("machiningIntent", state, "en")).toBe("Finishing")
  })
  it("returns machining category display for toolTypeOrCurrentProduct", () => {
    const state: AnswerState<string> = { status: "known", value: "Milling" }
    expect(getIntakeDisplayValue("toolTypeOrCurrentProduct", state, "en")).toBe("Milling")
  })
  it("returns material display for material field with ISO token", () => {
    const state: AnswerState<string> = { status: "known", value: "P" }
    expect(getIntakeDisplayValue("material", state, "ko")).toBe("탄소강")
  })
  it("falls back to value for unknown inquiry purpose", () => {
    const state: AnswerState<string> = { status: "known", value: "weird_purpose" }
    expect(getIntakeDisplayValue("inquiryPurpose", state, "en")).toBe("weird_purpose")
  })
})
