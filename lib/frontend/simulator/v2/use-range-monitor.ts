"use client"
import { useMemo } from "react"
import type { SimWarning } from "../cutting-calculator"

export interface RangeMonitorInput {
  Vc: number; fz: number; ap: number; ae: number
  diameter: number; fluteCount: number
  rpm: number; Vf: number; Pc: number
  deflection: number; toolLifeMin: number; chatterRisk: number
  stickoutMm: number
  isoGroup: string; hardnessValue: number
  maxRpm: number; maxKw: number; maxIpm: number
  workholding: number  // 0~100
}

/**
 * 전체 파라미터의 실시간 범위 체크.
 * cutting-calculator의 buildWarnings와 중복되지 않는 **사전 위반** 을 반환.
 * Vf IPM 체크, Pc 비율, deflection μm, toolLife 최소, L/D, 경도 대비 Vc 등.
 */
export function useRangeMonitor(input: RangeMonitorInput): {
  violations: SimWarning[]
  summary: { errors: number; warns: number; infos: number }
  totalScore: number  // 0 (all bad) ~ 100 (all safe)
} {
  return useMemo(() => {
    const v: SimWarning[] = []
    const { Vc, fz, ap, ae, diameter, rpm, Vf, Pc, deflection, toolLifeMin, chatterRisk, stickoutMm, isoGroup, hardnessValue, maxRpm, maxKw, maxIpm } = input

    // 절대 범위
    if (Vc <= 0 || Vc > 1000) v.push({ level: "error", message: `Vc ${Vc} m/min — 물리 한계 초과 (0~1000)` })
    if (fz < 0.001) v.push({ level: "warn", message: `fz ${fz} mm/t — rubbing 위험 (< 0.001)` })
    if (fz > 0.5) v.push({ level: "warn", message: `fz ${fz} mm/t — 과도 (> 0.5)` })

    // 머신 한계
    const vfIpm = Vf / 25.4
    if (rpm > maxRpm) v.push({ level: "error", message: `RPM ${rpm} > 스핀들 한계 ${maxRpm}` })
    else if (rpm > maxRpm * 0.95) v.push({ level: "warn", message: `RPM 스핀들 한계 95% 근접` })
    if (vfIpm > maxIpm) v.push({ level: "error", message: `Vf ${vfIpm.toFixed(0)} IPM > 머신 ${maxIpm} IPM` })
    if (Pc > maxKw) v.push({ level: "error", message: `Pc ${Pc.toFixed(2)} > 스핀들 ${maxKw} kW` })
    else if (Pc > maxKw * 0.9) v.push({ level: "warn", message: `Pc 스핀들 90% 초과` })

    // L/D
    const lOverD = diameter > 0 ? stickoutMm / diameter : 0
    if (lOverD > 8) v.push({ level: "error", message: `L/D ${lOverD.toFixed(1)} > 8 · 공구 파손 위험` })
    else if (lOverD > 5) v.push({ level: "warn", message: `L/D ${lOverD.toFixed(1)} > 5 · 편향 증가` })

    // 편향
    if (deflection > 50) v.push({ level: "error", message: `편향 ${deflection}μm > 50μm · 정밀도 심각 손상` })
    else if (deflection > 20) v.push({ level: "warn", message: `편향 ${deflection}μm > 20μm · 주의` })

    // 공구 수명
    if (toolLifeMin < 10) v.push({ level: "warn", message: `공구 수명 ${toolLifeMin.toFixed(0)}min < 10min · 생산성 저하` })

    // Chatter
    if (chatterRisk >= 55) v.push({ level: "error", message: `채터 위험 ${chatterRisk}% — HIGH` })
    else if (chatterRisk >= 30) v.push({ level: "warn", message: `채터 위험 ${chatterRisk}% — MED` })

    // ap/ae 과도
    if (ap > diameter * 2) v.push({ level: "error", message: `ap > 2·D · 공구 파손 위험` })
    if (ae > diameter) v.push({ level: "error", message: `ae > D · 물리적 불가능` })

    // 재질 vs Vc
    const matRange: Record<string, [number, number]> = {
      P: [80, 280], M: [60, 160], K: [100, 280], N: [200, 900], S: [25, 90], H: [30, 130],
    }
    const range = matRange[isoGroup]
    if (range) {
      if (Vc < range[0] * 0.7) v.push({ level: "warn", message: `${isoGroup}계 Vc ${Vc} 저속 (권장 ${range[0]}~${range[1]})` })
      if (Vc > range[1] * 1.2) v.push({ level: "warn", message: `${isoGroup}계 Vc ${Vc} 고속 · 수명 단축 위험` })
    }

    // 경도 vs Vc
    if (hardnessValue > 55 && Vc > 150) v.push({ level: "warn", message: `경도 ${hardnessValue} HRC + Vc ${Vc} · 공구 급속 마모` })

    const errors = v.filter(w => w.level === "error").length
    const warns = v.filter(w => w.level === "warn").length
    const infos = v.filter(w => w.level === "info").length
    const totalScore = Math.max(0, 100 - errors * 30 - warns * 10 - infos * 2)

    return { violations: v, summary: { errors, warns, infos }, totalScore }
  }, [input])
}
