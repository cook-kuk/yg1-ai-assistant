"use client"

/**
 * AutoAdviceEngine — headless component.
 *
 * Watches live simulator signals (chatter, tool wear, cutting force,
 * local temperature) and emits contextual advice via `onAdvice`.
 *
 * Each advice *type* has its own debounce window, so a noisy signal
 * won't spam the UI. Chatter / danger-tier rules fire at most once per
 * 5 s; the softer info tier (tool wear @ 40 %) fires at most once per
 * 20 s.
 */

import { useEffect, useRef } from "react"

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type AdviceSeverity = "info" | "warn" | "danger"

export interface AutoAdviceEngineProps {
  /** chatter intensity (0..1 = warn, >1 = danger). */
  chatterLevel: number
  /** tool wear, 0..1. */
  wearLevel: number
  /** total cutting force magnitude in Newtons: sqrt(Fx²+Fy²+Fz²). */
  forceMagnitude: number
  /** normalized local temperature, 0..1. */
  temperature: number
  /** emit an advice message to the host. */
  onAdvice: (message: string, severity: AdviceSeverity) => void
  /** turn the engine off without unmounting. Default: true. */
  enabled?: boolean
}

// ─────────────────────────────────────────────────────────────
// Internal: advice rule definitions
// ─────────────────────────────────────────────────────────────

type AdviceKey =
  | "chatter-danger"
  | "chatter-warn"
  | "wear-danger"
  | "wear-info"
  | "force-warn"
  | "temp-warn"

interface AdviceRule {
  key: AdviceKey
  severity: AdviceSeverity
  /** debounce window in ms between two emissions of this rule. */
  debounceMs: number
  message: string
  /** returns true when the rule should fire given current signals. */
  predicate: (s: Signals) => boolean
}

interface Signals {
  chatterLevel: number
  wearLevel: number
  forceMagnitude: number
  temperature: number
}

// Rules are evaluated in order. The danger-tier chatter/wear rules
// come before their warn/info counterparts so that the sharper message
// wins when both thresholds are exceeded (the lower rule's predicate
// then evaluates false and is skipped).
const RULES: readonly AdviceRule[] = [
  {
    key: "chatter-danger",
    severity: "danger",
    debounceMs: 5_000,
    message: "⚠️ 채터 심각 — RPM 낮추거나 ap를 20% 줄이세요",
    predicate: (s) => s.chatterLevel > 1.0,
  },
  {
    key: "chatter-warn",
    severity: "warn",
    debounceMs: 5_000,
    message: "진동 감지 — 피치 또는 ap 조정 고려",
    predicate: (s) => s.chatterLevel > 0.5 && s.chatterLevel < 1.0,
  },
  {
    key: "wear-danger",
    severity: "danger",
    debounceMs: 5_000,
    message: "공구 교체 필요 — 가공면 품질 저하 위험",
    predicate: (s) => s.wearLevel > 0.75,
  },
  {
    key: "wear-info",
    severity: "info",
    debounceMs: 20_000,
    message: "공구 마모 40% — 곧 교체 준비",
    predicate: (s) => s.wearLevel > 0.4 && s.wearLevel <= 0.75,
  },
  {
    key: "force-warn",
    severity: "warn",
    debounceMs: 5_000,
    message: "절삭력 과다 — fz 또는 ap 낮추세요",
    predicate: (s) => s.forceMagnitude > 500,
  },
  {
    key: "temp-warn",
    severity: "warn",
    debounceMs: 5_000,
    message: "국부 과열 — 절삭유 분사량 확인",
    predicate: (s) => s.temperature > 0.8,
  },
]

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export function AutoAdviceEngine({
  chatterLevel,
  wearLevel,
  forceMagnitude,
  temperature,
  onAdvice,
  enabled = true,
}: AutoAdviceEngineProps) {
  // Always-current signal snapshot — the interval reads from this ref
  // so we don't reinstall the timer on every prop change.
  const signalsRef = useRef<Signals>({
    chatterLevel,
    wearLevel,
    forceMagnitude,
    temperature,
  })
  signalsRef.current = {
    chatterLevel,
    wearLevel,
    forceMagnitude,
    temperature,
  }

  // Stable handle to the latest onAdvice callback.
  const onAdviceRef = useRef(onAdvice)
  onAdviceRef.current = onAdvice

  // Per-rule last-emission timestamp (ms since epoch). 0 = never.
  const lastEmitRef = useRef<Record<AdviceKey, number>>({
    "chatter-danger": 0,
    "chatter-warn": 0,
    "wear-danger": 0,
    "wear-info": 0,
    "force-warn": 0,
    "temp-warn": 0,
  })

  useEffect(() => {
    if (!enabled) return
    const evaluate = () => {
      const now = Date.now()
      const signals = signalsRef.current
      for (const rule of RULES) {
        if (!rule.predicate(signals)) continue
        const last = lastEmitRef.current[rule.key]
        if (now - last < rule.debounceMs) continue
        lastEmitRef.current[rule.key] = now
        onAdviceRef.current(rule.message, rule.severity)
      }
    }
    // ~2 Hz evaluation — fast enough for acute chatter, slow enough
    // to keep React re-render pressure negligible.
    const id = setInterval(evaluate, 500)
    // Run once immediately so the very first danger frame isn't held
    // for up to 500 ms before the host sees an advice.
    evaluate()
    return () => clearInterval(id)
  }, [enabled])

  return null
}

export default AutoAdviceEngine
