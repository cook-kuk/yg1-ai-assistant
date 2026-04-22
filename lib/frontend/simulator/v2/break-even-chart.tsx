"use client"

import * as React from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts"
import FeatureExplainer from "./feature-explainer"
import { AnimatedNumber } from "./animated-number"
import { LiveIndicator } from "./live-indicator"

/**
 * Break-Even Vc × Cost/부품 chart
 *
 * Taylor tool-life 단순화 모델:
 *   toolLife(Vc) = taylorVcRef * (taylorVcRef / Vc)^(1/n) * 45 [min]
 *   partsPerTool = toolLife / cycleTimeMin
 *   toolCostPerPart = toolCostKrw / partsPerTool
 *   machineCostPerPart = (machineCostPerHourKrw / 60) * cycleTimeMin  (상수)
 *   totalPerPart = toolCost + machineCost
 *
 * 경제점(Economic Vc) = totalPerPart 최저가 되는 Vc.
 */

export interface BreakEvenChartProps {
  /** 현재 세팅된 절삭 속도 (m/min) */
  currentVc: number
  /** 카탈로그 권장 Vc (Taylor 기준점, m/min) */
  taylorVcRef: number
  /** 공구 1개 가격 (원) */
  toolCostKrw: number
  /** 머신 시간당 비용 (원/hour) */
  machineCostPerHourKrw: number
  /** Taylor exponent n (default 0.25 = carbide) */
  taylorN?: number
  /** 1개 부품 사이클 타임 (min) */
  cycleTimeMin: number
  /** 다크모드 */
  darkMode?: boolean
}

interface SamplePoint {
  vc: number
  toolCostPerPart: number
  machineCostPerPart: number
  totalPerPart: number
}

const VC_MIN = 50
const VC_MAX = 400
const SAMPLE_COUNT = 46

function buildSamples(
  taylorVcRef: number,
  toolCostKrw: number,
  machineCostPerHourKrw: number,
  taylorN: number,
  cycleTimeMin: number,
): SamplePoint[] {
  const machineCostPerPart = (machineCostPerHourKrw / 60) * cycleTimeMin
  const step = (VC_MAX - VC_MIN) / (SAMPLE_COUNT - 1)
  const samples: SamplePoint[] = []

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const vc = VC_MIN + step * i
    // toolLife (min)
    const ratio = taylorVcRef / Math.max(vc, 1)
    const toolLife = taylorVcRef * Math.pow(ratio, 1 / Math.max(taylorN, 0.01)) * 45
    const partsPerTool = toolLife / Math.max(cycleTimeMin, 0.01)
    const toolCostPerPart = partsPerTool > 0 ? toolCostKrw / partsPerTool : Number.POSITIVE_INFINITY
    const totalPerPart = toolCostPerPart + machineCostPerPart
    samples.push({
      vc: Math.round(vc * 10) / 10,
      toolCostPerPart: Math.round(toolCostPerPart),
      machineCostPerPart: Math.round(machineCostPerPart),
      totalPerPart: Math.round(totalPerPart),
    })
  }

  return samples
}

function findEconomicPoint(samples: SamplePoint[]): SamplePoint {
  let best = samples[0]
  for (const s of samples) {
    if (Number.isFinite(s.totalPerPart) && s.totalPerPart < best.totalPerPart) {
      best = s
    }
  }
  return best
}

function findNearest(samples: SamplePoint[], vc: number): SamplePoint {
  let best = samples[0]
  let bestDiff = Math.abs(best.vc - vc)
  for (const s of samples) {
    const d = Math.abs(s.vc - vc)
    if (d < bestDiff) {
      best = s
      bestDiff = d
    }
  }
  return best
}

function formatKrw(n: number): string {
  if (!Number.isFinite(n)) return "∞"
  return `₩${Math.round(n).toLocaleString("ko-KR")}`
}

interface TooltipPayloadItem {
  name?: string
  value?: number
  color?: string
  dataKey?: string
}

function CostTooltip({
  active,
  payload,
  label,
  darkMode,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: number | string
  darkMode?: boolean
}) {
  if (!active || !payload || payload.length === 0) return null
  const bg = darkMode ? "#1f2937" : "#ffffff"
  const fg = darkMode ? "#f3f4f6" : "#111827"
  const border = darkMode ? "#374151" : "#e5e7eb"

  const findByKey = (key: string) => payload.find((p) => p.dataKey === key)?.value
  const tool = findByKey("toolCostPerPart")
  const machine = findByKey("machineCostPerPart")
  const total = findByKey("totalPerPart")

  return (
    <div
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: "8px 10px",
        fontSize: 12,
        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Vc = {label} m/min</div>
      <div style={{ color: "#ef4444" }}>공구비/부품 : {formatKrw(tool ?? NaN)}</div>
      <div style={{ color: "#3b82f6" }}>머신비/부품 : {formatKrw(machine ?? NaN)}</div>
      <div style={{ color: "#10b981", fontWeight: 600 }}>총비용/부품 : {formatKrw(total ?? NaN)}</div>
    </div>
  )
}

export default function BreakEvenChart({
  currentVc,
  taylorVcRef,
  toolCostKrw,
  machineCostPerHourKrw,
  taylorN = 0.25,
  cycleTimeMin,
  darkMode = false,
}: BreakEvenChartProps) {
  const samples = React.useMemo(
    () => buildSamples(taylorVcRef, toolCostKrw, machineCostPerHourKrw, taylorN, cycleTimeMin),
    [taylorVcRef, toolCostKrw, machineCostPerHourKrw, taylorN, cycleTimeMin],
  )

  const economic = React.useMemo(() => findEconomicPoint(samples), [samples])
  const currentPoint = React.useMemo(() => findNearest(samples, currentVc), [samples, currentVc])
  const savings = Math.max(0, currentPoint.totalPerPart - economic.totalPerPart)
  // signed savings per part (used for color decision on monthly KPI card)
  const savingsPerPart = currentPoint.totalPerPart - economic.totalPerPart
  // 월 생산 부품 수: (60 / cycleTimeMin) parts/hour × 8h × 22일
  const partsPerMonth = (60 / Math.max(cycleTimeMin, 0.01)) * 8 * 22
  const monthlySavings = Math.round(savingsPerPart * partsPerMonth)

  // Theme tokens
  const bg = darkMode ? "#0f172a" : "#ffffff"
  const cardBorder = darkMode ? "#1f2937" : "#e5e7eb"
  const fg = darkMode ? "#f3f4f6" : "#111827"
  const subFg = darkMode ? "#9ca3af" : "#4b5563"
  const gridStroke = darkMode ? "#334155" : "#e5e7eb"
  const axisStroke = darkMode ? "#94a3b8" : "#6b7280"

  // KPI card tokens
  const kpiCardBg = darkMode ? "#111827" : "#f9fafb"
  const kpiLabelFg = darkMode ? "#9ca3af" : "#6b7280"
  const kpiSubFg = darkMode ? "#9ca3af" : "#6b7280"
  // slate (neutral) — card 1
  const slateBorder = darkMode ? "#334155" : "#cbd5e1"
  const slateFg = darkMode ? "#e2e8f0" : "#0f172a"
  // emerald (best) — card 2
  const emeraldBorder = "#34d399"
  const emeraldFg = darkMode ? "#6ee7b7" : "#059669"
  // monthly savings — color depends on sign
  let moneyBorder: string
  let moneyFg: string
  if (savingsPerPart > 0) {
    moneyBorder = darkMode ? "#3b82f6" : "#93c5fd"
    moneyFg = darkMode ? "#93c5fd" : "#1d4ed8"
  } else if (savingsPerPart < 0) {
    moneyBorder = darkMode ? "#fb7185" : "#fda4af"
    moneyFg = darkMode ? "#fda4af" : "#be123c"
  } else {
    moneyBorder = slateBorder
    moneyFg = slateFg
  }

  return (
    <div
      style={{
        background: bg,
        color: fg,
        border: `1px solid ${cardBorder}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          💰 Break-Even 분석 · Vc × Cost/부품
          <LiveIndicator watch={[currentVc, toolCostKrw, machineCostPerHourKrw]} color="amber" darkMode={darkMode} />
          <FeatureExplainer featureId="break-even" inline darkMode={darkMode} />
        </h3>
        <div style={{ fontSize: 11, color: subFg }}>
          Taylor n = {taylorN} · Ref Vc = {taylorVcRef} m/min
        </div>
      </div>

      {/* KPI summary cards — 3 columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 14,
          alignItems: "stretch",
        }}
      >
        {/* 1) 현재 ₩/부품 — slate (neutral) */}
        <div
          style={{
            background: kpiCardBg,
            border: `1px solid ${slateBorder}`,
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: kpiLabelFg,
              fontWeight: 600,
            }}
          >
            <span aria-hidden>📍</span>
            <span>현재 ₩/부품</span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              color: slateFg,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
            title={formatKrw(currentPoint.totalPerPart)}
          >
            <AnimatedNumber
              value={currentPoint.totalPerPart}
              decimals={0}
              format={(n) => formatKrw(n)}
            />
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: kpiSubFg,
              opacity: 0.7,
            }}
          >
            Vc = {Math.round(currentVc)} m/min
          </div>
        </div>

        {/* 2) 경제점 ₩/부품 — emerald (best), ring highlight */}
        <div
          style={{
            background: kpiCardBg,
            border: `2px solid ${emeraldBorder}`,
            boxShadow: `0 0 0 2px ${darkMode ? "rgba(52,211,153,0.25)" : "rgba(52,211,153,0.35)"}`,
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: kpiLabelFg,
              fontWeight: 600,
            }}
          >
            <span aria-hidden>🎯</span>
            <span>경제점 ₩/부품</span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              color: emeraldFg,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
            title={formatKrw(economic.totalPerPart)}
          >
            <AnimatedNumber
              value={economic.totalPerPart}
              decimals={0}
              format={(n) => formatKrw(n)}
            />
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: kpiSubFg,
              opacity: 0.7,
            }}
          >
            Vc = {economic.vc} m/min · 최저점
          </div>
        </div>

        {/* 3) 월 절감액 — blue / slate / rose 분기 */}
        <div
          style={{
            background: kpiCardBg,
            border: `1px solid ${moneyBorder}`,
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: kpiLabelFg,
              fontWeight: 600,
            }}
          >
            <span aria-hidden>💰</span>
            <span>월 절감액</span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              color: moneyFg,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
            title={`₩${monthlySavings.toLocaleString("ko-KR")}`}
          >
            <AnimatedNumber
              value={monthlySavings}
              decimals={0}
              prefix="₩"
            />
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: kpiSubFg,
              opacity: 0.7,
            }}
          >
            vs 현재 조건 · 월 기준 (8h × 22일)
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={samples} margin={{ top: 10, right: 24, left: 8, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis
            dataKey="vc"
            stroke={axisStroke}
            tick={{ fill: axisStroke, fontSize: 11 }}
            label={{
              value: "Vc (m/min)",
              position: "insideBottom",
              offset: -8,
              fill: subFg,
              fontSize: 11,
            }}
          />
          <YAxis
            stroke={axisStroke}
            tick={{ fill: axisStroke, fontSize: 11 }}
            tickFormatter={(v: number) => `₩${Math.round(v).toLocaleString("ko-KR")}`}
            label={{
              value: "원/부품",
              angle: -90,
              position: "insideLeft",
              fill: subFg,
              fontSize: 11,
            }}
          />
          <Tooltip content={<CostTooltip darkMode={darkMode} />} />
          <Legend wrapperStyle={{ fontSize: 11, color: fg }} />

          <Line
            type="monotone"
            dataKey="toolCostPerPart"
            name="공구비/부품"
            stroke="#ef4444"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="machineCostPerPart"
            name="머신시간비/부품"
            stroke="#3b82f6"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="totalPerPart"
            name="총비용/부품"
            stroke="#10b981"
            strokeWidth={2.75}
            dot={false}
            isAnimationActive={false}
          />

          <ReferenceLine
            x={currentPoint.vc}
            stroke={darkMode ? "#e5e7eb" : "#4b5563"}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{
              value: `현재 Vc=${Math.round(currentVc)}`,
              position: "top",
              fill: subFg,
              fontSize: 10,
            }}
          />
          <ReferenceLine
            x={economic.vc}
            stroke="#10b981"
            strokeWidth={2}
            label={{
              value: "경제점",
              position: "top",
              fill: "#10b981",
              fontSize: 11,
              fontWeight: 700,
            }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          color: subFg,
          lineHeight: 1.5,
          wordBreak: "keep-all",
          overflowWrap: "break-word",
        }}
      >
        현재 <strong style={{ color: fg }}>{formatKrw(currentPoint.totalPerPart)}/부품</strong> · 경제점{" "}
        <strong style={{ color: "#10b981" }}>{formatKrw(economic.totalPerPart)}/부품</strong>{" "}
        (Vc={economic.vc} m/min) · 절감 potential{" "}
        <strong style={{ color: savings > 0 ? "#f59e0b" : subFg }}>{formatKrw(savings)}/부품</strong>
      </div>
    </div>
  )
}
