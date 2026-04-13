import { describe, expect, it } from "vitest"

import { detectMeasurementScopeAmbiguity } from "../measurement-scope-ambiguity"

describe("detectMeasurementScopeAmbiguity", () => {
  it("detects ambiguous bare length phrases without a field cue", () => {
    const result = detectMeasurementScopeAmbiguity("100mm 이상이요")

    expect(result).toMatchObject({
      kind: "length",
      normalizedPhrase: "100mm 이상",
      chips: [
        "직경 100mm 이상",
        "전장 100mm 이상",
        "절삭 길이 100mm 이상",
        "직접 입력",
      ],
    })
    expect(result?.question).toContain("직경 기준인지")
  })

  it("does not trigger when a specific length field is named", () => {
    expect(detectMeasurementScopeAmbiguity("전장 100mm 이상")).toBeNull()
    expect(detectMeasurementScopeAmbiguity("직경 100mm 이상")).toBeNull()
  })

  it("does not trigger when the pending field already disambiguates the numeric reply", () => {
    expect(detectMeasurementScopeAmbiguity("100mm 이상", { pendingField: "overallLengthMm" })).toBeNull()
  })

  it("detects ambiguous bare angle phrases without a field cue", () => {
    const result = detectMeasurementScopeAmbiguity("30도 이상")

    expect(result).toMatchObject({
      kind: "angle",
      normalizedPhrase: "30도 이상",
      chips: [
        "헬릭스각 30도 이상",
        "테이퍼각 30도 이상",
        "포인트 각도 30도 이상",
        "직접 입력",
      ],
    })
    expect(result?.question).toContain("헬릭스각 기준인지")
  })
})
