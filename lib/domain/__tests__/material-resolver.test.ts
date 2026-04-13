import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getAllTags, getMaterialDisplay, resolveMaterialTag } from "../material-resolver"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "@/lib/recommendation/shared/material-mapping"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

describe("material-resolver", () => {
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

  it("resolves common Korean and English aliases without JSON taxonomy files", () => {
    expect(resolveMaterialTag("SUS304")).toBe("M")
    expect(resolveMaterialTag("Inconel")).toBe("S")
    expect(resolveMaterialTag("HRC 55")).toBe("H")
    expect(resolveMaterialTag("S45C")).toBe("P")
  })

  it("resolves CSV-derived family descriptions before falling back to hardcoded aliases", () => {
    expect(resolveMaterialTag("Austenitic stainless steel")).toBe("M")
    expect(resolveMaterialTag("Nickel-based super alloy")).toBe("S")
  })

  it("returns stable display labels from in-code taxonomy", () => {
    expect(getMaterialDisplay("M")).toEqual({ ko: expect.any(String), en: "Stainless Steels" })
    expect(getMaterialDisplay("N")).toEqual({ ko: expect.any(String), en: "Non-Ferrous" })
  })

  it("returns canonical ISO tags", () => {
    expect(getAllTags()).toEqual(["P", "M", "K", "N", "S", "H"])
  })
})
