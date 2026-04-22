"use client"

import { useMemo, useState } from "react"
import { Sparkles, GitBranch, BarChart3, Loader2 } from "lucide-react"
import { InfoToggle } from "../../shared/info-toggle"
import { SectionShell } from "../section-shell"
import { FEATURE_EXPLANATIONS } from "../data/feature-explanations"
import { mockShapValues, type ShapData } from "../data/mock-data-engine"

interface CausalXaiPanelProps {
  prediction: number
  sandvikPrediction: number
  toolCode: string
  materialKey: string
  onAskAI?: (q: string) => void
}

export function CausalXaiPanel(props: CausalXaiPanelProps) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [explanation, setExplanation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [hasStarted, setHasStarted] = useState(false)

  const shapData = useMemo(
    () =>
      mockShapValues({
        prediction: props.prediction,
        sandvikPrediction: props.sandvikPrediction,
        toolCode: props.toolCode,
      }),
    [props.prediction, props.sandvikPrediction, props.toolCode],
  )

  async function requestExplanation() {
    setHasStarted(true)
    setIsStreaming(true)
    setExplanation("")
    setError(null)

    try {
      const res = await fetch("/api/xai/causal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prediction: props.prediction,
          sandvikPrediction: props.sandvikPrediction,
          shapValues: shapData,
          context: { toolCode: props.toolCode, materialKey: props.materialKey },
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      // SSE parsing: split by \n, keep `data: ` prefixed lines, JSON.parse after slice(6),
      // accumulate `text` fields into state. [DONE] sentinel closes the stream.
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (!payload) continue
          if (payload === "[DONE]") {
            setIsStreaming(false)
            return
          }
          try {
            const data = JSON.parse(payload) as { text?: string; error?: string }
            if (data.error) {
              setError(data.error)
              continue
            }
            if (typeof data.text === "string") {
              setExplanation(prev => prev + data.text)
            }
          } catch {
            // Ignore malformed SSE frames
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류")
    } finally {
      setIsStreaming(false)
    }
  }

  return (
    <SectionShell
      id="causal-xai-panel"
      title="인과추론 & xAI 설명"
      subtitle="SHAP + 인과 그래프 + 실제 LLM 자연어 설명"
      infoId="causal-xai"
      phase="Phase 3 · 2028 Q2"
      specialNote="🤖 이 섹션의 자연어 설명은 실제 LLM이 생성합니다"
      onAskAI={props.onAskAI}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ShapWaterfall data={shapData} onAskAI={props.onAskAI} />
        <CausalGraph data={shapData} onAskAI={props.onAskAI} />
      </div>

      {/* LLM explanation box */}
      <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/60 bg-white dark:bg-slate-900/50">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/70 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <Sparkles className="w-4 h-4" />
            AI 인과 분석
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500 text-white">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            REAL LLM
          </span>
        </div>

        <div className="p-4">
          {!hasStarted && (
            <button
              type="button"
              onClick={requestExplanation}
              className="w-full py-8 rounded-lg border-2 border-dashed border-emerald-400 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors flex flex-col items-center gap-2"
            >
              <Sparkles className="w-7 h-7 text-emerald-500" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                🤖 AI에게 인과 분석 요청하기
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                SHAP + 인과 그래프를 바탕으로 자연어 설명을 생성합니다
              </span>
            </button>
          )}

          {hasStarted && (
            <div className="space-y-3">
              {explanation.split("\n").map((para, i) => {
                if (!para.trim()) return null
                return (
                  <p
                    key={i}
                    className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap"
                  >
                    {para}
                  </p>
                )
              })}
              {isStreaming && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span className="inline-block w-2 h-4 bg-emerald-500 animate-pulse" />
                  생성 중…
                </div>
              )}
              {error && (
                <div className="text-xs text-rose-600 dark:text-rose-400 px-3 py-2 rounded border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-950/30">
                  오류: {error}
                </div>
              )}
              {!isStreaming && !error && explanation && (
                <button
                  type="button"
                  onClick={requestExplanation}
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  ↻ 다시 생성
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  )
}

// ─────────────────────────────────────────────
// SHAP waterfall chart
// ─────────────────────────────────────────────

function ShapWaterfall({
  data,
  onAskAI,
}: {
  data: ShapData
  onAskAI?: (q: string) => void
}) {
  const W = 460
  const ROW_H = 26
  const PAD_L = 110
  const PAD_R = 60
  const PAD_T = 30
  const PAD_B = 30
  const rows = data.contributions.length + 2 // baseline + features + final
  const H = PAD_T + PAD_B + rows * ROW_H

  // Running total to compute bar positions
  let running = data.baseline
  const bars: Array<{ label: string; from: number; to: number; value: number; isTotal?: boolean }> = []
  bars.push({
    label: "Baseline",
    from: 0,
    to: data.baseline,
    value: data.baseline,
    isTotal: true,
  })
  for (const c of data.contributions) {
    const from = running
    const to = running + c.value
    bars.push({ label: c.feature, from, to, value: c.value })
    running = to
  }
  bars.push({
    label: "Final",
    from: 0,
    to: data.finalPrediction,
    value: data.finalPrediction,
    isTotal: true,
  })

  const allValues = bars.flatMap(b => [b.from, b.to])
  const vMin = Math.min(0, ...allValues)
  const vMax = Math.max(...allValues)
  const range = vMax - vMin || 1
  const scaleX = (v: number) => PAD_L + ((v - vMin) / range) * (W - PAD_L - PAD_R)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <BarChart3 className="w-4 h-4 text-teal-500" />
          SHAP Waterfall
        </div>
        <InfoToggle
          id="shap-values"
          content={FEATURE_EXPLANATIONS["shap-values"]}
          onAskAI={onAskAI}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Zero axis */}
        <line
          x1={scaleX(0)}
          y1={PAD_T - 6}
          x2={scaleX(0)}
          y2={H - PAD_B + 6}
          stroke="currentColor"
          strokeDasharray="2 2"
          className="text-slate-300 dark:text-slate-700"
        />

        {bars.map((b, i) => {
          const y = PAD_T + i * ROW_H
          const x1 = scaleX(Math.min(b.from, b.to))
          const x2 = scaleX(Math.max(b.from, b.to))
          const width = Math.max(2, x2 - x1)
          const isNeg = b.value < 0
          const totalCls = b.isTotal
            ? "fill-slate-500 dark:fill-slate-400"
            : isNeg
            ? "fill-rose-500"
            : "fill-emerald-500"
          return (
            <g key={i}>
              <text
                x={PAD_L - 6}
                y={y + ROW_H / 2 + 3}
                textAnchor="end"
                className="fill-slate-600 dark:fill-slate-300 text-[10px] font-mono"
              >
                {b.label}
              </text>
              <rect
                x={x1}
                y={y + 4}
                width={width}
                height={ROW_H - 10}
                rx={2}
                className={totalCls}
              />
              <text
                x={x2 + 4}
                y={y + ROW_H / 2 + 3}
                className={`text-[10px] font-mono ${
                  b.isTotal
                    ? "fill-slate-700 dark:fill-slate-200 font-bold"
                    : isNeg
                    ? "fill-rose-600 dark:fill-rose-400"
                    : "fill-emerald-600 dark:fill-emerald-400"
                }`}
              >
                {b.isTotal
                  ? `${b.value.toFixed(1)}`
                  : `${b.value > 0 ? "+" : ""}${b.value.toFixed(2)}`}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span>
          Baseline <span className="font-bold">{data.baseline.toFixed(1)}</span>
        </span>
        <span>→</span>
        <span>
          Final{" "}
          <span className="font-bold text-slate-700 dark:text-slate-200">
            {data.finalPrediction.toFixed(1)}
          </span>
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Causal graph (3-column node layout)
// ─────────────────────────────────────────────

function CausalGraph({
  data,
  onAskAI,
}: {
  data: ShapData
  onAskAI?: (q: string) => void
}) {
  const W = 460
  const H = 280
  const cols: Record<"input" | "mediator" | "output", number> = {
    input: 60,
    mediator: W / 2,
    output: W - 60,
  }

  // Group nodes by category and assign vertical positions
  const grouped: Record<string, typeof data.graphNodes> = {
    input: [],
    mediator: [],
    output: [],
  }
  for (const n of data.graphNodes) grouped[n.category].push(n)

  const positions = new Map<string, { x: number; y: number }>()
  for (const cat of ["input", "mediator", "output"] as const) {
    const nodes = grouped[cat]
    const gap = (H - 40) / Math.max(1, nodes.length)
    nodes.forEach((n, i) => {
      positions.set(n.id, {
        x: cols[cat],
        y: 20 + gap * i + gap / 2,
      })
    })
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          <GitBranch className="w-4 h-4 text-purple-500" />
          인과 그래프 (Causal DAG)
        </div>
        <InfoToggle
          id="counterfactual-reasoning"
          content={FEATURE_EXPLANATIONS["counterfactual-reasoning"]}
          onAskAI={onAskAI}
        />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Column labels */}
        <text
          x={cols.input}
          y={12}
          textAnchor="middle"
          className="fill-slate-500 text-[10px] font-mono uppercase tracking-wider"
        >
          input
        </text>
        <text
          x={cols.mediator}
          y={12}
          textAnchor="middle"
          className="fill-slate-500 text-[10px] font-mono uppercase tracking-wider"
        >
          mediator
        </text>
        <text
          x={cols.output}
          y={12}
          textAnchor="middle"
          className="fill-slate-500 text-[10px] font-mono uppercase tracking-wider"
        >
          output
        </text>

        {/* Arrow marker */}
        <defs>
          <marker
            id="xai-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-slate-400" />
          </marker>
        </defs>

        {/* Edges */}
        {data.graphEdges.map((e, i) => {
          const from = positions.get(e.from)
          const to = positions.get(e.to)
          if (!from || !to) return null
          return (
            <line
              key={`e-${i}`}
              x1={from.x + 28}
              y1={from.y}
              x2={to.x - 28}
              y2={to.y}
              stroke="currentColor"
              strokeWidth={0.6 + e.strength * 2.4}
              strokeOpacity={0.35 + e.strength * 0.6}
              className="text-slate-500 dark:text-slate-400"
              markerEnd="url(#xai-arrow)"
            />
          )
        })}

        {/* Nodes */}
        {data.graphNodes.map(n => {
          const p = positions.get(n.id)
          if (!p) return null
          const colorCls =
            n.category === "input"
              ? "fill-teal-500/20 stroke-teal-500"
              : n.category === "mediator"
              ? "fill-purple-500/20 stroke-purple-500"
              : "fill-emerald-500/20 stroke-emerald-500"
          return (
            <g key={n.id}>
              <rect
                x={p.x - 32}
                y={p.y - 12}
                width={64}
                height={24}
                rx={6}
                strokeWidth={1.5}
                className={colorCls}
              />
              <text
                x={p.x}
                y={p.y + 4}
                textAnchor="middle"
                className="fill-slate-800 dark:fill-slate-100 text-[11px] font-semibold"
              >
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
