"use client"

/**
 * ForceVectorDiagram
 *
 * Cook-forge YG-1 Simulator v3 전용 절삭력 벡터 실시간 다이어그램.
 * 공구에 작용하는 3방향 힘(Tangential / Radial / Axial)을 3D 느낌의 SVG
 * 벡터 화살표로 시각화한다. HelixDecomposition 결과(tangential/radial/axial
 * force + helixAngle + liftRatio)를 입력으로 받아 실시간으로 변화한다.
 *
 * 사용법:
 *   <ForceVectorDiagram
 *     tangentialForceN={ft}
 *     radialForceN={fr}
 *     axialForceN={fa}
 *     helixAngle={45}
 *     liftRatio={0.42}
 *     diameter={10}
 *     darkMode
 *   />
 *
 * 의존성: framer-motion ^12.38 (이미 설치됨)
 * 주의: cutting-simulator-v2.tsx 는 건드리지 않는다. 본 파일은 v3 신규 컴포넌트.
 */

import { motion } from "framer-motion"
import { useMemo } from "react"
import { LiveIndicator } from "./live-indicator"

export interface ForceVectorDiagramProps {
  /** Tangential force (접선방향, 공구 회전 저항) [N] */
  tangentialForceN: number
  /** Radial force (경방향, 공구를 밀어내는 힘) [N] */
  radialForceN: number
  /** Axial force (축방향, 공구를 위로 들어올리는 힘) [N] */
  axialForceN: number
  /** Helix angle (도) */
  helixAngle: number
  /** Lift ratio (0~1+, axial / tangential 기준) */
  liftRatio: number
  /** 공구 직경 [mm] (표시용, 현재 로직에는 미사용이지만 확장 대비) */
  diameter: number
  /** 다크 모드 여부 */
  darkMode?: boolean
  /** 컨테이너 가로 크기 (px, default 400) */
  width?: number
  /** 컨테이너 세로 크기 (px, default 340) */
  height?: number
}

// ───────────────────────────────────────────────────────────
// 디자인 토큰 (하드코딩 금지 원칙에 맞춰 상단 집약)
// ───────────────────────────────────────────────────────────
const VECTOR_COLORS = {
  tangential: "#3b82f6", // blue-500
  radial: "#f59e0b", // amber-500
  axial: "#a855f7", // purple-500
  resultant: "#94a3b8", // slate-400
  helixArc: "#facc15", // yellow-400
} as const

const LIFT_RATIO_THRESHOLDS = {
  low: 0.2, // emerald
  mid: 0.5, // amber
  // >= 0.5 → rose
}

const DANGER_THRESHOLDS = {
  /** axial / tangential 이 이 값 초과 시 lift 위험 */
  liftCritical: 0.5,
  /** 개별 벡터가 이 배수를 넘어서면 pulse 경고 */
  tangentialMaxN: 2000,
  radialMaxN: 1500,
  axialMaxN: 1000,
}

const MAX_ARROW_PX = 140
const LOG_BASE_N = 10 // 힘 크기 로그 스케일 기준 (10N 이하는 거의 0)

// ───────────────────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────────────────

/** 힘(N) → 화살표 픽셀 길이. log scale. 0~MAX_ARROW_PX. */
function forceToLength(forceN: number, maxReferenceN: number): number {
  const magnitude = Math.max(Math.abs(forceN), 0)
  if (magnitude < 1) return 0
  const logVal = Math.log10(magnitude + LOG_BASE_N)
  const logMax = Math.log10(maxReferenceN + LOG_BASE_N)
  const ratio = Math.min(logVal / logMax, 1)
  return Math.max(0, Math.min(MAX_ARROW_PX, ratio * MAX_ARROW_PX))
}

/** liftRatio 에 따른 컬러 선택 */
function liftColor(ratio: number): string {
  if (ratio < LIFT_RATIO_THRESHOLDS.low) return "#10b981" // emerald-500
  if (ratio < LIFT_RATIO_THRESHOLDS.mid) return "#f59e0b" // amber-500
  return "#f43f5e" // rose-500
}

function fmtN(n: number): string {
  if (!Number.isFinite(n)) return "—"
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}kN`
  return `${n.toFixed(0)}N`
}

// ───────────────────────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────────────────────

export function ForceVectorDiagram({
  tangentialForceN,
  radialForceN,
  axialForceN,
  helixAngle,
  liftRatio,
  diameter: _diameter,
  darkMode = false,
  width = 400,
  height = 340,
}: ForceVectorDiagramProps) {
  // viewBox 좌표계 (내부 논리 좌표)
  const VB_W = 400
  const VB_H = 340
  const cx = VB_W / 2
  const cy = VB_H / 2 - 10 // 약간 위쪽 (하단 gauge 공간 확보)

  // 테마 색상
  const theme = useMemo(() => {
    if (darkMode) {
      return {
        bg: "#0f172a",
        grid: "#1e293b",
        text: "#e2e8f0",
        subtext: "#94a3b8",
        toolFillFrom: "#475569",
        toolFillTo: "#1e293b",
        toolStroke: "#64748b",
        badgeText: "#ffffff",
        calloutBg: "#1e293b",
      }
    }
    return {
      bg: "#f8fafc",
      grid: "#e2e8f0",
      text: "#0f172a",
      subtext: "#64748b",
      toolFillFrom: "#e2e8f0",
      toolFillTo: "#94a3b8",
      toolStroke: "#64748b",
      badgeText: "#ffffff",
      calloutBg: "#ffffff",
    }
  }, [darkMode])

  // 벡터 길이
  const ftLen = forceToLength(tangentialForceN, DANGER_THRESHOLDS.tangentialMaxN)
  const frLen = forceToLength(radialForceN, DANGER_THRESHOLDS.radialMaxN)
  const faLen = forceToLength(axialForceN, DANGER_THRESHOLDS.axialMaxN)

  // 위험 플래그
  const axialRatio = tangentialForceN > 1 ? axialForceN / tangentialForceN : 0
  const liftDanger = axialRatio > DANGER_THRESHOLDS.liftCritical
  const ftDanger = tangentialForceN > DANGER_THRESHOLDS.tangentialMaxN
  const frDanger = radialForceN > DANGER_THRESHOLDS.radialMaxN
  const faDanger = axialForceN > DANGER_THRESHOLDS.axialMaxN || liftDanger

  // 합력 (Ft + Fr 평면)
  const resultantN = Math.sqrt(
    tangentialForceN * tangentialForceN + radialForceN * radialForceN,
  )
  const resultantLen = forceToLength(
    resultantN,
    Math.sqrt(
      DANGER_THRESHOLDS.tangentialMaxN ** 2 +
        DANGER_THRESHOLDS.radialMaxN ** 2,
    ),
  )
  // 합력 방향: Ft 는 +x(오른쪽), Fr 는 -x(왼쪽) 가정이므로
  // 두 힘의 x축 성분 차이 + y(0). 시각적 합력은 우하단 45° 로 표현.
  const resultantAngleDeg = 45

  // 공구 본체 (원통)
  const toolW = 72
  const toolH = 200
  const toolX = cx - toolW / 2
  const toolY = cy - toolH / 2

  // 벡터 시작점 (공구 중심)
  // 배치 규칙:
  //   Ft: 오른쪽 수평
  //   Fr: 왼쪽 수평 (공구를 밀어내는 힘)
  //   Fa: 위쪽 수직 (climb mill lift)
  const ftEnd = { x: cx + ftLen, y: cy }
  const frEnd = { x: cx - frLen, y: cy }
  const faEnd = { x: cx, y: cy - faLen }

  // 합력 끝점 (45° 방향, 우하단)
  const resAngleRad = (resultantAngleDeg * Math.PI) / 180
  const resEnd = {
    x: cx + resultantLen * Math.cos(resAngleRad),
    y: cy + resultantLen * Math.sin(resAngleRad),
  }

  // Helix arc (공구 측면 우측)
  const helixArcR = 46
  const helixArcCx = cx + toolW / 2 + 6
  const helixArcCy = cy + 40
  const helixRad = (Math.max(0, Math.min(60, helixAngle)) * Math.PI) / 180
  const helixArcEnd = {
    x: helixArcCx + helixArcR * Math.sin(helixRad),
    y: helixArcCy - helixArcR * Math.cos(helixRad),
  }
  const helixArcStart = {
    x: helixArcCx,
    y: helixArcCy - helixArcR,
  }
  const helixArcPath = `M ${helixArcStart.x} ${helixArcStart.y} A ${helixArcR} ${helixArcR} 0 0 1 ${helixArcEnd.x} ${helixArcEnd.y}`

  // Lift gauge
  const gaugeX = 30
  const gaugeY = VB_H - 38
  const gaugeW = VB_W - 60
  const gaugeH = 10
  const liftClamped = Math.max(0, Math.min(1, liftRatio))
  const liftMarkerX = gaugeX + liftClamped * gaugeW
  const liftBarColor = liftColor(liftClamped)

  const spring = { type: "spring" as const, stiffness: 120, damping: 18 }

  return (
    <div
      className="relative"
      style={{
        width: "100%",
        maxWidth: width,
        minWidth: 320,
        aspectRatio: `${width} / ${height}`,
      }}
    >
      {/* LIVE 인디케이터 (우상단) */}
      <div style={{ position: "absolute", top: 6, right: 6, zIndex: 3, pointerEvents: "none" }}>
        <LiveIndicator watch={[tangentialForceN, radialForceN, axialForceN]} color="violet" darkMode={darkMode} />
      </div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full rounded-lg"
        role="img"
        aria-label="절삭력 3방향 벡터 다이어그램"
      >
        {/* ── 배경 ── */}
        <rect x={0} y={0} width={VB_W} height={VB_H} fill={theme.bg} />

        {/* 격자 선 (배경) */}
        <defs>
          <pattern
            id="fvd-grid"
            width={20}
            height={20}
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke={theme.grid}
              strokeWidth={0.5}
            />
          </pattern>

          {/* 공구 metal gradient */}
          <linearGradient id="fvd-tool-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={theme.toolFillFrom} />
            <stop offset="50%" stopColor="#cbd5e1" />
            <stop offset="100%" stopColor={theme.toolFillTo} />
          </linearGradient>

          {/* 화살표 마커용 filter (light glow) */}
          <filter id="fvd-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect
          x={0}
          y={0}
          width={VB_W}
          height={VB_H - 50}
          fill="url(#fvd-grid)"
          opacity={0.5}
        />

        {/* ── 공구 본체 ── */}
        <rect
          x={toolX}
          y={toolY}
          width={toolW}
          height={toolH}
          rx={6}
          ry={6}
          fill="url(#fvd-tool-grad)"
          stroke={theme.toolStroke}
          strokeWidth={1.2}
        />
        {/* 상단 음영 (원통 입체감) */}
        <ellipse
          cx={cx}
          cy={toolY + 4}
          rx={toolW / 2 - 2}
          ry={4}
          fill={theme.toolFillFrom}
          stroke={theme.toolStroke}
          strokeWidth={0.8}
        />
        {/* 하단 음영 */}
        <ellipse
          cx={cx}
          cy={toolY + toolH - 4}
          rx={toolW / 2 - 2}
          ry={4}
          fill={theme.toolFillTo}
          opacity={0.6}
        />
        {/* 중심 점 */}
        <circle cx={cx} cy={cy} r={3.5} fill={theme.text} />
        <circle cx={cx} cy={cy} r={1.2} fill={theme.bg} />

        {/* ── Helix arc ── */}
        <path
          d={helixArcPath}
          fill="none"
          stroke={VECTOR_COLORS.helixArc}
          strokeWidth={1.6}
          strokeDasharray="3,2"
          opacity={0.9}
        />
        <text
          x={helixArcCx + 10}
          y={helixArcCy + 4}
          fontSize={10}
          fill={theme.subtext}
        >
          θ = {helixAngle.toFixed(0)}°
        </text>
        <text
          x={helixArcCx + 10}
          y={helixArcCy + 18}
          fontSize={8}
          fill={theme.subtext}
          opacity={0.7}
        >
          tan(θ) × Ft × 0.4 ≈ Fa
        </text>

        {/* ── 합력 벡터 (Ft + Fr 평면) ── */}
        {resultantLen > 2 && (
          <g opacity={0.75}>
            <motion.line
              x1={cx}
              y1={cy}
              initial={false}
              animate={{ x2: resEnd.x, y2: resEnd.y }}
              transition={spring}
              stroke={VECTOR_COLORS.resultant}
              strokeWidth={2}
              strokeDasharray="5,3"
            />
            <text
              x={resEnd.x + 6}
              y={resEnd.y + 4}
              fontSize={9}
              fill={theme.subtext}
            >
              합력 {fmtN(resultantN)}
            </text>
          </g>
        )}

        {/* ── Tangential 벡터 (파랑, →) ── */}
        <ForceArrow
          startX={cx}
          startY={cy}
          endX={ftEnd.x}
          endY={ftEnd.y}
          color={VECTOR_COLORS.tangential}
          label={`Ft ${fmtN(tangentialForceN)} →`}
          danger={ftDanger}
          labelPosition="right"
          theme={theme}
          spring={spring}
        />

        {/* ── Radial 벡터 (주황, ←) ── */}
        <ForceArrow
          startX={cx}
          startY={cy}
          endX={frEnd.x}
          endY={frEnd.y}
          color={VECTOR_COLORS.radial}
          label={`← Fr ${fmtN(radialForceN)}`}
          danger={frDanger}
          labelPosition="left"
          theme={theme}
          spring={spring}
        />

        {/* ── Axial 벡터 (보라, ↑) ── */}
        <ForceArrow
          startX={cx}
          startY={cy}
          endX={faEnd.x}
          endY={faEnd.y}
          color={VECTOR_COLORS.axial}
          label={`Fa ${fmtN(axialForceN)} ↑${faDanger ? " ⚠" : ""}`}
          danger={faDanger}
          labelPosition="top"
          theme={theme}
          spring={spring}
        />

        {/* ── Lift gauge ── */}
        <g>
          <rect
            x={gaugeX}
            y={gaugeY}
            width={gaugeW}
            height={gaugeH}
            rx={gaugeH / 2}
            fill={theme.grid}
          />
          <rect
            x={gaugeX}
            y={gaugeY}
            width={Math.max(2, liftClamped * gaugeW)}
            height={gaugeH}
            rx={gaugeH / 2}
            fill={liftBarColor}
            opacity={0.85}
          />
          {/* 위치 마커 */}
          <motion.circle
            cy={gaugeY + gaugeH / 2}
            r={6}
            fill={liftBarColor}
            stroke={theme.bg}
            strokeWidth={1.5}
            initial={false}
            animate={{ cx: liftMarkerX }}
            transition={spring}
          />
          <text
            x={gaugeX}
            y={gaugeY - 5}
            fontSize={9}
            fill={theme.subtext}
          >
            공구를 위로 당기는 정도 (climb mill lift){" "}
            <tspan fill={liftBarColor} fontWeight={600}>
              {(liftClamped * 100).toFixed(0)}%
            </tspan>
            {liftDanger && (
              <tspan fill="#f43f5e" fontWeight={700}>
                {"  ⚠ lift 위험"}
              </tspan>
            )}
          </text>
        </g>

        {/* ── 하단 callout ── */}
        <text
          x={VB_W / 2}
          y={VB_H - 6}
          textAnchor="middle"
          fontSize={9}
          fill={theme.subtext}
        >
          💡 Ft: 공구 회전 저항 · Fr: 공구를 밀어내는 힘 · Fa: 공구를 위로
          들어올리는 힘
        </text>
      </svg>
    </div>
  )
}

export default ForceVectorDiagram

// ───────────────────────────────────────────────────────────
// 내부 컴포넌트: 벡터 화살표 (선 + 화살촉 + 배지 + pulse dot)
// ───────────────────────────────────────────────────────────

interface ForceArrowProps {
  startX: number
  startY: number
  endX: number
  endY: number
  color: string
  label: string
  danger: boolean
  labelPosition: "left" | "right" | "top"
  theme: {
    text: string
    subtext: string
    bg: string
    badgeText: string
  }
  spring: { type: "spring"; stiffness: number; damping: number }
}

function ForceArrow({
  startX,
  startY,
  endX,
  endY,
  color,
  label,
  danger,
  labelPosition,
  theme,
  spring,
}: ForceArrowProps) {
  const length = Math.hypot(endX - startX, endY - startY)
  if (length < 1.5) {
    // 거의 0 힘 → placeholder dot 만
    return (
      <g opacity={0.4}>
        <circle cx={startX} cy={startY} r={2} fill={color} />
      </g>
    )
  }

  // 화살촉(triangle) 좌표
  const angle = Math.atan2(endY - startY, endX - startX)
  const headLen = 10
  const headW = 7
  const hx1 = endX - headLen * Math.cos(angle) + headW * Math.sin(angle)
  const hy1 = endY - headLen * Math.sin(angle) - headW * Math.cos(angle)
  const hx2 = endX - headLen * Math.cos(angle) - headW * Math.sin(angle)
  const hy2 = endY - headLen * Math.sin(angle) + headW * Math.cos(angle)
  const arrowhead = `${endX},${endY} ${hx1},${hy1} ${hx2},${hy2}`

  // 배지 위치
  let badgeX = endX
  let badgeY = endY
  let badgeAnchor: "start" | "end" | "middle" = "middle"
  if (labelPosition === "right") {
    badgeX = endX + 8
    badgeY = endY + 4
    badgeAnchor = "start"
  } else if (labelPosition === "left") {
    badgeX = endX - 8
    badgeY = endY + 4
    badgeAnchor = "end"
  } else {
    badgeX = endX
    badgeY = endY - 12
    badgeAnchor = "middle"
  }

  // 배지 박스 대략 크기 (label 길이 기반)
  const badgeTextW = label.length * 6.2 + 10
  const badgeH = 16
  let badgeRectX = badgeX - badgeTextW / 2
  if (badgeAnchor === "start") badgeRectX = badgeX - 4
  else if (badgeAnchor === "end") badgeRectX = badgeX - badgeTextW + 4
  const badgeRectY = badgeY - badgeH + 3

  return (
    <g>
      {/* 선 */}
      <motion.line
        x1={startX}
        y1={startY}
        initial={false}
        animate={{ x2: endX, y2: endY }}
        transition={spring}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        filter="url(#fvd-glow)"
      />
      {/* 화살촉 */}
      <motion.polygon
        points={arrowhead}
        initial={false}
        animate={{ opacity: 1 }}
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
      {/* pulse dot (살아있는 느낌) */}
      <motion.circle
        cx={endX}
        cy={endY}
        r={4}
        fill={color}
        animate={
          danger
            ? { scale: [1, 1.7, 1], opacity: [0.8, 0.3, 0.8] }
            : { scale: [1, 1.25, 1], opacity: [0.7, 0.35, 0.7] }
        }
        transition={{
          duration: danger ? 0.6 : 1.4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      {/* 배지 배경 */}
      <rect
        x={badgeRectX}
        y={badgeRectY}
        width={badgeTextW}
        height={badgeH}
        rx={4}
        ry={4}
        fill={color}
        opacity={0.92}
      />
      <text
        x={badgeX}
        y={badgeY}
        fontSize={10}
        fontWeight={600}
        fill={theme.badgeText}
        textAnchor={badgeAnchor}
      >
        {danger ? `⚠ ${label}` : label}
      </text>
    </g>
  )
}
