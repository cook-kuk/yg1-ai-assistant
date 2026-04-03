import { describe, it, expect } from "vitest"
import {
  findVideosForProduct,
  countryToLanguage,
  VIDEO_LIST,
} from "../video-mapping"

describe("countryToLanguage", () => {
  it("returns 'ko' for KR", () => {
    expect(countryToLanguage("KR")).toBe("ko")
  })
  it("returns 'ko' for lowercase kr", () => {
    expect(countryToLanguage("kr")).toBe("ko")
  })
  it("returns 'en' for US", () => {
    expect(countryToLanguage("US")).toBe("en")
  })
  it("returns 'en' for DE", () => {
    expect(countryToLanguage("DE")).toBe("en")
  })
  it("returns 'ko' when null", () => {
    expect(countryToLanguage(null)).toBe("ko")
  })
  it("returns 'ko' when undefined", () => {
    expect(countryToLanguage(undefined)).toBe("ko")
  })
})

describe("findVideosForProduct", () => {
  // ── Null / empty inputs ──
  it("returns [] when both seriesName and brand are null", () => {
    expect(findVideosForProduct(null, null, null)).toEqual([])
  })

  it("returns [] when both seriesName and brand are empty strings", () => {
    // empty strings are falsy → early return
    expect(findVideosForProduct("", null, "")).toEqual([])
  })

  // ── Brand-based matching ──
  it("matches X5070 video via brand='X5070' (en)", () => {
    const results = findVideosForProduct("G8A59", null, "X5070", "en")
    const urls = results.map(v => v.url)
    expect(urls).toContain("https://youtu.be/bTJB0cxpILE")
  })

  it("matches V7 PLUS videos via brand='V7 PLUS' (en)", () => {
    const results = findVideosForProduct("GMG31", null, "V7 PLUS", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map(v => v.title)
    expect(titles.some(t => t.includes("V7"))).toBe(true)
  })

  it("matches V7 PLUS videos via brand='V7 PLUS' (ko)", () => {
    const results = findVideosForProduct("GMG31", null, "V7 PLUS", "ko")
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map(v => v.title)
    expect(titles.some(t => t.includes("V7"))).toBe(true)
  })

  // ── Series-based matching ──
  it("matches X5070 video via seriesName containing 'G8A' prefix (en)", () => {
    const results = findVideosForProduct("G8A59", null, null, "en")
    const urls = results.map(v => v.url)
    // keyword "g8a" is in X5070 entry; seriesNorm "g8a59" includes "g8a"
    expect(urls).toContain("https://youtu.be/bTJB0cxpILE")
  })

  it("matches Dream Drill via seriesName='DGE510' (en)", () => {
    const results = findVideosForProduct("DGE510", null, null, "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
    const titles = results.map(v => v.title)
    expect(titles.some(t => t.toLowerCase().includes("dream"))).toBe(true)
  })

  // ── Reverse matching (keyword includes seriesNorm) ──
  it("matches via reverse match when seriesNorm is substring of keyword", () => {
    // keyword "dreamdrill" includes seriesNorm "dream" (length >= 3)
    const results = findVideosForProduct("DREAM", null, null, "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── No-match cases ──
  it("returns [] for unrelated seriesName='SG5E16' brand='I-POWER'", () => {
    const results = findVideosForProduct("SG5E16", null, "I-POWER", "en")
    expect(results).toEqual([])
  })

  it("returns [] for completely unrelated product", () => {
    const results = findVideosForProduct("ZZZZ999", null, "UNKNOWN-BRAND", "en")
    expect(results).toEqual([])
  })

  // ── Language filtering ──
  it("filters out Korean-only videos when preferredLanguage is 'en'", () => {
    const results = findVideosForProduct("GMG31", null, "V7 PLUS", "en")
    results.forEach(v => {
      expect(v.language === "en" || v.language === "both").toBe(true)
    })
  })

  it("filters out English-only videos when preferredLanguage is 'ko'", () => {
    const results = findVideosForProduct("GMG31", null, "V7 PLUS", "ko")
    results.forEach(v => {
      expect(v.language === "ko" || v.language === "both").toBe(true)
    })
  })

  it("includes 'both' language videos regardless of preference", () => {
    // ALU-POWER HPC has language "both"
    const enResults = findVideosForProduct(null, null, "ALU-POWER", "en")
    const koResults = findVideosForProduct(null, null, "ALU-POWER", "ko")
    const bothUrlEn = enResults.find(v => v.url === "https://youtu.be/Nx_OJARIq8Y")
    const bothUrlKo = koResults.find(v => v.url === "https://youtu.be/Nx_OJARIq8Y")
    expect(bothUrlEn).toBeDefined()
    expect(bothUrlKo).toBeDefined()
  })

  // ── Deduplication ──
  it("deduplicates videos with the same URL", () => {
    // A product matching multiple keywords in the same video entry
    // should not produce duplicate URLs
    const results = findVideosForProduct("G8A59", null, "X5070", "en")
    const urls = results.map(v => v.url)
    const uniqueUrls = [...new Set(urls)]
    expect(urls.length).toBe(uniqueUrls.length)
  })

  // ── Short keyword guard ──
  it("does not match on keywords shorter than 3 chars after normalization", () => {
    // Verify the guard: if a keyword were "ab" (2 chars), it would be skipped
    // We test indirectly: series "DL" (2 chars normalized) should not reverse-match
    // because seriesNorm.length < 3
    const results = findVideosForProduct("DL", null, null, "en")
    // "dl" is only 2 chars, so reverse match (kwNorm.includes(seriesNorm)) is blocked
    // Forward match: "dl" is in no keyword that's >= 3 chars after normalization?
    // Actually "dl1", "dl6" are 3 chars. seriesNorm "dl" is included in "dl1" → no,
    // seriesNorm.includes(kwNorm) means "dl".includes("dl1") = false
    // kwNorm.includes(seriesNorm) means "dl1".includes("dl") = true BUT seriesNorm.length (2) < 3 → blocked
    expect(results).toEqual([])
  })

  // ── Hyphens and spaces normalized ──
  it("matches despite hyphens in brand name (e.g., ALU-POWER)", () => {
    const results = findVideosForProduct(null, null, "ALU-POWER", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it("matches despite spaces in brand name (e.g., V7 PLUS)", () => {
    const results = findVideosForProduct(null, null, "V7 PLUS", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── Default language is ko ──
  it("defaults to ko language when not specified", () => {
    const results = findVideosForProduct(null, null, "V7 PLUS")
    results.forEach(v => {
      expect(v.language === "ko" || v.language === "both").toBe(true)
    })
  })

  // ── Threading category matching ──
  it("matches Prime Tap via keyword 'tre' in seriesName (en)", () => {
    const results = findVideosForProduct("TRE600", null, "PRIME TAP", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(v => v.title.toLowerCase().includes("prime tap"))).toBe(true)
  })

  // ── Turning category matching ──
  it("matches Turning videos via brand containing 'turning' (en)", () => {
    const results = findVideosForProduct(null, null, "YG TURN", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})
