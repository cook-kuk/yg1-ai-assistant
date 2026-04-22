"use client"

import { AnimatedNumber } from "./animated-number"
import HolographicFrame from "./holographic-frame"
import type { WorkpieceMaterialImpact } from "./workpiece-material-model"

function pctBar(value: number, min: number, max: number): string {
  const pct = ((value - min) / Math.max(1e-6, max - min)) * 100
  return `${Math.max(6, Math.min(100, pct))}%`
}

export function WorkpieceImpactPanel({
  impact,
  chipTempC,
  workpieceTempC,
  tangentialForceN,
  toolLifeMin,
  mrr,
  darkMode = false,
}: {
  impact: WorkpieceMaterialImpact
  chipTempC: number
  workpieceTempC: number
  tangentialForceN: number
  toolLifeMin: number
  mrr: number
  darkMode?: boolean
}) {
  const card = darkMode ? "border-slate-700 bg-slate-900/70 text-slate-100" : "border-white/60 bg-white/80 text-slate-900"
  const muted = darkMode ? "text-slate-400" : "text-slate-600"
  const primary = darkMode ? "text-white" : "text-slate-900"
  const glow = impact.isoGroup === "N"
    ? "from-cyan-500 via-sky-400 to-emerald-300"
    : impact.isoGroup === "S"
    ? "from-rose-500 via-orange-400 to-amber-300"
    : impact.isoGroup === "H"
    ? "from-fuchsia-500 via-violet-500 to-slate-300"
    : "from-indigo-500 via-violet-500 to-cyan-400"

  return (
    <HolographicFrame accent="violet" intensity="strong" scanlines cornerBrackets darkMode={darkMode}>
      <div data-testid="workpiece-impact-panel" className="space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300">Workpiece Impact</div>
            <div className={`text-lg font-bold ${primary}`}>{impact.displayName}</div>
            <div className={`text-xs ${muted}`}>{impact.categoryLabel} · hardness {impact.hardnessLabel}</div>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${card}`}>
            {impact.verified ? "verified profile" : "iso fallback model"}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className={`rounded-xl border p-3 ${card}`}>
              <div className={`text-[10px] uppercase tracking-wider ${muted}`}>kc_eff</div>
              <div className="font-mono text-2xl font-bold text-violet-300">
                <AnimatedNumber value={impact.effectiveKc} />
              </div>
              <div className={`text-[11px] ${muted}`}>base {impact.baseKc} N/mm²</div>
            </div>
            <div className={`rounded-xl border p-3 ${card}`}>
              <div className={`text-[10px] uppercase tracking-wider ${muted}`}>chip temp</div>
              <div className="font-mono text-2xl font-bold text-amber-300">
                <AnimatedNumber value={chipTempC} />
              </div>
              <div className={`text-[11px] ${muted}`}>workpiece {workpieceTempC.toFixed(0)}°C</div>
            </div>
            <div className={`rounded-xl border p-3 ${card}`}>
              <div className={`text-[10px] uppercase tracking-wider ${muted}`}>tangential force</div>
              <div className="font-mono text-2xl font-bold text-rose-300">
                <AnimatedNumber value={tangentialForceN} />
              </div>
              <div className={`text-[11px] ${muted}`}>MRR {mrr.toFixed(1)} cm³/min</div>
            </div>
            <div className={`rounded-xl border p-3 ${card}`}>
              <div className={`text-[10px] uppercase tracking-wider ${muted}`}>tool life</div>
              <div className="font-mono text-2xl font-bold text-emerald-300">
                <AnimatedNumber value={toolLifeMin} decimals={1} />
              </div>
              <div className={`text-[11px] ${muted}`}>Vc rec {impact.recommendedVcRange}</div>
            </div>
          </div>

            <div className={`rounded-2xl border p-4 ${card}`}>
              <div className="mb-3 flex items-center justify-between">
              <div className={`text-sm font-semibold ${primary}`}>재질 변화 애니메이션</div>
              <div className={`rounded-full bg-gradient-to-r ${glow} px-2 py-0.5 text-[10px] font-bold text-slate-950 animate-pulse`}>
                material signature
              </div>
            </div>
            <div className="space-y-3">
              <ImpactBar label="절삭저항" value={impact.kcFactor * 100} display={`${impact.kcFactor.toFixed(2)}x`} width={pctBar(impact.kcFactor, 0.65, 1.9)} tone="violet" />
              <ImpactBar label="열집중" value={impact.thermalFactor * 100} display={`${impact.thermalFactor.toFixed(2)}x`} width={pctBar(impact.thermalFactor, 0.75, 1.9)} tone="rose" />
              <ImpactBar label="절삭성" value={impact.machinabilityIndex} display={`${impact.machinabilityIndex}`} width={pctBar(impact.machinabilityIndex, 5, 220)} tone="emerald" />
              <ImpactBar label="열전도율" value={impact.thermalConductivityWmk} display={`${impact.thermalConductivityWmk.toFixed(1)} W/mK`} width={pctBar(impact.thermalConductivityWmk, 5, 400)} tone="sky" />
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className={`rounded-xl border p-3 ${card}`}>
            <div className={`mb-2 text-sm font-semibold ${primary}`}>공식 표기</div>
            <div className={`space-y-1 font-mono text-[12px] ${muted}`}>
              <div>Q = a_p × a_e × V_f / 1000</div>
              <div>P_c = Q × k_c / (60 × 10^3 × η)</div>
              <div>h_m: average chip thickness → k_c 결정에 사용</div>
            </div>
            <div className={`mt-2 text-[11px] ${muted}`}>
              위 3개는 Sandvik milling formulas 기준 표기입니다. `k_c eff`는 아래 내부 재질 모델에서 세부 피삭재 데이터로 보정합니다.
            </div>
          </div>
          <div className={`rounded-xl border p-3 ${card}`}>
            <div className={`mb-2 text-sm font-semibold ${primary}`}>시뮬레이터 재질 모델</div>
            <div className={`space-y-1 font-mono text-[12px] ${muted}`}>
              <div>k_c,eff = k_c,ISO × material factor</div>
              <div>material factor ≈ baseline machinability / workpiece machinability</div>
              <div>T_heat factor ≈ sqrt(k_base / k_workpiece)</div>
            </div>
            <div className={`mt-2 text-[11px] ${muted}`}>
              {impact.machiningNotes}
            </div>
          </div>
        </div>

        <div className={`rounded-xl border p-3 ${card}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={`text-sm font-semibold ${primary}`}>프로파일 출처</div>
            <div className={`text-[11px] ${muted}`}>{impact.sourceName ?? "ISO fallback"}</div>
          </div>
          {impact.sourceUrl && (
            <a href={impact.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-300 underline underline-offset-2">
              {impact.sourceUrl}
            </a>
          )}
        </div>
      </div>
    </HolographicFrame>
  )
}

function ImpactBar({
  label,
  value,
  display,
  width,
  tone,
}: {
  label: string
  value: number
  display: string
  width: string
  tone: "violet" | "rose" | "emerald" | "sky"
}) {
  const fill = tone === "violet"
    ? "from-violet-500 to-fuchsia-400"
    : tone === "rose"
    ? "from-orange-500 to-rose-400"
    : tone === "emerald"
    ? "from-emerald-500 to-lime-300"
    : "from-sky-500 to-cyan-300"
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-300">
        <span>{label}</span>
        <span className="font-mono">{display}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700 ease-out`}
          style={{ width }}
          aria-label={`${label} ${value}`}
        />
      </div>
    </div>
  )
}
