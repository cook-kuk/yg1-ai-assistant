"use client"

/**
 * AI 자연어 검색바 (v3)
 *
 * - 사용자 한국어 자연어 쿼리 → POST /api/simulator/nl-query
 * - Claude Haiku 응답을 프리뷰 카드로 표시
 * - "적용" 클릭 시 onApplyPreset 콜백으로 시뮬레이터에 주입
 *
 * cutting-simulator-v2.tsx는 건드리지 않음 (상위에서 컴포지션)
 */

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Sparkles, Loader2, X } from "lucide-react"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface AiPreset {
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  activeShape: string
}

interface AiPresetWithReasoning extends AiPreset {
  reasoning: string
}

export interface AiQueryBarProps {
  onApplyPreset: (preset: AiPreset) => void
  darkMode?: boolean
  /** 엔드포인트 override (기본 /api/simulator/nl-query) */
  endpoint?: string
  className?: string
}

type Phase = "idle" | "loading" | "preview" | "error"

// ─────────────────────────────────────────────────────────────
// Example chips
// ─────────────────────────────────────────────────────────────

const EXAMPLE_CHIPS: readonly string[] = [
  "알루미늄 빠르게",
  "스테인리스 마감",
  "인코넬 안전",
  "고경도강 긴 수명",
]

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function AiQueryBar({
  onApplyPreset,
  darkMode = false,
  endpoint = "/api/simulator/nl-query",
  className = "",
}: AiQueryBarProps) {
  const [query, setQuery] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [preset, setPreset] = useState<AiPresetWithReasoning | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Style tokens (darkMode 분기)
  const containerBg = darkMode
    ? "bg-gradient-to-br from-slate-900 via-slate-900 to-fuchsia-950/40"
    : "bg-gradient-to-br from-violet-50 via-fuchsia-50 to-pink-50"
  const borderTone = darkMode ? "border-slate-700" : "border-violet-200/70"
  const textPrimary = darkMode ? "text-slate-100" : "text-slate-900"
  const textMuted = darkMode ? "text-slate-400" : "text-slate-500"
  const inputBg = darkMode
    ? "bg-slate-900/80 border-slate-700 text-slate-100 placeholder-slate-500"
    : "bg-white/90 border-violet-200 text-slate-900 placeholder-slate-400"
  const chipBg = darkMode
    ? "bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-700"
    : "bg-white/80 text-violet-700 border-violet-200 hover:bg-violet-100"
  const cardBg = darkMode
    ? "bg-slate-900/90 border-slate-700"
    : "bg-white/95 border-violet-200"

  // Toast auto-dismiss
  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3200)
  }

  const submit = async (text?: string) => {
    const q = (text ?? query).trim()
    if (!q) {
      showToast("쿼리를 입력하세요")
      return
    }
    setPhase("loading")
    setErrorMsg(null)
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
      const json = (await res.json()) as
        | AiPresetWithReasoning
        | { error: string; raw?: string }
      if (!res.ok || "error" in json) {
        const err =
          "error" in json
            ? json.error
            : `HTTP ${res.status}`
        setErrorMsg(err)
        setPhase("error")
        showToast(`AI 분석 실패: ${err}`)
        return
      }
      setPreset(json)
      setPhase("preview")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setPhase("error")
      showToast(`네트워크 오류: ${msg}`)
    }
  }

  const applyPreset = () => {
    if (!preset) return
    const { reasoning: _reasoning, ...rest } = preset
    void _reasoning
    onApplyPreset(rest)
    setQuery("")
    setPreset(null)
    setPhase("idle")
    showToast("프리셋 적용됨")
  }

  const retry = () => {
    setPreset(null)
    setErrorMsg(null)
    setPhase("idle")
  }

  const onChipClick = (chip: string) => {
    setQuery(chip)
    void submit(chip)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && phase !== "loading") {
      e.preventDefault()
      void submit()
    }
  }

  const isLoading = phase === "loading"

  return (
    <div
      className={`relative rounded-2xl border ${borderTone} ${containerBg} p-4 shadow-sm ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`rounded-lg p-1.5 ${
            darkMode
              ? "bg-fuchsia-900/50 text-fuchsia-300"
              : "bg-fuchsia-100 text-fuchsia-600"
          }`}
        >
          <Sparkles className="w-4 h-4" />
        </div>
        <div className={`text-sm font-semibold ${textPrimary}`}>
          AI 자연어 검색
        </div>
        <div
          className={`ml-auto text-[11px] ${textMuted} flex items-center gap-1`}
        >
          <span>Claude Haiku</span>
        </div>
      </div>

      {/* Input row */}
      <div
        className={`flex items-stretch gap-2 rounded-xl border ${inputBg} transition-all`}
      >
        <div className="flex items-center pl-3">
          {isLoading ? (
            <Loader2
              className={`w-4 h-4 animate-spin ${
                darkMode ? "text-fuchsia-400" : "text-fuchsia-500"
              }`}
            />
          ) : (
            <Sparkles
              className={`w-4 h-4 ${
                darkMode ? "text-violet-400" : "text-violet-500"
              }`}
            />
          )}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isLoading}
          placeholder="예: '알루미늄을 빠르게 깎고 싶어', 'SUS304 마감 가공', '인코넬 안전하게'"
          className="flex-1 bg-transparent px-2 py-3 text-sm outline-none disabled:opacity-60"
        />
        {query && !isLoading && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className={`px-2 ${textMuted} hover:opacity-70`}
            aria-label="지우기"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isLoading || !query.trim()}
          className={`px-4 my-1 mr-1 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            darkMode
              ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500"
              : "bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
          }`}
        >
          {isLoading ? "분석 중..." : "▶ 물어보기"}
        </button>
      </div>

      {/* Loading inline text */}
      {isLoading && (
        <div
          className={`mt-2 text-xs flex items-center gap-1.5 ${
            darkMode ? "text-fuchsia-300" : "text-fuchsia-600"
          }`}
        >
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>AI 분석 중...</span>
        </div>
      )}

      {/* Example chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {EXAMPLE_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChipClick(chip)}
            disabled={isLoading}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${chipBg}`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Footer caption */}
      <div className={`mt-2 text-[11px] ${textMuted}`}>
        🧠 Claude Haiku 기반 · 5초 내 응답
      </div>

      {/* Preview card */}
      <AnimatePresence>
        {phase === "preview" && preset && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div
              className={`mt-3 rounded-xl border ${cardBg} p-3 shadow-sm`}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`text-xs font-semibold ${
                    darkMode ? "text-fuchsia-300" : "text-fuchsia-600"
                  } flex items-center gap-1`}
                >
                  <Sparkles className="w-3 h-3" />
                  AI 제안 프리셋
                </div>
                <div className={`text-[10px] ${textMuted}`}>
                  {preset.isoGroup} · {preset.subgroupKey}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <PreviewStat
                  label="Vc"
                  value={`${preset.Vc}`}
                  unit="m/min"
                  darkMode={darkMode}
                />
                <PreviewStat
                  label="fz"
                  value={`${preset.fz}`}
                  unit="mm/tooth"
                  darkMode={darkMode}
                />
                <PreviewStat
                  label="ap"
                  value={`${preset.ap}`}
                  unit="mm"
                  darkMode={darkMode}
                />
                <PreviewStat
                  label="ae"
                  value={`${preset.ae}`}
                  unit="mm"
                  darkMode={darkMode}
                />
              </div>

              <div
                className={`mt-2 grid grid-cols-3 gap-2 text-[10px] ${textMuted}`}
              >
                <div>
                  Ø{preset.diameter}mm · Z{preset.fluteCount}
                </div>
                <div>{preset.operation}</div>
                <div>{preset.coating}</div>
              </div>

              {preset.reasoning && (
                <div
                  className={`mt-2 text-xs leading-relaxed ${
                    darkMode ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  {preset.reasoning}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={applyPreset}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all ${
                    darkMode
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500"
                      : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
                  }`}
                >
                  적용
                </button>
                <button
                  type="button"
                  onClick={retry}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    darkMode
                      ? "border-slate-700 text-slate-300 hover:bg-slate-800"
                      : "border-violet-200 text-violet-700 hover:bg-violet-50"
                  }`}
                >
                  다시 물어보기
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error inline banner */}
      {phase === "error" && errorMsg && (
        <div
          className={`mt-3 rounded-lg border text-xs p-2 ${
            darkMode
              ? "bg-red-950/40 border-red-900 text-red-300"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span>⚠ {errorMsg}</span>
            <button
              type="button"
              onClick={retry}
              className="underline hover:opacity-70"
            >
              다시 시도
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`absolute bottom-2 right-2 rounded-md px-3 py-1.5 text-xs shadow-lg ${
              darkMode
                ? "bg-slate-800 text-slate-100 border border-slate-700"
                : "bg-slate-900 text-white"
            }`}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function PreviewStat({
  label,
  value,
  unit,
  darkMode,
}: {
  label: string
  value: string
  unit: string
  darkMode: boolean
}) {
  return (
    <div
      className={`rounded-lg px-2 py-1.5 ${
        darkMode
          ? "bg-slate-800/70 border border-slate-700"
          : "bg-violet-50/80 border border-violet-100"
      }`}
    >
      <div
        className={`text-[10px] uppercase tracking-wide ${
          darkMode ? "text-slate-400" : "text-slate-500"
        }`}
      >
        {label}
      </div>
      <div
        className={`text-sm font-bold ${
          darkMode ? "text-fuchsia-200" : "text-fuchsia-700"
        }`}
      >
        {value}
      </div>
      <div
        className={`text-[9px] ${
          darkMode ? "text-slate-500" : "text-slate-400"
        }`}
      >
        {unit}
      </div>
    </div>
  )
}
