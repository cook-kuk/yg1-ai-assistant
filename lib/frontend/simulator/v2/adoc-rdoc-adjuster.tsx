"use client"

import { useCallback, useRef } from "react"

interface Adjuster2DProps {
  apPct: number  // 0..100 (% of D)
  aePct: number  // 0..100 (% of D)
  onChange: (apPct: number, aePct: number) => void
  className?: string
}

/**
 * Harvey MAP-style 2D adjuster: vertical axis = ADOC (ap%), horizontal axis = RDOC (ae%).
 * Drag the handle within the box to set both simultaneously.
 */
export function ADOCRDOCAdjuster({ apPct, aePct, onChange, className }: Adjuster2DProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const clamp = (v: number) => Math.min(100, Math.max(0, v))

  const updateFromEvent = useCallback((clientX: number, clientY: number) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    const x = clamp(((clientX - rect.left) / rect.width) * 100)
    const y = clamp(((clientY - rect.top) / rect.height) * 100)
    // y: top = 0% ap (shallow), bottom = 100% ap (deep)
    onChange(y, x)
  }, [onChange])

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as Element).setPointerCapture(e.pointerId)
    updateFromEvent(e.clientX, e.clientY)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    updateFromEvent(e.clientX, e.clientY)
  }
  const handlePointerUp = (e: React.PointerEvent) => {
    dragging.current = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }

  const aeClamped = clamp(aePct)
  const apClamped = clamp(apPct)

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">ADOC / RDOC</span>
        <span className="text-[9px] text-gray-400">드래그로 동시 조절</span>
      </div>
      <div className="flex gap-2">
        {/* Y-axis label */}
        <div className="flex flex-col items-center justify-between text-[9px] text-gray-500 font-mono py-1">
          <span>0%</span>
          <span className="writing-mode-vertical rotate-180" style={{ writingMode: "vertical-rl" as any }}>ADOC (ap)</span>
          <span>100%</span>
        </div>
        {/* Box */}
        <div className="flex-1">
          <div
            ref={boxRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative w-full aspect-square rounded-lg border-2 border-gray-300 bg-gradient-to-br from-emerald-50 via-amber-50 to-rose-50 touch-none cursor-crosshair select-none"
          >
            {/* Grid lines */}
            {[25, 50, 75].map(p => (
              <div key={`v${p}`} className="absolute top-0 bottom-0 w-px bg-gray-300/60" style={{ left: `${p}%` }} />
            ))}
            {[25, 50, 75].map(p => (
              <div key={`h${p}`} className="absolute left-0 right-0 h-px bg-gray-300/60" style={{ top: `${p}%` }} />
            ))}
            {/* Safe zone badge (ae<50%, ap<100%): HEM sweet spot */}
            <div className="absolute inset-0 flex items-end justify-start p-1 pointer-events-none">
              <div className="text-[8px] text-emerald-700 font-bold opacity-70 rotate-[-8deg]">HEM ↘</div>
            </div>
            {/* Handle */}
            <div
              className="absolute w-5 h-5 rounded-full bg-blue-600 border-2 border-white shadow-lg pointer-events-none -translate-x-1/2 -translate-y-1/2 ring-2 ring-blue-400/30"
              style={{ left: `${aeClamped}%`, top: `${apClamped}%` }}
            />
            {/* Crosshair lines */}
            <div className="absolute top-0 bottom-0 w-px bg-blue-400/50 pointer-events-none" style={{ left: `${aeClamped}%` }} />
            <div className="absolute left-0 right-0 h-px bg-blue-400/50 pointer-events-none" style={{ top: `${apClamped}%` }} />
          </div>
          {/* X axis label */}
          <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-1 px-0.5">
            <span>0%</span>
            <span>RDOC (ae) →</span>
            <span>100%</span>
          </div>
        </div>
      </div>
      {/* Readout */}
      <div className="flex justify-between mt-2 text-[10px] font-mono">
        <span className="text-gray-600">ap <span className="font-bold text-blue-700">{apClamped.toFixed(0)}%</span></span>
        <span className="text-gray-600">ae <span className="font-bold text-blue-700">{aeClamped.toFixed(0)}%</span></span>
      </div>
    </div>
  )
}
