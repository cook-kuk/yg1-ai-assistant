// Machine Impact Lab — locked tool banner. Sits above the config panel
// so the user always knows "this is the tool, this is the material, this
// is the operation — only the machine below is mutable".
"use client"

import { memo } from "react"
import { Lock, ExternalLink } from "lucide-react"
import type {
  DEFAULT_LOCKED_TOOL,
  DEFAULT_LOCKED_MATERIAL,
  DEFAULT_LOCKED_OPERATION,
} from "./impact-calc-engine"

interface Props {
  tool: Pick<
    typeof DEFAULT_LOCKED_TOOL,
    "code" | "seriesLabel" | "diameter" | "diameterInch" | "flutes" | "coating" | "sourceUrl"
  >
  material: Pick<typeof DEFAULT_LOCKED_MATERIAL, "label" | "sfmBase" | "iptBase" | "isoGroup">
  operation: Pick<typeof DEFAULT_LOCKED_OPERATION, "type" | "adocInch" | "rdocInch">
}

function Chip({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className={`font-mono text-[11px] font-semibold tabular-nums ${accent ?? "text-slate-800 dark:text-slate-100"}`}>
        {value}
      </span>
    </div>
  )
}

export const LockedToolBanner = memo(function LockedToolBanner({ tool, material, operation }: Props) {
  return (
    <section className="rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 p-3 shadow-sm dark:border-amber-800/60 dark:from-amber-950/40 dark:via-slate-900/40 dark:to-amber-950/40">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-200">
            고정 (Locked)
          </span>
        </div>

        {/* Tool */}
        <div className="flex flex-col gap-0.5">
          <Chip label="Tool" value={tool.code} accent="text-amber-900 dark:text-amber-100" />
          <div className="text-[10px] text-slate-600 dark:text-slate-300">{tool.seriesLabel}</div>
          <div className="flex flex-wrap gap-2 text-[9px] text-slate-500 dark:text-slate-400">
            <span>Ø {tool.diameter.toFixed(2)}mm / {tool.diameterInch.toFixed(3)}″</span>
            <span>Z{tool.flutes}</span>
            <span>{tool.coating}</span>
          </div>
        </div>

        {/* Material */}
        <div className="flex flex-col gap-0.5">
          <Chip label="Material" value={`ISO ${material.isoGroup}`} accent="text-amber-900 dark:text-amber-100" />
          <div className="text-[10px] text-slate-600 dark:text-slate-300">{material.label}</div>
          <div className="flex gap-2 text-[9px] text-slate-500 dark:text-slate-400">
            <span>SFM {material.sfmBase}</span>
            <span>IPT {material.iptBase.toFixed(5)}″</span>
          </div>
        </div>

        {/* Operation */}
        <div className="flex flex-col gap-0.5">
          <Chip label="Operation" value={operation.type.toUpperCase()} accent="text-amber-900 dark:text-amber-100" />
          <div className="flex gap-2 text-[9px] text-slate-500 dark:text-slate-400">
            <span>ap {operation.adocInch.toFixed(3)}″</span>
            <span>ae {operation.rdocInch.toFixed(3)}″</span>
          </div>
        </div>

        {tool.sourceUrl ? (
          <a
            href={tool.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800"
          >
            <ExternalLink className="h-3 w-3" />
            PDF 출처
          </a>
        ) : null}
      </div>
    </section>
  )
})
