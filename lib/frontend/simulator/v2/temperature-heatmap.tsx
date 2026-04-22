// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Temperature Heatmap
// 공구-칩-공작물 3 영역의 실시간 온도 분포를 thermal-camera 스타일 히트맵으로 시각화.
// Blok 모델 결과(HeatEstimation)를 직관적 컬러 gradient + glow 로 표현.
"use client"

import { useId, useMemo } from "react"
import { motion } from "framer-motion"

// ─────────────────────────────────────────────
// 로컬 SSOT (상수)
// ─────────────────────────────────────────────
const DEFAULT_W = 520
const DEFAULT_H = 280

// viewBox 기준 좌표 (SVG 내부)
const VB_W = 520
const VB_H = 280

// 온도 범위
const TEMP_MIN = 20     // 상온 (°C)
const TEMP_MAX = 1000   // 스케일 상한 (°C)

// 공작물 영역
const WORKPIECE = {
  xPad: 20,
  topY: 168,         // 상단 표면 y
  bottomY: 260,      // 하단 y
} as const

// 공구(엔드밀) 영역 — 중앙 상단
const TOOL = {
  cx: 260,
  shankTopY: 30,
  shankBottomY: 90,
  fluteTopY: 90,
  fluteBottomY: 150,
  tipY: 168,         // 접촉점
  shankHalfW: 14,
  fluteHalfW: 12,
} as const

// 칩 분사 영역 — 우상향
const CHIP_ORIGIN = { x: 280, y: 160 } as const
const CHIP_DRIFT_ANGLE_DEG = 35

// 범례
const LEGEND = {
  x: 470,
  y: 30,
  width: 16,
  height: 220,
} as const

// 소재별 BUE(built-up edge) 위험 온도 (°C) — 간이 SSOT
const BUE_THRESHOLD_BY_GROUP: Record<string, number> = {
  P: 600,
  M: 650,
  K: 550,
  N: 350,  // Al 합금 — 낮은 온도에서 BUE
  S: 700,  // 내열합금
  H: 750,  // 경화강
}

function getBueThreshold(group: string): number {
  return BUE_THRESHOLD_BY_GROUP[(group || "").toUpperCase().charAt(0)] ?? 600
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** 온도 → HSL/HEX 색상 매핑 (blue→cyan→green→yellow→orange→red→white) */
export function tempToColor(c: number): string {
  // 정규화 0~1
  const t = Math.max(0, Math.min(1, (c - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
  // 6 stop 선형 보간
  const stops: Array<[number, [number, number, number]]> = [
    [0.0,  [ 30,  64, 175]], // deep blue
    [0.15, [ 37,  99, 235]], // blue
    [0.3,  [ 16, 185, 129]], // green
    [0.5,  [250, 204,  21]], // yellow
    [0.7,  [249, 115,  22]], // orange
    [0.88, [239,  68,  68]], // red
    [1.0,  [254, 243, 199]], // white-hot (creamy)
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / Math.max(t1 - t0, 1e-6)
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k)
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k)
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k)
      return `rgb(${r},${g},${b})`
    }
  }
  return "rgb(254,243,199)"
}

/** 온도 → glow 강도 (0~1) */
export function tempToGlow(c: number): number {
  // 200°C 이하면 0, 1000°C 에서 1
  if (c <= 200) return 0
  const g = (c - 200) / (TEMP_MAX - 200)
  return Math.max(0, Math.min(1, g))
}

/** 공구 색상 세분화 (요구사항 5 구간) */
function toolBaseColor(c: number): string {
  if (c < 150) return "#c0c0c0"
  if (c < 300) return "#fbbf24"
  if (c < 500) return "#f97316"
  if (c < 800) return "#ef4444"
  return "#fef3c7"
}

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────
export interface TemperatureHeatmapProps {
  chipTempC: number
  toolTempC: number
  workpieceTempC: number
  chipHeatPct: number        // 0~100
  Vc: number                 // 컨텍스트
  materialGroup: string
  darkMode?: boolean
  width?: number             // default 520
  height?: number            // default 280
  animated?: boolean         // default true
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function TemperatureHeatmap({
  chipTempC,
  toolTempC,
  workpieceTempC,
  chipHeatPct,
  Vc,
  materialGroup,
  darkMode = false,
  width = DEFAULT_W,
  height = DEFAULT_H,
  animated = true,
}: TemperatureHeatmapProps) {
  const uid = useId().replace(/:/g, "")
  const ids = useMemo(
    () => ({
      workGrad: `tempHM-workGrad-${uid}`,
      toolGrad: `tempHM-toolGrad-${uid}`,
      chipGlow: `tempHM-chipGlow-${uid}`,
      toolGlow: `tempHM-toolGlow-${uid}`,
      workGlow: `tempHM-workGlow-${uid}`,
      scaleGrad: `tempHM-scaleGrad-${uid}`,
    }),
    [uid]
  )

  // 열 배분 비율 정규화 (칩/공구/공작물)
  // chipHeatPct 주어지고, 나머지는 공구/공작물로 균등 분배 가정 (없으면)
  const chipPct = Math.max(0, Math.min(100, chipHeatPct))
  const remain = 100 - chipPct
  // 공구/공작물 비율은 각 온도 비로 나눔 (간이)
  const toolNormT = Math.max(1, toolTempC - TEMP_MIN)
  const workNormT = Math.max(1, workpieceTempC - TEMP_MIN)
  const tSum = toolNormT + workNormT
  const toolPct = Math.round((remain * toolNormT) / tSum)
  const workPct = Math.max(0, remain - toolPct)

  const bueThreshold = getBueThreshold(materialGroup)
  const bueAlert =
    chipTempC >= bueThreshold ||
    toolTempC >= bueThreshold ||
    workpieceTempC >= bueThreshold

  // 색상
  const workColorTop = tempToColor(workpieceTempC)
  const workColorBottom = tempToColor(TEMP_MIN)
  const workDepthFrac = 0.2 + 0.6 * ((workpieceTempC - TEMP_MIN) / (TEMP_MAX - TEMP_MIN))
  const toolBottom = toolBaseColor(toolTempC)
  const toolTop = darkMode ? "#3f3f46" : "#d4d4d8"
  const chipColor = tempToColor(chipTempC)
  const chipGlowIntensity = tempToGlow(chipTempC) * (0.3 + chipPct / 100)

  // 범례 마커 매핑 (y 좌표)
  const tempToLegendY = (c: number): number => {
    const t = Math.max(0, Math.min(1, (c - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)))
    // 위가 뜨거움 → y 작을수록 뜨거움
    return LEGEND.y + (1 - t) * LEGEND.height
  }

  const bgColor = darkMode ? "#0a0f1f" : "#fafafa"
  const panelBg = darkMode ? "#0f172a" : "#f1f5f9"
  const textColor = darkMode ? "#e2e8f0" : "#0f172a"
  const subTextColor = darkMode ? "#94a3b8" : "#475569"
  const borderColor = darkMode ? "#1e293b" : "#e2e8f0"

  // 칩 조각 데이터 (5개)
  const chipShards = useMemo(() => {
    const N = 6
    const out: Array<{
      id: number
      cx: number
      cy: number
      rx: number
      ry: number
      rot: number
      delay: number
    }> = []
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1)
      const dist = 40 + k * 120
      const ang = (CHIP_DRIFT_ANGLE_DEG * Math.PI) / 180
      const cx = CHIP_ORIGIN.x + Math.cos(ang) * dist + (i % 2 ? 6 : -6)
      const cy = CHIP_ORIGIN.y - Math.sin(ang) * dist + (i % 3 ? 4 : -4)
      const scale = 0.7 + chipPct / 200 + (1 - k) * 0.4
      out.push({
        id: i,
        cx,
        cy,
        rx: 9 * scale,
        ry: 4 * scale,
        rot: -30 + k * 60 + (i * 17) % 25,
        delay: i * 0.35,
      })
    }
    return out
  }, [chipPct])

  // 공구 pulsate 강도
  const toolPulse = 0.5 + tempToGlow(toolTempC) * 0.8

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        background: bgColor,
        borderColor,
        width,
        maxWidth: "100%",
      }}
      role="img"
      aria-label={`열 분포 히트맵: 칩 ${Math.round(chipTempC)}°C, 공구 ${Math.round(
        toolTempC
      )}°C, 공작물 ${Math.round(workpieceTempC)}°C`}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height={height}
        style={{ display: "block" }}
      >
        <defs>
          {/* 공작물 gradient (상단 뜨거움 → 하단 상온) */}
          <linearGradient id={ids.workGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={workColorTop} stopOpacity={0.95} />
            <stop
              offset={`${Math.round(workDepthFrac * 100)}%`}
              stopColor={workColorTop}
              stopOpacity={0.6}
            />
            <stop offset="100%" stopColor={workColorBottom} stopOpacity={0.9} />
          </linearGradient>

          {/* 공구 gradient (tip 뜨거움) */}
          <linearGradient id={ids.toolGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={toolTop} />
            <stop offset="55%" stopColor={toolBaseColor(toolTempC * 0.7)} />
            <stop offset="100%" stopColor={toolBottom} />
          </linearGradient>

          {/* 스케일 bar gradient */}
          <linearGradient id={ids.scaleGrad} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={tempToColor(TEMP_MIN)} />
            <stop offset="15%" stopColor={tempToColor(TEMP_MIN + 0.15 * (TEMP_MAX - TEMP_MIN))} />
            <stop offset="30%" stopColor={tempToColor(TEMP_MIN + 0.3 * (TEMP_MAX - TEMP_MIN))} />
            <stop offset="50%" stopColor={tempToColor(TEMP_MIN + 0.5 * (TEMP_MAX - TEMP_MIN))} />
            <stop offset="70%" stopColor={tempToColor(TEMP_MIN + 0.7 * (TEMP_MAX - TEMP_MIN))} />
            <stop offset="88%" stopColor={tempToColor(TEMP_MIN + 0.88 * (TEMP_MAX - TEMP_MIN))} />
            <stop offset="100%" stopColor={tempToColor(TEMP_MAX)} />
          </linearGradient>

          {/* glow filters */}
          <filter id={ids.chipGlow} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={2 + chipGlowIntensity * 4} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={ids.toolGlow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={1.5 + tempToGlow(toolTempC) * 4} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={ids.workGlow} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={1 + tempToGlow(workpieceTempC) * 2.5} />
          </filter>
        </defs>

        {/* 배경 패널 */}
        <rect x="0" y="0" width={VB_W} height={VB_H} fill={bgColor} />
        <rect
          x="8"
          y="8"
          width={VB_W - 16}
          height={VB_H - 16}
          fill={panelBg}
          stroke={borderColor}
          strokeWidth="1"
          rx="10"
        />

        {/* ─── 공작물 (하단 40%) ─── */}
        <g filter={`url(#${ids.workGlow})`}>
          <rect
            x={WORKPIECE.xPad}
            y={WORKPIECE.topY}
            width={VB_W - WORKPIECE.xPad - 60}
            height={WORKPIECE.bottomY - WORKPIECE.topY}
            fill={`url(#${ids.workGrad})`}
            rx="4"
          />
          {/* 표면 hot strip (공구 접촉 근처) */}
          <motion.rect
            x={TOOL.cx - 60}
            y={WORKPIECE.topY - 2}
            width={120}
            height={10}
            fill={workColorTop}
            opacity={0.55 + tempToGlow(workpieceTempC) * 0.4}
            animate={
              animated
                ? { opacity: [0.4, 0.9, 0.4] }
                : undefined
            }
            transition={
              animated
                ? { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
                : undefined
            }
            rx="2"
          />
        </g>
        <text
          x={WORKPIECE.xPad + 6}
          y={WORKPIECE.bottomY - 6}
          fontSize="9"
          fill={subTextColor}
          fontFamily="ui-sans-serif, system-ui"
        >
          공작물 {Math.round(workpieceTempC)}°C
        </text>

        {/* ─── 엔드밀 (상단 중앙) ─── */}
        <motion.g
          filter={`url(#${ids.toolGlow})`}
          animate={
            animated
              ? { opacity: [toolPulse * 0.9, Math.min(1, toolPulse * 1.15), toolPulse * 0.9] }
              : undefined
          }
          transition={
            animated ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : undefined
          }
        >
          {/* Shank (상부) */}
          <rect
            x={TOOL.cx - TOOL.shankHalfW}
            y={TOOL.shankTopY}
            width={TOOL.shankHalfW * 2}
            height={TOOL.shankBottomY - TOOL.shankTopY}
            fill={toolTop}
            stroke={darkMode ? "#52525b" : "#a1a1aa"}
            strokeWidth="0.5"
            rx="2"
          />
          {/* Flute body (중간) */}
          <rect
            x={TOOL.cx - TOOL.fluteHalfW}
            y={TOOL.fluteTopY}
            width={TOOL.fluteHalfW * 2}
            height={TOOL.fluteBottomY - TOOL.fluteTopY}
            fill={`url(#${ids.toolGrad})`}
          />
          {/* Tip (가장 뜨거움) */}
          <path
            d={`M ${TOOL.cx - TOOL.fluteHalfW} ${TOOL.fluteBottomY}
                L ${TOOL.cx + TOOL.fluteHalfW} ${TOOL.fluteBottomY}
                L ${TOOL.cx + TOOL.fluteHalfW - 3} ${TOOL.tipY}
                L ${TOOL.cx - TOOL.fluteHalfW + 3} ${TOOL.tipY} Z`}
            fill={toolBottom}
          />
          {/* flute 세로 홈 (3개) */}
          {[-1, 0, 1].map((k) => (
            <line
              key={k}
              x1={TOOL.cx + k * 6}
              y1={TOOL.fluteTopY + 4}
              x2={TOOL.cx + k * 6}
              y2={TOOL.fluteBottomY - 2}
              stroke={darkMode ? "#18181b" : "#3f3f46"}
              strokeWidth="0.6"
              opacity="0.5"
            />
          ))}
        </motion.g>

        {/* ─── 칩 분사 영역 (상단 우측) ─── */}
        <g filter={`url(#${ids.chipGlow})`}>
          {chipShards.map((s) => {
            const driftX = Math.cos((CHIP_DRIFT_ANGLE_DEG * Math.PI) / 180) * 24
            const driftY = -Math.sin((CHIP_DRIFT_ANGLE_DEG * Math.PI) / 180) * 24
            return (
              <motion.ellipse
                key={s.id}
                cx={s.cx}
                cy={s.cy}
                rx={s.rx}
                ry={s.ry}
                fill={chipColor}
                opacity={0.55 + chipGlowIntensity * 0.4}
                transform={`rotate(${s.rot} ${s.cx} ${s.cy})`}
                animate={
                  animated
                    ? {
                        cx: [s.cx, s.cx + driftX, s.cx + driftX * 2],
                        cy: [s.cy, s.cy + driftY, s.cy + driftY * 2],
                        opacity: [
                          0.3 + chipGlowIntensity * 0.3,
                          0.55 + chipGlowIntensity * 0.4,
                          0,
                        ],
                      }
                    : undefined
                }
                transition={
                  animated
                    ? {
                        duration: 3.2,
                        delay: s.delay,
                        repeat: Infinity,
                        ease: "easeOut",
                      }
                    : undefined
                }
              />
            )
          })}
        </g>

        {/* ─── 온도 스케일 범례 (우측 수직) ─── */}
        <g>
          <rect
            x={LEGEND.x}
            y={LEGEND.y}
            width={LEGEND.width}
            height={LEGEND.height}
            fill={`url(#${ids.scaleGrad})`}
            stroke={borderColor}
            strokeWidth="0.5"
            rx="2"
          />
          {/* 눈금 (0, 250, 500, 750, 1000) */}
          {[TEMP_MIN, 250, 500, 750, TEMP_MAX].map((v) => {
            const y = tempToLegendY(v)
            return (
              <g key={v}>
                <line
                  x1={LEGEND.x + LEGEND.width}
                  y1={y}
                  x2={LEGEND.x + LEGEND.width + 3}
                  y2={y}
                  stroke={subTextColor}
                  strokeWidth="0.5"
                />
                <text
                  x={LEGEND.x - 3}
                  y={y + 3}
                  fontSize="7"
                  fill={subTextColor}
                  textAnchor="end"
                  fontFamily="ui-monospace, monospace"
                >
                  {v}
                </text>
              </g>
            )
          })}

          {/* BUE 위험 threshold 점선 */}
          <line
            x1={LEGEND.x - 6}
            y1={tempToLegendY(bueThreshold)}
            x2={LEGEND.x + LEGEND.width + 6}
            y2={tempToLegendY(bueThreshold)}
            stroke={bueAlert ? "#ef4444" : "#f59e0b"}
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity={0.85}
          />
          <text
            x={LEGEND.x - 8}
            y={tempToLegendY(bueThreshold) - 3}
            fontSize="6.5"
            fill={bueAlert ? "#ef4444" : "#f59e0b"}
            textAnchor="end"
            fontFamily="ui-sans-serif, system-ui"
          >
            BUE {bueThreshold}°
          </text>

          {/* 현재 온도 마커 (칩/공구/공작물) */}
          {[
            { label: "칩", c: chipTempC, color: "#f43f5e" },
            { label: "공구", c: toolTempC, color: "#38bdf8" },
            { label: "공작물", c: workpieceTempC, color: "#a3e635" },
          ].map((m) => {
            const y = tempToLegendY(m.c)
            return (
              <g key={m.label}>
                <line
                  x1={LEGEND.x - 2}
                  y1={y}
                  x2={LEGEND.x + LEGEND.width + 2}
                  y2={y}
                  stroke={m.color}
                  strokeWidth="1.5"
                />
                <text
                  x={LEGEND.x + LEGEND.width + 5}
                  y={y + 2}
                  fontSize="7"
                  fill={m.color}
                  fontFamily="ui-sans-serif, system-ui"
                  fontWeight="600"
                >
                  {m.label}
                </text>
              </g>
            )
          })}
        </g>

        {/* ─── 정보 오버레이 ─── */}
        {/* 좌상단 타이틀 */}
        <text
          x="18"
          y="26"
          fontSize="11"
          fill={textColor}
          fontFamily="ui-sans-serif, system-ui"
          fontWeight="600"
        >
          🌡 열 분포 (Blok model)
        </text>
        <text
          x="18"
          y="40"
          fontSize="8.5"
          fill={subTextColor}
          fontFamily="ui-sans-serif, system-ui"
        >
          Vc {Math.round(Vc)} m/min · {materialGroup || "—"}그룹
        </text>

        {/* 우상단 열 배분 bar */}
        <g transform="translate(240, 16)">
          <text
            x="0"
            y="9"
            fontSize="8"
            fill={subTextColor}
            fontFamily="ui-sans-serif, system-ui"
          >
            열 배분
          </text>
          <g transform="translate(0, 12)">
            <rect x="0" y="0" width="200" height="8" fill={borderColor} rx="2" />
            <rect x="0" y="0" width={(chipPct / 100) * 200} height="8" fill="#f43f5e" rx="2" />
            <rect
              x={(chipPct / 100) * 200}
              y="0"
              width={(toolPct / 100) * 200}
              height="8"
              fill="#38bdf8"
            />
            <rect
              x={((chipPct + toolPct) / 100) * 200}
              y="0"
              width={(workPct / 100) * 200}
              height="8"
              fill="#a3e635"
              rx="2"
            />
          </g>
          <text
            x="0"
            y="32"
            fontSize="7.5"
            fill={subTextColor}
            fontFamily="ui-sans-serif, system-ui"
          >
            칩 {chipPct}% · 공구 {toolPct}% · 공작물 {workPct}%
          </text>
        </g>

        {/* 우하단 온도 리스트 */}
        <g transform={`translate(${VB_W - 180}, ${VB_H - 56})`}>
          {[
            { label: "칩", c: chipTempC, color: "#f43f5e" },
            { label: "공구", c: toolTempC, color: "#38bdf8" },
            { label: "공작물", c: workpieceTempC, color: "#a3e635" },
          ].map((row, i) => (
            <g key={row.label} transform={`translate(0, ${i * 14})`}>
              <circle cx="4" cy="6" r="3" fill={row.color} />
              <text
                x="12"
                y="9"
                fontSize="8.5"
                fill={textColor}
                fontFamily="ui-sans-serif, system-ui"
              >
                {row.label}
              </text>
              <text
                x="60"
                y="9"
                fontSize="8.5"
                fill={row.c >= bueThreshold ? "#ef4444" : textColor}
                fontFamily="ui-monospace, monospace"
                fontWeight={row.c >= bueThreshold ? "700" : "500"}
              >
                {Math.round(row.c)}°C
              </text>
            </g>
          ))}
        </g>

        {/* BUE alert overlay */}
        {bueAlert && (
          <g>
            <rect
              x="8"
              y="8"
              width={VB_W - 16}
              height={VB_H - 16}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeDasharray="6 4"
              rx="10"
              opacity="0.75"
            />
            <text
              x={VB_W / 2}
              y={VB_H - 8}
              fontSize="9"
              fill="#ef4444"
              textAnchor="middle"
              fontFamily="ui-sans-serif, system-ui"
              fontWeight="700"
            >
              ⚠ BUE 위험 온도 초과 ({bueThreshold}°C / {materialGroup})
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
