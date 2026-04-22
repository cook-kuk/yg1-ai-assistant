"use client"

import dynamic from "next/dynamic"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
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
// CornerFeedPanel 대체: corner-panel-v2의 CornerFeedPanelV2 사용
import { CuttingAction } from "./cutting-action"
import { ToolSilhouette } from "./tool-silhouette"
import { EngagementCircle } from "./engagement-circle"
import { ADOCRDOCAdjuster } from "./adoc-rdoc-adjuster"
import { ToolPathDiagram } from "./tool-path-diagrams"
import { stateToQuery, queryToState, type SerializableState, type SnapshotSummary } from "./state-serde"
import { generateShopfloorCardPDF } from "./shopfloor-card"
import { useSimulatorShortcuts, SHORTCUT_HINTS, SHORTCUT_CATEGORIES } from "./use-simulator-shortcuts"
import { useUndoRedo, type HistoryState } from "./use-undo-redo"
// welcome-modal: 컴포넌트는 dynamic, 상수/타입은 정적 유지
import { WELCOME_EXAMPLES, type ExamplePreset as WelcomePreset } from "./welcome-modal"
import FloatingWarnings from "./floating-warnings"
import { WarningDot, type ParamKey } from "./warning-indicator-dot"
import {
  estimateHeat, estimateRunoutEffect, decomposeHelixForce,
  monteCarloToolLife, estimateBueRisk, classifyChipMorphology,
} from "../advanced-metrics"
import { VendorTag } from "./vendor-tags"
import { useSimulatorMode } from "./mode-context"
import { AnimatedNumber, CountUp } from "./animated-number"
import { ConfettiBurst, SparkleOnUpdate } from "./micro-interactions"
import { copyText } from "./clipboard-util"
import BeginnerLessonCards from "./beginner-lesson-cards"
import FeatureExplainer from "./feature-explainer"
import { AiQueryBar } from "./ai-query-bar"
import { AiOptimizeButton } from "./ai-optimize-button"
import { AiWarningExplain } from "./ai-warning-explain"
import VoiceInputButton from "./voice-input-button"
import SessionExport from "./session-export"
import { AiAutoAgentPanel } from "./ai-auto-agent-panel"
import { generateWorkInstructionPDF } from "./work-instruction-pdf"
import { AiChatSidebar } from "./ai-chat-sidebar"
import GCodeDownloadButton from "./gcode-download-button"
// operation-picker: 컴포넌트는 dynamic, 타입은 정적 유지
import { type OperationType } from "./operation-picker"
import HolographicFrame from "./holographic-frame"
import { generateGCode } from "./gcode-gen"
// STEP 4·5·6 신규 컴포넌트
import { ProvenancePanel } from "./provenance-panel"
import { ToolPathInfoModal } from "./tool-path-info-modal"
import { CornerFeedPanelV2 } from "./corner-panel-v2"
import { WorkholdingSlider } from "./workholding-slider"
import { AiCoachPanel } from "./ai-coach-panel"
import { ToolLifeScenario } from "./tool-life-scenario"
import { HARVEY_REPLACEMENT_PRESETS, MultiToolCompare, getToolOptionById, type ToolOption } from "./multi-tool-compare"
import { LearningMode } from "./learning-mode"
import { CompetitorLiveCompare } from "./competitor-live-compare"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// ─── heavy 컴포넌트 lazy-load (three.js / canvas / framer-motion) ─────────
const Cutting3DScene = dynamic(() => import("./cutting-3d-scene"), { ssr: false, loading: () => <div className="h-[480px] flex items-center justify-center text-sm text-slate-400">🎮 3D 씬 로딩중...</div> })
const InteractiveGcodeViewer = dynamic(() => import("./interactive-gcode-viewer"), { ssr: false })
const LiveCuttingScene = dynamic(() => import("./live-cutting-scene"), { ssr: false })
const VibrationOscilloscope = dynamic(() => import("./vibration-oscilloscope"), { ssr: false })
const TemperatureHeatmap = dynamic(() => import("./temperature-heatmap"), { ssr: false })
const ForceVectorDiagram = dynamic(() => import("./force-vector-diagram"), { ssr: false })
const AnalogGauges = dynamic(() => import("./analog-gauges"), { ssr: false })
const Endmill3DPreview = dynamic(() => import("./endmill-3d-preview"), { ssr: false })
const ToolBlueprint = dynamic(() => import("./tool-blueprint"), { ssr: false })
const BlueprintGallery = dynamic(() => import("./blueprint-gallery"), { ssr: false })
const ToolPathScene = dynamic(() => import("./tool-path-scene"), { ssr: false })
const MachiningAnimation = dynamic(() => import("./machining-animation").then(m => ({ default: m.MachiningAnimation })), { ssr: false })
const HeatmapPanel = dynamic(() => import("./heatmap-panel").then(m => ({ default: m.HeatmapPanel })), { ssr: false })
const WelcomeModal = dynamic(() => import("./welcome-modal"), { ssr: false })
const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false })
const BeginnerWizard = dynamic(() => import("./beginner-wizard"), { ssr: false })
const InteractiveTutorial = dynamic(() => import("./interactive-tutorial"), { ssr: false })
const CheatSheetPanel = dynamic(() => import("./cheat-sheet-panel"), { ssr: false })
const AdvancedMetricsPanel = dynamic(() => import("./advanced-metrics-panel"), { ssr: false })
const BreakEvenChart = dynamic(() => import("./break-even-chart"), { ssr: false })
const WearGaugePanel = dynamic(() => import("./wear-gauge-panel"), { ssr: false })
const DashboardHeroDisplay = dynamic(() => import("./dashboard-hero-display"), { ssr: false })
const BenchmarkLeaderboard = dynamic(() => import("./benchmark-leaderboard"), { ssr: false })
const Yg1VideoPanel = dynamic(() => import("./yg1-video-panel"), { ssr: false })
const BeforeAfterCompare = dynamic(() => import("./before-after-compare"), { ssr: false })
const FavoritesPanel = dynamic(() => import("./favorites-panel"), { ssr: false })
const OperationPicker = dynamic(() => import("./operation-picker"), { ssr: false })
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
  const [snapshotC, setSnapshotC] = useState<SnapshotSummary | null>(null)
  const [snapshotD, setSnapshotD] = useState<SnapshotSummary | null>(null)
  const [urlHydrated, setUrlHydrated] = useState(false)
  const [showBreakEven, setShowBreakEven] = useState(false)
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [recentSavedSlot, setRecentSavedSlot] = useState<"A" | "B" | "C" | "D" | null>(null)
  const [discoverGlow, setDiscoverGlow] = useState(true)
  const [advancedMetricsOpen, setAdvancedMetricsOpen] = useState(false)
  const [tirUm, setTirUm] = useState(8)
  const [helixAngleDeg, setHelixAngleDeg] = useState(38)
  const [show3DPreview, setShow3DPreview] = useState(false)
  const [showLiveScene, setShowLiveScene] = useState(false)
  const [showWearGauge, setShowWearGauge] = useState(false)
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [showBlueprintGallery, setShowBlueprintGallery] = useState(false)
  const [showAnalogGauges, setShowAnalogGauges] = useState(false)
  const [showHeroDisplay, setShowHeroDisplay] = useState(false)
  const [showToolPath, setShowToolPath] = useState(false)
  const [showVibration, setShowVibration] = useState(false)
  const [showTempHeatmap, setShowTempHeatmap] = useState(false)
  const [showForceVec, setShowForceVec] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [showLessonCards, setShowLessonCards] = useState(true)
  const [showCheatSheet, setShowCheatSheet] = useState(false)
  const [showVideoPanel, setShowVideoPanel] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showAutoAgent, setShowAutoAgent] = useState(false)
  const [beforeAfterData, setBeforeAfterData] = useState<{ before: any; after: any; reasoning?: string } | null>(null)
  const [showFavorites, setShowFavorites] = useState(false)
  const [show3DScene, setShow3DScene] = useState(false)
  const [liveCorrelationOpen, setLiveCorrelationOpen] = useState(false)
  const [showPrimaryParameterMap, setShowPrimaryParameterMap] = useState(true)
  const [selectedHarveyReplacementId, setSelectedHarveyReplacementId] = useState(HARVEY_REPLACEMENT_PRESETS[0]?.id ?? "")
  const [replacementVisualMode, setReplacementVisualMode] = useState<"split" | "flutes" | "live">("split")
  const [replacementVcScale, setReplacementVcScale] = useState(100)
  const [replacementFzScale, setReplacementFzScale] = useState(100)
  const [replacementApRatio, setReplacementApRatio] = useState(50)
  const [replacementAeRatio, setReplacementAeRatio] = useState(20)
  const [replacementStickoutRatio, setReplacementStickoutRatio] = useState(Math.round(DEFAULT_STICKOUT_RATIO * 100))
  const [operationType, setOperationType] = useState<OperationType>("endmill-general")
  const [confettiTrigger, setConfettiTrigger] = useState(0)
  const simMode = useSimulatorMode()
  // ═══ Undo/Redo 히스토리 ═══
  const history = useUndoRedo(50)
  const applyingHistoryRef = useRef(false)
  const applyHistoryState = useCallback((s: HistoryState | null) => {
    if (!s) return
    applyingHistoryRef.current = true
    setVc(s.Vc); setFz(s.fz); setAp(s.ap); setAe(s.ae)
    setDiameter(s.diameter); setFluteCount(s.fluteCount)
    setActiveShape(s.activeShape as Exclude<EndmillShape, "all">)
    setIsoGroup(s.isoGroup); setSubgroupKey(s.subgroupKey)
    setOperation(s.operation); setCoating(s.coating)
    // 다음 tick 이후 해제 (state 업데이트 완료 후)
    setTimeout(() => { applyingHistoryRef.current = false }, 50)
  }, [])
  const handleUndo = useCallback(() => {
    const s = history.undo()
    if (s) { applyHistoryState(s); toast.info("↶ 이전 조건") }
  }, [history, applyHistoryState])
  const handleRedo = useCallback(() => {
    const s = history.redo()
    if (s) { applyHistoryState(s); toast.info("↷ 다음 조건") }
  }, [history, applyHistoryState])
  // 활성 패널 인스턴스 키 — 활성화 시마다 값 변경되어 React가 완전 unmount/remount (깨끗한 상태, 메모리 해제)
  const [panelInstance, setPanelInstance] = useState(0)
  // 패널 single-toggle + RAF로 unmount/mount 분리 + 맨 위 스크롤 + 강제 remount 키
  const activatePanel = useCallback((panelKey: string | null) => {
    window.scrollTo({ top: 0, behavior: "smooth" })
    // 1) 모든 비주얼 패널 먼저 OFF (react가 완전 unmount 하도록)
    setShowLiveScene(false); setShow3DPreview(false); setShowBlueprint(false)
    setShowAnalogGauges(false); setShowToolPath(false); setShowVibration(false)
    setShowTempHeatmap(false); setShowForceVec(false); setShowWearGauge(false)
    setShowBreakEven(false); setAdvancedMetricsOpen(false); setShowCheatSheet(false)
    if (typeof setShow3DScene === "function") setShow3DScene(false)
    if (typeof setShowVideoPanel === "function") setShowVideoPanel(false)
    if (typeof setShowLeaderboard === "function") setShowLeaderboard(false)
    if (typeof setShowAutoAgent === "function") setShowAutoAgent(false)
    if (typeof setShowFavorites === "function") setShowFavorites(false)
    if (!panelKey) return
    // 2) 다음 프레임에 대상 ON — unmount/mount 확실히 분리 → 깨끗한 초기화
    setPanelInstance(Date.now())
    requestAnimationFrame(() => {
      if (panelKey === "live") setShowLiveScene(true)
      else if (panelKey === "3d") setShow3DPreview(true)
      else if (panelKey === "blueprint") setShowBlueprint(true)
      else if (panelKey === "gauges") setShowAnalogGauges(true)
      else if (panelKey === "tool-path") setShowToolPath(true)
      else if (panelKey === "vibration") setShowVibration(true)
      else if (panelKey === "temp") setShowTempHeatmap(true)
      else if (panelKey === "force") setShowForceVec(true)
      else if (panelKey === "wear") setShowWearGauge(true)
      else if (panelKey === "break-even") setShowBreakEven(true)
      else if (panelKey === "advanced") setAdvancedMetricsOpen(true)
      else if (panelKey === "cheat") setShowCheatSheet(true)
      else if (panelKey === "3d-scene") setShow3DScene(true)
      else if (panelKey === "video") setShowVideoPanel(true)
      else if (panelKey === "leaderboard") setShowLeaderboard(true)
      else if (panelKey === "auto-agent") setShowAutoAgent(true)
      else if (panelKey === "favorites") setShowFavorites(true)
    })
    // 3) 맨 위로 스크롤 — 헤더 오프셋 보정하여 패널이 화면 최상단에 위치
    setTimeout(() => {
      const el = document.querySelector(`[data-visual-panel="${panelKey}"]`)
      if (el instanceof HTMLElement) {
        const HEADER_OFFSET = 80
        const top = window.scrollY + el.getBoundingClientRect().top - HEADER_OFFSET
        window.scrollTo({ top, behavior: "smooth" })
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }, 240)
  }, [])

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

  // Speeds/Feeds 자동로드: 공구/재질/op/코팅 바뀔 때 /api/simulator/speeds-feeds 조회
  useEffect(() => {
    if (typeof window === "undefined") return
    const toolId = realEdp || productCode.trim()
    if (!toolId) { setSpeedsFeedsBaseline(null); return }
    const opMap: Record<string, "slotting"|"finishing"|"roughing"|"max"> = {
      Slotting: "slotting", Side_Milling: "finishing",
      Profiling: "finishing", Facing: "roughing", Pocketing: "roughing",
    }
    const mappedOp = opMap[operation] ?? "finishing"
    const coatingKey = coating.toUpperCase()
    const params = new URLSearchParams({
      toolId,
      operation: mappedOp,
    })
    if (subgroupKey) params.set("materialSubgroup", subgroupKey)
    if (coatingKey) params.set("coating", coatingKey)
    let cancelled = false
    fetch(`/api/simulator/speeds-feeds?${params.toString()}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j || !j.matched || !j.row) {
          setSpeedsFeedsBaseline(null); return
        }
        setSpeedsFeedsBaseline({
          sfm: j.row.sfm, iptInch: j.row.iptInch,
          source: j.source ?? "estimated",
          confidence: j.confidence ?? 1,
          sourceRef: j.row.sourceRef,
        })
      })
      .catch(() => setSpeedsFeedsBaseline(null))
    return () => { cancelled = true }
  }, [productCode, realEdp, subgroupKey, operation, coating])

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
    toast.success(`"${newP.name}" 저장됨`)
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
    toast.success(`"${p.name}" 로드됨`)
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

  // ═══ 고급 엔지니어링 지표 (연구소장 모드) ═══
  const advHeat = useMemo(() => estimateHeat({
    Pc: result.Pc, Vc: VcEff, fz: fzEff, ap, ae, D: diameter, materialGroup: isoGroup,
  }), [result.Pc, VcEff, fzEff, ap, ae, diameter, isoGroup])
  const advRunout = useMemo(() => estimateRunoutEffect({
    tirUm, fz: fzEff, Z: fluteCount, D: diameter,
  }), [tirUm, fzEff, fluteCount, diameter])
  const advHelix = useMemo(() => decomposeHelixForce({
    Fc: advanced.Fc, helixAngle: helixAngleDeg, ap, D: diameter,
  }), [advanced.Fc, helixAngleDeg, ap, diameter])
  const advMonteCarlo = useMemo(() => monteCarloToolLife({
    Vc: VcEff, VcRef: Vc, MRR: result.MRR, samples: 300,
  }), [VcEff, Vc, result.MRR])
  const advBue = useMemo(() => estimateBueRisk({
    materialGroup: isoGroup, interfaceTempC: advHeat.toolTempC, Vc: VcEff,
  }), [isoGroup, advHeat.toolTempC, VcEff])
  const advChipMorph = useMemo(() => classifyChipMorphology({
    materialGroup: isoGroup, Vc: VcEff, fz: fzEff, hardness: hardnessValue, bueRisk: advBue.risk,
  }), [isoGroup, VcEff, fzEff, hardnessValue, advBue.risk])

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

  const harveyReplacementPair = useMemo(() => {
    const preset = HARVEY_REPLACEMENT_PRESETS.find(item => item.id === selectedHarveyReplacementId) ?? HARVEY_REPLACEMENT_PRESETS[0]
    if (!preset) return null
    const harvey = getToolOptionById(preset.harveyId)
    const sandvik = getToolOptionById(preset.sandvikId)
    const yg1 = getToolOptionById(preset.yg1Id)
    if (!harvey || !sandvik || !yg1) return null
    return { preset, harvey, sandvik, yg1 }
  }, [selectedHarveyReplacementId])

  const harveyReplacementCards = useMemo(() => {
    if (!harveyReplacementPair) return []
    const buildCard = (tool: ToolOption) => {
      const pairAp = Math.min(tool.LOC, parseFloat(((replacementApRatio / 100) * tool.D).toFixed(1)))
      const pairAe = Math.min(tool.D, parseFloat(((replacementAeRatio / 100) * tool.D).toFixed(1)))
      const pairVc = parseFloat((tool.Vc * (replacementVcScale / 100)).toFixed(0))
      const pairFz = parseFloat((tool.fz * (replacementFzScale / 100)).toFixed(4))
      const pairStickout = parseFloat((tool.D * (replacementStickoutRatio / 100)).toFixed(1))
      const helixAngle = Math.max(28, Math.min(52, 24 + tool.Z * 4))
      const cutting = calculateCutting({
        Vc: pairVc,
        fz: pairFz,
        ap: pairAp,
        ae: pairAe,
        D: tool.D,
        Z: tool.Z,
        isoGroup: tool.iso,
      })
      const adv = computeAdvanced({
        Pc: cutting.Pc,
        n: cutting.n,
        D: tool.D,
        shaft: { stickoutMm: pairStickout, youngModulusGPa: 600 },
      })
      const toolLife = estimateToolLifeMin({
        Vc: pairVc,
        VcReference: pairVc,
        coatingMult: tool.coatingMult,
        isoGroup: tool.iso,
        toolMaterialE: 600,
      })
      const ra = estimateRaUm({
        fz: pairFz,
        D: tool.D,
        shape: tool.shape,
        cornerR: tool.cornerR,
        ae: pairAe,
      })
      return {
        tool,
        ap: pairAp,
        ae: pairAe,
        Vc: pairVc,
        fz: pairFz,
        stickoutMm: pairStickout,
        helixAngle,
        n: cutting.n,
        Vf: cutting.Vf,
        MRR: cutting.MRR,
        Pc: cutting.Pc,
        torque: adv.torque,
        deflection: adv.deflection,
        toolLifeMin: toolLife,
        raUm: ra,
      }
    }
    return [
      buildCard(harveyReplacementPair.harvey),
      buildCard(harveyReplacementPair.sandvik),
      buildCard(harveyReplacementPair.yg1),
    ]
  }, [harveyReplacementPair, replacementAeRatio, replacementApRatio, replacementFzScale, replacementStickoutRatio, replacementVcScale])

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
    try {
      const { generateReportPDF } = await import("./pdf-generator")
      const edu = typeof window !== "undefined"
        ? localStorage.getItem("yg1-sim-v3-education")?.includes('"enabled":true') ?? false
        : false
      await generateReportPDF({
        state: {
          seriesOrProduct: productCode, edp: realEdp ?? undefined,
          diameter, fluteCount, shape: activeShape, LOC, OAL, cornerR,
          isoGroup, subgroupKey, condition, hardnessScale, hardnessValue,
          operation, toolPath, strategy: strategy || undefined,
          spindleKey, holderKey, maxRpm, maxKw, workholding,
          stickoutMm, Vc: VcEff, fz: fzEff, ap, ae,
          coolant, coating,
        },
        results: {
          n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc,
          Fc: advanced.Fc, deflection: advanced.deflection,
          toolLife: toolLifeMin, raUm,
          chatterRisk: chatter.level,
        },
        warnings,
        url: window.location.href,
        educationMode: edu,
        filename: `YG1-sim-${productCode || "report"}-${Date.now()}.pdf`,
      })
    } catch (e) {
      console.error("PDF 생성 실패:", e)
      window.print()
    }
  }

  // Share current URL
  const shareUrl = async () => {
    if (typeof window === "undefined") return
    const ok = await copyText(window.location.href)
    if (ok) toast.success("링크 복사됨")
    else toast.error("복사 실패 — 주소창에서 직접 복사")
  }

  // Snapshot for A/B compare
  const makeSnapshot = (label: string): SnapshotSummary => ({
    label, Vc: VcEff, fz: fzEff, ap, ae,
    n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc,
    torque: advanced.torque, deflection: advanced.deflection,
  })
  const pulseSlot = (slot: "A" | "B" | "C" | "D") => {
    setRecentSavedSlot(slot)
    setConfettiTrigger(Date.now())
    setTimeout(() => setRecentSavedSlot(prev => prev === slot ? null : prev), 1800)
  }
  const toastWithCompareAction = (slot: "A" | "B" | "C" | "D") => {
    toast.success(`스냅샷 ${slot} 저장됨`, {
      description: `${productCode || "조건"} · Vc ${VcEff.toFixed(0)} · fz ${fzEff.toFixed(3)}`,
      action: {
        label: "비교 보기",
        onClick: () => {
          document.querySelector('[data-section="ab-compare"]')?.scrollIntoView({ behavior: "smooth", block: "start" })
        },
      },
    })
  }
  const saveA = () => { setSnapshotA(makeSnapshot(productCode || "조건 A")); pulseSlot("A"); toastWithCompareAction("A") }
  const saveB = () => { setSnapshotB(makeSnapshot(productCode || "조건 B")); pulseSlot("B"); toastWithCompareAction("B") }
  const saveC = () => { setSnapshotC(makeSnapshot(productCode || "조건 C")); pulseSlot("C"); toastWithCompareAction("C") }
  const saveD = () => { setSnapshotD(makeSnapshot(productCode || "조건 D")); pulseSlot("D"); toastWithCompareAction("D") }
  const clearAB = () => { setSnapshotA(null); setSnapshotB(null); setSnapshotC(null); setSnapshotD(null); toast.info("스냅샷 전체 초기화") }
  const saveSnapshotSlot = (slot: "A" | "B" | "C" | "D") => {
    if (slot === "A") saveA()
    else if (slot === "B") saveB()
    else if (slot === "C") saveC()
    else saveD()
  }

  const loadHarveyReplacementPairToSnapshots = useCallback(() => {
    if (harveyReplacementCards.length < 3) return
    const [harveyCard, sandvikCard, yg1Card] = harveyReplacementCards
    setSnapshotA({
      label: `${harveyCard.tool.brand} ${harveyCard.tool.series}`,
      Vc: harveyCard.tool.Vc,
      fz: harveyCard.tool.fz,
      ap: harveyCard.ap,
      ae: harveyCard.ae,
      n: harveyCard.n,
      Vf: harveyCard.Vf,
      MRR: harveyCard.MRR,
      Pc: harveyCard.Pc,
      torque: harveyCard.torque,
      deflection: harveyCard.deflection,
    })
    setSnapshotB({
      label: `${sandvikCard.tool.brand} ${sandvikCard.tool.series}`,
      Vc: sandvikCard.tool.Vc,
      fz: sandvikCard.tool.fz,
      ap: sandvikCard.ap,
      ae: sandvikCard.ae,
      n: sandvikCard.n,
      Vf: sandvikCard.Vf,
      MRR: sandvikCard.MRR,
      Pc: sandvikCard.Pc,
      torque: sandvikCard.torque,
      deflection: sandvikCard.deflection,
    })
    setSnapshotC({
      label: `${yg1Card.tool.brand} ${yg1Card.tool.series}`,
      Vc: yg1Card.tool.Vc,
      fz: yg1Card.tool.fz,
      ap: yg1Card.ap,
      ae: yg1Card.ae,
      n: yg1Card.n,
      Vf: yg1Card.Vf,
      MRR: yg1Card.MRR,
      Pc: yg1Card.Pc,
      torque: yg1Card.torque,
      deflection: yg1Card.deflection,
    })
    document.querySelector('[data-section="dual-replacement-sim"]')?.scrollIntoView({ behavior: "smooth", block: "start" })
    toast.success("Harvey 대체 듀얼 시뮬레이션을 A/B 비교로 올렸습니다")
  }, [harveyReplacementCards])

  const downloadShopfloorCard = useCallback(async () => {
    try {
      await generateShopfloorCardPDF({
        state: {
          productCode, endmillShape: activeShape, diameter, flutes: fluteCount,
          materialGroup: isoGroup, materialSubgroup: subgroupKey, operation,
          coating, Vc: VcEff, fz: fzEff, ap, ae,
        },
        results: {
          n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc,
          toolLifeMin, Ra: raUm, chatterRisk: `${chatter.risk}% (${chatter.level})`,
        },
        warnings: warnings.slice(0, 3).map(w => w.message),
        shareUrl: typeof window !== "undefined" ? window.location.href : undefined,
      })
      toast.success("작업장 카드 다운로드")
    } catch (e) {
      toast.error("카드 생성 실패")
    }
  }, [productCode, activeShape, diameter, fluteCount, isoGroup, subgroupKey, operation, coating, VcEff, fzEff, ap, ae, result, toolLifeMin, raUm, chatter, warnings])

  useSimulatorShortcuts({
    onSaveSnapshot: saveSnapshotSlot,
    onOpenHelp: () => setShortcutsHelpOpen(true),
    onOpenCommand: () => setCommandPaletteOpen(true),
    onPrint: downloadShopfloorCard,
    onUndo: handleUndo,
    onRedo: handleRedo,
  })

  // Undo/Redo 히스토리 push — 핵심 파라미터 변경 시 (applying 중이 아닐 때)
  useEffect(() => {
    if (applyingHistoryRef.current) return
    history.push({
      Vc, fz, ap, ae, diameter, fluteCount, activeShape,
      isoGroup, subgroupKey, operation, coating,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Vc, fz, ap, ae, diameter, fluteCount, activeShape, isoGroup, subgroupKey, operation, coating])

  // 첫 방문 시 ⌨·🔍 glow 자동 해제 (8초)
  useEffect(() => {
    if (!discoverGlow) return
    const t = setTimeout(() => setDiscoverGlow(false), 8000)
    return () => clearTimeout(t)
  }, [discoverGlow])

  // Welcome / Command Palette 프리셋 핸들러
  const applyWelcomePreset = useCallback((p: WelcomePreset) => {
    setIsoGroup(p.params.isoGroup)
    setSubgroupKey(p.params.subgroupKey)
    setOperation(p.params.operation)
    setCoating(p.params.coating)
    setVc(p.params.Vc)
    setFz(p.params.fz)
    setAp(p.params.ap)
    setAe(p.params.ae)
    setDiameter(p.params.diameter)
    setFluteCount(p.params.fluteCount)
    setActiveShape(p.params.activeShape as Exclude<EndmillShape, "all">)
    setEverInteracted(true)
    toast.success(`✨ "${p.title}" 예시 적용`, { description: p.subtitle })
  }, [])

  const applyExampleById = useCallback((id: string) => {
    const found = WELCOME_EXAMPLES.find(p => p.id === id)
    if (found) applyWelcomePreset(found)
  }, [applyWelcomePreset])

  const jumpToSection = useCallback((section: "results" | "ai-coach" | "heatmap" | "animation" | "multi-tool" | "break-even") => {
    if (section === "break-even") setShowBreakEven(true)
    const selector = section === "results" ? '[data-section="results"]' : `[data-section="${section}"]`
    setTimeout(() => {
      const el = document.querySelector(selector) ?? resultsAnchorRef.current
      el?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 50)
  }, [])

  // Esc to close help modal
  useEffect(() => {
    if (!shortcutsHelpOpen) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setShortcutsHelpOpen(false) }
    window.addEventListener("keydown", onEsc)
    return () => window.removeEventListener("keydown", onEsc)
  }, [shortcutsHelpOpen])

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

        {/* ═══ 우측 액션 (그룹화된 툴바) ═══ */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Units + Jump (primary navigation) */}
          <div className={`rounded-lg border p-0.5 inline-flex text-xs ${darkMode ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"}`}>
            {(["metric", "inch", "both"] as const).map(u => (
              <button key={u} onClick={() => setDisplayUnit(u)}
                className={`px-2.5 py-1 rounded-md transition-all ${displayUnit === u ? "bg-blue-600 text-white font-semibold" : darkMode ? "text-slate-300 hover:bg-slate-700" : "text-gray-600 hover:bg-gray-50"}`}>
                {u === "metric" ? "Metric" : u === "inch" ? "Inch" : "Both"}
              </button>
            ))}
          </div>
          <button onClick={jumpToResults}
            className="flex items-center gap-1 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-700 shadow-sm">
            <ArrowDownCircle className="h-3.5 w-3.5" /> 결과로
          </button>

          <ToolbarDivider darkMode={darkMode} />

          {/* 🔍 검색 (Command Palette) — 첫 방문 glow */}
          <button onClick={() => setCommandPaletteOpen(true)} title="공구·재질·섹션 검색 · Ctrl+K"
            className={`relative flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
              darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            } ${discoverGlow ? "ring-2 ring-blue-400/70 animate-pulse" : ""}`}>
            <Search className="h-3.5 w-3.5" /> 검색
            <kbd className={`ml-1 font-mono text-[9px] px-1 py-0 rounded border ${darkMode ? "border-slate-600 bg-slate-900 text-slate-400" : "border-gray-300 bg-gray-50 text-gray-500"}`}>⌘K</kbd>
          </button>

          <ToolbarDivider darkMode={darkMode} />

          {/* 💾 스냅샷 그룹 A/B/C/D */}
          <div className={`flex items-center gap-1 rounded-lg border p-0.5 ${darkMode ? "border-slate-700 bg-slate-800/60" : "border-gray-200 bg-white"}`}>
            {([
              { slot: "A" as const, onClick: saveA, active: !!snapshotA, color: "emerald", title: "Ctrl+S" },
              { slot: "B" as const, onClick: saveB, active: !!snapshotB, color: "indigo", title: "Ctrl+Shift+S" },
              { slot: "C" as const, onClick: saveC, active: !!snapshotC, color: "violet", title: "스냅샷 C" },
              { slot: "D" as const, onClick: saveD, active: !!snapshotD, color: "amber", title: "스냅샷 D" },
            ] as const).map(s => {
              const pulsing = recentSavedSlot === s.slot
              const activeBg = s.color === "emerald" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : s.color === "indigo" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : s.color === "violet" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              const ringColor = s.color === "emerald" ? "ring-emerald-400"
                : s.color === "indigo" ? "ring-indigo-400"
                : s.color === "violet" ? "ring-violet-400"
                : "ring-amber-400"
              return (
                <button key={s.slot} onClick={s.onClick} title={s.title}
                  className={`flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-bold transition-all ${
                    s.active ? activeBg : darkMode ? "text-slate-400 hover:bg-slate-700" : "text-gray-500 hover:bg-gray-100"
                  } ${pulsing ? `ring-2 ring-offset-1 ${ringColor} animate-pulse` : ""}`}>
                  <span className="text-sm leading-none">💾</span>{s.slot}
                </button>
              )
            })}
          </div>

          <ToolbarDivider darkMode={darkMode} />

          {/* 📋 출력 그룹 (카드 + PDF) */}
          <button onClick={downloadShopfloorCard} title="A6 작업장 카드 · Ctrl+P"
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${darkMode ? "border-orange-500/50 bg-orange-900/20 text-orange-300 hover:bg-orange-900/40" : "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"}`}>
            📋 카드
          </button>
          <button onClick={printPdf} title="상세 PDF 리포트"
            className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
          <button onClick={shareUrl} title="공유 URL 복사"
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            🔗
          </button>

          <ToolbarDivider darkMode={darkMode} />

          {/* 💰 분석 도구 (Break-Even) */}
          <button onClick={() => activatePanel(showBreakEven ? null : "break-even")} title="Break-Even Vc × Cost 차트"
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all ${showBreakEven ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700" : darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            💰 BE
          </button>
          <button onClick={() => setAutoCorrelate(!autoCorrelate)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${autoCorrelate ? "border-purple-400 bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700" : darkMode ? "border-slate-600 bg-slate-800 text-slate-400 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"}`}
            title="변수 상관관계 자동 적용 on/off">
            🔗 {autoCorrelate ? "ON" : "OFF"}
          </button>

          <ToolbarDivider darkMode={darkMode} />

          {/* ⌨ 도움말 + 테마 */}
          <button onClick={() => setShortcutsHelpOpen(true)} title="단축키 도움말 · ?"
            className={`relative flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${darkMode ? "border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"} ${discoverGlow ? "ring-2 ring-indigo-400/70 animate-pulse" : ""}`}>
            ⌨
          </button>
          <button onClick={() => setDarkMode(!darkMode)} title={darkMode ? "라이트 모드" : "다크 모드"}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${darkMode ? "border-yellow-500/50 bg-yellow-900/30 text-yellow-300 hover:bg-yellow-900/50" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
            {darkMode ? "☀" : "🌙"}
          </button>
        </div>
      </div>

      {/* ✨ 영웅 KPI 디스플레이 — 시네마틱 최상단 (모든 모드) */}
      {showHeroDisplay && (
        <HolographicFrame accent="cyan" intensity="strong" scanlines cornerBrackets darkMode={darkMode}>
          <DashboardHeroDisplay
            rpm={result.n}
            rpmMax={maxRpm}
            mrr={result.MRR}
            pc={result.Pc}
            pcMax={maxKw}
            toolLifeMin={toolLifeMin}
            chatterLevel={chatter.level === "med" ? "med" : chatter.level}
            darkMode={darkMode}
          />
        </HolographicFrame>
      )}

      {/* 💡 초보자 오늘의 팁 — 초보 모드일 때 상단 노출 */}
      {simMode.isBeginner && showLessonCards && (
        <BeginnerLessonCards darkMode={darkMode} onClose={() => setShowLessonCards(false)} />
      )}

      {/* 🔮 AI 자연어 검색바 + 🎤 음성 + 🤖 1-click 최적화 + 📦 내보내기 — 상시 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto] gap-3 items-start">
        <AiQueryBar
          darkMode={darkMode}
          onApplyPreset={(p) => {
            applyWelcomePreset({ id: "ai-nl", title: "AI 자연어 추천", subtitle: "Claude Haiku 생성", icon: "🔮", color: "violet", params: p as WelcomePreset["params"] } as WelcomePreset)
          }}
        />
        <VoiceInputButton
          darkMode={darkMode}
          onTranscript={async (text) => {
            try {
              const res = await fetch("/api/simulator/nl-query", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: text }),
              })
              const p = await res.json()
              if (p && !p.error) {
                applyWelcomePreset({ id: "ai-voice", title: "음성 추천", subtitle: text, icon: "🎤", color: "rose", params: p as WelcomePreset["params"] } as WelcomePreset)
              } else {
                toast.error("음성 분석 실패")
              }
            } catch {
              toast.error("음성 → AI 요청 실패")
            }
          }}
        />
        <SessionExport
          darkMode={darkMode}
          state={{ productCode, isoGroup, operation, diameter, fluteCount, activeShape, Vc: VcEff, fz: fzEff, ap, ae }}
          results={{ n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc, torque: advanced.torque, deflection: advanced.deflection, toolLifeMin, Ra: raUm, chatterRisk: chatter.risk }}
          snapshots={[snapshotA, snapshotB, snapshotC, snapshotD]}
          warnings={warnings}
        />
        <AiOptimizeButton
          currentState={{
            Vc, fz, ap, ae, diameter, fluteCount, activeShape,
            isoGroup, subgroupKey, operation, coating, workholding,
            stickoutMm, hardnessScale, hardnessValue,
          }}
          darkMode={darkMode}
          onApply={(opt) => {
            setVc(opt.Vc); setFz(opt.fz); setAp(opt.ap); setAe(opt.ae)
            toast.success("🤖 AI 최적화 조건 적용")
          }}
        />
      </div>

      {/* 🎨 비주얼 시뮬레이션 토글 스트립 — 모든 모드에서 표시 */}
      <div data-tour="visual-strip" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50/60 via-blue-50/40 to-cyan-50/40 dark:from-violet-900/20 dark:via-blue-900/10 dark:to-cyan-900/10 p-2 print:hidden">
          <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider px-1.5">🎬 비주얼 (5사 강점 통합)</span>
          <button onClick={() => activatePanel(showLiveScene ? null : "live")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showLiveScene ? "bg-emerald-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🎬 실시간 절삭
          </button>
          <button onClick={() => activatePanel(show3DPreview ? null : "3d")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${show3DPreview ? "bg-blue-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🔄 3D 엔드밀
          </button>
          <button onClick={() => activatePanel(showBlueprint ? null : "blueprint")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showBlueprint ? "bg-cyan-600 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            📐 도면
          </button>
          <button onClick={() => setShowBlueprintGallery(true)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🖼 갤러리(6)
          </button>
          <button onClick={() => activatePanel(showAnalogGauges ? null : "gauges")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showAnalogGauges ? "bg-rose-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🎛 게이지
          </button>
          <button onClick={() => setShowHeroDisplay(v => !v)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showHeroDisplay ? "bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            ✨ 영웅 KPI
          </button>
          <button onClick={() => activatePanel(showWearGauge ? null : "wear")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showWearGauge ? "bg-amber-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🔧 마모 게이지
          </button>
          <button onClick={() => activatePanel(advancedMetricsOpen ? null : "advanced")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${advancedMetricsOpen ? "bg-violet-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🔬 고급 지표
          </button>
          <button onClick={() => activatePanel(showBreakEven ? null : "break-even")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showBreakEven ? "bg-emerald-600 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            💰 Break-Even
          </button>
          <button onClick={() => activatePanel(showToolPath ? null : "tool-path")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showToolPath ? "bg-sky-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🗺 툴패스
          </button>
          <button onClick={() => activatePanel(showVibration ? null : "vibration")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showVibration ? "bg-fuchsia-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            📡 진동
          </button>
          <button onClick={() => activatePanel(showTempHeatmap ? null : "temp")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showTempHeatmap ? "bg-orange-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🌡 온도
          </button>
          <button onClick={() => activatePanel(showForceVec ? null : "force")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showForceVec ? "bg-indigo-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            ➡ 힘 벡터
          </button>
          <ToolbarDivider darkMode={darkMode} />
          <button onClick={handleUndo} disabled={!history.canUndo} title="Undo (Ctrl+Z)"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${history.canUndo ? (darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50") : "opacity-30 cursor-not-allowed bg-white text-slate-400"}`}>
            ↶
          </button>
          <button onClick={handleRedo} disabled={!history.canRedo} title="Redo (Ctrl+Y)"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${history.canRedo ? (darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50") : "opacity-30 cursor-not-allowed bg-white text-slate-400"}`}>
            ↷
          </button>
          <span className={`text-[10px] font-mono ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{history.historyCount}</span>

          <ToolbarDivider darkMode={darkMode} />
          <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider px-1">🎓 학습</span>
          <button onClick={() => setWizardOpen(true)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🧙 위저드
          </button>
          <button onClick={() => setTutorialOpen(true)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🎯 투어
          </button>
          <button onClick={() => activatePanel(showCheatSheet ? null : "cheat")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showCheatSheet ? "bg-indigo-600 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            📋 치트시트
          </button>
          <a href="/simulator_v2/glossary" target="_blank" rel="noreferrer"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            📚 용어사전 ↗
          </a>
          <button onClick={() => activatePanel(showVideoPanel ? null : "video")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showVideoPanel ? "bg-red-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🎥 가공영상
          </button>
          <button onClick={() => activatePanel(showLeaderboard ? null : "leaderboard")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showLeaderboard ? "bg-amber-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🏆 리더보드
          </button>
          <button onClick={() => activatePanel(showFavorites ? null : "favorites")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showFavorites ? "bg-amber-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            ⭐ 즐겨찾기
          </button>
          <button onClick={() => activatePanel(show3DScene ? null : "3d-scene")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${show3DScene ? "bg-gradient-to-r from-sky-500 via-violet-500 to-fuchsia-500 text-white shadow-lg" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🎮 3D 씬
          </button>
          <button onClick={() => activatePanel(showAutoAgent ? null : "auto-agent")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${showAutoAgent ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-sm" : darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
            🤖 자율 AI
          </button>
          <button onClick={async () => {
            try {
              await generateWorkInstructionPDF({
                state: {
                  productCode, edpCode: productCode, isoGroup, subgroupKey,
                  operation, coating, diameter, fluteCount,
                  activeShape, cornerR, LOC, OAL, shankDia, stickoutMm,
                  Vc: VcEff, fz: fzEff, ap, ae,
                },
                results: { n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc, torque: advanced.torque, deflection: advanced.deflection, toolLifeMin, Ra: raUm },
                warnings,
                meta: { companyName: "YG-1", shareUrl: typeof window !== "undefined" ? window.location.href : undefined },
              })
              toast.success("📄 가공 지시서 PDF 다운로드")
            } catch { toast.error("지시서 생성 실패") }
          }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${darkMode ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100"}`}>
            📄 지시서
          </button>
          {simMode.showVendorTags && <VendorTag featureId="provenance-panel" size="xs" darkMode={darkMode} />}
      </div>

      {/* 상관관계 라이브 스트립 — 현재 적용되는 multiplier 투명하게 공개 */}
      {autoCorrelate && (
        <>
          <button
            type="button"
            data-testid="live-correlation-trigger"
            onClick={() => setLiveCorrelationOpen(true)}
            className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-purple-200 bg-purple-50/40 px-3 py-2 text-left text-[10px] transition hover:border-purple-300 hover:bg-purple-50/70"
          >
            <span className="font-semibold text-purple-800">🔗 LIVE 상관관계:</span>
            <CorrChip label="Coolant" value={`×${coolantMult}`} active={coolantMult !== 1} />
            <CorrChip label="Coating" value={`×${coatingMult}`} active={coatingMult !== 1} />
            <CorrChip label="Hardness" value={`×${hardDerate.toFixed(2)}`} active={hardDerate !== 1} />
            <CorrChip label="Stickout" value={`Vc×${stickoutD.vc} fz×${stickoutD.fz}`} active={stickoutD.vc !== 1} />
            <CorrChip label="Workholding" value={`ap≤${whCap.apMax.toFixed(1)} ae≤${whCap.aeMax.toFixed(1)}`} active />
            <CorrChip label="Climb" value={climb ? `Ra×0.8 F×0.9 Life×1.15` : `baseline`} active={climb} />
            <span className="rounded-full border border-purple-200 bg-white/80 px-2 py-0.5 font-semibold text-purple-700">상세 팝업</span>
            <span className="ml-auto text-purple-700 font-mono">Vc_eff = {Vc.toFixed(0)} × {((1 + speedPct/100) * coolantMult * coatingMult * hardDerate * stickoutD.vc).toFixed(2)} = <b>{VcEff.toFixed(0)}</b> m/min</span>
          </button>
          <Dialog open={liveCorrelationOpen} onOpenChange={setLiveCorrelationOpen}>
            <DialogContent data-testid="live-correlation-popover" className="max-w-2xl border-purple-200 bg-white p-0">
              <DialogHeader className="border-b border-purple-100 bg-gradient-to-r from-purple-50 via-white to-fuchsia-50 px-6 py-4">
                <DialogTitle className="text-purple-900">LIVE 상관관계 상세</DialogTitle>
                <DialogDescription className="text-purple-700">
                  지금 적용 중인 multiplier와 clamp를 팝업으로 고정해서 확인합니다.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 px-6 py-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <CorrelationDetailCard label="Coolant" value={`×${coolantMult}`} note="절삭속도 보정" />
                  <CorrelationDetailCard label="Coating" value={`×${coatingMult}`} note="절삭속도 보정" />
                  <CorrelationDetailCard label="Hardness" value={`×${hardDerate.toFixed(2)}`} note="경도 derate" />
                  <CorrelationDetailCard label="Stickout" value={`Vc ×${stickoutD.vc} / fz ×${stickoutD.fz}`} note="돌출 길이 영향" />
                  <CorrelationDetailCard label="Workholding" value={`ap ≤ ${whCap.apMax.toFixed(1)} / ae ≤ ${whCap.aeMax.toFixed(1)}`} note="고정 조건 clamp" />
                  <CorrelationDetailCard label="Climb" value={climb ? "Ra ×0.8 / Feed ×0.9 / Life ×1.15" : "baseline"} note="절삭 방향 영향" />
                </div>
                <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">Effective Formula</div>
                  <div className="mt-1 font-mono text-sm text-purple-900">
                    Vc_eff = {Vc.toFixed(0)} × {((1 + speedPct / 100) * coolantMult * coatingMult * hardDerate * stickoutD.vc).toFixed(2)} = {VcEff.toFixed(0)} m/min
                  </div>
                  <div className="mt-2 text-[11px] text-purple-700">
                    Feed 보정은 fz × {stickoutD.fz} 와 hardness derate를 기준으로 동작합니다.
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      <div
        data-testid="primary-parameter-map"
        className="sticky top-3 z-30 rounded-xl border border-blue-200 bg-white/92 p-3 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setShowPrimaryParameterMap(v => !v)}
          className="mb-2 flex w-full items-center justify-between gap-2 text-left"
        >
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-800">핵심 파라미터 맵</div>
            <div className="text-[10px] text-blue-600">상단 고정 상태로 따라다니며 모든 계산에 즉시 연동됩니다.</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-mono text-blue-700">
              Vc {Vc.toFixed(0)} / fz {fz.toFixed(4)} / ap {ap.toFixed(1)} / ae {ae.toFixed(1)} / Stick {stickoutMm.toFixed(1)}
            </span>
            <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              {showPrimaryParameterMap ? "접기" : "펼치기"}
            </span>
          </div>
        </button>
        {showPrimaryParameterMap && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-5">
              <MiniGaugeControl label="Vc" unit="m/min" value={Vc} min={Math.round(range.VcMin)} max={Math.round(range.VcMax)} step={1} decimals={0} color="sky" onChange={v => setVc(Math.round(v))} />
              <MiniGaugeControl label="fz" unit="mm/t" value={fz} min={range.fzMin} max={range.fzMax} step={0.001} decimals={4} color="emerald" onChange={v => setFz(parseFloat(v.toFixed(4)))} />
              <MiniGaugeControl label="ap" unit="mm" value={ap} min={0.1} max={range.apMax} step={0.1} decimals={1} color="amber" disabled={apLocked} onChange={v => !apLocked && setAp(parseFloat(v.toFixed(1)))} />
              <MiniGaugeControl label="ae" unit="mm" value={ae} min={0.1} max={range.aeMax} step={0.1} decimals={1} color="violet" disabled={aeLocked} onChange={v => !aeLocked && setAe(parseFloat(v.toFixed(1)))} />
              <MiniGaugeControl label="Stick" unit="mm" value={stickoutMm} min={3} max={diameter * 10} step={0.5} decimals={1} color="sky" onChange={v => { setStickoutMm(v); setStickoutManual(true) }} />
            </div>
            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-3">
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
                <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50/70 p-2">
                  <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Engagement</div>
                  <EngagementCircle ae={ae} D={diameter} className="w-full h-16" />
                </div>
                <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50/70 p-2">
                  <div className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Cutting Action</div>
                  <CuttingAction shape={activeShape} D={diameter} LOC={LOC} ap={ap} ae={ae} toolPath={toolPath} className="w-full" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {(showLiveScene || show3DPreview || showBlueprint || showAnalogGauges || showWearGauge || advancedMetricsOpen || showBreakEven || showToolPath || showVibration || showTempHeatmap || showForceVec || showCheatSheet || showVideoPanel || showLeaderboard || showFavorites || show3DScene || showAutoAgent || beforeAfterData) && (
        <div className="space-y-3 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50/60 via-white to-cyan-50/60 p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-800">비주얼 스테이지</div>
              <div className="text-[11px] text-violet-700">토글한 패널이 스트립 바로 아래에서 바로 열립니다.</div>
            </div>
            <button
              type="button"
              onClick={() => activatePanel(null)}
              className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
            >
              모두 닫기
            </button>
          </div>

          {show3DScene && (
            <div key={`3d-${panelInstance}`} data-visual-panel="3d-scene" className="scroll-mt-20 space-y-3">
              <OperationPicker value={operationType} onChange={setOperationType} darkMode={darkMode} />
              <HolographicFrame accent="violet" intensity="strong" scanlines cornerBrackets darkMode={darkMode}>
                <div className="p-2">
                  <Cutting3DScene
                    operationType={(operationType === "finishing" || operationType === "profiling" || operationType === "pocketing") ? "endmill-general" : operationType as "endmill-general" | "roughing" | "turning" | "drilling" | "slotting"}
                    shape={activeShape}
                    diameter={diameter}
                    flutes={fluteCount}
                    LOC={LOC}
                    OAL={OAL}
                    rpm={result.n}
                    Vf={result.Vf}
                    ap={ap}
                    ae={ae}
                    stockL={stockL}
                    stockW={stockW}
                    stockH={stockH}
                    coating={coating}
                    darkMode={darkMode}
                    height={480}
                  />
                </div>
              </HolographicFrame>
            </div>
          )}

          {showFavorites && (
            <div data-visual-panel="favorites" className="scroll-mt-20">
              <FavoritesPanel
                darkMode={darkMode}
                currentState={{
                  isoGroup, subgroupKey, operation, coating,
                  Vc: VcEff, fz: fzEff, ap, ae,
                  diameter, fluteCount, activeShape,
                }}
                onApply={(entry) => {
                  setIsoGroup(entry.isoGroup)
                  setSubgroupKey(entry.subgroupKey)
                  setOperation(entry.operation)
                  setCoating(entry.coating)
                  setVc(entry.Vc); setFz(entry.fz); setAp(entry.ap); setAe(entry.ae)
                  setDiameter(entry.diameter); setFluteCount(entry.fluteCount)
                  setActiveShape(entry.activeShape as Exclude<EndmillShape, "all">)
                  toast.success(`⭐ "${entry.name}" 적용`)
                }}
              />
            </div>
          )}

          {showCheatSheet && (
            <div data-visual-panel="cheat" className="scroll-mt-20">
              <CheatSheetPanel
                currentIsoGroup={isoGroup}
                currentCoating={coating}
                currentVc={VcEff}
                currentFz={fzEff}
                darkMode={darkMode}
                expanded={showCheatSheet}
                onToggle={() => setShowCheatSheet(v => !v)}
              />
            </div>
          )}

          {showAnalogGauges && (
            <div data-visual-panel="gauges" className="scroll-mt-20">
              <HolographicFrame accent="rose" intensity="medium" scanlines darkMode={darkMode}>
                <div className="p-2">
                  <AnalogGauges
                    rpm={result.n}
                    rpmMax={maxRpm}
                    Vf={result.Vf}
                    VfMax={maxIpm * 25.4}
                    Pc={result.Pc}
                    PcMax={maxKw}
                    toolLifePct={Math.min(100, Math.max(0, (toolLifeMin / 120) * 100))}
                    chatterRisk={chatter.risk}
                    darkMode={darkMode}
                  />
                </div>
              </HolographicFrame>
            </div>
          )}

          {showVideoPanel && (
            <div data-visual-panel="video" className="scroll-mt-20">
              <Yg1VideoPanel isoGroup={isoGroup} operation={operation} darkMode={darkMode} />
            </div>
          )}

          {showLeaderboard && (
            <div data-visual-panel="leaderboard" className="scroll-mt-20">
              <BenchmarkLeaderboard
                darkMode={darkMode}
                currentState={{
                  isoGroup, operation, Vc: VcEff, fz: fzEff, ap, ae,
                  diameter, fluteCount,
                  MRR: result.MRR, toolLifeMin, Pc: result.Pc, Ra: raUm,
                }}
                onLoadEntry={(e) => {
                  setVc(e.Vc); setFz(e.fz); setAp(e.ap); setAe(e.ae)
                  setDiameter(e.diameter); setFluteCount(e.fluteCount)
                  setIsoGroup(e.isoGroup)
                  setOperation(e.operation)
                  toast.success(`🏆 ${e.nickname || "익명"} 조건 로드`)
                }}
              />
            </div>
          )}

          {showAutoAgent && (
            <div data-visual-panel="auto-agent" className="scroll-mt-20">
              <AiAutoAgentPanel
                darkMode={darkMode}
                currentState={{
                  Vc, fz, ap, ae, diameter, fluteCount, activeShape,
                  isoGroup, subgroupKey, operation, coating,
                  workholding, stickoutMm, hardnessScale, hardnessValue,
                }}
                onApply={(opt) => {
                  setBeforeAfterData({
                    before: { Vc: VcEff, fz: fzEff, ap, ae, n: result.n, Vf: result.Vf, MRR: result.MRR, Pc: result.Pc, toolLifeMin, Ra: raUm },
                    after: opt,
                    reasoning: "AI 자율 에이전트가 여러 조건을 탐색한 결과 최고 점수 조합",
                  })
                  setVc(opt.Vc); setFz(opt.fz); setAp(opt.ap); setAe(opt.ae)
                  toast.success("🏆 자율 AI 최고 조건 적용")
                }}
              />
            </div>
          )}

          {beforeAfterData && (
            <div data-visual-panel="before-after" className="scroll-mt-20">
              <BeforeAfterCompare
                before={beforeAfterData.before}
                after={beforeAfterData.after}
                reasoning={beforeAfterData.reasoning}
                darkMode={darkMode}
                onRevert={() => {
                  const b = beforeAfterData.before
                  setVc(b.Vc); setFz(b.fz); setAp(b.ap); setAe(b.ae)
                  setBeforeAfterData(null)
                  toast.info("↺ 원래 조건 복원")
                }}
              />
            </div>
          )}

          {showLiveScene && (
            <div data-section="live-scene" data-visual-panel="live" className="scroll-mt-20 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">🎬 실시간 절삭 시뮬레이션
                  <FeatureExplainer featureId="live-scene" inline darkMode={darkMode} />
                  {simMode.showVendorTags && <VendorTag featureId="real-time-warnings" size="xs" darkMode={darkMode} />}
                </h4>
                <button onClick={() => setShowLiveScene(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
              </div>
              <LiveCuttingScene
                shape={activeShape}
                diameter={diameter}
                flutes={fluteCount}
                helixAngle={helixAngleDeg}
                Vc={VcEff}
                Vf={result.Vf}
                rpm={result.n}
                ap={ap}
                ae={ae}
                stickoutMm={stickoutMm}
                materialGroup={isoGroup}
                chatterRisk={chatter.level}
                bueRisk={advBue.risk}
                chipMorph={advChipMorph.type}
                darkMode={darkMode}
              />
            </div>
          )}

          {(show3DPreview || showBlueprint) && (
            <div data-visual-panel={show3DPreview ? "3d" : "blueprint"} className="grid grid-cols-1 lg:grid-cols-2 gap-3 scroll-mt-20">
              {show3DPreview && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">🔄 3D 엔드밀 프리뷰
                      <FeatureExplainer featureId="3d-endmill" inline darkMode={darkMode} />
                      {simMode.showVendorTags && <VendorTag featureId="shopfloor-card" size="xs" darkMode={darkMode} />}
                    </h4>
                    <button onClick={() => setShow3DPreview(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="flex justify-center">
                    <Endmill3DPreview
                      shape={activeShape}
                      diameter={diameter}
                      flutes={fluteCount}
                      rpm={result.n}
                      helixAngle={helixAngleDeg}
                      cornerR={cornerR}
                      coating={coating}
                      darkMode={darkMode}
                    />
                  </div>
                </div>
              )}
              {showBlueprint && (
                <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">📐 YG-1 기술 도면
                      <FeatureExplainer featureId="blueprint" inline darkMode={darkMode} />
                      {simMode.showVendorTags && <VendorTag featureId="provenance-panel" size="xs" darkMode={darkMode} />}
                    </h4>
                    <button onClick={() => setShowBlueprint(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <ToolBlueprint
                    shape={activeShape}
                    diameter={diameter}
                    shankDia={shankDia}
                    LOC={LOC}
                    OAL={OAL}
                    flutes={fluteCount}
                    helixAngle={helixAngleDeg}
                    cornerR={cornerR}
                    coating={coating}
                    seriesCode={productCode || undefined}
                    darkMode={darkMode}
                  />
                </div>
              )}
            </div>
          )}

          {(showToolPath || showVibration) && (
            <div data-visual-panel={showToolPath ? "tool-path" : "vibration"} className="grid grid-cols-1 lg:grid-cols-2 gap-3 scroll-mt-20">
              {showToolPath && (
                <div className="rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">🗺 가공 경로 애니메이션
                      <FeatureExplainer featureId="tool-path" inline darkMode={darkMode} />
                      {simMode.showVendorTags && <VendorTag featureId="beginner-matrix" size="xs" darkMode={darkMode} />}
                    </h4>
                    <button onClick={() => setShowToolPath(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <ToolPathScene
                    strategy={(toolPath === "slot" ? "zigzag" : toolPath === "adaptive" ? "adaptive" : toolPath === "trochoidal" ? "trochoidal" : "zigzag") as "zigzag" | "spiral" | "trochoidal" | "adaptive"}
                    stockWidth={stockW}
                    stockLength={stockL}
                    diameter={diameter}
                    ae={ae}
                    Vf={result.Vf}
                    shape={activeShape}
                    darkMode={darkMode}
                  />
                </div>
              )}
              {showVibration && (
                <div className="rounded-xl border border-fuchsia-200 dark:border-fuchsia-800 bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">📡 스핀들 진동 오실로스코프
                      <FeatureExplainer featureId="vibration" inline darkMode />
                      {simMode.showVendorTags && <VendorTag featureId="chatter-analyzer" size="xs" darkMode />}
                    </h4>
                    <button onClick={() => setShowVibration(false)} className="text-xs text-slate-400 hover:text-rose-400"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <VibrationOscilloscope
                    rpm={result.n}
                    chatterRisk={chatter.risk}
                    chatterLevel={chatter.level === "med" ? "med" : chatter.level}
                    flutes={fluteCount}
                    stickoutMm={stickoutMm}
                    diameter={diameter}
                    darkMode
                  />
                </div>
              )}
            </div>
          )}

          {(showTempHeatmap || showForceVec) && (
            <div data-visual-panel={showTempHeatmap ? "temp" : "force"} className="grid grid-cols-1 lg:grid-cols-2 gap-3 scroll-mt-20">
              {showTempHeatmap && (
                <div className="rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">🌡 절삭 온도 히트맵
                      <FeatureExplainer featureId="temperature" inline darkMode={darkMode} />
                      {simMode.showVendorTags && <VendorTag featureId="heat-estimation" size="xs" darkMode={darkMode} />}
                    </h4>
                    <button onClick={() => setShowTempHeatmap(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <TemperatureHeatmap
                    chipTempC={advHeat.chipTempC}
                    toolTempC={advHeat.toolTempC}
                    workpieceTempC={advHeat.workpieceTempC}
                    chipHeatPct={advHeat.chipHeatPct}
                    Vc={VcEff}
                    materialGroup={isoGroup}
                    darkMode={darkMode}
                  />
                </div>
              )}
              {showForceVec && (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1.5">➡ 절삭력 벡터
                      <FeatureExplainer featureId="force-vector" inline darkMode={darkMode} />
                      {simMode.showVendorTags && <VendorTag featureId="heat-estimation" size="xs" darkMode={darkMode} />}
                    </h4>
                    <button onClick={() => setShowForceVec(false)} className="text-xs text-gray-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="flex justify-center">
                    <ForceVectorDiagram
                      tangentialForceN={advHelix.tangentialForceN}
                      radialForceN={advHelix.radialForceN}
                      axialForceN={advHelix.axialForceN}
                      helixAngle={helixAngleDeg}
                      liftRatio={advHelix.liftRatio}
                      diameter={diameter}
                      darkMode={darkMode}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {showWearGauge && (
            <div data-section="wear-gauge" data-visual-panel="wear" className="scroll-mt-20">
              <WearGaugePanel
                predictedLifeMin={toolLifeMin}
                currentVc={VcEff}
                vcRef={Vc}
                darkMode={darkMode}
              />
            </div>
          )}

          <div data-visual-panel="advanced" className="scroll-mt-20">
            <AdvancedMetricsPanel
              heat={advHeat}
              runout={advRunout}
              helix={advHelix}
              monteCarlo={advMonteCarlo}
              bue={advBue}
              chipMorph={advChipMorph}
              darkMode={darkMode}
              expanded={advancedMetricsOpen}
              onToggle={() => setAdvancedMetricsOpen(v => !v)}
            />
          </div>

          {showBreakEven && (
            <div data-visual-panel="break-even" className="scroll-mt-20">
              <BreakEvenChart
                currentVc={VcEff}
                taylorVcRef={Vc}
                toolCostKrw={toolCostKrw}
                machineCostPerHourKrw={machineCostPerHourKrw}
                taylorN={0.25}
                cycleTimeMin={cycleTimeMin}
                darkMode={darkMode}
              />
            </div>
          )}
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

      {harveyReplacementPair && harveyReplacementCards.length === 3 && (
        <div
          data-section="dual-replacement-sim"
          data-testid="dual-replacement-sim"
          className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">Harvey · Sandvik · YG-1 3자 시뮬레이션</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{harveyReplacementPair.preset.title}</div>
              <div className="text-[12px] text-slate-600">{harveyReplacementPair.preset.subtitle} · 현재 op {operation}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {HARVEY_REPLACEMENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedHarveyReplacementId(preset.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    preset.id === harveyReplacementPair.preset.id
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-amber-200 bg-white text-amber-800 hover:bg-amber-50"
                  }`}
                >
                  {preset.title}
                </button>
              ))}
              <button
                type="button"
                onClick={loadHarveyReplacementPairToSnapshots}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                A/B/C 비교로 올리기
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { key: "split", label: "분할 보기" },
              { key: "flutes", label: "날수 보기" },
              { key: "live", label: "LIVE 보기" },
            ].map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => setReplacementVisualMode(mode.key as "split" | "flutes" | "live")}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  replacementVisualMode === mode.key
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2 rounded-xl border border-amber-200 bg-white/80 p-3 lg:grid-cols-5">
            <CompareControlSlider label="Vc" value={replacementVcScale} min={70} max={140} step={5} suffix="%" onChange={setReplacementVcScale} />
            <CompareControlSlider label="fz" value={replacementFzScale} min={70} max={140} step={5} suffix="%" onChange={setReplacementFzScale} />
            <CompareControlSlider label="ap" value={replacementApRatio} min={10} max={120} step={5} suffix="%D" onChange={setReplacementApRatio} />
            <CompareControlSlider label="ae" value={replacementAeRatio} min={5} max={80} step={5} suffix="%D" onChange={setReplacementAeRatio} />
            <CompareControlSlider label="Stick" value={replacementStickoutRatio} min={200} max={700} step={25} suffix="%D" onChange={setReplacementStickoutRatio} />
          </div>

          <div className="mb-3 rounded-xl border border-dashed border-amber-200 bg-white/70 px-3 py-2 text-[12px] text-amber-900">
            3자 시각화 분할 화면입니다. 위 공통 슬라이더를 움직이면 Harvey, Sandvik, YG-1 세 카드가 같은 축으로 동시에 갱신됩니다.
          </div>
          <div data-testid="ab-visual-split" className="mt-4 grid gap-3 lg:grid-cols-3">
            {harveyReplacementCards.map((card, index) => (
              <ReplacementSimCard
                key={card.tool.id}
                title={index === 0 ? "A · Harvey 기준" : index === 1 ? "B · Sandvik 비교" : "C · YG-1 대체품"}
                card={card}
                visualMode={replacementVisualMode}
                onApply={index === 1 ? () => {
                  setProductCode(card.tool.series)
                  setDiameter(card.tool.D)
                  setFluteCount(card.tool.Z)
                  setActiveShape(card.tool.shape)
                  setLOC(card.tool.LOC)
                  setVc(Math.round(card.tool.Vc))
                  setFz(card.tool.fz)
                  setAp(card.ap)
                  setAe(card.ae)
                  setIsoGroup(card.tool.iso)
                  setEverInteracted(true)
                  toast.success(`${card.tool.brand} ${card.tool.series} 조건을 메인 시뮬레이터에 반영했습니다`)
                } : index === 2 ? () => {
                  setProductCode(card.tool.series)
                  setDiameter(card.tool.D)
                  setFluteCount(card.tool.Z)
                  setActiveShape(card.tool.shape)
                  setLOC(card.tool.LOC)
                  setVc(Math.round(card.tool.Vc))
                  setFz(card.tool.fz)
                  setAp(card.ap)
                  setAe(card.ae)
                  setIsoGroup(card.tool.iso)
                  setEverInteracted(true)
                  toast.success(`${card.tool.brand} ${card.tool.series} 조건을 메인 시뮬레이터에 반영했습니다`)
                } : undefined}
              />
            ))}
          </div>
        </div>
      )}

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
            <MiniSelect eduId="flutes" label="Flutes" value={String(fluteCount)} onChange={v => setFluteCount(parseInt(v))}
              options={[1,2,3,4,5,6].map(n => ({ value: String(n), label: `${n}날` }))} />
            <MiniSelect eduId="edp" label="재질" value={toolMaterial} onChange={setToolMaterial}
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
          <MiniSelect eduId="iso-p" label="Subgroup" value={subgroupKey} onChange={setSubgroupKey}
            options={[{ value: "", label: "— 선택 —" }, ...activeSubgroups.map(s => ({ value: s.key, label: s.label }))]} />
          {currentSubgroup && currentSubgroup.conditions.length > 0 && (
            <MiniSelect eduId="iso-p" label="Condition" value={condition} onChange={setCondition}
              options={currentSubgroup.conditions.map(c => ({ value: c, label: c }))} />
          )}
          <div>
            <label className="text-[10px] text-gray-500 dark:text-slate-400 font-medium">경도 (Hardness)</label>
            {/* Harvey MAP 스타일 — 세그먼트 토글 한 줄 */}
            <div className={`mt-1 inline-flex w-full items-stretch rounded-lg border p-0.5 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
              {(["HRC","HBW","HRB","HBS"] as HardnessScale[]).map(sc => {
                const active = hardnessScale === sc
                const tooltip = sc === "HRC" ? "록웰 C (강철 경화용, 20~70)"
                  : sc === "HBW" ? "브리넬 W (무른 금속, 100~650)"
                  : sc === "HRB" ? "록웰 B (연강/비철, 40~100)"
                  : "브리넬 S (참고 · HBW 동의어)"
                return (
                  <button key={sc} title={tooltip}
                    onClick={() => {
                      const newVal = convertHardness(hardnessValue, hardnessScale, sc)
                      setHardnessScale(sc); setHardnessValue(newVal)
                    }}
                    className={`flex-1 rounded-md px-2 py-1 text-[10px] font-bold tracking-wider transition-all ${
                      active
                        ? "bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-sm ring-1 ring-blue-700/40"
                        : darkMode
                          ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                    }`}>
                    {sc}
                  </button>
                )
              })}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input type="number" value={hardnessValue}
                onChange={e => setHardnessValue(parseFloat(e.target.value) || 0)}
                min={0} max={hardnessScale === "HBW" ? 700 : 100} step={1}
                className={`flex-1 rounded-md border px-2 py-1.5 text-sm font-mono font-bold ${darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-300 bg-white text-slate-900"}`} />
              <span className={`text-[11px] font-semibold ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{hardnessScale}</span>
            </div>
            {/* 경도 범위 시각화 바 (Harvey 느낌) */}
            <div className={`mt-1.5 relative h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
              {(() => {
                const maxVal = hardnessScale === "HBW" ? 700 : 100
                const pct = Math.min(100, Math.max(0, (hardnessValue / maxVal) * 100))
                const color = hardnessValue < (hardnessScale === "HBW" ? 200 : 25) ? "from-emerald-400 to-emerald-500"
                  : hardnessValue < (hardnessScale === "HBW" ? 400 : 45) ? "from-amber-400 to-amber-500"
                  : "from-rose-500 to-rose-600"
                return (
                  <>
                    <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                    <div className="absolute inset-0 flex justify-between px-1 text-[7px] font-mono text-white/80 items-center pointer-events-none">
                      <span>연</span>
                      <span>경</span>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
          {catalogData?.facets && catalogData.facets.workpieces.length > 0 && (
            <MiniSelect label={`세부소재 (${catalogData.facets.workpieces.length})`} value={workpiece} onChange={setWorkpiece}
              options={[{ value: "", label: "전체" }, ...catalogData.facets.workpieces.map(w => ({ value: w, label: w }))]} />
          )}
          <div className="text-[9px] text-gray-400">kc = {KC_TABLE[isoGroup] ?? 2000} N/mm²</div>
        </CardShell>

        {/* ─ OPERATION ─ */}
        <CardShell title="OPERATION" icon={<span className="text-[12px]">📐</span>} onReset={() => { setOperation("Side_Milling"); setToolPath("conventional") }} eduId="hem" eduSection="operation">
          <MiniSelect eduId="slotting" label="Type" value={operation} onChange={setOperation} options={[
            { value: "Side_Milling", label: "Side Milling 측면" },
            { value: "Slotting", label: "Slotting 슬롯" },
            { value: "Profiling", label: "Profiling 윤곽" },
            { value: "Facing", label: "Facing 정면" },
            { value: "Pocketing", label: "Pocketing 포켓" },
          ]} />
          <MiniSelect eduId="hem" label="Tool Path" value={toolPath} onChange={v => { setToolPath(v); setStrategy("") }}
            options={TOOL_PATHS.map(tp => ({ value: tp.key, label: tp.label }))} />
          {STRATEGY_OPTIONS[toolPath] && (
            <MiniSelect eduId="hem" label="Strategy (MAP 2.0)" value={strategy} onChange={setStrategy}
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
          <MiniSelect eduId="spindle-preset" label="Spindle" value={spindleKey} onChange={setSpindleKey}
            options={SPINDLE_PRESETS.map(s => ({ value: s.key, label: s.label }))} />
          <MiniSelect eduId="er-collet" label="Holder" value={holderKey} onChange={setHolderKey}
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
          <MiniSelect eduId="flood-coolant" label="Coolant 💧" value={coolant} onChange={setCoolant}
            options={COOLANTS.map(c => ({ value: c.key, label: c.label }))} />
          <MiniSelect eduId="altin-coating" label="Coating ✨" value={coating} onChange={setCoating}
            options={COATINGS.map(c => ({ value: c.key, label: `${c.label} ×${c.vcMultiplier}` }))} />
          <div className="text-[9px] text-gray-400">
            Vc 보정 = coolant ×{coolantMult} · coating ×{coatingMult}
          </div>
        </CardShell>
      </div>

      {/* ══════ PARAMETERS ══════ */}
      <div className="rounded-xl border border-gray-200 bg-white p-4" data-edu-section="parameters">
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
            <PctSlider label="넥 직경" unit="mm" value={stickoutMm} pct={(stickoutMm / diameter) * 100} pctLabel="·D"
              min={3} max={diameter * 10} step={0.5}
              onChange={v => { setStickoutMm(v); setStickoutManual(true) }}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(stickoutMm), unit: "in", decimals: 3 } : undefined}
              eduId="stick-out"
              warnings={warnings} paramKey="stickout" darkMode={darkMode} />
            <PctSlider eduId="vc" label="Vc (절삭속도)" unit="m/min" value={Vc} pct={speedPct}
              min={Math.round(range.VcMin)} max={Math.round(range.VcMax)} step={1}
              onChange={v => setVc(Math.round(v))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mPerMinToSFM(Vc), unit: "SFM", decimals: 0 } : undefined}
              warnings={warnings} paramKey="Vc" darkMode={darkMode} />
            <PctSlider eduId="fz" label="fz (날당이송)" unit="mm/t" value={fz} pct={feedPct}
              min={range.fzMin} max={range.fzMax} step={0.001} decimals={4}
              onChange={v => setFz(parseFloat(v.toFixed(4)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(fz), unit: "in/t", decimals: 5 } : undefined}
              warnings={warnings} paramKey="fz" darkMode={darkMode} />
            <PctSlider eduId="adoc" label="ap (축방향 절입)" unit="mm" value={ap} pct={(ap / diameter) * 100} pctLabel="·D"
              locked={apLocked} onLockToggle={() => setApLocked(!apLocked)}
              min={0.1} max={range.apMax} step={0.1} decimals={1}
              onChange={v => !apLocked && setAp(parseFloat(v.toFixed(1)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(ap), unit: "in", decimals: 3 } : undefined}
              warnings={warnings} paramKey="ap" darkMode={darkMode} />
            <PctSlider eduId="rdoc" label="ae (경방향 절입)" unit="mm" value={ae} pct={(ae / diameter) * 100} pctLabel="·D"
              locked={aeLocked} onLockToggle={() => setAeLocked(!aeLocked)}
              min={0.1} max={range.aeMax} step={0.1} decimals={1}
              onChange={v => !aeLocked && setAe(parseFloat(v.toFixed(1)))}
              secondary={displayUnit !== "metric" ? { value: UNITS.mmToIn(ae), unit: "in", decimals: 3 } : undefined}
              warnings={warnings} paramKey="ae" darkMode={darkMode} />
          </div>

          {/* 주요 파라미터 맵: 스크롤 중에도 따라다니는 시각 패널 */}
          <div className="flex flex-col gap-3 self-start">
            <div className="rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-800">가공 단면 맵</div>
                  <div className="text-[10px] text-blue-600">상단 핵심 파라미터 맵과 동일 상태를 시각적으로 보여줍니다.</div>
                </div>
                <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5 text-[9px] font-mono text-blue-700">
                  ap {ap.toFixed(1)} / ae {ae.toFixed(1)}
                </span>
              </div>
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
        <MetricCard eduId="n" label="RPM (n)" value={result.n} unit="rpm" sub={derived.Deff !== diameter ? `D_eff ${derived.Deff}mm` : undefined} accent={derived.Deff !== diameter ? "volatile" : "neutral"} animated decimals={0} />
        <MetricCard eduId="vf" label="Vf / IPM" value={result.Vf} unit="mm/min" sub={`${vfIpm.toFixed(1)} IPM`} accent="neutral" animated decimals={0} />
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-edu-section="recommendations">
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
              <CornerFeedPanelV2
                toolPath={toolPath}
                baseFeed={result.Vf}
                toolDiameter={diameter}
                cornerReductionPct={cornerReductionPct}
                onReductionChange={setCornerReductionPct}
              />
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
                  toast.success("Reverse solver 적용")
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
                  <button onClick={async () => {
                    const ok = await copyText(generateGCode({
                      n: result.n, Vf: result.Vf, ap, ae, D: diameter, toolNo: 1, dialect: gcodeDialect, coolant: coolant as any,
                    }))
                    if (ok) toast.success("GCode 복사됨")
                    else toast.error("복사 실패")
                  }} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-600 text-white">Copy</button>
                  <GCodeDownloadButton
                    state={{ productCode: productCode || "yg1-tool", diameter, fluteCount, Vc: VcEff, fz: fzEff, ap, ae, isoGroup, operation, coating, stockL, stockW, stockH }}
                    results={{ n: result.n, Vf: result.Vf }}
                    darkMode={darkMode}
                  />
                </div>
              </div>
              <InteractiveGcodeViewer
                gcode={generateGCode({ n: result.n, Vf: result.Vf, ap, ae, D: diameter, toolNo: 1, dialect: gcodeDialect, coolant: coolant as any })}
                params={{ n: result.n, Vf: result.Vf, Vc: VcEff, fz: fzEff, ap, ae, D: diameter, dialect: gcodeDialect }}
                darkMode={darkMode}
              />
            </div>
          </div>
        )}
      </div>

      {/* A/B/C/D Compare */}
      {(snapshotA || snapshotB || snapshotC || snapshotD) && (
        <div data-section="ab-compare" className="rounded-xl border border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-900/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              ⚖ 조건 비교 (A/B/C/D)
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
                  <th className="pb-1.5 pr-2 text-emerald-700">A {snapshotA ? `· ${snapshotA.label}` : "—"}</th>
                  <th className="pb-1.5 pr-2 text-indigo-700">B {snapshotB ? `· ${snapshotB.label}` : "—"}</th>
                  <th className="pb-1.5 pr-2 text-violet-700">C {snapshotC ? `· ${snapshotC.label}` : "—"}</th>
                  <th className="pb-1.5 pr-2 text-amber-700">D {snapshotD ? `· ${snapshotD.label}` : "—"}</th>
                  <th className="pb-1.5">ΔMax</th>
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
                  const c = snapshotC?.[key]
                  const d = snapshotD?.[key]
                  const vals = [a, b, c, d].filter((v): v is number => v != null)
                  const deltaMax = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null
                  const pctMax = vals.length >= 2 && Math.min(...vals) !== 0
                    ? (deltaMax! / Math.min(...vals)) * 100 : null
                  const fmt = (v: number | null | undefined) => v != null ? v.toFixed(decimals) : "—"
                  return (
                    <tr key={key} className="border-b border-gray-100 last:border-0">
                      <td className="py-1 pr-2 font-sans text-gray-600">{key}</td>
                      <td className="py-1 pr-2 text-emerald-700">{fmt(a)} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className="py-1 pr-2 text-indigo-700">{fmt(b)} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className="py-1 pr-2 text-violet-700">{fmt(c)} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className="py-1 pr-2 text-amber-700">{fmt(d)} <span className="text-gray-400 font-sans text-[9px]">{unit}</span></td>
                      <td className={`py-1 ${deltaMax == null ? "text-gray-400" : deltaMax > 0 ? "text-rose-600 font-semibold" : "text-gray-500"}`}>
                        {deltaMax == null ? "—" : deltaMax.toFixed(decimals)}
                        {pctMax != null && <span className="text-[9px] opacity-60 ml-1">({pctMax.toFixed(1)}%)</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 💬 AI 채팅 사이드바 (persistent FAB) */}
      <AiChatSidebar
        darkMode={darkMode}
        context={{ Vc: VcEff, fz: fzEff, ap, ae, diameter, fluteCount, isoGroup, operation, coating, rpm: result.n, MRR: result.MRR, Pc: result.Pc, toolLifeMin }}
      />

      {/* 🎉 Confetti Burst 전역 (스냅샷 저장 시 트리거) */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
        <ConfettiBurst trigger={confettiTrigger} />
      </div>

      {/* 🧙 초보자 위저드 모달 */}
      <BeginnerWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onApply={(preset) => {
          // BeginnerWizardPreset 구조가 WelcomePreset.params 와 동일 — 어댑터로 래핑
          applyWelcomePreset({ id: "wizard", title: "위저드 추천", subtitle: "5단계 질문 결과", icon: "🧙", color: "violet", params: preset as WelcomePreset["params"] } as WelcomePreset)
        }}
        darkMode={darkMode}
      />

      {/* 🎯 인터랙티브 튜토리얼 */}
      <InteractiveTutorial
        open={tutorialOpen}
        onOpenChange={setTutorialOpen}
        darkMode={darkMode}
      />

      {/* 🛡 플로팅 실시간 경고 HUD (우하단 sticky) */}
      <FloatingWarnings
        warnings={warnings}
        darkMode={darkMode}
        onDetailClick={() => {
          document.querySelector('[data-section="warnings"]')?.scrollIntoView({ behavior: "smooth", block: "start" })
        }}
      />

      {/* Welcome 모달 (첫 방문 자동) */}
      <WelcomeModal
        darkMode={darkMode}
        onPickExample={applyWelcomePreset}
        forceOpen={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
      />

      {/* Command Palette Ctrl+K */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        darkMode={darkMode}
        onApplyExample={applyExampleById}
        onJumpToSection={jumpToSection}
        onOpenHelp={() => setShortcutsHelpOpen(true)}
      />

      {/* 🖼 도면 갤러리 6종 (모달) */}
      {showBlueprintGallery && (
        <div className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-md overflow-y-auto p-4" onClick={() => setShowBlueprintGallery(false)}>
          <div className="max-w-6xl mx-auto mt-10" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white">📐 YG-1 엔드밀 도면 갤러리 (6종)</h3>
              <button onClick={() => setShowBlueprintGallery(false)} className="rounded-lg bg-white/10 hover:bg-white/20 text-white p-1.5"><X className="h-5 w-5" /></button>
            </div>
            <BlueprintGallery
              darkMode={darkMode}
              onApplyTool={(tool) => {
                setProductCode(tool.seriesCode)
                setDiameter(tool.diameter)
                setShankDia(tool.shankDia)
                setLOC(tool.LOC)
                setOAL(tool.OAL)
                setFluteCount(tool.flutes)
                setActiveShape(tool.shape)
                if (tool.cornerR) setCornerR(tool.cornerR)
                setCoating(tool.coating)
                setIsoGroup(tool.recommendedMaterial)
                setVc(tool.recommendedVc)
                setFz(tool.recommendedFz)
                setAp(tool.recommendedAp)
                setAe(tool.recommendedAe)
                setShowBlueprintGallery(false)
                setEverInteracted(true)
                toast.success(`✓ ${tool.seriesCode} 적용됨`, { description: `Vc ${tool.recommendedVc} · fz ${tool.recommendedFz}` })
              }}
            />
          </div>
        </div>
      )}

      {/* ═══ 단축키 도움말 모달 (Glassmorphism + 카테고리) ═══ */}
      {shortcutsHelpOpen && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setShortcutsHelpOpen(false)}
          onKeyDown={e => { if (e.key === "Escape") setShortcutsHelpOpen(false) }}
        >
          <div
            className={`relative rounded-2xl overflow-hidden w-full max-w-lg shadow-2xl ring-1 animate-in zoom-in-95 duration-200 ${
              darkMode ? "bg-slate-900 ring-slate-700 text-slate-100" : "bg-white ring-slate-200 text-gray-900"
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* 그라디언트 헤더 */}
            <div className="relative bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 px-5 py-4 text-white">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)] pointer-events-none" />
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⌨</span>
                    <h4 className="text-base font-bold tracking-tight">키보드 단축키</h4>
                    <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">v3</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/80">더 빠르게 — 마우스 없이 모든 작업을</p>
                </div>
                <button
                  onClick={() => setShortcutsHelpOpen(false)}
                  className="rounded-lg p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition"
                  aria-label="닫기"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 본문 — 카테고리별 섹션 */}
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {(Object.keys(SHORTCUT_CATEGORIES) as Array<keyof typeof SHORTCUT_CATEGORIES>).map(catKey => {
                const items = SHORTCUT_HINTS.filter(s => s.category === catKey)
                if (items.length === 0) return null
                const cat = SHORTCUT_CATEGORIES[catKey]
                const colorClass = cat.color === "emerald" ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
                  : cat.color === "orange" ? "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800"
                  : cat.color === "blue" ? "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800"
                  : "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                return (
                  <section key={catKey}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${colorClass}`}>
                        {cat.label}
                      </span>
                      <div className={`flex-1 h-px ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                    </div>
                    <ul className="space-y-1.5">
                      {items.map(s => (
                        <li
                          key={s.label}
                          className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition ${
                            darkMode ? "hover:bg-slate-800/70" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-lg leading-none flex-shrink-0">{s.icon}</span>
                            <div className="min-w-0">
                              <div className={`text-xs font-semibold truncate ${darkMode ? "text-slate-100" : "text-gray-900"}`}>
                                {s.label}
                              </div>
                              {s.description && (
                                <div className={`text-[10px] truncate ${darkMode ? "text-slate-400" : "text-gray-500"}`}>
                                  {s.description}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {s.keys.map((k, i) => (
                              <span key={i} className="flex items-center gap-1">
                                {i > 0 && <span className={`text-[9px] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>+</span>}
                                <kbd className={`font-mono font-semibold text-[10px] px-2 py-1 rounded-md border-b-2 shadow-sm ${
                                  darkMode
                                    ? "bg-gradient-to-b from-slate-700 to-slate-800 border-slate-900 text-slate-100"
                                    : "bg-gradient-to-b from-white to-slate-100 border-slate-300 text-slate-700"
                                }`}>
                                  {k}
                                </kbd>
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>

            {/* 푸터 팁 */}
            <div className={`border-t px-5 py-3 text-[10px] flex items-center justify-between ${
              darkMode ? "border-slate-700 bg-slate-900/60 text-slate-400" : "border-slate-200 bg-slate-50 text-slate-500"
            }`}>
              <span>💡 <span className="font-semibold">Tip.</span> 입력 필드 안에서는 단축키가 무시됩니다</span>
              <kbd className={`font-mono text-[10px] px-2 py-0.5 rounded border-b-2 shadow-sm ${
                darkMode ? "bg-slate-800 border-slate-900 text-slate-200" : "bg-white border-slate-300 text-slate-600"
              }`}>Esc</kbd>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div data-section="warnings" className="rounded-xl border border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-700 p-4 space-y-2 scroll-mt-20">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> 검증 경고 ({warnings.length}건)
            <FeatureExplainer featureId="warnings-hud" inline darkMode={darkMode} />
          </h4>
          <ul className="space-y-2">{warnings.map((w, i) => (
            <li key={i} className="space-y-1">
              <WarningRow w={w} />
              <div className="pl-5">
                <AiWarningExplain
                  warning={w}
                  context={{
                    Vc: VcEff, fz: fzEff, ap, ae,
                    materialGroup: isoGroup, diameter, fluteCount,
                    stickoutMm, rpm: result.n,
                  }}
                  darkMode={darkMode}
                />
              </div>
            </li>
          ))}</ul>
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

const ReplacementSimCard = memo(function ReplacementSimCard({
  title,
  card,
  visualMode,
  onApply,
}: {
  title: string
  card: {
    tool: ToolOption
    ap: number
    ae: number
    Vc: number
    fz: number
    stickoutMm: number
    helixAngle: number
    n: number
    Vf: number
    MRR: number
    Pc: number
    torque: number
    deflection: number
    toolLifeMin: number
    raUm: number
  }
  visualMode: "split" | "flutes" | "live"
  onApply?: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{card.tool.brand} {card.tool.series}</div>
          <div className="text-[12px] text-slate-600">{card.tool.label}</div>
        </div>
        <div className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${card.tool.kind === "yg1" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>
          ISO {card.tool.iso}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {Array.from({ length: card.tool.Z }, (_, i) => (
          <span key={i} className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
            flute {i + 1}
          </span>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Spec</div>
          <div className="mt-1 space-y-1 text-[12px] text-slate-700">
            <div>D {card.tool.D}mm · Z {card.tool.Z} · LOC {card.tool.LOC}mm</div>
            <div>{card.tool.shape}{card.tool.cornerR ? ` · R ${card.tool.cornerR}` : ""} · helix {card.helixAngle}°</div>
            <div>단가 ₩{card.tool.priceKrw.toLocaleString()}</div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cutting</div>
          <div className="mt-1 space-y-1 text-[12px] text-slate-700">
            <div>Vc {card.Vc} · fz {card.fz.toFixed(3)}</div>
            <div>ap {card.ap.toFixed(1)} · ae {card.ae.toFixed(1)} · stick {card.stickoutMm.toFixed(1)}</div>
            <div>RPM {Math.round(card.n).toLocaleString()} · Vf {Math.round(card.Vf).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {visualMode === "split" && (
        <div className="mt-3 grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">3D Tool View</div>
            <div className="flex justify-center">
              <Endmill3DPreview
              shape={card.tool.shape}
              diameter={card.tool.D}
              flutes={card.tool.Z}
              rpm={card.n}
              helixAngle={card.helixAngle}
              cornerR={card.tool.cornerR}
              darkMode={false}
            />
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">LIVE Cutting View</div>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <LiveCuttingScene
                shape={card.tool.shape}
                diameter={card.tool.D}
                flutes={card.tool.Z}
                helixAngle={card.helixAngle}
                Vc={card.Vc}
                Vf={card.Vf}
                rpm={card.n}
                ap={card.ap}
                ae={card.ae}
                stickoutMm={card.stickoutMm}
                materialGroup={card.tool.iso}
                chatterRisk={card.deflection > 50 ? "high" : card.deflection > 20 ? "med" : "low"}
                chipMorph={card.tool.iso === "H" ? "segmented" : card.tool.iso === "N" ? "continuous" : "discontinuous"}
                darkMode={false}
                width={320}
                height={220}
              />
            </div>
          </div>
        </div>
      )}

      {visualMode === "flutes" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">날수 보기 전용 시뮬레이션</div>
          <div className="flex justify-center">
            <Endmill3DPreview
              shape={card.tool.shape}
              diameter={card.tool.D}
              flutes={card.tool.Z}
              rpm={card.n}
              helixAngle={card.helixAngle + 4}
              cornerR={card.tool.cornerR}
              darkMode={false}
            />
          </div>
          <div className="mt-2 text-center text-[12px] text-slate-700">
            Z {card.tool.Z}날이 보이도록 공구 형상만 강조해서 보여줍니다.
          </div>
        </div>
      )}

      {visualMode === "live" && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">LIVE Cutting Only</div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <LiveCuttingScene
              shape={card.tool.shape}
              diameter={card.tool.D}
              flutes={card.tool.Z}
              helixAngle={card.helixAngle}
              Vc={card.Vc}
              Vf={card.Vf}
              rpm={card.n}
              ap={card.ap}
              ae={card.ae}
              stickoutMm={card.stickoutMm}
              materialGroup={card.tool.iso}
              chatterRisk={card.deflection > 50 ? "high" : card.deflection > 20 ? "med" : "low"}
              chipMorph={card.tool.iso === "H" ? "segmented" : card.tool.iso === "N" ? "continuous" : "discontinuous"}
              darkMode={false}
              width={360}
              height={240}
            />
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MiniStatChip label="MRR" value={`${card.MRR.toFixed(1)} cm3/min`} tone="emerald" />
        <MiniStatChip label="Life" value={`${card.toolLifeMin.toFixed(0)} min`} tone="sky" />
        <MiniStatChip label="Power" value={`${card.Pc.toFixed(2)} kW`} tone="amber" />
        <MiniStatChip label="Defl." value={`${card.deflection.toFixed(1)} um`} tone="violet" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Engagement / Action</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <EngagementCircle ae={card.ae} D={card.tool.D} className="h-16 w-full" />
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2">
              <CuttingAction shape={card.tool.shape} D={card.tool.D} LOC={card.tool.LOC} ap={card.ap} ae={card.ae} toolPath="conventional" className="w-full" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Quick Result</div>
          <div className="mt-2 space-y-1.5 text-[12px] text-slate-700">
            <div>Torque {card.torque.toFixed(2)} N·m</div>
            <div>Ra {card.raUm.toFixed(2)} um</div>
            <div>Coating Factor x{card.tool.coatingMult.toFixed(2)}</div>
          </div>
          {onApply && (
            <button
              type="button"
              onClick={onApply}
              className="mt-3 w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
            >
              이 조건을 메인 시뮬레이터에 반영
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

const MiniStatChip = memo(function MiniStatChip({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "emerald" | "sky" | "amber" | "violet"
}) {
  const toneClass = tone === "emerald"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-violet-200 bg-violet-50 text-violet-800"
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-1 text-[12px] font-semibold">{value}</div>
    </div>
  )
})

const CompareControlSlider = memo(function CompareControlSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-900">{label}</span>
        <span className="text-[11px] font-mono font-bold text-amber-800">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-2 w-full cursor-pointer accent-amber-600"
      />
      <div className="mt-1 flex justify-between text-[9px] font-mono text-amber-700/70">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
})

const SectionHeader = memo(function SectionHeader({ icon, title, subtitle, tone }: { icon: React.ReactNode; title: string; subtitle: string; tone: "blue" | "violet" | "emerald" }) {
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
})

const CardShell = memo(function CardShell({ title, icon, onReset, children, eduId, eduSection }: { title: string; icon: React.ReactNode; onReset: () => void; children: React.ReactNode; eduId?: string; eduSection?: string }) {
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
})

const DimRow = memo(function DimRow({ label, value, onChange, min, max, step, unit }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; unit: DisplayUnit }) {
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
})

const MiniSelect = memo(function MiniSelect({ label, value, onChange, options, eduId }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; eduId?: string }) {
  return (
    <div>
      <label className="text-[10px] text-gray-500 flex items-center gap-1">
        {label}
        {eduId && <EduLabel id={eduId} size="xs" />}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-blue-400 focus:outline-none">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
})

const NumInputSmall = memo(function NumInputSmall({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[9px] text-gray-500">{label}</label>
      <input type="number" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs font-mono focus:border-blue-400 focus:outline-none" />
    </div>
  )
})

interface PctSliderProps {
  label: string; unit: string; value: number; pct: number; pctLabel?: string
  min: number; max: number; step: number; decimals?: number
  onChange: (v: number) => void
  locked?: boolean; onLockToggle?: () => void
  secondary?: { value: number; unit: string; decimals: number }
  eduId?: string
  warnings?: SimWarning[]
  paramKey?: ParamKey
  darkMode?: boolean
}

const PctSlider = memo(function PctSlider({ label, unit, value, pct, pctLabel = "%", min, max, step, decimals = 0, onChange, locked, onLockToggle, secondary, eduId, warnings, paramKey, darkMode }: PctSliderProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-0.5">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium text-gray-700 dark:text-slate-300">{label}</label>
          {eduId && <EduLabel id={eduId} size="xs" />}
          {warnings && paramKey && <WarningDot warnings={warnings} param={paramKey} darkMode={darkMode} />}
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
})

const CorrelationDetailCard = memo(function CorrelationDetailCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-mono font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{note}</div>
    </div>
  )
})

const MiniGaugeControl = memo(function MiniGaugeControl({
  label,
  unit,
  value,
  min,
  max,
  step,
  decimals = 0,
  color,
  onChange,
  disabled,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  color: "sky" | "emerald" | "amber" | "violet"
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(max - min, step)) * 100))
  const tone = color === "sky"
    ? { ring: "#0ea5e9", track: "#dbeafe", text: "text-sky-700", bg: "bg-sky-50", accent: "accent-sky-600" }
    : color === "emerald"
      ? { ring: "#10b981", track: "#d1fae5", text: "text-emerald-700", bg: "bg-emerald-50", accent: "accent-emerald-600" }
      : color === "amber"
        ? { ring: "#f59e0b", track: "#fef3c7", text: "text-amber-700", bg: "bg-amber-50", accent: "accent-amber-600" }
        : { ring: "#8b5cf6", track: "#ede9fe", text: "text-violet-700", bg: "bg-violet-50", accent: "accent-violet-600" }

  return (
    <div className={`rounded-xl border border-white/80 ${tone.bg} px-3 py-2 shadow-sm ${disabled ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`text-[10px] font-mono font-bold ${tone.text}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(from 220deg, ${tone.ring} 0 ${pct}%, ${tone.track} ${pct}% 100%)` }}
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-full bg-white text-center ${tone.text}`}>
            <span className="text-[10px] font-mono font-bold">{decimals ? value.toFixed(decimals) : value.toFixed(0)}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-slate-500">{unit}</div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={e => onChange(parseFloat(e.target.value))}
            className={`mt-1 w-full cursor-pointer ${tone.accent}`}
          />
          <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-400">
            <span>{decimals ? min.toFixed(decimals) : min.toFixed(0)}</span>
            <span>{decimals ? max.toFixed(decimals) : max.toFixed(0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
})

const PercentTuner = memo(function PercentTuner({ label, pct, onChange, positiveLabel, negativeLabel, effective }: { label: string; pct: number; onChange: (n: number) => void; positiveLabel: string; negativeLabel: string; effective: string }) {
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
})

const StarterCard = memo(function StarterCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left rounded-lg border border-blue-200 bg-white px-3.5 py-3 hover:border-blue-400 hover:shadow-sm transition-all">
      <div className="flex items-center gap-1.5 mb-1 text-blue-700">{icon}<span className="text-xs font-bold">{title}</span></div>
      <div className="text-[11px] text-gray-600">{desc}</div>
    </button>
  )
})

const MetricCard = memo(function MetricCard({ label, value, unit, accent, sub, eduId, animated, decimals = 0 }: { label: string; value: string | number; unit: string; accent: "neutral" | "warning" | "volatile"; sub?: string; eduId?: string; animated?: boolean; decimals?: number }) {
  const accentClass = accent === "warning" ? "border-amber-300 bg-amber-50/50 dark:bg-amber-900/20 dark:border-amber-700" : accent === "volatile" ? "border-violet-300 bg-violet-50/50 dark:bg-violet-900/20 dark:border-violet-700" : "border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-700"
  const numValue = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, "")) || 0
  return (
    <div className={`rounded-xl border ${accentClass} p-3 transition-all hover:shadow-md`}>
      <div className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold flex items-center gap-1">
        {label}
        {eduId && <EduLabel id={eduId} size="xs" />}
      </div>
      <div className="text-lg font-bold mt-0.5 text-gray-900 dark:text-slate-100 font-mono">
        {animated && typeof value === "number"
          ? <AnimatedNumber value={numValue} decimals={decimals} />
          : animated
            ? <AnimatedNumber value={numValue} decimals={decimals} />
            : value}
      </div>
      <div className="text-[9px] text-gray-500 dark:text-slate-400">{unit}</div>
      {sub && <div className="text-[9px] text-violet-700 dark:text-violet-300 mt-0.5 font-mono">{sub}</div>}
    </div>
  )
})

const ResultCard = memo(function ResultCard({ label, value, unit, color, sub, eduId }: { label: string; value: string; unit: string; color: string; sub?: string; eduId?: string }) {
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
})

const ToolSpecRow = memo(function ToolSpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="text-gray-500 w-[85px] flex-shrink-0">{k}:</span>
      <span className="font-mono text-gray-800 flex-1 min-w-0 truncate">{v}</span>
    </div>
  )
})

const ToolbarDivider = memo(function ToolbarDivider({ darkMode }: { darkMode?: boolean }) {
  return <span className={`inline-block h-6 w-px mx-0.5 ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} aria-hidden="true" />
})

const CorrChip = memo(function CorrChip({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <span className={`rounded px-2 py-0.5 font-mono ${active ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-500"}`}>
      <span className="font-semibold">{label}</span>: {value}
    </span>
  )
})

const RvYRow = memo(function RvYRow({ label, rec, your, unit, decimals }: { label: string; rec: number; your: number; unit: string; decimals: number }) {
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
})

const WarningRow = memo(function WarningRow({ w }: { w: SimWarning }) {
  const iconMap = { error: AlertCircle, warn: AlertTriangle, info: Info }
  const Icon = iconMap[w.level]
  const colorMap = {
    error: "text-red-700 bg-red-50 border-red-200",
    warn: "text-amber-700 bg-amber-50 border-amber-200",
    info: "text-blue-700 bg-blue-50 border-blue-200",
  }
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${colorMap[w.level]}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /><span>{w.message}</span>
    </div>
  )
})
