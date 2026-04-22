// SPDX-License-Identifier: MIT
// YG-1 Simulator v3 AI API 스모크 테스트
// 목적: 실제 Anthropic 네트워크 호출 없이 route 모듈 로드 및
//       순수 유틸 함수 (advanced-metrics, apply-preset-safe, vendor-attribution)
//       의 기본 입출력 계약을 검증한다.
// 실행: npx vitest run eval/simulator_v2/ai_api_smoke.test.ts

import { describe, expect, it } from "vitest"

describe("AI API 스모크 — route 모듈 로드", () => {
  it("coach route POST export", async () => {
    const mod = await import("@/app/api/simulator/coach/route")
    expect(typeof mod.POST).toBe("function")
  })

  it("nl-query route POST export", async () => {
    const mod = await import("@/app/api/simulator/nl-query/route")
    expect(typeof mod.POST).toBe("function")
  })

  it("explain-warning route POST export", async () => {
    const mod = await import("@/app/api/simulator/explain-warning/route")
    expect(typeof mod.POST).toBe("function")
  })

  it("optimize route POST export", async () => {
    const mod = await import("@/app/api/simulator/optimize/route")
    expect(typeof mod.POST).toBe("function")
  })

  it("auto-agent route POST export", async () => {
    const mod = await import("@/app/api/simulator/auto-agent/route")
    expect(typeof mod.POST).toBe("function")
  })

  it("chat route POST export", async () => {
    const mod = await import("@/app/api/simulator/chat/route")
    expect(typeof mod.POST).toBe("function")
  })
})

describe("Advanced Metrics 순수 함수", () => {
  it("estimateHeat — 기본 입력", async () => {
    const { estimateHeat } = await import("@/lib/frontend/simulator/advanced-metrics")
    const r = estimateHeat({
      Pc: 2.5,
      Vc: 150,
      fz: 0.05,
      ap: 5,
      ae: 3,
      D: 10,
      materialGroup: "P",
    })
    expect(r.totalPowerW).toBe(2500)
    expect(r.chipTempC).toBeGreaterThan(0)
    expect(r.chipHeatPct).toBeGreaterThanOrEqual(50)
    expect(r.chipHeatPct).toBeLessThanOrEqual(95)
  })

  it("estimateRunoutEffect — TIR 계산", async () => {
    const { estimateRunoutEffect } = await import("@/lib/frontend/simulator/advanced-metrics")
    const r = estimateRunoutEffect({ tirUm: 10, fz: 0.05, Z: 4, D: 10 })
    expect(r.peakChipLoadMultiplier).toBeGreaterThan(1)
    expect(r.estimatedWearAccel).toBeGreaterThan(1)
  })

  it("monteCarloToolLife — 분산 반환 (P10 ≤ P50 ≤ P90)", async () => {
    const { monteCarloToolLife } = await import("@/lib/frontend/simulator/advanced-metrics")
    const r = monteCarloToolLife({ Vc: 150, VcRef: 150, MRR: 50, samples: 100 })
    expect(r.toolLifeP10).toBeLessThanOrEqual(r.toolLifeP50)
    expect(r.toolLifeP50).toBeLessThanOrEqual(r.toolLifeP90)
  })
})

describe("ApplyPresetSafe — 자동 클램프", () => {
  it("ap > 2·D 자동 클램프", async () => {
    const { applyPresetSafe } = await import("@/lib/frontend/simulator/v2/apply-preset-safe")
    // workholding=100 → cap 여유, 2·D 규칙만 작동하도록 격리
    const r = applyPresetSafe({ Vc: 150, fz: 0.05, ap: 30, ae: 3, diameter: 10 }, 100)
    expect(r.clamped.ap).toBe(20) // 2·D = 20
    expect(r.clampedFields).toContain("ap")
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it("ae > D 자동 클램프", async () => {
    const { applyPresetSafe } = await import("@/lib/frontend/simulator/v2/apply-preset-safe")
    const r = applyPresetSafe({ Vc: 150, fz: 0.05, ap: 5, ae: 15, diameter: 10 })
    expect(r.clamped.ae).toBeLessThanOrEqual(10)
  })

  it("정상 범위는 변경 없음", async () => {
    const { applyPresetSafe } = await import("@/lib/frontend/simulator/v2/apply-preset-safe")
    // workholding 100 → cap 여유, 정상 파라미터는 건드리지 않음
    const r = applyPresetSafe({ Vc: 150, fz: 0.05, ap: 5, ae: 3, diameter: 10 }, 100)
    expect(r.clampedFields.length).toBe(0)
  })
})

describe("VendorAttribution SSOT", () => {
  it("모든 FEATURES primary source가 VENDORS에 존재", async () => {
    const { VENDORS, FEATURES } = await import("@/lib/frontend/simulator/v2/vendor-attribution")
    for (const feat of Object.values(FEATURES)) {
      expect(VENDORS[feat.primarySource], `${feat.featureId}.primarySource`).toBeDefined()
    }
  })

  it("secondarySources도 VENDORS에 존재 (dead link 방지)", async () => {
    const { VENDORS, FEATURES } = await import("@/lib/frontend/simulator/v2/vendor-attribution")
    for (const feat of Object.values(FEATURES)) {
      for (const sec of feat.secondarySources ?? []) {
        expect(VENDORS[sec], `${feat.featureId}.secondarySources(${sec})`).toBeDefined()
      }
    }
  })

  it("yg1-original 항목 최소 10개 이상 (Novel 자부심)", async () => {
    const { FEATURES } = await import("@/lib/frontend/simulator/v2/vendor-attribution")
    const novel = Object.values(FEATURES).filter(f => f.yg1Original)
    expect(novel.length).toBeGreaterThanOrEqual(10)
  })
})
