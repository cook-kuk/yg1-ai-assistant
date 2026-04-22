"use client"

import type { ReactNode } from "react"
import { InfoToggle } from "../shared/info-toggle"
import { DemoBadge } from "../shared/demo-badge"
import { FEATURE_EXPLANATIONS } from "./data/feature-explanations"

interface SectionShellProps {
  id: string
  title: string
  subtitle?: string
  infoId?: string
  phase?: string
  specialNote?: string
  onAskAI?: (q: string) => void
  children: ReactNode
  noInfoToggle?: boolean
  noDemoBadge?: boolean
}

export function SectionShell(props: SectionShellProps) {
  const content = props.infoId ? FEATURE_EXPLANATIONS[props.infoId] : undefined
  return (
    <section
      id={props.id}
      data-tour={props.id}
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm scroll-mt-20"
    >
      <div className="flex items-start justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{props.title}</h3>
            {!props.noInfoToggle && props.infoId && content && (
              <InfoToggle id={props.infoId} content={content} onAskAI={props.onAskAI} />
            )}
          </div>
          {props.subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{props.subtitle}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!props.noDemoBadge && <DemoBadge />}
          {props.phase && (
            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{props.phase}</span>
          )}
        </div>
      </div>

      {props.specialNote && (
        <div className="mb-4 px-3 py-2 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-xs text-emerald-800 dark:text-emerald-300">
          {props.specialNote}
        </div>
      )}

      {props.children}
    </section>
  )
}
