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
 *
 * v2 physics refinements (2026-04-22):
 *   * `rigidityMul` saturates at r=80 — above that the holder is "rigid
 *     enough" and isn't the bottleneck, so shrink-fit / milling-chuck
 *     land at 1.0 instead of the linear 0.97/1.00. Matches BASELINE's
 *     "ideal combination" interpretation.
 *   * Tool life gets an extra chatter kill factor (1 - 0.5·chatterRisk):
 *     HIGH chatter halves the Taylor prediction, since vibration-driven
 *     spalling is the real failure mode that Taylor doesn't model.
 *   * Dry coolant on demanding ISO groups (P/M/S/H) adds an explicit
 *     warning + additional tool-life derate — aluminum (N) is exempt,
 *     matching the BASELINE 942332 uncoated-on-aluminum happy case.
 *   * Efficiency score `vs baseline` lets the compare table render
 *     "X% of BASELINE MRR" without the UI recomputing.
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

// Rigidity saturation threshold — holders rigid enough that the
// remaining variance comes from the tool + workholding, not the clamp.
// Below this point the rigidity linearly derates; above it reads 1.0.
const RIGIDITY_SATURATION = 80

// Chatter is the real tool killer in the field — Taylor ignores it. We
// apply a multiplicative derate of (1 − CHATTER_LIFE_KILL · chatterRisk)
// to the Taylor prediction. 0.5 means HIGH chatter (risk 0.8) strips
// 40% of life, consistent with the "채터 30분 가공 → 공구 폐기" rule of thumb.
const CHATTER_LIFE_KILL = 0.5

// Dry-cutting penalty on material groups that actually care. N (non-
// ferrous) is exempt — aluminum is the one group that runs better dry
// on uncoated carbide (BUE avoidance).
const DRY_LIFE_DERATE = 0.55
const DRY_DEMANDING_ISO = new Set(["P", "M", "K", "S", "H"])

// Workholding < 70 is too loose to hide — flagged as a distinct warning
// even when chatter thresholds haven't fired yet.
const WORKHOLDING_WARNING_PCT = 70

// Tool-life warnings. <20 min means the operator will swap tools more
// often than they set up the part; anything under 10 is practically
// unusable and escalates the warning severity.
const TOOL_LIFE_WARN_MIN = 20
const TOOL_LIFE_CRITICAL_MIN = 10

// Efficiency score — MRR_actual / MRR_baseline. Below this ratio we
// surface "BASELINE 대비 N%" as a productivity warning.
const EFFICIENCY_WARN_RATIO = 0.4

// ── Input / output types ─────────────────────────────────────────────

export type IsoGroup = "P" | "M" | "K" | "N" | "S" | "H" | "O"

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
  /** ISO group of the locked material. Drives coolant-compatibility warnings. */
  isoGroup?: IsoGroup

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

export interface Warning {
  level: "info" | "warn" | "critical"
  code: string
  message: string
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
  /** Aggregate life-side multiplier (TIR × stick × WH × chatter × dry). */
  lifeMul: number

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

  /** Taylor-style tool life in minutes, with rigidity / TIR / WH / chatter / dry dampers. */
  toolLife_min: number

  /** 0..1 composite score, driven by L/D + TIR + WH. */
  chatterRisk: number
  chatterLevel: "LOW" | "MED" | "HIGH"

  /** 100-part cycle time incl. tool swaps (5 min each) — Infinity when MRR ≤ 0. */
  cycleTime100_min: number
  /** Tools consumed in that 100-part run. */
  toolsNeeded100: number

  /** Ratio vs BASELINE (same tool/material/op, ideal machine knobs). */
  efficiency: {
    mrrRatio: number
    lifeRatio: number
    cycleRatio: number
  }

  /** Human-readable warnings for the KPI banner + limit panels. */
  warnings: Warning[]
  /** Back-compat plain string array for any consumer that doesn't care about severity. */
  warningMessages: string[]
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

/**
 * Rigidity → SFM multiplier.
 *
 *   r ≥ 80  → 1.00 (holder no longer the bottleneck)
 *   r < 80  → 0.80..1.00 linear
 *
 * The saturation matters for BASELINE ("이상적 조합") — shrink-fit (85)
 * and milling-chuck (90) both deserve 1.0, otherwise we double-count a
 * penalty that's already captured in TIR.
 */
export function rigidityMul(rigidity: number): number {
  if (rigidity >= RIGIDITY_SATURATION) return 1.0
  // Map 0..SATURATION → 0.8..1.0 linearly.
  return 0.8 + 0.2 * (rigidity / RIGIDITY_SATURATION)
}

export function whMul(workholdingPct: number): number {
  // 0..100 → 0.85..1.00. Loose vise (60) → 0.94.
  return 0.85 + 0.15 * (workholdingPct / 100)
}

function coolantCompatibilityDerate(coolantKey: string, iso: IsoGroup | undefined): number {
  if (coolantKey !== "dry") return 1.0
  if (!iso || !DRY_DEMANDING_ISO.has(iso)) return 1.0
  return DRY_LIFE_DERATE
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

  // Chatter composite. Precompute because the life model needs it.
  const chatterBase =
    (LD / 8) * 0.5 +
    ((holder.tirMicron ?? DEFAULT_HOLDER_TIR_MICRON) / 25) * 0.3 +
    ((100 - input.workholdingPct) / 100) * 0.2
  const chatterRisk = Math.min(1, Math.max(0, chatterBase))
  const chatterLevel: ComputeResult["chatterLevel"] =
    chatterRisk > 0.6 ? "HIGH" : chatterRisk > 0.35 ? "MED" : "LOW"

  // Taylor life, stacked with the physically-motivated dampers.
  const Vc_actual_m_min = actualSFM * 0.3048
  const Vc_ref_m_min = input.sfmBase * 0.3048
  let toolLife =
    Vc_actual_m_min > 0
      ? TAYLOR_T_REF_MIN * Math.pow(Vc_ref_m_min / Vc_actual_m_min, 1 / TAYLOR_N)
      : TAYLOR_T_REF_MIN
  // Mechanical dampers — uneven loading, deflection, fixture laxity.
  const mechMul = tirM * stickM * whM
  // Chatter kills tools faster than Taylor says (vibration spalling).
  const chatterMul = 1 - CHATTER_LIFE_KILL * chatterRisk
  // Dry on demanding ISO groups — heat accumulation → edge wear.
  const coolantLifeMul = coolantCompatibilityDerate(input.coolantKey, input.isoGroup)
  toolLife *= mechMul * chatterMul * coolantLifeMul
  toolLife = clamp(toolLife, 2, 500)

  const lifeMul = mechMul * chatterMul * coolantLifeMul

  // Cycle-time for 100 parts (50 in³ each, 5 min per tool swap).
  const { totalMin: cycleTime100, toolsNeeded: toolsNeeded100 } = compute100PartsTime(
    MRR_inch3,
    toolLife,
  )

  // Efficiency vs BASELINE (same tool/material/op, ideal machine knobs).
  // Recursion-guarded — the engine skips the vs-baseline calc when input
  // already IS the baseline config (saves a full re-run per call).
  const isBaselineConfig =
    input.spindleKey === "vmc-std" &&
    input.holderKey === "shrink-fit" &&
    input.coolantKey === "flood" &&
    input.stickoutInch === 1.5 &&
    input.workholdingPct === 100
  let efficiency = { mrrRatio: 1, lifeRatio: 1, cycleRatio: 1 }
  if (!isBaselineConfig) {
    const baseline = computeImpact({
      ...input,
      spindleKey: "vmc-std",
      holderKey: "shrink-fit",
      coolantKey: "flood",
      stickoutInch: 1.5,
      workholdingPct: 100,
    })
    efficiency = {
      mrrRatio: baseline.MRR_inch3_min > 0 ? MRR_inch3 / baseline.MRR_inch3_min : 0,
      lifeRatio: baseline.toolLife_min > 0 ? toolLife / baseline.toolLife_min : 0,
      cycleRatio:
        baseline.cycleTime100_min > 0 && Number.isFinite(baseline.cycleTime100_min)
          ? cycleTime100 / baseline.cycleTime100_min
          : 0,
    }
  }

  // ── Warning collection ────────────────────────────────────────────
  const warnings: Warning[] = []
  const push = (level: Warning["level"], code: string, message: string) =>
    warnings.push({ level, code, message })

  if (rpmCappedPct > 0.95) {
    push(
      "warn",
      "rpm-cap",
      `스핀들 Max RPM 도달 (계산 ${Math.round(calcRPM).toLocaleString()} → 실제 ${Math.round(rpmCapped).toLocaleString()})`,
    )
  }
  if (pwrPct > 0.8) {
    push("warn", "power", `파워 ${Math.round(pwrPct * 100)}% 소모 — 부하 위험`)
  }
  if (chatterRisk > 0.6) {
    push("critical", "chatter", "채터 위험 HIGH — 진동 · 파손 우려")
  } else if (chatterRisk > 0.35) {
    push("info", "chatter-med", `채터 위험 MED (${Math.round(chatterRisk * 100)}%)`)
  }
  if (LD > 5) {
    push("warn", "ld", `L/D ${LD.toFixed(1)} — 공구 처짐 우려`)
  }
  const minStick = holder.minStickoutInch ?? DEFAULT_HOLDER_MIN_STICKOUT
  if (input.stickoutInch < minStick) {
    push(
      "warn",
      "min-stickout",
      `Stickout ${input.stickoutInch.toFixed(2)}" — ${holder.label} 최소값 ${minStick.toFixed(2)}" 미만`,
    )
  }
  if (
    input.coolantKey === "dry" &&
    input.isoGroup !== undefined &&
    DRY_DEMANDING_ISO.has(input.isoGroup)
  ) {
    push(
      "warn",
      "dry-coolant",
      `Dry 가공 — ${input.isoGroup}군은 무냉각 시 공구 수명 ${Math.round((1 - DRY_LIFE_DERATE) * 100)}% 단축`,
    )
  }
  if (input.workholdingPct < WORKHOLDING_WARNING_PCT) {
    push(
      "warn",
      "workholding-loose",
      `Workholding ${Math.round(input.workholdingPct)}% — 강성 부족, 진동 전파 위험`,
    )
  }
  if (toolLife < TOOL_LIFE_CRITICAL_MIN) {
    push(
      "critical",
      "life-critical",
      `Tool life ${toolLife.toFixed(0)} min — 교체 빈도 극심 (BASELINE 대비 ${Math.round(efficiency.lifeRatio * 100)}%)`,
    )
  } else if (toolLife < TOOL_LIFE_WARN_MIN) {
    push(
      "info",
      "life-short",
      `Tool life ${toolLife.toFixed(0)} min — 짧음 (BASELINE 대비 ${Math.round(efficiency.lifeRatio * 100)}%)`,
    )
  }
  if (!isBaselineConfig && efficiency.mrrRatio < EFFICIENCY_WARN_RATIO) {
    push(
      "warn",
      "low-mrr",
      `MRR ${Math.round(efficiency.mrrRatio * 100)}% (BASELINE 대비) — 생산성 저하`,
    )
  }
  const holderMaxRpmLimit = holder.maxRpm ?? DEFAULT_HOLDER_MAX_RPM
  if (calcRPM > holderMaxRpmLimit && holderMaxRpmLimit < spindle.maxRpm) {
    push(
      "warn",
      "holder-rpm-cap",
      `${holder.label} Max ${holderMaxRpmLimit.toLocaleString()} RPM — 스핀들보다 먼저 한계 도달`,
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
    lifeMul,
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
    cycleTime100_min: cycleTime100,
    toolsNeeded100,
    efficiency,
    warnings,
    warningMessages: warnings.map((w) => w.message),
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

// ── Default locked-context — used when the lab is opened standalone ──

export const DEFAULT_LOCKED_TOOL = {
  code: "942332",
  seriesLabel: "Harvey Variable Helix Aluminum — Square",
  diameter: 12.7,
  diameterInch: 0.5,
  flutes: 3,
  coating: "Uncoated",
  sourceUrl: "https://harveyperformance.widen.net/content/gpcwfoqsfl/pdf/SF_942300.pdf",
} as const

export const DEFAULT_LOCKED_MATERIAL = {
  label: "Wrought Aluminum 6061-T6 (ISO N)",
  sfmBase: 1500,
  iptBase: 0.00866,
  fzBaseMetric: 0.22,
  kc: 800,
  isoGroup: "N" as IsoGroup,
}

export const DEFAULT_LOCKED_OPERATION = {
  type: "finishing" as const,
  adocRatio: 0.1,
  rdocRatio: 0.5,
  adocInch: 0.05,
  rdocInch: 0.25,
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
  duration: (minutes: number): string => {
    if (!Number.isFinite(minutes)) return "—"
    if (minutes < 60) return `${minutes.toFixed(0)} min`
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes - h * 60)
    return `${h}h ${m}m`
  },
}

// ── Internal ─────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
