// Machine Impact Lab — live KPI strip. Renders the hot numbers at the
// top of the lab so scroll position stays anchored while the user sweeps
// config knobs. Pure presentational — takes a computed result + optional
// baseline and emits 4 cards with delta badges.
"use client"

import { memo } from "react"
import { Gauge, Zap, Activity, Flame } from "lucide-react"
import type { ComputeResult } from "./impact-calc-engine"
import { fmt } from "./impact-calc-engine"

interface Props {
  result: ComputeResult
  /** BASELINE result for delta rendering. Omit to skip delta badges. */
  baseline?: ComputeResult
}

type Tone = "good" | "warn" | "bad" | "neutral"

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "good":
      return "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
    case "warn":
      return "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200"
    case "bad":
      return "border-red-200 bg-red-50/70 text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
    default:
      return "border-slate-200 bg-slate-50/70 text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
  }
}

function rpmTone(pct: number): Tone {
  if (pct > 1) return "bad"
  if (pct > 0.95) return "warn"
  return "good"
}

function lifeTone(minutes: number): Tone {
  if (minutes < 10) return "bad"
  if (minutes < 20) return "warn"
  return "good"
}

function chatterTone(level: ComputeResult["chatterLevel"]): Tone {
  if (level === "HIGH") return "bad"
  if (level === "MED") return "warn"
  return "good"
}

function deltaBadge(ratio: number | undefined): { text: string; tone: Tone } | null {
  if (ratio === undefined || !Number.isFinite(ratio) || ratio === 1) return null
  const pct = (ratio - 1) * 100
  const sign = pct >= 0 ? "+" : ""
  const text = `${sign}${pct.toFixed(0)}% vs BASE`
  let tone: Tone = "neutral"
  if (pct >= 5) tone = "good"
  else if (pct <= -5) tone = "bad"
  return { text, tone }
}

function Card({
  icon,
  label,
  value,
  unit,
  sub,
  tone,
  delta,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  sub?: string
  tone: Tone
  delta?: { text: string; tone: Tone } | null
}) {
  return (
    <div className={`flex-1 rounded-lg border p-3 ${toneClasses(tone)}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tabular-nums leading-none">{value}</span>
        {unit ? <span className="text-[11px] font-medium opacity-70">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1 text-[10px] opacity-70">{sub}</div> : null}
      {delta ? (
        <div
          className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${toneClasses(delta.tone)}`}
        >
          {delta.text}
        </div>
      ) : null}
    </div>
  )
}

export const LiveKpiStrip = memo(function LiveKpiStrip({ result, baseline }: Props) {
  const rpmT = rpmTone(result.rpmCappedPct)
  const lifeT = lifeTone(result.toolLife_min)
  const chatT = chatterTone(result.chatterLevel)

  const mrrRatio = baseline ? result.MRR_inch3_min / baseline.MRR_inch3_min : undefined
  const lifeRatio = baseline ? result.toolLife_min / baseline.toolLife_min : undefined

  const mrrTone: Tone = mrrRatio === undefined ? "neutral" : mrrRatio >= 0.95 ? "good" : mrrRatio >= 0.6 ? "warn" : "bad"

  return (
    <div className="flex flex-wrap gap-2">
      <Card
        icon={<Gauge className="h-3 w-3" />}
        label="RPM"
        value={fmt.int(result.rpmCapped)}
        unit="rev/min"
        sub={
          result.rpmCapped < result.calcRPM
            ? `계산 ${fmt.int(result.calcRPM)} · ${Math.round(result.rpmCappedPct * 100)}% 한계`
            : `${Math.round(result.rpmCappedPct * 100)}% 스핀들 한계`
        }
        tone={rpmT}
      />
      <Card
        icon={<Zap className="h-3 w-3" />}
        label="MRR"
        value={fmt.dec(result.MRR_inch3_min, 2)}
        unit="in³/min"
        sub={`${fmt.dec(result.MRR_cm3_min, 1)} cm³/min · Pc ${fmt.dec(result.Pc_kW, 1)} kW`}
        tone={mrrTone}
        delta={deltaBadge(mrrRatio)}
      />
      <Card
        icon={<Activity className="h-3 w-3" />}
        label="Tool Life"
        value={fmt.int(result.toolLife_min)}
        unit="min"
        sub={`100 parts ≈ ${fmt.duration(result.cycleTime100_min)} · 공구 ${result.toolsNeeded100}개`}
        tone={lifeT}
        delta={deltaBadge(lifeRatio)}
      />
      <Card
        icon={<Flame className="h-3 w-3" />}
        label="Chatter"
        value={result.chatterLevel}
        unit={`${Math.round(result.chatterRisk * 100)}%`}
        sub={`L/D ${result.LD.toFixed(1)} · TIR ${result.holder.tirMicron ?? "—"}μm`}
        tone={chatT}
      />
    </div>
  )
})
