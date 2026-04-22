import { describe, expect, it } from "vitest"

import { deriveWarningAdjustment } from "./ai-warning-adjust"

describe("deriveWarningAdjustment", () => {
  it("채터 경고는 Vc/ap를 더 공격적으로 낮춘다", () => {
    const result = deriveWarningAdjustment("채터 위험 - ap와 속도를 낮추세요", {
      Vc: 180,
      fz: 0.12,
      ap: 8,
      ae: 4,
      diameter: 10,
    })

    expect(result.Vc).toBeLessThan(180)
    expect(result.ap).toBeLessThan(8)
    expect(result.tags).toContain("chatter")
  })

  it("ae 경고는 직경 한계를 넘지 않게 ae를 줄인다", () => {
    const result = deriveWarningAdjustment("ae 과다 - radial load 감소 필요", {
      Vc: 150,
      fz: 0.08,
      ap: 6,
      ae: 9,
      diameter: 10,
    })

    expect(result.ae).toBeLessThan(9)
    expect(result.ae).toBeLessThanOrEqual(10)
    expect(result.tags).toContain("ae")
  })

  it("매칭 규칙이 없으면 일반 완화 규칙을 사용한다", () => {
    const result = deriveWarningAdjustment("설정 재검토 권장", {
      Vc: 200,
      fz: 0.1,
      ap: 5,
      ae: 3,
      diameter: 12,
    })

    expect(result.Vc).toBe(190)
    expect(result.fz).toBe(0.095)
    expect(result.tags).toEqual(["general"])
  })
})
