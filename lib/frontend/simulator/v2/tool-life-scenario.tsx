// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 6-4: 공구 수명 시나리오 비교
// 3개 시나리오(Vc × 0.8 / × 1.0 / × 1.2)에 대해 수명·공구수·시간·비용을
// 한 눈에 비교. 최적 ROI(총비용 최저)를 자동 추천.
"use client"

import { useMemo } from "react"
import { Clock, Wrench, Timer, Coins, Trophy, TrendingUp, Info, BookOpen, ArrowRight } from "lucide-react"
import { estimateToolLifeMin, estimateCostPerPart } from "../cutting-calculator"

// ─── 상수 (로컬 SSOT) ────────────────────────────────
// 시나리오 3단계 — 이름, Vc 배수, 테마
const SCENARIOS = [
  {
    key: "life" as const,
    label: "수명 극대화",
    vcMult: 0.8,
    tone: "emerald",
    hint: "느리게 — 더 오래 버틴다",
  },
  {
    key: "balance" as const,
    label: "균형",
    vcMult: 1.0,
    tone: "slate",
    hint: "현재 — 카탈로그 권장",
  },
  {
    key: "prod" as const,
    label: "생산성 극대화",
    vcMult: 1.2,
    tone: "rose",
    hint: "빠르게 — 더 많이 깎는다",
  },
] as const

const LOTS_FOR_COMPARE = 100

export interface ToolLifeScenarioProps {
  currentVc: number
  VcReference: number
  coatingMult: number
  isoGroup: string
  toolMaterialE: number
  toolCostKrw: number
  machineCostPerHourKrw: number
  cycleTimeMin: number
  MRR: number
  educationMode?: boolean
  onApplyScenario?: (newVc: number) => void
  className?: string
}

interface ScenarioResult {
  key: "life" | "balance" | "prod"
  label: string
  hint: string
  tone: "emerald" | "slate" | "rose"
  vcMult: number
  Vc: number
  lifeMin: number
  toolsFor100: number
  totalMinFor100: number
  totalCostFor100: number
  costPerPart: number
  partsPerTool: number
}

function toneClasses(tone: "emerald" | "slate" | "rose", best: boolean) {
  // best: 테두리·배경 강조
  if (tone === "emerald") {
    return {
      border: best ? "border-emerald-400 ring-2 ring-emerald-200" : "border-emerald-200",
      bg: "bg-emerald-50",
      text: "text-emerald-700",
      badge: "bg-emerald-600 text-white",
      accent: "text-emerald-800",
    }
  }
  if (tone === "rose") {
    return {
      border: best ? "border-rose-400 ring-2 ring-rose-200" : "border-rose-200",
      bg: "bg-rose-50",
      text: "text-rose-700",
      badge: "bg-rose-600 text-white",
      accent: "text-rose-800",
    }
  }
  return {
    border: best ? "border-slate-400 ring-2 ring-slate-200" : "border-slate-200",
    bg: "bg-slate-50",
    text: "text-slate-700",
    badge: "bg-slate-700 text-white",
    accent: "text-slate-900",
  }
}

function formatKrw(v: number): string {
  if (!isFinite(v) || isNaN(v)) return "—"
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}억`
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만`
  return `${Math.round(v).toLocaleString()}`
}

function formatMin(v: number): string {
  if (!isFinite(v) || isNaN(v)) return "—"
  if (v >= 60) return `${(v / 60).toFixed(1)}h`
  return `${v.toFixed(1)}min`
}

export function ToolLifeScenario({
  currentVc,
  VcReference,
  coatingMult,
  isoGroup,
  toolMaterialE,
  toolCostKrw,
  machineCostPerHourKrw,
  cycleTimeMin,
  MRR,
  educationMode = false,
  onApplyScenario,
  className,
}: ToolLifeScenarioProps) {
  // 현재 Vc 가 0 이하일 때 fallback
  const vcBase = currentVc > 0 ? currentVc : VcReference > 0 ? VcReference : 100

  const results = useMemo<ScenarioResult[]>(() => {
    return SCENARIOS.map(s => {
      const Vc = vcBase * s.vcMult
      // 수명 — estimateToolLifeMin 은 Vc 에 대해 Taylor 방정식 적용
      const lifeMin = estimateToolLifeMin({
        Vc,
        VcReference,
        coatingMult,
        isoGroup,
        toolMaterialE,
      })
      // cycleTimeMin 은 한 개 가공 시간. Vc 를 바꾸면 실제 cycleTime 도 달라지지만
      // 여기서는 동일 사이클 가정(상대 비교) — 생산성은 vcMult 배율로 근사.
      const cycleTimeAdjusted = cycleTimeMin / Math.max(0.1, s.vcMult)
      const partsPerTool = cycleTimeAdjusted > 0 ? lifeMin / cycleTimeAdjusted : 0
      const toolsFor100 = partsPerTool > 0 ? Math.ceil(LOTS_FOR_COMPARE / partsPerTool) : 0
      const totalMinFor100 = cycleTimeAdjusted * LOTS_FOR_COMPARE
      const cost = estimateCostPerPart({
        toolLifeMin: lifeMin,
        cycleTimeMin: cycleTimeAdjusted,
        toolCostKrw,
        machineCostPerHourKrw,
      })
      const totalCostFor100 = cost.total * LOTS_FOR_COMPARE
      return {
        key: s.key,
        label: s.label,
        hint: s.hint,
        tone: s.tone,
        vcMult: s.vcMult,
        Vc,
        lifeMin,
        toolsFor100,
        totalMinFor100,
        totalCostFor100,
        costPerPart: cost.total,
        partsPerTool: cost.partsPerTool,
      }
    })
  }, [vcBase, VcReference, coatingMult, isoGroup, toolMaterialE, toolCostKrw, machineCostPerHourKrw, cycleTimeMin])

  // 최적 ROI: 총비용 최저 (동률이면 시간이 짧은 쪽)
  const bestKey = useMemo<ScenarioResult["key"]>(() => {
    const validCosts = results.filter(r => r.totalCostFor100 > 0 && isFinite(r.totalCostFor100))
    if (validCosts.length === 0) return "balance"
    const minCost = Math.min(...validCosts.map(r => r.totalCostFor100))
    const tied = validCosts.filter(r => Math.abs(r.totalCostFor100 - minCost) < 1e-6)
    if (tied.length === 1) return tied[0].key
    tied.sort((a, b) => a.totalMinFor100 - b.totalMinFor100)
    return tied[0].key
  }, [results])

  const bestResult = results.find(r => r.key === bestKey)

  // Taylor n (교육 모드 표시용)
  const taylorN = toolMaterialE < 300 ? 0.125 : 0.25

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">공구 수명 시나리오 비교</h3>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
            기준 Vc {vcBase.toFixed(1)} m/min · {LOTS_FOR_COMPARE}개 가공 기준
          </span>
        </div>
        {bestResult && (
          <div className="flex items-center gap-1 text-[11px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Trophy className="w-3.5 h-3.5" />
            최저 총비용: {bestResult.label}
          </div>
        )}
      </div>

      {/* 카드 3열 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {results.map(r => {
          const best = r.key === bestKey
          const cls = toneClasses(r.tone, best)
          return (
            <div
              key={r.key}
              className={`relative rounded-xl border ${cls.border} ${cls.bg} p-3 shadow-sm transition hover:shadow-md`}
              aria-label={`시나리오 ${r.label}`}
            >
              {/* 최적 배지 */}
              {best && (
                <div className="absolute -top-2 -right-2 flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 border border-amber-500 shadow-sm">
                  <Trophy className="w-3 h-3" />
                  BEST
                </div>
              )}

              {/* 카드 헤더 */}
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className={`text-[10px] uppercase tracking-wider font-bold ${cls.text}`}>
                    {r.key === "life" ? "A" : r.key === "balance" ? "B" : "C"}
                  </div>
                  <div className={`text-sm font-bold ${cls.accent}`}>
                    {best && <span className="mr-1">🏆</span>}
                    {r.label}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{r.hint}</div>
                </div>
                <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${cls.badge}`}>
                  ×{r.vcMult.toFixed(1)}
                </div>
              </div>

              {/* Vc 강조 */}
              <div className="mb-2 pb-2 border-b border-white/60">
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Vc</span>
                  <span className={`text-lg font-bold font-mono ${cls.accent}`}>{r.Vc.toFixed(0)}</span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">m/min</span>
                </div>
              </div>

              {/* 지표 리스트 */}
              <div className="space-y-1.5 text-[11px]">
                <Metric
                  icon={<Clock className="w-3.5 h-3.5 text-slate-500" />}
                  label="예상 공구 수명"
                  value={formatMin(r.lifeMin)}
                  mono
                />
                <Metric
                  icon={<Wrench className="w-3.5 h-3.5 text-slate-500" />}
                  label={`${LOTS_FOR_COMPARE}개 가공 공구수`}
                  value={`${r.toolsFor100} 개`}
                  mono
                />
                <Metric
                  icon={<Timer className="w-3.5 h-3.5 text-slate-500" />}
                  label={`${LOTS_FOR_COMPARE}개 총 시간`}
                  value={formatMin(r.totalMinFor100)}
                  mono
                />
                <Metric
                  icon={<Coins className="w-3.5 h-3.5 text-slate-500" />}
                  label={`${LOTS_FOR_COMPARE}개 총 비용`}
                  value={`₩ ${formatKrw(r.totalCostFor100)}`}
                  mono
                  emphasize
                />
                <Metric
                  icon={<Info className="w-3.5 h-3.5 text-slate-500" />}
                  label="개당 원가"
                  value={`₩ ${formatKrw(r.costPerPart)}`}
                  mono
                />
              </div>

              {/* 적용 버튼 */}
              {onApplyScenario && (
                <button
                  type="button"
                  onClick={() => onApplyScenario(r.Vc)}
                  className={`mt-3 w-full flex items-center justify-center gap-1 text-[11px] font-semibold rounded-md py-1.5 border transition ${
                    best
                      ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600"
                      : "bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700"
                  }`}
                  aria-label={`${r.label} 시나리오의 Vc ${r.Vc.toFixed(0)} m/min 적용`}
                >
                  이 Vc 적용
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 참고: MRR 시각 */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono px-1">
        <span>참고 MRR (현재): {MRR.toFixed(2)} cm³/min</span>
        <span>
          비용 = 머신시간({machineCostPerHourKrw.toLocaleString()}₩/h) + 공구원가({toolCostKrw.toLocaleString()}₩)
        </span>
      </div>

      {/* 교육 모드 footer */}
      {educationMode && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-[11px] text-blue-900 space-y-1.5 leading-relaxed">
          <div className="flex items-center gap-1.5 font-semibold">
            <BookOpen className="w-3.5 h-3.5" />
            Taylor 방정식 · 각 시나리오의 물리적 의미
          </div>
          <div className="font-mono text-[11px] bg-white/70 rounded px-2 py-1 border border-blue-100">
            V · T<sup>n</sup> = C &nbsp;⟹&nbsp; T = (C / V)<sup>1/n</sup> &nbsp; (초경 n ≈ 0.25, HSS n ≈ 0.125)
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-blue-800/90">
            <li>
              <b>A 수명 극대화 (Vc×0.8)</b>: 속도를 20% 낮추면 초경 기준 수명은 약{" "}
              <span className="font-mono">(1/0.8)<sup>1/{taylorN}</sup> ≈ {Math.pow(1 / 0.8, 1 / taylorN).toFixed(1)}배</span>{" "}
              연장됩니다. 공구비를 크게 절약하지만 사이클 타임은 증가.
            </li>
            <li>
              <b>B 균형 (Vc×1.0)</b>: 카탈로그 권장 속도. 수명·생산성의 중간점으로,
              대부분의 양산 현장이 이 구간을 시작점으로 선택합니다.
            </li>
            <li>
              <b>C 생산성 극대화 (Vc×1.2)</b>: 20% 빠르면 수명은 약{" "}
              <span className="font-mono">(1/1.2)<sup>1/{taylorN}</sup> ≈ {Math.pow(1 / 1.2, 1 / taylorN).toFixed(2)}배</span>{" "}
              (즉 약 {((1 - Math.pow(1 / 1.2, 1 / taylorN)) * 100).toFixed(0)}% 단축)로 짧아지지만 단위시간 산출량은 상승.
            </li>
          </ul>
          <div className="text-blue-700/90 border-t border-blue-200 pt-1.5">
            🏆 <b>ROI 최적</b>은 "공구비 감소" vs "머신시간 증가"의 교점에서 결정됩니다 —{" "}
            머신 시간당 단가가 높을수록 빠른 Vc(C)가, 공구 단가가 비쌀수록 느린 Vc(A)가 유리합니다.
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 내부 Metric 행 컴포넌트 ────────────────
function Metric({
  icon,
  label,
  value,
  mono = false,
  emphasize = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  mono?: boolean
  emphasize?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
        {icon}
        {label}
      </span>
      <span
        className={`${mono ? "font-mono" : ""} ${emphasize ? "font-bold text-slate-900 dark:text-slate-100" : "text-slate-800 dark:text-slate-200"}`}
      >
        {value}
      </span>
    </div>
  )
}

export default ToolLifeScenario
