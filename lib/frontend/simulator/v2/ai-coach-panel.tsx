"use client"

/**
 * AI 가공조건 코치 패널 (v3 STEP 6-1)
 *
 * - 현재 시뮬 state + 계산 결과를 Anthropic Claude 코치 API로 전송
 * - SSE 스트리밍으로 토큰 단위 렌더
 * - 교육 모드 on: "이 조언이 왜 나왔는지" 후속 설명 버튼
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Markdown } from "@/components/ui/markdown"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface AiCoachResults {
  n: number
  Vf: number
  MRR: number
  Pc: number
  toolLife?: number
  Ra?: number
  deflection?: number
  chatterRisk?: string
  [key: string]: unknown
}

export interface AiCoachPanelProps {
  /** 시뮬 전체 state (props drilling). 직렬화 가능한 JSON 객체 */
  state: unknown
  /** 계산 결과 (n, Vf, MRR, Pc, toolLife 등) */
  results: AiCoachResults
  /** 교육 모드: on 이면 후속 설명 버튼 노출 */
  educationMode?: boolean
  /** 시뮬 v2 수정 금지 제약 하에서 DEMO 배지 숨기려면 false */
  showDemoBadge?: boolean
  /** 엔드포인트 override (기본 /api/simulator/coach) */
  endpoint?: string
  className?: string
}

type Phase = "idle" | "loading" | "streaming" | "done" | "error"

interface StreamMeta {
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  stop_reason?: string | null
}

// ─────────────────────────────────────────────────────────────
// SSE 파싱 헬퍼
// ─────────────────────────────────────────────────────────────

interface StreamHandlers {
  onDelta: (text: string) => void
  onDone: (meta: StreamMeta) => void
  onError: (message: string) => void
}

async function consumeCoachStream(
  response: Response,
  handlers: StreamHandlers,
  signal: AbortSignal,
) {
  if (!response.body) {
    handlers.onError("응답 body가 없습니다")
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let sawDone = false

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

      // SSE 이벤트는 빈 줄(\n\n)로 구분
      const events = buffer.split("\n\n")
      buffer = events.pop() ?? ""

      for (const evt of events) {
        const line = evt.split("\n").find((l) => l.startsWith("data:"))
        if (!line) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let parsed: { type?: string; [k: string]: unknown }
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        if (parsed.type === "delta" && typeof parsed.text === "string") {
          handlers.onDelta(parsed.text)
        } else if (parsed.type === "done") {
          sawDone = true
          handlers.onDone({
            usage: parsed.usage as StreamMeta["usage"],
            stop_reason: parsed.stop_reason as string | null | undefined,
          })
        } else if (parsed.type === "error") {
          handlers.onError(
            typeof parsed.message === "string"
              ? parsed.message
              : "알 수 없는 에러",
          )
          return
        }
      }
    }

    if (!sawDone) {
      // 서버가 정상 종료 이벤트를 보내지 않고 닫은 경우
      handlers.onDone({})
    }
  } catch (err) {
    if (signal.aborted) return
    handlers.onError(err instanceof Error ? err.message : String(err))
  }
}

// ─────────────────────────────────────────────────────────────
// 스피너
// ─────────────────────────────────────────────────────────────

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <svg
        className="animate-spin h-4 w-4 text-sky-600"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
      <span>{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export function AiCoachPanel(props: AiCoachPanelProps) {
  const {
    state,
    results,
    educationMode = false,
    showDemoBadge = true,
    endpoint = "/api/simulator/coach",
    className = "",
  } = props

  const [phase, setPhase] = useState<Phase>("idle")
  const [advice, setAdvice] = useState<string>("")
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [meta, setMeta] = useState<StreamMeta | null>(null)

  // follow-up 설명
  const [followUpPhase, setFollowUpPhase] = useState<Phase>("idle")
  const [followUpAdvice, setFollowUpAdvice] = useState<string>("")
  const [followUpErr, setFollowUpErr] = useState<string | null>(null)

  // abort 관리
  const abortRef = useRef<AbortController | null>(null)
  const followUpAbortRef = useRef<AbortController | null>(null)

  // 언마운트 시 abort
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      followUpAbortRef.current?.abort()
    }
  }, [])

  // 메인 조언 요청
  const requestAdvice = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setPhase("loading")
    setAdvice("")
    setErrMsg(null)
    setMeta(null)
    // 새 조언 요청 시 follow-up 초기화
    setFollowUpPhase("idle")
    setFollowUpAdvice("")
    setFollowUpErr(null)

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, results }),
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
        setErrMsg(msg)
        return
      }

      setPhase("streaming")
      let accumulated = ""
      await consumeCoachStream(
        res,
        {
          onDelta: (t) => {
            accumulated += t
            setAdvice(accumulated)
          },
          onDone: (m) => {
            setPhase("done")
            setMeta(m)
          },
          onError: (m) => {
            setPhase("error")
            setErrMsg(m)
          },
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) return
      setPhase("error")
      setErrMsg(err instanceof Error ? err.message : String(err))
    }
  }, [endpoint, state, results])

  // follow-up 요청 (교육 모드)
  const requestFollowUp = useCallback(async () => {
    if (!advice) return
    followUpAbortRef.current?.abort()
    const ctrl = new AbortController()
    followUpAbortRef.current = ctrl

    setFollowUpPhase("loading")
    setFollowUpAdvice("")
    setFollowUpErr(null)

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          results,
          followUp: true,
          previousAdvice: advice,
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
        setFollowUpPhase("error")
        setFollowUpErr(msg)
        return
      }

      setFollowUpPhase("streaming")
      let accumulated = ""
      await consumeCoachStream(
        res,
        {
          onDelta: (t) => {
            accumulated += t
            setFollowUpAdvice(accumulated)
          },
          onDone: () => setFollowUpPhase("done"),
          onError: (m) => {
            setFollowUpPhase("error")
            setFollowUpErr(m)
          },
        },
        ctrl.signal,
      )
    } catch (err) {
      if (ctrl.signal.aborted) return
      setFollowUpPhase("error")
      setFollowUpErr(err instanceof Error ? err.message : String(err))
    }
  }, [endpoint, state, results, advice])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    followUpAbortRef.current?.abort()
    setPhase((p) =>
      p === "loading" || p === "streaming" ? "idle" : p,
    )
    setFollowUpPhase((p) =>
      p === "loading" || p === "streaming" ? "idle" : p,
    )
  }, [])

  const busy = phase === "loading" || phase === "streaming"
  const followBusy =
    followUpPhase === "loading" || followUpPhase === "streaming"

  // ─── Render ─────────────────────────────────────────────

  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm ${className}`}
      data-testid="ai-coach-panel"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden>
            🤖
          </span>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            AI 가공조건 코치
          </h3>
          {showDemoBadge && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
              DEMO
            </span>
          )}
          {educationMode && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
              EDU
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              중단
            </button>
          ) : (
            <button
              type="button"
              onClick={requestAdvice}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {phase === "done" || phase === "error"
                ? "다시 조언받기"
                : "지금 상태로 조언받기"}
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="px-4 py-4">
        {/* 상태별 메시지 */}
        {phase === "idle" && !advice && (
          <div className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            버튼을 누르면 현재 시뮬 state와 계산 결과를 기반으로
            Sandvik · Harvey · Helical 표준에 맞춘 조언을 생성합니다.
            <br />
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              응답은 한국어 400~600자, 스트리밍 렌더링 됩니다.
            </span>
          </div>
        )}

        {phase === "loading" && (
          <Spinner label="Claude Opus 4.7에 요청 중..." />
        )}

        {phase === "streaming" && !advice && (
          <Spinner label="응답 스트리밍 시작 대기..." />
        )}

        {phase === "error" && errMsg && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
          >
            <div className="font-semibold">오류</div>
            <div className="break-all">{errMsg}</div>
            <button
              type="button"
              onClick={requestAdvice}
              className="mt-1 text-[11px] font-medium text-rose-700 underline hover:text-rose-900"
            >
              재시도
            </button>
          </div>
        )}

        {advice && (
          <div className="space-y-3">
            <div className="rounded-md bg-slate-50 dark:bg-slate-800 px-3 py-2">
              <Markdown className="text-[13px] leading-relaxed text-slate-800 dark:text-slate-100">
                {advice}
              </Markdown>
              {phase === "streaming" && (
                <span className="ml-1 inline-block h-[14px] w-[2px] animate-pulse bg-sky-500 align-middle" />
              )}
            </div>

            {phase === "done" && meta?.usage && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span>in: {meta.usage.input_tokens}</span>
                <span>out: {meta.usage.output_tokens}</span>
                {meta.usage.cache_read_input_tokens > 0 && (
                  <span>cache_read: {meta.usage.cache_read_input_tokens}</span>
                )}
                {meta.usage.cache_creation_input_tokens > 0 && (
                  <span>
                    cache_write: {meta.usage.cache_creation_input_tokens}
                  </span>
                )}
                {meta.stop_reason && (
                  <span>stop: {meta.stop_reason}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Education mode: follow-up ── */}
        {educationMode && phase === "done" && advice && (
          <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                💡 이 조언이 왜 나왔는지
              </h4>
              {!followBusy && followUpPhase !== "done" && (
                <button
                  type="button"
                  onClick={requestFollowUp}
                  className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  {followUpPhase === "error"
                    ? "재시도"
                    : "공식·근거 자세히 설명"}
                </button>
              )}
              {followBusy && (
                <button
                  type="button"
                  onClick={() => followUpAbortRef.current?.abort()}
                  className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  중단
                </button>
              )}
            </div>

            {followUpPhase === "loading" && (
              <Spinner label="후속 설명 요청 중..." />
            )}

            {followUpPhase === "error" && followUpErr && (
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
              >
                <div className="font-semibold">오류</div>
                <div className="break-all">{followUpErr}</div>
              </div>
            )}

            {followUpAdvice && (
              <div className="rounded-md bg-emerald-50/50 px-3 py-2 ring-1 ring-emerald-100">
                <Markdown className="text-[12.5px] leading-relaxed text-slate-800 dark:text-slate-100">
                  {followUpAdvice}
                </Markdown>
                {followUpPhase === "streaming" && (
                  <span className="ml-1 inline-block h-[14px] w-[2px] animate-pulse bg-emerald-500 align-middle" />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer: 고지 */}
      <footer className="border-t border-slate-100 dark:border-slate-800 px-4 py-2 text-[10px] text-slate-400 dark:text-slate-500">
        조언은 Claude Opus 4.7 기반 추천이며, 실제 적용 시 반드시 공구
        제조사 카탈로그와 기계 제원으로 교차검증하세요.
      </footer>
    </section>
  )
}

export default AiCoachPanel
