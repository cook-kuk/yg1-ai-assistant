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

import { normalizeRuntimeAppliedFilter } from "../runtime-filter-normalization"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"

describe("normalizeRuntimeAppliedFilter", () => {
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
      rawValue: "ALU-CUT",
      appliedAt: 7,
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
})
