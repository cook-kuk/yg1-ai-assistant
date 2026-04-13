import { describe, expect, it } from "vitest"

import { recommendationAppliedFilterSchema, recommendationRequestSchema } from "./recommendation"

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

describe("recommendationRequestSchema", () => {
  it("accepts engine=null and treats it as an omitted engine selection", () => {
    const parsed = recommendationRequestSchema.parse({
      engine: null,
      messages: [{ role: "user", text: "엔드밀 추천" }],
      session: null,
      pagination: null,
      language: "ko",
      mode: "simple",
    })

    expect(parsed.engine).toBeNull()
  })
})
