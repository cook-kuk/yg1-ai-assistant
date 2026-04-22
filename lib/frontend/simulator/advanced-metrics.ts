/**
 * YG-1 Simulator v3 — Advanced Engineering Metrics
 *
 * Pure functions for heat partition, runout, helix force decomposition,
 * Monte Carlo tool life, BUE risk, and chip morphology.
 *
 * No classes, no side effects — pure export-only helpers.
 */

// ---------- shared helpers ----------

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

const r2 = (v: number): number => parseFloat(v.toFixed(2));

// Box-Muller normal sample (mean=0, std=1)
const normalSample = (): number => {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
};

// ISO group → density (g/cm³ ≡ kg/dm³; we treat as kg/L below)
const DENSITY_KG_PER_CM3: Record<string, number> = {
  P: 7.85e-3,
  M: 8.0e-3,
  K: 7.2e-3,
  N: 2.7e-3,
  S: 8.3e-3,
  H: 7.8e-3,
};

// Specific heat J/(kg·K)
const SPECIFIC_HEAT: Record<string, number> = {
  P: 490,
  M: 500,
  K: 460,
  N: 900,
  S: 440,
  H: 480,
};

// Tool-chip interface temperature multiplier (1.2~1.6). S 계열 높음
const TOOL_TEMP_MULT: Record<string, number> = {
  P: 1.3,
  M: 1.4,
  K: 1.25,
  N: 1.2,
  S: 1.6,
  H: 1.5,
};

const getIsoKey = (g: string): string => {
  const k = (g || "").trim().toUpperCase().charAt(0);
  return ["P", "M", "K", "N", "S", "H"].includes(k) ? k : "P";
};

// ==========================================================
// 1. Heat Partition (Blok model simplified)
// ==========================================================

export interface HeatEstimation {
  totalPowerW: number;
  chipTempC: number;
  toolTempC: number;
  workpieceTempC: number;
  chipHeatPct: number;
}

export function estimateHeat(params: {
  Pc: number; // kW
  Vc: number; // m/min
  fz: number; // mm/t
  ap: number; // mm
  ae: number; // mm
  D: number; // mm
  materialGroup: string;
  thermalConductivityWmk?: number;
  thermalMultiplier?: number;
  ambientC?: number;
}): HeatEstimation {
  const { Pc, Vc, fz, ap, ae, D } = params;
  const ambient = params.ambientC ?? 20;
  const iso = getIsoKey(params.materialGroup);

  const totalPowerW = Pc * 1000;

  // Blok partition
  const vcSafe = Math.max(1, Vc);
  const chipHeatPct = clamp(0.5 + 0.3 * Math.log10(vcSafe / 100), 0.5, 0.95) * 100;

  // MRR (cm³/min): ap · ae · feed; feed(mm/min) ~ Vc/(πD) * Z * fz.
  // Z unknown here → approximate feed ∝ Vc·fz / D with a geometric factor.
  // Use MRR ≈ ap * ae * (Vc * 1000 / (Math.PI * D)) * fz   [mm³/min]
  const feedMmPerMin = (vcSafe * 1000 / (Math.PI * Math.max(0.01, D))) * Math.max(0.001, fz);
  const mrrMm3PerMin = Math.max(1, ap * ae * feedMmPerMin); // mm³/min
  const mrrCm3PerMin = mrrMm3PerMin / 1000; // cm³/min

  const density = DENSITY_KG_PER_CM3[iso]; // kg/cm³
  const cHeat = SPECIFIC_HEAT[iso]; // J/(kg·K)

  // chip mass rate kg/min → kg/s
  const chipMassRateKgPerSec = (mrrCm3PerMin * density) / 60;
  const chipHeatW = totalPowerW * (chipHeatPct / 100);

  // ΔT_chip = Q_dot / (m_dot · c) — guard against zero mass flow
  const denomChip = Math.max(1e-6, chipMassRateKgPerSec * cHeat);
  const chipDeltaT = chipHeatW / denomChip;
  const chipTempC = ambient + chipDeltaT;

  const conductivity = Math.max(1, params.thermalConductivityWmk ?? 0);
  const conductivityFactor = conductivity > 0 ? clamp(Math.sqrt((iso === "N" ? 150 : iso === "M" ? 16 : iso === "S" ? 10 : 50) / conductivity), 0.75, 1.9) : 1;
  const materialThermalFactor = params.thermalMultiplier ?? conductivityFactor;
  const toolMult = (TOOL_TEMP_MULT[iso] ?? 1.3) * materialThermalFactor;
  const toolTempC = chipTempC * toolMult;

  // workpiece: 1 kg lump assumption, 0.3 coupling factor
  const workpieceHeatW = totalPowerW * (1 - chipHeatPct / 100);
  const workpieceDeltaT = ((workpieceHeatW * 0.3) / (1 * cHeat)) * materialThermalFactor;
  const workpieceTempC = ambient + workpieceDeltaT;

  return {
    totalPowerW: r2(totalPowerW),
    chipTempC: r2(chipTempC),
    toolTempC: r2(toolTempC),
    workpieceTempC: r2(workpieceTempC),
    chipHeatPct: r2(chipHeatPct),
  };
}

// ==========================================================
// 2. Runout Effect
// ==========================================================

export interface RunoutEffect {
  tirUm: number;
  peakChipLoadMultiplier: number;
  estimatedWearAccel: number;
  flutesEffective: number;
}

export function estimateRunoutEffect(params: {
  tirUm: number;
  fz: number;
  Z: number;
  D: number;
}): RunoutEffect {
  const { tirUm, fz, Z } = params;
  const tirMm = tirUm / 1000;

  const fzSafe = Math.max(1e-4, fz);
  const fzPeak = fzSafe + tirMm;
  const rawMult = fzPeak / fzSafe;
  const peakMult = clamp(rawMult, 1.0, 3.0);

  const zSafe = Math.max(1, Math.floor(Z));
  const flutesRaw = zSafe * (fzSafe / fzPeak);
  const flutesEffective = clamp(flutesRaw, 1, zSafe);

  const wearRaw =
    1 + 0.4 * (peakMult - 1) * Math.pow(Math.max(0, tirUm) / 10, 0.5);
  const wearAccel = clamp(wearRaw, 1.0, 2.5);

  return {
    tirUm: r2(tirUm),
    peakChipLoadMultiplier: r2(peakMult),
    estimatedWearAccel: r2(wearAccel),
    flutesEffective: r2(flutesEffective),
  };
}

// ==========================================================
// 3. Helix Force Decomposition
// ==========================================================

export interface HelixDecomposition {
  helixAngle: number;
  axialForceN: number;
  radialForceN: number;
  tangentialForceN: number;
  liftRatio: number;
}

export function decomposeHelixForce(params: {
  Fc: number;
  helixAngle: number;
  ap: number;
  D: number;
}): HelixDecomposition {
  const { Fc, helixAngle } = params;
  const theta = (helixAngle * Math.PI) / 180;

  const tangential = Fc;
  const axial = Fc * Math.tan(theta) * 0.4;
  const radial = Fc * 0.3;
  const liftRatio = Fc === 0 ? 0 : axial / Fc;

  return {
    helixAngle: r2(helixAngle),
    axialForceN: r2(axial),
    radialForceN: r2(radial),
    tangentialForceN: r2(tangential),
    liftRatio: r2(liftRatio),
  };
}

// ==========================================================
// 4. Monte Carlo Tool Life / MRR
// ==========================================================

export interface MonteCarloResult {
  toolLifeP10: number;
  toolLifeP50: number;
  toolLifeP90: number;
  mrrP10: number;
  mrrP50: number;
  mrrP90: number;
  samples: number;
}

export function monteCarloToolLife(params: {
  Vc: number;
  VcRef: number;
  MRR: number;
  taylorN?: number;
  sigmaVc?: number;
  sigmaFz?: number;
  samples?: number;
}): MonteCarloResult {
  const { Vc, VcRef, MRR } = params;
  const taylorN = params.taylorN ?? 0.25;
  const sigmaVcPct = (params.sigmaVc ?? 5) / 100;
  const sigmaFzPct = (params.sigmaFz ?? 10) / 100;
  const samples = Math.max(10, Math.floor(params.samples ?? 500));

  const vcRefSafe = Math.max(1e-6, VcRef);
  const lives: number[] = [];
  const mrrs: number[] = [];

  // Baseline reference life (T_ref) = 1 h (60 min) normalised,
  // so returned life is in the same arbitrary unit regardless of scale.
  const T_REF = 60;

  for (let i = 0; i < samples; i++) {
    const vcSample = Math.max(1e-3, Vc * (1 + normalSample() * sigmaVcPct));
    const fzMult = 1 + normalSample() * sigmaFzPct;
    // Taylor:  Vc * T^n = C  →  T = T_ref * (Vc_ref / Vc)^(1/n)
    const ratio = vcRefSafe / vcSample;
    const life = T_REF * Math.pow(Math.max(1e-6, ratio), 1 / Math.max(1e-3, taylorN));
    lives.push(life);
    mrrs.push(Math.max(0, MRR * fzMult * (vcSample / Math.max(1e-6, Vc))));
  }

  lives.sort((a, b) => a - b);
  mrrs.sort((a, b) => a - b);

  return {
    toolLifeP10: r2(percentile(lives, 10)),
    toolLifeP50: r2(percentile(lives, 50)),
    toolLifeP90: r2(percentile(lives, 90)),
    mrrP10: r2(percentile(mrrs, 10)),
    mrrP50: r2(percentile(mrrs, 50)),
    mrrP90: r2(percentile(mrrs, 90)),
    samples,
  };
}

// ==========================================================
// 5. BUE Risk
// ==========================================================

export interface BueRisk {
  interfaceTempC: number;
  criticalLow: number;
  criticalHigh: number;
  risk: "none" | "low" | "mid" | "high";
  inWindow: boolean;
  message: string;
}

const BUE_WINDOW: Record<string, [number, number]> = {
  P: [300, 500],
  M: [400, 650],
  K: [300, 450],
  N: [150, 250],
  S: [450, 700],
  H: [200, 400],
};

export function estimateBueRisk(params: {
  materialGroup: string;
  interfaceTempC: number;
  Vc: number;
}): BueRisk {
  const iso = getIsoKey(params.materialGroup);
  const [lo, hi] = BUE_WINDOW[iso];
  const T = params.interfaceTempC;

  const inWindow = T >= lo && T <= hi;
  let risk: BueRisk["risk"];
  let message: string;

  if (inWindow) {
    risk = "high";
    // Empirical suggestion: raise Vc to push temperature upward out of window.
    const bump = Math.max(20, Math.round(params.Vc * 0.25));
    message = `Vc ~${params.Vc + bump} m/min 상향하면 BUE 윈도우 통과`;
  } else {
    const distLo = Math.abs(T - lo);
    const distHi = Math.abs(T - hi);
    const nearest = Math.min(distLo, distHi);
    if (nearest <= 100) {
      risk = "mid";
      message = T < lo
        ? `BUE 윈도우 하단 ${lo}°C 근접 (Δ${r2(distLo)}°C)`
        : `BUE 윈도우 상단 ${hi}°C 근접 (Δ${r2(distHi)}°C)`;
    } else if (nearest <= 200) {
      risk = "low";
      message = "BUE 윈도우 여유 구간";
    } else {
      risk = "none";
      message = "안전 구간";
    }
  }

  return {
    interfaceTempC: r2(T),
    criticalLow: lo,
    criticalHigh: hi,
    risk,
    inWindow,
    message,
  };
}

// ==========================================================
// 6. Chip Morphology
// ==========================================================

export interface ChipMorphology {
  type: "continuous" | "segmented" | "discontinuous" | "bue";
  reason: string;
  toolWearRisk: "low" | "mid" | "high";
  icon: string;
}

export function classifyChipMorphology(params: {
  materialGroup: string;
  Vc: number;
  fz: number;
  hardness?: number;
  bueRisk?: "none" | "low" | "mid" | "high";
}): ChipMorphology {
  const iso = getIsoKey(params.materialGroup);
  const { Vc, fz, bueRisk } = params;

  if (bueRisk === "high") {
    return {
      type: "bue",
      reason: "BUE 윈도우 내부 — 인터페이스 온도가 재질 BUE 범위와 겹침",
      toolWearRisk: "high",
      icon: "🔺",
    };
  }

  const isBrittle = iso === "K" || iso === "H";
  if (isBrittle && fz > 0.05) {
    return {
      type: "discontinuous",
      reason: `취성 재질(${iso}) + fz ${fz} mm/t > 0.05 → 분리형 칩`,
      toolWearRisk: "high",
      icon: "💥",
    };
  }

  if (iso === "S" && Vc > 80) {
    return {
      type: "segmented",
      reason: `내열합금(S) + 고속 Vc ${Vc} m/min → saw-tooth segmented`,
      toolWearRisk: "mid",
      icon: "⚡",
    };
  }

  return {
    type: "continuous",
    reason: "안정 영역 — 연속형 칩 예상",
    toolWearRisk: "low",
    icon: "🌀",
  };
}
