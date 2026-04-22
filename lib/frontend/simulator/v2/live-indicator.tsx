"use client"
import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"

export interface LiveIndicatorProps {
  /** 변경 감지용 의존성 값들 (수치) */
  watch: number[]
  /** 라벨 */
  label?: string  // default "LIVE"
  /** 색상 */
  color?: "emerald" | "cyan" | "rose" | "amber" | "violet"  // default emerald
  /** 업데이트 카운트 표시 */
  showCount?: boolean
  /** 다크모드 */
  darkMode?: boolean
}

/** 비주얼 패널 상단에 표시하는 LIVE 배지 + 업데이트 카운터 + pulse dot. */
export function LiveIndicator({ watch, label = "LIVE", color = "emerald", showCount = true, darkMode }: LiveIndicatorProps) {
  const [updateCount, setUpdateCount] = useState(0)
  const [flashing, setFlashing] = useState(false)
  const prevRef = useRef<number[]>(watch)

  useEffect(() => {
    const changed = watch.some((v, i) => Math.abs(v - (prevRef.current[i] ?? 0)) > 0.0001)
    if (changed) {
      setUpdateCount(c => c + 1)
      setFlashing(true)
      const t = setTimeout(() => setFlashing(false), 400)
      prevRef.current = [...watch]
      return () => clearTimeout(t)
    }
  }, [watch])

  const colorClass = {
    emerald: "bg-emerald-500 text-emerald-300",
    cyan: "bg-cyan-500 text-cyan-300",
    rose: "bg-rose-500 text-rose-300",
    amber: "bg-amber-500 text-amber-300",
    violet: "bg-violet-500 text-violet-300",
  }[color]
  const textBright = {
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    rose: "text-rose-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
  }[color]

  return (
    <motion.span
      animate={flashing ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      transition={{ duration: 0.3 }}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${
        darkMode ? "bg-slate-900 ring-1 ring-slate-700" : "bg-slate-950 ring-1 ring-slate-800"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${colorClass.split(" ")[0]} ${flashing ? "animate-ping" : "animate-pulse"}`} />
      <span className={textBright}>{label}</span>
      {showCount && updateCount > 0 && (
        <span className="text-slate-500 tabular-nums">#{updateCount}</span>
      )}
    </motion.span>
  )
}

/** 값이 바뀔 때마다 짧게 하이라이트되는 숫자 wrapper. */
export function FlashOnChange({ value, children, darkMode }: { value: number; children: React.ReactNode; darkMode?: boolean }) {
  const [flashing, setFlashing] = useState(false)
  const prevRef = useRef(value)
  useEffect(() => {
    if (Math.abs(value - prevRef.current) > 0.0001) {
      setFlashing(true)
      const t = setTimeout(() => setFlashing(false), 500)
      prevRef.current = value
      return () => clearTimeout(t)
    }
  }, [value])
  return (
    <span className={`transition-colors duration-300 ${flashing ? (darkMode ? "text-amber-300" : "text-amber-600") : ""}`}>
      {children}
    </span>
  )
}

export default LiveIndicator
