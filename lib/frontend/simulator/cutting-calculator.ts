/**
 * 절삭조건 시뮬레이터 — 순수 계산 함수
 */

// 소재별 비절삭저항 (N/mm²)
export const KC_TABLE: Record<string, number> = {
  P: 2000,  // 탄소강
  M: 2200,  // 스테인리스
  K: 1200,  // 주철
  N: 800,   // 알루미늄
  S: 2500,  // 내열합금
  H: 3500,  // 고경도강
}

export const ISO_LABELS: Record<string, string> = {
  P: "탄소강 (P)",
  M: "스테인리스 (M)",
  K: "주철 (K)",
  N: "비철금속 (N)",
  S: "초내열합금 (S)",
  H: "고경도강 (H)",
}

export interface CuttingParams {
  Vc: number    // 절삭속도 m/min
  fz: number    // 날당이송 mm/tooth
  ap: number    // 축방향 절입 mm
  ae: number    // 경방향 절입 mm
  D: number     // 공구 직경 mm
  Z: number     // 날수
  isoGroup: string
}

export interface CuttingResult {
  n: number     // RPM
  Vf: number    // 테이블이송 mm/min
  MRR: number   // 금속제거율 cm³/min
  Pc: number    // 소요동력 kW
}

const ETA = 0.8 // 기계효율

export function calculateCutting(params: CuttingParams): CuttingResult {
  const { Vc, fz, ap, ae, D, Z, isoGroup } = params

  const n = Math.round((1000 * Vc) / (Math.PI * D))
  const Vf = Math.round(fz * Z * n)
  const MRR = parseFloat(((ap * ae * Vf) / 1000).toFixed(1))
  const kc = KC_TABLE[isoGroup] ?? 2000
  const Pc = parseFloat(((MRR * kc) / (60 * 1000000 * ETA)).toFixed(2))

  return { n, Vf, MRR, Pc }
}

export interface CatalogRange {
  VcMin: number
  VcMax: number
  fzMin: number
  fzMax: number
  apMax: number
  aeMax: number
}

export function getDefaultRange(D: number): CatalogRange {
  return {
    VcMin: 50,
    VcMax: 400,
    fzMin: 0.01,
    fzMax: 0.3,
    apMax: D * 2,
    aeMax: D,
  }
}

export type OptimizationMode = "productivity" | "balanced" | "toollife"

export function applyOptimizationMode(
  range: CatalogRange,
  mode: OptimizationMode,
): { Vc: number; fz: number } {
  const vcRange = range.VcMax - range.VcMin
  const fzRange = range.fzMax - range.fzMin

  switch (mode) {
    case "productivity":
      return { Vc: range.VcMin + vcRange * 0.85, fz: range.fzMin + fzRange * 0.8 }
    case "balanced":
      return { Vc: range.VcMin + vcRange * 0.5, fz: range.fzMin + fzRange * 0.5 }
    case "toollife":
      return { Vc: range.VcMin + vcRange * 0.2, fz: range.fzMin + fzRange * 0.25 }
  }
}
