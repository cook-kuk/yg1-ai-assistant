// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 React Context
// 전역 on/off · 레벨 · 하위옵션 관리. localStorage 영속화.
"use client"

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import type { EducationLevel } from "./education-content"

export interface EducationContextValue {
  enabled: boolean
  level: EducationLevel
  showFormulas: boolean
  showExamples: boolean
  showPitfalls: boolean
  toggleEnabled: () => void
  setEnabled: (v: boolean) => void
  setLevel: (l: EducationLevel) => void
  setShowFormulas: (v: boolean) => void
  setShowExamples: (v: boolean) => void
  setShowPitfalls: (v: boolean) => void
}

const EducationContext = createContext<EducationContextValue | null>(null)

const STORAGE_KEY = "yg1-sim-v3-education"

interface StoredSettings {
  enabled: boolean
  level: EducationLevel
  showFormulas: boolean
  showExamples: boolean
  showPitfalls: boolean
}

const DEFAULTS: StoredSettings = {
  enabled: false,
  level: "beginner",
  showFormulas: true,
  showExamples: true,
  showPitfalls: false,
}

function loadSettings(): StoredSettings {
  if (typeof window === "undefined") return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw)
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      level: ["beginner", "intermediate", "expert"].includes(parsed.level) ? parsed.level : DEFAULTS.level,
      showFormulas: typeof parsed.showFormulas === "boolean" ? parsed.showFormulas : DEFAULTS.showFormulas,
      showExamples: typeof parsed.showExamples === "boolean" ? parsed.showExamples : DEFAULTS.showExamples,
      showPitfalls: typeof parsed.showPitfalls === "boolean" ? parsed.showPitfalls : DEFAULTS.showPitfalls,
    }
  } catch {
    return DEFAULTS
  }
}

function saveSettings(s: StoredSettings) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // localStorage 실패 시 무시 (시크릿 탭 등)
  }
}

export function EducationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoredSettings>(DEFAULTS)
  const [hydrated, setHydrated] = useState(false)

  // 초기 로드 (클라이언트 전용)
  useEffect(() => {
    setSettings(loadSettings())
    setHydrated(true)
  }, [])

  // 변경 시 저장
  useEffect(() => {
    if (hydrated) saveSettings(settings)
  }, [settings, hydrated])

  const toggleEnabled = useCallback(() => {
    setSettings(s => ({ ...s, enabled: !s.enabled }))
  }, [])
  const setEnabled = useCallback((v: boolean) => setSettings(s => ({ ...s, enabled: v })), [])
  const setLevel = useCallback((level: EducationLevel) => setSettings(s => ({ ...s, level })), [])
  const setShowFormulas = useCallback((v: boolean) => setSettings(s => ({ ...s, showFormulas: v })), [])
  const setShowExamples = useCallback((v: boolean) => setSettings(s => ({ ...s, showExamples: v })), [])
  const setShowPitfalls = useCallback((v: boolean) => setSettings(s => ({ ...s, showPitfalls: v })), [])

  // SSR / 첫 client render는 항상 DEFAULTS 를 노출 → hydration mismatch 원천 제거
  const effective = hydrated ? settings : DEFAULTS

  const value: EducationContextValue = {
    ...effective,
    toggleEnabled,
    setEnabled,
    setLevel,
    setShowFormulas,
    setShowExamples,
    setShowPitfalls,
  }

  return (
    <EducationContext.Provider value={value}>
      {children}
    </EducationContext.Provider>
  )
}

export function useEducation(): EducationContextValue {
  const ctx = useContext(EducationContext)
  if (!ctx) {
    // Provider 없이 쓰는 경우 기본값 반환 (컴포넌트가 그냥 동작하도록)
    return {
      enabled: false,
      level: "beginner",
      showFormulas: true,
      showExamples: true,
      showPitfalls: false,
      toggleEnabled: () => {},
      setEnabled: () => {},
      setLevel: () => {},
      setShowFormulas: () => {},
      setShowExamples: () => {},
      setShowPitfalls: () => {},
    }
  }
  return ctx
}
