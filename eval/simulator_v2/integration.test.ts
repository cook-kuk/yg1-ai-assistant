// SPDX-License-Identifier: MIT
// YG-1 Simulator v3 — 신규 유틸 + SSOT 일관성 통합 테스트
// 실행: npx vitest run eval/simulator_v2/integration.test.ts

import { describe, it, expect } from "vitest"

describe("Integration - 유틸 함수 + SSOT 일관성", () => {
  it("vendor-attribution: 모든 primary source 유효", async () => {
    const { VENDORS, FEATURES } = await import(
      "@/lib/frontend/simulator/v2/vendor-attribution"
    )
    for (const feat of Object.values(FEATURES)) {
      expect(VENDORS[feat.primarySource], `${feat.featureId}.primarySource`).toBeDefined()
      if (feat.secondarySources) {
        for (const s of feat.secondarySources) {
          expect(VENDORS[s], `${feat.featureId}.secondarySources[${s}]`).toBeDefined()
        }
      }
    }
  })

  it("education-content: relatedConcepts dead link 없음", async () => {
    const { EDUCATION_DB } = await import(
      "@/lib/frontend/simulator/v2/education-content"
    )
    const allIds = new Set(Object.keys(EDUCATION_DB))
    for (const entry of Object.values(EDUCATION_DB)) {
      for (const related of entry.relatedConcepts) {
        expect(
          allIds.has(related) || related === "",
          `${entry.id} -> ${related}`
        ).toBe(true)
      }
    }
  })

  it("apply-preset-safe: workholding 0 (LOOSE) 심각 클램프", async () => {
    const { applyPresetSafe } = await import(
      "@/lib/frontend/simulator/v2/apply-preset-safe"
    )
    // workholding=0 → apMax = D * 0.5 = 5mm, 입력 ap=10 → 5로 클램프되어야 함
    const r = applyPresetSafe(
      { Vc: 150, fz: 0.05, ap: 10, ae: 5, diameter: 10 },
      0
    )
    expect(r.clamped.ap).toBeLessThan(10)
    expect(r.clampedFields).toContain("ap")
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("apply-preset-safe: 절대 물리 한계 (Vc > 1000)", async () => {
    const { applyPresetSafe, VC_ABS_MAX } = await import(
      "@/lib/frontend/simulator/v2/apply-preset-safe"
    )
    const r = applyPresetSafe(
      { Vc: 2000, fz: 0.05, ap: 2, ae: 2, diameter: 10 },
      65
    )
    expect(r.clamped.Vc).toBe(VC_ABS_MAX)
    expect(r.clampedFields).toContain("Vc")
  })

  it("apply-preset-safe: fz 범위 (너무 작음)", async () => {
    const { applyPresetSafe, FZ_ABS_MIN } = await import(
      "@/lib/frontend/simulator/v2/apply-preset-safe"
    )
    const r = applyPresetSafe(
      { Vc: 150, fz: 0.0001, ap: 2, ae: 2, diameter: 10 },
      65
    )
    expect(r.clamped.fz).toBe(FZ_ABS_MIN)
    expect(r.clampedFields).toContain("fz")
  })

  it("apply-preset-safe: ae > D 제한 (error 레벨)", async () => {
    const { applyPresetSafe } = await import(
      "@/lib/frontend/simulator/v2/apply-preset-safe"
    )
    const r = applyPresetSafe(
      { Vc: 150, fz: 0.05, ap: 2, ae: 50, diameter: 10 },
      65
    )
    expect(r.clamped.ae).toBeLessThanOrEqual(10)
    expect(r.warnings.some((w) => w.level === "error")).toBe(true)
  })

  it("apply-preset-safe: 정상 입력시 reasoning '✓' 포함", async () => {
    const { applyPresetSafe } = await import(
      "@/lib/frontend/simulator/v2/apply-preset-safe"
    )
    const r = applyPresetSafe(
      { Vc: 150, fz: 0.05, ap: 2, ae: 1, diameter: 10 },
      65
    )
    expect(r.clampedFields.length).toBe(0)
    expect(r.reasoning).toContain("✓")
  })

  it("advanced-metrics: estimateBueRisk 재질별 윈도우", async () => {
    const { estimateBueRisk } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    // Al (N): [150, 250]
    const rAl = estimateBueRisk({
      materialGroup: "N",
      interfaceTempC: 200,
      Vc: 300,
    })
    expect(rAl.inWindow).toBe(true)
    expect(rAl.risk).toBe("high")
    // 인코넬 (S): [450, 700], T=300 → 윈도우 외 low/mid
    const rS = estimateBueRisk({
      materialGroup: "S",
      interfaceTempC: 300,
      Vc: 45,
    })
    expect(rS.inWindow).toBe(false)
  })

  it("advanced-metrics: estimateHeat 정상 범위", async () => {
    const { estimateHeat } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    const r = estimateHeat({
      Pc: 3,
      Vc: 200,
      fz: 0.05,
      ap: 2,
      ae: 5,
      D: 10,
      materialGroup: "P",
    })
    expect(r.totalPowerW).toBe(3000)
    expect(r.chipHeatPct).toBeGreaterThanOrEqual(50)
    expect(r.chipHeatPct).toBeLessThanOrEqual(95)
    expect(r.toolTempC).toBeGreaterThan(20) // 주변 온도 이상
  })

  it("advanced-metrics: estimateRunoutEffect TIR=0이면 영향 없음", async () => {
    const { estimateRunoutEffect } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    const r = estimateRunoutEffect({ tirUm: 0, fz: 0.05, Z: 4, D: 10 })
    expect(r.peakChipLoadMultiplier).toBeCloseTo(1.0, 1)
    expect(r.estimatedWearAccel).toBeCloseTo(1.0, 1)
    expect(r.flutesEffective).toBeCloseTo(4, 0)
  })

  it("advanced-metrics: decomposeHelixForce 0도면 축방향 힘 없음", async () => {
    const { decomposeHelixForce } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    const r = decomposeHelixForce({ Fc: 100, helixAngle: 0, ap: 2, D: 10 })
    expect(r.axialForceN).toBeCloseTo(0, 1)
    expect(r.tangentialForceN).toBe(100)
    expect(r.liftRatio).toBeCloseTo(0, 1)
  })

  it("advanced-metrics: classifyChipMorphology bueRisk=high → type=bue", async () => {
    const { classifyChipMorphology } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    const r = classifyChipMorphology({
      materialGroup: "P",
      Vc: 200,
      fz: 0.05,
      bueRisk: "high",
    })
    expect(r.type).toBe("bue")
    expect(r.toolWearRisk).toBe("high")
  })

  it("monteCarloToolLife: 분산 일관성 (P10 ≤ P50 ≤ P90)", async () => {
    const { monteCarloToolLife } = await import(
      "@/lib/frontend/simulator/advanced-metrics"
    )
    const r = monteCarloToolLife({
      Vc: 150,
      VcRef: 150,
      MRR: 50,
      samples: 500,
    })
    expect(r.toolLifeP10).toBeLessThanOrEqual(r.toolLifeP50)
    expect(r.toolLifeP50).toBeLessThanOrEqual(r.toolLifeP90)
    expect(r.mrrP10).toBeLessThanOrEqual(r.mrrP50)
    expect(r.mrrP50).toBeLessThanOrEqual(r.mrrP90)
    // Vc=VcRef이므로 mrrP50은 약 50 근처 (샘플 노이즈 고려 ±10)
    expect(r.mrrP50).toBeGreaterThan(40)
    expect(r.mrrP50).toBeLessThan(60)
  })

  it("shortcuts SSOT: 모든 category 유효", async () => {
    const { SHORTCUT_HINTS, SHORTCUT_CATEGORIES } = await import(
      "@/lib/frontend/simulator/v2/use-simulator-shortcuts"
    )
    const categories = new Set(Object.keys(SHORTCUT_CATEGORIES))
    for (const hint of SHORTCUT_HINTS) {
      expect(categories.has(hint.category), `category ${hint.category}`).toBe(true)
      expect(hint.keys.length).toBeGreaterThan(0)
      expect(hint.label.length).toBeGreaterThan(0)
      expect(hint.icon.length).toBeGreaterThan(0)
    }
  })

  it("shortcuts SSOT: SHORTCUT_HINTS 최소 개수", async () => {
    const { SHORTCUT_HINTS } = await import(
      "@/lib/frontend/simulator/v2/use-simulator-shortcuts"
    )
    expect(SHORTCUT_HINTS.length).toBeGreaterThanOrEqual(6)
  })

  it("shopfloor-card / work-instruction 모듈 로드", async () => {
    const s1 = await import("@/lib/frontend/simulator/v2/shopfloor-card")
    const s2 = await import("@/lib/frontend/simulator/v2/work-instruction-pdf")
    expect(typeof s1.generateShopfloorCardPDF).toBe("function")
    expect(typeof s2.generateWorkInstructionPDF).toBe("function")
  })

  it("clipboard-util: copyText export", async () => {
    const { copyText } = await import(
      "@/lib/frontend/simulator/v2/clipboard-util"
    )
    expect(typeof copyText).toBe("function")
  })

  it("use-undo-redo: isSameState 동일 객체 true", async () => {
    const { isSameState } = await import(
      "@/lib/frontend/simulator/v2/use-undo-redo"
    )
    const a = {
      Vc: 150,
      fz: 0.05,
      ap: 5,
      ae: 3,
      diameter: 10,
      fluteCount: 4,
      activeShape: "square",
      isoGroup: "P",
      subgroupKey: "",
      operation: "side-milling",
      coating: "altin",
    }
    const b = { ...a }
    expect(isSameState(a, b)).toBe(true)
  })

  it("use-undo-redo: isSameState 단일 필드 차이 false", async () => {
    const { isSameState } = await import(
      "@/lib/frontend/simulator/v2/use-undo-redo"
    )
    const a = {
      Vc: 150,
      fz: 0.05,
      ap: 5,
      ae: 3,
      diameter: 10,
      fluteCount: 4,
      activeShape: "square",
      isoGroup: "P",
      subgroupKey: "",
      operation: "side-milling",
      coating: "altin",
    }
    expect(isSameState(a, { ...a, Vc: 151 })).toBe(false)
    expect(isSameState(a, { ...a, isoGroup: "M" })).toBe(false)
    expect(isSameState(a, { ...a, coating: "tialn" })).toBe(false)
  })

  it("vendor-attribution: YG-1 Original 최소 15개", async () => {
    const { FEATURES } = await import(
      "@/lib/frontend/simulator/v2/vendor-attribution"
    )
    const novel = Object.values(FEATURES).filter((f) => f.yg1Original)
    expect(novel.length).toBeGreaterThanOrEqual(15)
  })

  it("vendor-attribution: yg1Original=true면 primarySource='yg1-original'", async () => {
    const { FEATURES } = await import(
      "@/lib/frontend/simulator/v2/vendor-attribution"
    )
    for (const feat of Object.values(FEATURES)) {
      if (feat.yg1Original) {
        expect(
          feat.primarySource,
          `${feat.featureId} yg1Original이면 primarySource도 yg1-original이어야 함`
        ).toBe("yg1-original")
      }
    }
  })

  it("vendor-attribution: VENDORS 8개 (harvey~yg1-original)", async () => {
    const { VENDORS } = await import(
      "@/lib/frontend/simulator/v2/vendor-attribution"
    )
    expect(Object.keys(VENDORS).length).toBe(8)
    for (const v of Object.values(VENDORS)) {
      expect(v.name.length).toBeGreaterThan(0)
      expect(v.country.length).toBeGreaterThan(0)
      expect(v.url.startsWith("http")).toBe(true)
    }
  })
})
