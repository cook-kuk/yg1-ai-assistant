// Unit tests for the Machine Impact Lab physics engine. Locks in the
// spec-approved BASELINE/DISASTER targets + the derate curves the
// scenario table depends on, so future edits surface behavioral drift
// before they hit the demo.
import { describe, expect, it } from "vitest"
import {
  IMPACT_PRESETS,
  computeImpact,
  compute100PartsTime,
  rigidityMul,
  stickoutDerate,
  tirDerate,
  whMul,
  DEFAULT_LOCKED_TOOL,
  DEFAULT_LOCKED_MATERIAL,
  DEFAULT_LOCKED_OPERATION,
  type ComputeInput,
} from "./impact-calc-engine"

const LOCKED = {
  D_inch: DEFAULT_LOCKED_TOOL.diameterInch,
  D_mm: DEFAULT_LOCKED_TOOL.diameter,
  Z: DEFAULT_LOCKED_TOOL.flutes,
  sfmBase: DEFAULT_LOCKED_MATERIAL.sfmBase,
  iptBase: DEFAULT_LOCKED_MATERIAL.iptBase,
  kc: DEFAULT_LOCKED_MATERIAL.kc,
  isoGroup: DEFAULT_LOCKED_MATERIAL.isoGroup,
  adocInch: DEFAULT_LOCKED_OPERATION.adocInch,
  rdocInch: DEFAULT_LOCKED_OPERATION.rdocInch,
} as const

function build(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    ...LOCKED,
    ...IMPACT_PRESETS.baseline.config,
    ...overrides,
  }
}

describe("impact-calc-engine — spec targets", () => {
  it("BASELINE hits the approved RPM/MRR targets (Harvey 942332 + Al 6061)", () => {
    const r = computeImpact(build())
    expect(r.calcRPM).toBeGreaterThanOrEqual(11_360)
    expect(r.calcRPM).toBeLessThanOrEqual(11_560)
    expect(r.MRR_inch3_min).toBeGreaterThan(3.52)
    expect(r.MRR_inch3_min).toBeLessThan(3.92)
    expect(r.chatterLevel).toBe("LOW")
  })

  it("DISASTER produces ≥3 warnings and stays under 8000 RPM", () => {
    const r = computeImpact(build(IMPACT_PRESETS.disaster.config))
    expect(r.warnings.length).toBeGreaterThanOrEqual(3)
    expect(r.calcRPM).toBeLessThanOrEqual(8000)
    expect(r.chatterLevel).toBe("HIGH")
  })

  it("scenarios are monotonically ordered by MRR (disaster < budget < std < base ≤ premium/highspeed)", () => {
    const mrr = (key: keyof typeof IMPACT_PRESETS) =>
      computeImpact(build(IMPACT_PRESETS[key].config)).MRR_inch3_min

    expect(mrr("disaster")).toBeLessThan(mrr("budget"))
    expect(mrr("budget")).toBeLessThan(mrr("standard"))
    expect(mrr("standard")).toBeLessThan(mrr("baseline"))
    expect(mrr("baseline")).toBeLessThanOrEqual(mrr("premium"))
    expect(mrr("baseline")).toBeLessThanOrEqual(mrr("highspeed"))
  })
})

describe("impact-calc-engine — derate curves", () => {
  it("rigidityMul saturates at r≥80 (shrink-fit / milling-chuck hit 1.0)", () => {
    expect(rigidityMul(80)).toBe(1.0)
    expect(rigidityMul(85)).toBe(1.0)
    expect(rigidityMul(90)).toBe(1.0)
    // Below saturation: linear 0.8..1.0
    expect(rigidityMul(0)).toBeCloseTo(0.8, 5)
    expect(rigidityMul(40)).toBeCloseTo(0.9, 5)
    expect(rigidityMul(70)).toBeCloseTo(0.975, 5)
  })

  it("stickoutDerate steps down at L/D breakpoints", () => {
    expect(stickoutDerate(2)).toBe(1.0)
    expect(stickoutDerate(3)).toBe(1.0)
    expect(stickoutDerate(3.5)).toBe(0.9)
    expect(stickoutDerate(4.5)).toBe(0.8)
    expect(stickoutDerate(6)).toBe(0.7)
    expect(stickoutDerate(7)).toBe(0.55)
    expect(stickoutDerate(10)).toBe(0.4)
  })

  it("tirDerate penalises sloppy holders", () => {
    expect(tirDerate(3)).toBe(1.0) // shrink-fit
    expect(tirDerate(8)).toBe(0.97) // hydraulic
    expect(tirDerate(15)).toBe(0.92) // ER collet
    expect(tirDerate(20)).toBe(0.85) // end-mill holder
    expect(tirDerate(25)).toBe(0.8) // side-lock
  })

  it("whMul is linear 0.85..1.0 across 0..100", () => {
    expect(whMul(100)).toBeCloseTo(1.0, 5)
    expect(whMul(0)).toBeCloseTo(0.85, 5)
    expect(whMul(60)).toBeCloseTo(0.94, 5)
  })
})

describe("impact-calc-engine — warnings + severity", () => {
  it("BASELINE on aluminum gets at most one rpm-cap heads-up (no critical)", () => {
    const r = computeImpact(build())
    expect(r.warnings.some((w) => w.level === "critical")).toBe(false)
  })

  it("dry coolant on steel (ISO P) flags dry-coolant warning", () => {
    const r = computeImpact(
      build({
        isoGroup: "P",
        sfmBase: 400,
        iptBase: 0.004,
        kc: 1800,
        coolantKey: "dry",
      }),
    )
    expect(r.warnings.some((w) => w.code === "dry-coolant")).toBe(true)
  })

  it("dry coolant on aluminum (ISO N) does NOT flag dry-coolant (BUE exemption)", () => {
    const r = computeImpact(build({ coolantKey: "dry" }))
    expect(r.warnings.some((w) => w.code === "dry-coolant")).toBe(false)
  })

  it("workholding <70% surfaces its own warning independent of chatter", () => {
    const r = computeImpact(build({ workholdingPct: 65 }))
    expect(r.warnings.some((w) => w.code === "workholding-loose")).toBe(true)
  })

  it("long stickout (L/D > 5) fires ld warning", () => {
    const r = computeImpact(build({ stickoutInch: 3.0 })) // L/D = 6
    expect(r.warnings.some((w) => w.code === "ld")).toBe(true)
  })
})

describe("impact-calc-engine — efficiency + cycle math", () => {
  it("BASELINE self-efficiency is 1.0 across all metrics", () => {
    const r = computeImpact(build())
    expect(r.efficiency.mrrRatio).toBe(1)
    expect(r.efficiency.lifeRatio).toBe(1)
    expect(r.efficiency.cycleRatio).toBe(1)
  })

  it("premium outperforms baseline on MRR ratio", () => {
    const r = computeImpact(build(IMPACT_PRESETS.premium.config))
    expect(r.efficiency.mrrRatio).toBeGreaterThan(1)
  })

  it("disaster MRR ratio is under 40% (productivity warning threshold)", () => {
    const r = computeImpact(build(IMPACT_PRESETS.disaster.config))
    expect(r.efficiency.mrrRatio).toBeLessThan(0.4)
  })

  it("compute100PartsTime returns Infinity when MRR is zero (no-op guard)", () => {
    const out = compute100PartsTime(0, 30)
    expect(out.totalMin).toBe(Infinity)
    expect(out.toolsNeeded).toBe(1)
  })

  it("compute100PartsTime counts tool swaps (5min each) when life < total machine time", () => {
    // 50 in³ × 100 parts / 10 in³/min = 500 min machine time.
    // Tool life 100 min → needs 5 tools → 4 swaps × 5min = 20min swap time.
    const out = compute100PartsTime(10, 100)
    expect(out.toolsNeeded).toBe(5)
    expect(out.totalMin).toBe(520)
  })
})

describe("impact-calc-engine — RPM capping", () => {
  it("holder-rpm-cap warning fires when holder max is the binding limit", () => {
    const r = computeImpact(
      build({
        spindleKey: "hsm", // 30k RPM spindle
        holderKey: "side-lock", // 10k RPM holder
        stickoutInch: 1.0, // plenty of SFM headroom
      }),
    )
    expect(r.warnings.some((w) => w.code === "holder-rpm-cap")).toBe(true)
    expect(r.rpmLimit).toBe(10_000)
  })

  it("rpmCapped never exceeds min(spindle, holder) RPM limit", () => {
    const r = computeImpact(
      build({
        spindleKey: "vmc-high", // 20k spindle
        holderKey: "end-mill-holder", // 12k holder
      }),
    )
    expect(r.rpmCapped).toBeLessThanOrEqual(12_000)
  })
})
