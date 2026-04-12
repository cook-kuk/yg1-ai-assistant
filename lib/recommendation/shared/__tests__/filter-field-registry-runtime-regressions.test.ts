import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

vi.mock("@/lib/recommendation/core/sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["ALU-CUT", "CRX S", "TANK-POWER"],
    loadedAt: Date.now(),
  }),
}))

import { applyPostFilterToProducts, buildAppliedFilterFromValue } from "../filter-field-registry"

describe("filter-field-registry runtime regressions", () => {
  it("canonicalizes strict brand values against schema brands", () => {
    const filter = buildAppliedFilterFromValue("brand", "ALU-CUT for Korean Market")

    expect(filter).toEqual(expect.objectContaining({
      field: "brand",
      rawValue: "ALU-CUT",
      value: "ALU-CUT",
    }))
  })

  it("strips descriptor suffixes even when the schema lacks the short brand form", () => {
    const filter = buildAppliedFilterFromValue("brand", "X-POWER for Global Market")

    expect(filter).toEqual(expect.objectContaining({
      field: "brand",
      rawValue: "X-POWER",
      value: "X-POWER",
    }))
  })

  it("keeps rpm filters from deleting SQL-matched candidates during post-filter", () => {
    const filter = buildAppliedFilterFromValue("rpm", 5000, 0, "lte")
    const candidates = [
      {
        normalizedCode: "P1",
        displayCode: "P1",
        brand: "YG-1",
        seriesName: "SERIES",
        diameterMm: 10,
        fluteCount: 4,
        coating: "TiAlN",
        toolMaterial: "Carbide",
        shankDiameterMm: 10,
        lengthOfCutMm: 20,
        overallLengthMm: 60,
        helixAngleDeg: 45,
        description: null,
        featureText: null,
        materialTags: ["P"],
      },
    ] as any

    const filtered = applyPostFilterToProducts(candidates, filter!)

    expect(filtered).toHaveLength(1)
    expect(filtered?.[0]?.displayCode).toBe("P1")
  })

  it("builds numeric inventory thresholds as totalStock filters", () => {
    const filter = buildAppliedFilterFromValue("totalStock", 100, 0, "gte")
    expect(filter).toEqual(expect.objectContaining({
      field: "totalStock",
      op: "gte",
      rawValue: 100,
    }))
  })

  it("does not erase SQL-matched candidates when totalStock is absent from the snapshot", () => {
    const filter = buildAppliedFilterFromValue("totalStock", 100, 0, "gte")
    const candidates = [
      {
        normalizedCode: "P1",
        displayCode: "P1",
        brand: "YG-1",
        seriesName: "SERIES",
        diameterMm: 10,
        fluteCount: 4,
        coating: "TiAlN",
        toolMaterial: "Carbide",
        shankDiameterMm: 10,
        lengthOfCutMm: 20,
        overallLengthMm: 60,
        helixAngleDeg: 45,
        description: null,
        featureText: null,
        materialTags: ["P"],
      },
    ] as any

    const filtered = applyPostFilterToProducts(candidates, filter!)

    expect(filtered).toHaveLength(1)
    expect(filtered?.[0]?.displayCode).toBe("P1")
  })

  it("treats null totalStock snapshots as missing during post-filtering", () => {
    const filter = buildAppliedFilterFromValue("totalStock", 100, 0, "gte")
    const candidates = [
      {
        normalizedCode: "P1",
        displayCode: "P1",
        brand: "YG-1",
        seriesName: "SERIES",
        diameterMm: 10,
        fluteCount: 4,
        coating: "TiAlN",
        toolMaterial: "Carbide",
        shankDiameterMm: 10,
        lengthOfCutMm: 20,
        overallLengthMm: 60,
        helixAngleDeg: 45,
        description: null,
        featureText: null,
        materialTags: ["P"],
        totalStock: null,
      },
    ] as any

    const filtered = applyPostFilterToProducts(candidates, filter!)

    expect(filtered).toHaveLength(1)
    expect(filtered?.[0]?.displayCode).toBe("P1")
  })
})
