// SPDX-License-Identifier: MIT
// YG-1 ARIA AI Research Lab — Tour Provider
// - React Context 기반 투어 상태/컨트롤 제공
// - useReducer 로 상태 관리
// - ESC 리스너 (active 일 때만 bind)
// - step 변경 시 target 을 smooth scroll into view
// - completeTour 는 localStorage("aria-tour-completed"="true") 기록
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react"

import {
  getScenario,
  type TourScenario,
  type TourStep,
} from "./tour-scenarios"

// ── Constants ─────────────────────────────────────────────────────────
const LS_KEY_COMPLETED = "aria-tour-completed"

// ── State / Action ────────────────────────────────────────────────────
interface TourState {
  isActive: boolean
  scenario: TourScenario | null
  currentIndex: number
}

type TourAction =
  | { type: "START"; scenario: TourScenario }
  | { type: "STOP" }
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "COMPLETE" }

const initialState: TourState = {
  isActive: false,
  scenario: null,
  currentIndex: 0,
}

function reducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "START":
      return { isActive: true, scenario: action.scenario, currentIndex: 0 }
    case "STOP":
      // Clear scenario + index so consumers reading currentStep after the
      // tour closes can't accidentally see a stale step (state hygiene).
      return { isActive: false, scenario: null, currentIndex: 0 }
    case "NEXT": {
      if (!state.scenario) return state
      const nextIdx = state.currentIndex + 1
      if (nextIdx >= state.scenario.steps.length) return state
      return { ...state, currentIndex: nextIdx }
    }
    case "PREV": {
      if (state.currentIndex <= 0) return state
      return { ...state, currentIndex: state.currentIndex - 1 }
    }
    case "COMPLETE":
      return { isActive: false, scenario: null, currentIndex: 0 }
    default:
      return state
  }
}

// ── Context ───────────────────────────────────────────────────────────
export interface TourContextValue {
  isActive: boolean
  scenario: TourScenario | null
  currentStep: TourStep | null
  currentIndex: number
  totalSteps: number
  startTour: (id: string) => void
  stopTour: () => void
  nextStep: () => void
  prevStep: () => void
  completeTour: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────
export function TourProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const startTour = useCallback((id: string) => {
    const scenario = getScenario(id)
    if (!scenario) {
      // eslint-disable-next-line no-console
      console.warn(`[TourProvider] Unknown scenario id: ${id}`)
      return
    }
    dispatch({ type: "START", scenario })
  }, [])

  const stopTour = useCallback(() => {
    dispatch({ type: "STOP" })
  }, [])

  const nextStep = useCallback(() => {
    dispatch({ type: "NEXT" })
  }, [])

  const prevStep = useCallback(() => {
    dispatch({ type: "PREV" })
  }, [])

  const completeTour = useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LS_KEY_COMPLETED, "true")
      }
    } catch {
      // storage may be unavailable (private mode, quota, etc.) — safe ignore
    }
    dispatch({ type: "COMPLETE" })
  }, [])

  // ESC 키 → stopTour (active 일 때만)
  useEffect(() => {
    if (!state.isActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        stopTour()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.isActive, stopTour])

  // 스텝 전환 시 target 으로 스크롤
  const currentStep: TourStep | null = useMemo(() => {
    if (!state.scenario) return null
    return state.scenario.steps[state.currentIndex] ?? null
  }, [state.scenario, state.currentIndex])

  useEffect(() => {
    if (!state.isActive || !currentStep) return
    if (typeof document === "undefined") return
    // 렌더 프레임 이후 스크롤 (레이아웃 안정화)
    const id = window.requestAnimationFrame(() => {
      try {
        const el =
          (currentStep.target.startsWith("#")
            ? document.getElementById(currentStep.target.slice(1))
            : document.querySelector(currentStep.target)) as HTMLElement | null
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" })
        }
      } catch {
        // invalid selector — ignore silently
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [state.isActive, currentStep])

  const value = useMemo<TourContextValue>(
    () => ({
      isActive: state.isActive,
      scenario: state.scenario,
      currentStep,
      currentIndex: state.currentIndex,
      totalSteps: state.scenario?.steps.length ?? 0,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      completeTour,
    }),
    [
      state.isActive,
      state.scenario,
      state.currentIndex,
      currentStep,
      startTour,
      stopTour,
      nextStep,
      prevStep,
      completeTour,
    ],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

// ── Hook ──────────────────────────────────────────────────────────────
export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) {
    throw new Error("useTour must be used within a <TourProvider>")
  }
  return ctx
}
