"use client"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type SimulatorMode = "beginner" | "expert" | "education"

interface ModeContextValue {
  mode: SimulatorMode
  setMode: (m: SimulatorMode) => void
  isBeginner: boolean
  isExpert: boolean
  isEducation: boolean
  showAdvancedMetrics: boolean   // expert || education → true
  showVendorTags: boolean        // education only → true
  showTooltips: boolean          // education only → true
}

const ModeContext = createContext<ModeContextValue | null>(null)

export function ModeProvider({ children, initial = "beginner" }: { children: ReactNode; initial?: SimulatorMode }) {
  const [mode, setModeState] = useState<SimulatorMode>(initial)

  // localStorage hydration
  useEffect(() => {
    try {
      const saved = localStorage.getItem("yg1-sim-v3-mode")
      if (saved === "beginner" || saved === "expert" || saved === "education") setModeState(saved)
    } catch {}
  }, [])

  const setMode = (m: SimulatorMode) => {
    setModeState(m)
    try { localStorage.setItem("yg1-sim-v3-mode", m) } catch {}
  }

  const value: ModeContextValue = {
    mode,
    setMode,
    isBeginner: mode === "beginner",
    isExpert: mode === "expert",
    isEducation: mode === "education",
    showAdvancedMetrics: mode === "expert" || mode === "education",
    // 5사 벤더 출처 태깅 — 투명성/브랜딩 차별점이므로 모든 모드에서 상시 노출
    showVendorTags: true,
    showTooltips: mode === "education",
  }

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
}

export function useSimulatorMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) {
    // 컨텍스트 없이도 동작 (fallback: beginner)
    return {
      mode: "beginner" as SimulatorMode, setMode: () => {},
      isBeginner: true, isExpert: false, isEducation: false,
      showAdvancedMetrics: false, showVendorTags: false, showTooltips: false,
    }
  }
  return ctx
}
