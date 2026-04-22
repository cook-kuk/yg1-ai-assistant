// Machine Impact Lab — scenario compare. Takes the locked tool/material/
// operation and blasts all 6 IMPACT_PRESETS through the engine, then
// renders a side-by-side table so the user can pick "my shop is closest
// to 일반 공장, BASELINE claims are ~40% off my reality".
"use client"

import { memo, useMemo } from "react"
import type { ComputeInput, ComputeResult, ImpactPreset } from "./impact-calc-engine"
import { IMPACT_PRESETS, computeImpact, fmt } from "./impact-calc-engine"

interface Props {
  /** Locked context only — preset-specific knobs get overridden per row. */
  input: Omit<ComputeInput, "spindleKey" | "holderKey" | "coolantKey" | "stickoutInch" | "workholdingPct">
  /** Optional callback so "Load in config" buttons can hydrate the parent. */
  onPick?: (presetKey: string, preset: ImpactPreset) => void
}

const BADGE_CLASSES: Record<ImpactPreset["badge"], string> = {
  gold: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
  gray: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
  blue: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700",
  purple: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700",
  teal: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-700",
  red: "bg-red-100 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-700",
}

interface Row {
  key: string
  preset: ImpactPreset
  result: ComputeResult
}

export const ScenarioCompareTable = memo(function ScenarioCompareTable({ input, onPick }: Props) {
  const rows = useMemo<Row[]>(() => {
    return Object.entries(IMPACT_PRESETS).map(([key, preset]) => ({
      key,
      preset,
      result: computeImpact({ ...input, ...preset.config }),
    }))
  }, [input])

  const baselineMrr = rows.find((r) => r.key === "baseline")?.result.MRR_inch3_min ?? 0

  return (
    <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          시나리오 비교 (Scenario Compare)
        </h3>
        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
          같은 공구·소재·조건 · 머신만 변경
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <th className="py-2 pr-2">Scenario</th>
              <th className="py-2 px-2 text-right">RPM</th>
              <th className="py-2 px-2 text-right">IPM</th>
              <th className="py-2 px-2 text-right">MRR</th>
              <th className="py-2 px-2 text-right">Tool Life</th>
              <th className="py-2 px-2 text-center">Chatter</th>
              <th className="py-2 px-2 text-right">vs BASE</th>
              <th className="py-2 pl-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(({ key, preset, result }) => {
              const mrrRatio = baselineMrr > 0 ? result.MRR_inch3_min / baselineMrr : 1
              const ratioTone =
                mrrRatio >= 0.95
                  ? "text-emerald-700 dark:text-emerald-300"
                  : mrrRatio >= 0.6
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-red-700 dark:text-red-300"

              return (
                <tr key={key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                  <td className="py-1.5 pr-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${BADGE_CLASSES[preset.badge]}`}
                    >
                      {preset.label}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                    {fmt.int(result.rpmCapped)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                    {fmt.dec(result.IPM, 0)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                    {fmt.dec(result.MRR_inch3_min, 2)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    {fmt.int(result.toolLife_min)} min
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                        result.chatterLevel === "HIGH"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                          : result.chatterLevel === "MED"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                      }`}
                    >
                      {result.chatterLevel}
                    </span>
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono tabular-nums font-semibold ${ratioTone}`}>
                    {Math.round(mrrRatio * 100)}%
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    {onPick ? (
                      <button
                        type="button"
                        onClick={() => onPick(key, preset)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Load
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
})
