// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — AI 자율 에이전트 (최고 조건 자동 탐색) 패널
// - POST /api/simulator/auto-agent  (SSE 스트리밍)
// - 목표 선택(productivity/tool-life/quality/cost) → 실행 → iteration 실시간 누적 → 최고 조건 적용
// - darkMode 완전 지원
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Sparkles,
  Loader2,
  Bot,
  Zap,
  Shield,
  Gem,
  DollarSign,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  Trophy,
  Brain,
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

interface Predicted {
  mrr: number
  toolLife: number
  Ra: number
  chatterRisk: "low" | "med" | "high"
}

interface IterationRecord {
  n: number
  params: SimParams
  predicted: Predicted
  score: number
  note: string
}

interface FinalPayload {
  bestParams: SimParams
  bestScore: number
  bestIndex: number
  reasoning: string
  history: IterationRecord[]
}

export interface AiAutoAgentPanelProps {
  /** simulator state 전체 (Vc/fz/ap/ae 포함) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentState: any
  /** 최고 파라미터 적용 콜백 */
  onApply: (params: SimParams) => void
  /** 다크 모드 */
  darkMode?: boolean
  /** 엔드포인트 override */
  endpoint?: string
  /** className 병합 */
  className?: string
  /** 기본 iteration 수 */
  defaultIterations?: number
}

// ── Goal meta ─────────────────────────────────────────────────────────
interface GoalMeta {
  id: Goal
  label: string
  desc: string
  Icon: typeof Zap
}

const GOALS: GoalMeta[] = [
  {
    id: "productivity",
    label: "⚡ 생산성 최대",
    desc: "MRR↑ 사이클↓",
    Icon: Zap,
  },
  {
    id: "tool-life",
    label: "🛡 공구 수명",
    desc: "마모·열 최소",
    Icon: Shield,
  },
  {
    id: "quality",
    label: "💎 표면 품질",
    desc: "Ra·진동 최소",
    Icon: Gem,
  },
  {
    id: "cost",
    label: "💰 비용 최저",
    desc: "공구+시간 합",
    Icon: DollarSign,
  },
]

// ── Phase ─────────────────────────────────────────────────────────────
type Phase = "idle" | "running" | "done" | "error"

// ── Helpers ───────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "-"
  const abs = Math.abs(n)
  if (abs >= 100) return n.toFixed(1)
  if (abs >= 10) return n.toFixed(2)
  return n.toFixed(3)
}

function riskColor(
  risk: "low" | "med" | "high",
  darkMode: boolean,
): string {
  if (risk === "low")
    return darkMode ? "text-emerald-300" : "text-emerald-700"
  if (risk === "med") return darkMode ? "text-amber-300" : "text-amber-700"
  return darkMode ? "text-rose-300" : "text-rose-700"
}

function riskLabel(r: "low" | "med" | "high"): string {
  return r === "low" ? "낮음" : r === "med" ? "중간" : "높음"
}

// ── SSE consumer ──────────────────────────────────────────────────────
interface SseHandlers {
  onThinking: (text: string, n?: number) => void
  onIteration: (iter: IterationRecord) => void
  onFinal: (f: FinalPayload) => void
  onError: (msg: string) => void
  onDone: () => void
}

async function consumeAgentStream(
  response: Response,
  handlers: SseHandlers,
  signal: AbortSignal,
) {
  if (!response.body) {
    handlers.onError("응답 body가 없습니다")
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      if (signal.aborted) {
        try {
          await reader.cancel()
        } catch {
          /* noop */
        }
        return
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split("\n\n")
      buffer = events.pop() ?? ""

      for (const evt of events) {
        const lines = evt.split("\n")
        let eventName = "message"
        let dataLine = ""
        for (const l of lines) {
          if (l.startsWith("event:")) eventName = l.slice(6).trim()
          else if (l.startsWith("data:")) dataLine += l.slice(5).trim()
        }
        if (!dataLine) continue
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(dataLine)
        } catch {
          continue
        }

        if (eventName === "thinking") {
          handlers.onThinking(
            typeof parsed.text === "string" ? parsed.text : "",
            typeof parsed.n === "number" ? parsed.n : undefined,
          )
        } else if (eventName === "iteration") {
          handlers.onIteration(parsed as unknown as IterationRecord)
        } else if (eventName === "final") {
          handlers.onFinal(parsed as unknown as FinalPayload)
        } else if (eventName === "error") {
          handlers.onError(
            typeof parsed.message === "string"
              ? parsed.message
              : "알 수 없는 에러",
          )
        }
      }
    }
    handlers.onDone()
  } catch (err) {
    if (signal.aborted) return
    handlers.onError(err instanceof Error ? err.message : String(err))
  }
}

// ── Main Component ────────────────────────────────────────────────────
export function AiAutoAgentPanel({
  currentState,
  onApply,
  darkMode = false,
  endpoint = "/api/simulator/auto-agent",
  className = "",
  defaultIterations = 6,
}: AiAutoAgentPanelProps) {
  const [goal, setGoal] = useState<Goal>("productivity")
  const [iterations, setIterations] = useState<number>(defaultIterations)
  const [phase, setPhase] = useState<Phase>("idle")
  const [thinking, setThinking] = useState<string>("")
  const [currentIter, setCurrentIter] = useState<number>(0)
  const [history, setHistory] = useState<IterationRecord[]>([])
  const [final, setFinal] = useState<FinalPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const thinkingBoxRef = useRef<HTMLDivElement | null>(null)

  // 언마운트 abort
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // thinking 자동 스크롤
  useEffect(() => {
    if (thinkingBoxRef.current) {
      thinkingBoxRef.current.scrollTop = thinkingBoxRef.current.scrollHeight
    }
  }, [thinking])

  const reset = useCallback(() => {
    setPhase("idle")
    setThinking("")
    setCurrentIter(0)
    setHistory([])
    setFinal(null)
    setError(null)
  }, [])

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setPhase("running")
    setThinking("")
    setCurrentIter(0)
    setHistory([])
    setFinal(null)
    setError(null)

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: currentState,
          goal,
          maxIterations: iterations,
        }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try {
          const j = await res.json()
          if (j?.error) msg = String(j.error)
        } catch {
          /* noop */
        }
        setPhase("error")
        setError(msg)
        return
      }

      await consumeAgentStream(
        res,
        {
          onThinking: (text, n) => {
            setThinking((prev) => prev + text)
            if (typeof n === "number" && n > 0) setCurrentIter(n)
          },
          onIteration: (iter) => {
            setHistory((h) => [...h, iter])
            setCurrentIter(iter.n)
          },
          onFinal: (f) => {
            setFinal(f)
            setPhase("done")
          },
          onError: (m) => {
            setError(m)
            setPhase("error")
          },
          onDone: () => {
            setPhase((p) => (p === "running" ? "done" : p))
          },
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("idle")
        return
      }
      setPhase("error")
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [endpoint, currentState, goal, iterations])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    toast("자율 에이전트 중단됨")
    setPhase("idle")
  }, [])

  const handleApply = useCallback(() => {
    if (!final) return
    onApply(final.bestParams)
    toast.success("최고 조건 적용됨", {
      description: `Vc=${fmt(final.bestParams.Vc)} · fz=${fmt(
        final.bestParams.fz,
      )} · ap=${fmt(final.bestParams.ap)} · ae=${fmt(final.bestParams.ae)}`,
    })
  }, [final, onApply])

  const running = phase === "running"
  const maxScoreInHistory = useMemo(
    () => history.reduce((m, h) => Math.max(m, h.score), 0),
    [history],
  )

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border shadow-lg ${
        darkMode
          ? "bg-slate-900 border-slate-700"
          : "bg-white border-slate-200"
      } ${className}`}
      data-testid="ai-auto-agent-panel"
    >
      {/* Gradient header */}
      <div className="relative px-5 py-4 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white">
        {/* 실행 중 pulse ring */}
        {running && (
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-t-2xl"
            style={{
              boxShadow: "0 0 40px 6px rgba(168,85,247,0.55) inset",
            }}
            animate={{ opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        )}
        <div className="relative flex items-center gap-3">
          <motion.div
            animate={running ? { rotate: 360 } : { rotate: 0 }}
            transition={
              running
                ? { repeat: Infinity, duration: 2.5, ease: "linear" }
                : { duration: 0.3 }
            }
            className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 ring-1 ring-white/30"
          >
            <Bot className="w-5 h-5" />
          </motion.div>
          <div className="grow min-w-0">
            <h3 className="text-base md:text-lg font-bold leading-tight">
              AI 자율 에이전트
            </h3>
            <p className="text-xs md:text-sm text-white/90 mt-0.5">
              여러 조건을 자동 시도해서 최고를 찾아드려요 · Claude Sonnet 4.6
            </p>
          </div>
          {running && (
            <button
              type="button"
              onClick={cancel}
              aria-label="자율 에이전트 중단"
              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/15 hover:bg-white/25 px-2.5 py-1.5 text-xs font-semibold ring-1 ring-white/30"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              중단
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        {/* IDLE / Goal picker */}
        {phase === "idle" && !final && !error && (
          <GoalSetup
            goal={goal}
            onGoal={setGoal}
            iterations={iterations}
            onIterations={setIterations}
            darkMode={darkMode}
            onRun={run}
          />
        )}

        {/* Error */}
        {phase === "error" && error && (
          <div
            className={`rounded-lg border px-3 py-2.5 text-sm ${
              darkMode
                ? "bg-rose-950/40 border-rose-800 text-rose-200"
                : "bg-rose-50 border-rose-200 text-rose-700"
            }`}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="grow">
                <div className="font-semibold">자율 에이전트 실패</div>
                <div className="mt-0.5 text-xs opacity-90 break-all">
                  {error}
                </div>
              </div>
              <button
                type="button"
                onClick={reset}
                className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                  darkMode
                    ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                <RotateCcw className="w-3 h-3" />
                초기화
              </button>
            </div>
          </div>
        )}

        {/* RUNNING / progress + iterations */}
        {(running || phase === "done") && (
          <div className="space-y-4">
            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className={`text-xs font-semibold ${
                    darkMode ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  {running ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      iteration {currentIter || "..."} / {iterations} 실험 중
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      {history.length}개 iteration 완료
                    </span>
                  )}
                </div>
                <div
                  className={`text-[11px] font-mono ${
                    darkMode ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {Math.min(currentIter, iterations)}/{iterations}
                </div>
              </div>
              <div
                className={`h-2 rounded-full overflow-hidden ${
                  darkMode ? "bg-slate-800" : "bg-slate-100"
                }`}
                role="progressbar"
                aria-valuenow={Math.min(currentIter, iterations)}
                aria-valuemin={0}
                aria-valuemax={iterations}
                aria-label={`자율 에이전트 진행도 ${Math.min(currentIter, iterations)} / ${iterations}`}
              >
                <motion.div
                  className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.min(
                      100,
                      (Math.min(currentIter, iterations) / iterations) * 100,
                    )}%`,
                  }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Thinking stream */}
              <div className="md:col-span-2">
                <div
                  className={`flex items-center gap-1.5 text-xs font-semibold mb-1.5 ${
                    darkMode ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  <Brain className="w-3.5 h-3.5 text-violet-500" />
                  AI 사고 과정
                </div>
                <div
                  ref={thinkingBoxRef}
                  className={`rounded-xl p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap max-h-[240px] overflow-y-auto ${
                    darkMode
                      ? "bg-slate-950/60 border border-slate-800 text-slate-300"
                      : "bg-slate-50 border border-slate-200 text-slate-700"
                  }`}
                >
                  {thinking ? (
                    thinking
                  ) : (
                    <span
                      className={
                        darkMode ? "text-slate-500" : "text-slate-500"
                      }
                    >
                      사고 스트림 대기 중...
                    </span>
                  )}
                  {running && (
                    <span className="ml-0.5 inline-block h-[12px] w-[2px] animate-pulse bg-violet-500 align-middle" />
                  )}
                </div>
              </div>

              {/* Iteration stack */}
              <div className="md:col-span-3">
                <div
                  className={`flex items-center justify-between text-xs font-semibold mb-1.5 ${
                    darkMode ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-fuchsia-500" />
                    지금까지 시도한 조건
                  </span>
                  {maxScoreInHistory > 0 && (
                    <span
                      className={`text-[10px] font-mono ${
                        darkMode ? "text-emerald-300" : "text-emerald-600"
                      }`}
                    >
                      최고 score {(maxScoreInHistory * 100).toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="max-h-[240px] overflow-y-auto pr-1 space-y-1.5">
                  <AnimatePresence initial={false}>
                    {history.map((iter) => (
                      <IterationCard
                        key={iter.n}
                        iter={iter}
                        isBest={
                          !!final && iter.n === history[final.bestIndex]?.n
                        }
                        darkMode={darkMode}
                      />
                    ))}
                  </AnimatePresence>
                  {history.length === 0 && (
                    <div
                      className={`rounded-lg py-6 text-center text-xs ${
                        darkMode ? "text-slate-500" : "text-slate-500"
                      }`}
                    >
                      첫 iteration 대기 중...
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Final card */}
            {phase === "done" && final && (
              <FinalView
                final={final}
                darkMode={darkMode}
                onApply={handleApply}
                onRetry={reset}
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Sub: GoalSetup ────────────────────────────────────────────────────
function GoalSetup({
  goal,
  onGoal,
  iterations,
  onIterations,
  darkMode,
  onRun,
}: {
  goal: Goal
  onGoal: (g: Goal) => void
  iterations: number
  onIterations: (n: number) => void
  darkMode: boolean
  onRun: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Big hero hint */}
      <div
        className={`rounded-2xl px-4 py-4 ${
          darkMode
            ? "bg-gradient-to-br from-indigo-950/50 via-violet-950/50 to-fuchsia-950/50 border border-violet-900"
            : "bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 border border-violet-200"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden>
            🤖
          </span>
          <div>
            <div
              className={`text-sm font-bold ${
                darkMode ? "text-violet-200" : "text-violet-900"
              }`}
            >
              AI 자율 에이전트 실행
            </div>
            <div
              className={`text-xs mt-0.5 ${
                darkMode ? "text-violet-300/80" : "text-violet-700"
              }`}
            >
              여러 조건을 자동 시도해서 최고를 찾아드려요
            </div>
          </div>
        </div>
      </div>

      {/* Goal picker */}
      <div>
        <div
          className={`text-xs font-semibold mb-2 ${
            darkMode ? "text-slate-300" : "text-slate-700"
          }`}
        >
          1. 최적화 목표
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GOALS.map((g) => {
            const active = goal === g.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onGoal(g.id)}
                aria-pressed={active}
                className={`group text-left rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                  active
                    ? darkMode
                      ? "bg-violet-900/40 border-violet-500 ring-2 ring-violet-500 -translate-y-0.5"
                      : "bg-violet-50 border-violet-400 ring-2 ring-violet-400 -translate-y-0.5"
                    : darkMode
                      ? "bg-slate-800/60 border-slate-700 hover:border-slate-600"
                      : "bg-white border-slate-200 hover:border-slate-300"
                }`}
              >
                <div
                  className={`text-[13px] font-bold ${
                    darkMode ? "text-slate-100" : "text-slate-800"
                  }`}
                >
                  {g.label}
                </div>
                <div
                  className={`text-[11px] mt-0.5 ${
                    darkMode ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  {g.desc}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Iterations */}
      <div>
        <div
          className={`text-xs font-semibold mb-2 flex items-center justify-between ${
            darkMode ? "text-slate-300" : "text-slate-700"
          }`}
        >
          <span>2. 실험 횟수</span>
          <span
            className={`font-mono ${
              darkMode ? "text-violet-300" : "text-violet-700"
            }`}
          >
            {iterations}회
          </span>
        </div>
        <input
          type="range"
          min={3}
          max={8}
          step={1}
          value={iterations}
          onChange={(e) => onIterations(Number(e.target.value))}
          aria-label={`실험 횟수 ${iterations}회 (최소 3, 최대 8)`}
          className="w-full accent-violet-500"
        />
        <div
          className={`flex justify-between text-[10px] mt-0.5 ${
            darkMode ? "text-slate-500" : "text-slate-600"
          }`}
        >
          <span>3</span>
          <span>5~6 (권장)</span>
          <span>8</span>
        </div>
      </div>

      {/* Run */}
      <button
        type="button"
        onClick={onRun}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-md bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 hover:from-indigo-600 hover:via-violet-600 hover:to-fuchsia-600 hover:shadow-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
      >
        <Sparkles className="w-4 h-4" />
        실행
      </button>
    </div>
  )
}

// ── Sub: IterationCard ────────────────────────────────────────────────
function IterationCard({
  iter,
  isBest,
  darkMode,
}: {
  iter: IterationRecord
  isBest: boolean
  darkMode: boolean
}) {
  const scorePct = Math.round(iter.score * 100)
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: 20, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`rounded-xl border px-3 py-2 transition-all duration-200 ${
        isBest
          ? darkMode
            ? "bg-gradient-to-r from-amber-950/60 to-amber-900/40 border-amber-500 ring-1 ring-amber-500"
            : "bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-400 ring-1 ring-amber-400"
          : darkMode
            ? "bg-slate-800/50 border-slate-700"
            : "bg-white border-slate-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
            isBest
              ? "bg-amber-400 text-amber-900"
              : darkMode
                ? "bg-violet-900/60 text-violet-200"
                : "bg-violet-100 text-violet-700"
          }`}
        >
          {iter.n}
        </span>
        <div className="grow flex items-center gap-1 font-mono text-[11px]">
          <ParamChip label="Vc" value={iter.params.Vc} darkMode={darkMode} />
          <ParamChip label="fz" value={iter.params.fz} darkMode={darkMode} />
          <ParamChip label="ap" value={iter.params.ap} darkMode={darkMode} />
          <ParamChip label="ae" value={iter.params.ae} darkMode={darkMode} />
        </div>
        {isBest && (
          <Trophy
            className={`w-4 h-4 shrink-0 ${
              darkMode ? "text-amber-300" : "text-amber-500"
            }`}
          />
        )}
      </div>

      {/* Score bar + predicted */}
      <div className="flex items-center gap-2">
        <div
          className={`grow h-1.5 rounded-full overflow-hidden ${
            darkMode ? "bg-slate-900" : "bg-slate-100"
          }`}
          role="progressbar"
          aria-valuenow={scorePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`iteration ${iter.n} score ${scorePct} / 100`}
        >
          <motion.div
            className={`h-full rounded-full ${
              isBest
                ? "bg-gradient-to-r from-amber-400 to-yellow-500"
                : "bg-gradient-to-r from-indigo-500 to-fuchsia-500"
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${scorePct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <span
          className={`shrink-0 font-mono text-[11px] font-bold ${
            isBest
              ? darkMode
                ? "text-amber-300"
                : "text-amber-600"
              : darkMode
                ? "text-slate-300"
                : "text-slate-700"
          }`}
        >
          {scorePct}
        </span>
        <span
          className={`shrink-0 text-[10px] font-semibold ${riskColor(
            iter.predicted.chatterRisk,
            darkMode,
          )}`}
          title={`chatter risk: ${iter.predicted.chatterRisk}`}
        >
          채터:{riskLabel(iter.predicted.chatterRisk)}
        </span>
      </div>

      {iter.note && (
        <div
          className={`mt-1.5 text-[11px] leading-snug ${
            darkMode ? "text-slate-400" : "text-slate-500"
          }`}
        >
          {iter.note}
        </div>
      )}
    </motion.div>
  )
}

// ── Sub: ParamChip ────────────────────────────────────────────────────
function ParamChip({
  label,
  value,
  darkMode,
}: {
  label: string
  value: number
  darkMode: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 ${
        darkMode
          ? "bg-slate-900/60 text-slate-300"
          : "bg-slate-50 text-slate-700"
      }`}
    >
      <span
        className={`font-semibold ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </span>
      <span>{fmt(value)}</span>
    </span>
  )
}

// ── Sub: FinalView ────────────────────────────────────────────────────
function FinalView({
  final,
  darkMode,
  onApply,
  onRetry,
}: {
  final: FinalPayload
  darkMode: boolean
  onApply: () => void
  onRetry: () => void
}) {
  const rows: ("Vc" | "fz" | "ap" | "ae")[] = ["Vc", "fz", "ap", "ae"]
  const scorePct = Math.round(final.bestScore * 100)
  const chartHeight = 72
  const chartMax = Math.max(...final.history.map((h) => h.score), 0.01)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-xl overflow-hidden border-2 ${
        darkMode
          ? "border-amber-500/60 bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900"
          : "border-amber-400 bg-gradient-to-br from-amber-50 via-white to-white"
      }`}
    >
      {/* Trophy banner */}
      <div
        className={`flex items-center gap-2 px-4 py-2.5 ${
          darkMode
            ? "bg-gradient-to-r from-amber-900/60 to-yellow-900/40 border-b border-amber-500/40"
            : "bg-gradient-to-r from-amber-100 to-yellow-100 border-b border-amber-200"
        }`}
      >
        <Trophy
          className={`w-5 h-5 ${
            darkMode ? "text-amber-300" : "text-amber-600"
          }`}
        />
        <div className="grow">
          <div
            className={`text-sm font-bold ${
              darkMode ? "text-amber-100" : "text-amber-900"
            }`}
          >
            최고 조건 발견!
          </div>
          <div
            className={`text-[11px] ${
              darkMode ? "text-amber-300/80" : "text-amber-700"
            }`}
          >
            iteration #{final.history[final.bestIndex]?.n ?? "?"} · score{" "}
            {scorePct}/100
          </div>
        </div>
        <div
          className={`font-mono text-2xl font-bold ${
            darkMode ? "text-amber-300" : "text-amber-600"
          }`}
        >
          {scorePct}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Param grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {rows.map((p) => (
            <div
              key={p}
              className={`rounded-xl border px-3 py-2 text-center ${
                darkMode
                  ? "bg-slate-800/70 border-slate-700"
                  : "bg-white border-slate-200"
              }`}
            >
              <div
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  darkMode ? "text-violet-300" : "text-violet-700"
                }`}
              >
                {p}
              </div>
              <div
                className={`font-mono font-bold text-base ${
                  darkMode ? "text-slate-100" : "text-slate-800"
                }`}
              >
                {fmt(final.bestParams[p])}
              </div>
            </div>
          ))}
        </div>

        {/* Reasoning */}
        {final.reasoning && (
          <div
            className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
              darkMode
                ? "bg-violet-950/40 border border-violet-900 text-violet-100"
                : "bg-violet-50 border border-violet-200 text-violet-900"
            }`}
          >
            <span
              className={`font-semibold mr-1 ${
                darkMode ? "text-violet-300" : "text-violet-700"
              }`}
            >
              근거:
            </span>
            {final.reasoning}
          </div>
        )}

        {/* History line chart */}
        {final.history.length >= 2 && (
          <div>
            <div
              className={`text-[11px] font-semibold mb-1.5 ${
                darkMode ? "text-slate-300" : "text-slate-700"
              }`}
            >
              iteration별 score 추이
            </div>
            <ScoreChart
              history={final.history}
              bestIndex={final.bestIndex}
              height={chartHeight}
              max={chartMax}
              darkMode={darkMode}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onApply}
            className="grow inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-bold text-white shadow-sm bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 transition-all"
          >
            <Check className="w-4 h-4" />이 조건 적용
          </button>
          <button
            type="button"
            onClick={onRetry}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
              darkMode
                ? "border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            다시 시도
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ── Sub: ScoreChart ───────────────────────────────────────────────────
function ScoreChart({
  history,
  bestIndex,
  height,
  max,
  darkMode,
}: {
  history: IterationRecord[]
  bestIndex: number
  height: number
  max: number
  darkMode: boolean
}) {
  const width = 320
  const padX = 8
  const padY = 4
  const n = history.length
  const stepX = n > 1 ? (width - padX * 2) / (n - 1) : 0
  const points = history.map((h, i) => {
    const x = padX + i * stepX
    const y = padY + (1 - h.score / (max || 1)) * (height - padY * 2)
    return { x, y, score: h.score, iter: h }
  })
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ")

  return (
    <div
      className={`rounded-xl border px-2 py-2 ${
        darkMode
          ? "bg-slate-900/60 border-slate-800"
          : "bg-slate-50 border-slate-200"
      }`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        aria-label="iteration별 score 추이 차트"
      >
        <defs>
          <linearGradient id="auto-agent-score-fill" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor={darkMode ? "#a78bfa" : "#8b5cf6"}
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor={darkMode ? "#a78bfa" : "#8b5cf6"}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {/* Area */}
        {points.length >= 2 && (
          <path
            d={`${pathD} L ${points[points.length - 1].x.toFixed(
              1,
            )} ${height - padY} L ${points[0].x.toFixed(1)} ${
              height - padY
            } Z`}
            fill="url(#auto-agent-score-fill)"
          />
        )}
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke={darkMode ? "#c4b5fd" : "#7c3aed"}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Points */}
        {points.map((p, i) => {
          const isBest = i === bestIndex
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={isBest ? 4 : 2.5}
                fill={
                  isBest
                    ? darkMode
                      ? "#fbbf24"
                      : "#f59e0b"
                    : darkMode
                      ? "#c4b5fd"
                      : "#7c3aed"
                }
                stroke={darkMode ? "#0f172a" : "#ffffff"}
                strokeWidth="1"
              />
              {isBest && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill="none"
                  stroke={darkMode ? "#fbbf24" : "#f59e0b"}
                  strokeWidth="1"
                  opacity="0.55"
                />
              )}
            </g>
          )
        })}
      </svg>
      <div
        className={`flex justify-between text-[10px] font-mono mt-0.5 ${
          darkMode ? "text-slate-500" : "text-slate-600"
        }`}
      >
        {points.map((_, i) => (
          <span key={i}>#{i + 1}</span>
        ))}
      </div>
    </div>
  )
}

export default AiAutoAgentPanel
