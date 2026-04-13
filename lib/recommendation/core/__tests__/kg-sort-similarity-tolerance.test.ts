import { describe, it, expect } from "vitest"
import {
  tryKGDecision,
  tryParseSortPhrase,
  tryParseTolerancePhrase,
  tryParseSimilarityPhrase,
} from "../knowledge-graph"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

/**
 * Phase E — KG §9: sort / tolerance / similarity triggers.
 *
 * These do NOT flow through AppliedFilter[] — they emit a `specPatch` on
 * KGDecisionResult which the runtime stashes on session state. The decision
 * itself is still a benign `show_recommendation` so turn bookkeeping works.
 */

const stateWithProduct: ExplorationSessionState = {
  lastRecommendedProductId: "YG1-ABC-123",
} as unknown as ExplorationSessionState

describe("KG §9 sort", () => {
  it('"직경 작은 순으로" → sort diameterMm asc', () => {
    const res = tryKGDecision("직경 작은 순으로", null)
    expect(res.source).toBe("kg-sort")
    expect(res.specPatch?.sort).toEqual({ field: "diameterMm", direction: "asc" })
  })

  it('"OAL 긴 순으로 보여줘" → sort overallLengthMm desc', () => {
    const res = tryKGDecision("OAL 긴 순으로 보여줘", null)
    expect(res.source).toBe("kg-sort")
    expect(res.specPatch?.sort?.field).toBe("overallLengthMm")
    expect(res.specPatch?.sort?.direction).toBe("desc")
  })

  it('"날장 제일 긴 제품 보여줘" → sort lengthOfCutMm desc', () => {
    const res = tryKGDecision("날장 제일 긴 제품 보여줘", null)
    expect(res.source).toBe("kg-sort")
    expect(res.specPatch?.sort).toEqual({ field: "lengthOfCutMm", direction: "desc" })
  })

  it('"친절한 순으로" (non-sortable field) → falls through', () => {
    const res = tryKGDecision("친절한 순으로", null)
    expect(res.source).not.toBe("kg-sort")
    expect(res.specPatch?.sort).toBeUndefined()
  })
})

describe("KG §9 tolerance", () => {
  it('"10mm 근처" no longer defaults to diameter without a field cue', () => {
    const res = tryKGDecision("10mm 근처", null)
    expect(res.source).not.toBe("kg-tolerance")
    expect(res.specPatch?.toleranceConstraints).toBeUndefined()
  })

  it('"약 8mm" no longer defaults to diameter without a field cue', () => {
    const res = tryKGDecision("약 8mm", null)
    expect(res.source).not.toBe("kg-tolerance")
    expect(res.specPatch?.toleranceConstraints).toBeUndefined()
  })

  it('"OAL 50mm 근처" → tolerance on overallLengthMm', () => {
    const res = tryKGDecision("OAL 50mm 근처", null)
    expect(res.source).toBe("kg-tolerance")
    const tc = res.specPatch?.toleranceConstraints?.[0]
    expect(tc?.field).toBe("overallLengthMm")
    expect(tc?.value).toBe(50)
  })
})

describe("KG §9 similarity", () => {
  it('"이 제품이랑 비슷한 스펙" + current product → similarTo', () => {
    const res = tryKGDecision("이 제품이랑 비슷한 스펙", stateWithProduct)
    expect(res.source).toBe("kg-similarity")
    expect(res.specPatch?.similarTo?.referenceProductId).toBe("__current__")
  })

  it('"비슷한 스펙" without current product → falls through', () => {
    const res = tryKGDecision("비슷한 스펙", null)
    expect(res.source).not.toBe("kg-similarity")
    expect(res.specPatch?.similarTo).toBeUndefined()
  })
})

describe("KG §9 — negative (existing behavior preserved)", () => {
  it('"재고 200개 이상" still routes to stockThreshold, not sort', () => {
    const res = tryKGDecision("재고 200개 이상", null)
    // Must still match existing stock threshold path, NOT the new sort path
    expect(res.source).not.toBe("kg-sort")
    expect(res.reason).toMatch(/stock/)
  })

  it('"재고 가장 많은 것" does NOT emit a sort specPatch (option b: post-display rerank)', () => {
    const res = tryKGDecision("재고 가장 많은 것", null)
    // COMPARATIVE_SUPERLATIVE_PATTERN at §5a handles this via answer_general rerank.
    // Critically, no sort field is emitted (stock isn't in getSortableFields()).
    expect(res.specPatch?.sort).toBeUndefined()
  })

  it('"TiAlN 코팅된거" still does NOT dispatch from KG (kg-disabled-multientity preserved)', () => {
    const res = tryKGDecision("TiAlN 코팅된거", null)
    // The §8 multi-entity guard keeps this as a fall-through (decision may be null
    // or handled by deterministic-scr; specPatch must not exist).
    expect(res.specPatch).toBeUndefined()
  })

  it('"4날 TiAlN Square" still does NOT dispatch from KG §9', () => {
    const res = tryKGDecision("4날 TiAlN Square", null)
    expect(res.specPatch).toBeUndefined()
  })
})

describe("KG §9 — unit helper functions", () => {
  it("tryParseSortPhrase returns null for unrelated text", () => {
    expect(tryParseSortPhrase("TiAlN 코팅")).toBeNull()
  })
  it("tryParseTolerancePhrase requires a marker word", () => {
    expect(tryParseTolerancePhrase("10mm")).toBeNull()
  })
  it("tryParseSimilarityPhrase returns null without session state", () => {
    expect(tryParseSimilarityPhrase("비슷한 스펙", null)).toBeNull()
  })
})
