"use client"

/**
 * SimulatorTooltip - 경량 hover 툴팁 컴포넌트 (v3 Simulator용)
 *
 * 기존 EduLabel과 달리 educationMode와 무관하게 항상 hover로 동작.
 * 데이터값/약어 설명을 교육 모드 OFF일 때도 표시하는 간단한 설명 버블.
 *
 * Usage:
 *   <SimulatorTooltip content="권장 절삭속도. Sandvik 카탈로그 기준">
 *     <span>Vc (m/min)</span>
 *   </SimulatorTooltip>
 *
 *   // 또는 물음표 힌트 아이콘과 함께
 *   <label>Vc (m/min) <HelpHint content="권장 절삭속도" /></label>
 */

import { useEffect, useRef, useState, type ReactNode } from "react"

const TOOLTIP_SHOW_DELAY_MS = 150
const DEFAULT_MAX_WIDTH_PX = 240

export interface SimulatorTooltipProps {
  /** 트리거 요소 (hover 대상) */
  children: ReactNode
  /** 툴팁 내용 (string 또는 ReactNode) */
  content: ReactNode | string
  /** 표시 위치 (default: "top") */
  placement?: "top" | "bottom" | "left" | "right"
  /** 최대 너비 px (default: 240) */
  maxWidth?: number
  /** 다크 배경용 스타일 (default: false) */
  darkMode?: boolean
  /** inline 래퍼 (span) 여부. false면 div (default: true) */
  inline?: boolean
}

export function SimulatorTooltip({
  children,
  content,
  placement = "top",
  maxWidth = DEFAULT_MAX_WIDTH_PX,
  darkMode = false,
  inline = true,
}: SimulatorTooltipProps) {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
    }
  }, [])

  const handleEnter = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    showTimerRef.current = setTimeout(() => {
      setMounted(true)
      // 다음 프레임에 visible=true → fade-in transition 적용
      requestAnimationFrame(() => setVisible(true))
    }, TOOLTIP_SHOW_DELAY_MS)
  }

  const handleLeave = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    setVisible(false)
    // fade-out 후 언마운트
    setTimeout(() => setMounted(false), 120)
  }

  // placement별 position / arrow 스타일
  const positionClass = (() => {
    switch (placement) {
      case "bottom":
        return "top-full mt-2 left-1/2 -translate-x-1/2"
      case "left":
        return "right-full mr-2 top-1/2 -translate-y-1/2"
      case "right":
        return "left-full ml-2 top-1/2 -translate-y-1/2"
      case "top":
      default:
        return "bottom-full mb-2 left-1/2 -translate-x-1/2"
    }
  })()

  const bgClass = darkMode
    ? "bg-slate-900 border border-slate-700 text-slate-100"
    : "bg-slate-900/95 text-white"

  const arrowPositionClass = (() => {
    switch (placement) {
      case "bottom":
        return "bottom-full left-1/2 -translate-x-1/2 border-b-slate-900 border-l-transparent border-r-transparent border-t-transparent"
      case "left":
        return "left-full top-1/2 -translate-y-1/2 border-l-slate-900 border-t-transparent border-b-transparent border-r-transparent"
      case "right":
        return "right-full top-1/2 -translate-y-1/2 border-r-slate-900 border-t-transparent border-b-transparent border-l-transparent"
      case "top":
      default:
        return "top-full left-1/2 -translate-x-1/2 border-t-slate-900 border-l-transparent border-r-transparent border-b-transparent"
    }
  })()

  const Wrapper = inline ? "span" : "div"
  const wrapperClass = inline
    ? "relative inline-flex"
    : "relative flex"

  const contentIsString = typeof content === "string"

  return (
    <Wrapper
      className={wrapperClass}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      {children}
      {mounted && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 rounded-md px-2.5 py-1.5 text-xs leading-snug shadow-lg transition-opacity duration-150 ${positionClass} ${bgClass} ${
            visible ? "opacity-100" : "opacity-0"
          } ${contentIsString ? "whitespace-normal break-words" : ""}`}
          style={{ maxWidth: `${maxWidth}px` }}
        >
          {content}
          {/* arrow */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute h-0 w-0 border-[5px] ${arrowPositionClass}`}
          />
        </span>
      )}
    </Wrapper>
  )
}

/**
 * HelpHint - 물음표(?) 아이콘 + 툴팁 조합 helper.
 *
 * Usage:
 *   <label>Vc (m/min) <HelpHint content="권장 절삭속도. Sandvik 기준" /></label>
 */
export function HelpHint({
  content,
  darkMode,
  placement = "top",
}: {
  content: ReactNode
  darkMode?: boolean
  placement?: SimulatorTooltipProps["placement"]
}) {
  return (
    <SimulatorTooltip content={content} darkMode={darkMode} placement={placement}>
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600 hover:bg-blue-100 hover:text-blue-700 cursor-help"
        aria-label="help"
      >
        ?
      </span>
    </SimulatorTooltip>
  )
}
