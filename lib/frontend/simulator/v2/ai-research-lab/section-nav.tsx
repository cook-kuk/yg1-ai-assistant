"use client"

import { useEffect, useState } from "react"

export interface NavItem {
  id: string
  label: string
  icon: string
}

export const AI_LAB_SECTIONS: NavItem[] = [
  { id: "ml-tool-life-prediction", label: "ML 공구 수명 예측", icon: "📊" },
  { id: "bayesian-uncertainty", label: "베이지안 불확실성", icon: "🔬" },
  { id: "sensor-anomaly-detection", label: "실시간 센서 이상탐지", icon: "⏱️" },
  { id: "factory-personalization", label: "공장 맞춤 개인화", icon: "🎯" },
  { id: "causal-xai", label: "인과추론 & xAI", icon: "🧠" },
  { id: "doe-design", label: "DOE 실험 설계", icon: "📐" },
  { id: "survival-analysis", label: "생존분석 곡선", icon: "📉" },
  { id: "ai-roadmap", label: "5년 로드맵", icon: "🗺" },
]

// IntersectionObserver-based active-section tracking — used by both the
// sidebar and CuttingCopilot (for context capture).
export function useActiveSection(): string | null {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const ids = AI_LAB_SECTIONS.map(s => s.id)
    const elements = ids
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)

    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      entries => {
        // Pick the entry whose target is most prominent in viewport.
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: "-25% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return active
}

interface SectionNavProps {
  activeId?: string | null
  onNavigate?: (id: string) => void
}

export function SectionNav({ activeId, onNavigate }: SectionNavProps) {
  const detected = useActiveSection()
  const current = activeId ?? detected

  function jump(id: string) {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    onNavigate?.(id)
  }

  return (
    <nav className="sticky top-24 space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-400 px-3 py-1.5">
        섹션 네비게이션
      </div>
      {AI_LAB_SECTIONS.map((s, i) => {
        const isActive = current === s.id
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-xs transition-colors ${
              isActive
                ? "bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 font-semibold"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
            }`}
          >
            <span className="font-mono text-[10px] w-4 text-slate-400">{i + 1}.</span>
            <span>{s.icon}</span>
            <span className="flex-1 truncate">{s.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
