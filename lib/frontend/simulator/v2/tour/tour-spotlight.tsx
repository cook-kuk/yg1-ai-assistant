// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — Tour Spotlight
// - 전체 뷰포트를 어둡게 덮고, target 주변만 "구멍"을 뚫어 하이라이트
// - SVG mask 로 구현 (흰=보임, 검=가려짐 → mask 내부를 검게 하면 구멍)
// - resize/scroll 시 재측정
// - target 이 없으면 null 반환 (오버레이 자체가 렌더되지 않음)
"use client"

import { useEffect, useState } from "react"

export interface TourSpotlightProps {
  /** 하이라이트할 CSS 셀렉터 */
  target: string
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PADDING = 8
const RADIUS = 8
const MEASURE_DELAY_MS = 300

function measure(target: string): Rect | null {
  if (typeof document === "undefined") return null
  try {
    const el = (target.startsWith("#")
      ? document.getElementById(target.slice(1))
      : document.querySelector(target)) as HTMLElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return null
    return {
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    }
  } catch {
    return null
  }
}

export function TourSpotlight({ target }: TourSpotlightProps) {
  const [rect, setRect] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  }))

  // 초기/타겟 변경 시 scrollIntoView 후 300ms 대기 → 측정
  useEffect(() => {
    if (typeof document === "undefined") return

    let cancelled = false
    let timeoutId: number | undefined

    try {
      const el = (target.startsWith("#")
        ? document.getElementById(target.slice(1))
        : document.querySelector(target)) as HTMLElement | null
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    } catch {
      // ignore
    }

    timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setRect(measure(target))
    }, MEASURE_DELAY_MS)

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [target])

  // resize / scroll 재측정
  useEffect(() => {
    if (typeof window === "undefined") return
    const reposition = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      setRect(measure(target))
    }
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [target])

  if (!rect) return null

  const vw = viewport.w || (typeof window !== "undefined" ? window.innerWidth : 0)
  const vh = viewport.h || (typeof window !== "undefined" ? window.innerHeight : 0)
  if (vw === 0 || vh === 0) return null

  const hx = Math.max(0, rect.left - PADDING)
  const hy = Math.max(0, rect.top - PADDING)
  const hw = Math.min(vw - hx, rect.width + PADDING * 2)
  const hh = Math.min(vh - hy, rect.height + PADDING * 2)

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 60 }}
      aria-hidden="true"
    >
      <svg
        width={vw}
        height={vh}
        viewBox={`0 0 ${vw} ${vh}`}
        xmlns="http://www.w3.org/2000/svg"
        className="block"
      >
        <defs>
          <mask id="aria-tour-spotlight-mask">
            {/* 흰 = 보임 → 전체 검은 사각형 영역 */}
            <rect x={0} y={0} width={vw} height={vh} fill="white" />
            {/* 검 = 가려짐 (여기서는 검은 사각형 안에서 검 = 투명 영역) */}
            <rect
              x={hx}
              y={hy}
              width={hw}
              height={hh}
              rx={RADIUS}
              ry={RADIUS}
              fill="black"
            />
          </mask>
        </defs>
        {/* 어두운 배경 (구멍 적용) */}
        <rect
          x={0}
          y={0}
          width={vw}
          height={vh}
          fill="rgba(0,0,0,0.7)"
          mask="url(#aria-tour-spotlight-mask)"
        />
        {/* 하이라이트 보더 (teal, pulse) */}
        <rect
          x={hx}
          y={hy}
          width={hw}
          height={hh}
          rx={RADIUS}
          ry={RADIUS}
          fill="none"
          stroke="#14b8a6"
          strokeWidth={2}
          className="animate-pulse"
        />
      </svg>
    </div>
  )
}

export default TourSpotlight
