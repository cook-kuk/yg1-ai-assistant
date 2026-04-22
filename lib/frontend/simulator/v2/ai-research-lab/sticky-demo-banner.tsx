"use client"

import { useState } from "react"
import { AlertTriangle, X, Sparkles } from "lucide-react"

interface StickyDemoBannerProps {
  currentPhase?: string
  nextPhase?: string
  targetPhase?: string
}

export function StickyDemoBanner({
  currentPhase = "Phase 0 · Demo Shell",
  nextPhase = "Phase 1 · XGBoost PoC (2026 Q2)",
  targetPhase = "Phase 3 · Full AI Platform (2028 Q4)",
}: StickyDemoBannerProps) {
  const [minimized, setMinimized] = useState(false)

  return (
    <div
      data-tour="demo-banner"
      className="sticky top-0 z-40 bg-gradient-to-r from-amber-500/10 via-amber-500/20 to-amber-500/10 backdrop-blur-md border-b-2 border-amber-500/40"
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="w-full py-1.5 text-xs font-mono text-amber-700 dark:text-amber-400 flex items-center justify-center gap-2 hover:bg-amber-500/10"
        >
          <AlertTriangle className="w-3 h-3" />
          DEMO LABORATORY · 클릭하여 펼치기
        </button>
      ) : (
        <div className="max-w-[1480px] mx-auto px-6 py-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="shrink-0 p-2 bg-amber-500/20 rounded">
              <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-amber-900 dark:text-amber-200 text-sm tracking-wide">
                🧪 AI RESEARCH LABORATORY — DEMO 모드
              </div>
              <div className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5">
                표시되는 모든 수치는 <strong>시뮬레이션된 예시</strong>입니다. 실제 ML 추론이 아닙니다.
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-mono">
                <span className="text-amber-700 dark:text-amber-400">
                  현재: <strong>{currentPhase}</strong>
                </span>
                <span className="text-amber-600 dark:text-amber-500">다음: {nextPhase}</span>
                <span className="text-amber-500 dark:text-amber-600">최종 목표: {targetPhase}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="shrink-0 p-1 hover:bg-amber-500/20 rounded"
            aria-label="접기"
          >
            <X className="w-4 h-4 text-amber-700 dark:text-amber-400" />
          </button>
        </div>
      )}
    </div>
  )
}
