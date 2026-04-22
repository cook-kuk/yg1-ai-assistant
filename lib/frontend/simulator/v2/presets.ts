export interface SpindlePreset {
  key: string
  label: string
  maxRpm: number
  maxKw: number
  maxIpm: number
}

export const SPINDLE_PRESETS: SpindlePreset[] = [
  { key: "vmc-std", label: "VMC 표준 (BT40, 12k)", maxRpm: 12000, maxKw: 15, maxIpm: 394 },
  { key: "vmc-high", label: "VMC 고속 (BT30, 20k)", maxRpm: 20000, maxKw: 11, maxIpm: 787 },
  { key: "cv40", label: "CV40 (미국 CAT40 호환)", maxRpm: 10000, maxKw: 15, maxIpm: 4000 },
  { key: "cv30", label: "CV30 (소형, BT30급)", maxRpm: 12000, maxKw: 11, maxIpm: 4000 },
  { key: "cv50", label: "CV50 (대형)", maxRpm: 6000, maxKw: 22, maxIpm: 2000 },
  { key: "hsm", label: "HSM (HSK63, 30k+)", maxRpm: 30000, maxKw: 22, maxIpm: 1181 },
  { key: "graphite", label: "흑연 전용 (40k)", maxRpm: 40000, maxKw: 18, maxIpm: 1575 },
  { key: "micro", label: "미세가공 (60k+)", maxRpm: 60000, maxKw: 5.5, maxIpm: 1575 },
  { key: "nmtb", label: "NMTB (구형 미국식)", maxRpm: 6000, maxKw: 11, maxIpm: 300 },
  { key: "custom", label: "사용자 지정", maxRpm: 12000, maxKw: 15, maxIpm: 500 },
]

export interface HolderPreset {
  key: string
  label: string
  rigidity: number // 0..100 — higher = stiffer
  // ── Machine Impact Lab additions (all optional — existing callers unaffected)
  /** Total Indicator Runout at the tool tip, in micrometers. Drives
   * effective-feed derate: a shaky holder + a floppy tool makes some
   * flutes bite deeper than others, cutting toolLife fast. */
  tirMicron?: number
  /** Max RPM the holder is rated for. Some Weldon / endmill-holder
   * geometries can't spin as fast as the spindle permits. */
  maxRpm?: number
  /** Minimum advertised stickout before the tool loses enough of the
   * clamp that rigidity drops off. Surfaced as a warning in the lab. */
  minStickoutInch?: number
}

export const HOLDER_PRESETS: HolderPreset[] = [
  { key: "er-collet", label: "ER 콜릿", rigidity: 55, tirMicron: 15, maxRpm: 20000, minStickoutInch: 1.4 },
  { key: "end-mill-holder", label: "엔드밀 홀더 (측면나사)", rigidity: 65, tirMicron: 20, maxRpm: 12000, minStickoutInch: 1.5 },
  { key: "shrink-fit", label: "Shrink Fit (열박음)", rigidity: 85, tirMicron: 3, maxRpm: 40000, minStickoutInch: 0.8 },
  { key: "hydraulic", label: "Hydraulic 척", rigidity: 80, tirMicron: 5, maxRpm: 28000, minStickoutInch: 1.0 },
  { key: "milling-chuck", label: "밀링 척 (Power/Heavy)", rigidity: 90, tirMicron: 8, maxRpm: 15000, minStickoutInch: 1.2 },
  { key: "side-lock", label: "Side Lock (Weldon)", rigidity: 70, tirMicron: 25, maxRpm: 10000, minStickoutInch: 1.5 },
]

export const TOOL_MATERIALS = [
  { key: "carbide", label: "Solid Carbide", E_GPa: 600 },
  { key: "carbide-tin", label: "Carbide + TiN", E_GPa: 600 },
  { key: "carbide-altin", label: "Carbide + AlTiN", E_GPa: 600 },
  { key: "carbide-amorphous", label: "Carbide + DLC", E_GPa: 600 },
  { key: "cermet", label: "Cermet", E_GPa: 450 },
  { key: "hss", label: "HSS (M42)", E_GPa: 210 },
  { key: "pcd", label: "PCD (다이아몬드)", E_GPa: 1050 },
  { key: "cbn", label: "CBN", E_GPa: 680 },
]

export interface ToolPathPreset {
  key: string
  label: string
  hint: string
}

export const TOOL_PATHS: ToolPathPreset[] = [
  { key: "conventional", label: "Conventional (일반)", hint: "표준 측면/슬롯" },
  { key: "hem", label: "HEM (High Efficiency)", hint: "낮은 ae, 깊은 ap, 고속이송" },
  { key: "trochoidal", label: "Trochoidal (트로코이달)", hint: "슬롯/포켓, chip thinning 큼" },
  { key: "adaptive", label: "Adaptive Clearing", hint: "일정한 공구부하 유지" },
  { key: "dynamic", label: "Dynamic Milling", hint: "MasterCam식 적응가공" },
  { key: "plunge", label: "Plunge (플런징)", hint: "축방향 드릴식 가공" },
  { key: "ramping", label: "Ramping (경사진입)", hint: "3~5° 각도로 진입" },
  { key: "helical", label: "Helical Interpolation", hint: "나선보간 홀가공" },
]

// ── MAP 2.0 Strategy (Tool Path 내부 세부 전략) ──
export const STRATEGY_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  conventional: [
    { value: "climb", label: "Climb milling (권장)" },
    { value: "conv", label: "Conventional milling" },
  ],
  hem: [
    { value: "full-loc", label: "Full LOC 활용 (표준 HEM)" },
    { value: "half-loc", label: "Half LOC (보수적)" },
    { value: "peeling", label: "Peeling (나선 하강)" },
  ],
  trochoidal: [
    { value: "circular", label: "원형 궤적 (표준)" },
    { value: "spiral", label: "나선 진입" },
  ],
  adaptive: [
    { value: "inside-out", label: "Inside-Out (중앙에서 외곽)" },
    { value: "outside-in", label: "Outside-In (외곽에서 중앙)" },
    { value: "combined", label: "Combined" },
  ],
  dynamic: [
    { value: "mastercam", label: "MasterCam Dynamic" },
    { value: "fusion", label: "Fusion 360 Adaptive" },
  ],
  plunge: [
    { value: "straight", label: "Straight plunge" },
    { value: "helical", label: "Helical plunge" },
  ],
  ramping: [
    { value: "linear", label: "Linear ramp (3~5°)" },
    { value: "zigzag", label: "Zig-zag ramp" },
  ],
  helical: [
    { value: "plunge", label: "Plunge helical" },
    { value: "bore", label: "Bore helical" },
  ],
}

// Material subgroups (Harvey MAP style)
export interface MaterialSubgroup {
  key: string
  label: string
  iso: string
  conditions: string[]
  defaultHardness: { scale: "HRC" | "HBW" | "HRB" | "HBS"; value: number }
}

export const MATERIAL_SUBGROUPS: MaterialSubgroup[] = [
  // P - Steel
  { key: "low-carbon", label: "Low Carbon Steel (<0.3%C)", iso: "P", conditions: ["Annealed", "Normalized", "As-Rolled"], defaultHardness: { scale: "HBW", value: 150 } },
  { key: "medium-carbon", label: "Medium Carbon Steel (0.3~0.6%C)", iso: "P", conditions: ["Annealed", "Normalized", "Q&T"], defaultHardness: { scale: "HBW", value: 200 } },
  { key: "high-carbon", label: "High Carbon Steel (>0.6%C)", iso: "P", conditions: ["Annealed", "Hardened"], defaultHardness: { scale: "HRC", value: 30 } },
  { key: "alloy-steel", label: "Alloy Steel (4140/4340 등)", iso: "P", conditions: ["Annealed", "Q&T", "Hardened"], defaultHardness: { scale: "HRC", value: 35 } },
  { key: "tool-steel-p", label: "Tool Steel (P계)", iso: "P", conditions: ["Annealed", "Hardened"], defaultHardness: { scale: "HRC", value: 45 } },
  // M - Stainless
  { key: "austenitic-ss", label: "오스테나이트 SS (304, 316)", iso: "M", conditions: ["Annealed", "CW"], defaultHardness: { scale: "HBW", value: 180 } },
  { key: "ferritic-ss", label: "페라이트 SS (430)", iso: "M", conditions: ["Annealed"], defaultHardness: { scale: "HBW", value: 160 } },
  { key: "martensitic-ss", label: "마르텐사이트 SS (420, 440)", iso: "M", conditions: ["Annealed", "Hardened"], defaultHardness: { scale: "HRC", value: 30 } },
  { key: "duplex-ss", label: "Duplex SS (2205, 2507)", iso: "M", conditions: ["Annealed"], defaultHardness: { scale: "HBW", value: 260 } },
  // K - Cast iron
  { key: "gray-iron", label: "회주철 GC (FC200/FC250)", iso: "K", conditions: ["As-Cast"], defaultHardness: { scale: "HBW", value: 200 } },
  { key: "ductile-iron", label: "구상흑연주철 (FCD)", iso: "K", conditions: ["As-Cast", "Annealed"], defaultHardness: { scale: "HBW", value: 200 } },
  { key: "malleable-iron", label: "가단주철", iso: "K", conditions: ["Annealed"], defaultHardness: { scale: "HBW", value: 180 } },
  // N - Non-ferrous
  { key: "aluminum-wrought", label: "Aluminum Alloy, Wrought (6061, 7075)", iso: "N", conditions: ["T6", "T651", "O"], defaultHardness: { scale: "HBW", value: 95 } },
  { key: "aluminum-cast", label: "Aluminum Alloy, Cast", iso: "N", conditions: ["F", "T5", "T6"], defaultHardness: { scale: "HBW", value: 80 } },
  { key: "copper-alloys", label: "Copper Alloys (C1100, C2800)", iso: "N", conditions: ["Annealed", "CW"], defaultHardness: { scale: "HRB", value: 40 } },
  { key: "brass-bronze", label: "황동/청동", iso: "N", conditions: ["Annealed", "CW"], defaultHardness: { scale: "HRB", value: 50 } },
  // S - Superalloy
  { key: "inconel", label: "Inconel (718, 625)", iso: "S", conditions: ["Solution", "Aged"], defaultHardness: { scale: "HRC", value: 36 } },
  { key: "titanium", label: "Titanium Alloy (Ti-6Al-4V)", iso: "S", conditions: ["Annealed", "STA"], defaultHardness: { scale: "HRC", value: 32 } },
  { key: "hastelloy", label: "Hastelloy", iso: "S", conditions: ["Solution"], defaultHardness: { scale: "HRC", value: 30 } },
  { key: "waspaloy", label: "Waspaloy / René", iso: "S", conditions: ["Aged"], defaultHardness: { scale: "HRC", value: 40 } },
  // H - Hardened
  { key: "hardened-4045", label: "프리하든 (40~45 HRC)", iso: "H", conditions: ["Hardened"], defaultHardness: { scale: "HRC", value: 42 } },
  { key: "hardened-5055", label: "경화강 (50~55 HRC)", iso: "H", conditions: ["Hardened"], defaultHardness: { scale: "HRC", value: 52 } },
  { key: "hardened-5565", label: "고경화강 (55~65 HRC)", iso: "H", conditions: ["Hardened"], defaultHardness: { scale: "HRC", value: 60 } },
  { key: "tool-steel-h", label: "공구강 (D2, SKD11)", iso: "H", conditions: ["Annealed", "Hardened"], defaultHardness: { scale: "HRC", value: 58 } },
  // Plastics / FRP (Harvey "Fiber Reinforced Plastics" 대응)
  { key: "plastic-unfilled", label: "Plastic Unfilled (ABS, PC, Nylon)", iso: "N", conditions: ["Standard"], defaultHardness: { scale: "HBW", value: 20 } },
  { key: "plastic-filled", label: "Plastic Filled (Glass / Carbon 충전)", iso: "N", conditions: ["Standard"], defaultHardness: { scale: "HBW", value: 35 } },
  { key: "frp-lubricant", label: "FRP · Lubricant Filled (Oil, Moly, Graphite)", iso: "N", conditions: ["Standard"], defaultHardness: { scale: "HBS", value: 40 } },
  { key: "frp-glass", label: "FRP · Glass Fiber (GFRP)", iso: "N", conditions: ["Standard"], defaultHardness: { scale: "HBS", value: 60 } },
  { key: "frp-carbon", label: "FRP · Carbon Fiber (CFRP)", iso: "N", conditions: ["Standard"], defaultHardness: { scale: "HBS", value: 80 } },
  { key: "graphite", label: "Graphite (흑연)", iso: "K", conditions: ["Standard"], defaultHardness: { scale: "HBW", value: 50 } },
]

// ── Coolant ──
export interface CoolantOption {
  key: string
  label: string
  vcMultiplier: number   // affects max Vc
  heatRemoval: number    // 0..1
}
export const COOLANTS: CoolantOption[] = [
  { key: "flood", label: "Flood (수용성 범람)", vcMultiplier: 1.0, heatRemoval: 1.0 },
  { key: "mql", label: "MQL (미량윤활)", vcMultiplier: 0.92, heatRemoval: 0.7 },
  { key: "mist", label: "Mist (미스트)", vcMultiplier: 0.88, heatRemoval: 0.6 },
  { key: "air", label: "Air Blast", vcMultiplier: 0.82, heatRemoval: 0.4 },
  { key: "dry", label: "Dry (건식)", vcMultiplier: 0.7, heatRemoval: 0.15 },
  { key: "throughspindle", label: "Through-Spindle 쿨런트", vcMultiplier: 1.15, heatRemoval: 1.2 },
]

// ── Coating ──
export interface CoatingOption {
  key: string
  label: string
  vcMultiplier: number   // vs uncoated baseline
  maxTempC: number       // 최대 사용온도
}
export const COATINGS: CoatingOption[] = [
  { key: "none", label: "Uncoated", vcMultiplier: 1.0, maxTempC: 600 },
  { key: "tin", label: "TiN (금색)", vcMultiplier: 1.15, maxTempC: 600 },
  { key: "ticn", label: "TiCN", vcMultiplier: 1.2, maxTempC: 450 },
  { key: "altin", label: "AlTiN (보라)", vcMultiplier: 1.35, maxTempC: 900 },
  { key: "alcrn", label: "AlCrN", vcMultiplier: 1.4, maxTempC: 1100 },
  { key: "naco", label: "nACo / nACRo", vcMultiplier: 1.45, maxTempC: 1200 },
  { key: "dlc", label: "DLC (비철용)", vcMultiplier: 1.25, maxTempC: 400 },
  { key: "zrn", label: "ZrN", vcMultiplier: 1.2, maxTempC: 550 },
  { key: "crn", label: "CrN", vcMultiplier: 1.15, maxTempC: 700 },
  { key: "diamond", label: "Diamond (CVD)", vcMultiplier: 1.6, maxTempC: 700 },
]

// ── Tool Groups (상위 네비) ──
export interface ToolGroup {
  key: string
  label: string
  enabled: boolean
}
export const TOOL_GROUPS: ToolGroup[] = [
  { key: "milling", label: "Milling 밀링", enabled: true },
  { key: "drilling", label: "Drilling 드릴링", enabled: false },
  { key: "turning", label: "Turning 선삭", enabled: false },
  { key: "reaming", label: "Reaming 리밍", enabled: false },
  { key: "tapping", label: "Tapping 태핑", enabled: false },
  { key: "threadmilling", label: "Thread Milling", enabled: false },
]

// ── Operation defaults (Side vs Slot 자동 파라미터) ──
export interface OperationDefault {
  apRatio: number   // ap = apRatio × D
  aeRatio: number   // ae = aeRatio × D
  fzMult: number    // fz = fz_base × fzMult
  vcMult: number    // Vc = Vc_base × vcMult
  hint: string
}
export const OPERATION_DEFAULTS: Record<string, OperationDefault> = {
  Side_Milling: { apRatio: 1.0, aeRatio: 0.2, fzMult: 1.0, vcMult: 1.0, hint: "ae = 0.2·D, 전장" },
  Slotting: { apRatio: 0.5, aeRatio: 1.0, fzMult: 0.7, vcMult: 0.85, hint: "전폭 가공, 깊이 감소" },
  Profiling: { apRatio: 1.0, aeRatio: 0.1, fzMult: 1.1, vcMult: 1.1, hint: "얕은 ae, 고속" },
  Facing: { apRatio: 0.3, aeRatio: 0.7, fzMult: 1.0, vcMult: 1.0, hint: "얕은 ap, 넓은 ae" },
  Pocketing: { apRatio: 0.5, aeRatio: 0.5, fzMult: 0.85, vcMult: 0.9, hint: "adaptive 권장" },
}

// Hardness scale conversions (approximate, steel-based)
export function convertHardness(value: number, from: "HRC" | "HBW" | "HRB" | "HBS", to: "HRC" | "HBW" | "HRB" | "HBS"): number {
  if (from === to) return value
  // Convert everything to HBW first, then to target
  let hbw = value
  if (from === "HRC") hbw = value < 20 ? 200 : 223 + value * 6.5
  else if (from === "HRB") hbw = value * 1.8 - 5
  else if (from === "HBS") hbw = value // approximate
  if (to === "HBW" || to === "HBS") return Math.round(hbw)
  if (to === "HRC") return parseFloat(((hbw - 223) / 6.5).toFixed(1))
  if (to === "HRB") return parseFloat(((hbw + 5) / 1.8).toFixed(1))
  return hbw
}
