"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Client-side typewriter effect for assistant messages.
 *
 * Why client-side and not real token streaming?
 *   - /api/recommend returns a single JSON DTO (text + chips + products).
 *     Real streaming would require decomposing the LLM/candidate/response
 *     pipeline and is tracked as a deeper TODO (see below).
 *   - A character-level reveal on the received text gives the same visual
 *     effect with zero risk to response correctness or latency.
 *
 * ##TODO(streaming-B): Stream product cards progressively — emit chips/
 *   candidates as soon as the filter stage resolves, then stream the
 *   explanation text separately. Requires splitting handleServeExploration
 *   into an async iterator and teaching recommendation-http to write SSE.
 *
 * ##TODO(streaming-C): True token-level streaming with inline tool calls —
 *   pipe Anthropic/OpenAI stream chunks straight to the client and
 *   reconstruct tool-call arguments as they arrive. Requires end-to-end
 *   rework of recommendation-presenter + RecommendationRequestDto to carry
 *   partial state, plus a new streaming client hook replacing the current
 *   fetch-then-setState flow in exploration-flow.tsx.
 */
/** Chars revealed per tick for a given cps. At least 1. */
export function computeTypewriterStep(cps: number): number {
  return Math.max(1, Math.floor(cps / 60))
}

/** Interval between ticks in ms. At least 4ms. */
export function computeTypewriterIntervalMs(cps: number): number {
  return Math.max(4, Math.floor(1000 / cps))
}

/** Advance the reveal cursor by one tick, clamped to text.length. */
export function advanceTypewriter(cursor: number, textLength: number, step: number): number {
  return Math.min(textLength, cursor + step)
}

interface TypewriterTextProps {
  text: string
  /** Characters per second. Default 120 (~ChatGPT feel). */
  cps?: number
  /** Disable animation (render full text immediately). */
  instant?: boolean
  /** Called once when the animation finishes. */
  onDone?: () => void
  /** Optional render wrapper — e.g. Markdown. Receives the partial text. */
  render?: (partial: string) => React.ReactNode
}

export function TypewriterText({ text, cps = 120, instant, onDone, render }: TypewriterTextProps) {
  const [shown, setShown] = useState(() => (instant ? text : ""))
  const doneRef = useRef(false)

  useEffect(() => {
    if (instant) {
      setShown(text)
      if (!doneRef.current) {
        doneRef.current = true
        onDone?.()
      }
      return
    }

    // Reset on text change
    doneRef.current = false
    setShown("")

    if (!text) return

    const intervalMs = computeTypewriterIntervalMs(cps)
    const step = computeTypewriterStep(cps)
    let i = 0
    const timer = setInterval(() => {
      // Reveal in small chunks on each tick so slower devices don't lag.
      i = advanceTypewriter(i, text.length, step)
      setShown(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(timer)
        if (!doneRef.current) {
          doneRef.current = true
          onDone?.()
        }
      }
    }, intervalMs)

    return () => clearInterval(timer)
  }, [text, cps, instant, onDone])

  return <>{render ? render(shown) : shown}</>
}
