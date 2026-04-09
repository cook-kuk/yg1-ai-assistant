import { describe, it, expect } from "vitest"
import { extractEntities, tryKGDecision } from "../knowledge-graph"

/**
 * Regression tests for KG bugs fixed on 2026-04-09:
 *
 * Bug 1: extractEntities multi-entity 추출 누락 (numeric fields disabled)
 * Bug 2: "X 말고 다른거" → confidence 0 (X가 numeric entity인 경우)
 * Bug 3: §8 single-entity 과도 leak vs compound shank/material group 유지
 */

describe("KG bugfixes (2026-04-09)", () => {
  describe("Bug 1: extractEntities multi-entity w/ numeric", () => {
    it('"4날 TiAlN Square" returns fluteCount + coating + toolSubtype', () => {
      const entities = extractEntities("4날 TiAlN Square")
      const fields = new Set(entities.map(e => e.field))
      expect(fields.has("fluteCount")).toBe(true)
      expect(fields.has("coating")).toBe(true)
      expect(fields.has("toolSubtype")).toBe(true)
    })

    it('"copper square 2flute 10mm" returns 4 fields', () => {
      const entities = extractEntities("copper square 2flute 10mm")
      const fields = new Set(entities.map(e => e.field))
      expect(fields.has("workPieceName")).toBe(true)
      expect(fields.has("toolSubtype")).toBe(true)
      expect(fields.has("fluteCount")).toBe(true)
      expect(fields.has("diameterMm")).toBe(true)
    })

    it('"직경 8mm" returns diameterMm=8', () => {
      const entities = extractEntities("직경 8mm")
      const dia = entities.find(e => e.field === "diameterMm")
      expect(dia).toBeDefined()
      expect(dia!.canonical).toBe("8")
    })
  })

  describe("Bug 2: exclude pattern over numeric entity", () => {
    it('"4날 말고 다른거" → exclude fluteCount=4', () => {
      const result = tryKGDecision("4날 말고 다른거", null)
      expect(result.source).toBe("kg-exclude")
      expect(result.confidence).toBeGreaterThan(0.8)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
      expect(action?.filter?.field).toBe("fluteCount")
      expect(action?.filter?.op).toBe("exclude")
    })

    it('"2날 말고 4날로" → replace fluteCount 2→4 (eq)', () => {
      const result = tryKGDecision("2날 말고 4날로", null)
      expect(result.source).toBe("kg-exclude")
      const action = result.decision?.action as any
      expect(action?.filter?.field).toBe("fluteCount")
      expect(action?.filter?.op).toBe("eq")
      expect(String(action?.filter?.value)).toBe("4")
    })
  })

  describe("Bug 3: §8 dispatch gating — no regressions", () => {
    it('"TiAlN 코팅된거" does NOT dispatch continue_narrowing', () => {
      const result = tryKGDecision("TiAlN 코팅된거", null)
      const action = result.decision?.action as any
      expect(action?.type).not.toBe("continue_narrowing")
    })

    it('"스테인리스 10mm" does NOT dispatch (diameter hijack guard)', () => {
      const result = tryKGDecision("스테인리스 10mm", null)
      const action = result.decision?.action as any
      expect(action?.type).not.toBe("continue_narrowing")
    })

    it('"싱크 타입 플레인" dispatches shankType=Plain', () => {
      const result = tryKGDecision("싱크 타입 플레인", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
      expect(action?.filter?.field).toBe("shankType")
    })

    it('"P소재" dispatches material=P', () => {
      const result = tryKGDecision("P소재", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
      expect(action?.filter?.field).toBe("material")
    })

    it('"스퀘어 4날" dispatches (two-entity combo)', () => {
      const result = tryKGDecision("스퀘어 4날", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
    })

    it('"재고 200개 이상" still routes to stock threshold (no regression)', () => {
      const result = tryKGDecision("재고 200개 이상", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("filter_by_stock")
      expect(action?.stockThreshold).toBe(200)
    })
  })
})
