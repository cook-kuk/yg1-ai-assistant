import { describe, it, expect } from "vitest"
import { findCatalogsForProduct, CATALOG_LIST } from "../catalog-mapping"

describe("findCatalogsForProduct", () => {
  // ── Null / empty inputs ──
  it("returns [] when both seriesName and brand are null", () => {
    expect(findCatalogsForProduct(null, null, null, null)).toEqual([])
  })

  it("returns [] when both seriesName and brand are empty strings", () => {
    expect(findCatalogsForProduct("", null, "", null)).toEqual([])
  })

  // ── Language filtering ──
  it("returns only Korean catalogs when preferredLanguage is ko", () => {
    const results = findCatalogsForProduct("DGE510", null, "Dream Drill", null, "ko")
    results.forEach(c => expect(c.language).toBe("ko"))
  })

  it("returns only English catalogs when preferredLanguage is en", () => {
    const results = findCatalogsForProduct("DGE510", null, "Dream Drill", null, "en")
    results.forEach(c => expect(c.language).toBe("en"))
  })

  // ── Brand-based matching ──
  it("matches X5070 catalog via brand (ko)", () => {
    const results = findCatalogsForProduct("G8A59", null, "X5070", null, "ko")
    expect(results.some(c => c.title.includes("X5070"))).toBe(true)
  })

  it("matches V7 PLUS catalog via brand (en)", () => {
    const results = findCatalogsForProduct(null, null, "V7 PLUS", null, "en")
    expect(results.some(c => c.title.includes("V7 PLUS"))).toBe(true)
  })

  // ── Series-based matching ──
  it("matches Dream Drill catalog via seriesName prefix 'DGE' (ko)", () => {
    const results = findCatalogsForProduct("DGE510", null, null, null, "ko")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(c => c.title.includes("드림드릴"))).toBe(true)
  })

  it("matches PRIME TAP catalog via seriesName 'TRE600' (en)", () => {
    const results = findCatalogsForProduct("TRE600", null, null, null, "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(c => c.title.includes("PRIME TAP"))).toBe(true)
  })

  // ── No-match cases ──
  it("returns [] for completely unrelated product", () => {
    const results = findCatalogsForProduct("ZZZZ999", null, "UNKNOWN-BRAND", null, "en")
    expect(results).toEqual([])
  })

  it("returns [] for catalogs with empty matchKeywords (종합 catalogs)", () => {
    // 종합 catalogs have empty matchKeywords and should never match
    const results = findCatalogsForProduct("MILLING", null, null, null, "en")
    const matchedIds = results.map(c => c.catalogId)
    // MILLING (종합) catalogId "1096" should not appear
    expect(matchedIds).not.toContain("1096")
  })

  // ── Short keyword guard ──
  it("does not match on keywords shorter than 3 chars after normalization", () => {
    // "DL" is only 2 chars after normalization → should not reverse-match
    const results = findCatalogsForProduct("DL", null, null, null, "en")
    expect(results).toEqual([])
  })

  // ── Hyphens and spaces normalized ──
  it("matches despite hyphens in brand name (ALU-POWER)", () => {
    const results = findCatalogsForProduct(null, null, "ALU-POWER", null, "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it("matches despite spaces in brand name (V7 PLUS)", () => {
    const results = findCatalogsForProduct(null, null, "V7 PLUS", null, "ko")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── Default language is ko ──
  it("defaults to ko language when not specified", () => {
    const results = findCatalogsForProduct(null, null, "V7 PLUS", null)
    results.forEach(c => expect(c.language).toBe("ko"))
  })

  // ── Deduplication ──
  it("deduplicates catalogs by catalogId", () => {
    const results = findCatalogsForProduct("G8A59", null, "X5070", null, "ko")
    const ids = results.map(c => c.catalogId)
    expect(ids.length).toBe(new Set(ids).size)
  })

  // ── Category-specific matching ──
  it("matches threading catalog via combo tap keyword (ko)", () => {
    const results = findCatalogsForProduct("T2400", null, "COMBO TAP", null, "ko")
    expect(results.some(c => c.category === "Threading")).toBe(true)
  })

  it("matches turning catalog via CNMG keyword (en)", () => {
    const results = findCatalogsForProduct("CNMG120408", null, null, null, "en")
    expect(results.some(c => c.category === "Turning")).toBe(true)
  })

  it("matches industry catalog via aerospace keyword (en)", () => {
    const results = findCatalogsForProduct(null, null, "AEROSPACE", null, "en")
    expect(results.some(c => c.category === "Industry")).toBe(true)
  })

  // ── Korean-specific keywords ──
  it("matches Korean spade drill catalog via '스페이드' keyword", () => {
    const results = findCatalogsForProduct("스페이드", null, null, null, "ko")
    expect(results.some(c => c.title.includes("스페이드"))).toBe(true)
  })

  it("matches tooling catalog via HSK keyword (en)", () => {
    const results = findCatalogsForProduct(null, null, "HSK-A63", null, "en")
    expect(results.some(c => c.category === "Tooling")).toBe(true)
  })

  // ── URL format ──
  it("all catalog entries have valid URLs starting with the base", () => {
    const base = "https://product.yg1.solutions/resource/catalog/file"
    CATALOG_LIST.forEach(c => {
      expect(c.url.startsWith(base)).toBe(true)
    })
  })
})
