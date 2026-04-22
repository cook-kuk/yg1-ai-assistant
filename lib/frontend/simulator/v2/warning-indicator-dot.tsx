"use client"
import type { ReactNode } from "react"
import type { SimWarning } from "../cutting-calculator"

export type { SimWarning }

// 어떤 파라미터가 어떤 키워드를 포함한 경고와 연결되는지
export type ParamKey =
  | "Vc"
  | "fz"
  | "ap"
  | "ae"
  | "stickout"
  | "workholding"
  | "material"
  | "deflection"
  | "chatter"
  | "tool"

export const PARAM_KEYWORDS: Record<ParamKey, string[]> = {
  Vc: ["Vc", "절삭속도", "내열합금"],
  fz: ["fz", "이송", "칩두께", "chip"],
  ap: ["ap", "축방향", "절입"],
  ae: ["ae", "경방향"],
  stickout: ["Stickout", "L/D", "stickout"],
  workholding: ["Workholding", "workholding"],
  material: ["재질", "경도", "내열"],
  deflection: ["편향", "deflection"],
  chatter: ["Chatter", "채터", "chatter"],
  tool: ["공구", "tool", "파손"],
}

export function findWarningsForParam(warnings: SimWarning[], key: ParamKey): SimWarning[] {
  const kws = PARAM_KEYWORDS[key]
  return warnings.filter((w) => kws.some((kw) => w.message.includes(kw)))
}

export function getWorstLevel(warnings: SimWarning[]): "error" | "warn" | "info" | null {
  if (warnings.some((w) => w.level === "error")) return "error"
  if (warnings.some((w) => w.level === "warn")) return "warn"
  if (warnings.some((w) => w.level === "info")) return "info"
  return null
}

interface DotProps {
  warnings: SimWarning[]
  param: ParamKey
  darkMode?: boolean
  showTooltip?: boolean // hover 시 경고 요약 툴팁
}

export function WarningDot({ warnings, param, darkMode, showTooltip = true }: DotProps): ReactNode {
  const related = findWarningsForParam(warnings, param)
  const level = getWorstLevel(related)
  if (!level) return null

  const color =
    level === "error" ? "bg-rose-500" : level === "warn" ? "bg-amber-500" : "bg-blue-500"
  const ringColor =
    level === "error"
      ? "ring-rose-300"
      : level === "warn"
        ? "ring-amber-300"
        : "ring-blue-300"
  const animate = level === "error" ? "animate-pulse" : ""

  return (
    <span
      className="relative inline-flex items-center group"
      role="status"
      aria-label={`${related.length} warning${related.length > 1 ? "s" : ""}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${color} ${animate} ring-2 ring-offset-1 ${ringColor} ${
          darkMode ? "ring-offset-slate-900" : "ring-offset-white"
        }`}
      />
      {showTooltip && (
        <span
          className={`invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10px] shadow-lg z-50 pointer-events-none max-w-xs ${
            darkMode
              ? "bg-slate-800 text-slate-100 border border-slate-700"
              : "bg-slate-900 text-white"
          }`}
        >
          {related[0].message}
          {related.length > 1 && <span className="opacity-70"> +{related.length - 1}</span>}
        </span>
      )}
    </span>
  )
}
