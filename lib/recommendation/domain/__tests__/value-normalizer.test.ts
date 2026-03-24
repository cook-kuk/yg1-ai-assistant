import { describe, it, expect } from "vitest"
import { normalizeFilterValue, extractDistinctFieldValues } from "../value-normalizer"

describe("value-normalizer: Korean→English matching", () => {
  it("카바이드 → Carbide (alias match)", () => {
    const result = normalizeFilterValue("카바이드", "toolMaterial", ["Carbide", "HSS"])
    expect(result.normalized).toBe("Carbide")
    expect(result.matchType).toBe("alias")
  })

  it("초경 → Carbide (alias match)", () => {
    const result = normalizeFilterValue("초경", "toolMaterial", ["Carbide", "HSS"])
    expect(result.normalized).toBe("Carbide")
    expect(result.matchType).toBe("alias")
  })

  it("고속도강 → HSS (alias match)", () => {
    const result = normalizeFilterValue("고속도강", "toolMaterial", ["Carbide", "HSS"])
    expect(result.normalized).toBe("HSS")
    expect(result.matchType).toBe("alias")
  })

  it("DLC → DLC (exact match)", () => {
    const result = normalizeFilterValue("DLC", "coating", ["DLC", "TiAlN", "AlCrN"])
    expect(result.normalized).toBe("DLC")
    expect(result.matchType).toBe("exact")
  })

  it("dlc → DLC (case-insensitive exact)", () => {
    const result = normalizeFilterValue("dlc", "coating", ["DLC", "TiAlN"])
    expect(result.normalized).toBe("DLC")
    expect(result.matchType).toBe("exact")
  })

  it("무코팅 → Bright Finish (alias)", () => {
    const result = normalizeFilterValue("무코팅", "coating", ["DLC", "TiAlN", "Bright Finish"])
    expect(result.normalized).toBe("Bright Finish")
    expect(result.matchType).toBe("alias")
  })

  it("스퀘어 → Square (alias)", () => {
    const result = normalizeFilterValue("스퀘어", "toolSubtype", ["Square", "Ball", "Radius"])
    expect(result.normalized).toBe("Square")
    expect(result.matchType).toBe("alias")
  })

  it("볼 → Ball (alias)", () => {
    const result = normalizeFilterValue("볼", "toolSubtype", ["Square", "Ball", "Radius"])
    expect(result.normalized).toBe("Ball")
    expect(result.matchType).toBe("alias")
  })

  it("Bright → Bright Finish (fuzzy substring)", () => {
    const result = normalizeFilterValue("Bright", "coating", ["DLC", "Bright Finish", "TiAlN"])
    expect(result.normalized).toBe("Bright Finish")
    expect(result.matchType).toBe("fuzzy")
  })

  it("unknown value returns original", () => {
    const result = normalizeFilterValue("xyz없는값", "coating", ["DLC", "TiAlN"])
    expect(result.normalized).toBe("xyz없는값")
    expect(result.matchType).toBe("none")
  })

  it("empty candidates returns original", () => {
    const result = normalizeFilterValue("DLC", "coating", [])
    expect(result.normalized).toBe("DLC")
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
    expect(values.length).toBe(2) // deduplicated
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
