import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { resolveMaterialTag } from "../material-resolver"
import { _resetMaterialMappingCacheForTest, _setMaterialMappingTestPaths } from "@/lib/recommendation/shared/material-mapping"

const FIXTURE_ROOT = path.resolve(process.cwd(), "lib", "recommendation", "shared", "__tests__", "fixtures")

describe.sequential("material-resolver csv integration", () => {
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

  it("derives ISO groups from material mapping aliases that were not in the legacy hardcoded list", () => {
    expect(resolveMaterialTag("AISI 1010")).toBe("P")
    expect(resolveMaterialTag("DIN X5CrNi18-10")).toBe("M")
    expect(resolveMaterialTag("Ti-6Al-4V")).toBe("S")
  })
})
