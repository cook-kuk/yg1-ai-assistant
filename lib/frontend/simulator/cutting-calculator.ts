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
  const MRR = parseFloat(((ap * ae * Vf) / 1000).toFixed(2))
  const kc = KC_TABLE[isoGroup] ?? 2000
  // Pc(kW) = MRR(cm³/min) × kc(N/mm²) / (60·10³·η)  — Sandvik 공식
  const Pc = parseFloat(((MRR * kc) / (60 * 1000 * ETA)).toFixed(3))

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

// Radial Chip Thinning Factor — ae/D < 0.5이면 실제 chip load는 fz보다 작아짐
// RCTF = sin(engagement angle) 근사. 1에 가까울수록 보정 불필요.
export function radialChipThinningFactor(ae: number, D: number): number {
  if (D <= 0) return 1
  const ratio = Math.min(Math.max(ae / D, 0), 1)
  if (ratio >= 0.5) return 1
  const inner = 1 - (1 - 2 * ratio) ** 2
  return Math.max(0.001, Math.sqrt(inner))
}

// Ball-nose effective diameter: 얕은 ap에서 실제 절삭 지름이 D보다 작음
// D_eff = 2 * sqrt(ap * (D - ap))  (ap ≤ R = D/2 일 때)
export function ballNoseEffectiveDiameter(D: number, ap: number): number {
  if (D <= 0) return D
  const R = D / 2
  const depth = Math.min(Math.max(ap, 0), R)
  return 2 * Math.sqrt(depth * (D - depth))
}

// Engagement angle (rad) — for chip thinning visualization
export function engagementAngleRad(ae: number, D: number): number {
  if (D <= 0) return 0
  const ratio = Math.min(Math.max(ae / D, 0), 1)
  return Math.acos(1 - 2 * ratio)
}

export interface ShaftModel {
  stickoutMm: number     // 공구 돌출 길이
  youngModulusGPa: number // 재질 탄성계수 (카바이드 ≈ 600 GPa)
}

export interface DerivedFactors {
  RCTF: number           // chip thinning factor
  hex: number            // 실 chip load (mm) = fz × RCTF
  fzCompensated: number  // 목표 chip load를 맞추기 위한 보정 fz
  Deff: number           // 볼 엔드밀 유효 지름 (square는 = D)
  VcActual: number       // D_eff 기반 실제 SFM
  nActual: number        // RPM (D_eff 기반)
  engagementDeg: number  // 엔게이지먼트 각 (°)
}

export function deriveFactors(params: {
  Vc: number
  fz: number
  ap: number
  ae: number
  D: number
  shape: "square" | "ball" | "radius" | "chamfer"
}): DerivedFactors {
  const { Vc, fz, ap, ae, D, shape } = params
  const RCTF = radialChipThinningFactor(ae, D)
  const hex = fz * RCTF
  const fzCompensated = RCTF > 0 ? fz / RCTF : fz
  const Deff = shape === "ball" ? ballNoseEffectiveDiameter(D, ap) : D
  const n = Deff > 0 ? (1000 * Vc) / (Math.PI * Deff) : 0
  return {
    RCTF: parseFloat(RCTF.toFixed(3)),
    hex: parseFloat(hex.toFixed(4)),
    fzCompensated: parseFloat(fzCompensated.toFixed(4)),
    Deff: parseFloat(Deff.toFixed(3)),
    VcActual: parseFloat(((Math.PI * Deff * n) / 1000).toFixed(1)),
    nActual: Math.round(n),
    engagementDeg: parseFloat(((engagementAngleRad(ae, D) * 180) / Math.PI).toFixed(1)),
  }
}

export interface AdvancedResult {
  torque: number    // N·m
  Fc: number        // 절삭력 N
  deflection: number // 공구 끝 편향 μm
}

// 절삭력 & 공구 편향 (캔틸레버 모델)
export function computeAdvanced(params: {
  Pc: number        // kW
  n: number         // rpm
  D: number         // mm
  shaft: ShaftModel
}): AdvancedResult {
  const { Pc, n, D, shaft } = params
  const omega = (2 * Math.PI * n) / 60 // rad/s
  const torque = omega > 0 ? (Pc * 1000) / omega : 0 // N·m
  const Fc = D > 0 ? (2 * torque * 1000) / D : 0     // N (radius in mm → torque*1000 for N·mm)
  // 편향 δ = F·L³ / (3·E·I), 원형 단면 I = π·D⁴/64
  const L = shaft.stickoutMm // mm
  const E = shaft.youngModulusGPa * 1000 // MPa = N/mm²
  const I = (Math.PI * D ** 4) / 64 // mm⁴
  const deflection = E > 0 && I > 0 ? (Fc * L ** 3) / (3 * E * I) : 0 // mm
  return {
    torque: parseFloat(torque.toFixed(2)),
    Fc: Math.round(Fc),
    deflection: parseFloat((deflection * 1000).toFixed(1)), // μm
  }
}

// Unit conversions
export const UNITS = {
  mmToIn: (mm: number) => mm / 25.4,
  inToMm: (inch: number) => inch * 25.4,
  mPerMinToSFM: (mpm: number) => mpm * 3.28084,      // m/min → ft/min (SFM)
  sfmToMPerMin: (sfm: number) => sfm / 3.28084,
  mmPerMinToIPM: (mmpm: number) => mmpm / 25.4,
  ipmToMmPerMin: (ipm: number) => ipm * 25.4,
  kwToHp: (kw: number) => kw * 1.34102,
  hpToKw: (hp: number) => hp / 1.34102,
  nmToInLb: (nm: number) => nm * 8.85075,
}

export type DisplayUnit = "metric" | "inch" | "both"

// ── Tool life (Taylor's equation) ──
// V · T^n = C  →  T = (C / V)^(1/n)
// n ≈ 0.25 for carbide, ≈ 0.125 for HSS
export function estimateToolLifeMin(params: {
  Vc: number
  VcReference: number  // catalog recommended Vc
  coatingMult: number  // 1.0 = none
  isoGroup: string
  toolMaterialE: number // 600=carbide, 210=HSS
}): number {
  const { Vc, VcReference, coatingMult, isoGroup, toolMaterialE } = params
  if (Vc <= 0 || VcReference <= 0) return 0
  const isHSS = toolMaterialE < 300
  const n = isHSS ? 0.125 : 0.25
  const referenceLife = isHSS ? 60 : (isoGroup === "H" || isoGroup === "S" ? 20 : 45) // min
  const effectiveRef = VcReference * coatingMult
  const ratio = effectiveRef / Vc
  const life = referenceLife * Math.pow(ratio, 1 / n)
  return Math.max(0.5, Math.min(life, 600))
}

// ── Surface roughness Ra estimate ──
// Ball-nose Ra(theoretical) ≈ fz² / (8·R)  where R = D/2 for ball, CR for radius
// For square endmill peripheral: Ra ≈ fz²·Z / (8·R_tip)  (R_tip ≈ 0.02~0.05mm edge hone)
export function estimateRaUm(params: {
  fz: number
  D: number
  shape: "square" | "ball" | "radius" | "chamfer"
  cornerR?: number
  ae?: number
}): number {
  const { fz, D, shape, cornerR, ae } = params
  if (fz <= 0) return 0
  let R = 0.04 // default edge hone radius mm
  if (shape === "ball") R = D / 2
  else if (shape === "radius") R = cornerR ?? 0.5
  // Peripheral Ra ≈ (fz²) / (8R) × 1000 μm
  const ra = ((fz * fz) / (8 * R)) * 1000
  // Adjustment for very shallow ae (chip thinning improves finish)
  const aeAdjust = ae != null && ae < D / 2 ? 0.8 : 1.0
  return parseFloat((ra * aeAdjust).toFixed(2))
}

// ── Chatter stability probability (simplified) ──
// Based on stickout/D ratio + Pc vs spindle power + workholding
export function estimateChatterRisk(params: {
  stickoutMm: number
  D: number
  Pc: number
  maxKw: number
  workholdingSecurity: number
  deflectionUm: number
}): { risk: number; level: "low" | "med" | "high"; reasons: string[] } {
  const { stickoutMm, D, Pc, maxKw, workholdingSecurity, deflectionUm } = params
  const reasons: string[] = []
  let risk = 0
  const lOverD = D > 0 ? stickoutMm / D : 0
  if (lOverD > 6) { risk += 40; reasons.push(`L/D ${lOverD.toFixed(1)} 과도`) }
  else if (lOverD > 4) { risk += 20; reasons.push(`L/D ${lOverD.toFixed(1)} 경계`) }
  if (Pc > maxKw * 0.85) { risk += 20; reasons.push("파워 한계 근접") }
  if (workholdingSecurity < 50) { risk += 25; reasons.push("Workholding 낮음") }
  else if (workholdingSecurity < 70) { risk += 10 }
  if (deflectionUm > 30) { risk += 20; reasons.push(`편향 ${deflectionUm}μm 과대`) }
  risk = Math.min(100, risk)
  const level: "low" | "med" | "high" = risk >= 55 ? "high" : risk >= 30 ? "med" : "low"
  return { risk, level, reasons }
}

// ── Minimum chip thickness per ISO group (rule of thumb, mm) ──
export const MIN_CHIP_THICKNESS: Record<string, number> = {
  P: 0.010, // carbon/alloy steel
  M: 0.015, // stainless (higher — work hardening)
  K: 0.008, // cast iron
  N: 0.005, // non-ferrous
  S: 0.020, // superalloy (much higher — prevent rubbing)
  H: 0.015, // hardened
}

// ── Hardness-based Vc derate ──
// Higher hardness → lower cutting speed.  Approximate derate for steels.
export function hardnessVcDerate(hardnessScale: string, hardnessValue: number): number {
  // Convert to HRC-equivalent rough scale
  let hrc = hardnessValue
  if (hardnessScale === "HBW" || hardnessScale === "HBS") {
    hrc = (hardnessValue - 223) / 6.5
  } else if (hardnessScale === "HRB") {
    hrc = (hardnessValue * 1.8 - 5 - 223) / 6.5
  }
  if (hrc < 20) return 1.0  // soft steels unaffected
  if (hrc < 30) return 0.95
  if (hrc < 40) return 0.85
  if (hrc < 50) return 0.72
  if (hrc < 55) return 0.58
  if (hrc < 60) return 0.45
  return 0.35  // > 60 HRC very slow
}

// ── Stickout derate ── L/D 증가 시 Vc/fz 자동 하향
export function stickoutDerate(L: number, D: number): { vc: number; fz: number } {
  if (D <= 0) return { vc: 1, fz: 1 }
  const lOverD = L / D
  if (lOverD <= 3) return { vc: 1, fz: 1 }
  if (lOverD <= 4) return { vc: 0.95, fz: 0.9 }
  if (lOverD <= 5) return { vc: 0.85, fz: 0.8 }
  if (lOverD <= 6) return { vc: 0.75, fz: 0.7 }
  if (lOverD <= 8) return { vc: 0.6, fz: 0.55 }
  return { vc: 0.45, fz: 0.4 }
}

// ── Workholding → ap/ae max cap ──
export function workholdingCap(security: number, D: number): { apMax: number; aeMax: number } {
  const s = Math.min(Math.max(security, 0), 100) / 100
  // Loose: 0.5D ap, 0.3D ae.  Rigid: 2D ap, full D ae.
  return {
    apMax: D * (0.5 + s * 1.5),
    aeMax: D * (0.3 + s * 0.7),
  }
}

// ── Climb vs Conventional ──
export function climbAdjust(climb: boolean): { raMult: number; fcMult: number; lifeMult: number } {
  // Climb milling: better Ra (−20%), lower Fc (−10%), +15% life
  // Conventional: reference
  if (climb) return { raMult: 0.8, fcMult: 0.9, lifeMult: 1.15 }
  return { raMult: 1.0, fcMult: 1.0, lifeMult: 1.0 }
}

// ── Multi-pass plan ──
export interface PassPlan {
  roughPasses: number
  finishPasses: number
  totalTimeMin: number
  mrrRough: number
  mrrFinish: number
}
export function computePassPlan(params: {
  stockLmm: number
  stockWmm: number
  stockHmm: number
  apFinish: number
  aeFinish: number
  VfRough: number
  VfFinish: number
  D: number
  apMaxRough: number
}): PassPlan {
  const { stockLmm, stockWmm, stockHmm, apFinish, aeFinish, VfRough, VfFinish, D, apMaxRough } = params
  const totalDepth = stockHmm - apFinish
  const roughPasses = Math.max(1, Math.ceil(totalDepth / apMaxRough))
  // Estimate path length per pass for rough: zig-zag across width
  const roughStepover = D * 0.6
  const roughLinesPerLayer = Math.ceil(stockWmm / roughStepover)
  const roughPathLen = roughLinesPerLayer * stockLmm * roughPasses
  // Finish: perimeter + top
  const perimeter = 2 * (stockLmm + stockWmm)
  const finishPasses = 2 // perimeter + top
  const finishPathLen = perimeter + stockLmm * Math.ceil(stockWmm / (D * 0.5))
  const timeRough = VfRough > 0 ? roughPathLen / VfRough : 0
  const timeFinish = VfFinish > 0 ? finishPathLen / VfFinish : 0
  const mrrRough = (apMaxRough * aeFinish * VfRough) / 1000
  const mrrFinish = (apFinish * aeFinish * VfFinish) / 1000
  return {
    roughPasses, finishPasses,
    totalTimeMin: parseFloat((timeRough + timeFinish).toFixed(1)),
    mrrRough: parseFloat(mrrRough.toFixed(1)),
    mrrFinish: parseFloat(mrrFinish.toFixed(1)),
  }
}

// ── Economic cutting speed (Taylor-Ackoff) ──
// Vc_econ = Vc_ref · ((machine_cost) / ((1/n - 1) · tool_cost))^n
export function economicVc(params: {
  VcReference: number
  toolLifeRefMin: number
  toolCostKrw: number
  machineCostPerHourKrw: number
  taylorN: number
}): number {
  const { VcReference, toolCostKrw, machineCostPerHourKrw, taylorN } = params
  const machineCostPerMin = machineCostPerHourKrw / 60
  if (machineCostPerMin <= 0 || toolCostKrw <= 0) return VcReference
  const ratio = machineCostPerMin / ((1 / taylorN - 1) * toolCostKrw)
  return VcReference * Math.pow(Math.max(0.01, ratio), taylorN)
}

// ── Reverse solver: target MRR → suggest Vc·fz·ap·ae combo ──
export function solveForTargetMRR(params: {
  targetMRR: number   // cm³/min
  D: number
  Z: number
  isoGroup: string
  shape: string
  apMax: number
  aeMax: number
}): { Vc: number; fz: number; ap: number; ae: number; achievable: boolean } {
  const { targetMRR, D, Z, apMax, aeMax } = params
  // Strategy: use moderate ap, moderate ae, solve for Vf, then split into Vc & fz
  const ap = Math.min(apMax, D)
  const ae = Math.min(aeMax, D * 0.4)
  const VfRequired = (targetMRR * 1000) / (ap * ae) // mm/min
  // Vf = fz · Z · n.  Assume fz = 0.05, solve for n, then Vc.
  const fz = 0.05
  const n = VfRequired / (fz * Z)
  const Vc = (Math.PI * D * n) / 1000
  const achievable = Vc >= 30 && Vc <= 800 && n >= 100 && n <= 60000
  return {
    Vc: parseFloat(Vc.toFixed(0)),
    fz: parseFloat(fz.toFixed(4)),
    ap: parseFloat(ap.toFixed(1)),
    ae: parseFloat(ae.toFixed(1)),
    achievable,
  }
}

// ── 내부/외부 코너 IPM 보정 (Harvey 공식) ──
export function internalCornerFeed(F: number, OD: number, TD: number): number {
  if (OD <= 0 || OD <= TD) return F
  return F * (OD - TD) / OD
}
export function externalCornerFeed(F: number, ID: number, TD: number): number {
  if (ID <= 0) return F
  return F * (ID + TD) / ID
}

// ── 챔퍼 엔드밀 D_eff ──
// θ = half-angle from tool axis (45° → 45°, 60° → 30°, 90° → 45°)
// D_eff = D_tip + 2 · depth · tan(θ)
export function chamferEffD(Dtip: number, depth: number, halfAngleDeg: number): number {
  const rad = (halfAngleDeg * Math.PI) / 180
  return Dtip + 2 * depth * Math.tan(rad)
}

// ── 재질별 SFM/IPT 출발값 (1/4" 엔드밀 기준) — Harvey/Helical 카탈로그 기반 ──
export interface SfmIptRef {
  material: string
  sfmMin: number
  sfmMax: number
  iptMin: number  // in/tooth
  iptMax: number
  note: string
}
export const SFM_IPT_TABLE: SfmIptRef[] = [
  { material: "6061-T6 Aluminum",   sfmMin: 800, sfmMax: 1200, iptMin: 0.0030, iptMax: 0.0050, note: "ZPlus 미코팅 권장" },
  { material: "7075-T6 Aluminum",   sfmMin: 600, sfmMax: 1000, iptMin: 0.0025, iptMax: 0.0040, note: "더 단단함" },
  { material: "304 Stainless",      sfmMin: 80,  sfmMax: 150,  iptMin: 0.0006, iptMax: 0.0012, note: "가공경화 주의" },
  { material: "316 Stainless",      sfmMin: 70,  sfmMax: 130,  iptMin: 0.0006, iptMax: 0.0010, note: "더 점착성" },
  { material: "17-4 PH H900",       sfmMin: 150, sfmMax: 250,  iptMin: 0.0010, iptMax: 0.0018, note: "PH강 표준" },
  { material: "1018 Mild Steel",    sfmMin: 200, sfmMax: 300,  iptMin: 0.0015, iptMax: 0.0025, note: "가장 무난" },
  { material: "4140 Annealed",      sfmMin: 180, sfmMax: 280,  iptMin: 0.0012, iptMax: 0.0022, note: "저합금강" },
  { material: "4140 Pre-hard 30HRC", sfmMin: 100, sfmMax: 180, iptMin: 0.0008, iptMax: 0.0015, note: "코팅 필수" },
  { material: "D2 / SKD11 Hard 58+HRC", sfmMin: 50, sfmMax: 100, iptMin: 0.0005, iptMax: 0.0010, note: "AlTiN 필수" },
  { material: "Ti-6Al-4V Annealed", sfmMin: 80,  sfmMax: 150,  iptMin: 0.0010, iptMax: 0.0020, note: "절삭유 풍부히" },
  { material: "Inconel 718",        sfmMin: 30,  sfmMax: 80,   iptMin: 0.0005, iptMax: 0.0012, note: "난삭재 최고" },
  { material: "Gray Cast Iron",     sfmMin: 200, sfmMax: 400,  iptMin: 0.0015, iptMax: 0.0030, note: "dry, 흡입필수" },
  { material: "황동 / 청동",         sfmMin: 300, sfmMax: 600, iptMin: 0.0020, iptMax: 0.0040, note: "무난" },
]

// ── Cost-per-part analysis ──
export function estimateCostPerPart(params: {
  toolLifeMin: number
  cycleTimeMin: number
  toolCostKrw: number
  machineCostPerHourKrw: number
}): { toolCostPerPart: number; machineCostPerPart: number; total: number; partsPerTool: number } {
  const { toolLifeMin, cycleTimeMin, toolCostKrw, machineCostPerHourKrw } = params
  const partsPerTool = cycleTimeMin > 0 ? toolLifeMin / cycleTimeMin : 0
  const toolCostPerPart = partsPerTool > 0 ? toolCostKrw / partsPerTool : 0
  const machineCostPerPart = (machineCostPerHourKrw / 60) * cycleTimeMin
  return {
    toolCostPerPart: Math.round(toolCostPerPart),
    machineCostPerPart: Math.round(machineCostPerPart),
    total: Math.round(toolCostPerPart + machineCostPerPart),
    partsPerTool: parseFloat(partsPerTool.toFixed(1)),
  }
}

// Workholding security (0 = loose, 100 = rigid) — scales allowable deflection & safety margin
export function workholdingAllowance(security: number): { deflectionLimit: number; aggressivenessMultiplier: number } {
  const s = Math.min(Math.max(security, 0), 100) / 100
  // Loose: strict limits. Rigid: can push harder.
  return {
    deflectionLimit: 10 + s * 50,       // 10μm (loose) ~ 60μm (rigid)
    aggressivenessMultiplier: 0.7 + s * 0.6, // 0.7 (loose) ~ 1.3 (rigid)
  }
}

export interface SimWarning {
  level: "error" | "warn" | "info"
  message: string
}

export function buildWarnings(params: {
  D: number
  ap: number
  ae: number
  n: number
  Pc: number
  deflection: number
  shape: "square" | "ball" | "radius" | "chamfer"
  machine: { maxRpm: number; maxKw: number }
  isoGroup: string
  Vc: number
}): SimWarning[] {
  const w: SimWarning[] = []
  const { D, ap, ae, n, Pc, deflection, shape, machine, isoGroup, Vc } = params

  if (ae > D) w.push({ level: "error", message: `ae (${ae}mm) > D (${D}mm): 물리적으로 불가능` })
  if (ap > 2 * D && shape !== "chamfer") w.push({ level: "error", message: `ap > 2·D: 공구 파손 위험 (권장 ≤ 2D)` })
  else if (ap > D && shape === "square") w.push({ level: "warn", message: `ap > D: LOC 초과 가능, 공구 제원 확인 필요` })

  if (n > machine.maxRpm) w.push({ level: "error", message: `RPM ${Math.round(n).toLocaleString()} > 스핀들 최대 ${machine.maxRpm.toLocaleString()}` })
  else if (n > machine.maxRpm * 0.9) w.push({ level: "warn", message: `RPM이 스핀들 한계 90% 초과` })

  if (Pc > machine.maxKw) w.push({ level: "error", message: `Pc ${Pc}kW > 스핀들 최대 ${machine.maxKw}kW` })
  else if (Pc > machine.maxKw * 0.85) w.push({ level: "warn", message: `Pc가 스핀들 파워 85% 초과` })

  if (deflection > 50) w.push({ level: "error", message: `공구 편향 ${deflection}μm > 50μm: 가공 정밀도 심각한 손상` })
  else if (deflection > 20) w.push({ level: "warn", message: `공구 편향 ${deflection}μm > 20μm: 가공 오차 주의` })

  if (isoGroup === "H" && Vc > 150) w.push({ level: "warn", message: `고경도강에 Vc ${Vc}m/min 고속: 공구수명 단축 위험` })
  if (isoGroup === "S" && Vc > 80) w.push({ level: "warn", message: `내열합금에 Vc ${Vc}m/min: 내열합금은 저속 권장` })

  return w
}
