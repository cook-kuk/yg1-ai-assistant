import { describe, it, expect } from "vitest"
import { normalizeFilterValue, extractDistinctFieldValues } from "../value-normalizer"

describe("value-normalizer: exact and fuzzy matching (no LLM)", () => {
  it("DLC → DLC (exact match)", async () => {
    const result = await normalizeFilterValue("DLC", "coating", ["DLC", "TiAlN", "AlCrN"])
    expect(result.normalized).toBe("DLC")
    expect(result.matchType).toBe("exact")
  })

  it("dlc → DLC (case-insensitive exact)", async () => {
    const result = await normalizeFilterValue("dlc", "coating", ["DLC", "TiAlN"])
    expect(result.normalized).toBe("DLC")
    expect(result.matchType).toBe("exact")
  })

  it("Bright → Bright Finish (fuzzy substring)", async () => {
    const result = await normalizeFilterValue("Bright", "coating", ["DLC", "Bright Finish", "TiAlN"])
    expect(result.normalized).toBe("Bright Finish")
    expect(result.matchType).toBe("fuzzy")
  })

  it("Carbide → Carbide (exact)", async () => {
    const result = await normalizeFilterValue("Carbide", "toolMaterial", ["Carbide", "HSS"])
    expect(result.normalized).toBe("Carbide")
    expect(result.matchType).toBe("exact")
  })

  it("unknown value without LLM returns original", async () => {
    const result = await normalizeFilterValue("카바이드", "toolMaterial", ["Carbide", "HSS"])
    // Without LLM provider, can't translate Korean → falls through to "none"
    expect(result.matchType).toBe("none")
    expect(result.normalized).toBe("카바이드")
  })

  it("empty candidates returns original", async () => {
    const result = await normalizeFilterValue("DLC", "coating", [])
    expect(result.normalized).toBe("DLC")
    expect(result.matchType).toBe("none")
  })

  it("partial 3-char overlap match", async () => {
    const result = await normalizeFilterValue("TiAl", "coating", ["DLC", "TiAlN", "AlCrN"])
    expect(result.normalized).toBe("TiAlN")
    expect(result.matchType).toBe("fuzzy")
  })

  it("'알루미늄 합금' → '알루미늄 단조 합금' (all-words-contained match)", async () => {
    const workPieceNames = [
      "알루미늄(연질)",
      "알루미늄 단조 합금",
      "알루미늄 주조 합금",
      "비철금속",
      "구리",
    ]
    const result = await normalizeFilterValue("알루미늄 합금", "workPieceName", workPieceNames)
    expect(result.matchType).toBe("fuzzy")
    expect(result.normalized).toMatch(/알루미늄.*합금/)
  })

  it("'알루미늄' → '알루미늄(연질)' (substring match)", async () => {
    const workPieceNames = ["알루미늄(연질)", "알루미늄 단조 합금", "비철금속"]
    const result = await normalizeFilterValue("알루미늄", "workPieceName", workPieceNames)
    expect(result.matchType).toBe("fuzzy")
    expect(result.normalized).toContain("알루미늄")
  })

  it("space-normalized exact match", async () => {
    const result = await normalizeFilterValue("Bright Finish", "coating", ["DLC", "BrightFinish", "TiAlN"])
    expect(result.normalized).toBe("BrightFinish")
    // "brightfinish" (space-removed) matches exact after normalization
    expect(result.matchType).toBe("exact")
  })
})

describe("value-normalizer: LLM translation", () => {
  it("카바이드 → Carbide with mock LLM", async () => {
    const mockProvider = {
      available: () => true,
      complete: async () => "Carbide",
    } as any

    const result = await normalizeFilterValue(
      "카바이드", "toolMaterial", ["Carbide", "HSS"], mockProvider
    )
    expect(result.normalized).toBe("Carbide")
    expect(result.matchType).toBe("llm")
  })

  it("고속도강 → HSS with mock LLM", async () => {
    const mockProvider = {
      available: () => true,
      complete: async () => "HSS",
    } as any

    const result = await normalizeFilterValue(
      "고속도강", "toolMaterial", ["Carbide", "HSS"], mockProvider
    )
    expect(result.normalized).toBe("HSS")
    expect(result.matchType).toBe("llm")
  })

  it("LLM returns NONE → falls back to original", async () => {
    const mockProvider = {
      available: () => true,
      complete: async () => "NONE",
    } as any

    const result = await normalizeFilterValue(
      "없는값", "coating", ["DLC", "TiAlN"], mockProvider
    )
    expect(result.normalized).toBe("없는값")
    expect(result.matchType).toBe("none")
  })

  it("LLM returns invalid value → falls back to original", async () => {
    const mockProvider = {
      available: () => true,
      complete: async () => "SomethingNotInCandidates",
    } as any

    const result = await normalizeFilterValue(
      "테스트", "coating", ["DLC", "TiAlN"], mockProvider
    )
    expect(result.normalized).toBe("테스트")
    expect(result.matchType).toBe("none")
  })

  it("LLM failure → falls back to original", async () => {
    const mockProvider = {
      available: () => true,
      complete: async () => { throw new Error("API error") },
    } as any

    const result = await normalizeFilterValue(
      "카바이드", "toolMaterial", ["Carbide", "HSS"], mockProvider
    )
    expect(result.normalized).toBe("카바이드")
    expect(result.matchType).toBe("none")
  })
})

describe("value-normalizer: extractDistinctFieldValues", () => {
  it("extracts coating values from ScoredProduct-like objects", () => {
    const candidates = [
      { product: { coating: "DLC" } },
      { product: { coating: "TiAlN" } },
      { product: { coating: "DLC" } },
    ]
    const values = extractDistinctFieldValues(candidates as any[], "coating")
    expect(values).toContain("DLC")
    expect(values).toContain("TiAlN")
    expect(values.length).toBe(2)
  })

  it("extracts from CandidateSnapshot-like objects (flat)", () => {
    const candidates = [
      { toolMaterial: "Carbide" },
      { toolMaterial: "HSS" },
    ]
    const values = extractDistinctFieldValues(candidates as any[], "toolMaterial")
    expect(values).toContain("Carbide")
    expect(values).toContain("HSS")
  })
})
