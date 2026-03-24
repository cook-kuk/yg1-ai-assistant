import { describe, expect, it } from "vitest"

import {
  buildCandidateSpecFallback,
  buildCandidateSubtypeHighlight,
} from "./recommendation-card-highlights"

describe("recommendation card highlights", () => {
  it("prefers tool subtype as the highlighted badge", () => {
    expect(buildCandidateSubtypeHighlight({ toolSubtype: "Square" }, "ko")).toEqual({
      label: "형상",
      value: "Square",
    })
  })

  it("returns null when tool subtype is missing", () => {
    expect(buildCandidateSubtypeHighlight({ toolSubtype: null }, "ko")).toBeNull()
  })

  it("falls back to diameter, flute, and coating summary", () => {
    expect(buildCandidateSpecFallback({
      diameterMm: 10,
      fluteCount: 4,
      coating: "Y-Coating",
    })).toEqual(["φ10mm", "4날", "Y-Coating"])
  })
})
