"use client"

import { useMemo } from "react"
import { Building2, TrendingUp, TrendingDown, Lightbulb } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockPersonalization } from "../data/mock-data-engine"

interface PersonalizationPanelProps {
  factoryId: string
  toolCode: string
  materialKey: string
  baselineConditions: { sfm: number; ipt: number; adoc: number; rdoc: number }
  onAskAI?: (q: string) => void
}

type ParamKey = "sfm" | "ipt" | "adoc" | "rdoc"

const PARAM_META: Record<ParamKey, { label: string; unit: string; digits: number }> = {
  sfm: { label: "SFM", unit: "m/min", digits: 1 },
  ipt: { label: "IPT", unit: "mm/tooth", digits: 4 },
  adoc: { label: "ADOC", unit: "mm", digits: 2 },
  rdoc: { label: "RDOC", unit: "mm", digits: 2 },
}

export function PersonalizationPanel(props: PersonalizationPanelProps) {
  const result = useMemo(
    () =>
      mockPersonalization({
        factoryId: props.factoryId,
        toolCode: props.toolCode,
        materialKey: props.materialKey,
        baselineConditions: props.baselineConditions,
      }),
    [props.factoryId, props.toolCode, props.materialKey, props.baselineConditions],
  )

  const {
    recommendedConditions,
    adjustmentReasons,
    expectedImprovement,
    confidence,
    historicalSampleSize,
  } = result

  return (
    <SectionShell
      id="personalization-panel"
      title="공장 맞춤 개인화 추천"
      subtitle={`${props.factoryId} 과거 interaction 학습 기반 Contextual Bandit`}
      infoId="factory-personalization"
      phase="Phase 2 · 2027 Q3"
      onAskAI={props.onAskAI}
    >
      {/* Two-column comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <ConditionCard
          title="기본 추천 (Sandvik Baseline)"
          subtitle="일반 가이드라인"
          conditions={props.baselineConditions}
          toneBorder="border-slate-200 dark:border-slate-700"
          toneBg="bg-slate-50 dark:bg-slate-900/50"
          infoRight={
            <InfoToggle
              id="cold-start"
              content={FEATURE_EXPLANATIONS["cold-start"]}
              onAskAI={props.onAskAI}
            />
          }
        />
        <ConditionCard
          title={
            <span className="flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-teal-500" />
              공장 {props.factoryId} 맞춤
            </span>
          }
          subtitle="과거 채택 패턴 학습 반영"
          conditions={recommendedConditions}
          baseline={props.baselineConditions}
          toneBorder="border-teal-300 dark:border-teal-800/60"
          toneBg="bg-teal-50/60 dark:bg-teal-950/30"
          infoRight={
            <InfoToggle
              id="reinforcement-learning"
              content={FEATURE_EXPLANATIONS["reinforcement-learning"]}
              onAskAI={props.onAskAI}
            />
          }
        />
      </div>

      {/* Adjustment reasons */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-4 mb-4">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
          <Lightbulb className="w-4 h-4 text-amber-500" />왜 이렇게 조정됐나?
        </div>
        <ul className="space-y-2.5">
          {adjustmentReasons.map((r, i) => {
            const isUp = r.delta.startsWith("+")
            const deltaCls = isUp
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
            return (
              <li key={`${r.param}-${i}`} className="flex items-start gap-3">
                <span className="min-w-[56px] text-xs font-mono font-bold text-slate-900 dark:text-slate-100 pt-0.5">
                  {r.param}
                </span>
                <span
                  className={`text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${deltaCls}`}
                >
                  {r.delta}
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed flex-1">
                  {r.reason}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Expected improvement */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <ImprovementStat label="공구 수명" valuePct={expectedImprovement.toolLife} />
        <ImprovementStat label="MRR (생산성)" valuePct={expectedImprovement.mrr} />
        <ImprovementStat label="표면 Ra" valuePct={expectedImprovement.surfaceRa} invertGood />
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-2">
        <span>
          학습 데이터: 공장 <span className="font-mono font-semibold">{props.factoryId}</span> 과거
          interaction <span className="font-mono font-semibold">{historicalSampleSize}</span>건
        </span>
        <span>
          신뢰도{" "}
          <span className="font-mono font-bold text-teal-600 dark:text-teal-400">
            {(confidence * 100).toFixed(0)}%
          </span>
        </span>
      </div>
    </SectionShell>
  )
}

function ConditionCard({
  title,
  subtitle,
  conditions,
  baseline,
  toneBorder,
  toneBg,
  infoRight,
}: {
  title: React.ReactNode
  subtitle: string
  conditions: { sfm: number; ipt: number; adoc: number; rdoc: number }
  baseline?: { sfm: number; ipt: number; adoc: number; rdoc: number }
  toneBorder: string
  toneBg: string
  infoRight?: React.ReactNode
}) {
  const keys: ParamKey[] = ["sfm", "ipt", "adoc", "rdoc"]
  return (
    <div className={`rounded-lg border ${toneBorder} ${toneBg} p-4`}>
      <div className="flex items-start justify-between mb-1">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</div>
        {infoRight}
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{subtitle}</div>
      <dl className="grid grid-cols-2 gap-2">
        {keys.map(k => {
          const meta = PARAM_META[k]
          const v = conditions[k]
          const b = baseline?.[k]
          const delta = b !== undefined ? ((v - b) / b) * 100 : null
          const deltaColor =
            delta === null
              ? ""
              : delta > 0.5
              ? "text-emerald-600 dark:text-emerald-400"
              : delta < -0.5
              ? "text-rose-600 dark:text-rose-400"
              : "text-slate-400"
          return (
            <div key={k} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-2.5 py-1.5">
              <dt className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {meta.label}
              </dt>
              <dd className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                  {v.toFixed(meta.digits)}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{meta.unit}</span>
                {delta !== null && Math.abs(delta) > 0.05 && (
                  <span className={`ml-auto text-[10px] font-mono font-semibold ${deltaColor}`}>
                    {delta > 0 ? "+" : ""}
                    {delta.toFixed(1)}%
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function ImprovementStat({
  label,
  valuePct,
  invertGood = false,
}: {
  label: string
  valuePct: number
  invertGood?: boolean
}) {
  // invertGood: 표면 Ra 는 낮을수록 좋음 → 음수가 개선
  const isGood = invertGood ? valuePct < 0 : valuePct > 0
  const toneCls = isGood
    ? "border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30"
    : "border-rose-300 dark:border-rose-800/60 bg-rose-50/60 dark:bg-rose-950/30"
  const textCls = isGood
    ? "text-emerald-700 dark:text-emerald-300"
    : "text-rose-700 dark:text-rose-300"
  const Icon = valuePct > 0 ? TrendingUp : TrendingDown
  return (
    <div className={`rounded-lg border ${toneCls} p-3`}>
      <div className="text-[10px] uppercase tracking-wider font-mono text-slate-500 dark:text-slate-400">
        예상 {label}
      </div>
      <div className={`flex items-center gap-1 mt-1 ${textCls}`}>
        <Icon className="w-4 h-4" />
        <span className="text-lg font-bold font-mono">
          {valuePct > 0 ? "+" : ""}
          {valuePct.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}
