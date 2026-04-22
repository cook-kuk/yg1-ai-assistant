// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Interactive Step-by-Step Tutorial
// Joyride-style tour: DOM selector 기반 spotlight + tooltip 조합.
// 타겟 DOM을 찾아 getBoundingClientRect 로 위치 계산 → rAF 로 갱신 (스크롤/리사이즈 대응).
// Esc/←/→/Enter 키보드 네비, focus trap, 완료 시 localStorage 기록.
"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, ArrowRight, X, Sparkles } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────
export interface InteractiveTutorialProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  darkMode?: boolean
  onComplete?: () => void
}

type Placement = "top" | "bottom" | "left" | "right" | "center"

interface TutorialStep {
  id: string
  targetSelector: string
  title: string
  description: string
  tips?: string[]
  placement: Placement
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

// ── Constants ─────────────────────────────────────────────────────────
const TUTORIAL_COMPLETED_KEY = "yg1-sim-v3-tutorial-completed"
const SPOTLIGHT_PADDING = 8
const TOOLTIP_MARGIN = 14
const TOOLTIP_WIDTH = 360 // must match max-w on card (px budget for placement calc)
const TOOLTIP_HEIGHT_ESTIMATE = 220

const STEPS: TutorialStep[] = [
  {
    id: "welcome",
    targetSelector: "body",
    title: "👋 환영합니다!",
    description: "YG-1 시뮬레이터 사용법을 5분 안에 알려드릴게요.",
    placement: "center",
  },
  {
    id: "mode",
    targetSelector: "[data-tour='mode-toggle']",
    title: "1️⃣ 모드 선택",
    description: "초보 모드로 시작하세요. 나중에 👔 전문가로 전환 가능합니다.",
    placement: "bottom",
  },
  {
    id: "examples",
    targetSelector: "[data-tour='examples']",
    title: "2️⃣ 예시로 빠르게 시작",
    description: "30개 예시 중 비슷한 가공을 클릭하세요. 자동으로 조건이 채워집니다.",
    tips: ["예시는 YG-1 공구별 권장값입니다", "클릭만 하면 바로 시뮬 시작"],
    placement: "top",
  },
  {
    id: "material",
    targetSelector: "[data-tour='material-card']",
    title: "3️⃣ 재질 선택",
    description:
      "가공할 소재를 고르세요. 철강/스테인리스/주철/비철/내열합금/고경도강.",
    placement: "right",
  },
  {
    id: "parameters",
    targetSelector: "[data-edu-section='parameters']",
    title: "4️⃣ 절삭 파라미터",
    description:
      "Vc(속도), fz(이송), ap/ae(절입) 4개를 조정하세요. 슬라이더를 움직이면 실시간 반영.",
    tips: [
      "Vc 너무 높으면 공구 수명 급감",
      "ae/D < 50%면 chip thinning 발생",
    ],
    placement: "right",
  },
  {
    id: "results",
    targetSelector: "[data-edu-section='recommendations']",
    title: "5️⃣ 결과 확인",
    description:
      "RPM, Vf, MRR, Pc 등 주요 수치가 자동 계산됩니다. 빨간 경고는 주의!",
    placement: "top",
  },
  {
    id: "visual",
    targetSelector: "[data-tour='visual-strip']",
    title: "6️⃣ 비주얼 시뮬레이션",
    description:
      "전문가 모드에서 10개 비주얼 toggle 가능 — 실시간 칩 애니메이션, 3D 엔드밀, 기술 도면 등.",
    placement: "top",
  },
  {
    id: "snapshot",
    targetSelector: "[data-tour='snapshot-group']",
    title: "7️⃣ 조건 비교",
    description:
      "💾 A/B/C/D 슬롯에 현재 조건을 저장하고 나란히 비교할 수 있어요.",
    tips: ["Ctrl+S로 빠르게 저장", "ΔMax로 최대 차이 확인"],
    placement: "bottom",
  },
  {
    id: "complete",
    targetSelector: "body",
    title: "🎉 완료!",
    description:
      "이제 시뮬레이터를 사용할 준비가 되었습니다. 언제든 ⌨ 버튼으로 단축키 도움말을 열 수 있어요.",
    placement: "center",
  },
]

// ── Helpers ───────────────────────────────────────────────────────────
function readRect(el: Element | null): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function progressGradient(ratio: number): string {
  // 0 → amber, 0.5 → rose, 1 → violet
  if (ratio < 0.5) {
    return "from-amber-400 via-amber-500 to-rose-500"
  }
  return "from-rose-500 via-fuchsia-500 to-violet-600"
}

/** placement 기반으로 tooltip 의 top/left (viewport px) 계산 */
function computeTooltipPosition(
  rect: Rect | null,
  placement: Placement,
  viewport: { w: number; h: number },
): { top: number; left: number; effective: Placement } {
  const vw = viewport.w
  const vh = viewport.h

  if (!rect || placement === "center") {
    return {
      top: Math.max(16, vh / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2),
      left: Math.max(16, vw / 2 - TOOLTIP_WIDTH / 2),
      effective: "center",
    }
  }

  const targetCenterX = rect.left + rect.width / 2
  const targetCenterY = rect.top + rect.height / 2
  let top = 0
  let left = 0
  let effective: Placement = placement

  switch (placement) {
    case "top":
      top = rect.top - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_MARGIN
      left = targetCenterX - TOOLTIP_WIDTH / 2
      if (top < 16) {
        // flip to bottom
        top = rect.top + rect.height + TOOLTIP_MARGIN
        effective = "bottom"
      }
      break
    case "bottom":
      top = rect.top + rect.height + TOOLTIP_MARGIN
      left = targetCenterX - TOOLTIP_WIDTH / 2
      if (top + TOOLTIP_HEIGHT_ESTIMATE > vh - 16) {
        top = rect.top - TOOLTIP_HEIGHT_ESTIMATE - TOOLTIP_MARGIN
        effective = "top"
      }
      break
    case "left":
      left = rect.left - TOOLTIP_WIDTH - TOOLTIP_MARGIN
      top = targetCenterY - TOOLTIP_HEIGHT_ESTIMATE / 2
      if (left < 16) {
        left = rect.left + rect.width + TOOLTIP_MARGIN
        effective = "right"
      }
      break
    case "right":
      left = rect.left + rect.width + TOOLTIP_MARGIN
      top = targetCenterY - TOOLTIP_HEIGHT_ESTIMATE / 2
      if (left + TOOLTIP_WIDTH > vw - 16) {
        left = rect.left - TOOLTIP_WIDTH - TOOLTIP_MARGIN
        effective = "left"
      }
      break
  }

  top = clamp(top, 16, Math.max(16, vh - TOOLTIP_HEIGHT_ESTIMATE - 16))
  left = clamp(left, 16, Math.max(16, vw - TOOLTIP_WIDTH - 16))
  return { top, left, effective }
}

// ── Component ─────────────────────────────────────────────────────────
export function InteractiveTutorial({
  open,
  onOpenChange,
  darkMode = false,
  onComplete,
}: InteractiveTutorialProps) {
  const [stepIndex, setStepIndex] = useState<number>(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState<{ w: number; h: number }>({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  })
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const total = STEPS.length
  const step = STEPS[stepIndex]
  const isCenter = step.placement === "center" || step.targetSelector === "body"

  // reset on open
  useEffect(() => {
    if (open) {
      setStepIndex(0)
      if (typeof document !== "undefined") {
        previousFocusRef.current = document.activeElement as HTMLElement | null
      }
    } else if (typeof document !== "undefined") {
      previousFocusRef.current?.focus?.()
    }
  }, [open])

  // viewport 추적
  useEffect(() => {
    if (!open || typeof window === "undefined") return
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open])

  // rAF 로 타겟 rect 추적 (스크롤/리사이즈/DOM 변화 대응)
  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") return
    let raf = 0
    let lastSig = ""
    let alive = true

    const tick = () => {
      if (!alive) return
      const el =
        isCenter
          ? null
          : document.querySelector<HTMLElement>(step.targetSelector)
      const next = isCenter ? null : readRect(el)
      const sig = next
        ? `${next.top.toFixed(1)}|${next.left.toFixed(1)}|${next.width.toFixed(
            1,
          )}|${next.height.toFixed(1)}`
        : "null"
      if (sig !== lastSig) {
        lastSig = sig
        setRect(next)
      }
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      alive = false
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [open, stepIndex, step.targetSelector, isCenter])

  // step 변경 시 타겟 scrollIntoView
  useEffect(() => {
    if (!open || isCenter || typeof document === "undefined") return
    const el = document.querySelector<HTMLElement>(step.targetSelector)
    if (!el) return
    const r = el.getBoundingClientRect()
    const outOfView =
      r.top < 0 ||
      r.bottom > (typeof window !== "undefined" ? window.innerHeight : 800) ||
      r.left < 0 ||
      r.right > (typeof window !== "undefined" ? window.innerWidth : 1280)
    if (outOfView) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
    }
  }, [open, stepIndex, step.targetSelector, isCenter])

  const markCompleted = useCallback(() => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(TUTORIAL_COMPLETED_KEY, "true")
    } catch {
      // ignore storage failures
    }
  }, [])

  const handleClose = useCallback(
    (finished: boolean) => {
      onOpenChange(false)
      if (finished) {
        markCompleted()
        onComplete?.()
      }
    },
    [onOpenChange, markCompleted, onComplete],
  )

  const handleNext = useCallback(() => {
    setStepIndex((idx) => {
      if (idx >= total - 1) {
        handleClose(true)
        return idx
      }
      return idx + 1
    })
  }, [total, handleClose])

  const handlePrev = useCallback(() => {
    setStepIndex((idx) => Math.max(0, idx - 1))
  }, [])

  const handleSkip = useCallback(() => {
    handleClose(false)
  }, [handleClose])

  // 키보드 핸들러
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        handleSkip()
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault()
        handleNext()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        handlePrev()
      } else if (e.key === "Tab") {
        // focus trap: keep focus inside tooltip
        const host = tooltipRef.current
        if (!host) return
        const focusables = host.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, handleNext, handlePrev, handleSkip])

  // 오픈 직후 tooltip 포커스
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      tooltipRef.current
        ?.querySelector<HTMLButtonElement>("button[data-tutorial-primary]")
        ?.focus()
    }, 50)
    return () => window.clearTimeout(t)
  }, [open, stepIndex])

  const tooltipPos = useMemo(
    () => computeTooltipPosition(rect, step.placement, viewport),
    [rect, step.placement, viewport],
  )

  const progressRatio = stepIndex / Math.max(1, total - 1)
  const headerGradient = progressGradient(progressRatio)

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby="yg1-tutorial-title"
      className="fixed inset-0 z-[110] pointer-events-auto"
    >
      {/* Overlay + spotlight hole via box-shadow trick.
          The inner rect gets a giant box-shadow that fills the viewport
          with a semi-transparent dark color, leaving the inner box clear. */}
      {isCenter || !rect ? (
        <div
          className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]"
          onClick={handleSkip}
          aria-hidden="true"
        />
      ) : (
        <>
          {/* click-catcher (dark bg) */}
          <div
            className="absolute inset-0 bg-transparent"
            onClick={handleSkip}
            aria-hidden="true"
          />
          {/* spotlight ring — clears a rectangle by using box-shadow outset */}
          <motion.div
            key={`spot-${step.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            aria-hidden="true"
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: rect.top - SPOTLIGHT_PADDING,
              left: rect.left - SPOTLIGHT_PADDING,
              width: rect.width + SPOTLIGHT_PADDING * 2,
              height: rect.height + SPOTLIGHT_PADDING * 2,
              boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.62)",
            }}
          />
          {/* pulse border on target */}
          <motion.div
            key={`pulse-${step.id}`}
            aria-hidden="true"
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: rect.top - SPOTLIGHT_PADDING,
              left: rect.left - SPOTLIGHT_PADDING,
              width: rect.width + SPOTLIGHT_PADDING * 2,
              height: rect.height + SPOTLIGHT_PADDING * 2,
              border: "3px dashed rgb(251 191 36)", // amber-400
            }}
            animate={{
              opacity: [0.55, 1, 0.55],
              scale: [1, 1.015, 1],
            }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </>
      )}

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={tooltipRef}
          role="document"
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
            width: TOOLTIP_WIDTH,
          }}
          className={`absolute max-w-sm rounded-xl shadow-2xl overflow-hidden ${
            darkMode
              ? "bg-slate-900 ring-1 ring-slate-700 text-slate-100"
              : "bg-white ring-1 ring-slate-200 text-slate-900"
          }`}
        >
          {/* 그라디언트 헤더 */}
          <div
            className={`relative px-4 py-3 bg-gradient-to-r ${headerGradient} text-white`}
          >
            <div className="flex items-start gap-2 pr-16">
              <Sparkles
                className="w-4 h-4 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <h3
                id="yg1-tutorial-title"
                className="text-sm md:text-base font-bold leading-snug"
              >
                {step.title}
              </h3>
            </div>
            {/* 진행 표시 */}
            <div className="absolute top-2 right-9 text-[11px] font-mono font-semibold tabular-nums bg-white/15 px-1.5 py-0.5 rounded">
              {stepIndex + 1} / {total}
            </div>
            {/* 닫기 */}
            <button
              type="button"
              onClick={handleSkip}
              aria-label="튜토리얼 닫기"
              className="absolute top-2 right-2 p-1 rounded-full bg-white/15 hover:bg-white/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            {/* progress bar */}
            <div className="mt-2.5 h-1 w-full rounded-full bg-white/20 overflow-hidden">
              <motion.div
                className="h-full bg-white/90"
                initial={false}
                animate={{ width: `${((stepIndex + 1) / total) * 100}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
          </div>

          {/* 본문 */}
          <div className="px-5 py-4 space-y-3">
            <p
              className={`text-sm leading-relaxed ${
                darkMode ? "text-slate-200" : "text-slate-700"
              }`}
            >
              {step.description}
            </p>

            {step.tips && step.tips.length > 0 && (
              <ul
                className={`rounded-lg px-3 py-2 space-y-1 text-xs ${
                  darkMode
                    ? "bg-violet-950/40 text-violet-200 ring-1 ring-violet-900/60"
                    : "bg-violet-50 text-violet-800 ring-1 ring-violet-100"
                }`}
              >
                {step.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span
                      aria-hidden="true"
                      className={`mt-1 inline-block w-1 h-1 rounded-full shrink-0 ${
                        darkMode ? "bg-violet-300" : "bg-violet-500"
                      }`}
                    />
                    <span className="leading-snug">{tip}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 푸터 버튼 */}
          <div
            className={`px-4 py-3 flex items-center justify-between gap-2 border-t ${
              darkMode
                ? "border-slate-700 bg-slate-900/70"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <button
              type="button"
              onClick={handleSkip}
              className={`text-xs underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded px-1 py-0.5 ${
                darkMode
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              건너뛰기
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={stepIndex === 0}
                className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40 disabled:cursor-not-allowed ${
                  darkMode
                    ? "bg-slate-800 hover:bg-slate-700 text-slate-200"
                    : "bg-white ring-1 ring-slate-200 hover:bg-slate-100 text-slate-700"
                }`}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                이전
              </button>
              <button
                type="button"
                onClick={handleNext}
                data-tutorial-primary
                className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-gradient-to-r from-amber-500 via-rose-500 to-violet-600 hover:brightness-110 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                {stepIndex === total - 1 ? "완료" : "다음"}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export default InteractiveTutorial
