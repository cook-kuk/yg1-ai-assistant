"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"

// ─────────────────────────────────────────────────────────────────────────────
// ToolSequencePanel — multi-tool machining sequence (roughing → semi → finish)
//   Each step defines its own tool geometry (diameter, flutes), cutting depth
//   (ap), feed-per-tooth (fz), sweep pattern (zigzag|spiral) and a timed
//   duration (seconds). The parent component uses the active step's values to
//   OVERRIDE the main simulator state while `isRunning` is true.
// ─────────────────────────────────────────────────────────────────────────────

export type ToolSequenceStep = {
  id: string
  label: string
  diameter: number
  flutes: number
  ap: number
  fz: number
  pattern: "zigzag" | "spiral"
  durationSec: number
}

export const DEFAULT_TOOL_SEQUENCE: ToolSequenceStep[] = [
  { id: "rough", label: "Roughing", diameter: 12, flutes: 4, ap: 3, fz: 0.12, pattern: "zigzag", durationSec: 15 },
  { id: "semi", label: "Semi-finish", diameter: 8, flutes: 4, ap: 1.5, fz: 0.08, pattern: "zigzag", durationSec: 15 },
  { id: "finish", label: "Finish", diameter: 6, flutes: 6, ap: 0.5, fz: 0.04, pattern: "spiral", durationSec: 20 },
]

// Per-step palette. id prefix (rough/semi/finish) picks a color; anything else
// falls back to neutral slate so custom user-added steps still render cleanly.
function stepPalette(step: ToolSequenceStep): {
  border: string
  bg: string
  bar: string
  text: string
  chip: string
} {
  const id = step.id.toLowerCase()
  if (id.startsWith("rough")) {
    return {
      border: "border-red-300",
      bg: "bg-red-50",
      bar: "bg-red-500",
      text: "text-red-700",
      chip: "bg-red-100 text-red-700 border-red-200",
    }
  }
  if (id.startsWith("semi")) {
    return {
      border: "border-amber-300",
      bg: "bg-amber-50",
      bar: "bg-amber-500",
      text: "text-amber-700",
      chip: "bg-amber-100 text-amber-700 border-amber-200",
    }
  }
  if (id.startsWith("finish")) {
    return {
      border: "border-emerald-300",
      bg: "bg-emerald-50",
      bar: "bg-emerald-500",
      text: "text-emerald-700",
      chip: "bg-emerald-100 text-emerald-700 border-emerald-200",
    }
  }
  return {
    border: "border-slate-300",
    bg: "bg-slate-50",
    bar: "bg-slate-500",
    text: "text-slate-700",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
  }
}

export type ToolSequencePanelProps = {
  sequence: ToolSequenceStep[]
  onSequenceChange: (updated: ToolSequenceStep[]) => void
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  isRunning: boolean
  onRunStateChange: (running: boolean) => void
}

function ToolSequencePanelImpl({
  sequence,
  onSequenceChange,
  activeIndex,
  onActiveIndexChange,
  isRunning,
  onRunStateChange,
}: ToolSequencePanelProps) {
  // ── Progress bar clock ──────────────────────────────────────────────────
  // Tracks wall-clock ms spent on the current active step. Reset whenever the
  // active step changes or the run state flips. Parent drives the advance of
  // activeIndex based on durationSec; this component only visualizes elapsed.
  const [elapsedMs, setElapsedMs] = useState(0)
  const startAtRef = useRef<number | null>(null)

  useEffect(() => {
    // Reset whenever we (re)enter running state or switch steps.
    setElapsedMs(0)
    startAtRef.current = isRunning && activeIndex >= 0 ? performance.now() : null
  }, [isRunning, activeIndex])

  useEffect(() => {
    if (!isRunning || activeIndex < 0) return
    let rafId = 0
    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const start = startAtRef.current
      if (start == null) return
      setElapsedMs(performance.now() - start)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isRunning, activeIndex])

  const activeStep = activeIndex >= 0 && activeIndex < sequence.length ? sequence[activeIndex] : null
  const activeDurationMs = activeStep ? Math.max(1, activeStep.durationSec) * 1000 : 1
  const progressPct = activeStep ? Math.min(100, (elapsedMs / activeDurationMs) * 100) : 0

  // ── CRUD helpers ────────────────────────────────────────────────────────
  const updateStep = (index: number, patch: Partial<ToolSequenceStep>) => {
    const next = sequence.slice()
    next[index] = { ...next[index], ...patch }
    onSequenceChange(next)
  }

  const removeStep = (index: number) => {
    if (sequence.length <= 1) return // keep at least one step
    const next = sequence.slice()
    next.splice(index, 1)
    onSequenceChange(next)
    if (activeIndex >= next.length) onActiveIndexChange(-1)
  }

  const moveStep = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= sequence.length) return
    const next = sequence.slice()
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onSequenceChange(next)
  }

  const addStep = () => {
    const idBase = `step-${sequence.length + 1}`
    let id = idBase
    let suffix = 1
    const existing = new Set(sequence.map(s => s.id))
    while (existing.has(id)) {
      id = `${idBase}-${suffix++}`
    }
    const next: ToolSequenceStep = {
      id,
      label: `Step ${sequence.length + 1}`,
      diameter: 8,
      flutes: 4,
      ap: 1.0,
      fz: 0.06,
      pattern: "zigzag",
      durationSec: 10,
    }
    onSequenceChange([...sequence, next])
  }

  // ── Run controls ────────────────────────────────────────────────────────
  const handlePlay = () => {
    if (sequence.length === 0) return
    if (activeIndex < 0) onActiveIndexChange(0)
    onRunStateChange(true)
  }
  const handlePause = () => {
    onRunStateChange(false)
  }
  const handleStop = () => {
    onRunStateChange(false)
    onActiveIndexChange(-1)
  }

  const totalSec = useMemo(() => sequence.reduce((sum, s) => sum + s.durationSec, 0), [sequence])

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-white/70 p-3 text-[11px]">
      {/* Header / transport controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-indigo-800">공구 순서</span>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[9px] text-indigo-700">
            {sequence.length} step · 총 {totalSec}s
          </span>
          {activeIndex >= 0 && activeStep && (
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${stepPalette(activeStep).chip}`}>
              활성: {activeStep.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePlay}
            disabled={isRunning}
            className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="실행"
          >
            ▶ 실행
          </button>
          <button
            type="button"
            onClick={handlePause}
            disabled={!isRunning}
            className="rounded-full border border-amber-200 bg-white px-2.5 py-1 font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="일시정지"
          >
            ⏸ 일시정지
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!isRunning && activeIndex < 0}
            className="rounded-full border border-rose-200 bg-white px-2.5 py-1 font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="중지"
          >
            ⏹ 중지
          </button>
          <button
            type="button"
            onClick={addStep}
            className="ml-1 rounded-full border border-indigo-200 bg-white px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-50"
          >
            + 단계 추가
          </button>
        </div>
      </div>

      {/* Step list */}
      <ol className="space-y-2">
        {sequence.map((step, index) => {
          const palette = stepPalette(step)
          const isActive = index === activeIndex
          const thisProgress = isActive ? progressPct : 0
          return (
            <li
              key={step.id}
              className={`rounded-md border ${palette.border} ${palette.bg} p-2 ${isActive ? "ring-2 ring-offset-1 ring-indigo-400" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-semibold ${palette.chip}`}>
                    #{index + 1}
                  </span>
                  <input
                    type="text"
                    value={step.label}
                    onChange={e => updateStep(index, { label: e.target.value })}
                    className={`w-32 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold ${palette.text} focus:outline-none focus:ring-1 focus:ring-indigo-400`}
                    aria-label={`step ${index + 1} label`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="위로 이동"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === sequence.length - 1}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="아래로 이동"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    disabled={sequence.length <= 1}
                    className="rounded border border-rose-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="삭제"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Dia (mm)</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={step.diameter}
                    onChange={e => updateStep(index, { diameter: parseFloat(e.target.value) || 0 })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Flutes</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    step={1}
                    value={step.flutes}
                    onChange={e => updateStep(index, { flutes: parseInt(e.target.value, 10) || 1 })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">ap (mm)</span>
                  <input
                    type="number"
                    min={0.01}
                    step={0.05}
                    value={step.ap}
                    onChange={e => updateStep(index, { ap: parseFloat(e.target.value) || 0 })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">fz (mm/t)</span>
                  <input
                    type="number"
                    min={0.001}
                    step={0.005}
                    value={step.fz}
                    onChange={e => updateStep(index, { fz: parseFloat(e.target.value) || 0 })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Pattern</span>
                  <select
                    value={step.pattern}
                    onChange={e => updateStep(index, { pattern: e.target.value as "zigzag" | "spiral" })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="zigzag">zigzag</option>
                    <option value="spiral">spiral</option>
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">Duration (s)</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={step.durationSec}
                    onChange={e => updateStep(index, { durationSec: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </label>
              </div>

              {/* Per-step progress bar — only animates on the active step */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full ${palette.bar} transition-[width] duration-100 ease-linear`}
                  style={{ width: `${thisProgress}%` }}
                  aria-label={`${step.label} progress`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(thisProgress)}
                />
              </div>
              {isActive && (
                <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-500">
                  <span>{(elapsedMs / 1000).toFixed(1)}s</span>
                  <span>/ {step.durationSec}s</span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export const ToolSequencePanel = memo(ToolSequencePanelImpl)
export default ToolSequencePanel
