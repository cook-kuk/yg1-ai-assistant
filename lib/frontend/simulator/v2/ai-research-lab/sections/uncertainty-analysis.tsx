"use client"

import { useMemo, useState } from "react"
import { Sigma, TrendingUp } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockBayesianUncertainty } from "../data/mock-data-engine"

interface UncertaintyAnalysisProps {
  toolLifeMean: number
  onAskAI?: (q: string) => void
}

const CHART_W = 560
const CHART_H = 200
const PAD_X = 40
const PAD_Y = 20

export function UncertaintyAnalysis(props: UncertaintyAnalysisProps) {
  const [samples, setSamples] = useState(100)

  const result = useMemo(
    () => mockBayesianUncertainty(props.toolLifeMean, samples),
    [props.toolLifeMean, samples],
  )

  const { mean, std, lower95, upper95, samplePoints, effectiveSamples } = result
  const ciWidth = upper95 - lower95

  // Compute chart coordinates from samplePoints (normalized density)
  const maxDensity = Math.max(...samplePoints.map(p => p.density))
  const minX = samplePoints[0].x
  const maxX = samplePoints[samplePoints.length - 1].x
  const rangeX = maxX - minX || 1

  const toPx = (x: number, density: number) => {
    const px = PAD_X + ((x - minX) / rangeX) * (CHART_W - PAD_X * 2)
    const py = CHART_H - PAD_Y - (density / maxDensity) * (CHART_H - PAD_Y * 2)
    return { px, py }
  }

  const curvePath = samplePoints
    .map((p, i) => {
      const { px, py } = toPx(p.x, p.density)
      return `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`
    })
    .join(" ")

  // Shaded 95% CI region
  const ciPoints = samplePoints.filter(p => p.x >= lower95 && p.x <= upper95)
  const ciPath =
    ciPoints.length > 0
      ? (() => {
          const first = toPx(ciPoints[0].x, 0)
          const last = toPx(ciPoints[ciPoints.length - 1].x, 0)
          const top = ciPoints
            .map((p, i) => {
              const { px, py } = toPx(p.x, p.density)
              return `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`
            })
            .join(" ")
          return `${top} L${last.px.toFixed(2)},${last.py.toFixed(2)} L${first.px.toFixed(2)},${first.py.toFixed(2)} Z`
        })()
      : ""

  const meanPx = toPx(mean, 0).px
  const lowerPx = toPx(lower95, 0).px
  const upperPx = toPx(upper95, 0).px

  return (
    <SectionShell
      id="uncertainty-analysis"
      title="베이지안 불확실성 분석"
      subtitle="단일 예측값 대신 95% 신뢰구간을 제공합니다"
      infoId="bayesian-uncertainty"
      phase="Phase 2 · 2027 Q1 예정"
      onAskAI={props.onAskAI}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart column */}
        <div className="lg:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <TrendingUp className="w-4 h-4 text-teal-500" />
              사후 분포 (Posterior Distribution)
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              95% 신뢰구간
              <InfoToggle
                id="confidence-interval"
                content={FEATURE_EXPLANATIONS["confidence-interval"]}
                onAskAI={props.onAskAI}
              />
            </div>
          </div>

          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* x-axis */}
            <line
              x1={PAD_X}
              y1={CHART_H - PAD_Y}
              x2={CHART_W - PAD_X}
              y2={CHART_H - PAD_Y}
              stroke="currentColor"
              className="text-slate-300 dark:text-slate-700"
              strokeWidth={1}
            />

            {/* CI shaded region */}
            {ciPath && (
              <path
                d={ciPath}
                className="fill-teal-400/25 dark:fill-teal-500/20"
              />
            )}

            {/* Bell curve */}
            <path
              d={curvePath}
              fill="none"
              className="stroke-teal-600 dark:stroke-teal-400"
              strokeWidth={2}
            />

            {/* Mean vertical line */}
            <line
              x1={meanPx}
              y1={PAD_Y}
              x2={meanPx}
              y2={CHART_H - PAD_Y}
              stroke="currentColor"
              strokeDasharray="3 3"
              className="text-slate-500"
              strokeWidth={1}
            />

            {/* Lower / Upper boundary lines */}
            <line
              x1={lowerPx}
              y1={PAD_Y}
              x2={lowerPx}
              y2={CHART_H - PAD_Y}
              stroke="currentColor"
              className="text-rose-400"
              strokeWidth={1}
            />
            <line
              x1={upperPx}
              y1={PAD_Y}
              x2={upperPx}
              y2={CHART_H - PAD_Y}
              stroke="currentColor"
              className="text-rose-400"
              strokeWidth={1}
            />

            {/* x labels */}
            <text
              x={meanPx}
              y={CHART_H - 4}
              textAnchor="middle"
              className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono"
            >
              μ={mean.toFixed(1)}
            </text>
            <text
              x={lowerPx}
              y={CHART_H - 4}
              textAnchor="middle"
              className="fill-rose-500 text-[10px] font-mono"
            >
              {lower95.toFixed(1)}
            </text>
            <text
              x={upperPx}
              y={CHART_H - 4}
              textAnchor="middle"
              className="fill-rose-500 text-[10px] font-mono"
            >
              {upper95.toFixed(1)}
            </text>
          </svg>

          {/* Sample slider */}
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                <Sigma className="w-3.5 h-3.5" />
                Monte Carlo 샘플 수: <span className="font-mono font-bold text-teal-600 dark:text-teal-400">{samples}</span>
                <InfoToggle
                  id="monte-carlo"
                  content={FEATURE_EXPLANATIONS["monte-carlo"]}
                  onAskAI={props.onAskAI}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400">effective={effectiveSamples}</span>
            </div>
            <input
              type="range"
              min={10}
              max={1000}
              step={10}
              value={samples}
              onChange={e => setSamples(Number(e.target.value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>10 (빠름, 불확실)</span>
              <span>1000 (느림, 정밀)</span>
            </div>
          </div>
        </div>

        {/* Stats column */}
        <div className="space-y-3">
          <StatCard label="평균 (μ)" value={`${mean.toFixed(2)} min`} tone="slate" />
          <StatCard label="표준편차 (σ)" value={`${std.toFixed(2)} min`} tone="slate" />
          <StatCard
            label="95% 신뢰구간"
            value={`${lower95.toFixed(1)} ~ ${upper95.toFixed(1)}`}
            tone="teal"
          />
          <StatCard label="구간 폭 (width)" value={`${ciWidth.toFixed(2)} min`} tone="slate" />
          <StatCard label="유효 샘플 수" value={`${effectiveSamples}`} tone="slate" />
        </div>
      </div>

      {/* Interpretation box */}
      <div className="mt-4 rounded-lg border border-teal-200 dark:border-teal-800/50 bg-teal-50/60 dark:bg-teal-950/30 p-3">
        <div className="text-xs font-semibold text-teal-800 dark:text-teal-300 mb-1">📘 해석</div>
        <div className="text-sm text-teal-900 dark:text-teal-100 leading-relaxed">
          이 공구는 <span className="font-bold">95% 확률</span>로{" "}
          <span className="font-mono font-bold">{lower95.toFixed(1)}</span>~
          <span className="font-mono font-bold">{upper95.toFixed(1)}</span>분 사이 수명을 가집니다.
          <span className="block text-xs text-teal-700/80 dark:text-teal-300/70 mt-1">
            보수적 교체: {lower95.toFixed(1)}분 · 공격적 사용: {upper95.toFixed(1)}분까지
          </span>
        </div>
      </div>
    </SectionShell>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: "slate" | "teal"
}) {
  const toneCls =
    tone === "teal"
      ? "border-teal-300 dark:border-teal-800/60 bg-teal-50/50 dark:bg-teal-950/30"
      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50"
  const valueCls =
    tone === "teal"
      ? "text-teal-700 dark:text-teal-300"
      : "text-slate-900 dark:text-slate-100"
  return (
    <div className={`rounded-lg border ${toneCls} px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wider font-mono text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-bold font-mono ${valueCls}`}>{value}</div>
    </div>
  )
}
