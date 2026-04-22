// Machine Impact Lab — limit check panel. Groups the engine's typed
// warnings by severity so the user sees "이건 터지기 직전", "이건 관찰만"
// at a glance.
"use client"

import { memo } from "react"
import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from "lucide-react"
import type { Warning } from "./impact-calc-engine"

interface Props {
  warnings: Warning[]
}

const LEVEL_META: Record<Warning["level"], { order: number; title: string; icon: React.ReactNode; rowClass: string }> = {
  critical: {
    order: 0,
    title: "CRITICAL",
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    rowClass: "border-red-300 bg-red-50 text-red-800 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-200",
  },
  warn: {
    order: 1,
    title: "WARN",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    rowClass: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200",
  },
  info: {
    order: 2,
    title: "INFO",
    icon: <Info className="h-3.5 w-3.5" />,
    rowClass: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200",
  },
}

export const LimitCheckPanel = memo(function LimitCheckPanel({ warnings }: Props) {
  const sorted = [...warnings].sort((a, b) => LEVEL_META[a.level].order - LEVEL_META[b.level].order)

  return (
    <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-slate-600 dark:text-slate-300 uppercase">
          한계 체크 (Limit Check)
        </h3>
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {warnings.length}건
        </span>
      </header>

      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="h-4 w-4" />
          <span className="font-medium">모든 한계 OK — 이상적 조건입니다.</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((w, i) => (
            <li
              key={`${w.code}-${i}`}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${LEVEL_META[w.level].rowClass}`}
            >
              <span className="mt-0.5 shrink-0">{LEVEL_META[w.level].icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold opacity-80">{LEVEL_META[w.level].title}</span>
                  <span className="rounded bg-black/5 px-1 py-px font-mono text-[9px] opacity-70 dark:bg-white/10">
                    {w.code}
                  </span>
                </div>
                <div className="mt-0.5 leading-snug">{w.message}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
})
