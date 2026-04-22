"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Search, Gauge, Zap, Shield, BarChart3, RefreshCw, Lock, Unlock,
  Sliders, Cog, ChevronRight, AlertTriangle, AlertCircle, Info,
  Wrench, FileText, ArrowDownCircle, RotateCcw, X, Lightbulb, LayoutGrid, Ruler,
} from "lucide-react"
import {
  calculateCutting,
  getDefaultRange,
  applyOptimizationMode,
  deriveFactors,
  computeAdvanced,
  buildWarnings,
  workholdingAllowance,
  estimateToolLifeMin,
  estimateRaUm,
  estimateChatterRisk,
  estimateCostPerPart,
  hardnessVcDerate,
  stickoutDerate,
  workholdingCap,
  climbAdjust,
  computePassPlan,
  economicVc,
  solveForTargetMRR,
  MIN_CHIP_THICKNESS,
  UNITS,
  ISO_LABELS,
  KC_TABLE,
  type CatalogRange,
  type OptimizationMode,
  type SimWarning,
  type DisplayUnit,
} from "../cutting-calculator"
import { TaylorCurve } from "./taylor-curve"
import { FormulaPanel } from "./formula-panel"
import { ToolRecommender } from "./tool-recommender"
import { EduLabel } from "./education-widgets"
import { ChipColorDiagnostic, SymptomMatrix, CommonMistakes } from "./diagnostic-panels"
import { SfmIptTable } from "./sfm-ipt-table"
import { CornerFeedPanel } from "./corner-panel"
import { CuttingAction } from "./cutting-action"
import { ToolSilhouette } from "./tool-silhouette"
import { EngagementCircle } from "./engagement-circle"
import { ADOCRDOCAdjuster } from "./adoc-rdoc-adjuster"
import { ToolPathDiagram } from "./tool-path-diagrams"
import { stateToQuery, queryToState, type SerializableState, type SnapshotSummary } from "./state-serde"
import { generateGCode } from "./gcode-gen"
// STEP 4·5·6 신규 컴포넌트
import { ProvenancePanel } from "./provenance-panel"
import { ToolPathInfoModal } from "./tool-path-info-modal"
import { CornerFeedPanelV2 } from "./corner-panel-v2"
import { WorkholdingSlider } from "./workholding-slider"
import { AiCoachPanel } from "./ai-coach-panel"
import { HeatmapPanel } from "./heatmap-panel"
import { MachiningAnimation } from "./machining-animation"
import { ToolLifeScenario } from "./tool-life-scenario"
import { MultiToolCompare } from "./multi-tool-compare"
import { LearningMode } from "./learning-mode"
import { CompetitorLiveCompare } from "./competitor-live-compare"
import {
  SPINDLE_PRESETS, HOLDER_PRESETS, TOOL_MATERIALS, TOOL_PATHS, MATERIAL_SUBGROUPS, convertHardness,
  COOLANTS, COATINGS, TOOL_GROUPS, OPERATION_DEFAULTS, STRATEGY_OPTIONS,
  type SpindlePreset, type HolderPreset,
} from "./presets"

interface CatalogCondition {
  seriesName: string; isoGroup: string; cuttingType: string
  toolShape?: string | null; workpiece?: string | null; hardnessHrc?: string | null
  diameterMm: number | null
  Vc: string | null; fz: string | null; ap: string | null; ae: string | null
  n: string | null; vf: string | null
  confidence: number
}
interface SimulatorFacets { isoGroups: string[]; workpieces: string[]; hardnesses: string[]; cuttingTypes: string[]; toolShapes: string[] }
interface SimulatorApiResponse {
  found: boolean; count: number; series: string; diameter: number | null
  material: string | null; workpiece: string | null; hardness: string | null
  cuttingType: string | null; toolShape: string | null
  conditions: CatalogCondition[]; facets: SimulatorFacets
  ranges: { VcMin: number; VcMax: number; fzMin: number; fzMax: number } | null
  interpolated: boolean
}

interface CuttingSimulatorV2Props { initialProduct?: string; initialMaterial?: string; initialOperation?: string }

type ToolCategory = "endmill" | "drill" | "reamer" | "tap"
type EndmillShape = "all" | "square" | "ball" | "radius" | "chamfer"
type HardnessScale = "HRC" | "HBW" | "HRB" | "HBS"

interface EndmillExample {
  label: string; brand: string; series: string; edp: string
  shape: Exclude<EndmillShape, "all">; iso: string
  diameter: number; flutes: number
  LOC: number; OAL: number; shank: number; cornerR?: number
  hint: string
  repCondition: { Vc: number; fz: number; ap: number; ae: number }
}

const TOOL_CATEGORIES: Array<{ key: ToolCategory; label: string; enabled: boolean }> = [
  { key: "endmill", label: "엔드밀", enabled: true },
  { key: "drill", label: "드릴", enabled: false },
  { key: "reamer", label: "리머", enabled: false },
  { key: "tap", label: "탭", enabled: false },
]
const ENDMILL_SHAPES: Array<{ key: EndmillShape; label: string }> = [
  { key: "all", label: "전체" }, { key: "square", label: "Square" },
  { key: "ball", label: "Ball" }, { key: "radius", label: "Corner-R" }, { key: "chamfer", label: "Chamfer" },
]

const ENDMILL_EXAMPLES: EndmillExample[] = [
  // ── Square (10) ──
  { label: "SUS304 측면가공", brand: "SUS-CUT", series: "EHD84", edp: "EHD84100", shape: "square", iso: "M", diameter: 10, flutes: 4, LOC: 25, OAL: 75, shank: 10, hint: "스테인리스 · 4날 스퀘어", repCondition: { Vc: 120, fz: 0.05, ap: 10, ae: 2 } },
  { label: "스테인리스 범용 4날", brand: "GA931", series: "GA931", edp: "GA93108", shape: "square", iso: "M", diameter: 8, flutes: 4, LOC: 20, OAL: 60, shank: 8, hint: "M계열 · 4날 스퀘어", repCondition: { Vc: 130, fz: 0.04, ap: 6, ae: 2 } },
  { label: "스테인리스 미디움롱", brand: "GAC25", series: "GAC25", edp: "GAC25060", shape: "square", iso: "M", diameter: 6, flutes: 4, LOC: 18, OAL: 65, shank: 6, hint: "미디움 롱 · 4날", repCondition: { Vc: 115, fz: 0.035, ap: 5, ae: 1.5 } },
  { label: "스테인리스 6날 피니싱", brand: "CGMG62", series: "CGMG62", edp: "CGMG62100", shape: "square", iso: "M", diameter: 10, flutes: 6, LOC: 22, OAL: 75, shank: 10, hint: "6날 고속피니싱", repCondition: { Vc: 140, fz: 0.04, ap: 3, ae: 1 } },
  { label: "주철 슬로팅", brand: "V7 PLUS", series: "GMG87", edp: "GMG87080", shape: "square", iso: "K", diameter: 8, flutes: 4, LOC: 20, OAL: 60, shank: 8, hint: "GC계 주철 · 4날", repCondition: { Vc: 180, fz: 0.08, ap: 8, ae: 4 } },
  { label: "주철 헤비컷", brand: "V7 PLUS", series: "GMH54", edp: "GMH54120", shape: "square", iso: "K", diameter: 12, flutes: 4, LOC: 26, OAL: 83, shank: 12, hint: "FCD · 헤비컷 4날", repCondition: { Vc: 200, fz: 0.1, ap: 12, ae: 6 } },
  { label: "프리하든강 스퀘어", brand: "SG8", series: "SG8A01", edp: "SG8A01060", shape: "square", iso: "H", diameter: 6, flutes: 4, LOC: 14, OAL: 60, shank: 6, hint: "40~50HRC · 4날", repCondition: { Vc: 110, fz: 0.035, ap: 5, ae: 1.5 } },
  { label: "고경도강 4날", brand: "GNX", series: "GNX35", edp: "GNX35050", shape: "square", iso: "H", diameter: 5, flutes: 4, LOC: 12, OAL: 55, shank: 6, hint: "50~60HRC · 4날", repCondition: { Vc: 80, fz: 0.025, ap: 3, ae: 1 } },
  { label: "고속경화강", brand: "3S", series: "CGM3S01", edp: "CGM3S01060", shape: "square", iso: "H", diameter: 6, flutes: 3, LOC: 13, OAL: 60, shank: 6, hint: "3날 고속가공", repCondition: { Vc: 90, fz: 0.03, ap: 4, ae: 1.2 } },
  { label: "탄소강 고효율 측면", brand: "SEM", series: "SEM813", edp: "SEM813080", shape: "square", iso: "P", diameter: 8, flutes: 4, LOC: 20, OAL: 70, shank: 8, hint: "S45C · 고속가공", repCondition: { Vc: 180, fz: 0.06, ap: 7, ae: 2 } },

  // ── Ball (8) ──
  { label: "프리하든강 미세 볼", brand: "E-FORCE", series: "GNX98", edp: "GNX98050", shape: "ball", iso: "H", diameter: 0.5, flutes: 2, LOC: 0.75, OAL: 50, shank: 4, hint: "30~45HRC · 2날 볼", repCondition: { Vc: 80, fz: 0.008, ap: 0.05, ae: 0.025 } },
  { label: "고경도 4G 볼", brand: "4G MILLS", series: "SEM846", edp: "SEM846060", shape: "ball", iso: "H", diameter: 6, flutes: 2, LOC: 12, OAL: 70, shank: 6, hint: "55~65HRC · 2날 롱넥 볼", repCondition: { Vc: 60, fz: 0.02, ap: 0.3, ae: 0.15 } },
  { label: "롱넥 볼 (경화강)", brand: "GNX", series: "GNX46", edp: "GNX46040", shape: "ball", iso: "H", diameter: 4, flutes: 2, LOC: 8, OAL: 80, shank: 4, hint: "롱넥 · 2날 볼", repCondition: { Vc: 70, fz: 0.015, ap: 0.2, ae: 0.1 } },
  { label: "3날 볼 (고경도)", brand: "3S", series: "CGM3S38", edp: "CGM3S38060", shape: "ball", iso: "H", diameter: 6, flutes: 3, LOC: 12, OAL: 60, shank: 6, hint: "3날 볼 · 경화강", repCondition: { Vc: 75, fz: 0.02, ap: 0.4, ae: 0.2 } },
  { label: "숏 볼 (2날)", brand: "SG8", series: "SG8A38", edp: "SG8A38060", shape: "ball", iso: "H", diameter: 6, flutes: 2, LOC: 11, OAL: 55, shank: 6, hint: "2날 숏 볼 · 40~55HRC", repCondition: { Vc: 90, fz: 0.025, ap: 0.5, ae: 0.25 } },
  { label: "인코넬 볼 마감", brand: "GMH", series: "GMH61", edp: "GMH61080", shape: "ball", iso: "S", diameter: 8, flutes: 4, LOC: 16, OAL: 75, shank: 8, hint: "Inconel718 · 4날", repCondition: { Vc: 45, fz: 0.025, ap: 0.4, ae: 0.2 } },
  { label: "알루미늄 볼 (TiAlN)", brand: "EQ", series: "EQ480", edp: "EQ480100", shape: "ball", iso: "N", diameter: 10, flutes: 2, LOC: 20, OAL: 70, shank: 10, hint: "비철 · 2날 볼", repCondition: { Vc: 500, fz: 0.06, ap: 2, ae: 1 } },
  { label: "알루미늄 볼 라핑", brand: "E2806", series: "E2806", edp: "E2806120", shape: "ball", iso: "N", diameter: 12, flutes: 4, LOC: 26, OAL: 83, shank: 12, hint: "4~6날 볼 라핑", repCondition: { Vc: 600, fz: 0.08, ap: 4, ae: 2 } },

  // ── Radius (Corner-R) (7) ──
  { label: "탄소강 코너R 마감", brand: "X5070", series: "X5070", edp: "X5070100R05", shape: "radius", iso: "P", diameter: 10, flutes: 4, LOC: 25, OAL: 75, shank: 10, cornerR: 0.5, hint: "S50C · R0.5 4날", repCondition: { Vc: 160, fz: 0.06, ap: 8, ae: 2 } },
  { label: "경화강 코너R 4날", brand: "SEME", series: "SEME61", edp: "SEME61080R10", shape: "radius", iso: "H", diameter: 8, flutes: 4, LOC: 18, OAL: 70, shank: 8, cornerR: 1.0, hint: "45~55HRC · R1.0", repCondition: { Vc: 95, fz: 0.03, ap: 6, ae: 1.5 } },
  { label: "다이스 가공 R", brand: "SEMD", series: "SEMD99", edp: "SEMD99100R20", shape: "radius", iso: "H", diameter: 10, flutes: 4, LOC: 22, OAL: 80, shank: 10, cornerR: 2.0, hint: "금형 · R2.0 4날", repCondition: { Vc: 85, fz: 0.035, ap: 5, ae: 1.5 } },
  { label: "롱넥 코너R (경화)", brand: "GNX", series: "GNX61", edp: "GNX61060R05", shape: "radius", iso: "H", diameter: 6, flutes: 2, LOC: 12, OAL: 90, shank: 6, cornerR: 0.5, hint: "롱넥 · R0.5 2날", repCondition: { Vc: 70, fz: 0.02, ap: 3, ae: 0.8 } },
  { label: "고이송 래디우스", brand: "SG8", series: "SG8D32", edp: "SG8D32160R30", shape: "radius", iso: "H", diameter: 16, flutes: 4, LOC: 20, OAL: 90, shank: 16, cornerR: 3.0, hint: "고이송 · R3.0", repCondition: { Vc: 140, fz: 0.8, ap: 0.8, ae: 12 } },
  { label: "2날 R (경화)", brand: "SG8", series: "SG8A36", edp: "SG8A36080R10", shape: "radius", iso: "H", diameter: 8, flutes: 2, LOC: 18, OAL: 75, shank: 8, cornerR: 1.0, hint: "2날 · R1.0 래디우스", repCondition: { Vc: 95, fz: 0.03, ap: 6, ae: 1.5 } },
  { label: "인코넬 코너R", brand: "3S", series: "CGM3S37", edp: "CGM3S37080R10", shape: "radius", iso: "S", diameter: 8, flutes: 4, LOC: 16, OAL: 70, shank: 8, cornerR: 1.0, hint: "Inconel · R1.0", repCondition: { Vc: 40, fz: 0.02, ap: 4, ae: 1 } },

  // ── Chamfer / Deburr (5) ──
  { label: "범용 챔퍼링 45°", brand: "V7 PLUS", series: "GME83", edp: "GME83060", shape: "chamfer", iso: "P", diameter: 6, flutes: 4, LOC: 14, OAL: 55, shank: 6, hint: "45° 모따기 · 4날", repCondition: { Vc: 140, fz: 0.04, ap: 2, ae: 1 } },
  { label: "스테인리스 챔퍼", brand: "GMH42", series: "GMH42", edp: "GMH42080", shape: "chamfer", iso: "M", diameter: 8, flutes: 4, LOC: 15, OAL: 60, shank: 8, hint: "SS · 4날 챔퍼", repCondition: { Vc: 110, fz: 0.03, ap: 1.5, ae: 0.8 } },
  { label: "알루미늄 엣지 제거", brand: "CE74", series: "CE7401", edp: "CE7401060", shape: "chamfer", iso: "N", diameter: 6, flutes: 3, LOC: 12, OAL: 55, shank: 6, hint: "비철 · 디버링", repCondition: { Vc: 400, fz: 0.08, ap: 1.5, ae: 0.5 } },
  { label: "주철 면취", brand: "GMG", series: "GMG24", edp: "GMG24100", shape: "chamfer", iso: "K", diameter: 10, flutes: 4, LOC: 18, OAL: 65, shank: 10, hint: "주철 · 45° 챔퍼", repCondition: { Vc: 170, fz: 0.06, ap: 2, ae: 1 } },
  { label: "경화강 면취", brand: "GNX", series: "GNX45", edp: "GNX45060", shape: "chamfer", iso: "H", diameter: 6, flutes: 4, LOC: 10, OAL: 55, shank: 6, hint: "롱넥 · 경화면취", repCondition: { Vc: 85, fz: 0.025, ap: 1.2, ae: 0.5 } },
]

const DEFAULT_STICKOUT_RATIO = 3

export function CuttingSimulatorV2({ initialProduct, initialMaterial, initialOperation }: CuttingSimulatorV2Props) {
  // ─ Units ─
  const [displayUnit, setDisplayUnit] = useState<DisplayUnit>("metric")

  // ─ Tool type / shape ─
  const [toolCategory, setToolCategory] = useState<ToolCategory>("endmill")
  const [endmillShape, setEndmillShape] = useState<EndmillShape>("all")

  // ─ Tool (independent inputs) ─
  const [productCode, setProductCode] = useState(initialProduct ?? "")
  const [realEdp, setRealEdp] = useState<string | null>(null)
  const [diameter, setDiameter] = useState(10)
  const [fluteCount, setFluteCount] = useState(4)
  const [activeShape, setActiveShape] = useState<Exclude<EndmillShape, "all">>("square")
  const [LOC, setLOC] = useState(25)
  const [OAL, setOAL] = useState(75)
  const [shankDia, setShankDia] = useState(10)
  const [cornerR, setCornerR] = useState(0.5)
  const [toolMaterial, setToolMaterial] = useState("carbide")

  // ─ Material ─
  const [isoGroup, setIsoGroup] = useState(initialMaterial ?? "P")
  const [subgroupKey, setSubgroupKey] = useState<string>("")
  const [condition, setCondition] = useState<string>("")
  const [hardnessScale, setHardnessScale] = useState<HardnessScale>("HRC")
  const [hardnessValue, setHardnessValue] = useState<number>(30)
  const [workpiece, setWorkpiece] = useState<string>("")
  const [cuttingType, setCuttingType] = useState<string>("")
  const [toolShape, setToolShape] = useState<string>("")

  // ─ Operation ─
  const [operation, setOperation] = useState(initialOperation ?? "Side_Milling")
  const [toolPath, setToolPath] = useState("conventional")

  // ─ Machine ─
  const [spindleKey, setSpindleKey] = useState<string>("vmc-std")
  const [holderKey, setHolderKey] = useState<string>("er-collet")
  const [maxRpm, setMaxRpm] = useState(12000)
  const [maxKw, setMaxKw] = useState(15)
  const [maxIpm, setMaxIpm] = useState(394)
  const [workholding, setWorkholding] = useState(65)

  // ─ Parameters ─
  const [stickoutMm, setStickoutMm] = useState(30)
  const [stickoutManual, setStickoutManual] = useState(false)
  const [Vc, setVc] = useState(200)
  const [fz, setFz] = useState(0.05)
  const [ap, setAp] = useState(10)
  const [ae, setAe] = useState(5)
  const [apLocked, setApLocked] = useState(false)
  const [aeLocked, setAeLocked] = useState(false)

  // ─ Speed/Feed % adjusters (Harvey sig) ─
  const [speedPct, setSpeedPct] = useState(0)
  const [feedPct, setFeedPct] = useState(0)

  // ─ Optimization ─
  const [mode, setMode] = useState<OptimizationMode>("balanced")

  // ─ Catalog ─
  const [catalogData, setCatalogData] = useState<SimulatorApiResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [dataSource, setDataSource] = useState<"catalog" | "interpolated" | "default">("default")
  const [everInteracted, setEverInteracted] = useState(false)

  // v2.2 additions: dark theme, A/B snapshots, share, PDF
  const [darkMode, setDarkMode] = useState(false)
  const [snapshotA, setSnapshotA] = useState<SnapshotSummary | null>(null)
  const [snapshotB, setSnapshotB] = useState<SnapshotSummary | null>(null)
  const [shareToast, setShareToast] = useState<string | null>(null)
  const [urlHydrated, setUrlHydrated] = useState(false)

  // v2.3: Coolant, Coating, Tool Group, Advanced filters, Cost, Corner, GCode
  const [toolGroup, setToolGroup] = useState<string>("milling")
  const [coolant, setCoolant] = useState<string>("flood")
  const [coating, setCoating] = useState<string>("altin")
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [cornerReductionPct, setCornerReductionPct] = useState(30)
  const [toolCostKrw, setToolCostKrw] = useState(45000)
  const [machineCostPerHourKrw, setMachineCostPerHourKrw] = useState(50000)
  const [cycleTimeMin, setCycleTimeMin] = useState(5)
  const [gcodeDialect, setGcodeDialect] = useState<"fanuc" | "heidenhain" | "siemens">("fanuc")
  const [gcodeOpen, setGcodeOpen] = useState(false)

  // v2.4: 상관관계 + 신규 기능
  const [climb, setClimb] = useState(true) // true = climb (다운컷), false = conventional
  const [autoCorrelate, setAutoCorrelate] = useState(true)  // 상관관계 자동 적용 토글
  const [stockL, setStockL] = useState(100)
  const [stockW, setStockW] = useState(60)
  const [stockH, setStockH] = useState(30)
  const [finishAp, setFinishAp] = useState(0.2)
  const [targetMRR, setTargetMRR] = useState(30)
  const [savedPresets, setSavedPresets] = useState<Array<{ name: string; state: SerializableState }>>([])
  const [presetName, setPresetName] = useState("")
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const [strategy, setStrategy] = useState<string>("")

  // STEP 4·5·6 통합 상태
  const [toolPathModalOpen, setToolPathModalOpen] = useState(false)
  const [nextFeaturesOpen, setNextFeaturesOpen] = useState(false)
  const [speedsFeedsBaseline, setSpeedsFeedsBaseline] = useState<{
    sfm: number; iptInch: number
    source: "default" | "pdf_verified" | "pdf_partial" | "estimated" | "none"
    confidence: number; sourceRef?: string
  } | null>(null)

  const resultsAnchorRef = useRef<HTMLDivElement>(null)
  const reportAreaRef = useRef<HTMLDivElement>(null)

  // Apply spindle preset
  useEffect(() => {
    const p = SPINDLE_PRESETS.find(s => s.key === spindleKey)
    if (p && p.key !== "custom") {
      setMaxRpm(p.maxRpm); setMaxKw(p.maxKw); setMaxIpm(p.maxIpm)
    }
  }, [spindleKey])

  // Apply subgroup preset
  useEffect(() => {
    if (!subgroupKey) return
    const sg = MATERIAL_SUBGROUPS.find(m => m.key === subgroupKey)
    if (sg) {
      setIsoGroup(sg.iso)
      setHardnessScale(sg.defaultHardness.scale)
      setHardnessValue(sg.defaultHardness.value)
      if (sg.conditions.length > 0) setCondition(sg.conditions[0])
    }
  }, [subgroupKey])

  // Auto stickout from D
  useEffect(() => {
    if (!stickoutManual) setStickoutMm(Math.max(3, diameter * DEFAULT_STICKOUT_RATIO))
  }, [diameter, stickoutManual])

  // Auto shank = D default
  useEffect(() => { setShankDia(diameter) }, [diameter])

  // Operation defaults — Side/Slot/Profile 등 바꾸면 ap/ae 자동조정
  useEffect(() => {
    if (!autoCorrelate) return
    const opDef = OPERATION_DEFAULTS[operation]
    if (opDef) {
      setAp(parseFloat((opDef.apRatio * diameter).toFixed(1)))
      setAe(parseFloat((opDef.aeRatio * diameter).toFixed(1)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation])

  // Tool Path 프리셋 — HEM/Trochoidal/Adaptive 선택시 ap/ae 재조정
  useEffect(() => {
    if (!autoCorrelate) return
    if (toolPath === "hem" || toolPath === "trochoidal" || toolPath === "dynamic") {
      setAp(parseFloat((diameter * 1.5).toFixed(1)))
      setAe(parseFloat((diameter * 0.08).toFixed(2)))
    } else if (toolPath === "adaptive") {
      setAp(parseFloat((diameter * 1.0).toFixed(1)))
      setAe(parseFloat((diameter * 0.15).toFixed(2)))
    } else if (toolPath === "plunge") {
      setAe(parseFloat((diameter * 0.95).toFixed(1)))
    } else if (toolPath === "ramping") {
      setAp(parseFloat((diameter * 0.5).toFixed(1)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolPath])

  // Workholding → ap/ae 상한 초과시 clamp
  useEffect(() => {
    if (!autoCorrelate) return
    const cap = workholdingCap(workholding, diameter)
    if (ap > cap.apMax) setAp(parseFloat(cap.apMax.toFixed(1)))
    if (ae > cap.aeMax) setAe(parseFloat(cap.aeMax.toFixed(1)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workholding, diameter])

  // localStorage 프리셋
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const raw = localStorage.getItem("yg1-sim-presets")
      if (raw) setSavedPresets(JSON.parse(raw))
    } catch {}
  }, [])
  const savePreset = () => {
    if (!presetName.trim()) return
    const newP = { name: presetName.trim(), state: {
      productCode, diameter, fluteCount, activeShape, LOC, OAL, shankDia, cornerR, toolMaterial,
      isoGroup, subgroupKey, condition, hardnessScale, hardnessValue,
      operation, toolPath, spindleKey, holderKey, workholding, stickoutMm,
      Vc, fz, ap, ae, speedPct, feedPct, mode, displayUnit,
    } as SerializableState }
    const updated = [newP, ...savedPresets.filter(p => p.name !== newP.name)].slice(0, 20)
    setSavedPresets(updated)
    try { localStorage.setItem("yg1-sim-presets", JSON.stringify(updated)) } catch {}
    setPresetName("")
    setShareToast(`"${newP.name}" 저장됨`)
    setTimeout(() => setShareToast(null), 1500)
  }
  const loadPreset = (p: { name: string; state: SerializableState }) => {
    const s = p.state
    if (s.productCode != null) setProductCode(s.productCode)
    if (s.diameter != null) setDiameter(s.diameter)
    if (s.fluteCount != null) setFluteCount(s.fluteCount)
    if (s.activeShape) setActiveShape(s.activeShape as Exclude<EndmillShape, "all">)
    if (s.LOC != null) setLOC(s.LOC)
    if (s.OAL != null) setOAL(s.OAL)
    if (s.shankDia != null) setShankDia(s.shankDia)
    if (s.cornerR != null) setCornerR(s.cornerR)
    if (s.toolMaterial) setToolMaterial(s.toolMaterial)
    if (s.isoGroup) setIsoGroup(s.isoGroup)
    if (s.hardnessValue != null) setHardnessValue(s.hardnessValue)
    if (s.Vc != null) setVc(s.Vc)
    if (s.fz != null) setFz(s.fz)
    if (s.ap != null) setAp(s.ap)
    if (s.ae != null) setAe(s.ae)
    setShareToast(`"${p.name}" 로드됨`)
    setTimeout(() => setShareToast(null), 1500)
  }
  const deletePreset = (name: string) => {
    const updated = savedPresets.filter(p => p.name !== name)
    setSavedPresets(updated)
    try { localStorage.setItem("yg1-sim-presets", JSON.stringify(updated)) } catch {}
  }

  const range = useMemo<CatalogRange>(() => {
    if (catalogData?.ranges) {
      return {
        VcMin: catalogData.ranges.VcMin * 0.7,
        VcMax: catalogData.ranges.VcMax * 1.3,
        fzMin: Math.max(0.005, catalogData.ranges.fzMin * 0.5),
        fzMax: catalogData.ranges.fzMax * 1.5,
        apMax: diameter * 2, aeMax: diameter,
      }
    }
    return getDefaultRange(diameter)
  }, [catalogData, diameter])

  // ═══ 상관관계 팩터들 ═══
  const coolantMult = useMemo(() => COOLANTS.find(c => c.key === coolant)?.vcMultiplier ?? 1, [coolant])
  const coatingMult = useMemo(() => COATINGS.find(c => c.key === coating)?.vcMultiplier ?? 1, [coating])
  const hardDerate = useMemo(() => autoCorrelate ? hardnessVcDerate(hardnessScale, hardnessValue) : 1, [autoCorrelate, hardnessScale, hardnessValue])
  const stickoutD = useMemo(() => autoCorrelate ? stickoutDerate(stickoutMm, diameter) : { vc: 1, fz: 1 }, [autoCorrelate, stickoutMm, diameter])
  const whCap = useMemo(() => autoCorrelate ? workholdingCap(workholding, diameter) : { apMax: diameter * 2, aeMax: diameter }, [autoCorrelate, workholding, diameter])
  const climbAdj = useMemo(() => climbAdjust(climb), [climb])

  // Effective values (base × speed% × coolant × coating × hardness × stickout)
  const VcEff = useMemo(() =>
    Vc * (1 + speedPct / 100) * coolantMult * coatingMult * hardDerate * stickoutD.vc
  , [Vc, speedPct, coolantMult, coatingMult, hardDerate, stickoutD.vc])
  const fzEff = useMemo(() =>
    fz * (1 + feedPct / 100) * stickoutD.fz
  , [fz, feedPct, stickoutD.fz])

  const result = useMemo(() => calculateCutting({
    Vc: VcEff, fz: fzEff, ap, ae, D: diameter, Z: fluteCount, isoGroup,
  }), [VcEff, fzEff, ap, ae, diameter, fluteCount, isoGroup])

  const derived = useMemo(() => deriveFactors({
    Vc: VcEff, fz: fzEff, ap, ae, D: diameter, shape: activeShape,
  }), [VcEff, fzEff, ap, ae, diameter, activeShape])

  // Holder rigidity affects effective stiffness
  const effectiveStickout = useMemo(() => {
    const holder = HOLDER_PRESETS.find(h => h.key === holderKey)
    const stiffness = (holder?.rigidity ?? 50) / 100
    return stickoutMm * (1.3 - stiffness * 0.4) // loose holder → longer effective
  }, [stickoutMm, holderKey])

  const toolMatE = useMemo(() =>
    TOOL_MATERIALS.find(m => m.key === toolMaterial)?.E_GPa ?? 600
  , [toolMaterial])

  const advanced = useMemo(() => computeAdvanced({
    Pc: result.Pc, n: result.n, D: diameter,
    shaft: { stickoutMm: effectiveStickout, youngModulusGPa: toolMatE },
  }), [result.Pc, result.n, diameter, effectiveStickout, toolMatE])

  // Vf IPM
  const vfIpm = UNITS.mmPerMinToIPM(result.Vf)

  // Tool life / Ra / Chatter / Cost
  const VcReferenceVal = catalogData?.ranges ? (catalogData.ranges.VcMin + catalogData.ranges.VcMax) / 2 : Vc
  const toolLifeMin = useMemo(() => {
    const base = estimateToolLifeMin({
      Vc: VcEff, VcReference: VcReferenceVal, coatingMult, isoGroup, toolMaterialE: toolMatE,
    })
    return base * climbAdj.lifeMult
  }, [VcEff, VcReferenceVal, coatingMult, isoGroup, toolMatE, climbAdj.lifeMult])

  const raUm = useMemo(() => {
    const base = estimateRaUm({ fz: fzEff, D: diameter, shape: activeShape, cornerR, ae })
    return parseFloat((base * climbAdj.raMult).toFixed(2))
  }, [fzEff, diameter, activeShape, cornerR, ae, climbAdj.raMult])

  // Economic Vc suggestion
  const econVc = useMemo(() => economicVc({
    VcReference: VcReferenceVal, toolLifeRefMin: 45,
    toolCostKrw, machineCostPerHourKrw, taylorN: toolMatE < 300 ? 0.125 : 0.25,
  }), [VcReferenceVal, toolCostKrw, machineCostPerHourKrw, toolMatE])

  // Min chip thickness for this material
  const minHex = MIN_CHIP_THICKNESS[isoGroup] ?? 0.010

  // Pass plan
  const passPlan = useMemo(() => computePassPlan({
    stockLmm: stockL, stockWmm: stockW, stockHmm: stockH,
    apFinish: finishAp, aeFinish: Math.max(0.05, ae * 0.2),
    VfRough: result.Vf, VfFinish: result.Vf * 0.6,
    D: diameter, apMaxRough: Math.min(ap, whCap.apMax),
  }), [stockL, stockW, stockH, finishAp, ae, result.Vf, diameter, ap, whCap.apMax])

  // Reverse solver for target MRR
  const reverseSol = useMemo(() => solveForTargetMRR({
    targetMRR, D: diameter, Z: fluteCount, isoGroup, shape: activeShape,
    apMax: whCap.apMax, aeMax: whCap.aeMax,
  }), [targetMRR, diameter, fluteCount, isoGroup, activeShape, whCap.apMax, whCap.aeMax])

  const chatter = useMemo(() => estimateChatterRisk({
    stickoutMm, D: diameter, Pc: result.Pc, maxKw, workholdingSecurity: workholding, deflectionUm: advanced.deflection,
  }), [stickoutMm, diameter, result.Pc, maxKw, workholding, advanced.deflection])

  const cost = useMemo(() => estimateCostPerPart({
    toolLifeMin, cycleTimeMin, toolCostKrw, machineCostPerHourKrw,
  }), [toolLifeMin, cycleTimeMin, toolCostKrw, machineCostPerHourKrw])

  // Recommended from catalog (mid)
  const catalogRecommended = useMemo(() => {
    if (!catalogData?.ranges) return null
    return {
      Vc: (catalogData.ranges.VcMin + catalogData.ranges.VcMax) / 2,
      fz: (catalogData.ranges.fzMin + catalogData.ranges.fzMax) / 2,
    }
  }, [catalogData])

  const warnings = useMemo(() => {
    const base = buildWarnings({
      D: diameter, ap, ae, n: result.n, Pc: result.Pc,
      deflection: advanced.deflection, shape: activeShape,
      machine: { maxRpm, maxKw }, isoGroup, Vc: VcEff,
    })
    const extra: SimWarning[] = []
    // MAX IPM
    if (vfIpm > maxIpm) extra.push({ level: "error", message: `Vf ${vfIpm.toFixed(0)} IPM > 머신 최대 ${maxIpm} IPM` })
    else if (vfIpm > maxIpm * 0.9) extra.push({ level: "warn", message: `Vf IPM이 머신 한계 90% 초과` })
    // Workholding-scaled deflection
    const wa = workholdingAllowance(workholding)
    if (advanced.deflection > wa.deflectionLimit) {
      extra.push({ level: "error", message: `편향 ${advanced.deflection}μm > Workholding 허용 ${wa.deflectionLimit.toFixed(0)}μm` })
    }
    // Corner Radius vs ap
    if (activeShape === "radius" && ap < cornerR) {
      extra.push({ level: "info", message: `ap(${ap}) < CR(${cornerR}): 코너 원호 내 가공, chip thinning 추가 발생` })
    }
    // LOC vs ap
    if (ap > LOC) {
      extra.push({ level: "error", message: `ap ${ap}mm > LOC ${LOC}mm: 절삭날 길이 초과` })
    }
    // Stickout vs D
    if (stickoutMm > diameter * 5) {
      extra.push({ level: "warn", message: `Stickout ${stickoutMm}mm > 5·D: 편향 위험 증가` })
    }
    // Min chip thickness (rubbing prevention)
    if (derived.hex < minHex) {
      extra.push({ level: "warn", message: `실 chip ${derived.hex.toFixed(4)}mm < 최소 ${minHex}mm (${isoGroup}): rubbing → 공구수명 급감` })
    }
    // Chatter
    if (chatter.level === "high") {
      extra.push({ level: "error", message: `Chatter 위험 HIGH (${chatter.risk}%): ${chatter.reasons.join(", ")}` })
    }
    return [...base, ...extra]
  }, [diameter, ap, ae, result.n, result.Pc, advanced.deflection, activeShape, maxRpm, maxKw, isoGroup, VcEff, vfIpm, maxIpm, workholding, cornerR, LOC, stickoutMm, derived.hex, minHex, chatter])

  const fetchCatalog = useCallback(async () => {
    if (!productCode.trim()) return
    setIsLoading(true); setEverInteracted(true)
    try {
      const series = productCode.trim()
      const params = new URLSearchParams({ series, diameter: String(diameter), material: isoGroup })
      if (workpiece) params.set("workpiece", workpiece)
      if (hardnessValue > 0) params.set("hardness", String(hardnessValue))
      if (cuttingType) params.set("cuttingType", cuttingType)
      if (toolShape) params.set("toolShape", toolShape)
      const res = await fetch(`/api/simulator?${params.toString()}`)
      if (!res.ok) throw new Error("API error")
      const data: SimulatorApiResponse = await res.json()
      setCatalogData(data)

      if (data.found && data.ranges) {
        setDataSource(data.interpolated ? "interpolated" : "catalog")
        const mid = applyOptimizationMode({
          ...range,
          VcMin: data.ranges.VcMin, VcMax: data.ranges.VcMax,
          fzMin: data.ranges.fzMin || range.fzMin, fzMax: data.ranges.fzMax || range.fzMax,
        }, mode)
        setVc(Math.round(mid.Vc)); setFz(parseFloat(mid.fz.toFixed(4)))
        setSpeedPct(0); setFeedPct(0)
      } else setDataSource("default")

      void fetch(`/api/simulator/edp?series=${encodeURIComponent(series)}`)
        .then(r => r.ok ? r.json() : null).then(j => setRealEdp(j?.edp ?? null))
        .catch(() => setRealEdp(null))
    } catch { setDataSource("default") } finally { setIsLoading(false) }
  }, [productCode, diameter, isoGroup, workpiece, hardnessValue, cuttingType, toolShape, mode, range])

  useEffect(() => {
    if (!productCode.trim() || !catalogData) return
    fetchCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoGroup, workpiece, hardnessValue, cuttingType, toolShape])

  useEffect(() => {
    const vals = applyOptimizationMode(range, mode)
    setVc(Math.round(vals.Vc)); setFz(parseFloat(vals.fz.toFixed(4)))
    setSpeedPct(0); setFeedPct(0)
  }, [mode, range])

  useEffect(() => { if (initialProduct) fetchCatalog() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── URL state hydration (on mount) ──
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URL(window.location.href).searchParams
    if (params.toString() && !urlHydrated) {
      const s = queryToState(params)
      if (s.productCode) setProductCode(s.productCode)
      if (s.diameter != null) setDiameter(s.diameter)
      if (s.fluteCount != null) setFluteCount(s.fluteCount)
      if (s.activeShape) setActiveShape(s.activeShape as Exclude<EndmillShape, "all">)
      if (s.LOC != null) setLOC(s.LOC)
      if (s.OAL != null) setOAL(s.OAL)
      if (s.shankDia != null) setShankDia(s.shankDia)
      if (s.cornerR != null) setCornerR(s.cornerR)
      if (s.toolMaterial) setToolMaterial(s.toolMaterial)
      if (s.isoGroup) setIsoGroup(s.isoGroup)
      if (s.subgroupKey) setSubgroupKey(s.subgroupKey)
      if (s.condition) setCondition(s.condition)
      if (s.hardnessScale) setHardnessScale(s.hardnessScale as HardnessScale)
      if (s.hardnessValue != null) setHardnessValue(s.hardnessValue)
      if (s.operation) setOperation(s.operation)
      if (s.toolPath) setToolPath(s.toolPath)
      if (s.spindleKey) setSpindleKey(s.spindleKey)
      if (s.holderKey) setHolderKey(s.holderKey)
      if (s.workholding != null) setWorkholding(s.workholding)
      if (s.stickoutMm != null) { setStickoutMm(s.stickoutMm); setStickoutManual(true) }
      if (s.Vc != null) setVc(s.Vc)
      if (s.fz != null) setFz(s.fz)
      if (s.ap != null) setAp(s.ap)
      if (s.ae != null) setAe(s.ae)
      if (s.speedPct != null) setSpeedPct(s.speedPct)
      if (s.feedPct != null) setFeedPct(s.feedPct)
      if (s.mode) setMode(s.mode as OptimizationMode)
      if (s.displayUnit) setDisplayUnit(s.displayUnit as DisplayUnit)
    }
    setUrlHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── URL state sync (debounced) ──
  useEffect(() => {
    if (!urlHydrated || typeof window === "undefined") return
    const t = setTimeout(() => {
      const state: SerializableState = {
        productCode, diameter, fluteCount, activeShape, LOC, OAL, shankDia, cornerR, toolMaterial,
        isoGroup, subgroupKey, condition, hardnessScale, hardnessValue,
        operation, toolPath, spindleKey, holderKey, workholding, stickoutMm,
        Vc, fz, ap, ae, speedPct, feedPct, mode, displayUnit,
      }
      const qs = stateToQuery(state)
      const url = new URL(window.location.href)
      url.search = qs
      window.history.replaceState({}, "", url.toString())
    }, 500)
    return () => clearTimeout(t)
  }, [urlHydrated, productCode, diameter, fluteCount, activeShape, LOC, OAL, shankDia, cornerR, toolMaterial,
      isoGroup, subgroupKey, condition, hardnessScale, hardnessValue,
      operation, toolPath, spindleKey, holderKey, workholding, stickoutMm,
      Vc, fz, ap, ae, speedPct, feedPct, mode, displayUnit])

  const applyExample = useCallback((ex: EndmillExample) => {
    setEverInteracted(true)
    setProductCode(ex.series); setRealEdp(null)
    setIsoGroup(ex.iso); setDiameter(ex.diameter); setFluteCount(ex.flutes); setActiveShape(ex.shape)
    setLOC(ex.LOC); setOAL(ex.OAL); setShankDia(ex.shank)
    if (ex.cornerR != null) setCornerR(ex.cornerR)
    setWorkpiece(""); setCuttingType(""); setToolShape("")
    setVc(Math.round(ex.repCondition.Vc)); setFz(ex.repCondition.fz)
    setAp(ex.repCondition.ap); setAe(ex.repCondition.ae)
    setSpeedPct(0); setFeedPct(0)
    setTimeout(() => {
      void (async () => {
        setIsLoading(true)
        try {
          const [catRes, edpRes] = await Promise.all([
            fetch(`/api/simulator?series=${encodeURIComponent(ex.series)}&diameter=${ex.diameter}&material=${ex.iso}`),
            fetch(`/api/simulator/edp?series=${encodeURIComponent(ex.series)}`),
          ])
          if (catRes.ok) {
            const data: SimulatorApiResponse = await catRes.json()
            setCatalogData(data)
            setDataSource(data.found ? (data.interpolated ? "interpolated" : "catalog") : "default")
          }
          if (edpRes.ok) { const j = await edpRes.json(); setRealEdp(j?.edp ?? null) }
        } catch { setDataSource("default") } finally { setIsLoading(false) }
      })()
    }, 0)
  }, [])

  const visibleExamples = useMemo(() => {
    if (endmillShape === "all") return ENDMILL_EXAMPLES
    return ENDMILL_EXAMPLES.filter(ex => ex.shape === endmillShape)
  }, [endmillShape])

  const activeSubgroups = useMemo(() => MATERIAL_SUBGROUPS.filter(m => m.iso === isoGroup), [isoGroup])
  const currentSubgroup = MATERIAL_SUBGROUPS.find(m => m.key === subgroupKey)

  // Active filter count (non-default values)
  const activeFilterCount = useMemo(() => {
    let n = 0
    if (productCode.trim()) n++
    if (isoGroup !== "P") n++
    if (subgroupKey) n++
    if (condition) n++
    if (workpiece) n++
    if (cuttingType) n++
    if (toolShape) n++
    if (toolPath !== "conventional") n++
    return n
  }, [productCode, isoGroup, subgroupKey, condition, workpiece, cuttingType, toolShape, toolPath])

  const clearFilters = () => {
    setProductCode(""); setRealEdp(null); setSubgroupKey(""); setCondition("")
    setWorkpiece(""); setCuttingType(""); setToolShape(""); setToolPath("conventional")
    setCatalogData(null); setDataSource("default"); setEverInteracted(false)
  }

  const resetTool = () => {
    setDiameter(10); setFluteCount(4); setActiveShape("square")
    setLOC(25); setOAL(75); setShankDia(10); setCornerR(0.5); setToolMaterial("carbide")
  }
  const resetMaterial = () => {
    setIsoGroup("P"); setSubgroupKey(""); setCondition(""); setHardnessScale("HRC"); setHardnessValue(30)
    setWorkpiece("")
  }
  const resetMachine = () => {
    setSpindleKey("vmc-std"); setHolderKey("er-collet"); setWorkholding(65)
  }
  const resetParameters = () => {
    const vals = applyOptimizationMode(range, mode)
    setVc(Math.round(vals.Vc)); setFz(parseFloat(vals.fz.toFixed(4)))
    setAp(diameter); setAe(diameter / 2); setStickoutMm(diameter * DEFAULT_STICKOUT_RATIO)
    setStickoutManual(false); setSpeedPct(0); setFeedPct(0); setApLocked(false); setAeLocked(false)
  }

  const jumpToResults = () => {
    resultsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const printPdf = async () => {
    if (typeof window === "undefined") return
    const target = reportAreaRef.current
    if (!target) { window.print(); return }
    try {
      const [{ jsPDF }, h2c] = await Promise.all([import("jspdf"), import("html2canvas")])
      const canvas = await h2c.default(target, { scale: 2, backgroundColor: darkMode ? "#0f172a" : "#ffffff", logging: false })
      const pdf = new jsPDF("p", "mm", "a4")
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH = (canvas.height / canvas.width) * pageW
      if (imgH < pageH) {
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageW, imgH)
      } else {
        let y = 0
        const ratio = pageW / canvas.width
        while (y < canvas.height) {
          const sliceH = Math.min(pageH / ratio, canvas.height - y)
          const slice = document.createElement("canvas")
          slice.width = canvas.width; slice.height = sliceH
          slice.getContext("2d")?.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
          if (y > 0) pdf.addPage()
          pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, pageW, sliceH * ratio)
          y += sliceH
        }
      }
      pdf.save(`YG1-sim-${productCode || "report"}-${Date.now()}.pdf`)
    } catch {
      window.print()
    }
  }

  // Share current URL
  const shareUrl = async () => {
    if (typeof window === "undefined") return
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareToast("링크 복사됨")
      setTimeout(() => setShareToast(null), 2000)
    } catch {
      setShareToast("복사 실패 — 주소창에서 직접 복사")
      setTimeout(() => setShareToast(null), 3000)
    }
  }

  // Snapshot for A/B compare
  const makeSnapshot = (label: string): SnapshotSummary => ({
    label, Vc: VcEff, fz: fzEff, ap, ae,
    n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc,
    torque: advanced.torque, deflection: advanced.deflection,
  })
  const saveA = () => setSnapshotA(makeSnapshot(productCode || "조건 A"))
  const saveB = () => setSnapshotB(makeSnapshot(productCode || "조건 B"))
  const clearAB = () => { setSnapshotA(null); setSnapshotB(null) }

  const showStarter = !everInteracted && !catalogData && !productCode.trim()

  const rootClass = darkMode
    ? "space-y-5 print:space-y-3 bg-slate-900 text-slate-100 -mx-4 px-4 py-3 rounded-lg"
    : "space-y-5 print:space-y-3"

  return (
    <div ref={reportAreaRef} className={rootClass}>
      {/* ───── Top bar ───── */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          {/* Tool Groups 상위 네비 */}
          <div className={`rounded-xl border p-1 inline-flex ${darkMode ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"}`}>
            {TOOL_GROUPS.map(g => {
              const active = toolGroup === g.key
              if (!g.enabled) {
                return (
                  <div key={g.key} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs cursor-not-allowed select-none ${darkMode ? "text-slate-600" : "text-gray-300"}`} title="준비 중">
                    <Lock className="h-3 w-3" />{g.label}
                  </div>
                )
              }
              return (
                <button key={g.key} onClick={() => setToolGroup(g.key)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg transition-all ${active ? "bg-blue-600 text-white font-semibold" : darkMode ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-50"}`}>
                  {g.label}
                </button>
              )
            })}
          </div>

          {/* Active filter badge */}
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs">
            <span className="text-gray-600">Active:</span>
            <span className="font-bold text-blue-700">{activeFilterCount}</span>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="ml-1 text-[10px] text-gray-500 hover:text-red-600 underline">Clear</button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Units toggle */}
          <div className="rounded-lg border border-gray-200 bg-white p-0.5 inline-flex text-xs">
            {(["metric", "inch", "both"] as const).map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={`px-2.5 py-1 rounded-md transition-all ${displayUnit === u ? "bg-blue-600 text-white font-semibold" : "text-gray-600 hover:bg-gray-50"}`}>
                {u === "metric" ? "Metric" : u === "inch" ? "Inch" : "Both"}
              </button>
            ))}
          </div>
          <button onClick={jumpToResults}
            className="flex items-center gap-1 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700">
            <ArrowDownCircle className="h-3.5 w-3.5" /> Jump to Results
          </button>
          <button onClick={shareUrl}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            🔗 Share
          </button>
          <button onClick={saveA}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${snapshotA ? "border-emerald-400 bg-emerald-50 text-emerald-700" : darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            💾 A
          </button>
          <button onClick={saveB}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${snapshotB ? "border-indigo-400 bg-indigo-50 text-indigo-700" : darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            💾 B
          </button>
          <button onClick={printPdf}
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
          <button onClick={() => setAutoCorrelate(!autoCorrelate)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${autoCorrelate ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"}`}
            title="변수 상관관계 자동 적용 on/off">
            🔗 Link {autoCorrelate ? "ON" : "OFF"}
          </button>
          <button onClick={() => setDarkMode(!darkMode)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${darkMode ? "border-yellow-400 bg-yellow-50 text-yellow-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            {darkMode ? "☀" : "🌙"}
          </button>
        </div>
      </div>

      {/* 상관관계 라이브 스트립 — 현재 적용되는 multiplier 투명하게 공개 */}
      {autoCorrelate && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/40 px-3 py-2 flex flex-wrap gap-2 text-[10px]">
          <span className="font-semibold text-purple-800">🔗 LIVE 상관관계:</span>
          <CorrChip label="Coolant" value={`×${coolantMult}`} active={coolantMult !== 1} />
          <CorrChip label="Coating" value={`×${coatingMult}`} active={coatingMult !== 1} />
          <CorrChip label="Hardness" value={`×${hardDerate.toFixed(2)}`} active={hardDerate !== 1} />
          <CorrChip label="Stickout" value={`Vc×${stickoutD.vc} fz×${stickoutD.fz}`} active={stickoutD.vc !== 1} />
          <CorrChip label="Workholding" value={`ap≤${whCap.apMax.toFixed(1)} ae≤${whCap.aeMax.toFixed(1)}`} active={true} />
          <CorrChip label="Climb" value={climb ? `Ra×0.8 F×0.9 Life×1.15` : `baseline`} active={climb} />
          <span className="ml-auto text-purple-700 font-mono">Vc_eff = {Vc.toFixed(0)} × {((1 + speedPct/100) * coolantMult * coatingMult * hardDerate * stickoutD.vc).toFixed(2)} = <b>{VcEff.toFixed(0)}</b> m/min</span>
        </div>
      )}

      {/* Toast */}
      {shareToast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm shadow-lg">
          {shareToast}
        </div>
      )}

      {/* Shape subfilter */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">엔드밀 형상</span>
        {ENDMILL_SHAPES.map(sh => {
          const active = endmillShape === sh.key
          return (
            <button key={sh.key} onClick={() => setEndmillShape(sh.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${active ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
              {sh.label}
            </button>
          )
        })}
      </div>

      {/* Starter cards (empty state) */}
      {showStarter && (
        <div className="rounded-xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50/50 to-white p-5">
          <div className="mb-3">
            <div className="text-sm font-bold text-gray-900 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 text-amber-500" /> 시작하기</div>
            <div className="text-xs text-gray-500 mt-0.5">아래 3가지 방식 중 하나로 시뮬레이션 시작하세요.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StarterCard icon={<Search className="h-4 w-4" />} title="EDP / 시리즈로 찾기"
              desc="GNX98, SEM846001 같은 코드 직접 입력" onClick={() => document.getElementById("tool-search-input")?.focus()} />
            <StarterCard icon={<Ruler className="h-4 w-4" />} title="치수로 둘러보기"
              desc="⌀, LOC, Shank, CR 조합으로 공구 필터" onClick={() => setEverInteracted(true)} />
            <StarterCard icon={<LayoutGrid className="h-4 w-4" />} title="소재 ISO로 시작"
              desc="P / M / K / N / S / H 중 선택" onClick={() => setEverInteracted(true)} />
          </div>
        </div>
      )}

      {/* Examples */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
        <div className="text-[11px] font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
          ⚡ 예시로 빠르게 시작 · {visibleExamples.length}개
        </div>
        {visibleExamples.length === 0 ? (
          <div className="text-[11px] text-gray-500 px-2 py-3">해당 형상 예시 준비 중</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {visibleExamples.map(ex => (
              <button key={ex.edp} onClick={() => applyExample(ex)}
                className="text-left rounded-lg border border-blue-200 bg-white px-3 py-2.5 hover:border-blue-400 hover:shadow-sm transition-all">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{ex.brand}</span>
                  <span className="text-xs font-mono font-bold text-gray-900">{ex.series}</span>
                  <span className="text-[9px] font-mono text-gray-400">EDP {ex.edp}</span>
                </div>
                <div className="text-[11px] text-gray-800 font-medium">{ex.label}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{ex.hint} · ⌀{ex.diameter}mm · ISO {ex.iso}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="text-[9px] font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Vc {ex.repCondition.Vc}</span>
                  <span className="text-[9px] font-mono bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">fz {ex.repCondition.fz}</span>
                  <span className="text-[9px] font-mono bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">ap {ex.repCondition.ap}</span>
                  <span className="text-[9px] font-mono bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded">ae {ex.repCondition.ae}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tool Recommender — DB 연동 */}
      <ToolRecommender
        iso={isoGroup} diameter={diameter} shape={activeShape}
        hardness={hardnessScale === "HRC" ? String(hardnessValue) : undefined}
        onPick={(series, closestD) => {
          setProductCode(series)
          if (closestD != null) setDiameter(closestD)
          setEverInteracted(true)
          // Trigger fetch
          setTimeout(() => fetchCatalog(), 50)
        }}
      />

      {/* ══════ 독립인자 ══════ */}
      <SectionHeader icon={<Sliders className="h-4 w-4" />} title="독립인자" subtitle="사용자가 직접 설정하는 입력값" tone="blue" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* ─ TOOL ─ */}
        <CardShell title="TOOL" icon={<Wrench className="h-3.5 w-3.5" />} onReset={resetTool} eduId="cutter-diameter" eduSection="tool">
          <div className="flex gap-1.5">
            <input id="tool-search-input" className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs placeholder:text-gray-400 focus:border-blue-400 focus:outline-none font-mono"
              placeholder="시리즈 / EDP" value={productCode}
              onChange={e => setProductCode(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchCatalog()} />
            <button onClick={fetchCatalog} disabled={isLoading || !productCode.trim()}
              className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
              {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </button>
          </div>
          {realEdp && <div className="text-[10px] font-mono text-blue-700 bg-blue-50 px-2 py-1 rounded">EDP: {realEdp}</div>}

          <DimRow unit={displayUnit} label="Dia" value={diameter} onChange={setDiameter} min={0.1} max={50} step={0.1} />
          <DimRow unit={displayUnit} label="LOC" value={LOC} onChange={setLOC} min={0.5} max={200} step={0.5} />
          <DimRow unit={displayUnit} label="Shank" value={shankDia} onChange={setShankDia} min={0.5} max={50} step={0.1} />
          <DimRow unit={displayUnit} label="OAL" value={OAL} onChange={setOAL} min={5} max={300} step={1} />
          {activeShape === "radius" && (
            <DimRow unit={displayUnit} label="CR" value={cornerR} onChange={setCornerR} min={0.05} max={5} step={0.05} />
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <MiniSelect label="Flutes" value={String(fluteCount)} onChange={v => setFluteCount(parseInt(v))}
              options={[1,2,3,4,5,6].map(n => ({ value: String(n), label: `${n}날` }))} />
            <MiniSelect label="재질" value={toolMaterial} onChange={setToolMaterial}
              options={TOOL_MATERIALS.map(m => ({ value: m.key, label: m.label }))} />
          </div>

          <div>
            <label className="text-[10px] text-gray-500">형상</label>
            <div className="grid grid-cols-4 gap-1">
              {(["square","ball","radius","chamfer"] as const).map(sh => (
                <button key={sh} onClick={() => setActiveShape(sh)}
                  className={`rounded border px-1 py-1 text-[10px] transition-all ${activeShape === sh ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
                  {sh === "square" ? "Sq" : sh === "ball" ? "Ball" : sh === "radius" ? "R" : "Ch"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-center pt-1">
            <ToolSilhouette shape={activeShape} D={diameter} LOC={LOC} OAL={OAL} shank={shankDia}
              CR={cornerR} className="w-full h-36" />
          </div>

          {/* Harvey 스타일 풀스펙 테이블 */}
          <div className="rounded border border-gray-200 bg-gray-50/50 p-2 text-[10px] space-y-0.5">
            <div className="font-bold text-gray-700 mb-1">Tool details</div>
            <ToolSpecRow k="Brand" v="YG-1" />
            <ToolSpecRow k="Tool #" v={realEdp || productCode || "—"} />
            <ToolSpecRow k="Type" v={`${activeShape === "square" ? "Square" : activeShape === "ball" ? "Ball Nose" : activeShape === "radius" ? "Corner Radius" : "Chamfer"} End Mill · ${fluteCount} Flute`} />
            <ToolSpecRow k="Units" v={displayUnit === "inch" ? "Inches" : displayUnit === "both" ? "Inch + Metric" : "Metric (mm)"} />
            <ToolSpecRow k="Cutter Diameter" v={`${diameter.toFixed(3)}mm (${UNITS.mmToIn(diameter).toFixed(4)}")`} />
            <ToolSpecRow k="Length of Cut" v={`${LOC.toFixed(2)}mm (${UNITS.mmToIn(LOC).toFixed(4)}")`} />
            <ToolSpecRow k="Shank Diameter" v={`${shankDia.toFixed(2)}mm (${UNITS.mmToIn(shankDia).toFixed(4)}")`} />
            <ToolSpecRow k="Overall Length" v={`${OAL.toFixed(1)}mm (${UNITS.mmToIn(OAL).toFixed(3)}")`} />
            {activeShape === "radius" && <ToolSpecRow k="Corner Radius" v={`${cornerR.toFixed(2)}mm (${UNITS.mmToIn(cornerR).toFixed(4)}")`} />}
            <ToolSpecRow k="Flutes" v={String(fluteCount)} />
            <ToolSpecRow k="Coating" v={COATINGS.find(c => c.key === coating)?.label ?? "-"} />
            <ToolSpecRow k="Profile" v={activeShape.charAt(0).toUpperCase() + activeShape.slice(1)} />
          </div>

          {dataSource !== "default" && (
            <div className={`rounded px-2 py-1 text-[10px] font-medium ${dataSource === "catalog" ? "bg-green-50 text-green-700 border border-green-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
              {dataSource === "catalog" ? "✓ 카탈로그 기반" : "⚠ 보간 근사"}
            </div>
          )}
        </CardShell>

        {/* ─ MATERIAL ─ */}
        <CardShell title="MATERIAL" icon={<span className="text-[12px]">🧱</span>} onReset={resetMaterial} eduId="iso-p" eduSection="material">
          <div className="grid grid-cols-3 gap-1">
            {Object.entries(ISO_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => { setIsoGroup(key); setSubgroupKey("") }}
                className={`rounded border px-1 py-1.5 text-center transition-all ${isoGroup === key ? "border-blue-500 bg-blue-50 font-bold" : "border-gray-200 hover:border-gray-300"}`}>
                <div className={`text-sm font-bold ${isoGroup === key ? "text-blue-700" : "text-gray-500"}`}>{key}</div>
                <div className={`text-[8px] ${isoGroup === key ? "text-blue-600" : "text-gray-400"}`}>{label.split("(")[0].trim()}</div>
              </button>
            ))}
          </div>
          <MiniSelect label="Subgroup" value={subgroupKey} onChange={setSubgroupKey}
            options={[{ value: "", label: "— 선택 —" }, ...activeSubgroups.map(s => ({ value: s.key, label: s.label }))]} />
          {currentSubgroup && currentSubgroup.conditions.length > 0 && (
            <MiniSelect label="Condition" value={condition} onChange={setCondition}
              options={currentSubgroup.conditions.map(c => ({ value: c, label: c }))} />
          )}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-gray-500">경도</label>
              <div className="flex gap-0.5">
                {(["HRC","HBW","HRB","HBS"] as HardnessScale[]).map(sc => (
                  <button key={sc} onClick={() => {
                    const newVal = convertHardness(hardnessValue, hardnessScale, sc)
                    setHardnessScale(sc); setHardnessValue(newVal)
                  }}
                    className={`text-[9px] px-1.5 py-0.5 rounded ${hardnessScale === sc ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>{sc}</button>
                ))}
              </div>
            </div>
            <input type="number" value={hardnessValue}
              onChange={e => setHardnessValue(parseFloat(e.target.value) || 0)}
              min={0} max={hardnessScale === "HBW" ? 700 : 100}
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono" />
          </div>
          {catalogData?.facets && catalogData.facets.workpieces.length > 0 && (
            <MiniSelect label={`세부소재 (${catalogData.facets.workpieces.length})`} value={workpiece} onChange={setWorkpiece}
              options={[{ value: "", label: "전체" }, ...catalogData.facets.workpieces.map(w => ({ value: w, label: w }))]} />
          )}
          <div className="text-[9px] text-gray-400">kc = {KC_TABLE[isoGroup] ?? 2000} N/mm²</div>
        </CardShell>

        {/* ─ OPERATION ─ */}
        <CardShell title="OPERATION" icon={<span className="text-[12px]">📐</span>} onReset={() => { setOperation("Side_Milling"); setToolPath("conventional") }} eduId="hem" eduSection="operation">
          <MiniSelect label="Type" value={operation} onChange={setOperation} options={[
            { value: "Side_Milling", label: "Side Milling 측면" },
            { value: "Slotting", label: "Slotting 슬롯" },
            { value: "Profiling", label: "Profiling 윤곽" },
            { value: "Facing", label: "Facing 정면" },
            { value: "Pocketing", label: "Pocketing 포켓" },
          ]} />
          <MiniSelect label="Tool Path" value={toolPath} onChange={v => { setToolPath(v); setStrategy("") }}
            options={TOOL_PATHS.map(tp => ({ value: tp.key, label: tp.label }))} />
          {STRATEGY_OPTIONS[toolPath] && (
            <MiniSelect label="Strategy (MAP 2.0)" value={strategy} onChange={setStrategy}
              options={[{ value: "", label: "— 기본 —" }, ...STRATEGY_OPTIONS[toolPath]]} />
          )}
          <div>
            <label className="text-[10px] text-gray-500">절삭 방향</label>
            <div className="flex rounded border border-gray-200 overflow-hidden">
              <button onClick={() => setClimb(true)}
                className={`flex-1 py-1 text-[10px] font-medium ${climb ? "bg-emerald-600 text-white" : "bg-white text-gray-600"}`}>
                ↘ Climb (다운컷)
              </button>
              <button onClick={() => setClimb(false)}
                className={`flex-1 py-1 text-[10px] font-medium ${!climb ? "bg-gray-600 text-white" : "bg-white text-gray-600"}`}>
                ↖ Conv (업컷)
              </button>
            </div>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 p-2 text-[10px] text-gray-600 min-h-[60px] flex items-start gap-2">
            <ToolPathDiagram pathKey={toolPath} className="w-12 h-12 flex-shrink-0 text-blue-600" />
            <div className="flex-1">
              <div className="font-semibold text-gray-700 mb-0.5 flex items-center gap-1">
                <Info className="h-2.5 w-2.5" /> Tool Path
                <button onClick={() => setToolPathModalOpen(true)}
                  className="ml-auto text-[9px] text-blue-600 hover:text-blue-800 underline">
                  모든 경로 보기 →
                </button>
              </div>
              {TOOL_PATHS.find(t => t.key === toolPath)?.hint ?? "—"}
            </div>
          </div>
          <ToolPathInfoModal
            open={toolPathModalOpen}
            onClose={() => setToolPathModalOpen(false)}
            currentPath={toolPath}
            onSelectPath={(p) => { setToolPath(p); setStrategy(""); setToolPathModalOpen(false) }}
          />
          <div>
            <label className="text-[10px] text-gray-500">최적화 모드</label>
            <div className="flex rounded border border-gray-200 overflow-hidden">
              {([
                { value: "productivity" as const, label: "생산", icon: Zap },
                { value: "balanced" as const, label: "균형", icon: Gauge },
                { value: "toollife" as const, label: "수명", icon: Shield },
              ]).map(({ value, label, icon: Icon }) => (
                <button key={value} onClick={() => setMode(value)}
                  className={`flex-1 flex items-center justify-center gap-0.5 py-1 text-[10px] font-medium transition-all ${mode === value ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                  <Icon className="h-2.5 w-2.5" />{label}
                </button>
              ))}
            </div>
          </div>
        </CardShell>

        {/* ─ MACHINE ─ */}
        <CardShell title="MACHINE" icon={<Cog className="h-3.5 w-3.5" />} onReset={resetMachine} eduId="workholding-security" eduSection="machine">
          <MiniSelect label="Spindle" value={spindleKey} onChange={setSpindleKey}
            options={SPINDLE_PRESETS.map(s => ({ value: s.key, label: s.label }))} />
          <MiniSelect label="Holder" value={holderKey} onChange={setHolderKey}
            options={HOLDER_PRESETS.map(h => ({ value: h.key, label: `${h.label} (${h.rigidity}%)` }))} />
          <div className="grid grid-cols-3 gap-1.5">
            <NumInputSmall label="MAX RPM" value={maxRpm} onChange={setMaxRpm} />
            <NumInputSmall label="MAX IPM" value={maxIpm} onChange={setMaxIpm} />
            <NumInputSmall label="MAX kW" value={maxKw} onChange={setMaxKw} />
          </div>
          <WorkholdingSlider
            value={workholding}
            onChange={setWorkholding}
            D={diameter}
            currentAp={ap}
            currentAe={ae}
          />
          <MiniSelect label="Coolant 💧" value={coolant} onChange={setCoolant}
            options={COOLANTS.map(c => ({ value: c.key, label: c.label }))} />
          <MiniSelect label="Coating ✨" value={coating} onChange={setCoating}
            options={COATINGS.map(c => ({ value: c.key, label: `${c.label} ×${c.vcMultiplier}` }))} />
          <div className="text-[9px] text-gray-400">
            Vc 보정 = coolant ×{coolantMult} · coating ×{coatingMult}
          </div>
        </CardShell>
      </div>

      {/* ══════ PARAMETERS ══════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4" /> PARAMETERS
          </h3>
          <button onClick={resetParameters} className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-red-600">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Sliders with % */}
          <div className="space-y-3 md:col-span-2">
            <PctSlider label="Stick Out L" unit="mm" value={stickoutMm} pct={(stickoutMm / diameter) * 100} pctLabel="·D"
              min={3} max={diameter * 10} step={0.5}
              onChange={v => { setStickoutMm(v); setStickoutManual(true) }}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(stickoutMm), unit: "in", decimals: 3 } : undefined}
              eduId="stick-out" />
            <PctSlider eduId="vc" label="Vc (절삭속도)" unit="m/min" value={Vc} pct={speedPct}
              min={Math.round(range.VcMin)} max={Math.round(range.VcMax)} step={1}
              onChange={v => setVc(Math.round(v))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mPerMinToSFM(Vc), unit: "SFM", decimals: 0 } : undefined} />
            <PctSlider eduId="fz" label="fz (날당이송)" unit="mm/t" value={fz} pct={feedPct}
              min={range.fzMin} max={range.fzMax} step={0.001} decimals={4}
              onChange={v => setFz(parseFloat(v.toFixed(4)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(fz), unit: "in/t", decimals: 5 } : undefined} />
            <PctSlider eduId="adoc" label="ap (축방향 절입)" unit="mm" value={ap} pct={(ap / diameter) * 100} pctLabel="·D"
              locked={apLocked} onLockToggle={() => setApLocked(!apLocked)}
              min={0.1} max={range.apMax} step={0.1} decimals={1}
              onChange={v => !apLocked && setAp(parseFloat(v.toFixed(1)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(ap), unit: "in", decimals: 3 } : undefined} />
            <PctSlider eduId="rdoc" label="ae (경방향 절입)" unit="mm" value={ae} pct={(ae / diameter) * 100} pctLabel="·D"
              locked={aeLocked} onLockToggle={() => setAeLocked(!aeLocked)}
              min={0.1} max={range.aeMax} step={0.1} decimals={1}
              onChange={v => !aeLocked && setAe(parseFloat(v.toFixed(1)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(ae), unit: "in", decimals: 3 } : undefined} />
          </div>

          {/* 2D ADOC/RDOC adjuster + Engagement circle + Cutting Action */}
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <ADOCRDOCAdjuster
                apPct={Math.min(100, (ap / diameter) * 100)}
                aePct={Math.min(100, (ae / diameter) * 100)}
                onChange={(apP, aeP) => {
                  if (!apLocked) setAp(parseFloat(((apP / 100) * diameter).toFixed(1)))
                  if (!aeLocked) setAe(parseFloat(((aeP / 100) * diameter).toFixed(1)))
                }}
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50/50 p-2">
                <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Engagement</div>
                <EngagementCircle ae={ae} D={diameter} className="w-full h-16" />
              </div>
              <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50/50 p-2">
                <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Cutting Action</div>
                <CuttingAction shape={activeShape} D={diameter} LOC={LOC} ap={ap} ae={ae}
                  toolPath={toolPath} className="w-full" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ══════ Recommended vs Your ══════ */}
      {catalogRecommended && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
          <h4 className="text-xs font-bold text-emerald-800 mb-2 flex items-center gap-1.5">
            📊 Recommended vs Your (카탈로그 대비 현재값)
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <RvYRow label="Vc" rec={catalogRecommended.Vc} your={VcEff} unit="m/min" decimals={0} />
            <RvYRow label="fz" rec={catalogRecommended.fz} your={fzEff} unit="mm/t" decimals={4} />
            <RvYRow label="ap/D" rec={activeShape === "square" ? 1.0 : 0.5} your={ap / diameter} unit="×D" decimals={2} />
            <RvYRow label="ae/D" rec={activeShape === "square" ? 0.3 : 0.2} your={ae / diameter} unit="×D" decimals={2} />
          </div>
        </div>
      )}

      {/* ══════ Corner Adjustment ══════ */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
        <h4 className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1.5">
          ↪ Corner Adjustment (코너 진입 이송 감속)
        </h4>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
          <div>
            <input type="range" min={0} max={70} step={5} value={cornerReductionPct}
              onChange={e => setCornerReductionPct(parseInt(e.target.value))}
              className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-600" />
            <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
              <span>감속 없음</span><span>70% 감속</span>
            </div>
          </div>
          <div className="text-right min-w-[120px]">
            <div className="text-[10px] text-gray-500">코너 진입 시</div>
            <div className="text-sm font-mono font-bold text-amber-700">Vf → {Math.round(result.Vf * (1 - cornerReductionPct / 100)).toLocaleString()} mm/min</div>
            <div className="text-[9px] text-gray-500">(-{cornerReductionPct}%)</div>
          </div>
        </div>
      </div>

      {/* ══════ Speed/Feed ±% (Harvey sig) ══════ */}
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
          <Gauge className="h-4 w-4 text-indigo-600" /> RECOMMENDATIONS 조정 (±20%)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PercentTuner label="SPEED" pct={speedPct} onChange={setSpeedPct}
            positiveLabel="Increased Production" negativeLabel="Increased Tool Life"
            effective={`Vc ${VcEff.toFixed(0)} m/min · ${Math.round(result.n).toLocaleString()} rpm`} />
          <PercentTuner label="FEED" pct={feedPct} onChange={setFeedPct}
            positiveLabel="Increased Production" negativeLabel="Less Tool Deflection"
            effective={`fz ${fzEff.toFixed(4)} mm/t · Vf ${result.Vf.toLocaleString()} mm/min`} />
        </div>
      </div>

      {/* ══════ 종속인자 ══════ */}
      <SectionHeader icon={<ChevronRight className="h-4 w-4" />} title="종속인자" subtitle="입력으로부터 계산된 중간 변수" tone="violet" />
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        <MetricCard eduId="n" label="RPM (n)" value={result.n.toLocaleString()} unit="rpm" sub={derived.Deff !== diameter ? `D_eff ${derived.Deff}mm` : undefined} accent={derived.Deff !== diameter ? "volatile" : "neutral"} />
        <MetricCard eduId="vf" label="Vf / IPM" value={result.Vf.toLocaleString()} unit="mm/min" sub={`${vfIpm.toFixed(1)} IPM`} accent="neutral" />
        <MetricCard eduId="sfm" label="Surface Speed" value={VcEff.toFixed(0)} unit="m/min" sub={`${UNITS.mPerMinToSFM(VcEff).toFixed(0)} SFM`} accent="neutral" />
        <MetricCard eduId="hex-chip-thickness" label="Chip Thickness" value={derived.hex.toFixed(4)} unit="mm (hex)" sub={`RCTF ${derived.RCTF}`} accent={derived.RCTF < 1 ? "warning" : "neutral"} />
        <MetricCard eduId="engagement-angle" label="Engagement" value={derived.engagementDeg.toFixed(0)} unit="°" sub={`ae/D ${((ae/diameter)*100).toFixed(0)}%`} accent="neutral" />
        <MetricCard eduId="d-eff" label="Vc (effective)" value={derived.VcActual.toFixed(0)} unit="m/min" sub={activeShape === "ball" && derived.Deff !== diameter ? `ball D_eff` : undefined} accent={activeShape === "ball" && derived.Deff !== diameter ? "volatile" : "neutral"} />
      </div>

      {(derived.RCTF < 1 || (derived.Deff !== diameter && activeShape === "ball")) && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-xs text-violet-900 space-y-1.5">
          {derived.RCTF < 1 && (
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-violet-700" />
              <span><b>Chip thinning</b>: ae/D={(ae/diameter).toFixed(2)} &lt; 0.5 → 실 chip load가 fz의 {Math.round(derived.RCTF*100)}%. hex 유지하려면 fz를 <b>{derived.fzCompensated.toFixed(4)} mm/t</b> 권장.</span>
            </div>
          )}
          {derived.Deff !== diameter && activeShape === "ball" && (
            <div className="flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-violet-700" />
              <span><b>Ball-nose D_eff</b>: ap={ap}mm에서 실제 절삭 지름 D_eff={derived.Deff}mm. 실 Vc={derived.VcActual} m/min.</span>
            </div>
          )}
        </div>
      )}

      {/* ══════ 결과인자 ══════ */}
      <div ref={resultsAnchorRef} />
      <SectionHeader icon={<BarChart3 className="h-4 w-4" />} title="결과인자" subtitle="최종 가공 성능 지표" tone="emerald" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <ResultCard eduId="mrr" label="MRR" value={result.MRR.toLocaleString()} unit="cm³/min" sub={displayUnit !== "metric" ? `${(result.MRR * 0.06102).toFixed(1)} in³/min` : undefined} color="amber" />
        <ResultCard eduId="pc-power" label="Pc (파워)" value={result.Pc.toString()} unit="kW" sub={displayUnit !== "metric" ? `${UNITS.kwToHp(result.Pc).toFixed(2)} HP` : undefined} color="red" />
        <ResultCard eduId="torque" label="Torque T" value={advanced.torque.toString()} unit="N·m" sub={displayUnit !== "metric" ? `${UNITS.nmToInLb(advanced.torque).toFixed(1)} in·lb` : undefined} color="blue" />
        <ResultCard eduId="fc-cutting-force" label="Cutting Force Fc" value={advanced.Fc.toLocaleString()} unit="N" color="green" />
        <ResultCard eduId="deflection" label="Tool Deflection δ" value={advanced.deflection.toString()} unit="μm"
          color={advanced.deflection > 50 ? "red" : advanced.deflection > 20 ? "amber" : "blue"} />
      </div>

      {/* 예상 결과 2열 — Life / Ra / Chatter / Cost */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard eduId="tool-life" label="Tool Life" value={toolLifeMin.toFixed(0)} unit="min" sub={`≈ ${(toolLifeMin / 60).toFixed(1)}h`}
          accent={toolLifeMin < 10 ? "warning" : "neutral"} />
        <MetricCard eduId="ra-roughness" label="Ra 표면거칠기" value={raUm.toFixed(2)} unit="μm 이론값"
          sub={raUm < 1.6 ? "미러급" : raUm < 3.2 ? "마감" : raUm < 6.3 ? "중간" : "거친가공"}
          accent={raUm > 6.3 ? "warning" : "neutral"} />
        <MetricCard eduId="chatter-risk" label="Chatter Risk" value={chatter.risk.toFixed(0)} unit={chatter.level.toUpperCase()}
          sub={chatter.reasons[0] ?? "안정"}
          accent={chatter.level === "high" ? "warning" : chatter.level === "med" ? "volatile" : "neutral"} />
        <MetricCard label="Cost / Part" value={cost.total.toLocaleString()} unit="원"
          sub={`공구 ${cost.toolCostPerPart.toLocaleString()} + 머신 ${cost.machineCostPerPart.toLocaleString()}`}
          accent="neutral" />
      </div>

      {/* Provenance — 이 값들이 어디서 왔는지 */}
      <ProvenancePanel
        Vc={VcEff}
        fz={fzEff}
        n={result.n}
        Vf={result.Vf}
        kc={KC_TABLE[isoGroup] ?? 2000}
        D={diameter}
        Z={fluteCount}
        baseline={speedsFeedsBaseline}
        coolantMult={coolantMult}
        coatingMult={coatingMult}
        hardnessMult={hardDerate}
        stickoutMult={stickoutD.vc}
        speedPct={speedPct}
        feedPct={feedPct}
      />

      {/* 🚀 차세대 기능 (초월 7기능) */}
      <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 via-purple-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 dark:border-indigo-800">
        <button onClick={() => setNextFeaturesOpen(!nextFeaturesOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors">
          <span className="text-sm font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
            🚀 차세대 기능 (MAP 초월)
            <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
              DEMO
            </span>
          </span>
          <span className={`text-xs text-slate-500 transition-transform ${nextFeaturesOpen ? "rotate-180" : ""}`}>▼</span>
        </button>
        {nextFeaturesOpen && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 p-4 space-y-6">
            {/* AI 코치 */}
            <AiCoachPanel
              state={{
                productCode, diameter, fluteCount, activeShape, LOC, OAL, shankDia, cornerR, toolMaterial,
                isoGroup, subgroupKey, condition, hardnessScale, hardnessValue,
                operation, toolPath, spindleKey, holderKey, maxRpm, maxKw, maxIpm, workholding,
                coolant, coating, stickoutMm, Vc, fz, ap, ae, speedPct, feedPct, climb,
              } as Record<string, unknown>}
              results={{
                n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc,
                Fc: advanced.Fc, torque: advanced.torque, deflection: advanced.deflection,
                toolLife: toolLifeMin, Ra: raUm,
                chatterRisk: `${chatter.risk}% (${chatter.level.toUpperCase()})`,
              }}
            />

            {/* Tool Life 3시나리오 비교 */}
            <ToolLifeScenario
              currentVc={VcEff}
              VcReference={VcReferenceVal}
              coatingMult={coatingMult}
              isoGroup={isoGroup}
              toolMaterialE={toolMatE}
              toolCostKrw={toolCostKrw}
              machineCostPerHourKrw={machineCostPerHourKrw}
              cycleTimeMin={cycleTimeMin}
              MRR={result.MRR}
              onApplyScenario={(newVc) => { setVc(Math.round(newVc)); setSpeedPct(0) }}
            />

            {/* 가공 애니메이션 */}
            <MachiningAnimation
              D={diameter} LOC={LOC} ap={ap} ae={ae}
              Vf={result.Vf} n={result.n} MRR={result.MRR}
              shape={activeShape} toolPath={toolPath}
            />

            {/* 히트맵 */}
            <HeatmapPanel
              currentAp={ap} currentAe={ae}
              D={diameter} Z={fluteCount}
              isoGroup={isoGroup}
              Vc={VcEff} fz={fzEff}
              maxKw={maxKw}
              onSpotClick={(newAp, newAe) => { setAp(newAp); setAe(newAe) }}
            />

            {/* 다중공구 비교 */}
            <MultiToolCompare
              isoGroup={isoGroup}
              ap={ap} ae={ae}
              operation={operation}
              onSelectTool={(series, D) => { setProductCode(series); setDiameter(D); setEverInteracted(true) }}
            />

            {/* MAP/SpeedLab 병렬 비교 */}
            <CompetitorLiveCompare
              ariaResults={{
                Vc: VcEff, fz: fzEff, n: result.n, Vf: result.Vf,
                MRR: result.MRR, SFM: UNITS.mPerMinToSFM(VcEff),
                IPM: UNITS.mmPerMinToIPM(result.Vf),
              }}
            />
          </div>
        )}
      </div>

      {/* 학습 모드 — 처음 방문자 자동 open */}
      <LearningMode autoOpen={false} />

      {/* [수식] 계산식 패널 */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <button onClick={() => setFormulaOpen(!formulaOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50">
          <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            📐 계산식 보기 (현재값 대입 상세)
          </span>
          <span className={`text-xs transition-transform ${formulaOpen ? "rotate-180" : ""}`}>▼</span>
        </button>
        {formulaOpen && (
          <div className="border-t border-slate-200 p-4 bg-slate-50/30">
            <FormulaPanel
              Vc={VcEff} fz={fzEff} ap={ap} ae={ae} D={diameter} Z={fluteCount}
              stickout={stickoutMm} kc={KC_TABLE[isoGroup] ?? 2000} eta={0.8}
              coatingMult={coatingMult} isHSS={toolMatE < 300}
              shape={activeShape} cornerR={cornerR} climb={climb}
              n={result.n} Vf={result.Vf} MRR={result.MRR} Pc={result.Pc}
              torque={advanced.torque} Fc={advanced.Fc} deflection={advanced.deflection}
              RCTF={derived.RCTF} Deff={derived.Deff}
              toolLife={toolLifeMin} Ra={raUm} VcRef={VcReferenceVal}
            />
          </div>
        )}
      </div>

      {/* 🎯 Harvey 도움말 · 진단 패널 */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <button onClick={() => setDiagnosticOpen(!diagnosticOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50">
          <span className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            🎯 Harvey 도메인 지식 · 진단 가이드 (칩색깔 · 소리 · 실수 TOP10 · SFM/IPT 표)
          </span>
          <span className={`text-xs transition-transform ${diagnosticOpen ? "rotate-180" : ""}`}>▼</span>
        </button>
        {diagnosticOpen && (
          <div className="border-t border-slate-200 p-4 space-y-5 bg-slate-50/30">
            {/* 코너 보정 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">📐 비선형 경로 코너 이송 보정</h5>
              <CornerFeedPanel baseFeed={result.Vf} toolDiameter={diameter} />
            </div>

            {/* SFM/IPT 대조표 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">📊 재질별 SFM/IPT 권장 출발값 (Harvey/Helical 기반)</h5>
              <SfmIptTable currentVc={VcEff} currentFz={fzEff} displayUnit={displayUnit} />
            </div>

            {/* 칩 색깔 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">🌡 칩 색깔로 보는 진단 (강 가공 기준)</h5>
              <ChipColorDiagnostic />
            </div>

            {/* 소리/진동 증상 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">📢 소리 · 진동 · 표면 증상 매트릭스</h5>
              <SymptomMatrix />
            </div>

            {/* 실수 TOP 10 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">⚠ 자주 하는 실수 TOP 10</h5>
              <CommonMistakes />
            </div>
          </div>
        )}
      </div>

      {/* Cost & GCode Advanced Panel */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <button onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
          <span className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            ⚙ Advanced (단가·GCode·Chatter 상세)
          </span>
          <span className={`text-xs transition-transform ${advancedOpen ? "rotate-180" : ""}`}>▼</span>
        </button>
        {advancedOpen && (
          <div className="border-t border-gray-200 p-4 space-y-4">
            {/* Cost inputs */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-2">💰 단가 분석 입력</h5>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <NumInputSmall label="공구 단가 (원)" value={toolCostKrw} onChange={setToolCostKrw} />
                <NumInputSmall label="머신 시간당 (원/h)" value={machineCostPerHourKrw} onChange={setMachineCostPerHourKrw} />
                <NumInputSmall label="사이클 타임 (분/파트)" value={cycleTimeMin} onChange={setCycleTimeMin} />
              </div>
              <div className="text-[10px] text-gray-500 mt-2">
                공구당 파트 수: <b>{cost.partsPerTool}</b>개 · 파트당 총원가: <b>{cost.total.toLocaleString()}원</b>
              </div>
            </div>

            {/* Chatter detail */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-1">📈 Chatter 상세</h5>
              <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full transition-all ${chatter.level === "high" ? "bg-rose-500" : chatter.level === "med" ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${chatter.risk}%` }} />
              </div>
              <div className="mt-1.5 text-[10px] text-gray-600">
                위험도 <b>{chatter.risk}%</b> ({chatter.level})
                {chatter.reasons.length > 0 && <span className="ml-2">· {chatter.reasons.join(", ")}</span>}
              </div>
            </div>

            {/* Taylor curve */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-1">📉 Taylor 수명곡선</h5>
              <div className="flex items-center gap-3">
                <TaylorCurve currentVc={VcEff} VcReference={VcReferenceVal}
                  coatingMult={coatingMult} isoGroup={isoGroup} toolMaterialE={toolMatE}
                  className="flex-shrink-0" />
                <div className="text-[10px] text-gray-600 space-y-0.5">
                  <div>현재 Vc: <b className="text-red-600">{VcEff.toFixed(0)}</b> m/min</div>
                  <div>예상 수명: <b className="text-red-600">{toolLifeMin.toFixed(0)}</b> min</div>
                  <div>최저원가 Vc: <b className="text-emerald-700">{econVc.toFixed(0)}</b> m/min (추천)</div>
                  <div className="text-gray-500 text-[9px]">n={(toolMatE < 300 ? 0.125 : 0.25).toFixed(3)} (Taylor)</div>
                </div>
              </div>
            </div>

            {/* Reverse MRR solver */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-1">🎯 Reverse Solver — 목표 MRR</h5>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <input type="number" value={targetMRR} onChange={e => setTargetMRR(parseFloat(e.target.value) || 0)}
                    min={1} max={500} step={1}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono" />
                  <div className="text-[9px] text-gray-500 mt-0.5">cm³/min 목표 입력</div>
                </div>
                <button onClick={() => {
                  setVc(reverseSol.Vc); setFz(reverseSol.fz); setAp(reverseSol.ap); setAe(reverseSol.ae)
                  setShareToast("Reverse solver 적용")
                  setTimeout(() => setShareToast(null), 1500)
                }} disabled={!reverseSol.achievable}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${reverseSol.achievable ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>
                  적용
                </button>
              </div>
              <div className={`mt-2 text-[10px] font-mono p-2 rounded ${reverseSol.achievable ? "bg-indigo-50 text-indigo-800" : "bg-rose-50 text-rose-700"}`}>
                제안: Vc={reverseSol.Vc} · fz={reverseSol.fz} · ap={reverseSol.ap} · ae={reverseSol.ae}
                {!reverseSol.achievable && " · ⚠ 범위 초과"}
              </div>
            </div>

            {/* Multi-pass plan */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-1">📦 스톡 크기 → 패스 계획</h5>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                <NumInputSmall label="L (mm)" value={stockL} onChange={setStockL} />
                <NumInputSmall label="W (mm)" value={stockW} onChange={setStockW} />
                <NumInputSmall label="H (mm)" value={stockH} onChange={setStockH} />
                <NumInputSmall label="마감 ap" value={finishAp} onChange={setFinishAp} />
              </div>
              <div className="text-[10px] font-mono bg-amber-50 text-amber-900 p-2 rounded space-y-0.5">
                <div>러프: <b>{passPlan.roughPasses}</b>패스 · MRR {passPlan.mrrRough} cm³/min</div>
                <div>마감: <b>{passPlan.finishPasses}</b>패스 · MRR {passPlan.mrrFinish} cm³/min</div>
                <div>총 가공시간: <b className="text-amber-700">{passPlan.totalTimeMin}</b> min</div>
              </div>
            </div>

            {/* 프리셋 저장/불러오기 */}
            <div>
              <h5 className="text-xs font-bold text-gray-800 mb-1">💾 조건 프리셋 (localStorage)</h5>
              <div className="flex gap-2 mb-2">
                <input type="text" placeholder="프리셋 이름" value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                <button onClick={savePreset} disabled={!presetName.trim()}
                  className="rounded-lg bg-emerald-600 text-white px-3 py-1 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50">저장</button>
              </div>
              {savedPresets.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                  {savedPresets.map(p => (
                    <div key={p.name} className="flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1">
                      <button onClick={() => loadPreset(p)} className="flex-1 text-left text-[10px] font-mono text-gray-700 hover:text-blue-700 truncate">{p.name}</button>
                      <button onClick={() => deletePreset(p.name)} className="text-gray-400 hover:text-red-600"><X className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* GCode */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h5 className="text-xs font-bold text-gray-800">📝 GCode 스니펫</h5>
                <div className="flex gap-1">
                  {(["fanuc", "heidenhain", "siemens"] as const).map(d => (
                    <button key={d} onClick={() => setGcodeDialect(d)}
                      className={`text-[9px] px-1.5 py-0.5 rounded ${gcodeDialect === d ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}>{d}</button>
                  ))}
                  <button onClick={() => {
                    void navigator.clipboard.writeText(generateGCode({
                      n: result.n, Vf: result.Vf, ap, ae, D: diameter, toolNo: 1, dialect: gcodeDialect, coolant: coolant as any,
                    }))
                    setShareToast("GCode 복사됨")
                    setTimeout(() => setShareToast(null), 1500)
                  }} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-600 text-white">Copy</button>
                </div>
              </div>
              <pre className="bg-gray-900 text-green-400 text-[10px] font-mono p-2.5 rounded overflow-x-auto whitespace-pre">
{generateGCode({ n: result.n, Vf: result.Vf, ap, ae, D: diameter, toolNo: 1, dialect: gcodeDialect, coolant: coolant as any })}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* A/B Compare */}
      {(snapshotA || snapshotB) && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              ⚖ 조건 비교 (A/B)
            </h4>
            <button onClick={clearAB} className="text-[10px] text-gray-500 hover:text-red-600 flex items-center gap-1">
              <X className="h-3 w-3" /> 초기화
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-1.5 pr-2">지표</th>
                  <th className="pb-1.5 pr-2 text-emerald-700">A {snapshotA ? `· ${snapshotA.label}` : "(미저장)"}</th>
                  <th className="pb-1.5 pr-2 text-indigo-700">B {snapshotB ? `· ${snapshotB.label}` : "(미저장)"}</th>
                  <th className="pb-1.5">Δ (B vs A)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {([
                  { key: "Vc", unit: "m/min", decimals: 0 },
                  { key: "fz", unit: "mm/t", decimals: 4 },
                  { key: "ap", unit: "mm", decimals: 1 },
                  { key: "ae", unit: "mm", decimals: 1 },
                  { key: "n", unit: "rpm", decimals: 0 },
                  { key: "Vf", unit: "mm/min", decimals: 0 },
                  { key: "MRR", unit: "cm³/min", decimals: 1 },
                  { key: "Pc", unit: "kW", decimals: 2 },
                  { key: "torque", unit: "N·m", decimals: 2 },
                  { key: "deflection", unit: "μm", decimals: 1 },
                ] as const).map(({ key, unit, decimals }) => {
                  const a = snapshotA?.[key]
                  const b = snapshotB?.[key]
                  const delta = (a != null && b != null) ? b - a : null
                  const pct = (a != null && b != null && a !== 0) ? ((b - a) / a) * 100 : null
                  return (
                    <tr key={key} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 pr-2 font-sans text-gray-600">{key}</td>
                      <td className="py-1 pr-2 text-emerald-700">{a != null ? a.toFixed(decimals) : "—"} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className="py-1 pr-2 text-indigo-700">{b != null ? b.toFixed(decimals) : "—"} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className={`py-1 ${delta == null ? "text-gray-400" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-gray-500"}`}>
                        {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(decimals)}`}
                        {pct != null && <span className="text-[9px] opacity-60 ml-1">({pct > 0 ? "+" : ""}{pct.toFixed(1)}%)</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> 검증 경고 ({warnings.length}건)
          </h4>
          <ul className="space-y-1.5">{warnings.map((w, i) => <WarningRow key={i} w={w} />)}</ul>
        </div>
      )}

      {/* Catalog table */}
      {catalogData?.conditions && catalogData.conditions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">📋 카탈로그 절삭조건</h3>
            <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono">
              <span>Matches: <b className="text-gray-800">{catalogData.count}</b></span>
              <span>Showing: <b className="text-gray-800">{Math.min(catalogData.conditions.length, 20)}</b></span>
              <span className="text-gray-400">(max 20)</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-3">가공형상</th><th className="pb-2 pr-3">직경</th>
                  <th className="pb-2 pr-3">Vc</th><th className="pb-2 pr-3">fz</th>
                  <th className="pb-2 pr-3">ap</th><th className="pb-2 pr-3">ae</th>
                  <th className="pb-2 pr-3">RPM</th><th className="pb-2">Vf</th>
                </tr>
              </thead>
              <tbody>
                {catalogData.conditions.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 pr-3 text-gray-700">{c.cuttingType}</td>
                    <td className="py-1.5 pr-3">{c.diameterMm ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.Vc ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.fz ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.ap ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.ae ?? "-"}</td>
                    <td className="py-1.5 pr-3 font-mono">{c.n ?? "-"}</td>
                    <td className="py-1.5 font-mono">{c.vf ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════ Helper components ══════════

function SectionHeader({ icon, title, subtitle, tone }: { icon: React.ReactNode; title: string; subtitle: string; tone: "blue" | "violet" | "emerald" }) {
  const toneMap: Record<string, string> = {
    blue: "from-blue-600 to-blue-500", violet: "from-violet-600 to-violet-500", emerald: "from-emerald-600 to-emerald-500",
  }
  return (
    <div className="flex items-center gap-3 mt-2">
      <div className={`h-7 w-7 rounded-lg bg-gradient-to-br ${toneMap[tone]} text-white flex items-center justify-center shadow-sm`}>{icon}</div>
      <div>
        <div className="text-sm font-bold text-gray-900">{title}</div>
        <div className="text-[10px] text-gray-500 -mt-0.5">{subtitle}</div>
      </div>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  )
}

function CardShell({ title, icon, onReset, children, eduId, eduSection }: { title: string; icon: React.ReactNode; onReset: () => void; children: React.ReactNode; eduId?: string; eduSection?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 flex flex-col" data-edu-section={eduSection}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-red-600 tracking-wider flex items-center gap-1.5">
          {icon}{title}
          {eduId && <EduLabel id={eduId} size="xs" />}
        </h3>
        <button onClick={onReset} className="text-[9px] text-gray-400 hover:text-red-600 flex items-center gap-0.5">
          <RotateCcw className="h-2.5 w-2.5" /> RESET
        </button>
      </div>
      {children}
    </div>
  )
}

function DimRow({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit: DisplayUnit }) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] text-gray-500 w-10 flex-shrink-0">{label}</label>
      {(unit === "metric" || unit === "both") && (
        <>
          <input type="number" className="flex-1 min-w-0 rounded border border-gray-300 px-1.5 py-1 text-xs font-mono focus:border-blue-400 focus:outline-none"
            value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} min={min} max={max} step={step} />
          <span className="text-[9px] text-gray-400 w-5">mm</span>
        </>
      )}
      {(unit === "inch" || unit === "both") && (
        <>
          <input type="number" className="flex-1 min-w-0 rounded border border-gray-300 px-1.5 py-1 text-xs font-mono focus:border-blue-400 focus:outline-none"
            value={UNITS.mmToIn(value).toFixed(4)} onChange={e => onChange(UNITS.inToMm(parseFloat(e.target.value) || 0))} step={0.001} />
          <span className="text-[9px] text-gray-400 w-4">in</span>
        </>
      )}
    </div>
  )
}

function MiniSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-blue-400 focus:outline-none">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function NumInputSmall({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[9px] text-gray-500">{label}</label>
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs font-mono focus:border-blue-400 focus:outline-none" />
    </div>
  )
}

interface PctSliderProps {
  label: string; unit: string; value: number; pct: number; pctLabel?: string
  min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
  locked?: boolean; onLockToggle?: () => void
  secondary?: { value: number; unit: string; decimals: number }
  eduId?: string
}

function PctSlider({ label, unit, value, pct, pctLabel = "%", min, max, step, decimals = 0, onChange, locked, onLockToggle, secondary, eduId }: PctSliderProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-0.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-700">{label}</label>
          {eduId && <EduLabel id={eduId} size="xs" />}
          {onLockToggle && (
            <button onClick={onLockToggle} className="text-gray-400 hover:text-blue-600">
              {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-blue-700 font-mono">{decimals ? value.toFixed(decimals) : value.toFixed(1)} {unit}</span>
          <span className="text-[10px] text-gray-500 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
            {pct >= 0 && pctLabel === "%" ? "+" : ""}{pct.toFixed(0)}{pctLabel}
          </span>
          {secondary && <span className="text-[10px] text-gray-400 font-mono">({secondary.value.toFixed(secondary.decimals)} {secondary.unit})</span>}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={locked}
        onChange={e => onChange(parseFloat(e.target.value))}
        className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-600 ${locked ? "opacity-50 cursor-not-allowed" : ""} bg-gray-200`} />
      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
        <span>{decimals ? min.toFixed(decimals) : Math.round(min)}</span>
        <span>{decimals ? max.toFixed(decimals) : Math.round(max)}</span>
      </div>
    </div>
  )
}

function PercentTuner({ label, pct, onChange, positiveLabel, negativeLabel, effective }: { label: string; pct: number; onChange: (n: number) => void; positiveLabel: string; negativeLabel: string; effective: string }) {
  const barLeft = Math.max(0, pct) > 0 ? 50 : 50 + (pct / 20) * 50
  const barWidth = Math.abs(pct) / 20 * 50
  return (
    <div className="rounded-lg border border-indigo-100 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-900">{label}</span>
          <span className={`text-lg font-bold font-mono ${pct > 0 ? "text-emerald-700" : pct < 0 ? "text-rose-700" : "text-gray-700"}`}>
            {pct > 0 ? "+" : ""}{pct}%
          </span>
        </div>
        <button onClick={() => onChange(0)} className="text-[10px] text-gray-400 hover:text-red-600">100%</button>
      </div>
      <input type="range" min={-20} max={20} step={1} value={pct}
        onChange={e => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
      <div className="relative h-1 bg-gray-100 rounded overflow-hidden">
        <div className="absolute top-0 h-full bg-indigo-500 transition-all" style={{ left: `${barLeft}%`, width: `${barWidth}%` }} />
        <div className="absolute left-1/2 top-0 w-px h-full bg-gray-400" />
      </div>
      <div className="flex justify-between text-[9px] text-gray-500">
        <span className="text-rose-600">← {negativeLabel}</span>
        <span className="text-emerald-600">{positiveLabel} →</span>
      </div>
      <div className="text-[10px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded truncate">{effective}</div>
    </div>
  )
}

function StarterCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left rounded-lg border border-blue-200 bg-white px-3.5 py-3 hover:border-blue-400 hover:shadow-sm transition-all">
      <div className="flex items-center gap-1.5 mb-1 text-blue-700">{icon}<span className="text-xs font-bold">{title}</span></div>
      <div className="text-[11px] text-gray-600">{desc}</div>
    </button>
  )
}

function MetricCard({ label, value, unit, accent, sub, eduId }: { label: string; value: string; unit: string; accent: "neutral" | "warning" | "volatile"; sub?: string; eduId?: string }) {
  const accentClass = accent === "warning" ? "border-amber-300 bg-amber-50/50" : accent === "volatile" ? "border-violet-300 bg-violet-50/50" : "border-gray-200 bg-white"
  return (
    <div className={`rounded-xl border ${accentClass} p-3`}>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
        {label}
        {eduId && <EduLabel id={eduId} size="xs" />}
      </div>
      <div className="text-lg font-bold mt-0.5 text-gray-900 font-mono">{value}</div>
      <div className="text-[9px] text-gray-500">{unit}</div>
      {sub && <div className="text-[9px] text-violet-700 mt-0.5 font-mono">{sub}</div>}
    </div>
  )
}

function ResultCard({ label, value, unit, color, sub, eduId }: { label: string; value: string; unit: string; color: string; sub?: string; eduId?: string }) {
  const colorMap: Record<string, string> = {
    blue: "from-blue-500 to-blue-600", green: "from-emerald-500 to-emerald-600",
    amber: "from-amber-500 to-amber-600", red: "from-red-500 to-red-600",
  }
  return (
    <div className={`rounded-xl bg-gradient-to-br ${colorMap[color]} p-4 text-white shadow-lg`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80 flex items-center gap-1">
        {label}
        {eduId && <span className="text-white"><EduLabel id={eduId} size="xs" /></span>}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs opacity-70">{unit}</div>
      {sub && <div className="text-[10px] opacity-60 mt-0.5 font-mono">{sub}</div>}
    </div>
  )
}

function ToolSpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="text-gray-500 w-[85px] flex-shrink-0">{k}:</span>
      <span className="font-mono text-gray-800 flex-1 min-w-0 truncate">{v}</span>
    </div>
  )
}

function CorrChip({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <span className={`rounded px-2 py-0.5 font-mono ${active ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-500"}`}>
      <span className="font-semibold">{label}</span>: {value}
    </span>
  )
}

function RvYRow({ label, rec, your, unit, decimals }: { label: string; rec: number; your: number; unit: string; decimals: number }) {
  const delta = rec !== 0 ? ((your - rec) / rec) * 100 : 0
  const close = Math.abs(delta) < 5
  const deviated = Math.abs(delta) > 15
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${close ? "border-emerald-200 bg-emerald-50" : deviated ? "border-rose-200 bg-rose-50" : "border-gray-200 bg-white"}`}>
      <div className="text-[10px] text-gray-500 uppercase font-semibold">{label}</div>
      <div className="flex items-baseline justify-between mt-0.5">
        <div>
          <div className="text-[9px] text-gray-400">추천</div>
          <div className="text-xs font-mono text-gray-700">{rec.toFixed(decimals)}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-gray-400">현재</div>
          <div className="text-xs font-mono font-bold text-gray-900">{your.toFixed(decimals)}</div>
        </div>
      </div>
      <div className={`text-[10px] font-mono mt-1 ${close ? "text-emerald-600" : deviated ? "text-rose-600" : "text-gray-500"}`}>
        {delta > 0 ? "+" : ""}{delta.toFixed(1)}% · {unit}
      </div>
    </div>
  )
}

function WarningRow({ w }: { w: SimWarning }) {
  const iconMap = { error: AlertCircle, warn: AlertTriangle, info: Info }
  const Icon = iconMap[w.level]
  const colorMap = {
    error: "text-red-700 bg-red-50 border-red-200",
    warn: "text-amber-700 bg-amber-50 border-amber-200",
    info: "text-blue-700 bg-blue-50 border-blue-200",
  }
  return (
    <li className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${colorMap[w.level]}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /><span>{w.message}</span>
    </li>
  )
}
