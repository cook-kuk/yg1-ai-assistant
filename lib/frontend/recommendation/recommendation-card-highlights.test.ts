import { describe, expect, it } from "vitest"

import {
  buildCandidateSpecFallback,
  buildCandidateSubtypeHighlight,
  buildSubtypeFirstSummary,
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

  it("uses tool subtype instead of diameter flute and coating in the summary", () => {
    expect(buildSubtypeFirstSummary({
      toolSubtype: "Square",
      diameterMm: 8,
      fluteCount: 3,
      coating: "Bright Finish",
      toolMaterial: "Carbide",
      shankDiameterMm: 8,
      lengthOfCutMm: 20,
      overallLengthMm: 100,
      helixAngleDeg: 45,
    }, "ko")).toEqual(["형상 Square", "Carbide", "Shank 8mm", "CL 20mm", "OAL 100mm", "45°"])
  })

  it("falls back to diameter, flute, and coating summary", () => {
    expect(buildCandidateSpecFallback({
      diameterMm: 10,
      fluteCount: 4,
      coating: "Y-Coating",
    })).toEqual([])
  })
})
