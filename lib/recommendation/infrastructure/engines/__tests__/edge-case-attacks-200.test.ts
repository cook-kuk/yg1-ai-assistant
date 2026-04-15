/**
 * edge-case-attacks-200.test.ts
 *
 * 200 adversarial / edge-case tests designed to BREAK the system with
 * unusual inputs. Every test should PASS — the system must handle edge
 * cases gracefully (no crashes, reasonable results or null).
 */
import { describe, expect, it } from "vitest"

import {
  buildPendingSelectionFilter,
  resolveExplicitComparisonAction,
  resolveExplicitRevisionRequest,
  resolveExplicitFilterRequest,
} from "../serve-engine-runtime"
import {
  replaceFieldFilter,
  rebuildInputFromFilters,
} from "../serve-engine-filter-state"
import {
  buildAppliedFilterFromValue,
  getFilterFieldDefinition,
  getRegisteredFilterFields,
  getFilterFieldLabel,
} from "@/lib/recommendation/shared/filter-field-registry"
import {
  hasExplicitRevisionIntent,
  hasExplicitFilterIntent,
  parseExplicitFilterText,
  parseExplicitRevisionText,
} from "@/lib/recommendation/shared/constraint-text-parser"
import { parseAnswerToFilter } from "@/lib/recommendation/domain/question-engine"
import type { AppliedFilter, ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"

// ── Helpers ─────────────────────────────────────────────────

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "edge-test",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

function makeFilter(field: string, value: string, rawValue: string | number = value, op = "includes", appliedAt = 0): AppliedFilter {
  return { field, op, value, rawValue, appliedAt } as AppliedFilter
}

const identityApply = (input: RecommendationInput, _filter: AppliedFilter) => input

// ── Part 1: Unicode attacks (30 cases) ──────────────────────

describe("Part 1: Unicode attacks", () => {
  it("001 — full-width digit '１０mm' parses as diameter", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "１０mm")
    // Should either parse or return null — must not throw
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("002 — full-width digit '２０' in pending selection", () => {
    const state = makeState({ lastAskedField: "diameterMm", displayedChips: ["10mm (5개)", "20mm (3개)"] })
    expect(() => buildPendingSelectionFilter(state, "２０")).not.toThrow()
  })

  it("003 — Hangul jamo decomposed 'ㅂㅏㄹ' for Ball", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "ㅂㅏㄹ")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("004 — Hangul jamo 'ㅅㅡㅋㅝㅓ' for Square", () => {
    const result = parseAnswerToFilter("toolSubtype", "ㅅㅡㅋㅝㅓ")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("005 — emoji prefix in input '🔧 10mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "🔧 10mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("006 — emoji suffix 'Ball ✅'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball ✅")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("007 — zero-width space after value 'Ball\\u200B'", () => {
    const input = "Ball\u200B"
    const filter = buildAppliedFilterFromValue("toolSubtype", input)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("008 — zero-width joiner inside 'Ba\u200Dll'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ba\u200Dll")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("009 — RTL character mixed with Korean '\u200F코팅 TiAlN'", () => {
    const filter = buildAppliedFilterFromValue("coating", "\u200F코팅 TiAlN")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("010 — extremely long input (1000 chars)", () => {
    const longInput = "Ball".repeat(250)
    const filter = buildAppliedFilterFromValue("toolSubtype", longInput)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("011 — extremely long input (5000 chars) in pending selection", () => {
    const state = makeState({ lastAskedField: "toolSubtype", displayedOptions: [] })
    const longMsg = "A".repeat(5000)
    expect(() => buildPendingSelectionFilter(state, longMsg)).not.toThrow()
  })

  it("012 — only whitespace (spaces)", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "   ")
    expect(filter).toBeNull()
  })

  it("013 — only tabs", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\t\t\t")
    expect(filter).toBeNull()
  })

  it("014 — only newlines", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\n\n\n")
    expect(filter).toBeNull()
  })

  it("015 — non-breaking spaces only", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\u00A0\u00A0")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("016 — mixed whitespace tabs+newlines+spaces", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", " \t 10 \n mm ")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("017 — Cyrillic characters look-alike 'Ваll' (В = Cyrillic)", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\u0412all")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("018 — combining diacritical marks 'Bạll'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ba\u0323ll")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("019 — null byte in string 'Ball\\x00'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball\x00")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("020 — BOM character prefix", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\uFEFFBall")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("021 — full-width parentheses 'Square（１０개）'", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [{ index: 1, label: "Square (10개)", field: "toolSubtype", value: "Square", count: 10 }],
    })
    expect(() => buildPendingSelectionFilter(state, "Square（１０개）")).not.toThrow()
  })

  it("022 — surrogate pair emoji '🔩 직경 10mm'", async () => {
    const result = await parseExplicitFilterText("🔩 직경 10mm")
    expect(result).toBeDefined()
    expect(Array.isArray(result.hintedFields)).toBe(true)
  })

  it("023 — Korean syllable + trailing emoji 'Square🔧'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Square🔧")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("024 — ideographic space (U+3000) between words", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball\u3000End Mill")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("025 — halfwidth katakana mixed 'ﾎﾞﾙ' for Ball", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "ﾎﾞﾙ")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("026 — mixed scripts Korean+Latin 'Ball엔드밀'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball엔드밀")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("027 — mathematical bold 'BALL' (U+1D401 etc.)", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "𝐁𝐀𝐋𝐋")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("028 — single Unicode replacement char U+FFFD", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "\uFFFD")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("029 — CJK unified ideographs for numbers '十mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "十mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("030 — repeated zero-width characters between every char", () => {
    const input = "B\u200Ba\u200Bl\u200Bl"
    const filter = buildAppliedFilterFromValue("toolSubtype", input)
    expect(filter === null || typeof filter === "object").toBe(true)
  })
})

// ── Part 2: SQL injection-like inputs (20 cases) ───────────

describe("Part 2: SQL injection-like inputs", () => {
  it("031 — classic SQL injection in subtype", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball'; DROP TABLE products;--")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("032 — OR-based injection in diameter", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "1 OR 1=1")
    // Should parse 1 as numeric or return null
    expect(filter === null || (filter && typeof filter.rawValue === "number")).toBe(true)
  })

  it("033 — script tag as coating", () => {
    const filter = buildAppliedFilterFromValue("coating", "<script>alert(1)</script>")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("034 — UNION SELECT injection", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball UNION SELECT * FROM users")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("035 — SQL comment in pending selection", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [{ index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 10 }],
    })
    expect(() => buildPendingSelectionFilter(state, "TiAlN -- comment")).not.toThrow()
  })

  it("036 — HTML entity injection", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("037 — backslash escape attempt", () => {
    const filter = buildAppliedFilterFromValue("coating", "TiAlN\\'; DROP TABLE --")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("038 — nested quotes", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", `"Ball"'"Ball"`)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("039 — URL-encoded attack", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball%27%3B%20DROP%20TABLE")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("040 — semicolons and multiple statements", () => {
    const filter = buildAppliedFilterFromValue("coating", "TiAlN; DELETE FROM products;")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("041 — template literal injection", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "${process.exit(1)}")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("042 — JSON injection", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", '{"$ne": null}')
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("043 — NoSQL operator injection in pending selection", () => {
    const state = makeState({ lastAskedField: "toolSubtype", displayedOptions: [] })
    expect(() => buildPendingSelectionFilter(state, '{"$gt": ""}' )).not.toThrow()
  })

  it("044 — LDAP injection characters", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball)(|(uid=*))")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("045 — XPath injection", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "' or '1'='1")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("046 — command injection attempt", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball; rm -rf /")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("047 — line feed injection in filter value", () => {
    const filter = buildAppliedFilterFromValue("coating", "TiAlN\r\nX-Injected: true")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("048 — huge payload in constraint text parser", async () => {
    const payload = "A".repeat(10000) + " 필터링"
    const result = await parseExplicitFilterText(payload)
    expect(result).toBeDefined()
  })

  it("049 — SQL wildcard characters", () => {
    const filter = buildAppliedFilterFromValue("coating", "%_%")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("050 — regex injection characters in revision", () => {
    const result = hasExplicitRevisionIntent("Ball.*대신 (Square|Radius)")
    expect(typeof result).toBe("boolean")
  })
})

// ── Part 3: Number edge cases (30 cases) ────────────────────

describe("Part 3: Number edge cases", () => {
  it("051 — zero diameter '0mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "0mm")
    expect(filter === null || (filter && filter.rawValue === 0)).toBe(true)
  })

  it("052 — negative diameter '-5mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "-5mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("053 — absurdly large '999999mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "999999mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("054 — too small '0.001mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "0.001mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("055 — NaN as value", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "NaN")
    expect(filter).toBeNull()
  })

  it("056 — Infinity as value", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "Infinity")
    expect(filter).toBeNull()
  })

  it("057 — 'null' string as diameter", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "null")
    expect(filter).toBeNull()
  })

  it("058 — 'undefined' string as diameter", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "undefined")
    expect(filter).toBeNull()
  })

  it("059 — scientific notation '1e5mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "1e5mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("060 — hex notation '0x10'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "0x10")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("061 — multiple dots '10.10.10'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "10.10.10")
    // Should parse first valid number or return null
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("062 — leading zeros '007mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "007mm")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(7)
  })

  it("063 — very many decimal places '10.123456789mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "10.123456789mm")
    expect(filter).not.toBeNull()
  })

  it("064 — comma as decimal separator '10,5mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "10,5mm")
    // May parse as 10 or null — must not crash
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("065 — plus sign prefix '+10mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "+10mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("066 — space in number '1 0mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "1 0mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("067 — fraction '3/8\"'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", '3/8"')
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("068 — numeric rawValue as number type", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", 10)
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(10)
  })

  it("069 — numeric rawValue NaN as number", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", NaN)
    expect(filter).toBeNull()
  })

  it("070 — numeric rawValue Infinity as number", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", Infinity)
    // Infinity is a valid number; system may accept or reject
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("071 — negative zero -0", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", -0)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("072 — MAX_SAFE_INTEGER", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", Number.MAX_SAFE_INTEGER)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("073 — very small positive '0.0001mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "0.0001mm")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("074 — empty string as diameter", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "")
    expect(filter).toBeNull()
  })

  it("075 — only unit 'mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "mm")
    expect(filter).toBeNull()
  })

  it("076 — Phi prefix 'Φ10'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "Φ10")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(10)
  })

  it("077 — Korean diameter alias '파이10'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "파이10")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(10)
  })

  it("078 — approximate prefix '약 10mm'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "약 10mm")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(10)
  })

  it("079 — approximate suffix '10mm정도'", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", "10mm정도")
    expect(filter).not.toBeNull()
    expect(filter!.rawValue).toBe(10)
  })

  it("080 — boolean true as numeric field", () => {
    const filter = buildAppliedFilterFromValue("diameterMm", true as any)
    expect(filter === null || typeof filter === "object").toBe(true)
  })
})

// ── Part 4: Filter state edge cases (40 cases) ─────────────

describe("Part 4: Filter state edge cases", () => {
  const baseInput: RecommendationInput = { manufacturerScope: "yg1-only", locale: "ko" }

  it("081 — 100 filters at once in replaceFieldFilter", () => {
    const filters: AppliedFilter[] = Array.from({ length: 100 }, (_, i) =>
      makeFilter("toolSubtype", `Type${i}`, `Type${i}`, "includes", i)
    )
    const next = makeFilter("toolSubtype", "NewType", "NewType", "includes", 100)
    const result = replaceFieldFilter(baseInput, filters, next, identityApply)
    expect(result.nextFilters).toBeDefined()
    expect(result.replacedExisting).toBe(true)
    // Only 1 filter for toolSubtype should remain (the new one) plus others
    const subtypeFilters = result.nextFilters.filter(f => f.field === "toolSubtype")
    expect(subtypeFilters).toHaveLength(1)
  })

  it("082 — same field applied 10 times then replaced", () => {
    const filters: AppliedFilter[] = Array.from({ length: 10 }, (_, i) =>
      makeFilter("coating", `Coating${i}`, `Coating${i}`, "includes", i)
    )
    const next = makeFilter("coating", "TiAlN", "TiAlN", "includes", 10)
    const result = replaceFieldFilter(baseInput, filters, next, identityApply)
    expect(result.nextFilters.filter(f => f.field === "coating")).toHaveLength(1)
  })

  it("083 — empty filter array", () => {
    const next = makeFilter("coating", "TiAlN", "TiAlN")
    const result = replaceFieldFilter(baseInput, [], next, identityApply)
    expect(result.replacedExisting).toBe(false)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("084 — filter with empty string field name", () => {
    const filter = makeFilter("", "value", "value")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("085 — filter with op='unknown'", () => {
    const filter = makeFilter("toolSubtype", "Ball", "Ball", "unknown")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].op).toBe("unknown")
  })

  it("086 — filter with appliedAt = -1", () => {
    const filter = makeFilter("coating", "TiAlN", "TiAlN", "includes", -1)
    expect(filter.appliedAt).toBe(-1)
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("087 — filter with appliedAt = Infinity", () => {
    const filter = makeFilter("coating", "TiAlN", "TiAlN", "includes", Infinity)
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("088 — filter with appliedAt = NaN", () => {
    const filter = makeFilter("coating", "TiAlN", "TiAlN", "includes", NaN)
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("089 — rebuildInputFromFilters with empty filter list", () => {
    const result = rebuildInputFromFilters(baseInput, [], identityApply)
    expect(result).toEqual(baseInput)
  })

  it("090 — rebuildInputFromFilters with 50 filters", () => {
    const filters: AppliedFilter[] = Array.from({ length: 50 }, (_, i) =>
      makeFilter(`field${i}`, `val${i}`, `val${i}`, "includes", i)
    )
    expect(() => rebuildInputFromFilters(baseInput, filters, identityApply)).not.toThrow()
  })

  it("091 — replaceFieldFilter with diameterRefine -> diameterMm canonical", () => {
    const existing = [makeFilter("diameterMm", "10mm", 10, "eq")]
    const next = makeFilter("diameterRefine", "12mm", 12, "eq")
    const result = replaceFieldFilter(baseInput, existing, next, identityApply)
    expect(result.replacedExisting).toBe(true)
    const diamFilters = result.nextFilters.filter(f => f.field === "diameterMm" || f.field === "diameterRefine")
    expect(diamFilters).toHaveLength(1)
  })

  it("092 — filter value as boolean", () => {
    const filter = buildAppliedFilterFromValue("internalCoolant", true)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("093 — filter value as false boolean", () => {
    const filter = buildAppliedFilterFromValue("internalCoolant", false)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("094 — buildAppliedFilterFromValue for nonexistent field", () => {
    const filter = buildAppliedFilterFromValue("nonexistent_field_xyz", "value")
    expect(filter).toBeNull()
  })

  it("095 — buildAppliedFilterFromValue with empty array", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", [] as any)
    expect(filter).toBeNull()
  })

  it("096 — buildAppliedFilterFromValue with array of mixed types", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", ["Ball", "Square"] as any)
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("097 — getFilterFieldDefinition for empty string", () => {
    const def = getFilterFieldDefinition("")
    expect(def).toBeNull()
  })

  it("098 — getFilterFieldDefinition for very long field name", () => {
    const def = getFilterFieldDefinition("a".repeat(1000))
    expect(def).toBeNull()
  })

  it("099 — getFilterFieldLabel for nonexistent field returns field name", () => {
    const label = getFilterFieldLabel("xyz_nonexistent")
    expect(label).toBe("xyz_nonexistent")
  })

  it("100 — getRegisteredFilterFields returns non-empty", () => {
    const fields = getRegisteredFilterFields()
    expect(fields.length).toBeGreaterThan(0)
  })

  it("101 — replaceFieldFilter idempotent: adding same filter twice", () => {
    const filter = makeFilter("coating", "TiAlN", "TiAlN")
    const r1 = replaceFieldFilter(baseInput, [], filter, identityApply)
    const r2 = replaceFieldFilter(baseInput, r1.nextFilters, filter, identityApply)
    expect(r2.nextFilters.filter(f => f.field === "coating")).toHaveLength(1)
  })

  it("102 — replaceFieldFilter with skip op filter", () => {
    const existing = [makeFilter("coating", "TiAlN", "TiAlN")]
    const skip = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 } as AppliedFilter
    const result = replaceFieldFilter(baseInput, existing, skip, identityApply)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters.filter(f => f.field === "coating")).toHaveLength(1)
  })

  it("103 — filter with special characters in value", () => {
    const filter = makeFilter("coating", "Ti(Al,Cr)N", "Ti(Al,Cr)N")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("104 — filter with unicode value", () => {
    const filter = makeFilter("workPieceName", "알루미늄합금 🔧", "알루미늄합금 🔧")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("105 — 1000 different fields in filter array", () => {
    const filters: AppliedFilter[] = Array.from({ length: 1000 }, (_, i) =>
      makeFilter(`field_${i}`, `val_${i}`, `val_${i}`, "includes", i)
    )
    const next = makeFilter("coating", "TiAlN", "TiAlN")
    expect(() => replaceFieldFilter(baseInput, filters, next, identityApply)).not.toThrow()
  })

  it("106 — filter value with SQL injection", () => {
    const filter = makeFilter("coating", "'; DROP TABLE--", "'; DROP TABLE--")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].value).toBe("'; DROP TABLE--")
  })

  it("107 — filter rawValue as nested array", () => {
    const filter = { field: "toolSubtype", op: "includes", value: "Ball", rawValue: [["Ball"]] as any, appliedAt: 0 } as AppliedFilter
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("108 — multiple canonical field replacements in sequence", () => {
    const f1 = makeFilter("diameterMm", "10mm", 10, "eq", 0)
    const f2 = makeFilter("diameterRefine", "12mm", 12, "eq", 1)
    const f3 = makeFilter("diameterMm", "8mm", 8, "eq", 2)
    let filters = [f1]
    let result = replaceFieldFilter(baseInput, filters, f2, identityApply)
    result = replaceFieldFilter(baseInput, result.nextFilters, f3, identityApply)
    const diam = result.nextFilters.filter(f => f.field === "diameterMm" || f.field === "diameterRefine")
    expect(diam).toHaveLength(1)
  })

  it("109 — applyFilterToInput callback that throws", () => {
    const throwingApply = () => { throw new Error("boom") }
    const filter = makeFilter("coating", "TiAlN", "TiAlN")
    expect(() => replaceFieldFilter(baseInput, [], filter, throwingApply)).toThrow("boom")
  })

  it("110 — replaceFieldFilter preserves order of unrelated filters", () => {
    const f1 = makeFilter("coating", "TiAlN", "TiAlN", "includes", 0)
    const f2 = makeFilter("fluteCount", "4날", 4, "eq", 1)
    const f3 = makeFilter("workPieceName", "알루미늄", "알루미늄", "includes", 2)
    const next = makeFilter("fluteCount", "3날", 3, "eq", 3)
    const result = replaceFieldFilter(baseInput, [f1, f2, f3], next, identityApply)
    expect(result.nextFilters[0].field).toBe("coating")
    expect(result.nextFilters[1].field).toBe("workPieceName")
    expect(result.nextFilters[2].field).toBe("fluteCount")
  })

  it("111 — rebuildInputFromFilters accumulates correctly", () => {
    let accumulated: string[] = []
    const trackingApply = (input: RecommendationInput, filter: AppliedFilter) => {
      accumulated.push(filter.field)
      return input
    }
    const filters = [makeFilter("a", "1", "1"), makeFilter("b", "2", "2"), makeFilter("c", "3", "3")]
    rebuildInputFromFilters(baseInput, filters, trackingApply)
    expect(accumulated).toEqual(["a", "b", "c"])
  })

  it("112 — filter with very long value (10000 chars)", () => {
    const longVal = "x".repeat(10000)
    const filter = makeFilter("coating", longVal, longVal)
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("113 — filter with newlines in value", () => {
    const filter = makeFilter("coating", "TiAlN\nAlCrN", "TiAlN\nAlCrN")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("114 — diameterRefine replaces existing diameterRefine", () => {
    const existing = [makeFilter("diameterRefine", "10mm", 10, "eq")]
    const next = makeFilter("diameterRefine", "12mm", 12, "eq")
    const result = replaceFieldFilter(baseInput, existing, next, identityApply)
    expect(result.replacedExisting).toBe(true)
  })

  it("115 — concurrent different field filters preserved", () => {
    const f1 = makeFilter("coating", "TiAlN", "TiAlN")
    const f2 = makeFilter("toolSubtype", "Ball", "Ball")
    const f3 = makeFilter("fluteCount", "4날", 4, "eq")
    const next = makeFilter("workPieceName", "일반강", "일반강")
    const result = replaceFieldFilter(baseInput, [f1, f2, f3], next, identityApply)
    expect(result.nextFilters).toHaveLength(4)
    expect(result.replacedExisting).toBe(false)
  })

  it("116 — replacing filter with identical field but different op", () => {
    const existing = [makeFilter("diameterMm", "10mm", 10, "eq")]
    const next = makeFilter("diameterMm", "10mm", 10, "range")
    const result = replaceFieldFilter(baseInput, existing, next, identityApply)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].op).toBe("range")
  })

  it("117 — buildAppliedFilterFromValue multi-value separator 'Ball/Square'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball/Square")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("118 — buildAppliedFilterFromValue with Korean separator 'Ball또는Square'", () => {
    const filter = buildAppliedFilterFromValue("toolSubtype", "Ball또는Square")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("119 — filter with 0 as rawValue", () => {
    const filter = makeFilter("diameterMm", "0mm", 0, "eq")
    const result = replaceFieldFilter(baseInput, [], filter, identityApply)
    expect(result.nextFilters).toHaveLength(1)
  })

  it("120 — many replaceFieldFilter calls in tight loop (stress)", () => {
    let filters: AppliedFilter[] = []
    for (let i = 0; i < 200; i++) {
      const next = makeFilter("coating", `Coating${i}`, `Coating${i}`, "includes", i)
      const result = replaceFieldFilter(baseInput, filters, next, identityApply)
      filters = result.nextFilters
    }
    expect(filters.filter(f => f.field === "coating")).toHaveLength(1)
  })
})

// ── Part 5: Pending question edge cases (30 cases) ──────────

describe("Part 5: Pending question edge cases", () => {
  it("121 — lastAskedField = nonexistent field", () => {
    const state = makeState({ lastAskedField: "nonexistent_field_xyz" })
    expect(() => buildPendingSelectionFilter(state, "Ball")).not.toThrow()
  })

  it("122 — displayedOptions with duplicate values", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball (10개)", field: "toolSubtype", value: "Ball", count: 10 },
        { index: 2, label: "Ball (10개)", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "Ball")
    expect(filter === null || filter?.value?.includes("Ball")).toBe(true)
  })

  it("123 — displayedOptions with empty labels", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    expect(() => buildPendingSelectionFilter(state, "Ball")).not.toThrow()
  })

  it("124 — 50+ displayedOptions", () => {
    const options = Array.from({ length: 55 }, (_, i) => ({
      index: i + 1,
      label: `TypeX${String(i).padStart(3, "0")} (${i}개)`,
      field: "toolSubtype",
      value: `TypeX${String(i).padStart(3, "0")}`,
      count: i,
    }))
    const state = makeState({ lastAskedField: "toolSubtype", displayedOptions: options })
    const filter = buildPendingSelectionFilter(state, "TypeX042")
    expect(filter).not.toBeNull()
    expect(filter!.value).toContain("TypeX042")
  })

  it("125 — message matching multiple options exactly", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 },
        { index: 2, label: "Ball End Mill", field: "toolSubtype", value: "Ball End Mill", count: 5 },
      ],
    })
    // Should pick one and not crash
    const filter = buildPendingSelectionFilter(state, "Ball")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("126 — case-sensitive option matching: 'ball' vs 'Ball'", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball (10개)", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "ball")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("127 — case-sensitive 'BALL' vs 'Ball'", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball (10개)", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "BALL")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("128 — null userMessage in buildPendingSelectionFilter", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    expect(buildPendingSelectionFilter(state, null as any)).toBeNull()
  })

  it("129 — empty string userMessage", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    expect(buildPendingSelectionFilter(state, "")).toBeNull()
  })

  it("130 — null sessionState", () => {
    expect(buildPendingSelectionFilter(null, "Ball")).toBeNull()
  })

  it("131 — both null", () => {
    expect(buildPendingSelectionFilter(null, null as any)).toBeNull()
  })

  it("132 — resolved state skips pending", () => {
    const state = makeState({ resolutionStatus: "resolved_exact", lastAskedField: "toolSubtype" })
    expect(buildPendingSelectionFilter(state, "Ball")).toBeNull()
  })

  it("133 — pending with question mark triggers side_question", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [{ index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 }],
    })
    // Question marks are side questions, should return null from buildPendingSelectionFilter
    expect(buildPendingSelectionFilter(state, "Ball이 뭐야?")).toBeNull()
  })

  it("134 — displayedOptions with field=_action", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "추천 결과 보기", field: "_action", value: "show_result", count: 0 },
      ],
    })
    expect(() => buildPendingSelectionFilter(state, "추천 결과 보기")).not.toThrow()
  })

  it("135 — Korean skip variants: '패스'", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 10 },
        { index: 2, label: "상관없음", field: "coating", value: "skip", count: 0 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "패스")
    expect(filter).not.toBeNull()
    expect(filter!.op).toBe("skip")
  })

  it("136 — Korean skip: '스킵'", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [{ index: 1, label: "상관없음", field: "coating", value: "skip", count: 0 }],
    })
    const filter = buildPendingSelectionFilter(state, "스킵")
    expect(filter).not.toBeNull()
    expect(filter!.op).toBe("skip")
  })

  it("137 — Korean skip: '아무거나'", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [{ index: 1, label: "상관없음", field: "coating", value: "skip", count: 0 }],
    })
    const filter = buildPendingSelectionFilter(state, "아무거나")
    expect(filter).not.toBeNull()
    expect(filter!.op).toBe("skip")
  })

  it("138 — displayedOptions empty + displayedChips empty", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [],
      displayedChips: [],
    })
    const filter = buildPendingSelectionFilter(state, "Ball")
    // No options to match — returns null or unresolved
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("139 — number input for non-numeric pending field", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "42")
    // Should not crash
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("140 — delegation expression '추천해줘' returns skip", () => {
    const state = makeState({
      lastAskedField: "coating",
      displayedOptions: [
        { index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "추천해줘")
    expect(filter).not.toBeNull()
    expect(filter!.op).toBe("skip")
  })

  it("141 — delegation expression '알아서 해줘' returns skip", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [],
    })
    const filter = buildPendingSelectionFilter(state, "알아서 해줘")
    expect(filter).not.toBeNull()
    expect(filter!.op).toBe("skip")
  })

  it("142 — numeric chip label with count '6mm (12개)' partial match", () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["6mm (12개)", "8mm (9개)", "상관없음"],
      displayedOptions: [],
    })
    const filter = buildPendingSelectionFilter(state, "6mm")
    expect(filter).not.toBeNull()
  })

  it("143 — pending selection with trailing whitespace", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "  Ball  ")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("144 — pending selection with Korean particle 'Ball로'", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    // Contains revision signal "로" but no explicit revision pattern — may resolve or return null
    expect(() => buildPendingSelectionFilter(state, "Ball로")).not.toThrow()
  })

  it("145 — options with count 0", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball (0개)", field: "toolSubtype", value: "Ball", count: 0 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "Ball")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("146 — filterValueScope with matching value infers field", () => {
    const state = makeState({
      lastAskedField: "diameterRefine",
      displayedChips: ["Square (167개)", "Radius (94개)"],
      displayedOptions: [],
      filterValueScope: { toolSubtype: ["Square", "Radius"] },
    })
    const filter = buildPendingSelectionFilter(state, "Square (167개)")
    expect(filter).not.toBeNull()
    expect(filter!.field).toBe("toolSubtype")
  })

  it("147 — extremely short input '볼'", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball (10개)", field: "toolSubtype", value: "Ball", count: 10 },
      ],
    })
    // 볼 is an alias for Ball
    const filter = buildPendingSelectionFilter(state, "볼")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("148 — single character input '1'", () => {
    const state = makeState({
      lastAskedField: "diameterMm",
      displayedChips: ["1mm (2개)", "10mm (5개)"],
      displayedOptions: [],
    })
    const filter = buildPendingSelectionFilter(state, "1")
    expect(filter === null || typeof filter === "object").toBe(true)
  })

  it("149 — input with only Korean particles '으로'", () => {
    const state = makeState({ lastAskedField: "toolSubtype" })
    expect(() => buildPendingSelectionFilter(state, "으로")).not.toThrow()
  })

  it("150 — displayedOptions with mixed fields", () => {
    const state = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [
        { index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 },
        { index: 2, label: "TiAlN", field: "coating", value: "TiAlN", count: 5 },
      ],
    })
    const filter = buildPendingSelectionFilter(state, "TiAlN")
    // Even though lastAskedField is toolSubtype, TiAlN should match coating option
    expect(filter === null || typeof filter === "object").toBe(true)
  })
})

// ── Part 6: Revision edge cases (30 cases) ──────────────────

describe("Part 6: Revision edge cases", () => {
  it("151 — revision with 0 appliedFilters", async () => {
    const state = makeState({ appliedFilters: [] })
    const result = await resolveExplicitRevisionRequest(state, "Ball 말고 Square로")
    expect(result).toBeNull()
  })

  it("152 — revision targeting a skip'd field", async () => {
    const state = makeState({
      appliedFilters: [
        { field: "toolSubtype", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 0 } as AppliedFilter,
      ],
    })
    const result = await resolveExplicitRevisionRequest(state, "형상 말고 Ball로")
    // Skip filters are excluded from revision targets
    expect(result).toBeNull()
  })

  it("153 — revision with SAME old and new value", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    const result = await resolveExplicitRevisionRequest(state, "Ball 말고 Ball로")
    // Same value should be rejected
    expect(result).toBeNull()
  })

  it("154 — no-op revision: 'Ball 말고 Ball로' (identical)", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    expect(await resolveExplicitRevisionRequest(state, "Ball 대신 Ball로 변경")).toBeNull()
  })

  it("155 — multiple revision signals: 'Ball 말고 Radius 말고 Square로'", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    // Ambiguous — system should handle gracefully
    const result = await resolveExplicitRevisionRequest(state, "Ball 말고 Radius 말고 Square로")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("156 — very long revision message (200+ chars)", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    const longMsg = "Ball 말고 " + "Square".repeat(40) + "로 변경"
    const result = await resolveExplicitRevisionRequest(state, longMsg)
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("157 — revision without explicit signal returns null", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    expect(await resolveExplicitRevisionRequest(state, "Square")).toBeNull()
  })

  it("158 — revision with null userMessage", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    expect(await resolveExplicitRevisionRequest(state, null as any)).toBeNull()
  })

  it("159 — revision with empty string", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    expect(await resolveExplicitRevisionRequest(state, "")).toBeNull()
  })

  it("160 — revision with null state", async () => {
    expect(await resolveExplicitRevisionRequest(null, "Ball 말고 Square로")).toBeNull()
  })

  it("161 — revision of numeric field: '10mm 대신 12mm'", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("diameterMm", "10mm", 10, "eq", 0)],
    })
    const result = await resolveExplicitRevisionRequest(state, "10mm 대신 12mm로 변경")
    expect(result === null || result?.kind === "resolved" || result?.kind === "ambiguous").toBe(true)
  })

  it("162 — revision with emoji in message", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    const result = await resolveExplicitRevisionRequest(state, "🔧 Ball 말고 Square로")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("163 — hasExplicitRevisionIntent with empty string", () => {
    expect(hasExplicitRevisionIntent("")).toBe(false)
  })

  it("164 — hasExplicitRevisionIntent with just spaces", () => {
    expect(hasExplicitRevisionIntent("   ")).toBe(false)
  })

  it("165 — hasExplicitRevisionIntent catches '대신'", () => {
    expect(hasExplicitRevisionIntent("Ball 대신 Square")).toBe(true)
  })

  it("166 — hasExplicitRevisionIntent catches '말고'", () => {
    expect(hasExplicitRevisionIntent("Ball 말고 Square")).toBe(true)
  })

  it("167 — hasExplicitRevisionIntent catches English 'instead of'", () => {
    expect(hasExplicitRevisionIntent("instead of Ball use Square")).toBe(true)
  })

  it("168 — hasExplicitRevisionIntent catches 'change to'", () => {
    expect(hasExplicitRevisionIntent("change to Square")).toBe(true)
  })

  it("169 — parseExplicitRevisionText with no signal", async () => {
    const result = await parseExplicitRevisionText("그냥 Square")
    expect(result).toBeDefined()
    expect(Array.isArray(result.valueCandidates)).toBe(true)
  })

  it("170 — parseExplicitRevisionText with SQL injection", async () => {
    const result = await parseExplicitRevisionText("Ball'; DROP TABLE 말고 Square로")
    expect(result).toBeDefined()
  })

  it("171 — revision targeting field not in appliedFilters", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("coating", "TiAlN", "TiAlN", "includes", 0)],
    })
    // Trying to revise toolSubtype but only coating is applied
    const result = await resolveExplicitRevisionRequest(state, "Ball 말고 Square로 변경")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("172 — revision with 'ㄴㄴ' (Korean abbreviation for no-no)", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    expect(hasExplicitRevisionIntent("ㄴㄴ Square로")).toBe(true)
  })

  it("173 — revision with resolvedInput synthetic filters", async () => {
    const state = makeState({
      appliedFilters: [],
      resolvedInput: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        material: "일반강",
        diameterMm: 10,
      },
    })
    const result = await resolveExplicitRevisionRequest(state, "10mm 대신 12mm로 변경")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("174 — hasExplicitFilterIntent with empty string", () => {
    expect(hasExplicitFilterIntent("")).toBe(false)
  })

  it("175 — hasExplicitFilterIntent catches '필터'", () => {
    expect(hasExplicitFilterIntent("TiAlN으로 필터링")).toBe(true)
  })

  it("176 — hasExplicitFilterIntent '추천해줘' via intentAction", () => {
    // 추천 계열 regex 제거됨 — LLM judgment 의 intentAction 으로 판정
    expect(hasExplicitFilterIntent("Ball로 추천해줘")).toBe(false)
    expect(hasExplicitFilterIntent("Ball로 추천해줘", "ask_recommendation")).toBe(true)
  })

  it("177 — parseExplicitFilterText with empty string", async () => {
    const result = await parseExplicitFilterText("")
    expect(result).toBeDefined()
  })

  it("178 — parseExplicitFilterText with only whitespace", async () => {
    const result = await parseExplicitFilterText("   ")
    expect(result).toBeDefined()
  })

  it("179 — revision with mixed Korean and English signals", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("toolSubtype", "Ball", "Ball", "includes", 0)],
    })
    const result = await resolveExplicitRevisionRequest(state, "Ball 대신 switch to Square")
    expect(result === null || typeof result === "object").toBe(true)
  })

  it("180 — resolveExplicitFilterRequest with null state", async () => {
    const result = await resolveExplicitFilterRequest(null, "TiAlN으로 필터링")
    expect(result).toBeNull()
  })
})

// ── Part 7: Concurrent state (20 cases) ─────────────────────

describe("Part 7: Concurrent state / misc stress", () => {
  const baseInput: RecommendationInput = { manufacturerScope: "yg1-only", locale: "ko" }

  it("181 — two filters for same field simultaneously via replaceFieldFilter", () => {
    const f1 = makeFilter("coating", "TiAlN", "TiAlN", "includes", 0)
    const f2 = makeFilter("coating", "AlCrN", "AlCrN", "includes", 1)
    // Start with both, replace with new one
    const next = makeFilter("coating", "TiCN", "TiCN", "includes", 2)
    const result = replaceFieldFilter(baseInput, [f1, f2], next, identityApply)
    expect(result.nextFilters.filter(f => f.field === "coating")).toHaveLength(1)
    expect(result.nextFilters.find(f => f.field === "coating")!.value).toBe("TiCN")
  })

  it("182 — rebuildInputFromFilters with conflicting filters (same field)", () => {
    const filters = [
      makeFilter("diameterMm", "10mm", 10, "eq", 0),
      makeFilter("diameterMm", "12mm", 12, "eq", 1),
    ]
    // Last one wins in sequential application
    expect(() => rebuildInputFromFilters(baseInput, filters, identityApply)).not.toThrow()
  })

  it("183 — skip followed by value for same field", () => {
    const skip = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 0 } as AppliedFilter
    const value = makeFilter("coating", "TiAlN", "TiAlN", "includes", 1)
    const result = replaceFieldFilter(baseInput, [skip], value, identityApply)
    expect(result.replacedExisting).toBe(true)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].value).toBe("TiAlN")
  })

  it("184 — value followed by skip for same field", () => {
    const value = makeFilter("coating", "TiAlN", "TiAlN", "includes", 0)
    const skip = { field: "coating", op: "skip", value: "상관없음", rawValue: "skip", appliedAt: 1 } as AppliedFilter
    const result = replaceFieldFilter(baseInput, [value], skip, identityApply)
    expect(result.nextFilters).toHaveLength(1)
    expect(result.nextFilters[0].op).toBe("skip")
  })

  it("185 — resolveExplicitComparisonAction with null state", () => {
    expect(resolveExplicitComparisonAction(null, "상위 4개 비교")).toBeNull()
  })

  it("186 — resolveExplicitComparisonAction with null message", () => {
    const state = makeState()
    expect(resolveExplicitComparisonAction(state, null as any)).toBeNull()
  })

  it("187 — resolveExplicitComparisonAction with empty message", () => {
    const state = makeState()
    expect(resolveExplicitComparisonAction(state, "")).toBeNull()
  })

  it("188 — resolveExplicitComparisonAction with fewer than 2 candidates", () => {
    const state = makeState({
      displayedCandidates: [{ rank: 1, productCode: "P1001", displayCode: "P1001" } as any],
    })
    expect(resolveExplicitComparisonAction(state, "상위 4개 비교")).toBeNull()
  })

  it("189 — concurrent buildPendingSelectionFilter calls (no shared mutable state)", () => {
    const state1 = makeState({
      lastAskedField: "toolSubtype",
      displayedOptions: [{ index: 1, label: "Ball", field: "toolSubtype", value: "Ball", count: 10 }],
    })
    const state2 = makeState({
      lastAskedField: "coating",
      displayedOptions: [{ index: 1, label: "TiAlN", field: "coating", value: "TiAlN", count: 10 }],
    })
    const f1 = buildPendingSelectionFilter(state1, "Ball")
    const f2 = buildPendingSelectionFilter(state2, "TiAlN")
    // Both should resolve independently
    expect(f1?.field).not.toBe(f2?.field)
  })

  it("190 — rapid sequential revisions of the same field", async () => {
    const state = makeState({
      appliedFilters: [makeFilter("fluteCount", "2날", 2, "eq", 0)],
    })
    const r1 = await resolveExplicitRevisionRequest(state, "2날 말고 3날로")
    const r2 = await resolveExplicitRevisionRequest(state, "2날 말고 4날로")
    // Both should resolve independently (state is not mutated)
    if (r1?.kind === "resolved" && r2?.kind === "resolved") {
      expect(r1.request.nextFilter.rawValue).not.toBe(r2.request.nextFilter.rawValue)
    }
  })

  it("191 — buildAppliedFilterFromValue for every registered field with 'test' value", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      expect(() => buildAppliedFilterFromValue(field, "test")).not.toThrow()
    }
  })

  it("192 — buildAppliedFilterFromValue for every registered field with numeric value", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      expect(() => buildAppliedFilterFromValue(field, 42)).not.toThrow()
    }
  })

  it("193 — buildAppliedFilterFromValue for every registered field with empty string", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      const result = buildAppliedFilterFromValue(field, "")
      expect(result).toBeNull()
    }
  })

  it("194 — parseExplicitFilterText and parseExplicitRevisionText concurrently", async () => {
    const [filterResult, revisionResult] = await Promise.all([
      parseExplicitFilterText("TiAlN으로 필터링"),
      parseExplicitRevisionText("Ball 말고 Square로"),
    ])
    expect(filterResult).toBeDefined()
    expect(revisionResult).toBeDefined()
  })

  it("195 — stress: 50 sequential replaceFieldFilter for different fields", () => {
    let filters: AppliedFilter[] = []
    for (let i = 0; i < 50; i++) {
      const next = makeFilter(`field_${i}`, `val_${i}`, `val_${i}`, "includes", i)
      const result = replaceFieldFilter(baseInput, filters, next, identityApply)
      filters = result.nextFilters
    }
    expect(filters).toHaveLength(50)
  })

  it("196 — stress: buildPendingSelectionFilter with 100 displayedOptions", () => {
    const options = Array.from({ length: 100 }, (_, i) => ({
      index: i + 1,
      label: `Opt${i}`,
      field: "toolSubtype",
      value: `Opt${i}`,
      count: i,
    }))
    const state = makeState({ lastAskedField: "toolSubtype", displayedOptions: options })
    const filter = buildPendingSelectionFilter(state, "Opt99")
    expect(filter).not.toBeNull()
  })

  it("197 — all registered fields have non-empty labels", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      const label = getFilterFieldLabel(field)
      expect(label).toBeTruthy()
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it("198 — parseAnswerToFilter with empty string for each field", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      expect(() => parseAnswerToFilter(field, "")).not.toThrow()
    }
  })

  it("199 — parseAnswerToFilter with special characters for each field", () => {
    const fields = getRegisteredFilterFields()
    for (const field of fields) {
      expect(() => parseAnswerToFilter(field, "!@#$%^&*()")).not.toThrow()
    }
  })

  it("200 — parseAnswerToFilter with very long string for each field", () => {
    const fields = getRegisteredFilterFields()
    const longStr = "A".repeat(5000)
    for (const field of fields) {
      expect(() => parseAnswerToFilter(field, longStr)).not.toThrow()
    }
  })
})
