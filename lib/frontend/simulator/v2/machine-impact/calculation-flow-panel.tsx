// Machine Impact Lab — calculation flow panel. Shows the math that took
// sfmBase to effSFM and then to RPM/MRR, one row per multiplier. This is
// the demo workhorse: "see, each knob moves this exact number".
"use client"

import { memo } from "react"
import { ArrowRight } from "lucide-react"
import type { ComputeInput, ComputeResult } from "./impact-calc-engine"
import { fmt } from "./impact-calc-engine"

interface Props {
  input: ComputeInput
  result: ComputeResult
}

function Row({
  label,
  value,
  mul,
  hint,
}: {
  label: string
  value: string
  mul?: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-100">
        {value}
      </span>
      {mul ? (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {mul}
        </span>
      ) : null}
      {hint ? <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span> : null}
    </div>
  )
}

export const CalculationFlowPanel = memo(function CalculationFlowPanel({ input, result }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
          계산 흐름 (Calculation Flow)
        </h3>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          SFM → RPM → MRR
        </span>
      </header>

      <div className="space-y-0.5 divide-y divide-slate-100 dark:divide-slate-800">
        {/* ── SFM derivation ─────────────────────────── */}
        <div className="pb-1.5">
          <Row label="SFM (base)" value={fmt.dec(input.sfmBase, 0)} hint="material PDF 값" />
          <Row
            label="× coolant"
            value={fmt.dec(result.coolantMul, 2)}
            mul={result.coolant.label}
          />
          <Row
            label="× rigidity"
            value={fmt.dec(result.rigidityMul, 2)}
            mul={`홀더 강성 ${result.holder.rigidity}`}
            hint={result.rigidityMul >= 1 ? "saturated (≥80)" : undefined}
          />
          <Row
            label="× stickout"
            value={fmt.dec(result.stickMul, 2)}
            mul={`L/D ${result.LD.toFixed(1)}`}
          />
          <Row
            label="× workholding"
            value={fmt.dec(result.whMul, 2)}
            mul={`${Math.round(input.workholdingPct)}%`}
          />
          <div className="mt-1 flex items-center gap-2 rounded-md bg-blue-50 px-2 py-1.5 text-[11px] dark:bg-blue-950/40">
            <ArrowRight className="h-3 w-3 text-blue-600 dark:text-blue-300" />
            <span className="text-slate-500 dark:text-slate-400">effSFM =</span>
            <span className="font-mono text-sm font-bold tabular-nums text-blue-700 dark:text-blue-200">
              {fmt.dec(result.effSFM, 0)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">ft/min</span>
          </div>
        </div>

        {/* ── RPM derivation ─────────────────────────── */}
        <div className="py-1.5">
          <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
            RPM = 3.82 · SFM / D
          </div>
          <div className="mt-0.5 pl-2 font-mono text-[10px] text-slate-500 dark:text-slate-400">
            = 3.82 · {fmt.dec(result.effSFM, 0)} / {input.D_inch.toFixed(3)}″
            {" = "}
            <span className="font-semibold text-slate-700 dark:text-slate-100">
              {fmt.int(result.calcRPM)}
            </span>
          </div>
          {result.rpmCapped < result.calcRPM ? (
            <div className="mt-0.5 pl-2 text-[10px] text-amber-700 dark:text-amber-300">
              → 스핀들/홀더 한계 {fmt.int(result.rpmLimit)} 에 cap → {fmt.int(result.rpmCapped)}
            </div>
          ) : null}
        </div>

        {/* ── IPT & MRR ──────────────────────────────── */}
        <div className="pt-1.5">
          <Row label="IPT (base)" value={fmt.dec(input.iptBase, 5)} hint="inch/tooth" />
          <Row label="× TIR" value={fmt.dec(result.tirMul, 2)} mul={`${result.holder.tirMicron ?? "—"}μm`} />
          <Row label="= effIPT" value={fmt.dec(result.effIPT, 5)} />
          <Row
            label="IPM = RPM·IPT·Z"
            value={fmt.dec(result.IPM, 1)}
            hint={`Z=${input.Z}`}
          />
          <div className="mt-1 flex items-center gap-2 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] dark:bg-emerald-950/40">
            <ArrowRight className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
            <span className="text-slate-500 dark:text-slate-400">MRR = ap·ae·IPM =</span>
            <span className="font-mono text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-200">
              {fmt.dec(result.MRR_inch3_min, 2)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">in³/min</span>
          </div>
        </div>
      </div>
    </section>
  )
})
