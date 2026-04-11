import { describe, it, expect } from "vitest"

import {
  buildNegationFallbackText,
  findCandidateScopedPhantoms,
} from "@/lib/recommendation/infrastructure/knowledge/candidate-phantom-guard"
import type { AppliedFilter, CandidateSnapshot } from "@/lib/types/exploration"

function snap(overrides: Partial<CandidateSnapshot>): CandidateSnapshot {
  return {
    rank: 1,
    productCode: "CODE",
    displayCode: "CODE",
    displayLabel: null,
    brand: null,
    seriesName: null,
    seriesIconUrl: null,
    diameterMm: null,
    fluteCount: null,
    coating: null,
    toolMaterial: null,
    shankDiameterMm: null,
    lengthOfCutMm: null,
    overallLengthMm: null,
    helixAngleDeg: null,
    description: null,
    featureText: null,
    materialTags: [],
    score: 0,
    scoreBreakdown: null,
    matchStatus: "exact",
    stockStatus: "unknown",
    totalStock: null,
    ...overrides,
  } as CandidateSnapshot
}

const neqBrand = (value: string): AppliedFilter => ({
  field: "brand",
  op: "neq",
  value,
  rawValue: value,
  appliedAt: 0,
})

describe("findCandidateScopedPhantoms (negation-path guard)", () => {
  const candidates = [
    snap({ brand: "3S MILL", seriesName: "CG3S60" }),
    snap({ brand: "3S MILL", seriesName: "CG3S47" }),
    snap({ brand: "4G MILL", seriesName: "SEME71" }),
  ]
  const filters = [neqBrand("CRX S")]

  it("passes when mentioned brand is in candidates", () => {
    const text = "CRX S는 제외했습니다. 상위에 3S MILL 시리즈가 올라와 있습니다."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.phantoms).toEqual([])
    expect(result.excludedMentioned).toEqual([])
  })

  it("flags a brand that is not in candidates and not excluded", () => {
    const text = "CRX S는 빼드렸고, X-POWER PRO가 상위에 있습니다."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.phantoms).toContain("X-POWER PRO")
  })

  it("flags when the neq'd value is mentioned as a recommendation, not an exclusion", () => {
    const text = "상위에 CRX S가 있고, 이 시리즈가 가장 적합합니다."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.excludedMentioned).toContain("CRX S")
  })

  it("does not flag the neq'd value when framed as exclusion", () => {
    const text = "CRX S는 제외했습니다. 남은 후보 중 3S MILL이 상위입니다."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.excludedMentioned).toEqual([])
    expect(result.phantoms).toEqual([])
  })

  it("accepts 빼드렸고 / 말고 / 아닌 variants as exclusion framing", () => {
    const variants = [
      "CRX S는 빼드렸고 500개 남았습니다. 3S MILL이 상위입니다.",
      "CRX S 말고 다른 시리즈를 봤습니다. 3S MILL이 상위에 있어요.",
      "CRX S는 뺐습니다. 3S MILL 시리즈를 보세요.",
      "CRX S가 아닌 것 중에서 3S MILL이 상위입니다.",
      "CRX S 아닌 시리즈를 찾아봤더니 3S MILL이 나오네요.",
    ]
    for (const text of variants) {
      const result = findCandidateScopedPhantoms(text, candidates, filters)
      expect(result.excludedMentioned, `variant: ${text}`).toEqual([])
    }
  })

  it("accepts partial containment (e.g. '3S MILL 시리즈')", () => {
    const text = "CRX S는 제외했습니다. 3S MILL 시리즈가 상위에 있습니다."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.phantoms).toEqual([])
  })

  it("ignores coating tokens, material grades, and generic acronyms", () => {
    const text =
      "CRX S는 제외했습니다. 3S MILL은 T-Coating이고 SUS316L에도 쓸 수 있으며 HSS 아님."
    const result = findCandidateScopedPhantoms(text, candidates, filters)
    expect(result.phantoms).toEqual([])
  })
})

describe("buildNegationFallbackText", () => {
  it("cites top two distinct series from the snapshot and names the excluded target", () => {
    const candidates = [
      snap({ brand: "3S MILL", seriesName: "CG3S60" }),
      snap({ brand: "3S MILL", seriesName: "CG3S60" }),
      snap({ brand: "4G MILL", seriesName: "SEME71" }),
    ]
    const text = buildNegationFallbackText(500, candidates, "CRX S")
    expect(text).toContain("CRX S는 제외했습니다")
    expect(text).toContain("500개")
    expect(text).toContain("CG3S60")
    expect(text).toContain("SEME71")
  })

  it("falls back to a generic follow-up when snapshot is empty", () => {
    const text = buildNegationFallbackText(0, [], "CRX S")
    expect(text).toContain("CRX S는 제외했습니다")
    expect(text).not.toMatch(/상위에.*시리즈/)
  })
})
