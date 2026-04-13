import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

import { normalizeRuntimeAppliedFilter } from "../runtime-filter-normalization"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "../material-mapping"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

describe("normalizeRuntimeAppliedFilter", () => {
  beforeEach(() => {
    _setMaterialMappingTestPaths({
      materialPath: path.join(FIXTURE_ROOT, "material-mapping-sample.csv"),
      brandAffinityPath: path.join(FIXTURE_ROOT, "brand-material-affinity-sample.csv"),
      seriesProfilePath: path.join(FIXTURE_ROOT, "series-profile-sample.csv"),
    })
  })

  afterEach(() => {
    _resetMaterialMappingCacheForTest()
  })

  it("canonicalizes resolver brand values before runtime injection", () => {
    const normalized = normalizeRuntimeAppliedFilter({
      field: "brand",
      op: "eq",
      value: "ALU-CUT for Korean Market",
      rawValue: "ALU-CUT for Korean Market",
      appliedAt: 7,
    } as AppliedFilter)

    expect(normalized).toEqual(expect.objectContaining({
      field: "brand",
      value: "ALU-CUT",
      rawValue: "ALU-CUT for Korean Market",
      appliedAt: 7,
    }))
  })

  it("canonicalizes material family names while preserving the raw material text", () => {
    const normalized = normalizeRuntimeAppliedFilter({
      field: "material",
      op: "eq",
      value: "stainless steel",
      rawValue: "stainless steel",
      appliedAt: 11,
    } as AppliedFilter)

    expect(normalized).toEqual(expect.objectContaining({
      field: "material",
      value: "Stainless",
      rawValue: "stainless steel",
      appliedAt: 11,
    }))
  })

  it("preserves range operators such as gte during runtime normalization", () => {
    const normalized = normalizeRuntimeAppliedFilter({
      field: "diameterMm",
      op: "gte",
      value: "10",
      rawValue: 10,
      appliedAt: 4,
    } as AppliedFilter)

    expect(normalized).toEqual(expect.objectContaining({
      field: "diameterMm",
      op: "gte",
      value: "10mm",
      rawValue: 10,
      appliedAt: 4,
    }))
  })

  it("preserves skip filters without reinterpreting them", () => {
    const normalized = normalizeRuntimeAppliedFilter({
      field: "coating",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: 3,
    } as AppliedFilter)

    expect(normalized).toEqual(expect.objectContaining({
      field: "coating",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: 3,
    }))
  })

  it("canonicalizes material-family workpiece filters while preserving the original raw token", () => {
    const normalized = normalizeRuntimeAppliedFilter({
      field: "workPieceName",
      op: "includes",
      value: "SUS316L",
      rawValue: "SUS316L",
      appliedAt: 11,
    } as AppliedFilter)

    expect(normalized).toEqual(expect.objectContaining({
      field: "workPieceName",
      value: "Stainless",
      rawValue: "SUS316L",
      appliedAt: 11,
    }))
  })
})
