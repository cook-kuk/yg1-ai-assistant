"use client"

import { AlertTriangle } from "lucide-react"

interface DemoBadgeProps {
  size?: "xs" | "sm" | "md"
  label?: string
}

export function DemoBadge({ size = "sm", label = "DEMO" }: DemoBadgeProps) {
  const sizeCls =
    size === "xs"
      ? "text-[9px] px-1.5 py-0 h-4"
      : size === "sm"
      ? "text-[10px] px-1.5 py-0.5"
      : "text-xs px-2 py-1"
  const iconSize = size === "md" ? 11 : size === "sm" ? 10 : 9
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono font-bold tracking-widest rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/50 ${sizeCls}`}
      title="데모 값 · 실제 ML 추론 아님"
    >
      <AlertTriangle size={iconSize} />
      {label}
    </span>
  )
}
