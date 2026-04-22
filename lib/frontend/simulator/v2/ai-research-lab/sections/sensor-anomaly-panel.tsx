"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Play, Pause, RotateCcw, AlertTriangle, Activity, Thermometer, Zap, Gauge } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockSensorStream, type SensorFrame } from "../data/mock-data-engine"

interface SensorAnomalyPanelProps {
  onAskAI?: (q: string) => void
}

const FRAME_INTERVAL_MS = 500
const WINDOW_FRAMES = 60

export function SensorAnomalyPanel(props: SensorAnomalyPanelProps) {
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [allFrames] = useState<SensorFrame[]>(() => mockSensorStream(60, true))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!isPlaying) return
    intervalRef.current = setInterval(() => {
      setCurrentFrame(prev => (prev >= allFrames.length - 1 ? 0 : prev + 1))
    }, FRAME_INTERVAL_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isPlaying, allFrames.length])

  const visibleFrames = useMemo(
    () => allFrames.slice(Math.max(0, currentFrame - WINDOW_FRAMES), currentFrame + 1),
    [allFrames, currentFrame],
  )

  const current = allFrames[currentFrame] ?? allFrames[0]
  // Defensive: an empty stream (durationSec=0) would make current undefined.
  // Render a neutral placeholder rather than crash on property access.
  if (!current) {
    return (
      <SectionShell
        id="sensor-anomaly-panel"
        title="실시간 센서 이상탐지"
        subtitle="스트림 데이터 없음"
        infoId="sensor-anomaly-detection"
        phase="Phase 3 · 2028 Q1 예정"
        onAskAI={props.onAskAI}
      >
        <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
          센서 스트림 데이터가 생성되지 않았습니다.
        </div>
      </SectionShell>
    )
  }
  const anomalyPct = Math.round(current.anomalyScore * 100)
  const isAlert = current.anomalyScore > 0.6

  function handleReset() {
    setCurrentFrame(0)
    setIsPlaying(false)
  }

  return (
    <SectionShell
      id="sensor-anomaly-panel"
      title="실시간 센서 이상탐지"
      subtitle="Fanuc FOCAS → Kafka → 1D-CNN 실시간 추론 (데모 재생)"
      infoId="sensor-anomaly-detection"
      phase="Phase 3 · 2028 Q1 예정"
      onAskAI={props.onAskAI}
    >
      {/* Controls */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying(p => !p)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium transition-colors"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? "일시정지" : "재생"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            리셋
          </button>
        </div>
        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
          Frame <span className="font-bold text-slate-700 dark:text-slate-200">{currentFrame + 1}</span> / {allFrames.length}
          <span className="ml-2 text-[10px]">· {(currentFrame / 2).toFixed(1)}s</span>
        </div>
      </div>

      {/* Alert banner */}
      {isAlert && (
        <div className="mb-4 rounded-lg border border-rose-300 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 p-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-rose-700 dark:text-rose-300">
                ⚠ 공구 파손 위험 감지 (anomaly {anomalyPct}%)
              </span>
              <InfoToggle
                id="chatter-detection"
                content={FEATURE_EXPLANATIONS["chatter-detection"]}
                onAskAI={props.onAskAI}
              />
            </div>
            <div className="text-xs text-rose-700 dark:text-rose-300/90 leading-relaxed">
              약 <span className="font-mono font-bold">{current.predictedRUL_min.toFixed(1)}분</span> 내 파손 예측.
              진동 {current.vibrationG.toFixed(2)}g · 스핀들 {current.spindleLoadPct.toFixed(0)}% · 채터 리스크{" "}
              {(current.chatterRisk * 100).toFixed(0)}%. 즉시 감속 또는 비상 정지를 권장합니다.
            </div>
          </div>
        </div>
      )}

      {/* 4-chart grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Sparkline
          title="스핀들 부하"
          icon={<Gauge className="w-3.5 h-3.5" />}
          value={`${current.spindleLoadPct.toFixed(1)}%`}
          unit="%"
          frames={visibleFrames}
          pick={f => f.spindleLoadPct}
          threshold={85}
          domainMin={0}
          domainMax={120}
          color="teal"
        />
        <Sparkline
          title="진동"
          icon={<Activity className="w-3.5 h-3.5" />}
          value={`${current.vibrationG.toFixed(2)}g`}
          unit="g"
          frames={visibleFrames}
          pick={f => f.vibrationG}
          threshold={1.0}
          domainMin={0}
          domainMax={1.8}
          color="purple"
        />
        <Sparkline
          title="온도"
          icon={<Thermometer className="w-3.5 h-3.5" />}
          value={`${current.temperatureC.toFixed(1)}°C`}
          unit="°C"
          frames={visibleFrames}
          pick={f => f.temperatureC}
          threshold={60}
          domainMin={30}
          domainMax={80}
          color="amber"
        />
        <Sparkline
          title="전류"
          icon={<Zap className="w-3.5 h-3.5" />}
          value={`${current.currentA.toFixed(2)}A`}
          unit="A"
          frames={visibleFrames}
          pick={f => f.currentA}
          threshold={15}
          domainMin={0}
          domainMax={20}
          color="rose"
        />
      </div>

      {/* Gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <GaugeCard
          label="Anomaly Score"
          value={anomalyPct}
          unit="%"
          max={100}
          criticalAt={60}
          infoRight={
            <InfoToggle
              id="remaining-useful-life"
              content={FEATURE_EXPLANATIONS["remaining-useful-life"]}
              onAskAI={props.onAskAI}
            />
          }
        />
        <GaugeCard
          label="RUL (남은 수명)"
          value={Math.round(current.predictedRUL_min * 10) / 10}
          unit="min"
          max={45}
          criticalAt={10}
          invert
        />
      </div>
    </SectionShell>
  )
}

// ─────────────────────────────────────────────
// Sparkline chart (SVG)
// ─────────────────────────────────────────────

const SPARK_W = 360
const SPARK_H = 100
const SPARK_PAD_X = 4
const SPARK_PAD_Y = 8

const COLOR_MAP = {
  teal: { stroke: "stroke-teal-500", fill: "fill-teal-500/15", text: "text-teal-600 dark:text-teal-400" },
  purple: { stroke: "stroke-purple-500", fill: "fill-purple-500/15", text: "text-purple-600 dark:text-purple-400" },
  amber: { stroke: "stroke-amber-500", fill: "fill-amber-500/15", text: "text-amber-600 dark:text-amber-400" },
  rose: { stroke: "stroke-rose-500", fill: "fill-rose-500/15", text: "text-rose-600 dark:text-rose-400" },
} as const

type SparkColor = keyof typeof COLOR_MAP

function Sparkline({
  title,
  icon,
  value,
  frames,
  pick,
  threshold,
  domainMin,
  domainMax,
  color,
}: {
  title: string
  icon: React.ReactNode
  value: string
  unit: string
  frames: SensorFrame[]
  pick: (f: SensorFrame) => number
  threshold: number
  domainMin: number
  domainMax: number
  color: SparkColor
}) {
  const cls = COLOR_MAP[color]
  const range = domainMax - domainMin || 1
  const step = (SPARK_W - SPARK_PAD_X * 2) / Math.max(1, WINDOW_FRAMES - 1)

  const toY = (v: number) =>
    SPARK_H - SPARK_PAD_Y - ((v - domainMin) / range) * (SPARK_H - SPARK_PAD_Y * 2)

  const pts = frames.map((f, i) => {
    const x = SPARK_PAD_X + i * step
    const y = toY(pick(f))
    return { x, y }
  })

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")
  const areaPath =
    pts.length > 0
      ? `${linePath} L${pts[pts.length - 1].x.toFixed(2)},${SPARK_H - SPARK_PAD_Y} L${pts[0].x.toFixed(2)},${SPARK_H - SPARK_PAD_Y} Z`
      : ""

  const thresholdY = toY(threshold)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className={`flex items-center gap-1.5 text-xs font-semibold ${cls.text}`}>
          {icon}
          <span>{title}</span>
        </div>
        <div className={`font-mono text-sm font-bold ${cls.text}`}>{value}</div>
      </div>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        {/* Threshold dashed line */}
        <line
          x1={0}
          y1={thresholdY}
          x2={SPARK_W}
          y2={thresholdY}
          stroke="currentColor"
          strokeDasharray="4 3"
          strokeWidth={1}
          className="text-rose-400/70"
        />
        <text
          x={SPARK_W - 2}
          y={thresholdY - 2}
          textAnchor="end"
          className="fill-rose-500 text-[9px] font-mono"
        >
          임계 {threshold}
        </text>

        {/* Area */}
        {areaPath && <path d={areaPath} className={cls.fill} />}

        {/* Line */}
        <path d={linePath} fill="none" strokeWidth={1.8} className={cls.stroke} />

        {/* Current dot */}
        {pts.length > 0 && (
          <circle
            cx={pts[pts.length - 1].x}
            cy={pts[pts.length - 1].y}
            r={3}
            className={`${cls.stroke} fill-white dark:fill-slate-900`}
            strokeWidth={2}
          />
        )}
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────
// Gauge card (semi-circle SVG)
// ─────────────────────────────────────────────

function GaugeCard({
  label,
  value,
  unit,
  max,
  criticalAt,
  invert = false,
  infoRight,
}: {
  label: string
  value: number
  unit: string
  max: number
  criticalAt: number
  invert?: boolean
  infoRight?: React.ReactNode
}) {
  const clamped = Math.max(0, Math.min(max, value))
  const pct = clamped / max
  const isCritical = invert ? value < criticalAt : value > criticalAt

  const W = 300
  const H = 140
  const cx = W / 2
  const cy = H - 20
  const r = 90
  const startAngle = Math.PI
  const endAngle = 0
  const angle = startAngle + (endAngle - startAngle) * pct
  const needleX = cx + r * Math.cos(angle)
  const needleY = cy - r * Math.sin(angle)

  const arcPath = (from: number, to: number) => {
    const x1 = cx + r * Math.cos(from)
    const y1 = cy - r * Math.sin(from)
    const x2 = cx + r * Math.cos(to)
    const y2 = cy - r * Math.sin(to)
    const large = Math.abs(to - from) > Math.PI ? 1 : 0
    const sweep = to > from ? 0 : 1
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} ${sweep} ${x2.toFixed(2)},${y2.toFixed(2)}`
  }

  const valueColorCls = isCritical
    ? "text-rose-600 dark:text-rose-400"
    : "text-emerald-600 dark:text-emerald-400"

  return (
    <div
      className={`rounded-lg border p-3 ${
        isCritical
          ? "border-rose-300 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-950/30"
          : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</div>
        {infoRight}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Background arc */}
        <path
          d={arcPath(startAngle, endAngle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={14}
          className="text-slate-200 dark:text-slate-700"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d={arcPath(startAngle, angle)}
          fill="none"
          stroke="currentColor"
          strokeWidth={14}
          className={isCritical ? "text-rose-500" : "text-emerald-500"}
          strokeLinecap="round"
        />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="currentColor"
          strokeWidth={2}
          className="text-slate-700 dark:text-slate-200"
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={4} className="fill-slate-700 dark:fill-slate-200" />
        {/* Value text */}
        <text
          x={cx}
          y={cy - 36}
          textAnchor="middle"
          className={`fill-current text-2xl font-bold font-mono ${valueColorCls}`}
        >
          {value}
          <tspan className="text-xs ml-1"> {unit}</tspan>
        </text>
      </svg>
    </div>
  )
}
