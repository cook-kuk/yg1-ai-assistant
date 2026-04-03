/**
 * serve-engine-assist-utils — utility function unit tests
 *
 * Tests regex patterns, normalizers, formatters, and helpers
 * exported from serve-engine-assist-utils.ts.
 */

import { describe, it, expect } from "vitest"
import {
  DIRECT_PRODUCT_CODE_PATTERN,
  DIRECT_SERIES_CODE_PATTERN,
  CUTTING_CONDITION_QUERY_PATTERN,
  INVENTORY_QUERY_PATTERN,
  SIMPLE_CHAT_PATTERN,
  WORKFLOW_ONLY_PATTERN,
  TOOL_DOMAIN_PATTERN,
  normalizeLookupCode,
  normalizeEntityLookupKey,
  escapeMarkdownTableCell,
  buildMarkdownTable,
  formatStockStatusLabel,
  summarizeInventoryRowsByWarehouse,
  getLatestInventorySnapshotDateFromRows,
  formatHrcRange,
  compactList,
  formatNullableValue,
  formatMmValue,
  formatLengthValue,
  formatAngleValue,
  buildProductInfoChips,
  formatDiameterRange,
  formatFluteCounts,
  dedupeEntityNames,
  collectRegexMatches,
  isLikelyLookupPhrase,
  isLikelyProductLookupCandidate,
} from "../serve-engine-assist-utils"

// ── Regex Patterns ──────────────────────────────────────────────

describe("DIRECT_PRODUCT_CODE_PATTERN", () => {
  it("matches typical product codes like AE4321", () => {
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("AE4321")).toBe(true)
  })

  it("matches codes with dashes like SMG-120", () => {
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("SMG120")).toBe(true)
  })

  it("matches A1B2345 format", () => {
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("A1B2345")).toBe(true)
  })

  it("does not match single letter", () => {
    expect(DIRECT_PRODUCT_CODE_PATTERN.test("A")).toBe(false)
  })
})

describe("DIRECT_SERIES_CODE_PATTERN", () => {
  it("matches series codes like V7E34", () => {
    expect(DIRECT_SERIES_CODE_PATTERN.test("V7E34")).toBe(true)
  })

  it("matches A1B23 format", () => {
    expect(DIRECT_SERIES_CODE_PATTERN.test("A1B23")).toBe(true)
  })

  it("does not match plain numbers", () => {
    expect(DIRECT_SERIES_CODE_PATTERN.test("12345")).toBe(false)
  })
})

describe("CUTTING_CONDITION_QUERY_PATTERN", () => {
  it("matches 절삭조건", () => {
    expect(CUTTING_CONDITION_QUERY_PATTERN.test("절삭조건 알려줘")).toBe(true)
  })

  it("matches rpm", () => {
    expect(CUTTING_CONDITION_QUERY_PATTERN.test("RPM 얼마?")).toBe(true)
  })

  it("matches fz", () => {
    expect(CUTTING_CONDITION_QUERY_PATTERN.test("fz 알려줘")).toBe(true)
  })

  it("does not match unrelated text", () => {
    expect(CUTTING_CONDITION_QUERY_PATTERN.test("안녕하세요")).toBe(false)
  })
})

describe("INVENTORY_QUERY_PATTERN", () => {
  it("matches 재고", () => {
    expect(INVENTORY_QUERY_PATTERN.test("재고 있어?")).toBe(true)
  })

  it("matches stock", () => {
    expect(INVENTORY_QUERY_PATTERN.test("stock check")).toBe(true)
  })

  it("matches 남았", () => {
    expect(INVENTORY_QUERY_PATTERN.test("몇개 남았어?")).toBe(true)
  })
})

describe("SIMPLE_CHAT_PATTERN", () => {
  it("matches 안녕하세요", () => {
    expect(SIMPLE_CHAT_PATTERN.test("안녕하세요")).toBe(true)
  })

  it("matches hello", () => {
    expect(SIMPLE_CHAT_PATTERN.test("hello")).toBe(true)
  })

  it("matches 테스트", () => {
    expect(SIMPLE_CHAT_PATTERN.test("테스트")).toBe(true)
  })

  it("does not match complex sentences", () => {
    expect(SIMPLE_CHAT_PATTERN.test("φ10mm 엔드밀 추천해줘")).toBe(false)
  })
})

describe("WORKFLOW_ONLY_PATTERN", () => {
  it("matches 추천해줘", () => {
    expect(WORKFLOW_ONLY_PATTERN.test("추천해줘")).toBe(true)
  })

  it("matches 처음부터 다시", () => {
    expect(WORKFLOW_ONLY_PATTERN.test("처음부터 다시")).toBe(true)
  })

  it("matches 리셋", () => {
    expect(WORKFLOW_ONLY_PATTERN.test("리셋")).toBe(true)
  })
})

describe("TOOL_DOMAIN_PATTERN", () => {
  it("matches endmill-related terms", () => {
    expect(TOOL_DOMAIN_PATTERN.test("엔드밀 추천")).toBe(true)
  })

  it("matches coating terms", () => {
    expect(TOOL_DOMAIN_PATTERN.test("코팅 비교")).toBe(true)
  })

  it("matches drilling terms (Korean)", () => {
    expect(TOOL_DOMAIN_PATTERN.test("드릴 추천")).toBe(true)
  })
})

// ── Normalizers ─────────────────────────────────────────────────

describe("normalizeLookupCode", () => {
  it("uppercases and removes spaces and dashes", () => {
    expect(normalizeLookupCode("ae-432 1")).toBe("AE4321")
  })

  it("trims whitespace", () => {
    expect(normalizeLookupCode("  ABC123  ")).toBe("ABC123")
  })
})

describe("normalizeEntityLookupKey", () => {
  it("uppercases and removes separators", () => {
    expect(normalizeEntityLookupKey("E·FORCE BLUE")).toBe("EFORCEBLUE")
  })

  it("removes parentheses and dots", () => {
    expect(normalizeEntityLookupKey("ALU-CUT (HPC)")).toBe("ALUCUTHPC")
  })
})

// ── Formatters ──────────────────────────────────────────────────

describe("escapeMarkdownTableCell", () => {
  it("replaces pipe with slash", () => {
    expect(escapeMarkdownTableCell("a|b")).toBe("a/b")
  })

  it("replaces newline with space", () => {
    expect(escapeMarkdownTableCell("a\nb")).toBe("a b")
  })

  it("returns dash for null/undefined/empty", () => {
    expect(escapeMarkdownTableCell(null)).toBe("-")
    expect(escapeMarkdownTableCell(undefined)).toBe("-")
    expect(escapeMarkdownTableCell("")).toBe("-")
  })

  it("converts numbers to string", () => {
    expect(escapeMarkdownTableCell(42)).toBe("42")
  })
})

describe("buildMarkdownTable", () => {
  it("builds a valid markdown table", () => {
    const table = buildMarkdownTable(["A", "B"], [["1", "2"], ["3", "4"]])
    expect(table).toContain("| A | B |")
    expect(table).toContain("| --- | --- |")
    expect(table).toContain("| 1 | 2 |")
  })
})

describe("formatStockStatusLabel", () => {
  it("returns correct labels", () => {
    expect(formatStockStatusLabel("instock")).toBe("재고 있음")
    expect(formatStockStatusLabel("limited")).toBe("소량 재고")
    expect(formatStockStatusLabel("outofstock")).toBe("재고 없음")
    expect(formatStockStatusLabel("unknown")).toBe("재고 미확인")
  })
})

describe("summarizeInventoryRowsByWarehouse", () => {
  it("sums quantities per warehouse and sorts desc", () => {
    const rows = [
      { warehouseOrRegion: "서울", quantity: 10 },
      { warehouseOrRegion: "부산", quantity: 30 },
      { warehouseOrRegion: "서울", quantity: 20 },
    ]
    const result = summarizeInventoryRowsByWarehouse(rows)
    // When quantities are equal, sorted alphabetically by warehouseOrRegion
    expect(result).toEqual([
      { warehouseOrRegion: "부산", quantity: 30 },
      { warehouseOrRegion: "서울", quantity: 30 },
    ])
  })

  it("skips null quantities", () => {
    const rows = [
      { warehouseOrRegion: "서울", quantity: null },
      { warehouseOrRegion: "부산", quantity: 5 },
    ]
    const result = summarizeInventoryRowsByWarehouse(rows)
    expect(result).toEqual([{ warehouseOrRegion: "부산", quantity: 5 }])
  })

  it("skips empty warehouse names", () => {
    const rows = [
      { warehouseOrRegion: "", quantity: 10 },
      { warehouseOrRegion: "부산", quantity: 5 },
    ]
    const result = summarizeInventoryRowsByWarehouse(rows)
    expect(result).toEqual([{ warehouseOrRegion: "부산", quantity: 5 }])
  })
})

describe("getLatestInventorySnapshotDateFromRows", () => {
  it("returns the latest date", () => {
    const rows = [
      { snapshotDate: "2026-01-01" },
      { snapshotDate: "2026-03-15" },
      { snapshotDate: "2026-02-10" },
    ]
    expect(getLatestInventorySnapshotDateFromRows(rows)).toBe("2026-03-15")
  })

  it("returns null for empty array", () => {
    expect(getLatestInventorySnapshotDateFromRows([])).toBeNull()
  })

  it("skips null dates", () => {
    const rows = [{ snapshotDate: null }, { snapshotDate: "2026-01-01" }]
    expect(getLatestInventorySnapshotDateFromRows(rows)).toBe("2026-01-01")
  })
})

describe("formatHrcRange", () => {
  it("formats min~max", () => {
    expect(formatHrcRange(45, 55)).toBe("45~55")
  })

  it("formats min+", () => {
    expect(formatHrcRange(50, null)).toBe("50+")
  })

  it("formats ~max", () => {
    expect(formatHrcRange(null, 60)).toBe("~60")
  })

  it("returns dash for both null", () => {
    expect(formatHrcRange(null, null)).toBe("-")
  })
})

describe("compactList", () => {
  it("joins values up to max", () => {
    expect(compactList(["a", "b", "c"])).toBe("a, b, c")
  })

  it("truncates with count suffix", () => {
    expect(compactList(["a", "b", "c", "d", "e", "f"], 3)).toBe("a, b, c 외 3개")
  })

  it("returns dash for empty", () => {
    expect(compactList([])).toBe("-")
  })

  it("deduplicates values", () => {
    expect(compactList(["a", "a", "b"])).toBe("a, b")
  })
})

describe("formatNullableValue", () => {
  it("returns dash for null/undefined/empty", () => {
    expect(formatNullableValue(null)).toBe("-")
    expect(formatNullableValue(undefined)).toBe("-")
    expect(formatNullableValue("")).toBe("-")
  })

  it("formats booleans", () => {
    expect(formatNullableValue(true)).toBe("있음")
    expect(formatNullableValue(false)).toBe("없음")
  })

  it("stringifies values", () => {
    expect(formatNullableValue(42)).toBe("42")
    expect(formatNullableValue("hello")).toBe("hello")
  })
})

describe("formatMmValue", () => {
  it("formats diameter", () => {
    expect(formatMmValue(10)).toBe("φ10mm")
  })

  it("returns dash for null", () => {
    expect(formatMmValue(null)).toBe("-")
  })
})

describe("formatLengthValue", () => {
  it("formats length", () => {
    expect(formatLengthValue(50)).toBe("50mm")
  })

  it("returns dash for null", () => {
    expect(formatLengthValue(null)).toBe("-")
  })
})

describe("formatAngleValue", () => {
  it("formats angle", () => {
    expect(formatAngleValue(30)).toBe("30°")
  })

  it("returns dash for null", () => {
    expect(formatAngleValue(null)).toBe("-")
  })
})

describe("buildProductInfoChips", () => {
  it("builds basic chips", () => {
    const chips = buildProductInfoChips("AE4321")
    expect(chips).toContain("AE4321 재고 알려줘")
    expect(chips).toContain("AE4321 절삭조건 알려줘")
    expect(chips).toContain("추천 제품 보기")
  })

  it("includes full spec chip when requested", () => {
    const chips = buildProductInfoChips("AE4321", true)
    expect(chips[0]).toBe("AE4321 전체 사양 알려줘")
    expect(chips).not.toContain("추천 제품 보기")
  })
})

describe("formatDiameterRange", () => {
  it("formats min~max", () => {
    expect(formatDiameterRange(3, 20)).toBe("φ3~20mm")
  })

  it("formats min+", () => {
    expect(formatDiameterRange(5, null)).toBe("φ5mm+")
  })

  it("formats ~max", () => {
    expect(formatDiameterRange(null, 10)).toBe("~φ10mm")
  })

  it("returns dash for both null", () => {
    expect(formatDiameterRange(null, null)).toBe("-")
  })
})

describe("formatFluteCounts", () => {
  it("formats sorted flute counts", () => {
    expect(formatFluteCounts([4, 2, 6])).toBe("2날, 4날, 6날")
  })

  it("deduplicates", () => {
    expect(formatFluteCounts([4, 4, 2])).toBe("2날, 4날")
  })

  it("returns dash for empty", () => {
    expect(formatFluteCounts([])).toBe("-")
  })
})

describe("dedupeEntityNames", () => {
  it("deduplicates by normalized key", () => {
    const result = dedupeEntityNames(["ALU-CUT", "ALU CUT", "TANK-POWER"])
    expect(result).toEqual(["ALU-CUT", "TANK-POWER"])
  })

  it("preserves original casing", () => {
    const result = dedupeEntityNames(["Alu-Cut"])
    expect(result).toEqual(["Alu-Cut"])
  })

  it("filters empty strings", () => {
    const result = dedupeEntityNames(["", " ", "ALU-CUT"])
    expect(result).toEqual(["ALU-CUT"])
  })
})

// ── Helpers ─────────────────────────────────────────────────────

describe("collectRegexMatches", () => {
  it("collects all matches from a global pattern", () => {
    const pattern = /\b([A-Z]+)\b/g
    const matches = collectRegexMatches(pattern, "ABC DEF GHI")
    expect(matches).toEqual(["ABC", "DEF", "GHI"])
  })

  it("adds g flag if missing", () => {
    const pattern = /\d+/
    const matches = collectRegexMatches(pattern, "12 34 56")
    expect(matches).toEqual(["12", "34", "56"])
  })
})

describe("isLikelyLookupPhrase", () => {
  it("returns true for alphanumeric phrases", () => {
    expect(isLikelyLookupPhrase("AE4321")).toBe(true)
  })

  it("returns false for single char", () => {
    expect(isLikelyLookupPhrase("A")).toBe(false)
  })

  it("returns false for pure Korean text without numbers", () => {
    expect(isLikelyLookupPhrase("안녕하세요")).toBe(false)
  })

  it("returns true for Korean with digits", () => {
    expect(isLikelyLookupPhrase("제품123")).toBe(true)
  })
})

describe("isLikelyProductLookupCandidate", () => {
  it("returns true for product-code-like strings", () => {
    expect(isLikelyProductLookupCandidate("AE4321")).toBe(true)
  })

  it("returns false for short strings", () => {
    expect(isLikelyProductLookupCandidate("A1")).toBe(false)
  })

  it("returns false for strings with spaces", () => {
    expect(isLikelyProductLookupCandidate("AE 4321")).toBe(false)
  })

  it("returns false for pure numbers", () => {
    expect(isLikelyProductLookupCandidate("12345")).toBe(false)
  })

  it("returns false for pure letters", () => {
    expect(isLikelyProductLookupCandidate("ABCDEF")).toBe(false)
  })
})
