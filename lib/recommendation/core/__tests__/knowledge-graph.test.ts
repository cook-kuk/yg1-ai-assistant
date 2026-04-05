import { describe, it, expect } from "vitest"
import { resolveEntity, extractEntities, tryKGDecision } from "../knowledge-graph"

describe("knowledge-graph", () => {
  describe("resolveEntity", () => {
    it('"Square" → { field: "toolSubtype", canonical: "Square" }', () => {
      const result = resolveEntity("Square")
      expect(result).not.toBeNull()
      expect(result!.field).toBe("toolSubtype")
      expect(result!.canonical).toBe("Square")
    })

    it('"스퀘어" → Square alias 매칭', () => {
      const result = resolveEntity("스퀘어")
      expect(result).not.toBeNull()
      expect(result!.field).toBe("toolSubtype")
      expect(result!.canonical).toBe("Square")
    })
  })

  describe("extractEntities", () => {
    it('"TiAlN 빼고" → 부정 패턴 + 엔티티 감지', () => {
      const entities = extractEntities("TiAlN 빼고")
      expect(entities.length).toBeGreaterThanOrEqual(1)
      const coating = entities.find(e => e.field === "coating")
      expect(coating).toBeDefined()
      expect(coating!.canonical).toBe("TiAlN")
    })

    it('"4날 TiAlN Square" → 3개 엔티티 동시 추출', () => {
      const entities = extractEntities("4날 TiAlN Square")
      expect(entities.length).toBeGreaterThanOrEqual(3)
      const fields = entities.map(e => e.field)
      expect(fields).toContain("fluteCount")
      expect(fields).toContain("coating")
      expect(fields).toContain("toolSubtype")
    })

    it('"copper square 2flute 10mm" → 영어 alias 4개 추출', () => {
      const entities = extractEntities("copper square 2flute 10mm")
      expect(entities.length).toBeGreaterThanOrEqual(3)
      const fields = entities.map(e => e.field)
      expect(fields).toContain("toolSubtype")
      expect(fields).toContain("fluteCount")
      expect(fields).toContain("diameterMm")
    })
  })

  describe("tryKGDecision", () => {
    it('"TiAlN 빼고" → exclude 결정', () => {
      const result = tryKGDecision("TiAlN 빼고", null)
      expect(result.source).toBe("kg-exclude")
      expect(result.confidence).toBeGreaterThan(0.8)
      expect(result.decision).not.toBeNull()
    })

    it('KG miss ("금형 곡면 가공") → null 반환', () => {
      const result = tryKGDecision("금형 곡면 가공", null)
      expect(result.decision).toBeNull()
      expect(result.source).toBe("none")
    })
  })
})
