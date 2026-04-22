// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — Tour Tooltip
// - step 컨텐츠 + 진행률 + 네비게이션 버튼
// - placement 가 있으면 target 의 bounding rect 에 맞춰 anchor (simple anchor)
// - 그렇지 않거나 target 미존재 시 중앙 하단 fallback
// - z-index [70] (spotlight 위)
"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import ReactMarkdown from "react-markdown"

import type { TourStep } from "./tour-scenarios"

export interface TourTooltipProps {
  step: TourStep
  index: number
  total: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

const TOOLTIP_WIDTH = 360
const TOOLTIP_MARGIN = 16

interface AnchorPos {
  top?: number
  left?: number
  right?: number
  bottom?: number
  transform?: string
}

function computeAnchor(step: TourStep): AnchorPos {
  if (typeof document === "undefined") {
    return { left: 0, right: 0, bottom: 32, transform: "none" }
  }
  const placement = step.placement ?? "bottom"
  // center 는 즉시 화면 정중앙
  if (placement === "center") {
    return {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      transform: "translate(0,0)",
    }
  }
  let el: HTMLElement | null = null
  try {
    el = (step.target.startsWith("#")
      ? document.getElementById(step.target.slice(1))
      : document.querySelector(step.target)) as HTMLElement | null
  } catch {
    el = null
  }
  if (!el) {
    // fallback: 중앙 하단
    return {
      left: Math.max(16, (window.innerWidth - TOOLTIP_WIDTH) / 2),
      bottom: 32,
    }
  }
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  switch (placement) {
    case "top": {
      const top = Math.max(16, r.top - TOOLTIP_MARGIN - 220)
      const left = Math.min(
        Math.max(16, r.left + r.width / 2 - TOOLTIP_WIDTH / 2),
        vw - TOOLTIP_WIDTH - 16,
      )
      return { top, left }
    }
    case "bottom": {
      const top = Math.min(vh - 240, r.bottom + TOOLTIP_MARGIN)
      const left = Math.min(
        Math.max(16, r.left + r.width / 2 - TOOLTIP_WIDTH / 2),
        vw - TOOLTIP_WIDTH - 16,
      )
      return { top, left }
    }
    case "left": {
      const left = Math.max(16, r.left - TOOLTIP_MARGIN - TOOLTIP_WIDTH)
      const top = Math.min(
        Math.max(16, r.top + r.height / 2 - 110),
        vh - 240,
      )
      return { top, left }
    }
    case "right": {
      const left = Math.min(vw - TOOLTIP_WIDTH - 16, r.right + TOOLTIP_MARGIN)
      const top = Math.min(
        Math.max(16, r.top + r.height / 2 - 110),
        vh - 240,
      )
      return { top, left }
    }
    default:
      return {
        left: Math.max(16, (vw - TOOLTIP_WIDTH) / 2),
        bottom: 32,
      }
  }
}

export function TourTooltip({
  step,
  index,
  total,
  onNext,
  onPrev,
  onClose,
}: TourTooltipProps) {
  const [pos, setPos] = useState<AnchorPos>({ left: 16, bottom: 32 })

  useEffect(() => {
    const update = () => setPos(computeAnchor(step))
    // 측정은 다음 프레임 (target scrollIntoView 안정화 후)
    const t = window.setTimeout(update, 320)
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [step])

  const progressPct = useMemo(() => {
    if (total <= 0) return 0
    return Math.round(((index + 1) / total) * 100)
  }, [index, total])

  const isCenter = step.placement === "center"
  const isLast = index >= total - 1
  const isFirst = index <= 0

  const containerStyle: React.CSSProperties = isCenter
    ? {
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        pointerEvents: "none",
      }
    : {
        position: "fixed",
        zIndex: 70,
        width: TOOLTIP_WIDTH,
        top: pos.top,
        left: pos.left,
        right: pos.right,
        bottom: pos.bottom,
        transform: pos.transform,
        pointerEvents: "none",
      }

  return (
    <div style={containerStyle} role="dialog" aria-modal="false">
      <div
        className="bg-white dark:bg-slate-900 border-2 border-teal-500 rounded-xl shadow-2xl p-5 text-slate-800 dark:text-slate-100"
        style={{
          pointerEvents: "auto",
          width: TOOLTIP_WIDTH,
          maxWidth: "calc(100vw - 32px)",
        }}
      >
        {/* header: title + close */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-base font-semibold leading-snug">
            {step.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="투어 닫기"
            className="p-1 -m-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* content (markdown) */}
        <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 space-y-2 mb-4 [&_p]:my-0 [&_strong]:text-slate-900 dark:[&_strong]:text-white [&_code]:text-teal-600 dark:[&_code]:text-teal-400 [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_em]:text-slate-500 dark:[&_em]:text-slate-400">
          <ReactMarkdown>{step.content}</ReactMarkdown>
        </div>

        {/* progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
              {index + 1} / {total}
            </span>
            <span className="text-xs text-teal-600 dark:text-teal-400 font-medium">
              {progressPct}%
            </span>
          </div>
          <div className="h-1 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* buttons */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onPrev}
            disabled={isFirst}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
            이전
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            건너뛰기
          </button>

          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium bg-teal-500 hover:bg-teal-600 text-white shadow-sm transition-colors"
          >
            {isLast ? "완료" : "다음"}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default TourTooltip
