import { describe, expect, it } from "vitest"

import { resolveWorkpieceMaterialImpact } from "./workpiece-material-model"

describe("resolveWorkpieceMaterialImpact", () => {
  it("선택된 세부 피삭재를 매칭해 kc와 열계수를 만든다", () => {
    const impact = resolveWorkpieceMaterialImpact({
      isoGroup: "M",
      workpiece: "SUS316",
      hardnessValue: 28,
    })

    expect(impact.displayName).toBe("SUS316")
    expect(impact.effectiveKc).toBeGreaterThan(impact.baseKc)
    expect(impact.thermalConductivityWmk).toBeCloseTo(16.3, 1)
    expect(impact.sourceName).toContain("316")
  })

  it("세부 피삭재가 없으면 ISO fallback을 사용한다", () => {
    const impact = resolveWorkpieceMaterialImpact({
      isoGroup: "N",
      workpiece: "",
      hardnessValue: 10,
    })

    expect(impact.profile).toBeNull()
    expect(impact.displayName).toBe("ISO N")
    expect(impact.effectiveKc).toBe(impact.baseKc)
  })
})
