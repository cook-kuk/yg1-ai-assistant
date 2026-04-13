import { describe, it, expect } from "vitest"
import { extractEntities, tryKGDecision } from "../knowledge-graph"

describe("KG bugfixes (2026-04-09)", () => {
  describe("Bug 1: extractEntities multi-entity w/ numeric", () => {
    it('"4날 TiAlN Square" returns fluteCount + coating + toolSubtype', () => {
      const entities = extractEntities("4\uB0A0 TiAlN Square")
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

    it('"\uC9C1\uACBD 8mm" returns diameterMm=8', () => {
      const entities = extractEntities("\uC9C1\uACBD 8mm")
      const dia = entities.find(e => e.field === "diameterMm")
      expect(dia).toBeDefined()
      expect(dia!.canonical).toBe("8")
    })
  })

  describe("Bug 2: semantic mutation should defer instead of executing in KG", () => {
    it('"\u0034\uB0A0 \uB9D0\uACE0 \uB2E4\uB978\uAC70" does not emit continue_narrowing', () => {
      const result = tryKGDecision("4\uB0A0 \uB9D0\uACE0 \uB2E4\uB978\uAC70", null)
      expect(result.source).toBe("none")
      expect(result.decision).toBeNull()
    })

    it('"\u0032\uB0A0 \uB9D0\uACE0 \u0034\uB0A0\uB85C" does not finalize replacement in KG', () => {
      const result = tryKGDecision("2\uB0A0 \uB9D0\uACE0 4\uB0A0\uB85C", null)
      expect(result.source).toBe("none")
      expect(result.decision).toBeNull()
    })

    it('"\uD0C0\uC0AC\uB791 \uBE44\uAD50\uD574\uC918" also defers broad comparison routing', () => {
      const result = tryKGDecision("\uD0C0\uC0AC\uB791 \uBE44\uAD50\uD574\uC918", null)
      expect(result.source).toBe("none")
      expect(result.decision).toBeNull()
    })

    it('"\uD06C\uB9AD \uC5D1\uC2A4 \uC640 \uBE0C\uC774\uCE60 \uCC28\uC774\uC810" does not hard-route as a KG question', () => {
      const result = tryKGDecision("CRX S\uC640 V7 \uCC28\uC774\uC810", null)
      expect(result.source).toBe("none")
      expect(result.decision).toBeNull()
    })
  })

  describe("Bug 3: bare positive dispatch gating still works", () => {
    it('"TiAlN \uCF54\uD305\uB41C\uAC70" does NOT dispatch continue_narrowing', () => {
      const result = tryKGDecision("TiAlN \uCF54\uD305\uB41C\uAC70", null)
      const action = result.decision?.action as any
      expect(action?.type).not.toBe("continue_narrowing")
    })

    it('"\uC2A4\uD14C\uC778\uB9AC\uC2A4 10mm" does NOT dispatch (diameter hijack guard)', () => {
      const result = tryKGDecision("\uC2A4\uD14C\uC778\uB9AC\uC2A4 10mm", null)
      const action = result.decision?.action as any
      expect(action?.type).not.toBe("continue_narrowing")
    })

    it('"\uC2F1\uD06C \uD0C0\uC785 \uD50C\uB808\uC778" dispatches shankType=Plain', () => {
      const result = tryKGDecision("\uC2F1\uD06C \uD0C0\uC785 \uD50C\uB808\uC778", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
      expect(action?.filter?.field).toBe("shankType")
    })

    it('"P\uC18C\uC7AC" dispatches material=P', () => {
      const result = tryKGDecision("P\uC18C\uC7AC", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
      expect(action?.filter?.field).toBe("material")
    })

    it('"\uC2A4\uD018\uC5B4 4\uB0A0" dispatches (two-entity combo)', () => {
      const result = tryKGDecision("\uC2A4\uD018\uC5B4 4\uB0A0", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("continue_narrowing")
    })

    it('"\uC7AC\uACE0 200\uAC1C \uC774\uC0C1" still routes to stock threshold', () => {
      const result = tryKGDecision("\uC7AC\uACE0 200\uAC1C \uC774\uC0C1", null)
      const action = result.decision?.action as any
      expect(action?.type).toBe("filter_by_stock")
      expect(action?.stockThreshold).toBe(200)
    })
  })
})
