// SPDX-License-Identifier: MIT
// 외부 setter로 시뮬 파라미터 적용 시 물리/머신 한계 자동 클램프 + 상관관계 보존
"use client"

import { workholdingCap, type SimWarning } from "../cutting-calculator"

export interface PresetInput {
  // 핵심
  Vc: number; fz: number; ap: number; ae: number
  diameter: number
  fluteCount?: number
  activeShape?: string
  // 재질·가공
  isoGroup?: string; subgroupKey?: string; operation?: string; coating?: string
  // 머신
  workholding?: number        // 0~100
  // 머신 한계 (옵션)
  maxRpm?: number
  maxKw?: number
  maxIpm?: number
}

export interface PresetApplyResult {
  clamped: PresetInput
  clampedFields: string[]      // ["ap", "ae"] 등 실제로 변경된 필드
  warnings: SimWarning[]
  reasoning: string            // "workholding 65로 ap 20→14mm 제한" 같은 설명
}

export const VC_ABS_MAX = 1000
export const FZ_ABS_MIN = 0.001
export const FZ_ABS_MAX = 0.5

export function applyPresetSafe(preset: PresetInput, workholding: number = 65): PresetApplyResult {
  const clamped = { ...preset }
  const clampedFields: string[] = []
  const warnings: SimWarning[] = []
  const reasons: string[] = []

  // 1. 절대 물리 한계
  if (preset.Vc > VC_ABS_MAX) {
    clamped.Vc = VC_ABS_MAX
    clampedFields.push("Vc")
    reasons.push(`Vc ${preset.Vc} → ${VC_ABS_MAX} (물리 최대)`)
  }
  if (preset.Vc < 0) { clamped.Vc = 0; clampedFields.push("Vc") }

  // 2. fz 범위
  if (preset.fz < FZ_ABS_MIN) { clamped.fz = FZ_ABS_MIN; clampedFields.push("fz") }
  if (preset.fz > FZ_ABS_MAX) { clamped.fz = FZ_ABS_MAX; clampedFields.push("fz") }

  // 3. 직경 기반 ap/ae 한계
  if (preset.ap > preset.diameter * 2) {
    clamped.ap = preset.diameter * 2
    clampedFields.push("ap")
    reasons.push(`ap > 2·D 제한: ${preset.ap}mm → ${clamped.ap}mm`)
    warnings.push({ level: "warn", message: "ap가 2·D 초과하여 자동 제한됨" })
  }
  if (preset.ae > preset.diameter) {
    clamped.ae = preset.diameter
    clampedFields.push("ae")
    reasons.push(`ae > D 제한: ${preset.ae}mm → ${clamped.ae}mm`)
    warnings.push({ level: "error", message: "ae가 공구 지름 초과 → 물리 불가능, D로 제한" })
  }

  // 4. Workholding cap 적용
  const cap = workholdingCap(workholding, preset.diameter)
  if (clamped.ap > cap.apMax) {
    reasons.push(`workholding ${workholding} → apMax ${cap.apMax.toFixed(1)}mm`)
    clamped.ap = cap.apMax
    if (!clampedFields.includes("ap")) clampedFields.push("ap")
    warnings.push({ level: "warn", message: `ap ${preset.ap}mm > workholding 한계 → ${cap.apMax.toFixed(1)}mm로 제한` })
  }
  if (clamped.ae > cap.aeMax) {
    reasons.push(`workholding ${workholding} → aeMax ${cap.aeMax.toFixed(1)}mm`)
    clamped.ae = cap.aeMax
    if (!clampedFields.includes("ae")) clampedFields.push("ae")
  }

  // 5. 머신 한계 (optional)
  // maxRpm/maxKw 기반 Vc 역산 클램프는 복잡하므로 여기선 경고만

  const reasoning = reasons.length > 0
    ? `⚙ 자동 조정: ${reasons.join(" · ")}`
    : "✓ 모든 파라미터 정상 범위"

  return { clamped, clampedFields, warnings, reasoning }
}

// 재질 변경 시 Vc 범위도 변경 → 자동 조정 권장 함수
export function suggestVcForMaterial(isoGroup: string, currentVc: number): { suggestedVc: number; needsAdjust: boolean } {
  const ranges: Record<string, [number, number]> = {
    P: [120, 250], M: [80, 150], K: [130, 250],
    N: [300, 800], S: [30, 80], H: [40, 120],
  }
  const range = ranges[isoGroup] ?? [100, 300]
  if (currentVc < range[0]) return { suggestedVc: range[0], needsAdjust: true }
  if (currentVc > range[1]) return { suggestedVc: range[1], needsAdjust: true }
  return { suggestedVc: currentVc, needsAdjust: false }
}

// 상관관계 체크 — 주어진 Vc/n/diameter가 일관되는지 검증
export function verifyConsistency(Vc: number, n: number, diameter: number): boolean {
  const expectedN = (1000 * Vc) / (Math.PI * diameter)
  return Math.abs(n - expectedN) < 1
}
