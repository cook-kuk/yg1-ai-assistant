// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — First Visit Prompt
// - 최초 방문자에게 투어 참여 여부를 묻는 환영 모달
// - localStorage("aria-tour-completed") 없을 때만 1500ms 뒤 표시
// - simulator_v2 경로 (/* …simulator*v2* 매칭) 에서만 표시
// - "나중에" 선택 시 "skipped" 로 기록 → 세션 내 재프롬프트 차단
"use client"

import { useCallback, useEffect, useState } from "react"
import { PartyPopper, X, GraduationCap, Clock } from "lucide-react"

import { useTour } from "./tour-provider"

const LS_KEY = "aria-tour-completed"
const SHOW_DELAY_MS = 1500

function isSimulatorV2Route(pathname: string): boolean {
  if (!pathname) return false
  // simulator_v2 / simulator-v2 / simulatorV2 / /simulator/v2 모두 매칭
  return /simulator[\-_/]?v2/i.test(pathname)
}

export function FirstVisitPrompt() {
  const { startTour } = useTour()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(LS_KEY)
    } catch {
      stored = null
    }
    if (stored) return

    const pathname = window.location?.pathname ?? ""
    if (!isSimulatorV2Route(pathname)) return

    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])

  const markSkipped = useCallback(() => {
    try {
      window.localStorage.setItem(LS_KEY, "skipped")
    } catch {
      // ignore
    }
  }, [])

  const handleStart = useCallback(() => {
    setOpen(false)
    startTour("first-visit")
  }, [startTour])

  const handleLater = useCallback(() => {
    markSkipped()
    setOpen(false)
  }, [markSkipped])

  const handleDismiss = useCallback(() => {
    markSkipped()
    setOpen(false)
  }, [markSkipped])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="aria-first-visit-title"
    >
      <div className="relative w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-6">
        {/* close X */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="닫기"
          className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X size={18} />
        </button>

        {/* headline */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-teal-500/10 text-teal-500">
            <PartyPopper size={22} />
          </div>
          <h2
            id="aria-first-visit-title"
            className="text-xl font-bold text-slate-900 dark:text-white"
          >
            <span className="mr-1" aria-hidden="true">🎉</span>
            ARIA에 처음 오셨네요
          </h2>
        </div>

        {/* description */}
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 mb-6">
          약 <strong className="text-teal-600 dark:text-teal-400">3분</strong> 투어로
          주요 화면과 AI 분석 기능을 빠르게 훑어볼 수 있어요.
          <br />
          언제든 <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs font-mono">ESC</kbd> 키로 종료할 수 있습니다.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleStart}
            className="inline-flex items-center justify-center gap-2 flex-1 px-4 py-2.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-semibold shadow-sm transition-colors"
          >
            <GraduationCap size={16} />
            <span aria-hidden="true">🎓</span>
            투어 시작
            <span className="inline-flex items-center gap-1 text-xs opacity-80">
              <Clock size={12} />
              3분
            </span>
          </button>
          <button
            type="button"
            onClick={handleLater}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition-colors"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  )
}

export default FirstVisitPrompt
