"use client"

import { Lock } from "lucide-react"

interface LockedContextBannerProps {
  toolCode: string
  toolLabel: string
  materialKey: string
  materialLabel: string
  factoryId: string
}

export function LockedContextBanner(props: LockedContextBannerProps) {
  return (
    <div
      data-tour="locked-context"
      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 flex items-center gap-3"
    >
      <div className="shrink-0 p-2 bg-slate-200 dark:bg-slate-800 rounded">
        <Lock className="w-4 h-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <Field label="공구" value={`${props.toolLabel}`} subvalue={props.toolCode} />
        <Field label="재질" value={props.materialLabel} subvalue={props.materialKey} />
        <Field label="공장 ID" value={props.factoryId} subvalue="가상 demo factory" />
      </div>
    </div>
  )
}

function Field({ label, value, subvalue }: { label: string; value: string; subvalue?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-slate-900 dark:text-slate-100 font-semibold truncate">{value}</div>
      {subvalue && (
        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
          {subvalue}
        </div>
      )}
    </div>
  )
}
