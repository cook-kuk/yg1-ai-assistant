"use client"

import { useMemo, useState } from "react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockSurvivalCurve, type SurvivalCurve } from "../data/mock-data-engine"

interface SurvivalCurvePanelProps {
  expectedLife: number
  onAskAI?: (q: string) => void
}

type GroupBy = "coolant" | "holder" | null

interface CurveConfig {
  label: string
  multiplier: number
  color: string
  seed: number
}

const COOLANT_GROUPS: CurveConfig[] = [
  { label: "Flood", multiplier: 1.0, color: "#0ea5e9", seed: 1001 },
  { label: "MQL", multiplier: 0.9, color: "#14b8a6", seed: 1002 },
  { label: "Dry", multiplier: 0.7, color: "#f97316", seed: 1003 },
]

const HOLDER_GROUPS: CurveConfig[] = [
  { label: "Shrink-fit", multiplier: 1.1, color: "#8b5cf6", seed: 2001 },
  { label: "ER Collet", multiplier: 1.0, color: "#0ea5e9", seed: 2002 },
  { label: "Side-Lock", multiplier: 0.85, color: "#ef4444", seed: 2003 },
]

export function SurvivalCurvePanel(props: SurvivalCurvePanelProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("coolant")

  const curves = useMemo(() => {
    const groups: CurveConfig[] =
      groupBy === "coolant"
        ? COOLANT_GROUPS
        : groupBy === "holder"
        ? HOLDER_GROUPS
        : [{ label: "전체", multiplier: 1.0, color: "#0ea5e9", seed: 3001 }]

    return groups.map(g => ({
      config: g,
      curve: mockSurvivalCurve(props.expectedLife * g.multiplier, 200, g.seed),
    }))
  }, [props.expectedLife, groupBy])

  return (
    <SectionShell
      id="survival-curve-panel"
      title="📉 생존분석 (Kaplan-Meier)"
      subtitle="시간 경과에 따른 공구 생존 확률 — 그룹별 비교"
      infoId="survival-analysis"
      phase="Phase 2 · 2027 Q2"
      onAskAI={props.onAskAI}
    >
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          그룹별 비교:
        </span>
        <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          <GroupTab
            active={groupBy === "coolant"}
            onClick={() => setGroupBy("coolant")}
            label="쿨런트"
          />
          <GroupTab
            active={groupBy === "holder"}
            onClick={() => setGroupBy("holder")}
            label="홀더"
          />
          <GroupTab active={groupBy === null} onClick={() => setGroupBy(null)} label="전체" />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <InfoToggle
            id="kaplan-meier"
            content={FEATURE_EXPLANATIONS["kaplan-meier"]}
            onAskAI={props.onAskAI}
          />
          <InfoToggle
            id="cox-regression"
            content={FEATURE_EXPLANATIONS["cox-regression"]}
            onAskAI={props.onAskAI}
          />
          <InfoToggle
            id="weibull"
            content={FEATURE_EXPLANATIONS["weibull"]}
            onAskAI={props.onAskAI}
          />
        </div>
      </div>

      <KmChart curves={curves} />

      <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">그룹</th>
              <th className="px-3 py-2 text-right font-semibold">P25 (25% 생존)</th>
              <th className="px-3 py-2 text-right font-semibold">Median (50%)</th>
              <th className="px-3 py-2 text-right font-semibold">P75 (75% 생존)</th>
              <th className="px-3 py-2 text-right font-semibold font-mono">Weibull k / λ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {curves.map(({ config, curve }) => (
              <tr key={config.label} className="text-slate-700 dark:text-slate-300">
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: config.color }}
                    />
                    {config.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                  {curve.p75.toFixed(1)} min
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-mono font-semibold">
                  {curve.median.toFixed(1)} min
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                  {curve.p25.toFixed(1)} min
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-mono text-slate-400">
                  {curve.shape.toFixed(1)} / {curve.scale.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        Weibull 형상모수 k≈2 → 마모 파손 패턴 (정상). k&lt;1 이면 조기 파손(제조 불량), k&gt;3 이면 피로 누적.
      </div>
    </SectionShell>
  )
}

function GroupTab({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-teal-500 text-white"
          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  )
}

interface CurveDatum {
  config: CurveConfig
  curve: SurvivalCurve
}

function KmChart({ curves }: { curves: CurveDatum[] }) {
  const width = 720
  const height = 260
  const margin = { top: 12, right: 20, bottom: 36, left: 48 }
  const iw = width - margin.left - margin.right
  const ih = height - margin.top - margin.bottom

  const xMax = Math.max(...curves.map(c => c.curve.points[c.curve.points.length - 1].timeMin))
  const x = (t: number) => margin.left + (t / xMax) * iw
  const y = (p: number) => margin.top + (1 - p) * ih

  // Median crosshair uses first curve's median as reference
  const medianRef = curves[0]?.curve.median ?? 0

  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * xMax)
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/20 p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Kaplan-Meier survival curves"
      >
        {yTicks.map(t => (
          <g key={`gy-${t}`}>
            <line
              x1={margin.left}
              x2={margin.left + iw}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray="3 3"
              className="text-slate-500"
            />
            <text
              x={margin.left - 8}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              className="fill-slate-500"
            >
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {xTicks.map((t, i) => (
          <g key={`gx-${i}`}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={margin.top}
              y2={margin.top + ih}
              stroke="currentColor"
              strokeOpacity={0.05}
              className="text-slate-500"
            />
            <text
              x={x(t)}
              y={margin.top + ih + 14}
              textAnchor="middle"
              fontSize="10"
              className="fill-slate-500"
            >
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        <line
          x1={margin.left}
          x2={margin.left + iw}
          y1={margin.top + ih}
          y2={margin.top + ih}
          stroke="currentColor"
          strokeOpacity={0.25}
          className="text-slate-500"
        />
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + ih}
          stroke="currentColor"
          strokeOpacity={0.25}
          className="text-slate-500"
        />

        {/* Axis labels */}
        <text
          x={margin.left + iw / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="10"
          className="fill-slate-500"
        >
          Time (minutes)
        </text>
        <text
          x={12}
          y={margin.top + ih / 2}
          textAnchor="middle"
          fontSize="10"
          transform={`rotate(-90 12 ${margin.top + ih / 2})`}
          className="fill-slate-500"
        >
          Survival Probability
        </text>

        {/* Median crosshair (dashed) */}
        {medianRef > 0 && medianRef < xMax && (
          <g>
            <line
              x1={x(medianRef)}
              x2={x(medianRef)}
              y1={margin.top}
              y2={y(0.5)}
              stroke="#64748b"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <line
              x1={margin.left}
              x2={x(medianRef)}
              y1={y(0.5)}
              y2={y(0.5)}
              stroke="#64748b"
              strokeDasharray="4 3"
              strokeWidth={1}
            />
            <text
              x={x(medianRef) + 4}
              y={margin.top + 10}
              fontSize="9"
              className="fill-slate-500 font-mono"
            >
              median ≈ {medianRef.toFixed(0)} min
            </text>
          </g>
        )}

        {/* Curves */}
        {curves.map(({ config, curve }) => {
          const d = curve.points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.timeMin).toFixed(1)} ${y(p.survivalProb).toFixed(1)}`)
            .join(" ")
          return (
            <path
              key={config.label}
              d={d}
              fill="none"
              stroke={config.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          )
        })}
      </svg>

      <div className="flex items-center justify-center flex-wrap gap-4 mt-1 pb-1">
        {curves.map(({ config }) => (
          <div key={config.label} className="inline-flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ backgroundColor: config.color, height: 2 }}
            />
            <span className="text-slate-600 dark:text-slate-400">{config.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
