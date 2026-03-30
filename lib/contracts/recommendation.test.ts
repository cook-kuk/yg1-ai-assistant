import { describe, expect, it } from "vitest"

import { recommendationAppliedFilterSchema } from "./recommendation"

describe("recommendationAppliedFilterSchema", () => {
  it("accepts multi-value rawValue arrays", () => {
    const parsed = recommendationAppliedFilterSchema.parse({
      field: "toolSubtype",
      op: "includes",
      value: "Square, Radius",
      rawValue: ["Square", "Radius"],
      appliedAt: 1,
    })

    expect(parsed.rawValue).toEqual(["Square", "Radius"])
  })
})
