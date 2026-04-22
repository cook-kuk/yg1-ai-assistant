// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 고급 엔지니어링 지표 패널 ("연구소장 모드")
// Sandvik / Shaw / Trent 수식 기반 보조 지표 6종 — 100% 클라이언트 사이드.
"use client"

import { useMemo } from "react"
import type {
  HeatEstimation, RunoutEffect, HelixDecomposition,
  MonteCarloResult, BueRisk, ChipMorphology,
} from "../advanced-metrics"
import FeatureExplainer from "./feature-explainer"
import { AnimatedNumber } from "./animated-number"

// ─────────────────────────────────────────────────────────────────────

export interface AdvancedMetricsPanelProps {
  heat: HeatEstimation
  runout: RunoutEffect
  helix: HelixDecomposition
  monteCarlo: MonteCarloResult
  bue: BueRisk
  chipMorph: ChipMorphology
  darkMode?: boolean
  expanded?: boolean
  onToggle?: () => void
}

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(digits)
}

function tempBand(c: number): "green" | "amber" | "red" {
  if (c < 250) return "green"
  if (c < 400) return "amber"
  return "red"
}

function tempBandClasses(b: "green" | "amber" | "red", darkMode: boolean): string {
  if (b === "green")
    return darkMode
      ? "text-emerald-300 bg-emerald-900/30 border-emerald-700"
      : "text-emerald-700 bg-emerald-50 border-emerald-300"
  if (b === "amber")
    return darkMode
      ? "text-amber-300 bg-amber-900/30 border-amber-700"
      : "text-amber-700 bg-amber-50 border-amber-300"
  return darkMode
    ? "text-rose-300 bg-rose-900/30 border-rose-700"
    : "text-rose-700 bg-rose-50 border-rose-300"
}

function riskPillClasses(
  r: "none" | "low" | "mid" | "high",
  darkMode: boolean,
): string {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border"
  switch (r) {
    case "none":
      return `${base} ${darkMode ? "bg-emerald-900/30 text-emerald-300 border-emerald-700" : "bg-emerald-50 text-emerald-700 border-emerald-300"}`
    case "low":
      return `${base} ${darkMode ? "bg-sky-900/30 text-sky-300 border-sky-700" : "bg-sky-50 text-sky-700 border-sky-300"}`
    case "mid":
      return `${base} ${darkMode ? "bg-amber-900/30 text-amber-300 border-amber-700" : "bg-amber-50 text-amber-700 border-amber-300"}`
    case "high":
      return `${base} ${darkMode ? "bg-rose-900/30 text-rose-300 border-rose-700" : "bg-rose-50 text-rose-700 border-rose-300"}`
  }
}

function wearRiskBadge(r: "low" | "mid" | "high", darkMode: boolean): string {
  return riskPillClasses(r === "low" ? "none" : r, darkMode)
}

// ─────────────────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────────────────

function SectionShell({
  title,
  icon,
  children,
  darkMode,
}: {
  title: string
  icon: string
  children: React.ReactNode
  darkMode: boolean
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-lg border p-3 min-w-0 ${
        darkMode
          ? "border-slate-700 bg-slate-800"
          : "border-slate-200 bg-white"
      }`}
    >
      <div
        className={`mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide min-w-0 ${
          darkMode ? "text-slate-300" : "text-slate-600"
        }`}
      >
        <span className="text-base leading-none flex-shrink-0" aria-hidden>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Bar({
  value,
  max,
  colorClass,
  trackClass,
  ariaLabel,
}: {
  value: number
  max: number
  colorClass: string
  trackClass: string
  ariaLabel?: string
}) {
  const pct = max > 0 ? clamp01(value / max) * 100 : 0
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-2 w-full overflow-hidden rounded-full ${trackClass}`}
    >
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function MiniKpi({
  label,
  value,
  unit,
  darkMode,
}: {
  label: string
  value: string
  unit?: string
  darkMode: boolean
}) {
  return (
    <div
      className={`flex min-w-0 flex-col rounded-md border px-2.5 py-1.5 ${
        darkMode
          ? "border-slate-700 bg-slate-800/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <span
        className={`truncate text-[10px] uppercase tracking-wide ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </span>
      <span
        className={`truncate font-mono tabular-nums text-sm font-semibold ${
          darkMode ? "text-slate-100" : "text-slate-800"
        }`}
        title={`${value}${unit ? ` ${unit}` : ""}`}
      >
        {value}
        {unit && (
          <span
            className={`ml-0.5 text-[10px] font-normal ${
              darkMode ? "text-slate-400" : "text-slate-500"
            }`}
          >
            {unit}
          </span>
        )}
      </span>
    </div>
  )
}

// ─── Section 1: Heat ─────────────────────────────────────────────
function HeatSection({ heat, darkMode }: { heat: HeatEstimation; darkMode: boolean }) {
  const band = tempBand(heat.chipTempC)
  const pillCls = tempBandClasses(band, darkMode)
  const chipPct = clamp01(heat.chipHeatPct / 100) * 100
  // 분배: chip vs tool vs workpiece (workpiece = 100 - chip - tool, 추정)
  // totalPowerW 가 정확한 분배 구성요소를 제공한다고 가정하지 않으므로,
  // chipHeatPct 를 기준으로 tool/workpiece 를 비례 배분 (상대 온도 기반)
  const toolShare =
    (heat.toolTempC / Math.max(1, heat.toolTempC + heat.workpieceTempC)) * (100 - chipPct)
  const workShare = 100 - chipPct - toolShare

  return (
    <SectionShell title="열·온도 (Heat Partition)" icon="🌡" darkMode={darkMode}>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={heat.chipTempC}
          decimals={0}
          className={`font-mono tabular-nums text-2xl font-bold ${
            darkMode ? "text-slate-100" : "text-slate-900"
          }`}
        />
        <span className={`text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>°C 칩</span>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold ${pillCls}`}>
          {band === "green" ? "정상" : band === "amber" ? "주의" : "과열"}
        </span>
      </div>

      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full">
        <div
          className="bg-rose-500"
          style={{ width: `${chipPct}%` }}
          title={`칩 ${fmt(chipPct, 0)}%`}
        />
        <div
          className="bg-amber-400"
          style={{ width: `${clamp01(toolShare / 100) * 100}%` }}
          title={`공구 ${fmt(toolShare, 0)}%`}
        />
        <div
          className="bg-sky-400"
          style={{ width: `${clamp01(workShare / 100) * 100}%` }}
          title={`소재 ${fmt(workShare, 0)}%`}
        />
      </div>
      <div className={`mt-1 flex justify-between text-[10px] ${
        darkMode ? "text-slate-400" : "text-slate-500"
      }`}>
        <span>칩 {fmt(chipPct, 0)}%</span>
        <span>공구 {fmt(toolShare, 0)}%</span>
        <span>소재 {fmt(workShare, 0)}%</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <MiniKpi label="공구" value={fmt(heat.toolTempC, 0)} unit="°C" darkMode={darkMode} />
        <MiniKpi label="소재" value={fmt(heat.workpieceTempC, 0)} unit="°C" darkMode={darkMode} />
        <MiniKpi label="총 파워" value={fmt(heat.totalPowerW, 0)} unit="W" darkMode={darkMode} />
      </div>
    </SectionShell>
  )
}

// ─── Section 2: Runout ──────────────────────────────────────────
function RunoutSection({ runout, darkMode }: { runout: RunoutEffect; darkMode: boolean }) {
  const flutesWhole = Math.floor(runout.flutesEffective)
  const flutesTotal = Math.max(flutesWhole + 1, Math.ceil(runout.flutesEffective) || 4)
  const dotsTotal = Math.max(flutesTotal, 4)
  const activeDots = Math.round(clamp01(runout.flutesEffective / dotsTotal) * dotsTotal)

  // 1.0x ~ 2.5x range
  const wearAccelPct = clamp01((runout.estimatedWearAccel - 1.0) / 1.5) * 100

  return (
    <SectionShell title="Runout 효과" icon="🎯" darkMode={darkMode}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={`text-[10px] uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            TIR (runout)
          </div>
          <div className={`font-mono tabular-nums text-lg font-semibold ${
            darkMode ? "text-slate-100" : "text-slate-800"
          }`}>
            {fmt(runout.tirUm, 1)}
            <span className={`ml-0.5 text-xs font-normal ${
              darkMode ? "text-slate-400" : "text-slate-500"
            }`}>µm</span>
          </div>
        </div>
        <div>
          <div className={`text-[10px] uppercase ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            Peak Chip Load
          </div>
          <div className={`font-mono tabular-nums text-lg font-semibold ${
            runout.peakChipLoadMultiplier > 1.3
              ? darkMode ? "text-rose-300" : "text-rose-600"
              : darkMode ? "text-slate-100" : "text-slate-800"
          }`}>
            × {fmt(runout.peakChipLoadMultiplier, 2)}
          </div>
        </div>
      </div>

      <div className="mt-2">
        <div className={`mb-1 text-[10px] uppercase ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}>
          유효 날수 {fmt(runout.flutesEffective, 1)} / {dotsTotal}
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: dotsTotal }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full ${
                i < activeDots
                  ? "bg-emerald-500"
                  : darkMode ? "bg-slate-700" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-2">
        <div className={`mb-1 flex items-center justify-between text-[10px] ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}>
          <span>마모 가속</span>
          <span className="font-mono tabular-nums">× {fmt(runout.estimatedWearAccel, 2)}</span>
        </div>
        <Bar
          value={wearAccelPct}
          max={100}
          colorClass={
            runout.estimatedWearAccel > 1.8
              ? "bg-rose-500"
              : runout.estimatedWearAccel > 1.3
              ? "bg-amber-400"
              : "bg-emerald-500"
          }
          trackClass={darkMode ? "bg-slate-700" : "bg-slate-100"}
          ariaLabel="마모 가속"
        />
        <div className={`mt-0.5 flex justify-between text-[10px] ${
          darkMode ? "text-slate-500" : "text-slate-500"
        }`}>
          <span>1.0×</span>
          <span>2.5×</span>
        </div>
      </div>
    </SectionShell>
  )
}

// ─── Section 3: Helix ──────────────────────────────────────────
function HelixSection({ helix, darkMode }: { helix: HelixDecomposition; darkMode: boolean }) {
  const forces = [
    { label: "Tangential", value: helix.tangentialForceN, color: "bg-sky-500" },
    { label: "Radial", value: helix.radialForceN, color: "bg-violet-500" },
    { label: "Axial", value: helix.axialForceN, color: "bg-amber-500" },
  ]
  const maxForce = Math.max(1, ...forces.map(f => f.value))
  const liftPct = clamp01(helix.liftRatio) * 100

  return (
    <SectionShell title="Helix Force 분해" icon="🧲" darkMode={darkMode}>
      <div className={`mb-2 flex items-center justify-between text-[10px] ${
        darkMode ? "text-slate-400" : "text-slate-500"
      }`}>
        <span>Helix Angle</span>
        <span className="font-mono tabular-nums font-semibold">
          {fmt(helix.helixAngle, 0)}°
        </span>
      </div>

      <div className="space-y-1.5">
        {forces.map(f => (
          <div key={f.label}>
            <div className={`flex items-center justify-between text-[10px] ${
              darkMode ? "text-slate-300" : "text-slate-600"
            }`}>
              <span>{f.label}</span>
              <span className="font-mono tabular-nums">{fmt(f.value, 0)} N</span>
            </div>
            <Bar
              value={f.value}
              max={maxForce}
              colorClass={f.color}
              trackClass={darkMode ? "bg-slate-700" : "bg-slate-100"}
              ariaLabel={f.label}
            />
          </div>
        ))}
      </div>

      <div className={`mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        darkMode
          ? "border-slate-700 bg-slate-900/40"
          : "border-slate-200 bg-slate-50"
      }`}>
        <span className="text-lg leading-none" aria-hidden>↑</span>
        <div className="flex-1">
          <div className={`text-[10px] ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
            Lift Ratio (공작물 들어올림)
          </div>
          <div className={`font-mono tabular-nums text-sm font-semibold ${
            helix.liftRatio > 0.4
              ? darkMode ? "text-amber-300" : "text-amber-600"
              : darkMode ? "text-slate-200" : "text-slate-700"
          }`}>
            {fmt(liftPct, 1)}%
          </div>
        </div>
        <div className={`h-1.5 w-20 overflow-hidden rounded-full ${
          darkMode ? "bg-slate-700" : "bg-slate-200"
        }`}>
          <div
            className={`h-full ${helix.liftRatio > 0.4 ? "bg-amber-400" : "bg-sky-400"}`}
            style={{ width: `${liftPct}%` }}
          />
        </div>
      </div>
    </SectionShell>
  )
}

// ─── Section 4: Monte Carlo ────────────────────────────────────
function MonteCarloSection({
  mc,
  darkMode,
}: {
  mc: MonteCarloResult
  darkMode: boolean
}) {
  function RangeBar({
    p10,
    p50,
    p90,
    label,
    unit,
  }: {
    p10: number
    p50: number
    p90: number
    label: string
    unit: string
  }) {
    const span = Math.max(1e-9, p90 - p10)
    const p50Pct = clamp01((p50 - p10) / span) * 100
    return (
      <div>
        <div className={`flex items-center justify-between text-[10px] ${
          darkMode ? "text-slate-300" : "text-slate-600"
        }`}>
          <span>{label}</span>
          <span className="font-mono tabular-nums">
            P50 {fmt(p50, 1)} {unit}
          </span>
        </div>
        <div className={`relative h-2.5 w-full rounded-full ${
          darkMode ? "bg-slate-700" : "bg-slate-100"
        }`}>
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-400"
            style={{ width: "100%" }}
          />
          <div
            className={`absolute top-1/2 h-3 w-0.5 -translate-y-1/2 ${
              darkMode ? "bg-slate-100" : "bg-slate-800"
            }`}
            style={{ left: `${p50Pct}%` }}
          />
        </div>
        <div className={`mt-0.5 flex justify-between font-mono tabular-nums text-[10px] ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}>
          <span>P10 {fmt(p10, 1)}</span>
          <span>P90 {fmt(p90, 1)}</span>
        </div>
      </div>
    )
  }

  return (
    <SectionShell
      title={`Monte Carlo 불확실성 (N=${mc.samples})`}
      icon="🎲"
      darkMode={darkMode}
    >
      <div className="space-y-2.5">
        <RangeBar
          label="공구 수명"
          unit="min"
          p10={mc.toolLifeP10}
          p50={mc.toolLifeP50}
          p90={mc.toolLifeP90}
        />
        <RangeBar
          label="MRR"
          unit="cm³/min"
          p10={mc.mrrP10}
          p50={mc.mrrP50}
          p90={mc.mrrP90}
        />
      </div>

      <div className="mt-2 flex gap-1.5">
        <span className={`flex-1 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ${
          darkMode ? "bg-sky-900/30 text-sky-300" : "bg-sky-50 text-sky-700"
        }`}>
          낮은 위험
        </span>
        <span className={`flex-1 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ${
          darkMode ? "bg-emerald-900/30 text-emerald-300" : "bg-emerald-50 text-emerald-700"
        }`}>
          평균
        </span>
        <span className={`flex-1 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ${
          darkMode ? "bg-amber-900/30 text-amber-300" : "bg-amber-50 text-amber-700"
        }`}>
          최고
        </span>
      </div>
    </SectionShell>
  )
}

// ─── Section 5: BUE ───────────────────────────────────────────
function BueSection({ bue, darkMode }: { bue: BueRisk; darkMode: boolean }) {
  // bar 범위는 criticalLow - 100 ~ criticalHigh + 100
  const lo = Math.max(0, bue.criticalLow - 100)
  const hi = bue.criticalHigh + 100
  const span = Math.max(1, hi - lo)
  const markerPct = clamp01((bue.interfaceTempC - lo) / span) * 100
  const windowStart = clamp01((bue.criticalLow - lo) / span) * 100
  const windowEnd = clamp01((bue.criticalHigh - lo) / span) * 100

  return (
    <SectionShell title="BUE 위험 윈도우" icon="⚠" darkMode={darkMode}>
      <div className="mb-2 flex items-center justify-between">
        <div className={`font-mono tabular-nums text-lg font-semibold ${
          darkMode ? "text-slate-100" : "text-slate-800"
        }`}>
          {fmt(bue.interfaceTempC, 0)}
          <span className={`ml-0.5 text-xs font-normal ${
            darkMode ? "text-slate-400" : "text-slate-500"
          }`}>°C</span>
        </div>
        <span className={riskPillClasses(bue.risk, darkMode)}>
          {bue.risk === "none" ? "안전" : bue.risk === "low" ? "낮음" : bue.risk === "mid" ? "주의" : "위험"}
        </span>
      </div>

      <div className={`relative h-4 w-full overflow-hidden rounded-full ${
        darkMode ? "bg-slate-700" : "bg-slate-100"
      }`}>
        {/* critical window */}
        <div
          className={`absolute inset-y-0 ${
            darkMode ? "bg-rose-900/50" : "bg-rose-200"
          }`}
          style={{
            left: `${windowStart}%`,
            width: `${Math.max(0, windowEnd - windowStart)}%`,
          }}
        />
        {/* marker */}
        <div
          className={`absolute top-0 bottom-0 w-0.5 ${
            bue.inWindow
              ? darkMode ? "bg-rose-300" : "bg-rose-600"
              : darkMode ? "bg-emerald-300" : "bg-emerald-600"
          }`}
          style={{ left: `calc(${markerPct}% - 1px)` }}
        />
      </div>
      <div className={`mt-1 flex justify-between font-mono tabular-nums text-[10px] ${
        darkMode ? "text-slate-400" : "text-slate-500"
      }`}>
        <span>{fmt(lo, 0)}°C</span>
        <span className={darkMode ? "text-rose-300" : "text-rose-600"}>
          BUE: {fmt(bue.criticalLow, 0)}~{fmt(bue.criticalHigh, 0)}°C
        </span>
        <span>{fmt(hi, 0)}°C</span>
      </div>

      {bue.message && (
        <div className={`mt-2 text-[11px] leading-snug break-words ${
          darkMode ? "text-slate-300" : "text-slate-600"
        }`}>
          {bue.message}
        </div>
      )}
    </SectionShell>
  )
}

// ─── Section 6: Chip Morphology ────────────────────────────────
function ChipMorphSection({
  chip,
  darkMode,
}: {
  chip: ChipMorphology
  darkMode: boolean
}) {
  const typeLabel: Record<ChipMorphology["type"], string> = {
    continuous: "연속 (Continuous)",
    segmented: "분절 (Segmented)",
    discontinuous: "불연속 (Discontinuous)",
    bue: "BUE (Built-up Edge)",
  }

  return (
    <SectionShell title="Chip Morphology" icon="🔍" darkMode={darkMode}>
      <div className="flex items-start gap-3">
        <div
          className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border text-3xl leading-none ${
            darkMode
              ? "border-slate-700 bg-slate-900/50"
              : "border-slate-200 bg-slate-50"
          }`}
          aria-hidden
        >
          {chip.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`truncate text-sm font-semibold ${
            darkMode ? "text-slate-100" : "text-slate-800"
          }`}>
            {typeLabel[chip.type]}
          </div>
          <div className={`mt-0.5 text-[11px] leading-snug break-words ${
            darkMode ? "text-slate-300" : "text-slate-600"
          }`}>
            {chip.reason}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`text-[10px] ${
              darkMode ? "text-slate-400" : "text-slate-500"
            }`}>
              공구 마모 위험
            </span>
            <span className={wearRiskBadge(chip.toolWearRisk, darkMode)}>
              {chip.toolWearRisk === "low" ? "낮음" : chip.toolWearRisk === "mid" ? "중간" : "높음"}
            </span>
          </div>
        </div>
      </div>
    </SectionShell>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

export function AdvancedMetricsPanel({
  heat,
  runout,
  helix,
  monteCarlo,
  bue,
  chipMorph,
  darkMode = false,
  expanded = false,
  onToggle,
}: AdvancedMetricsPanelProps) {
  const outerClass = useMemo(() => {
    if (darkMode) {
      return "rounded-xl border border-slate-700 bg-gradient-to-br from-slate-900 to-slate-800 p-5"
    }
    return "rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/30 p-5"
  }, [darkMode])

  const violetBadge = darkMode
    ? "bg-violet-900/40 text-violet-300 border-violet-700"
    : "bg-violet-100 text-violet-700 border-violet-300"

  const chipRiskBand = tempBand(heat.chipTempC)
  const chipRiskCls = tempBandClasses(chipRiskBand, darkMode)

  return (
    <section className={outerClass} aria-label="고급 엔지니어링 지표">
      {/* 헤더 */}
      <header className="flex items-center gap-2">
        <span className="text-xl leading-none" aria-hidden>🔬</span>
        <h3
          className={`text-base font-semibold ${
            darkMode ? "text-slate-100" : "text-slate-800"
          }`}
        >
          고급 엔지니어링 지표
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${violetBadge}`}
        >
          연구소장 모드
        </span>
        <FeatureExplainer featureId="advanced-metrics" inline darkMode={darkMode} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "접기" : "펼치기"}
          className={`ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md border text-sm transition-colors ${
            darkMode
              ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          {expanded ? "▾" : "▸"}
        </button>
      </header>

      {/* 접힌 상태: mini KPI 4개 */}
      {!expanded && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            className={`flex min-w-0 flex-col rounded-md border px-2.5 py-1.5 ${
              darkMode
                ? "border-slate-700 bg-slate-800/60"
                : "border-slate-200 bg-white"
            }`}
          >
            <span
              className={`truncate text-[10px] uppercase tracking-wide ${
                darkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              칩 온도
            </span>
            <span className="flex items-baseline gap-1 min-w-0">
              <AnimatedNumber
                value={heat.chipTempC}
                decimals={0}
                suffix="°C"
                className={`truncate font-mono tabular-nums text-sm font-semibold ${
                  darkMode ? "text-slate-100" : "text-slate-800"
                }`}
              />
              <span
                className={`flex-shrink-0 whitespace-nowrap rounded-full border px-1.5 text-[9px] font-semibold ${chipRiskCls}`}
              >
                {chipRiskBand === "green" ? "OK" : chipRiskBand === "amber" ? "주의" : "과열"}
              </span>
            </span>
          </div>
          <MiniKpi
            label="마모 가속"
            value={`× ${fmt(runout.estimatedWearAccel, 2)}`}
            darkMode={darkMode}
          />
          <div
            className={`flex min-w-0 flex-col rounded-md border px-2.5 py-1.5 ${
              darkMode
                ? "border-slate-700 bg-slate-800/60"
                : "border-slate-200 bg-white"
            }`}
          >
            <span
              className={`truncate text-[10px] uppercase tracking-wide ${
                darkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              칩 형상
            </span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="flex-shrink-0 text-base leading-none" aria-hidden>{chipMorph.icon}</span>
              <span
                className={`truncate text-xs font-semibold ${
                  darkMode ? "text-slate-100" : "text-slate-800"
                }`}
              >
                {chipMorph.type}
              </span>
            </span>
          </div>
          <MiniKpi
            label="공구수명 P50"
            value={fmt(monteCarlo.toolLifeP50, 1)}
            unit="min"
            darkMode={darkMode}
          />
        </div>
      )}

      {/* 확장 상태: 6 sections */}
      {expanded && (
        <div className="mt-4 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          <HeatSection heat={heat} darkMode={darkMode} />
          <RunoutSection runout={runout} darkMode={darkMode} />
          <HelixSection helix={helix} darkMode={darkMode} />
          <MonteCarloSection mc={monteCarlo} darkMode={darkMode} />
          <BueSection bue={bue} darkMode={darkMode} />
          <ChipMorphSection chip={chipMorph} darkMode={darkMode} />
        </div>
      )}

      {/* 하단 교육 콜아웃 */}
      <div
        className={`mt-4 rounded-md border px-3 py-2 text-[11px] leading-snug ${
          darkMode
            ? "border-violet-900/50 bg-violet-950/30 text-violet-200"
            : "border-violet-200 bg-violet-50 text-violet-800"
        }`}
      >
        <span className="font-semibold">📚 참고:</span>{" "}
        이 지표들은 Sandvik / Shaw / Trent 수식 기반 · 100% 클라이언트 계산
      </div>
    </section>
  )
}

export default AdvancedMetricsPanel
