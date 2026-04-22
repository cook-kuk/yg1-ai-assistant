"use client"

/**
 * FloatingWarnings - v3 Simulator 실시간 플로팅 경고 HUD
 *
 * 가공 파라미터 변경 시 발생하는 SimWarning 리스트를 우하단에 항상 보이게 표시.
 * 스크롤해도 고정. 경고 수가 늘어나면 pulse/shake 애니메이션. 클릭 시 상세 확장.
 *
 * Usage:
 *   <FloatingWarnings
 *     warnings={simWarnings}
 *     darkMode={darkMode}
 *     onDetailClick={() => scrollToDetailSection()}
 *   />
 */

import { useEffect, useMemo, useRef, useState } from "react"
import type { SimWarning } from "@/lib/frontend/simulator/cutting-calculator"

const PULSE_DURATION_MS = 500
const SHAKE_DURATION_MS = 500

export interface FloatingWarningsProps {
  warnings: SimWarning[]
  darkMode?: boolean
  onDetailClick?: () => void
}

type Level = SimWarning["level"]

const LEVEL_ORDER: Level[] = ["error", "warn", "info"]

const LEVEL_ICON: Record<Level, string> = {
  error: "❌",
  warn: "⚠",
  info: "ℹ",
}

const LEVEL_LABEL: Record<Level, string> = {
  error: "오류",
  warn: "경고",
  info: "정보",
}

function countByLevel(warnings: SimWarning[]): Record<Level, number> {
  const counts: Record<Level, number> = { error: 0, warn: 0, info: 0 }
  for (const w of warnings) counts[w.level] += 1
  return counts
}

function groupByLevel(warnings: SimWarning[]): Record<Level, SimWarning[]> {
  const groups: Record<Level, SimWarning[]> = { error: [], warn: [], info: [] }
  for (const w of warnings) groups[w.level].push(w)
  return groups
}

export default function FloatingWarnings({
  warnings,
  darkMode = false,
  onDetailClick,
}: FloatingWarningsProps) {
  const [expanded, setExpanded] = useState(false)
  const [pulse, setPulse] = useState(false)
  const [shake, setShake] = useState(false)

  const prevLenRef = useRef<number>(warnings.length)
  const prevErrorCountRef = useRef<number>(0)
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const counts = useMemo(() => countByLevel(warnings), [warnings])
  const groups = useMemo(() => groupByLevel(warnings), [warnings])
  const total = warnings.length
  const hasError = counts.error > 0
  const hasWarn = counts.warn > 0

  // 새 경고 추가 감지 → pulse / shake
  useEffect(() => {
    const prevLen = prevLenRef.current
    const prevErrors = prevErrorCountRef.current

    if (warnings.length > prevLen) {
      setPulse(true)
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = setTimeout(() => setPulse(false), PULSE_DURATION_MS)
    }

    if (counts.error > prevErrors) {
      setShake(true)
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
      shakeTimerRef.current = setTimeout(() => setShake(false), SHAKE_DURATION_MS)
    }

    prevLenRef.current = warnings.length
    prevErrorCountRef.current = counts.error
  }, [warnings.length, counts.error])

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
    }
  }, [])

  // 빈 상태: "✓ 안전" pill
  if (total === 0) {
    const safeBg = darkMode
      ? "bg-emerald-900/70 text-emerald-100 border-emerald-700"
      : "bg-emerald-50 text-emerald-700 border-emerald-300"
    return (
      <div
        className="fixed bottom-5 right-5 z-[55]"
        role="status"
        aria-live="polite"
      >
        <div
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md tabular-nums ${safeBg}`}
        >
          <span aria-hidden="true">✓</span>
          <span>안전</span>
        </div>
      </div>
    )
  }

  // 축소 pill 색상 결정 (error > warn > info 우선순위)
  const pillColor = hasError
    ? darkMode
      ? "bg-rose-600 text-white border-rose-400 hover:bg-rose-500"
      : "bg-rose-500 text-white border-rose-600 hover:bg-rose-600"
    : hasWarn
      ? darkMode
        ? "bg-amber-500 text-slate-900 border-amber-400 hover:bg-amber-400"
        : "bg-amber-400 text-amber-950 border-amber-500 hover:bg-amber-500"
      : darkMode
        ? "bg-slate-700 text-slate-100 border-slate-600 hover:bg-slate-600"
        : "bg-slate-200 text-slate-800 border-slate-300 hover:bg-slate-300"

  const badgeLabel = hasError ? "오류" : hasWarn ? "경고" : "정보"
  const badgeBg = hasError
    ? "bg-rose-600 text-white"
    : hasWarn
      ? "bg-amber-500 text-amber-950"
      : "bg-slate-500 text-white"

  // 확장 카드 색상 토큰
  const cardBg = darkMode
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-200 text-slate-900"
  const headerBorder = darkMode ? "border-slate-700" : "border-slate-200"
  const subText = darkMode ? "text-slate-400" : "text-slate-500"
  const rowHover = darkMode ? "hover:bg-slate-800/70" : "hover:bg-slate-50"
  const errorRow = darkMode ? "text-rose-300" : "text-rose-700"
  const warnRow = darkMode ? "text-amber-300" : "text-amber-800"
  const infoRow = darkMode ? "text-sky-300" : "text-sky-700"
  const detailBtn = darkMode
    ? "bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700"
    : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"

  const animClass = [
    pulse ? "animate-pulse" : "",
    shake ? "fw-shake" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      className="fixed bottom-5 right-5 z-[55] flex flex-col items-end"
      role="status"
      aria-live="polite"
    >
      {/* keyframes for shake (scoped via inline style tag) */}
      <style>{`
        @keyframes fw-shake-kf {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          60% { transform: translateX(-2px); }
          80% { transform: translateX(2px); }
        }
        .fw-shake { animation: fw-shake-kf 0.5s ease-in-out; }
      `}</style>

      {expanded ? (
        <div
          className={`w-[340px] max-w-[calc(100vw-2.5rem)] max-h-[60vh] overflow-hidden rounded-xl border shadow-2xl flex flex-col ${cardBg} ${animClass}`}
        >
          {/* 헤더 */}
          <div
            className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${headerBorder}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold whitespace-nowrap">
                <span aria-hidden="true">⚠</span> 실시간 검증
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badgeBg}`}
              >
                {badgeLabel}
              </span>
              <span className={`text-xs tabular-nums ${subText}`}>
                Σ {total}건
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="경고 패널 닫기"
              className={`rounded-md px-1.5 py-0.5 text-sm leading-none ${subText} hover:opacity-80`}
            >
              ✕
            </button>
          </div>

          {/* 경고 목록 (level별 그룹핑) */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
            {LEVEL_ORDER.map((lvl) => {
              const items = groups[lvl]
              if (items.length === 0) return null
              const rowColor =
                lvl === "error" ? errorRow : lvl === "warn" ? warnRow : infoRow
              return (
                <div key={lvl}>
                  <div
                    className={`px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${subText}`}
                  >
                    {LEVEL_LABEL[lvl]} ({items.length})
                  </div>
                  <ul className="space-y-0.5">
                    {items.map((w, idx) => (
                      <li
                        key={`${lvl}-${idx}`}
                        className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${rowHover} ${rowColor}`}
                      >
                        <span aria-hidden="true" className="shrink-0 pt-0.5">
                          {LEVEL_ICON[lvl]}
                        </span>
                        <span
                          className="min-w-0 line-clamp-2 break-words"
                          title={w.message}
                        >
                          {w.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          {/* 하단 "자세히 보기" */}
          {onDetailClick && (
            <div className={`border-t px-3 py-2 ${headerBorder}`}>
              <button
                type="button"
                onClick={() => {
                  onDetailClick()
                }}
                className={`w-full rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${detailBtn}`}
              >
                자세히 보기 →
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`검증 경고 ${total}건: 오류 ${counts.error}, 경고 ${counts.warn}, 정보 ${counts.info}`}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg tabular-nums transition-colors ${pillColor} ${animClass}`}
        >
          <span aria-hidden="true">⚠</span>
          <span>
            {counts.error} · {counts.warn} · {counts.info}
          </span>
        </button>
      )}
    </div>
  )
}
