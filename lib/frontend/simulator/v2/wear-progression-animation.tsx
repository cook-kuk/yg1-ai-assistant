// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Wear Progression Animation (Sidecar, cutting-simulator-v2 불변)
// VB(t) = limit * (t/T)^0.7 · Phases: run-in/steady/accelerated (teal/amber/red)
"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer,
} from "recharts"
import { HolographicFrame } from "./holographic-frame"
import FeatureExplainer from "./feature-explainer"
import { AnimatedNumber } from "./animated-number"
import { LiveIndicator } from "./live-indicator"

export interface WearProgressionAnimationProps {
  /** 현재 절삭속도 (m/min) — 표시용 */
  currentVc: number
  /** Taylor 기반 예상 수명 (분) — 타임라인 길이 */
  toolLifeMin: number
  /** ISO 마모 한계 mm (default 0.3) */
  flankWearLimitMm?: number
  /** 외부 scrub 제어용. 주입되면 autoPlay/internal tick 을 override */
  elapsedMin?: number
  /** 자동 재생 (default true) */
  autoPlay?: boolean
  /** 내부 tick 간격 ms (default 80) */
  playbackSpeedMs?: number
  /** 다크 모드 */
  darkMode?: boolean
}

// Constants (SSOT — 매직넘버 금지)
const DEFAULT_FLANK_WEAR_LIMIT_MM = 0.3 // ISO 8688
const DEFAULT_TICK_MS = 80
const TAYLOR_GROWTH_EXPONENT = 0.7
const RUN_IN_END = 0.2
const STEADY_END = 0.8
const WARNING_VB_RATIO = 0.8
const SAMPLE_POINTS = 60
const TICK_PROGRESS_STEP = 1 / 120

type Phase = "run-in" | "steady" | "accelerated"

interface PhaseMeta {
  id: Phase
  label: string
  colorHex: string
  badgeClsLight: string
  badgeClsDark: string
}

const PHASES: Record<Phase, PhaseMeta> = {
  "run-in": {
    id: "run-in", label: "초기 마모", colorHex: "#14b8a6",
    badgeClsLight: "bg-teal-50 text-teal-700 border-teal-300",
    badgeClsDark: "bg-teal-950/60 text-teal-200 border-teal-700",
  },
  steady: {
    id: "steady", label: "정상 마모", colorHex: "#f59e0b",
    badgeClsLight: "bg-amber-50 text-amber-700 border-amber-300",
    badgeClsDark: "bg-amber-950/60 text-amber-200 border-amber-700",
  },
  accelerated: {
    id: "accelerated", label: "급속 마모", colorHex: "#ef4444",
    badgeClsLight: "bg-rose-50 text-rose-700 border-rose-300",
    badgeClsDark: "bg-rose-950/60 text-rose-200 border-rose-700",
  },
}

// Pure helpers
function computeVb(t: number, toolLifeMin: number, limitMm: number): number {
  if (toolLifeMin <= 0) return 0
  const ratio = Math.max(0, Math.min(1, t / toolLifeMin))
  return limitMm * Math.pow(ratio, TAYLOR_GROWTH_EXPONENT)
}

function classifyPhase(progress01: number): Phase {
  if (progress01 < RUN_IN_END) return "run-in"
  if (progress01 < STEADY_END) return "steady"
  return "accelerated"
}

interface CurvePoint { t: number; vb: number }

function buildCurve(toolLifeMin: number, limitMm: number): CurvePoint[] {
  if (toolLifeMin <= 0) return []
  const out: CurvePoint[] = []
  for (let i = 0; i <= SAMPLE_POINTS; i++) {
    const t = (toolLifeMin * i) / SAMPLE_POINTS
    out.push({ t, vb: computeVb(t, toolLifeMin, limitMm) })
  }
  return out
}

// Inline SVG icons (no new deps)
const SVG_ATTRS = { viewBox: "0 0 16 16", "aria-hidden": true, focusable: "false" as const }
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_ATTRS} className={className}>
      <path d="M4 3 L13 8 L4 13 Z" fill="currentColor" />
    </svg>
  )
}
function PauseIcon({ className }: { className?: string }) {
  return (
    <svg {...SVG_ATTRS} className={className}>
      <rect x="4" y="3" width="3" height="10" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" fill="currentColor" />
    </svg>
  )
}

// Main component
export function WearProgressionAnimation({
  currentVc, toolLifeMin, flankWearLimitMm = DEFAULT_FLANK_WEAR_LIMIT_MM,
  elapsedMin, autoPlay = true, playbackSpeedMs = DEFAULT_TICK_MS, darkMode = false,
}: WearProgressionAnimationProps): React.ReactElement {
  const externallyControlled = typeof elapsedMin === "number"
  const [internalT, setInternalT] = React.useState<number>(0)
  const [playing, setPlaying] = React.useState<boolean>(autoPlay)
  const safeToolLife = toolLifeMin > 0 ? toolLifeMin : 1
  const effectiveT = externallyControlled
    ? Math.max(0, Math.min(safeToolLife, elapsedMin as number))
    : internalT
  const progress01 = Math.max(0, Math.min(1, effectiveT / safeToolLife))

  // Auto-play ticker (loops t: 0 → toolLifeMin → 0)
  React.useEffect(() => {
    if (externallyControlled || !playing) return
    const id = window.setInterval(() => {
      setInternalT((prev) => {
        const next = prev + safeToolLife * TICK_PROGRESS_STEP
        return next >= safeToolLife ? 0 : next
      })
    }, Math.max(16, playbackSpeedMs))
    return () => window.clearInterval(id)
  }, [externallyControlled, playing, safeToolLife, playbackSpeedMs])

  React.useEffect(() => {
    setPlaying(autoPlay)
  }, [autoPlay])

  const currentVb = computeVb(effectiveT, safeToolLife, flankWearLimitMm)
  const phase = classifyPhase(progress01)
  const phaseMeta = PHASES[phase]
  const vbRatio = flankWearLimitMm > 0 ? currentVb / flankWearLimitMm : 0
  const isWarning = vbRatio > WARNING_VB_RATIO

  const curve = React.useMemo(
    () => buildCurve(safeToolLife, flankWearLimitMm),
    [safeToolLife, flankWearLimitMm],
  )

  const tRunInEnd = safeToolLife * RUN_IN_END
  const tSteadyEnd = safeToolLife * STEADY_END

  const gridStroke = darkMode ? "rgba(148,163,184,0.18)" : "rgba(100,116,139,0.20)"
  const axisStroke = darkMode ? "rgba(203,213,225,0.65)" : "rgba(71,85,105,0.75)"
  const lineStroke = darkMode ? "#f43f5e" : "#e11d48"
  const headingCls = darkMode ? "text-slate-100" : "text-slate-900"
  const subtleCls = darkMode ? "text-slate-400" : "text-slate-500"
  const panelInnerBg = darkMode ? "bg-slate-950/40" : "bg-white/60"

  const onScrub = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (externallyControlled) return
    setInternalT(Number(e.target.value))
    setPlaying(false)
  }, [externallyControlled])

  const togglePlay = React.useCallback(() => setPlaying((p) => !p), [])

  const formatTooltip = React.useCallback((value: number | string): [string, string] => {
    const v = typeof value === "number" ? value : Number(value)
    return [`${v.toFixed(3)} mm`, "VB"]
  }, [])

  return (
    <HolographicFrame accent="rose" intensity="medium" darkMode={darkMode}>
      <div className={`p-4 ${panelInnerBg}`}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`text-sm font-bold tracking-wide ${headingCls}`}>공구 마모 진행 · Wear Progression</h3>
              <LiveIndicator
                watch={[currentVb, effectiveT]}
                label={isWarning ? "ALERT" : "LIVE"}
                color={isWarning ? "rose" : "emerald"}
                darkMode={darkMode} showCount={false}
              />
            </div>
            <p className={`text-[11px] ${subtleCls}`}>
              Vc {currentVc.toFixed(0)} m/min · T<sub>life</sub> {safeToolLife.toFixed(1)} min · limit {flankWearLimitMm.toFixed(2)} mm
            </p>
          </div>

          {!externallyControlled && (
            <button
              type="button" onClick={togglePlay}
              aria-label={playing ? "일시정지" : "재생"}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold border transition-colors ${
                darkMode
                  ? "bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-600"
                  : "bg-white hover:bg-slate-50 text-slate-800 border-slate-300"
              }`}
            >
              {playing ? <PauseIcon className="w-3 h-3" /> : <PlayIcon className="w-3 h-3" />}
              <span>{playing ? "Pause" : "Play"}</span>
            </button>
          )}
        </div>

        {/* Big VB number + Phase badge */}
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <div className={`text-[10px] font-semibold uppercase tracking-widest ${subtleCls}`}>
              Flank wear · VB
            </div>
            <AnimatedNumber
              value={currentVb} decimals={3} suffix=" mm" duration={0.25}
              className={`text-4xl font-black tabular-nums ${
                isWarning
                  ? (darkMode ? "text-rose-300" : "text-rose-600")
                  : (darkMode ? "text-slate-100" : "text-slate-900")
              }`}
            />
          </div>

          <AnimatePresence mode="wait">
            <motion.span
              key={phaseMeta.id}
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.96 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${darkMode ? phaseMeta.badgeClsDark : phaseMeta.badgeClsLight}`}
              style={{ boxShadow: `0 0 12px ${phaseMeta.colorHex}40` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: phaseMeta.colorHex }} aria-hidden="true" />
              {phaseMeta.label}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Chart */}
        <div className="h-56 w-full mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={curve} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="t" type="number" domain={[0, safeToolLife]}
                tickFormatter={(v: number) => `${Number(v).toFixed(0)}m`}
                stroke={axisStroke} tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[0, flankWearLimitMm * 1.05]}
                tickFormatter={(v: number) => Number(v).toFixed(2)}
                stroke={axisStroke} tick={{ fontSize: 10 }} width={36}
              />
              <ReferenceArea x1={0} x2={tRunInEnd} y1={0} y2={flankWearLimitMm * 1.05}
                fill={PHASES["run-in"].colorHex} fillOpacity={darkMode ? 0.14 : 0.10} stroke="none" />
              <ReferenceArea x1={tRunInEnd} x2={tSteadyEnd} y1={0} y2={flankWearLimitMm * 1.05}
                fill={PHASES.steady.colorHex} fillOpacity={darkMode ? 0.14 : 0.10} stroke="none" />
              <ReferenceArea x1={tSteadyEnd} x2={safeToolLife} y1={0} y2={flankWearLimitMm * 1.05}
                fill={PHASES.accelerated.colorHex} fillOpacity={darkMode ? 0.18 : 0.14} stroke="none" />
              <ReferenceLine
                y={flankWearLimitMm} stroke={PHASES.accelerated.colorHex}
                strokeDasharray="4 3" ifOverflow="extendDomain"
                label={{ value: `limit ${flankWearLimitMm}mm`, position: "insideTopRight", fill: PHASES.accelerated.colorHex, fontSize: 10 }}
              />
              <Tooltip
                formatter={formatTooltip}
                labelFormatter={(l: number | string) => `t = ${(typeof l === "number" ? l : Number(l)).toFixed(1)} min`}
                contentStyle={{
                  background: darkMode ? "rgba(2,6,23,0.92)" : "rgba(255,255,255,0.96)",
                  border: `1px solid ${darkMode ? "#334155" : "#cbd5e1"}`,
                  borderRadius: 6, fontSize: 11,
                  color: darkMode ? "#e2e8f0" : "#0f172a",
                }}
              />

              <Line
                type="monotone"
                dataKey="vb"
                stroke={lineStroke}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />

              <ReferenceDot
                x={effectiveT} y={currentVb} r={6}
                fill={phaseMeta.colorHex}
                stroke={darkMode ? "#0f172a" : "#ffffff"}
                strokeWidth={2} ifOverflow="extendDomain" isFront
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div
            className={`h-2 w-full overflow-hidden rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-200"}`}
            role="progressbar" aria-label="공구 수명 진행률"
            aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(progress01 * 100)}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: phaseMeta.colorHex }}
              animate={{ width: `${(progress01 * 100).toFixed(2)}%` }}
              transition={{ duration: 0.15, ease: "linear" }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className={`text-[10px] tabular-nums ${subtleCls}`}>t = {effectiveT.toFixed(1)} min</span>
            <span className={`text-[10px] font-semibold tabular-nums ${headingCls}`}>{(progress01 * 100).toFixed(0)}%</span>
            <span className={`text-[10px] tabular-nums ${subtleCls}`}>T<sub>life</sub> = {safeToolLife.toFixed(1)} min</span>
          </div>
        </div>

        {/* Scrub slider */}
        {!externallyControlled && (
          <div className="mb-3">
            <label className={`block text-[10px] font-semibold uppercase tracking-wider mb-1 ${subtleCls}`}>
              수동 스크럽 (Scrub)
            </label>
            <input
              type="range" min={0} max={safeToolLife}
              step={Math.max(0.01, safeToolLife / 240)}
              value={effectiveT} onChange={onScrub}
              aria-label="가공 시간 스크럽"
              className="w-full accent-rose-500 cursor-pointer"
            />
          </div>
        )}

        {/* Collapsible explainer (re-uses existing wear-gauge content) */}
        <div className="mt-1">
          <FeatureExplainer featureId="wear-gauge" darkMode={darkMode} />
        </div>
      </div>
    </HolographicFrame>
  )
}

export default WearProgressionAnimation
