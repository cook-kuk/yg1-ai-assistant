"use client"
import { motion } from "framer-motion"

export interface RangeScoreBadgeProps {
  score: number  // 0~100
  errors: number
  warns: number
  darkMode?: boolean
}

export function RangeScoreBadge({ score, errors, warns, darkMode }: RangeScoreBadgeProps) {
  const tone = score >= 85 ? "emerald" : score >= 60 ? "amber" : "rose"
  const label = score >= 85 ? "안전" : score >= 60 ? "주의" : "위험"
  const bg = tone === "emerald" ? "bg-emerald-500" : tone === "amber" ? "bg-amber-500" : "bg-rose-500"
  const fg = tone === "emerald" ? "text-emerald-100" : tone === "amber" ? "text-amber-950" : "text-white"
  return (
    <motion.span
      animate={{ scale: [1, 1.05, 1] }}
      transition={{ duration: 0.3 }}
      key={score}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${bg} ${fg} shadow-sm`}
      title={`안전도 ${score}점 · 오류 ${errors} · 경고 ${warns}`}
    >
      <span>🛡</span>
      <span>{label}</span>
      <span className="tabular-nums">{score}/100</span>
    </motion.span>
  )
}

export default RangeScoreBadge
