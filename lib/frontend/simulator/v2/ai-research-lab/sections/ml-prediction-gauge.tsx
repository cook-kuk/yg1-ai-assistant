"use client"

import { useMemo } from "react"
import { Sparkles, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockToolLifePredict } from "../data/mock-data-engine"

interface MlPredictionGaugeProps {
  sandvikPrediction: number
  toolCode: string
  materialKey: string
  factoryId?: string
  onAskAI?: (q: string) => void
}

export function MlPredictionGauge(props: MlPredictionGaugeProps) {
  const prediction = useMemo(
    () =>
      mockToolLifePredict({
        sandvikPrediction: props.sandvikPrediction,
        toolCode: props.toolCode,
        materialKey: props.materialKey,
        factoryId: props.factoryId,
      }),
    [props.sandvikPrediction, props.toolCode, props.materialKey, props.factoryId],
  )

  const correctionPct = (prediction.correction - 1) * 100
  const gapMinutes = prediction.mlPrediction - props.sandvikPrediction
  const topFeatures = prediction.featureImportance.slice(0, 3)

  function handleAskAI() {
    const topFeaturesStr = topFeatures
      .map(f => `${f.feature} (${f.direction === "positive" ? "+" : "-"}${(f.importance * 100).toFixed(0)}%)`)
      .join(", ")
    const q =
      `Sandvik 공식 예측은 ${props.sandvikPrediction.toFixed(1)}분인데 ML 보정 예측은 ${prediction.mlPrediction.toFixed(1)}분으로 ` +
      `${gapMinutes >= 0 ? "+" : ""}${gapMinutes.toFixed(1)}분 (${correctionPct >= 0 ? "+" : ""}${correctionPct.toFixed(1)}%) 차이가 납니다. ` +
      `가장 중요한 피처는 ${topFeaturesStr}입니다. 이 결과를 초보자도 이해할 수 있게 설명해주세요.`
    props.onAskAI?.(q)
  }

  return (
    <SectionShell
      id="ml-prediction-gauge"
      title="🎯 ML 공구 수명 예측"
      subtitle="Sandvik 공식 vs 공장 데이터로 학습된 ML 보정값"
      infoId="ml-tool-life-prediction"
      phase="Phase 1 · 2026 Q2 예정"
      onAskAI={props.onAskAI}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <MetricCard
          tag="공식"
          tagCls="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
          label="Sandvik 공식 예측"
          value={props.sandvikPrediction}
          unit="분"
          sub="일반 공식 기반 · 공장 특성 미반영"
        />
        <MetricCard
          tag="ML"
          tagCls="bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
          label="ML 보정 예측"
          value={prediction.mlPrediction}
          unit="분"
          sub={`신뢰도 ${(prediction.confidence * 100).toFixed(0)}% · 95% CI [${prediction.lower95.toFixed(1)}, ${prediction.upper95.toFixed(1)}]`}
          highlight
        />
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            ML 보정 크기
          </span>
          <span
            className={`text-xs font-mono ${
              correctionPct >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {correctionPct >= 0 ? "+" : ""}
            {correctionPct.toFixed(1)}%
          </span>
        </div>
        <CorrectionBar correctionPct={correctionPct} />
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Feature Importance (모델이 중요하게 본 요인)
          </h4>
          <InfoToggle
            id="feature-importance"
            content={FEATURE_EXPLANATIONS["feature-importance"]}
            onAskAI={props.onAskAI}
          />
        </div>
        <div className="space-y-2">
          {prediction.featureImportance.map(f => (
            <FeatureBar
              key={f.feature}
              feature={f.feature}
              importance={f.importance}
              direction={f.direction}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={handleAskAI}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-gradient-to-r from-teal-500 to-emerald-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <Sparkles className="w-4 h-4" />
        AI에게 이 결과 설명 듣기
        <ArrowRight className="w-4 h-4" />
      </button>

      <div className="mt-3 text-[11px] text-slate-400 dark:text-slate-500 font-mono text-right">
        model: {prediction.metadata.modelVersion} · trained on {prediction.metadata.trainingDataSize.toLocaleString()} samples
      </div>
    </SectionShell>
  )
}

function MetricCard({
  tag,
  tagCls,
  label,
  value,
  unit,
  sub,
  highlight,
}: {
  tag: string
  tagCls: string
  label: string
  value: number
  unit: string
  sub: string
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
          ? "border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/20"
          : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30"
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${tagCls}`}>
          {tag}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {value.toFixed(1)}
        </span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{unit}</span>
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>
    </div>
  )
}

function CorrectionBar({ correctionPct }: { correctionPct: number }) {
  // Axis is -15% to +15%. Clamp for safety.
  const clamped = Math.max(-15, Math.min(15, correctionPct))
  const pos = ((clamped + 15) / 30) * 100

  return (
    <div className="relative">
      <div className="relative h-6 rounded-full bg-gradient-to-r from-rose-200 via-slate-200 to-emerald-200 dark:from-rose-950/40 dark:via-slate-700/40 dark:to-emerald-950/40 overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-slate-400 dark:bg-slate-500" />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-slate-900 dark:bg-slate-100 ring-2 ring-white dark:ring-slate-900 shadow"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-400">
        <span>-15%</span>
        <span>0%</span>
        <span>+15%</span>
      </div>
    </div>
  )
}

function FeatureBar({
  feature,
  importance,
  direction,
}: {
  feature: string
  importance: number
  direction: "positive" | "negative"
}) {
  const pct = importance * 100
  const isPositive = direction === "positive"

  return (
    <div className="flex items-center gap-2">
      <div className="w-32 shrink-0 text-xs text-slate-700 dark:text-slate-300 truncate">
        {feature}
      </div>
      <div className="flex-1 h-5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden relative">
        <div
          className={`h-full ${
            isPositive
              ? "bg-emerald-400 dark:bg-emerald-600"
              : "bg-rose-400 dark:bg-rose-600"
          } transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 shrink-0 flex items-center justify-end gap-1 text-xs tabular-nums">
        {isPositive ? (
          <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400" />
        )}
        <span
          className={`font-mono ${
            isPositive
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-rose-700 dark:text-rose-400"
          }`}
        >
          {isPositive ? "+" : "-"}
          {pct.toFixed(1)}%
        </span>
      </div>
    </div>
  )
}
