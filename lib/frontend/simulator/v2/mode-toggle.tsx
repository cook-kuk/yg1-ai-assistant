"use client"
import { useSimulatorMode, type SimulatorMode } from "./mode-context"

interface ModeToggleProps {
  darkMode?: boolean
  size?: "sm" | "md"
}

export function ModeToggle({ darkMode, size = "md" }: ModeToggleProps) {
  const { mode, setMode } = useSimulatorMode()
  const modes: Array<{ key: SimulatorMode; icon: string; label: string; desc: string; color: string }> = [
    { key: "beginner", icon: "🎓", label: "초보", desc: "핵심만", color: "sky" },
    { key: "expert", icon: "👔", label: "전문가", desc: "모든 고급 기능", color: "violet" },
    { key: "education", icon: "📚", label: "교육", desc: "툴팁 + 벤더 태그", color: "amber" },
  ]
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-xl border p-1 ${darkMode ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
      {modes.map(m => {
        const active = mode === m.key
        const activeBg = m.color === "sky" ? "bg-sky-100 text-sky-700 ring-1 ring-sky-300 dark:bg-sky-900/40 dark:text-sky-300 dark:ring-sky-700"
          : m.color === "violet" ? "bg-violet-100 text-violet-700 ring-1 ring-violet-300 dark:bg-violet-900/40 dark:text-violet-300 dark:ring-violet-700"
          : "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:ring-amber-700"
        return (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            title={m.desc}
            className={`flex items-center gap-1 rounded-lg ${size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} font-semibold transition-all ${
              active ? activeBg : darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            <span className="text-base leading-none">{m.icon}</span>
            <span>{m.label}</span>
          </button>
        )
      })}
    </div>
  )
}
