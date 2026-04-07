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
  // 2026-04-07 cross-link fix: 시리즈 substring 매칭 최소 길이 5 — 짧은 prefix는
  // brand 매칭 경로로 보장. 아래 테스트들은 brand를 함께 전달한다.
  it("matches X5070 video via brand='X5070' + seriesName (en)", () => {
    const results = findVideosForProduct("G8A59", null, "X5070", "en")
    const urls = results.map(v => v.url)
    expect(urls).toContain("https://youtu.be/bTJB0cxpILE")
  })

  it("matches Dream Drill via brand='Dream Drill' (en)", () => {
    const results = findVideosForProduct("DGE510", null, "Dream Drill", "en")
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

  // ═══════════════════════════════════════════════════════════════
  // Additional edge cases (20+ new tests)
  // ═══════════════════════════════════════════════════════════════

  // ── Case insensitivity ──
  it("matches case-insensitively on brand (alu-power lowercase)", () => {
    const results = findVideosForProduct(null, null, "alu-power", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it("matches case-insensitively on brand (dream drill lowercase)", () => {
    const results = findVideosForProduct("dge510", null, "dream drill", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── Underscore normalization ──
  it("matches when brand contains underscores instead of hyphens", () => {
    const results = findVideosForProduct(null, null, "ALU_POWER", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── i-Xmill matching ──
  it("matches i-Xmill via brand='i-Xmill' (en)", () => {
    const results = findVideosForProduct("XB1200", null, "i-Xmill", "en")
    expect(results.some(v => v.title.toLowerCase().includes("xmill"))).toBe(true)
  })

  it("matches i-Xmill via brand='i-Xmill' XMB series (en)", () => {
    const results = findVideosForProduct("XMB300", null, "i-Xmill", "en")
    expect(results.some(v => v.title.toLowerCase().includes("xmill"))).toBe(true)
  })

  // ── ONLY ONE matching ──
  it("matches ONLY ONE via brand='ONLY ONE' (en)", () => {
    const results = findVideosForProduct("GYF400", null, "ONLY ONE", "en")
    expect(results.some(v => v.title.includes("ONLY ONE"))).toBe(true)
  })

  // ── Combo Tap matching (ko) ──
  it("matches Combo Tap via brand in Korean (ko)", () => {
    const results = findVideosForProduct("T2400", null, "COMBO TAP", "ko")
    expect(results.some(v => v.title.includes("콤보탭"))).toBe(true)
  })

  // ── Thread Mill matching ──
  it("matches Thread Mill via brand='Thread Mill' (en)", () => {
    const results = findVideosForProduct("L111200", null, "Thread Mill", "en")
    expect(results.some(v => v.title.includes("THREAD"))).toBe(true)
  })

  // ── Spade drill matching (ko) ──
  it("matches spade drill video via keyword '스페이드' in brand (ko)", () => {
    const results = findVideosForProduct(null, null, "스페이드 드릴", "ko")
    expect(results.some(v => v.title.includes("스페이드"))).toBe(true)
  })

  // ── Dream Drill flat bottom ──
  it("matches flat bottom drill via brand='flat bottom' (en)", () => {
    const results = findVideosForProduct("DH3100", null, "flat bottom drill", "en")
    expect(results.some(v => v.title.toLowerCase().includes("flat bottom"))).toBe(true)
  })

  // ── i-SMART matching ──
  it("matches i-SMART via brand (both language)", () => {
    const enResults = findVideosForProduct(null, null, "i-SMART", "en")
    const koResults = findVideosForProduct(null, null, "i-SMART", "ko")
    expect(enResults.length).toBeGreaterThanOrEqual(1)
    expect(koResults.length).toBeGreaterThanOrEqual(1)
  })

  // ── NanoCut matching ──
  it("matches NanoCut video via brand (en)", () => {
    const results = findVideosForProduct(null, null, "NanoCut", "en")
    expect(results.some(v => v.title.includes("NanoCut"))).toBe(true)
  })

  // ── E-FORCE matching (ko) ──
  it("matches E-FORCE BLUE video via keyword (ko)", () => {
    const results = findVideosForProduct("E5E200", null, "E-FORCE", "ko")
    expect(results.some(v => v.title.includes("E-FORCE"))).toBe(true)
  })

  // ── CFRP matching ──
  it("matches CFRP drill via brand='CFRP Drill' (en)", () => {
    const results = findVideosForProduct("RTI500", null, "CFRP Drill", "en")
    expect(results.some(v => v.title.toLowerCase().includes("cfrp"))).toBe(true)
  })

  // ── Hydro Chuck (Tooling) ──
  it("matches Hydro Chuck via brand keyword (en)", () => {
    const results = findVideosForProduct(null, null, "E-Hydro Chuck", "en")
    expect(results.some(v => v.category === "Tooling")).toBe(true)
  })

  // ── Company videos should match yg-1 brand ──
  it("matches corporate videos via 'yg-1' in brand (en)", () => {
    const results = findVideosForProduct(null, null, "YG-1", "en")
    expect(results.some(v => v.category === "Company")).toBe(true)
  })

  // ── Description is ignored for matching ──
  it("does NOT match based on description alone", () => {
    // description containing a keyword should not cause a match
    const results = findVideosForProduct("ZZZUNKNOWN", "dream drill carbide", null, "en")
    expect(results).toEqual([])
  })

  // ── Multiple categories returned ──
  it("returns videos from multiple categories when brand matches several", () => {
    // YG-1 matches both Company and potentially others
    const results = findVideosForProduct(null, null, "YG-1 Corporate", "en")
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  // ── Korean drilling insert ──
  it("matches 드릴링 인서트 video (ko)", () => {
    const results = findVideosForProduct(null, null, "드릴링 인서트", "ko")
    expect(results.some(v => v.title.includes("드릴링 인서트"))).toBe(true)
  })

  // ── Synchro tap ──
  it("matches synchro tap via brand='Synchro Taps' (en)", () => {
    const results = findVideosForProduct("TKS500", null, "Synchro Taps", "en")
    expect(results.some(v => v.title.includes("SYNCHRO"))).toBe(true)
  })

  // ── VIDEO_LIST integrity ──
  it("all video entries have valid YouTube URLs", () => {
    VIDEO_LIST.forEach(v => {
      expect(v.url).toMatch(/^https:\/\/youtu\.be\/[a-zA-Z0-9_-]+$/)
    })
  })

  it("all video entries have at least one matchKeyword", () => {
    VIDEO_LIST.forEach(v => {
      expect(v.matchKeywords.length).toBeGreaterThanOrEqual(1)
    })
  })
})
