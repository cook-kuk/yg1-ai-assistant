"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Sparkles, Loader2, RotateCw, ChevronUp } from "lucide-react"
import { Markdown } from "@/components/ui/markdown"

interface SimWarning {
  level: "error" | "warn" | "info"
  message: string
}

interface AiWarningExplainContext {
  Vc: number
  fz: number
  ap: number
  ae: number
  materialGroup: string
  diameter: number
  fluteCount: number
  stickoutMm: number
  rpm: number
}

interface AiWarningExplainProps {
  warning: SimWarning
  context: AiWarningExplainContext
  onAutoAdjust?: (warning: SimWarning, context: AiWarningExplainContext) => void
  darkMode?: boolean
}

/**
 * AiWarningExplain
 *
 * 경고 row 우측에 "🤖 AI에게 물어보기" 버튼을 렌더하고, 클릭 시
 * /api/simulator/explain-warning 를 호출해 해설을 받아 경고 아래에
 * expand 영역으로 펼쳐 보여준다. 동일 warning/context 조합에 대해
 * 한번 받은 해설은 로컬 state 에 캐시하며, "다시 분석" 버튼으로
 * 캐시 무효화 후 재요청할 수 있다.
 */
export function AiWarningExplain({
  warning,
  context,
  onAutoAdjust,
  darkMode = false,
}: AiWarningExplainProps) {
  const [explanation, setExplanation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  async function fetchExplanation(force = false) {
    if (loading) return
    if (!force && explanation) {
      setExpanded(true)
      return
    }

    setLoading(true)
    setError(null)
    if (force) setExplanation(null)

    try {
      const res = await fetch("/api/simulator/explain-warning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warning, context }),
      })

      const data = (await res.json()) as {
        explanation?: string
        error?: string
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      setExplanation(data.explanation ?? "")
      setExpanded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }

  const buttonBase =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors"
  const buttonIdle = darkMode
    ? "bg-violet-900/40 text-violet-200 hover:bg-violet-800/60 border border-violet-700/50"
    : "bg-violet-100 text-violet-700 hover:bg-violet-200 border border-violet-200"
  const buttonDisabled = "opacity-60 cursor-wait"

  const gradientBg = darkMode
    ? "bg-gradient-to-br from-violet-950/40 to-fuchsia-950/40 border-violet-800/40"
    : "bg-gradient-to-br from-violet-50 to-fuchsia-50 border-violet-200"

  const headingColor = darkMode ? "text-violet-200" : "text-violet-700"
  const bodyColor = darkMode ? "text-slate-200" : "text-slate-800"
  const errorColor = darkMode ? "text-rose-300" : "text-rose-600"

  const showTrigger = !expanded || (!explanation && !loading && !error)

  return (
    <div className="w-full">
      <div className="flex items-center justify-end">
        {showTrigger && (
          <button
            type="button"
            onClick={() => fetchExplanation(false)}
            disabled={loading}
            className={`${buttonBase} ${buttonIdle} ${loading ? buttonDisabled : ""}`}
            aria-label="AI 해설 요청"
          >
            {loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>AI 분석 중...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                <span>AI에게 물어보기</span>
              </>
            )}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="explain-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div
              className={`mt-2 rounded-lg border ${gradientBg} p-3 text-[12px] leading-relaxed`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className={`flex items-center gap-1 text-[11px] font-semibold ${headingColor}`}
                >
                  <Sparkles className="h-3 w-3" />
                  AI 해설
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fetchExplanation(true)}
                    disabled={loading}
                    className={`${buttonBase} ${buttonIdle} ${loading ? buttonDisabled : ""}`}
                    aria-label="AI 해설 다시 분석"
                  >
                    {loading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCw className="h-3 w-3" />
                    )}
                    <span>다시 분석</span>
                  </button>
                  {explanation && !loading && !error && onAutoAdjust && (
                    <button
                      type="button"
                      onClick={() => onAutoAdjust(warning, context)}
                      className={`${buttonBase} ${buttonIdle}`}
                      aria-label="AI 해설 기반 자동조절 적용"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>자동조절 적용</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className={`${buttonBase} ${buttonIdle}`}
                    aria-label="AI 해설 접기"
                  >
                    <ChevronUp className="h-3 w-3" />
                    <span>접기</span>
                  </button>
                </div>
              </div>

              {loading && !explanation && (
                <div
                  className={`flex items-center gap-2 ${bodyColor} opacity-80`}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>AI 분석 중...</span>
                </div>
              )}

              {error && !loading && (
                <div className={`text-[12px] ${errorColor}`}>
                  해설 요청 실패: {error}
                </div>
              )}

              {explanation && !error && (
                <div className={`${bodyColor}`}>
                  <Markdown className="text-[12px]">{explanation}</Markdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
