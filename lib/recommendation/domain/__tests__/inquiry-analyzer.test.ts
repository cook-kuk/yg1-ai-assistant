import { describe, expect, it } from "vitest"

import { analyzeInquiry, getRedirectResponse, type InquiryAnalysis } from "../inquiry-analyzer"
import {
  extractDiameter,
  extractFluteCount,
  extractMaterial,
  extractOperation,
  extractCoating,
  normalizeInput,
  mergeInputs,
} from "../input-normalizer"
import {
  parseOperationShapeSelections,
  getOperationShapeSearchTexts,
  normalizeOperationShapeToken,
  getAppShapesForOperation,
  getOperationLabel,
} from "../operation-resolver"

// ═══════════════════════════════════════════════════════════════
// 1. Inquiry Analyzer — analyzeInquiry
// ═══════════════════════════════════════════════════════════════
describe("analyzeInquiry", () => {
  // ── Noise / nonsense ───────────────────────────────────────
  it("empty string → noise, hard_redirect", () => {
    const r = analyzeInquiry("")
    expect(r.signalStrength).toBe("noise")
    expect(r.suggestedAction).toBe("hard_redirect")
    expect(r.domainRelevance).toBe("off_domain")
  })

  it("ㅋㅋㅋ → noise, nonsense", () => {
    const r = analyzeInquiry("ㅋㅋㅋ")
    expect(r.signalStrength).toBe("noise")
    expect(r.seriousness).toBe("nonsense")
  })

  it("ㅎㅎ → noise (short nonsense pattern)", () => {
    const r = analyzeInquiry("ㅎㅎ")
    expect(r.signalStrength).toBe("noise")
  })

  // ── Greetings ──────────────────────────────────────────────
  it("안녕하세요 → weak, answer_general (greeting)", () => {
    const r = analyzeInquiry("안녕하세요")
    expect(r.signalStrength).toBe("weak")
    expect(r.suggestedAction).toBe("answer_general")
    expect(r.inputForm).toBe("smalltalk")
  })

  it("hello → greeting", () => {
    const r = analyzeInquiry("hello")
    expect(r.signalStrength).toBe("weak")
    expect(r.domainRelevance).toBe("adjacent")
  })

  // ── Narrowing responses ────────────────────────────────────
  it("상관없어 → proceed_retrieval (narrowing response)", () => {
    const r = analyzeInquiry("상관없어")
    expect(r.suggestedAction).toBe("proceed_retrieval")
    expect(r.signalStrength).toBe("moderate")
  })

  it("skip → proceed_retrieval (narrowing)", () => {
    const r = analyzeInquiry("skip")
    expect(r.suggestedAction).toBe("proceed_retrieval")
  })

  it("10mm → proceed_retrieval (narrowing numeric response)", () => {
    const r = analyzeInquiry("10mm")
    expect(r.suggestedAction).toBe("proceed_retrieval")
  })

  // ── App/UI questions ───────────────────────────────────────
  it("매칭 점수가 뭐야? → answer_general (app question)", () => {
    const r = analyzeInquiry("매칭 점수가 뭐야?")
    expect(r.suggestedAction).toBe("answer_general")
    expect(r.domainRelevance).toBe("adjacent")
  })

  // ── Domain knowledge questions (coating/material) ──────────
  it("tialn 코팅 특징이 뭐야 → answer_general (app question pattern)", () => {
    const r = analyzeInquiry("tialn 코팅 특징이 뭐야")
    expect(r.suggestedAction).toBe("answer_general")
    expect(r.domainRelevance).toBe("adjacent")
  })

  it("tialn 코팅 차이점 알려줘 → answer_general (domain knowledge, coating)", () => {
    const r = analyzeInquiry("tialn 코팅 차이점 알려줘")
    expect(r.suggestedAction).toBe("answer_general")
    expect(r.domainRelevance).toBe("on_domain")
  })

  // ── Off-domain ─────────────────────────────────────────────
  it("오늘 날씨 어때 → off_domain, answer_general", () => {
    const r = analyzeInquiry("오늘 날씨 어때")
    expect(r.domainRelevance).toBe("off_domain")
    expect(r.suggestedAction).toBe("answer_general")
  })

  // ── Smalltalk ──────────────────────────────────────────────
  it("심심해 → smalltalk, off_domain", () => {
    const r = analyzeInquiry("심심해")
    // "심심" is in OFF_DOMAIN_KEYWORDS and SMALLTALK_PATTERNS — narrowing is checked first
    expect(r.domainRelevance).toBe("off_domain")
  })

  // ── Strong signal (3+ domain keywords) ─────────────────────
  it("알루미늄 10mm 엔드밀 황삭 → strong signal, proceed_retrieval", () => {
    const r = analyzeInquiry("알루미늄 10mm 엔드밀 황삭")
    expect(r.signalStrength).toBe("strong")
    expect(r.suggestedAction).toBe("proceed_retrieval")
    expect(r.hasToolKeyword).toBe(true)
    expect(r.hasMaterialKeyword).toBe(true)
    expect(r.hasDimensionKeyword).toBe(true)
    expect(r.hasOperationKeyword).toBe(true)
    expect(r.extractedKeywordCount).toBeGreaterThanOrEqual(3)
  })

  // ── Product code → strong ──────────────────────────────────
  it("CE580 엔드밀 → strong (product code + tool keyword)", () => {
    const r = analyzeInquiry("CE580 엔드밀")
    expect(r.signalStrength).toBe("strong")
    expect(r.hasProductCode).toBe(true)
  })

  // ── Moderate signal (1-2 keywords) ─────────────────────────
  it("엔드밀 추천해줘 → moderate, proceed_retrieval", () => {
    const r = analyzeInquiry("엔드밀 추천해줘")
    expect(r.signalStrength).toBe("moderate")
    expect(r.suggestedAction).toBe("proceed_retrieval")
    expect(r.hasToolKeyword).toBe(true)
  })

  it("스테인리스 가공 → moderate, on_domain", () => {
    const r = analyzeInquiry("스테인리스 가공")
    expect(r.domainRelevance).toBe("on_domain")
  })

  // ── Recommendation signal without domain keywords ──────────
  it("추천해줘 → proceed_retrieval (matches narrowing pattern)", () => {
    const r = analyzeInquiry("추천해줘")
    expect(r.suggestedAction).toBe("proceed_retrieval")
    expect(r.signalStrength).toBe("moderate")
  })

  it("좋은 공구 골라줘 → ask_clarification (recommendation signal, no domain kw)", () => {
    const r = analyzeInquiry("좋은 공구 골라줘")
    expect(r.suggestedAction).toBe("ask_clarification")
    expect(r.signalStrength).toBe("weak")
  })

  // ── Pure number → diameter guess ───────────────────────────
  it("10 → moderate, single_word (diameter guess)", () => {
    const r = analyzeInquiry("10")
    expect(r.signalStrength).toBe("moderate")
    expect(r.inputForm).toBe("single_word")
    expect(r.hasDimensionKeyword).toBe(true)
  })

  // ── Fallback ───────────────────────────────────────────────
  it("아무 의미 없는 긴 문장 → weak, off_domain fallback", () => {
    const r = analyzeInquiry("오늘 점심 뭐 먹을지 고민이야")
    expect(r.signalStrength).toBe("weak")
  })

  // ── General technical knowledge ────────────────────────────
  it("엔드밀 수명 늘리는 방법 → answer_general (general knowledge)", () => {
    const r = analyzeInquiry("엔드밀 수명 늘리는 방법")
    expect(r.suggestedAction).toBe("answer_general")
    expect(r.domainRelevance).toBe("on_domain")
  })
})

// ═══════════════════════════════════════════════════════════════
// 2. getRedirectResponse
// ═══════════════════════════════════════════════════════════════
describe("getRedirectResponse", () => {
  function makeAnalysis(overrides: Partial<InquiryAnalysis>): InquiryAnalysis {
    return {
      signalStrength: "noise",
      domainRelevance: "off_domain",
      inputForm: "nonsense",
      ambiguityLevel: "high",
      seriousness: "nonsense",
      hasToolKeyword: false,
      hasMaterialKeyword: false,
      hasDimensionKeyword: false,
      hasOperationKeyword: false,
      hasProductCode: false,
      extractedKeywordCount: 0,
      recoverability: "not_recoverable",
      suggestedAction: "hard_redirect",
      reason: "test",
      ...overrides,
    }
  }

  it("hard_redirect → returns guide text with chips", () => {
    const resp = getRedirectResponse(makeAnalysis({ suggestedAction: "hard_redirect" }))
    expect(resp.text).toContain("절삭공구")
    expect(resp.chips.length).toBeGreaterThan(0)
    expect(resp.showCandidates).toBe(false)
  })

  it("ask_clarification → asks for material", () => {
    const resp = getRedirectResponse(makeAnalysis({ suggestedAction: "ask_clarification" }))
    expect(resp.text).toContain("재질")
    expect(resp.chips.length).toBeGreaterThan(0)
  })

  it("answer_general → empty text (LLM handles)", () => {
    const resp = getRedirectResponse(makeAnalysis({ suggestedAction: "answer_general" }))
    expect(resp.text).toBe("")
  })
})

// ═══════════════════════════════════════════════════════════════
// 3. Input Normalizer — extractDiameter
// ═══════════════════════════════════════════════════════════════
describe("extractDiameter", () => {
  it("10mm → 10", () => expect(extractDiameter("10mm")).toBe(10))
  it("6.5mm → 6.5", () => expect(extractDiameter("6.5mm")).toBe(6.5))
  it("12파이 → 12", () => expect(extractDiameter("12파이")).toBe(12))
  it("직경 8 → 8", () => expect(extractDiameter("직경 8")).toBe(8))
  it("φ16 → 16", () => expect(extractDiameter("φ16")).toBe(16))
  it("D20 → 20", () => expect(extractDiameter("D20")).toBe(20))
  it("SKD11 material code → null", () => expect(extractDiameter("SKD11 가공")).toBeNull())
  it("no diameter → null", () => expect(extractDiameter("엔드밀 추천")).toBeNull())
  it("out of range (300mm) → null", () => expect(extractDiameter("300mm")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 4. Input Normalizer — extractFluteCount
// ═══════════════════════════════════════════════════════════════
describe("extractFluteCount", () => {
  it("4날 → 4", () => expect(extractFluteCount("4날")).toBe(4))
  it("2 flute → 2", () => expect(extractFluteCount("2 flute")).toBe(2))
  it("6F → 6", () => expect(extractFluteCount("6F")).toBe(6))
  it("out of range (1날) → null", () => expect(extractFluteCount("1날")).toBeNull())
  it("no flute info → null", () => expect(extractFluteCount("엔드밀")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 5. Input Normalizer — extractMaterial
// ═══════════════════════════════════════════════════════════════
describe("extractMaterial", () => {
  it("알루미늄 → 알루미늄", () => expect(extractMaterial("알루미늄 가공")).toBe("알루미늄"))
  it("SUS → 스테인리스", () => expect(extractMaterial("SUS304 가공")).toBe("스테인리스"))
  it("S45C → 탄소강", () => expect(extractMaterial("S45C 황삭")).toBe("탄소강"))
  it("titanium → 티타늄", () => expect(extractMaterial("titanium roughing")).toBe("티타늄"))
  it("unknown → null", () => expect(extractMaterial("뭔가 가공")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 6. Input Normalizer — extractOperation
// ═══════════════════════════════════════════════════════════════
describe("extractOperation", () => {
  it("황삭 → 황삭", () => expect(extractOperation("황삭 가공")).toBe("황삭"))
  it("finishing → 정삭", () => expect(extractOperation("finishing operation")).toBe("정삭"))
  it("슬롯 → 슬롯", () => expect(extractOperation("슬롯가공")).toBe("슬롯"))
  it("unknown → null", () => expect(extractOperation("일반 가공")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 7. Input Normalizer — extractCoating
// ═══════════════════════════════════════════════════════════════
describe("extractCoating", () => {
  it("TiAlN → TiAlN", () => expect(extractCoating("TiAlN 코팅")).toBe("TiAlN"))
  it("dlc → DLC", () => expect(extractCoating("dlc 코팅 추천")).toBe("DLC"))
  it("no coating → null", () => expect(extractCoating("엔드밀")).toBeNull())
})

// ═══════════════════════════════════════════════════════════════
// 8. Input Normalizer — normalizeInput
// ═══════════════════════════════════════════════════════════════
describe("normalizeInput", () => {
  it("parses full Korean query into structured input", () => {
    const result = normalizeInput("알루미늄 10mm 4날 엔드밀 황삭 TiAlN")
    expect(result.material).toBe("알루미늄")
    expect(result.diameterMm).toBe(10)
    expect(result.flutePreference).toBe(4)
    expect(result.operationType).toBe("황삭")
    expect(result.coatingPreference).toBe("TiAlN")
    expect(result.manufacturerScope).toBe("yg1-only")
    expect(result.locale).toBe("ko")
  })

  it("returns undefined fields when nothing is extractable", () => {
    const result = normalizeInput("안녕하세요")
    expect(result.material).toBeUndefined()
    expect(result.diameterMm).toBeUndefined()
    expect(result.queryText).toBe("안녕하세요")
  })
})

// ═══════════════════════════════════════════════════════════════
// 9. Input Normalizer — mergeInputs
// ═══════════════════════════════════════════════════════════════
describe("mergeInputs", () => {
  it("override wins on explicit fields", () => {
    const base = normalizeInput("알루미늄 10mm 엔드밀")
    const merged = mergeInputs(base, { material: "스테인리스", diameterMm: 12 })
    expect(merged.material).toBe("스테인리스")
    expect(merged.diameterMm).toBe(12)
  })

  it("undefined override does not clobber base", () => {
    const base = normalizeInput("알루미늄 10mm")
    const merged = mergeInputs(base, { material: undefined })
    expect(merged.material).toBe("알루미늄")
    expect(merged.diameterMm).toBe(10)
  })
})

// ═══════════════════════════════════════════════════════════════
// 10. Operation Resolver — parseOperationShapeSelections
// ═══════════════════════════════════════════════════════════════
describe("parseOperationShapeSelections", () => {
  it("empty → []", () => {
    expect(parseOperationShapeSelections("")).toEqual([])
  })

  it("exact value passes through (Drilling)", () => {
    expect(parseOperationShapeSelections("Drilling")).toEqual(["Drilling"])
  })

  it("Korean alias 드릴 → Drilling", () => {
    expect(parseOperationShapeSelections("드릴")).toEqual(["Drilling"])
  })

  it("broad category 밀링 → multiple milling shapes", () => {
    const result = parseOperationShapeSelections("밀링")
    expect(result).toContain("Side_Milling")
    expect(result).toContain("Slotting")
    expect(result.length).toBeGreaterThanOrEqual(3)
  })

  it("comma-separated mixed input", () => {
    const result = parseOperationShapeSelections("Drilling, 슬롯")
    expect(result).toContain("Drilling")
    expect(result).toContain("Slotting")
  })

  it("unknown value kept as-is", () => {
    expect(parseOperationShapeSelections("CustomOp")).toEqual(["CustomOp"])
  })
})

// ═══════════════════════════════════════════════════════════════
// 11. Operation Resolver — normalizeOperationShapeToken
// ═══════════════════════════════════════════════════════════════
describe("normalizeOperationShapeToken", () => {
  it("drilling → Drilling", () => {
    expect(normalizeOperationShapeToken("drilling")).toBe("Drilling")
  })

  it("side milling → Side_Milling", () => {
    expect(normalizeOperationShapeToken("side milling")).toBe("Side_Milling")
  })

  it("unknown token returned trimmed", () => {
    expect(normalizeOperationShapeToken("  foo  ")).toBe("foo")
  })
})

// ═══════════════════════════════════════════════════════════════
// 12. Operation Resolver — getAppShapesForOperation
// ═══════════════════════════════════════════════════════════════
describe("getAppShapesForOperation", () => {
  it("홀가공 → all holemaking shapes normalized", () => {
    const result = getAppShapesForOperation("홀가공")
    expect(result).toContain("Drilling")
    expect(result).toContain("Reaming_Blind")
    expect(result).toContain("Reaming_Through")
  })
})

// ═══════════════════════════════════════════════════════════════
// 13. Operation Resolver — getOperationLabel
// ═══════════════════════════════════════════════════════════════
describe("getOperationLabel", () => {
  it("returns first resolved value as label", () => {
    expect(getOperationLabel("드릴")).toBe("Drilling")
  })

  it("returns raw input when nothing resolves", () => {
    expect(getOperationLabel("")).toBe("")
  })
})

// ═══════════════════════════════════════════════════════════════
// 14. Operation Resolver — getOperationShapeSearchTexts
// ═══════════════════════════════════════════════════════════════
describe("getOperationShapeSearchTexts", () => {
  it("empty → []", () => {
    expect(getOperationShapeSearchTexts("")).toEqual([])
  })

  it("exact value returns at least that value", () => {
    const result = getOperationShapeSearchTexts("Drilling")
    expect(result).toContain("Drilling")
  })

  it("alias returns resolved + raw if different", () => {
    const result = getOperationShapeSearchTexts("드릴")
    expect(result).toContain("Drilling")
    // raw "드릴" should also be kept
    expect(result).toContain("드릴")
  })
})
