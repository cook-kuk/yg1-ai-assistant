"use client"

/**
 * <CompareView> — split-screen A/B canvas comparator for the v2 cutting simulator.
 *
 * Renders two arbitrary React nodes (typically `<Cutting3DScene>` instances
 * configured with different parameter sets) side-by-side on sm+ screens and
 * stacked on mobile. Each side has a label header and an optional metric
 * strip passed through as children. Purely presentational — parameter state
 * and scene wiring live in the parent simulator.
 *
 * Camera sync: NOT implemented in this iteration. Each `<Cutting3DScene>`
 * owns its own `<OrbitControls>` and `<PerspectiveCamera>` internally with
 * no `onCameraChange` prop exposed, so there is no hook to mirror camera
 * pose without intrusive refactors to that component. Marked as a future
 * feature — the `syncCamera` prop is accepted but currently a no-op and a
 * small "⏳ 카메라 동기화: 곧 지원" hint renders when `syncCamera === true`.
 */

import * as React from "react"

export interface CompareViewProps {
  /** Label rendered atop the left pane (e.g., "A: TitaNox 10mm 4날"). */
  leftLabel: string
  /** Label rendered atop the right pane (e.g., "B: ALU-POWER 10mm 3날"). */
  rightLabel: string
  /** React node for the left canvas — typically a `<Cutting3DScene …>`. */
  leftCanvas: React.ReactNode
  /** React node for the right canvas — parameter set B. */
  rightCanvas: React.ReactNode
  /** Optional metric strip rendered below the left canvas. */
  leftMetrics?: React.ReactNode
  /** Optional metric strip rendered below the right canvas. */
  rightMetrics?: React.ReactNode
  /**
   * If true, a small hint advertises camera-sync as a future feature.
   * Currently a no-op — each `<Cutting3DScene>` owns its own OrbitControls
   * and the component does not expose a camera-change callback.
   * Default: true.
   */
  syncCamera?: boolean
  /** Optional className passthrough on the outermost wrapper. */
  className?: string
}

function Pane(props: {
  label: string
  accent: "sky" | "amber"
  canvas: React.ReactNode
  metrics?: React.ReactNode
}) {
  const { label, accent, canvas, metrics } = props
  // Tailwind v3 JIT safelist-friendly explicit color pairings.
  const ring = accent === "sky" ? "ring-sky-300" : "ring-amber-300"
  const badgeBg = accent === "sky" ? "bg-sky-100 text-sky-800 border-sky-200" : "bg-amber-100 text-amber-800 border-amber-200"
  return (
    <div data-testid={`compare-pane-${accent}`} className={`flex min-w-0 flex-1 flex-col gap-2 rounded-xl bg-white/70 p-2 ring-1 ${ring}`}>
      <div className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeBg}`}>
        <span>{label}</span>
      </div>
      <div className="relative min-h-[280px] w-full overflow-hidden rounded-lg bg-slate-50">
        {canvas}
      </div>
      {metrics && (
        <div className="rounded-lg border border-slate-200 bg-white/80 px-2 py-1 text-[11px] text-slate-700">
          {metrics}
        </div>
      )}
    </div>
  )
}

export function CompareView(props: CompareViewProps) {
  const {
    leftLabel,
    rightLabel,
    leftCanvas,
    rightCanvas,
    leftMetrics,
    rightMetrics,
    syncCamera = true,
    className,
  } = props

  return (
    <div data-testid="compare-view" className={`w-full ${className ?? ""}`}>
      {syncCamera && (
        <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
          ⏳ 카메라 동기화 — 향후 지원 예정 (각 씬 OrbitControls 독립 제어).
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <Pane label={leftLabel} accent="sky" canvas={leftCanvas} metrics={leftMetrics} />
        <div
          aria-hidden
          className="hidden w-px shrink-0 self-stretch bg-gradient-to-b from-transparent via-slate-300 to-transparent sm:block"
        />
        <Pane label={rightLabel} accent="amber" canvas={rightCanvas} metrics={rightMetrics} />
      </div>
    </div>
  )
}

export default CompareView
