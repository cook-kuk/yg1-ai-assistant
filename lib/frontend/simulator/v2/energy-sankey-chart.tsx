"use client"

// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Energy Sankey Chart
// 전력 입력 → 모터/스핀들 효율 손실 → 순수 절삭 동력 → 칩·공구·피삭재·표면 에너지
// 분배를 recharts Sankey 로 시각화. 친환경·ESG 내러티브 패널.
// IMPORTANT: cutting-simulator-v2.tsx 는 절대 수정하지 않는다. 본 파일은 v3 sidecar 전용.

import * as React from "react"
import { Sankey, Tooltip, Layer, Rectangle, ResponsiveContainer } from "recharts"
import HolographicFrame from "./holographic-frame"
import { AnimatedNumber } from "./animated-number"
import { LiveIndicator } from "./live-indicator"

export interface EnergySankeyChartProps {
  /** 절삭 동력 (계산된 spindle 순수 절삭 power) — kW */
  PcKw: number
  /** 스핀들 기계 효율 (0..1) — default 0.85 */
  spindleEfficiency?: number
  /** 모터 전기 효율 (0..1) — default 0.92 */
  motorEfficiency?: number
  /** 다크 모드 */
  darkMode?: boolean
}

// ── Palette (9 nodes) ────────────────────────────────────────────────
const NODE_COLORS: readonly string[] = [
  "#475569", // 0 전력 입력      slate-600
  "#ef4444", // 1 모터 손실       red-500
  "#0ea5e9", // 2 스핀들 입력     sky-500
  "#f97316", // 3 스핀들 손실     orange-500
  "#10b981", // 4 절삭 동력       emerald-500
  "#fb7185", // 5 칩 열           rose-400
  "#f59e0b", // 6 공구 열         amber-500
  "#e879f9", // 7 피삭재 열       fuchsia-400
  "#6366f1", // 8 표면 에너지     indigo-500
] as const

const NODE_NAMES: readonly string[] = [
  "전력 입력", "모터 손실 (열)", "스핀들 입력", "스핀들 손실 (열)", "절삭 동력",
  "칩 열 (70%)", "공구 열 (18%)", "피삭재 열 (10%)", "표면 에너지 (2%)",
] as const

// 열 분배 비율 (절삭 동력 기준)
const CHIP_FRAC = 0.70
const TOOL_FRAC = 0.18
const WORKPIECE_FRAC = 0.10
const SURFACE_FRAC = 0.02
const LED_BULB_WATTS = 10 // 10 W LED 전구 (환경 비유용)

const fmtKw = (n: number): string =>
  Number.isFinite(n) ? `${n.toFixed(2)} kW` : "- kW"

// ── Custom Node renderer ─────────────────────────────────────────────
interface NodeProps {
  x: number; y: number; width: number; height: number; index: number
  payload: { name: string; value: number }
  containerWidth: number
  darkMode: boolean
}
function SankeyNodeShape(p: NodeProps): React.ReactElement {
  const color = NODE_COLORS[p.index] ?? "#64748b"
  const isRight = p.x + p.width + 6 > p.containerWidth - 160
  const lx = isRight ? p.x - 8 : p.x + p.width + 8
  const anchor: "start" | "end" = isRight ? "end" : "start"
  const textFill = p.darkMode ? "#e2e8f0" : "#0f172a"
  const subFill = p.darkMode ? "#94a3b8" : "#475569"
  return (
    <Layer key={`node-${p.index}`}>
      <Rectangle
        x={p.x} y={p.y} width={p.width} height={p.height}
        fill={color} fillOpacity={0.9} stroke={color} strokeOpacity={1}
      />
      <text x={lx} y={p.y + p.height / 2 - 4} textAnchor={anchor}
        fontSize={11} fontWeight={700} fill={textFill}>{p.payload.name}</text>
      <text x={lx} y={p.y + p.height / 2 + 10} textAnchor={anchor}
        fontSize={10} fontWeight={600} fill={subFill}>{fmtKw(p.payload.value)}</text>
    </Layer>
  )
}

// ── Custom Link renderer (stroke = source node color, low opacity) ───
interface LinkProps {
  sourceX: number; targetX: number; sourceY: number; targetY: number
  sourceControlX: number; targetControlX: number
  linkWidth: number; index: number
  payload: { source: { index: number }; target: { index: number }; value: number }
}
function SankeyLinkShape(p: LinkProps): React.ReactElement {
  const color = NODE_COLORS[p.payload.source.index] ?? "#64748b"
  const d = `M${p.sourceX},${p.sourceY}C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`
  return (
    <Layer key={`link-${p.index}`}>
      <path d={d} stroke={color} strokeWidth={Math.max(1, p.linkWidth)}
        strokeOpacity={0.28} fill="none" />
    </Layer>
  )
}

// ── Custom Tooltip ───────────────────────────────────────────────────
interface TipPayload {
  payload?: {
    name?: string; value?: number
    source?: { name?: string; index?: number }
    target?: { name?: string; index?: number }
  }
}
function SankeyTooltip({
  active, payload, darkMode,
}: { active?: boolean; payload?: TipPayload[]; darkMode?: boolean }): React.ReactElement | null {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  if (!p) return null
  const bg = darkMode ? "#0f172a" : "#ffffff"
  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const subFg = darkMode ? "#94a3b8" : "#64748b"
  const border = darkMode ? "#334155" : "#e2e8f0"
  const isLink = p.source !== undefined && p.target !== undefined
  const title = isLink
    ? `${p.source?.name ?? "?"} → ${p.target?.name ?? "?"}`
    : p.name ?? "?"
  const value = typeof p.value === "number" ? p.value : 0
  return (
    <div style={{
      background: bg, color: fg, border: `1px solid ${border}`, borderRadius: 8,
      padding: "10px 12px", fontSize: 12, minWidth: 180,
      boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{fmtKw(value)}</div>
      <div style={{ fontSize: 10, color: subFg, marginTop: 4 }}>
        {isLink ? "에너지 흐름" : "노드 합계"}
      </div>
    </div>
  )
}

// ── Summary card ─────────────────────────────────────────────────────
function StatCard({
  label, value, decimals, suffix, valueColor, hint, cardBg, cardBorder, subFg,
}: {
  label: string; value: number; decimals: number; suffix: string
  valueColor: string; hint: string
  cardBg: string; cardBorder: string; subFg: string
}): React.ReactElement {
  return (
    <div style={{
      background: cardBg, border: `1px solid ${cardBorder}`,
      borderRadius: 10, padding: "10px 12px",
    }}>
      <div style={{
        fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
        color: subFg, fontWeight: 700,
      }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: valueColor }}>
        <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />
      </div>
      <div style={{ fontSize: 10, color: subFg, marginTop: 2 }}>{hint}</div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────
export default function EnergySankeyChart({
  PcKw, spindleEfficiency = 0.85, motorEfficiency = 0.92, darkMode = false,
}: EnergySankeyChartProps): React.ReactElement {
  const etaSp = Math.min(0.999, Math.max(0.01, spindleEfficiency))
  const etaMt = Math.min(0.999, Math.max(0.01, motorEfficiency))

  const c = React.useMemo(() => {
    const total = PcKw > 0 ? PcKw / (etaSp * etaMt) : 0
    const motorLoss = total * (1 - etaMt)
    const spindleInput = total - motorLoss
    const spindleLoss = spindleInput * (1 - etaSp)
    const cutPower = Math.max(0, spindleInput - spindleLoss)
    return {
      total, motorLoss, spindleInput, spindleLoss, cutPower,
      chip: cutPower * CHIP_FRAC,
      tool: cutPower * TOOL_FRAC,
      wp: cutPower * WORKPIECE_FRAC,
      surf: cutPower * SURFACE_FRAC,
      utilization: total > 0 ? (PcKw / total) * 100 : 0,
      ledBulbs: total > 0 ? (total * 1000) / LED_BULB_WATTS : 0,
    }
  }, [PcKw, etaSp, etaMt])

  const fg = darkMode ? "#f1f5f9" : "#0f172a"
  const subFg = darkMode ? "#94a3b8" : "#475569"
  const cardBg = darkMode ? "#111827" : "#f8fafc"
  const cardBorder = darkMode ? "#1f2937" : "#e2e8f0"

  // Edge case — PcKw <= 0
  if (!(PcKw > 0) || !Number.isFinite(PcKw)) {
    return (
      <HolographicFrame accent="indigo" darkMode={darkMode}>
        <div style={{ color: fg, padding: 16, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            flexWrap: "wrap",
          }}>
            <h3 style={{
              margin: 0, fontSize: 15, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span aria-hidden>⚡</span> 에너지 분배 Sankey
            </h3>
            <LiveIndicator watch={[PcKw, etaSp, etaMt]} color="amber" darkMode={darkMode} />
          </div>
          <div style={{
            background: cardBg, border: `1px dashed ${cardBorder}`,
            borderRadius: 12, padding: 24, textAlign: "center",
            color: subFg, fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden>🔋</div>
            <div style={{ fontWeight: 700, color: fg, marginBottom: 6 }}>
              Pc &gt; 0 일 때 에너지 분배 시각화됩니다
            </div>
            <div style={{ fontSize: 11, color: subFg }}>
              전력 입력 = Pc / (η<sub>motor</sub> × η<sub>spindle</sub>)
              <br />
              절삭 동력 Pc 를 입력하면 모터/스핀들 손실, 칩·공구·피삭재 열 분배까지 9-node Sankey 로 분해합니다.
            </div>
          </div>
        </div>
      </HolographicFrame>
    )
  }

  const sankeyData = {
    nodes: NODE_NAMES.map((name) => ({ name })),
    links: [
      { source: 0, target: 1, value: c.motorLoss },
      { source: 0, target: 2, value: c.spindleInput },
      { source: 2, target: 3, value: c.spindleLoss },
      { source: 2, target: 4, value: c.cutPower },
      { source: 4, target: 5, value: c.chip },
      { source: 4, target: 6, value: c.tool },
      { source: 4, target: 7, value: c.wp },
      { source: 4, target: 8, value: c.surf },
    ],
  }

  return (
    <HolographicFrame accent="indigo" darkMode={darkMode}>
      <div style={{ color: fg, padding: 16, minWidth: 0 }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 12, marginBottom: 12, flexWrap: "wrap",
        }}>
          <h3 style={{
            margin: 0, fontSize: 15, fontWeight: 700,
            display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          }}>
            <span aria-hidden>⚡</span> 에너지 분배 Sankey
            <LiveIndicator watch={[PcKw, etaSp, etaMt]} color="amber" darkMode={darkMode} />
          </h3>
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 0,
          }}>
            <div style={{
              fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
              color: subFg, fontWeight: 600,
            }}>전력 입력 (Total)</div>
            <AnimatedNumber value={c.total} decimals={2} suffix=" kW"
              className="text-xl font-bold" />
          </div>
        </div>

        {/* Sankey canvas */}
        <div style={{ width: "100%", height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sankeyData}
              nodePadding={28}
              nodeWidth={12}
              linkCurvature={0.5}
              iterations={64}
              margin={{ top: 12, right: 160, bottom: 12, left: 12 }}
              node={(np: unknown) => {
                const n = np as Omit<NodeProps, "darkMode">
                return <SankeyNodeShape {...n} darkMode={darkMode} />
              }}
              link={(lp: unknown) => <SankeyLinkShape {...(lp as LinkProps)} />}
            >
              <Tooltip
                content={<SankeyTooltip darkMode={darkMode} />}
                wrapperStyle={{ outline: "none" }}
              />
            </Sankey>
          </ResponsiveContainer>
        </div>

        {/* Bottom summary strip */}
        <div style={{
          marginTop: 12, display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8,
        }}>
          <StatCard label="순이용률 (Net Utilization)" value={c.utilization} decimals={1}
            suffix=" %" valueColor="#10b981" hint="Pc / Total × 100"
            cardBg={cardBg} cardBorder={cardBorder} subFg={subFg} />
          <StatCard label="환경 비유" value={c.ledBulbs} decimals={0}
            suffix=" 개" valueColor="#6366f1" hint="10W LED 전구 동시 점등 수"
            cardBg={cardBg} cardBorder={cardBorder} subFg={subFg} />
          <StatCard label="총 손실 (열)" value={c.motorLoss + c.spindleLoss}
            decimals={2} suffix=" kW" valueColor="#ef4444"
            hint="모터 + 스핀들 효율 손실 합"
            cardBg={cardBg} cardBorder={cardBorder} subFg={subFg} />
        </div>

        {/* Legend hint */}
        <div style={{
          marginTop: 10, fontSize: 10, color: subFg, textAlign: "right",
        }}>
          η<sub>motor</sub> = {(etaMt * 100).toFixed(0)}% · η<sub>spindle</sub> = {(etaSp * 100).toFixed(0)}% ·
          열 분배: 칩 {(CHIP_FRAC * 100).toFixed(0)}% / 공구 {(TOOL_FRAC * 100).toFixed(0)}%
          / 피삭재 {(WORKPIECE_FRAC * 100).toFixed(0)}% / 표면 {(SURFACE_FRAC * 100).toFixed(0)}%
        </div>
      </div>
    </HolographicFrame>
  )
}

export { EnergySankeyChart }
