"use client"

import { useMemo, useState } from "react"
import { Download, Target, FlaskConical } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockDoEDesign, type DoEFactor } from "../data/mock-data-engine"

interface DoeDesignerProps {
  onAskAI?: (q: string) => void
}

const DEFAULT_FACTORS: DoEFactor[] = [
  { name: "SFM", levels: [1350, 1500, 1650] },
  { name: "IPT", levels: [0.007, 0.00866, 0.01] },
  { name: "ADOC", levels: [0.04, 0.05, 0.06] },
]

export function DoeDesigner(props: DoeDesignerProps) {
  const [factors, setFactors] = useState<DoEFactor[]>(DEFAULT_FACTORS)

  const design = useMemo(() => mockDoEDesign(factors), [factors])

  function updateLevel(factorIdx: number, levelIdx: number, value: number) {
    setFactors(prev =>
      prev.map((f, i) =>
        i === factorIdx
          ? { ...f, levels: f.levels.map((l, j) => (j === levelIdx ? value : l)) }
          : f,
      ),
    )
  }

  function formatLevel(factor: string, value: number) {
    if (factor === "IPT") return value.toFixed(5)
    if (factor === "ADOC") return value.toFixed(3)
    return value.toFixed(0)
  }

  return (
    <SectionShell
      id="doe-designer"
      title="🧪 DOE 실험 설계 (Taguchi L9)"
      subtitle="3인자 × 3수준 = 27번이 아닌 9번 실험으로 최적 조건 탐색"
      infoId="doe-design"
      phase="Phase 1 · 2026 Q3"
      onAskAI={props.onAskAI}
    >
      <div className="mb-5">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-teal-500" />
          Factor Editor
        </h4>
        <div className="space-y-2">
          {factors.map((f, i) => (
            <div
              key={f.name}
              className="grid grid-cols-[80px_1fr_1fr_1fr] gap-2 items-center"
            >
              <div className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-300">
                {f.name}
              </div>
              {f.levels.map((lv, j) => (
                <div key={j}>
                  <label className="block text-[10px] text-slate-400 mb-0.5 font-mono">
                    Level {j + 1}
                  </label>
                  <input
                    type="number"
                    value={lv}
                    step={f.name === "IPT" ? 0.001 : f.name === "ADOC" ? 0.01 : 10}
                    onChange={e => updateLevel(i, j, Number(e.target.value))}
                    className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">
          Experiment Table (9 runs)
        </h4>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">#</th>
                {factors.map(f => (
                  <th key={f.name} className="px-3 py-2 text-right font-semibold font-mono">
                    {f.name}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Life (min)</th>
                <th className="px-3 py-2 text-right font-semibold">MRR</th>
                <th className="px-3 py-2 text-right font-semibold">Ra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {design.experiments.map(exp => (
                <tr
                  key={exp.id}
                  className="text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  <td className="px-3 py-1.5 font-mono text-slate-400">{exp.id}</td>
                  {factors.map(f => (
                    <td key={f.name} className="px-3 py-1.5 text-right tabular-nums font-mono">
                      {formatLevel(f.name, exp.conditions[f.name])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono text-emerald-700 dark:text-emerald-400">
                    {exp.predictedResult.toolLife.toFixed(1)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono text-sky-700 dark:text-sky-400">
                    {exp.predictedResult.mrr.toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono text-amber-700 dark:text-amber-400">
                    {exp.predictedResult.surfaceRa.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Taguchi 최적 수준
          </h4>
          <InfoToggle
            id="taguchi-method"
            content={FEATURE_EXPLANATIONS["taguchi-method"]}
            onAskAI={props.onAskAI}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {factors.map(f => (
            <div
              key={f.name}
              className="rounded border border-emerald-200 dark:border-emerald-800/50 bg-white dark:bg-slate-900 px-3 py-2"
            >
              <div className="text-[10px] font-mono text-emerald-700 dark:text-emerald-400">
                {f.name}
              </div>
              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatLevel(f.name, design.optimalHint[f.name])}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-emerald-800 dark:text-emerald-300">
          S/N 비 기반 — 각 인자별 수명 평균이 가장 높은 수준 선택. 1회 실험으로 27-run 그리드와 유사한 정보 획득.
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
          method: {design.method}
        </div>
        <button
          type="button"
          disabled
          title="실제 배포 시 다운로드"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500 cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>
    </SectionShell>
  )
}
