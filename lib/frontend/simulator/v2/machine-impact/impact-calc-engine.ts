/**
 * Machine Impact Lab — pure calculation engine.
 *
 * Independent of `cutting-calculator.ts` by design (per the lab's
 * product spec: "기존 코드 절대 보호"). Takes a locked tool / material
 * / operation plus a machine-config knob set (spindle / holder /
 * coolant / stickout / workholding) and returns every derived metric
 * the UI needs to render — so downstream components stay dumb.
 *
 * Re-uses `SPINDLE_PRESETS`, `HOLDER_PRESETS`, `COOLANTS` from
 * presets.ts via the key lookups — no data duplication.
 */
import {
  SPINDLE_PRESETS,
  HOLDER_PRESETS,
  COOLANTS,
  type SpindlePreset,
  type HolderPreset,
  type CoolantOption,
} from "../presets"

// ── Defaults when HolderPreset's optional fields are absent ──────────
// Hit when a caller passes a custom holder that didn't opt into the
// lab-specific extensions. Values chosen so a "no info" holder reads
// like a mid-tier ER collet (not punished, not rewarded).
const DEFAULT_HOLDER_TIR_MICRON = 15
const DEFAULT_HOLDER_MAX_RPM = 20000
const DEFAULT_HOLDER_MIN_STICKOUT = 1.0

// Taylor tool-life reference — 60 min at the material's baseline Vc,
// with exponent n=0.25 for carbide (industry default). When the user
// pushes Vc above baseline the life falls off per T = T_ref * (Vc_ref/Vc)^(1/n).
const TAYLOR_T_REF_MIN = 60
const TAYLOR_N = 0.25

// Power derate — Pc = MRR·kc / (60·10^6·η). η ~ 0.8 for VMC trains.
const POWER_EFFICIENCY = 0.8

// ── Input / output types ─────────────────────────────────────────────

export interface ComputeInput {
  /** Tool Ø in inches — used for RPM = 3.82 SFM / D and L/D. */
  D_inch: number
  /** Tool Ø in mm — kept so the UI can render both units without re-converting. */
  D_mm: number
  /** Flute count. */
  Z: number

  /** Baseline surface speed (ft/min) from the tool's PDF for this material. */
  sfmBase: number
  /** Baseline feed-per-tooth (inch) from the same reference. */
  iptBase: number
  /** Specific cutting force (N/mm²) of the material — drives the power estimate. */
  kc: number

  /** Axial depth of cut in inches (fixed by the locked operation). */
  adocInch: number
  /** Radial depth of cut in inches. */
  rdocInch: number

  /** User-selected machine-config knobs. */
  spindleKey: string
  holderKey: string
  coolantKey: string
  stickoutInch: number
  /** 0..100 — how rigid the workholding setup is. */
  workholdingPct: number
}

export interface ComputeResult {
  spindle: SpindlePreset
  holder: HolderPreset
  coolant: CoolantOption

  /** Derived tool stickout ratio (stickout / D). */
  LD: number

  // — multipliers, surfaced for the Calculation Flow panel —
  coolantMul: number
  rigidityMul: number
  stickMul: number
  whMul: number
  tirMul: number

  /** SFM after all coolant / rigidity / stickout / workholding derates. */
  effSFM: number
  /** IPT after TIR derate (lower TIR → full feed; higher TIR → backed off). */
  effIPT: number

  /** Theoretical RPM from effSFM (pre-cap). */
  calcRPM: number
  /** RPM actually achievable on the selected spindle + holder. */
  rpmCapped: number
  /** SFM recomputed from the capped RPM — what the part really sees. */
  actualSFM: number
  /** calcRPM / rpmLimit — 1.0 means we're ceiling-pinned. */
  rpmCappedPct: number
  /** min(spindle.maxRpm, holder.maxRpm). */
  rpmLimit: number

  IPM: number
  MRR_inch3_min: number
  MRR_cm3_min: number

  Pc_kW: number
  /** Pc_kW / spindle.maxKw — >0.8 starts surfacing "부하 위험". */
  pwrPct: number

  /** Taylor-style tool life in minutes, with rigidity / TIR / WH dampers. */
  toolLife_min: number

  /** 0..1 composite score, driven by L/D + TIR + WH. */
  chatterRisk: number
  chatterLevel: "LOW" | "MED" | "HIGH"

  /** Human-readable warnings for the KPI banner + limit panels. */
  warnings: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────

export function findSpindle(key: string): SpindlePreset {
  return SPINDLE_PRESETS.find((s) => s.key === key) ?? SPINDLE_PRESETS[0]
}

export function findHolder(key: string): HolderPreset {
  return HOLDER_PRESETS.find((h) => h.key === key) ?? HOLDER_PRESETS[0]
}

export function findCoolant(key: string): CoolantOption {
  return COOLANTS.find((c) => c.key === key) ?? COOLANTS[0]
}

/**
 * Spindle category for the lab's radio-card tag. Derived from key, not
 * from maxRpm, so future preset renames stay intentional edits here.
 */
export function spindleCategory(s: SpindlePreset): "표준" | "고속" | "초고속" | "대형" {
  if (s.key === "cv50") return "대형"
  if (s.key === "vmc-high" || s.key === "hsm") return "고속"
  if (s.key === "graphite" || s.key === "micro") return "초고속"
  return "표준"
}

// ── Derate curves ────────────────────────────────────────────────────

/** L/D ≤ 3 → full SFM. Beyond that we step down aggressively:
 *  L/D 8 hits 0.40 — roughly what a 4" stickout on a 0.5" tool deserves. */
export function stickoutDerate(LD: number): number {
  if (LD <= 3) return 1.0
  if (LD <= 4) return 0.9
  if (LD <= 5) return 0.8
  if (LD <= 6) return 0.7
  if (LD <= 8) return 0.55
  return 0.4
}

/** TIR 0..5μm = full IPT. Side-lock at 25μm already 20% off the feed. */
export function tirDerate(tirMicron: number): number {
  if (tirMicron <= 5) return 1.0
  if (tirMicron <= 10) return 0.97
  if (tirMicron <= 15) return 0.92
  if (tirMicron <= 20) return 0.85
  return 0.8
}

export function rigidityMul(rigidity: number): number {
  // rigidity 0..100 → 0.8..1.0 linear. Milling-chuck (90) lands at 0.98.
  return 0.8 + 0.2 * (rigidity / 100)
}

export function whMul(workholdingPct: number): number {
  // 0..100 → 0.85..1.00. Loose vise (60) → 0.94.
  return 0.85 + 0.15 * (workholdingPct / 100)
}

// ── Main compute ─────────────────────────────────────────────────────

export function computeImpact(input: ComputeInput): ComputeResult {
  const spindle = findSpindle(input.spindleKey)
  const holder = findHolder(input.holderKey)
  const coolant = findCoolant(input.coolantKey)

  const LD = input.D_inch > 0 ? input.stickoutInch / input.D_inch : 0

  // Each multiplier is intentionally independent so the Calculation Flow
  // panel can render them as discrete rows (× step-by-step).
  const coolantM = coolant.vcMultiplier
  const rigidityM = rigidityMul(holder.rigidity)
  const stickM = stickoutDerate(LD)
  const whM = whMul(input.workholdingPct)
  const tirM = tirDerate(holder.tirMicron ?? DEFAULT_HOLDER_TIR_MICRON)

  const effSFM = input.sfmBase * coolantM * rigidityM * stickM * whM
  const effIPT = input.iptBase * tirM

  // 3.82 ≈ 12 / π — converts SFM (ft/min) to RPM for a diameter in inches.
  const calcRPM = input.D_inch > 0 ? (3.82 * effSFM) / input.D_inch : 0
  const holderMaxRpm = holder.maxRpm ?? DEFAULT_HOLDER_MAX_RPM
  const rpmLimit = Math.min(spindle.maxRpm, holderMaxRpm)
  const rpmCapped = Math.min(calcRPM, rpmLimit)
  const rpmCappedPct = rpmLimit > 0 ? calcRPM / rpmLimit : 0

  const actualSFM = (rpmCapped * input.D_inch) / 3.82

  const IPM = rpmCapped * effIPT * input.Z
  const MRR_inch3 = input.adocInch * input.rdocInch * IPM
  const MRR_cm3 = MRR_inch3 * 16.387

  // Cutting power. MRR in mm³/min × kc (N/mm²) → W → kW.
  const MRR_mm3 = MRR_inch3 * 16387
  const Pc_kW = (MRR_mm3 * input.kc) / (60 * 1e6 * POWER_EFFICIENCY)
  const pwrPct = spindle.maxKw > 0 ? Pc_kW / spindle.maxKw : 0

  // Taylor life, scaled by the same rigidity/TIR/WH dampers — a happy
  // holder + rigid setup keeps the tool alive longer than Taylor alone says.
  const Vc_actual_m_min = actualSFM * 0.3048
  const Vc_ref_m_min = input.sfmBase * 0.3048
  let toolLife =
    Vc_actual_m_min > 0
      ? TAYLOR_T_REF_MIN * Math.pow(Vc_ref_m_min / Vc_actual_m_min, 1 / TAYLOR_N)
      : TAYLOR_T_REF_MIN
  toolLife *= tirM * stickM * whM
  toolLife = clamp(toolLife, 5, 500)

  // Chatter = 50% L/D + 30% TIR + 20% workholding laxity.
  const chatterBase =
    (LD / 8) * 0.5 +
    ((holder.tirMicron ?? DEFAULT_HOLDER_TIR_MICRON) / 25) * 0.3 +
    ((100 - input.workholdingPct) / 100) * 0.2
  const chatterRisk = Math.min(1, Math.max(0, chatterBase))
  const chatterLevel: ComputeResult["chatterLevel"] =
    chatterRisk > 0.6 ? "HIGH" : chatterRisk > 0.35 ? "MED" : "LOW"

  const warnings: string[] = []
  if (rpmCappedPct > 0.95) {
    warnings.push(
      `스핀들 Max RPM 도달 (계산 ${Math.round(calcRPM).toLocaleString()} → 실제 ${Math.round(rpmCapped).toLocaleString()})`,
    )
  }
  if (pwrPct > 0.8) {
    warnings.push(`파워 ${Math.round(pwrPct * 100)}% 소모 — 부하 위험`)
  }
  if (chatterRisk > 0.6) {
    warnings.push("채터 위험 HIGH — 진동 · 파손 우려")
  }
  if (LD > 5) {
    warnings.push(`L/D ${LD.toFixed(1)} — 공구 처짐 우려`)
  }
  const minStick = holder.minStickoutInch ?? DEFAULT_HOLDER_MIN_STICKOUT
  if (input.stickoutInch < minStick) {
    warnings.push(
      `Stickout ${input.stickoutInch.toFixed(2)}" — ${holder.label} 최소값 ${minStick.toFixed(2)}" 미만`,
    )
  }

  return {
    spindle,
    holder,
    coolant,
    LD,
    coolantMul: coolantM,
    rigidityMul: rigidityM,
    stickMul: stickM,
    whMul: whM,
    tirMul: tirM,
    effSFM,
    effIPT,
    calcRPM,
    rpmCapped,
    actualSFM,
    rpmCappedPct,
    rpmLimit,
    IPM,
    MRR_inch3_min: MRR_inch3,
    MRR_cm3_min: MRR_cm3,
    Pc_kW,
    pwrPct,
    toolLife_min: toolLife,
    chatterRisk,
    chatterLevel,
    warnings,
  }
}

/** Total cycle time for a 100-part run, including tool changes. */
export function compute100PartsTime(
  MRR_inch3: number,
  toolLife: number,
  partVolumeInch3 = 50,
): { totalMin: number; toolsNeeded: number } {
  if (MRR_inch3 <= 0 || toolLife <= 0) {
    return { totalMin: Infinity, toolsNeeded: 1 }
  }
  const totalMachineTime = (partVolumeInch3 * 100) / MRR_inch3
  const toolsNeeded = Math.max(1, Math.ceil(totalMachineTime / toolLife))
  const swapTime = (toolsNeeded - 1) * 5 // 5 min per swap, conservative
  return { totalMin: totalMachineTime + swapTime, toolsNeeded }
}

// ── Preset scenarios for the compare table ──────────────────────────

export interface ImpactPreset {
  label: string
  config: {
    spindleKey: string
    holderKey: string
    coolantKey: string
    stickoutInch: number
    workholdingPct: number
  }
  badge: "gold" | "gray" | "blue" | "purple" | "teal" | "red"
}

export const IMPACT_PRESETS: Record<string, ImpactPreset> = {
  baseline: {
    label: "⚡ BASELINE (PDF 권장)",
    config: { spindleKey: "vmc-std", holderKey: "shrink-fit", coolantKey: "flood", stickoutInch: 1.5, workholdingPct: 100 },
    badge: "gold",
  },
  budget: {
    label: "💰 저가 공장",
    config: { spindleKey: "nmtb", holderKey: "side-lock", coolantKey: "dry", stickoutInch: 2.5, workholdingPct: 70 },
    badge: "gray",
  },
  standard: {
    label: "🏭 일반 공장",
    config: { spindleKey: "vmc-std", holderKey: "er-collet", coolantKey: "flood", stickoutInch: 1.5, workholdingPct: 90 },
    badge: "blue",
  },
  premium: {
    label: "💎 프리미엄",
    config: { spindleKey: "vmc-high", holderKey: "shrink-fit", coolantKey: "throughspindle", stickoutInch: 1.2, workholdingPct: 100 },
    badge: "purple",
  },
  highspeed: {
    label: "🚀 고속 공장",
    config: { spindleKey: "hsm", holderKey: "shrink-fit", coolantKey: "throughspindle", stickoutInch: 1.0, workholdingPct: 95 },
    badge: "teal",
  },
  disaster: {
    label: "🔥 최악 조합",
    config: { spindleKey: "nmtb", holderKey: "side-lock", coolantKey: "dry", stickoutInch: 3.5, workholdingPct: 60 },
    badge: "red",
  },
}

// ── Number formatters for the UI ─────────────────────────────────────

export const fmt = {
  int: (n: number): string =>
    Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—",
  dec: (n: number, dp = 2): string =>
    Number.isFinite(n)
      ? n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
      : "—",
  pct: (n: number, dp = 1): string =>
    Number.isFinite(n) ? `${(n * 100).toFixed(dp)}%` : "—",
  sign: (n: number, dp = 1): string =>
    !Number.isFinite(n) ? "—" : n >= 0 ? `+${n.toFixed(dp)}` : n.toFixed(dp),
}

// ── Internal ─────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
