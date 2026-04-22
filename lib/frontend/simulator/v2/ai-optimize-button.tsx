// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — AI 1-click Optimize Button + Modal
// - 큰 그라디언트 버튼 "🤖 AI 최적화" (violet→fuchsia)
// - 클릭 시 모달: 목표 4개(productivity/tool-life/quality/cost) 선택 → 분석 → 결과 → 적용
// - POST /api/simulator/optimize (Claude Sonnet 4.6)
// - darkMode 완전 지원
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Sparkles,
  Zap,
  Shield,
  Gem,
  DollarSign,
  Loader2,
  X,
  Check,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────
type Goal = "productivity" | "tool-life" | "quality" | "cost"

interface SimParams {
  Vc: number
  fz: number
  ap: number
  ae: number
}

interface OptimizeChange {
  param: "Vc" | "fz" | "ap" | "ae"
  from: number
  to: number
  reason: string
}

interface OptimizeResult {
  optimized: SimParams
  current: SimParams
  changes: OptimizeChange[]
  expectedImprovements: {
    mrr: string
    toolLifePct: string
    summary: string
  }
  risks: string[]
}

export interface AiOptimizeButtonProps {
  /** simulator state 전체 (Vc/fz/ap/ae 포함) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentState: any
  /** 최적화된 파라미터 적용 콜백 */
  onApply: (optimized: SimParams) => void
  /** 다크 모드 토글 */
  darkMode?: boolean
  /** 버튼 레이블 커스터마이즈 */
  label?: string
  /** 버튼 className 병합 */
  className?: string
}

// ── Goal meta ─────────────────────────────────────────────────────────
interface GoalMeta {
  id: Goal
  label: string
  desc: string
  Icon: typeof Zap
  color: "amber" | "emerald" | "sky" | "green"
}

const GOALS: GoalMeta[] = [
  {
    id: "productivity",
    label: "⚡ 생산성 최대화",
    desc: "MRR 최대, 사이클타임 최소",
    Icon: Zap,
    color: "amber",
  },
  {
    id: "tool-life",
    label: "🛡 공구 수명 최대",
    desc: "마모·열부하 최소",
    Icon: Shield,
    color: "emerald",
  },
  {
    id: "quality",
    label: "💎 표면 품질 최대",
    desc: "조도·진동 최소",
    Icon: Gem,
    color: "sky",
  },
  {
    id: "cost",
    label: "💰 비용 최저",
    desc: "공구비+시간 합계 최소",
    Icon: DollarSign,
    color: "green",
  },
]

// Color tokens (Tailwind safelist-friendly — explicit class names)
interface ColorTokens {
  ring: string
  ringDark: string
  bg: string
  bgDark: string
  text: string
  textDark: string
  border: string
  borderDark: string
  iconBg: string
  iconBgDark: string
}

const COLOR_MAP: Record<GoalMeta["color"], ColorTokens> = {
  amber: {
    ring: "ring-amber-400",
    ringDark: "ring-amber-500",
    bg: "bg-amber-50",
    bgDark: "bg-amber-950/40",
    text: "text-amber-700",
    textDark: "text-amber-300",
    border: "border-amber-200",
    borderDark: "border-amber-800",
    iconBg: "bg-amber-100",
    iconBgDark: "bg-amber-900/50",
  },
  emerald: {
    ring: "ring-emerald-400",
    ringDark: "ring-emerald-500",
    bg: "bg-emerald-50",
    bgDark: "bg-emerald-950/40",
    text: "text-emerald-700",
    textDark: "text-emerald-300",
    border: "border-emerald-200",
    borderDark: "border-emerald-800",
    iconBg: "bg-emerald-100",
    iconBgDark: "bg-emerald-900/50",
  },
  sky: {
    ring: "ring-sky-400",
    ringDark: "ring-sky-500",
    bg: "bg-sky-50",
    bgDark: "bg-sky-950/40",
    text: "text-sky-700",
    textDark: "text-sky-300",
    border: "border-sky-200",
    borderDark: "border-sky-800",
    iconBg: "bg-sky-100",
    iconBgDark: "bg-sky-900/50",
  },
  green: {
    ring: "ring-green-400",
    ringDark: "ring-green-500",
    bg: "bg-green-50",
    bgDark: "bg-green-950/40",
    text: "text-green-700",
    textDark: "text-green-300",
    border: "border-green-200",
    borderDark: "border-green-800",
    iconBg: "bg-green-100",
    iconBgDark: "bg-green-900/50",
  },
}

// ── Helpers ───────────────────────────────────────────────────────────
const PARAM_LABEL: Record<"Vc" | "fz" | "ap" | "ae", string> = {
  Vc: "Vc · 절삭속도 (m/min)",
  fz: "fz · 날당이송 (mm/tooth)",
  ap: "ap · 축방향 절입 (mm)",
  ae: "ae · 반경방향 절입 (mm)",
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "-"
  const abs = Math.abs(n)
  if (abs >= 100) return n.toFixed(1)
  if (abs >= 10) return n.toFixed(2)
  return n.toFixed(3)
}

function deltaPct(from: number, to: number): string {
  if (!from) return "-"
  const pct = ((to - from) / from) * 100
  const sign = pct > 0 ? "+" : ""
  return `${sign}${pct.toFixed(1)}%`
}

function changeDir(pct: string): "up" | "down" | "flat" {
  if (pct.startsWith("+")) return "up"
  if (pct.startsWith("-")) return "down"
  return "flat"
}

// ── Component ─────────────────────────────────────────────────────────
export function AiOptimizeButton({
  currentState,
  onApply,
  darkMode = false,
  label = "🤖 AI 최적화",
  className = "",
}: AiOptimizeButtonProps) {
  const [open, setOpen] = useState(false)
  const [goal, setGoal] = useState<Goal | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ESC 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) handleClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading])

  const reset = useCallback(() => {
    setGoal(null)
    setResult(null)
    setError(null)
    setLoading(false)
  }, [])

  const handleClose = useCallback(() => {
    if (loading) return
    setOpen(false)
    // 약간의 지연 후 상태 리셋 (모달 닫힘 애니메이션 후)
    setTimeout(reset, 200)
  }, [loading, reset])

  const runAnalyze = useCallback(async () => {
    if (!goal) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/simulator/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: currentState, goal }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(
          (errBody as { error?: string }).error ||
            `HTTP ${res.status}`,
        )
      }
      const data = (await res.json()) as OptimizeResult
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [goal, currentState])

  const handleApply = useCallback(() => {
    if (!result) return
    onApply(result.optimized)
    toast.success("AI 최적화 파라미터 적용됨", {
      description: result.expectedImprovements.summary,
    })
    setOpen(false)
    setTimeout(reset, 200)
  }, [result, onApply, reset])

  const activeGoalMeta = useMemo(
    () => GOALS.find((g) => g.id === goal) ?? null,
    [goal],
  )

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 ${
          darkMode ? "focus-visible:ring-offset-slate-900" : "focus-visible:ring-offset-white"
        } ${className}`}
        aria-label="AI 1-click 최적화 열기"
      >
        <Sparkles
          className="h-4 w-4 transition-transform group-hover:scale-110 group-hover:rotate-12"
          aria-hidden="true"
        />
        <span>{label}</span>
      </button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-optimize-title"
            className="fixed inset-0 z-[75] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-slate-950/60 backdrop-blur"
              onClick={handleClose}
              aria-hidden="true"
            />

            {/* Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={`relative w-full max-w-[720px] max-h-[92vh] overflow-hidden rounded-2xl shadow-2xl ring-1 flex flex-col ${
                darkMode
                  ? "bg-slate-900 text-slate-100 ring-slate-700"
                  : "bg-white text-slate-900 ring-slate-200"
              }`}
            >
              {/* Gradient Header */}
              <div className="relative px-6 py-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shrink-0">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="닫기"
                  disabled={loading}
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-3 pr-10">
                  <Sparkles className="w-6 h-6 shrink-0" aria-hidden="true" />
                  <div>
                    <h2
                      id="ai-optimize-title"
                      className="text-base md:text-lg font-bold"
                    >
                      AI 1-click 최적화
                    </h2>
                    <p className="text-xs md:text-sm text-white/90 mt-0.5">
                      Sandvik/Harvey 표준 기반 · Claude Sonnet 4.6
                    </p>
                  </div>
                </div>
              </div>

              {/* Body (scroll) */}
              <div className="overflow-y-auto px-6 py-5 grow">
                {/* Step 1: Goal select */}
                {!result && !loading && (
                  <GoalPicker
                    selected={goal}
                    onSelect={setGoal}
                    darkMode={darkMode}
                  />
                )}

                {/* Error */}
                {error && !loading && (
                  <div
                    className={`mt-4 rounded-lg border px-3 py-2.5 text-sm ${
                      darkMode
                        ? "bg-rose-950/40 border-rose-800 text-rose-200"
                        : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">AI 분석 실패</div>
                        <div className="mt-0.5 text-xs opacity-90">{error}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Loading */}
                {loading && (
                  <div className="py-14 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-10 h-10 animate-spin text-violet-500" />
                    <div
                      className={`text-sm font-medium ${
                        darkMode ? "text-slate-200" : "text-slate-700"
                      }`}
                    >
                      AI 분석 중... (약 5~10초)
                    </div>
                    <div
                      className={`text-xs ${
                        darkMode ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {activeGoalMeta?.label} 목표로 파라미터 최적화 중
                    </div>
                  </div>
                )}

                {/* Step 3: Result */}
                {result && !loading && (
                  <ResultView result={result} darkMode={darkMode} />
                )}
              </div>

              {/* Footer */}
              <div
                className={`shrink-0 px-6 py-3 flex items-center justify-between gap-2 border-t ${
                  darkMode
                    ? "border-slate-700 bg-slate-900/60"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={loading}
                  className={`text-xs underline-offset-2 hover:underline disabled:opacity-40 ${
                    darkMode ? "text-slate-300" : "text-slate-600"
                  }`}
                >
                  닫기
                </button>

                <div className="flex items-center gap-2">
                  {result && !loading && (
                    <button
                      type="button"
                      onClick={() => {
                        setResult(null)
                        setError(null)
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        darkMode
                          ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      다시 시도
                    </button>
                  )}

                  {!result && !loading && (
                    <button
                      type="button"
                      onClick={runAnalyze}
                      disabled={!goal}
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:from-slate-400 disabled:to-slate-400 disabled:cursor-not-allowed transition-all"
                    >
                      <Sparkles className="w-4 h-4" />
                      분석 시작
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {result && !loading && (
                    <button
                      type="button"
                      onClick={handleApply}
                      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white shadow-sm bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 transition-all"
                    >
                      <Check className="w-4 h-4" />
                      적용
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Sub: GoalPicker ───────────────────────────────────────────────────
function GoalPicker({
  selected,
  onSelect,
  darkMode,
}: {
  selected: Goal | null
  onSelect: (g: Goal) => void
  darkMode: boolean
}) {
  return (
    <div>
      <h3
        className={`text-sm font-semibold mb-3 ${
          darkMode ? "text-slate-200" : "text-slate-800"
        }`}
      >
        1단계 · 최적화 목표 선택
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {GOALS.map((g) => {
          const c = COLOR_MAP[g.color]
          const active = selected === g.id
          const bgCls = darkMode ? c.bgDark : c.bg
          const textCls = darkMode ? c.textDark : c.text
          const borderCls = darkMode ? c.borderDark : c.border
          const ringCls = darkMode ? c.ringDark : c.ring
          const iconBgCls = darkMode ? c.iconBgDark : c.iconBg
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g.id)}
              className={`group relative text-left rounded-xl border p-4 transition-all duration-150 focus:outline-none ${borderCls} ${bgCls} ${
                active
                  ? `ring-2 ${ringCls} -translate-y-0.5 shadow-md`
                  : "ring-0 hover:ring-2 hover:shadow-sm hover:-translate-y-0.5"
              } ${active ? ringCls : ""}`}
              aria-pressed={active}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex items-center justify-center w-9 h-9 rounded-lg ${iconBgCls}`}
                  aria-hidden="true"
                >
                  <g.Icon className={`w-5 h-5 ${textCls}`} />
                </div>
                <div className="grow min-w-0">
                  <div className={`text-sm font-bold ${textCls}`}>
                    {g.label}
                  </div>
                  <div
                    className={`text-xs mt-0.5 ${
                      darkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    {g.desc}
                  </div>
                </div>
                {active && (
                  <Check className={`w-4 h-4 shrink-0 ${textCls}`} />
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Sub: ResultView ───────────────────────────────────────────────────
function ResultView({
  result,
  darkMode,
}: {
  result: OptimizeResult
  darkMode: boolean
}) {
  const rows: ("Vc" | "fz" | "ap" | "ae")[] = ["Vc", "fz", "ap", "ae"]
  const changesByParam = new Map<string, OptimizeChange>(
    result.changes.map((c) => [c.param, c]),
  )

  const mrrDir = changeDir(result.expectedImprovements.mrr)
  const toolDir = changeDir(result.expectedImprovements.toolLifePct)

  return (
    <div className="space-y-5">
      {/* Compare table */}
      <div>
        <h3
          className={`text-sm font-semibold mb-2 ${
            darkMode ? "text-slate-200" : "text-slate-800"
          }`}
        >
          현재 vs 최적화
        </h3>
        <div
          className={`overflow-hidden rounded-lg border ${
            darkMode ? "border-slate-700" : "border-slate-200"
          }`}
        >
          <table className="w-full text-sm">
            <thead
              className={`${
                darkMode
                  ? "bg-slate-800 text-slate-300"
                  : "bg-slate-50 text-slate-600"
              }`}
            >
              <tr>
                <th className="text-left font-semibold px-3 py-2 w-[38%]">
                  파라미터
                </th>
                <th className="text-right font-semibold px-3 py-2">현재</th>
                <th className="text-right font-semibold px-3 py-2">최적화</th>
                <th className="text-right font-semibold px-3 py-2 w-[14%]">
                  변화
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, idx) => {
                const from = result.current[p]
                const to = result.optimized[p]
                const changed = from !== to
                const pct = deltaPct(from, to)
                const dir = changeDir(pct)
                return (
                  <tr
                    key={p}
                    className={`${
                      idx > 0
                        ? darkMode
                          ? "border-t border-slate-800"
                          : "border-t border-slate-100"
                        : ""
                    } ${
                      changed
                        ? darkMode
                          ? "bg-violet-950/20"
                          : "bg-violet-50/50"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`font-mono text-xs ${
                          darkMode ? "text-slate-200" : "text-slate-800"
                        }`}
                      >
                        {PARAM_LABEL[p]}
                      </span>
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        darkMode ? "text-slate-400" : "text-slate-500"
                      }`}
                    >
                      {fmt(from)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold ${
                        changed
                          ? darkMode
                            ? "text-violet-300"
                            : "text-violet-700"
                          : darkMode
                            ? "text-slate-300"
                            : "text-slate-700"
                      }`}
                    >
                      {fmt(to)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right text-xs font-semibold ${
                        dir === "up"
                          ? darkMode
                            ? "text-emerald-300"
                            : "text-emerald-600"
                          : dir === "down"
                            ? darkMode
                              ? "text-rose-300"
                              : "text-rose-600"
                            : darkMode
                              ? "text-slate-500"
                              : "text-slate-400"
                      }`}
                    >
                      {changed ? pct : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Change reasons */}
      {result.changes.length > 0 && (
        <div>
          <h3
            className={`text-sm font-semibold mb-2 ${
              darkMode ? "text-slate-200" : "text-slate-800"
            }`}
          >
            변경 이유
          </h3>
          <ul className="space-y-1.5">
            {rows
              .map((p) => changesByParam.get(p))
              .filter((c): c is OptimizeChange => !!c && !!c.reason)
              .map((c) => (
                <li
                  key={c.param}
                  className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                    darkMode
                      ? "bg-slate-800/70 text-slate-200"
                      : "bg-slate-50 text-slate-700"
                  }`}
                >
                  <span
                    className={`shrink-0 font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                      darkMode
                        ? "bg-violet-900/60 text-violet-200"
                        : "bg-violet-100 text-violet-700"
                    }`}
                  >
                    {c.param}
                  </span>
                  <span className="leading-relaxed">{c.reason}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* Expected improvements */}
      <div>
        <h3
          className={`text-sm font-semibold mb-2 ${
            darkMode ? "text-slate-200" : "text-slate-800"
          }`}
        >
          예상 개선
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <ImprovementCard
            label="MRR (재료 제거율)"
            value={result.expectedImprovements.mrr}
            dir={mrrDir}
            darkMode={darkMode}
          />
          <ImprovementCard
            label="공구 수명"
            value={result.expectedImprovements.toolLifePct}
            dir={toolDir}
            darkMode={darkMode}
          />
        </div>
        {result.expectedImprovements.summary && (
          <div
            className={`mt-2 rounded-md px-3 py-2 text-xs leading-relaxed ${
              darkMode
                ? "bg-violet-950/30 text-violet-200 border border-violet-900"
                : "bg-violet-50 text-violet-800 border border-violet-200"
            }`}
          >
            {result.expectedImprovements.summary}
          </div>
        )}
      </div>

      {/* Risks */}
      {result.risks.length > 0 && (
        <div>
          <h3
            className={`text-sm font-semibold mb-2 flex items-center gap-1.5 ${
              darkMode ? "text-rose-300" : "text-rose-700"
            }`}
          >
            <AlertTriangle className="w-4 h-4" />위험 요소
          </h3>
          <ul
            className={`space-y-1 rounded-lg border px-3 py-2.5 ${
              darkMode
                ? "bg-rose-950/30 border-rose-900 text-rose-200"
                : "bg-rose-50 border-rose-200 text-rose-800"
            }`}
          >
            {result.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 mt-0.5">•</span>
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Sub: ImprovementCard ──────────────────────────────────────────────
function ImprovementCard({
  label,
  value,
  dir,
  darkMode,
}: {
  label: string
  value: string
  dir: "up" | "down" | "flat"
  darkMode: boolean
}) {
  const positive = dir === "up"
  const negative = dir === "down"
  const arrow = positive ? "▲" : negative ? "▼" : "→"
  const colorCls = positive
    ? darkMode
      ? "text-emerald-300"
      : "text-emerald-600"
    : negative
      ? darkMode
        ? "text-rose-300"
        : "text-rose-600"
      : darkMode
        ? "text-slate-400"
        : "text-slate-500"
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        darkMode
          ? "bg-slate-800/60 border-slate-700"
          : "bg-white border-slate-200"
      }`}
    >
      <div
        className={`text-[11px] font-semibold ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 flex items-baseline gap-1.5 font-mono font-bold text-lg ${colorCls}`}
      >
        <span className="text-sm" aria-hidden="true">
          {arrow}
        </span>
        <span>{value}</span>
      </div>
    </div>
  )
}
