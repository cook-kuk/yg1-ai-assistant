"use client"

// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Cost Waterfall Chart
// 부품 1개당 가공 원가를 waterfall 로 분해: 소재·공구·장비·인건·간접 + 총원가.
// recharts 2.15.4 floating-bar pattern (dataKey=[start,end]).
// IMPORTANT: cutting-simulator-v2.tsx 는 절대 수정하지 않는다.

import * as React from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import HolographicFrame from "./holographic-frame"
import FeatureExplainer from "./feature-explainer"
import { AnimatedNumber } from "./animated-number"
import { LiveIndicator } from "./live-indicator"

export interface CostWaterfallChartProps {
  toolCostKrw: number
  machineCostPerHourKrw: number
  laborCostPerHourKrw: number
  cycleTimeMin: number
  partsPerTool: number
  materialCostKrw: number
  overheadPct?: number
  darkMode?: boolean
}

interface Segment {
  key: "material" | "tool" | "machine" | "labor" | "overhead" | "total"
  label: string
  value: number
  range: [number, number]
  color: string
  isTotal: boolean
}

const COLORS = {
  material: "#38bdf8", // sky-400
  tool: "#f97316",     // orange-500
  machine: "#8b5cf6",  // violet-500
  labor: "#f43f5e",    // rose-500
  overhead: "#64748b", // slate-500
  total: "#059669",    // emerald-600
} as const

const fmtKrw = (n: number): string =>
  Number.isFinite(n) ? `₩${Math.round(n).toLocaleString("ko-KR")}` : "₩-"

function WaterfallTooltip({
  active, payload, darkMode, total,
}: {
  active?: boolean
  payload?: { payload?: Segment }[]
  darkMode?: boolean
  total: number
}) {
  if (!active || !payload?.length) return null
  const seg = payload[0]?.payload
  if (!seg) return null
  const bg = darkMode ? "#0f172a" : "#ffffff"
  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const border = darkMode ? "#334155" : "#e2e8f0"
  const subFg = darkMode ? "#94a3b8" : "#64748b"
  const pct = total > 0 ? (seg.value / total) * 100 : 0
  return (
    <div style={{
      background: bg, color: fg, border: `1px solid ${border}`, borderRadius: 8,
      padding: "10px 12px", fontSize: 12, minWidth: 180,
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 4 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, display: "inline-block" }} />
        {seg.label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: seg.color }}>{fmtKrw(seg.value)}</div>
      <div style={{ fontSize: 10, color: subFg, marginTop: 4 }}>
        {seg.isTotal ? "부품 1개당 총원가" : `총원가 대비 ${pct.toFixed(1)}%`}
      </div>
    </div>
  )
}

export default function CostWaterfallChart({
  toolCostKrw,
  machineCostPerHourKrw,
  laborCostPerHourKrw,
  cycleTimeMin,
  partsPerTool,
  materialCostKrw,
  overheadPct = 0.15,
  darkMode = false,
}: CostWaterfallChartProps): React.ReactElement {
  const { segments, total, dominant } = React.useMemo(() => {
    const cyc = Math.max(cycleTimeMin, 0)
    const ppt = Math.max(partsPerTool, 0.0001)
    const material = Math.max(0, materialCostKrw)
    const tool = Math.max(0, toolCostKrw / ppt)
    const machine = Math.max(0, (machineCostPerHourKrw / 60) * cyc)
    const labor = Math.max(0, (laborCostPerHourKrw / 60) * cyc)
    const subtotal = material + tool + machine + labor
    const overhead = Math.max(0, subtotal * Math.max(0, overheadPct))
    const grand = subtotal + overhead

    let cursor = 0
    const mk = (key: Segment["key"], label: string, value: number, color: string): Segment => {
      const start = cursor
      const end = cursor + value
      cursor = end
      return { key, label, value: Math.round(value), range: [Math.round(start), Math.round(end)], color, isTotal: false }
    }
    const segs: Segment[] = [
      mk("material", "소재비", material, COLORS.material),
      mk("tool", "공구비/부품", tool, COLORS.tool),
      mk("machine", "장비비", machine, COLORS.machine),
      mk("labor", "인건비", labor, COLORS.labor),
      mk("overhead", "간접비", overhead, COLORS.overhead),
      {
        key: "total", label: "총원가", value: Math.round(grand),
        range: [0, Math.round(grand)], color: COLORS.total, isTotal: true,
      },
    ]
    let dom: Segment | null = null
    if (grand > 0) {
      for (const s of segs) {
        if (s.isTotal) continue
        if (s.value / grand > 0.4 && (!dom || s.value > dom.value)) dom = s
      }
    }
    return { segments: segs, total: Math.round(grand), dominant: dom }
  }, [materialCostKrw, toolCostKrw, partsPerTool, machineCostPerHourKrw, laborCostPerHourKrw, cycleTimeMin, overheadPct])

  const bg = darkMode ? "#0b1220" : "#ffffff"
  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const subFg = darkMode ? "#94a3b8" : "#475569"
  const gridStroke = darkMode ? "#1e293b" : "#e2e8f0"
  const axisStroke = darkMode ? "#94a3b8" : "#64748b"

  return (
    <HolographicFrame accent="amber" darkMode={darkMode}>
      <div style={{ color: fg, padding: 16, minWidth: 0 }}>
        {/* Header: title + LIVE + explainer + big total */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 12, marginBottom: 12, flexWrap: "wrap",
        }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          }}>
            <span aria-hidden>💧</span> Cost Waterfall · 부품 1개 원가 분해
            <LiveIndicator
              watch={[toolCostKrw, machineCostPerHourKrw, laborCostPerHourKrw, cycleTimeMin, partsPerTool, materialCostKrw, overheadPct]}
              color="amber"
              darkMode={darkMode}
            />
            <FeatureExplainer featureId="break-even" inline darkMode={darkMode} />
          </h3>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: subFg, fontWeight: 600 }}>
              총원가 / 부품
            </div>
            <div
              style={{ fontSize: 26, fontWeight: 800, color: COLORS.total, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}
              title={fmtKrw(total)}
            >
              <AnimatedNumber value={total} decimals={0} format={(n) => fmtKrw(n)} />
            </div>
            <div style={{ fontSize: 10, color: subFg, opacity: 0.75 }}>
              간접비 {(overheadPct * 100).toFixed(0)}% 포함
            </div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ background: bg, borderRadius: 8, padding: 8 }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={segments} margin={{ top: 10, right: 16, left: 8, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="label" stroke={axisStroke} tick={{ fill: axisStroke, fontSize: 11 }} interval={0} />
              <YAxis
                stroke={axisStroke}
                tick={{ fill: axisStroke, fontSize: 11 }}
                tickFormatter={(v: number) => `₩${Math.round(v).toLocaleString("ko-KR")}`}
              />
              <Tooltip
                cursor={{ fill: darkMode ? "rgba(148,163,184,0.08)" : "rgba(15,23,42,0.05)" }}
                content={<WaterfallTooltip darkMode={darkMode} total={total} />}
              />
              <Bar dataKey="range" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                {segments.map((s) => (
                  <Cell
                    key={s.key}
                    fill={s.color}
                    fillOpacity={s.isTotal ? 0.95 : 0.85}
                    stroke={s.color}
                    strokeWidth={s.isTotal ? 2 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend + values */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, fontSize: 11, color: subFg }}>
          {segments.filter((s) => !s.isTotal).map((s) => (
            <div key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: s.color }} />
              <span style={{ color: fg, fontWeight: 600 }}>{s.label}</span>
              <span>{fmtKrw(s.value)}</span>
            </div>
          ))}
        </div>

        {/* Dominant (>40%) callout — 절감 잠재량 hint */}
        {dominant && (
          <div role="note" style={{
            marginTop: 12, padding: "8px 10px",
            border: `1px solid ${darkMode ? "#be123c" : "#fecdd3"}`,
            background: darkMode ? "rgba(190,18,60,0.12)" : "#fff1f2",
            color: darkMode ? "#fda4af" : "#9f1239",
            borderRadius: 8, fontSize: 12, lineHeight: 1.5,
            wordBreak: "keep-all", overflowWrap: "break-word",
          }}>
            <strong>{dominant.label}</strong>이(가) 총원가의{" "}
            <strong>{((dominant.value / Math.max(total, 1)) * 100).toFixed(0)}%</strong>를 차지합니다 ·{" "}
            <strong>₩절감 잠재량</strong> 이 가장 큰 구간 → 우선 최적화 후보
          </div>
        )}

        {/* Bottom input summary */}
        <div style={{
          marginTop: 10, fontSize: 11, color: subFg, lineHeight: 1.5,
          wordBreak: "keep-all", overflowWrap: "break-word",
        }}>
          사이클 {cycleTimeMin.toFixed(2)} min · 공구 수명당 {Math.round(partsPerTool)} 개 · 장비 ₩
          {Math.round(machineCostPerHourKrw).toLocaleString("ko-KR")}/h · 인건비 ₩
          {Math.round(laborCostPerHourKrw).toLocaleString("ko-KR")}/h
        </div>
      </div>
    </HolographicFrame>
  )
}

export { CostWaterfallChart }
