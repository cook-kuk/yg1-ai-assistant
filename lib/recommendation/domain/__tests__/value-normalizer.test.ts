import { describe, expect, it } from "vitest"

import { normalizeFilterValue } from "../value-normalizer"

describe("normalizeFilterValue", () => {
  it("matches identifier fields by normalized exact equality", async () => {
    const result = await normalizeFilterValue(
      "ALU POWER HPC",
      "brand",
      ["ALU-POWER HPC", "ALU-CUT for Korean Market"],
      null
    )

    expect(result).toEqual({
      normalized: "ALU-POWER HPC",
      matchType: "exact",
    })
  })

  it("does not fuzzy-match identifier fields to a different brand", async () => {
    const result = await normalizeFilterValue(
      "ALU POWER HPC",
      "brand",
      ["ALU-CUT for Korean Market"],
      null
    )

    expect(result).toEqual({
      normalized: "ALU POWER HPC",
      matchType: "none",
    })
  })

  it("keeps fuzzy matching for semantic fields", async () => {
    const result = await normalizeFilterValue(
      "rough",
      "toolSubtype",
      ["Square", "Roughing"],
      null
    )

    expect(result).toEqual({
      normalized: "Roughing",
      matchType: "fuzzy",
    })
  })
})
