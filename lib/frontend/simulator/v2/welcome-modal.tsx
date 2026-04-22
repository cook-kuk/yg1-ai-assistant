// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Welcome Modal (최초 방문)
// - 첫 방문 시 자동 오픈 (localStorage "yg1-sim-v3-first-visit" 체크)
// - 3개 예시 프리셋(알루미늄 황삭 / SUS304 정삭 / 인코넬 슬롯) 카드로 선택
// - forceOpen / onClose / onPickExample props 지원
// - darkMode 완전 지원
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X, Sparkles, Keyboard, ArrowRight } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────
export interface ExamplePreset {
  id: string
  title: string
  subtitle: string
  icon: string
  color: "sky" | "emerald" | "rose" | string
  params: {
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
  badge?: string
}

export interface WelcomeModalProps {
  darkMode?: boolean
  onPickExample?: (preset: ExamplePreset) => void
  forceOpen?: boolean
  onClose?: () => void
}

// ── Constants ─────────────────────────────────────────────────────────
const FIRST_VISIT_KEY = "yg1-sim-v3-first-visit"

export const WELCOME_EXAMPLES: ExamplePreset[] = [
  {
    id: "al6061-rough",
    title: "알루미늄 황삭",
    subtitle: "Al6061 · 고속 · 가볍게",
    icon: "🔹",
    color: "sky",
    badge: "인기",
    params: {
      isoGroup: "N",
      subgroupKey: "aluminum-wrought",
      operation: "roughing",
      coating: "uncoated",
      Vc: 450,
      fz: 0.08,
      ap: 10,
      ae: 3,
      diameter: 10,
      fluteCount: 4,
      activeShape: "square",
    },
  },
  {
    id: "sus304-finish",
    title: "SUS304 정삭",
    subtitle: "오스테나이트 SUS · 저속 정밀",
    icon: "🟢",
    color: "emerald",
    params: {
      isoGroup: "M",
      subgroupKey: "austenitic-ss",
      operation: "finishing",
      coating: "altin",
      Vc: 110,
      fz: 0.04,
      ap: 0.3,
      ae: 2,
      diameter: 8,
      fluteCount: 4,
      activeShape: "square",
    },
  },
  {
    id: "inconel-slot",
    title: "인코넬 슬롯",
    subtitle: "S · Inconel 718 · 내열합금",
    icon: "🔴",
    color: "rose",
    badge: "고난이도",
    params: {
      isoGroup: "S",
      subgroupKey: "inconel",
      operation: "slotting",
      coating: "aicrn",
      Vc: 35,
      fz: 0.025,
      ap: 0.5,
      ae: 6,
      diameter: 6,
      fluteCount: 4,
      activeShape: "square",
    },
  },
]

// ── Color token mapping (Tailwind safelist-friendly) ──────────────────
interface ColorTokens {
  ring: string
  ringDark: string
  bg: string
  bgDark: string
  text: string
  textDark: string
  badge: string
  badgeDark: string
  border: string
  borderDark: string
}

const COLOR_MAP: Record<string, ColorTokens> = {
  sky: {
    ring: "hover:ring-sky-400",
    ringDark: "hover:ring-sky-500",
    bg: "bg-sky-50",
    bgDark: "bg-sky-950/40",
    text: "text-sky-700",
    textDark: "text-sky-300",
    badge: "bg-sky-100 text-sky-700",
    badgeDark: "bg-sky-900/50 text-sky-300",
    border: "border-sky-200",
    borderDark: "border-sky-800",
  },
  emerald: {
    ring: "hover:ring-emerald-400",
    ringDark: "hover:ring-emerald-500",
    bg: "bg-emerald-50",
    bgDark: "bg-emerald-950/40",
    text: "text-emerald-700",
    textDark: "text-emerald-300",
    badge: "bg-emerald-100 text-emerald-700",
    badgeDark: "bg-emerald-900/50 text-emerald-300",
    border: "border-emerald-200",
    borderDark: "border-emerald-800",
  },
  rose: {
    ring: "hover:ring-rose-400",
    ringDark: "hover:ring-rose-500",
    bg: "bg-rose-50",
    bgDark: "bg-rose-950/40",
    text: "text-rose-700",
    textDark: "text-rose-300",
    badge: "bg-rose-100 text-rose-700",
    badgeDark: "bg-rose-900/50 text-rose-300",
    border: "border-rose-200",
    borderDark: "border-rose-800",
  },
}

function resolveColor(color: string): ColorTokens {
  return COLOR_MAP[color] ?? COLOR_MAP.sky
}

// ── Component ─────────────────────────────────────────────────────────
export function WelcomeModal({
  darkMode = false,
  onPickExample,
  forceOpen,
  onClose,
}: WelcomeModalProps) {
  const [open, setOpen] = useState<boolean>(false)

  // 최초 방문 자동 오픈
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const shown = window.localStorage.getItem(FIRST_VISIT_KEY)
      if (!shown) {
        setOpen(true)
        window.localStorage.setItem(FIRST_VISIT_KEY, "shown")
      }
    } catch {
      // localStorage 접근 실패 시 자동 오픈하지 않음 (SSR/Private mode)
    }
  }, [])

  // forceOpen 제어 (수동)
  useEffect(() => {
    if (typeof forceOpen === "boolean") {
      setOpen(forceOpen)
    }
  }, [forceOpen])

  // ESC 키 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = useCallback(() => {
    setOpen(false)
    onClose?.()
  }, [onClose])

  const handlePick = useCallback(
    (preset: ExamplePreset) => {
      onPickExample?.(preset)
      setOpen(false)
      onClose?.()
    },
    [onPickExample, onClose],
  )

  const examples = useMemo(() => WELCOME_EXAMPLES, [])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="yg1-welcome-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      {/* backdrop */}
      <div
        className={`absolute inset-0 backdrop-blur-sm ${
          darkMode ? "bg-black/70" : "bg-slate-900/40"
        }`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* card */}
      <div
        className={`relative w-full max-w-[600px] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          darkMode
            ? "bg-slate-900 ring-1 ring-slate-700 text-slate-100"
            : "bg-white ring-1 ring-slate-200 text-slate-900"
        }`}
      >
        {/* 그라디언트 헤더 */}
        <div className="relative px-6 py-5 bg-gradient-to-r from-amber-400 via-rose-500 to-violet-600 text-white">
          <button
            type="button"
            onClick={handleClose}
            aria-label="환영 모달 닫기"
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <Sparkles className="w-6 h-6 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2
                id="yg1-welcome-title"
                className="text-lg md:text-xl font-bold leading-snug"
              >
                🎉 YG-1 ARIA v3 시뮬레이터에 오신 걸 환영합니다!
              </h2>
              <p className="mt-1 text-sm text-white/90">
                3분 안에 첫 가공조건 도출 — 아래 예시로 바로 시작
              </p>
            </div>
          </div>
        </div>

        {/* 본문: 예시 카드 3개 */}
        <div className="px-6 py-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
            {examples.map((preset) => {
              const c = resolveColor(preset.color)
              const ringCls = darkMode ? c.ringDark : c.ring
              const bgCls = darkMode ? c.bgDark : c.bg
              const textCls = darkMode ? c.textDark : c.text
              const badgeCls = darkMode ? c.badgeDark : c.badge
              const borderCls = darkMode ? c.borderDark : c.border

              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePick(preset)}
                  className={`group relative flex h-full min-w-0 flex-col text-left rounded-xl border p-4 transition-all duration-200 ring-0 hover:ring-2 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 ${borderCls} ${bgCls} ${ringCls} ${
                    darkMode ? "hover:bg-slate-800/80" : "hover:bg-white"
                  }`}
                >
                  {preset.badge && (
                    <span
                      className={`absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${badgeCls}`}
                    >
                      {preset.badge}
                    </span>
                  )}
                  <div className="text-3xl leading-none mb-2" aria-hidden="true">
                    {preset.icon}
                  </div>
                  <div className={`truncate text-sm font-bold ${textCls}`} title={preset.title}>
                    {preset.title}
                  </div>
                  <div
                    className={`text-xs mt-0.5 break-words ${
                      darkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    {preset.subtitle}
                  </div>

                  {/* Vc · fz 프리뷰 */}
                  <div
                    className={`mt-3 flex items-center gap-2 text-[11px] font-mono ${
                      darkMode ? "text-slate-300" : "text-slate-700"
                    }`}
                    aria-label={`추천 조건 Vc ${preset.params.Vc}, 이송 fz ${preset.params.fz}`}
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        darkMode ? "bg-slate-800" : "bg-white/70"
                      }`}
                    >
                      Vc {preset.params.Vc}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded ${
                        darkMode ? "bg-slate-800" : "bg-white/70"
                      }`}
                    >
                      fz {preset.params.fz}
                    </span>
                  </div>

                  <div
                    className={`mt-3 flex items-center gap-1 text-xs font-semibold ${textCls} group-hover:gap-1.5 transition-all`}
                  >
                    바로 시작
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 푸터 */}
        <div
          className={`px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs border-t ${
            darkMode
              ? "border-slate-700 bg-slate-900/60 text-slate-400"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true">💡</span>
            <span>
              나중에 <Keyboard className="inline w-3.5 h-3.5 mx-0.5 align-text-bottom" />{" "}
              버튼을 눌러 키보드 단축키 확인
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className={`underline-offset-2 hover:underline ${
              darkMode ? "text-slate-300 hover:text-white" : "text-slate-700 hover:text-slate-900"
            }`}
          >
            건너뛰기
          </button>
        </div>
      </div>
    </div>
  )
}

export default WelcomeModal
