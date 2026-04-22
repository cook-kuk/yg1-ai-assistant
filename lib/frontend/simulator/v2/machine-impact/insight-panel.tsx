// Machine Impact Lab — insight panel. Renders the rule-based insights
// from `insight-generator.ts` as short actionable bullets so the user
// moves from "what do these numbers mean" to "what should I do".
"use client"

import { memo } from "react"
import { Lightbulb } from "lucide-react"
import type { Insight } from "./insight-generator"

interface Props {
  insights: Insight[]
}

const TONE_CLASSES: Record<Insight["tone"], string> = {
  positive:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200",
  neutral:
    "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100",
  caution:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
}

export const InsightPanel = memo(function InsightPanel({ insights }: Props) {
  if (insights.length === 0) return null

  return (
    <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          <span>해석 및 권장 (Insights)</span>
        </div>
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {insights.length}개
        </span>
      </header>

      <ul className="space-y-1.5">
        {insights.map((ins, i) => (
          <li
            key={i}
            className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${TONE_CLASSES[ins.tone]}`}
          >
            <span className="text-sm leading-tight">{ins.icon}</span>
            <span>{ins.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
})
