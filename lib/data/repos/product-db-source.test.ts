import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildQueryOptions, normalizeWorkPieceNameForDb } from "./product-db-source"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "@/lib/recommendation/shared/material-mapping"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

describe("product db operation shape filtering", () => {
  it("filters by series_application_shape text only", () => {
    const { where, values } = buildQueryOptions({
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        operationType: "Side_Milling, Facing",
      },
    })

    expect(where.some(clause => clause.includes("series_application_shape"))).toBe(true)
    expect(where.some(clause => clause.includes("edp_root_category"))).toBe(false)
    expect(values).toContain("%side_milling%")
    expect(values).toContain("%facing%")
  })

  it("keeps Side_Milling and Side Milling as separate OR conditions", () => {
    const { where, values } = buildQueryOptions({
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        operationType: "Side_Milling, Side Milling",
      },
    })

    const operationClause = where.find(clause => clause.includes("series_application_shape"))
    expect(operationClause).toContain(" OR ")
    expect(values).toContain("%side_milling%")
    expect(values).toContain("%side milling%")
  })

  it("filters machining category by exact edp_root_category value", () => {
    const { where, values } = buildQueryOptions({
      input: {
        manufacturerScope: "yg1-only",
        locale: "ko",
        toolType: "Tooling System",
      },
    })

    expect(where.some(clause => clause.includes("edp_root_category"))).toBe(true)
    expect(where.some(clause => clause.includes("series_application_shape"))).toBe(false)
    expect(values).toContain("Tooling System")
  })
})

describe("product db workpiece normalization", () => {
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

  it.each([
    ["SUS316L", "Stainless"],
    ["스텐인리스강", "Stainless"],
    ["스테인리스강", "Stainless"],
    ["AISI 1010", "Carbon Steel"],
    ["DIN X5CrNi18-10", "Stainless"],
    ["A7075", "Aluminum"],
    ["SCM440", "Alloy Steel"],
    ["SKD11", "Hardened Steel"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeWorkPieceNameForDb(input)).toBe(expected)
  })
})
