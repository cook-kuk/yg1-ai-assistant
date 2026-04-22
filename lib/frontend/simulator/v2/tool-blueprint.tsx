"use client"

/**
 * YG-1 엔드밀 기술 도면 (Blueprint) 컴포넌트
 *
 * 현재 선택된 엔드밀을 YG-1 카탈로그 스타일의 ISO 제도 도면으로 렌더링.
 * 측면도 + 정면도 + 치수선 + YG-1 브랜딩 스탬프. cyan/dark blueprint 감성.
 *
 * viewBox는 500x420으로 고정, 반응형은 width 100% + max-width 520px.
 */

import { useId, useMemo } from "react"

export type ToolBlueprintShape = "square" | "ball" | "radius" | "chamfer"

export interface ToolBlueprintProps {
  shape: ToolBlueprintShape
  diameter: number // mm cutting dia
  shankDia?: number // default = diameter
  LOC: number // length of cut (flute length mm)
  OAL: number // overall length mm
  flutes: number
  helixAngle?: number // default 38
  cornerR?: number // radius shape일 때
  chamferDeg?: number // default 45
  coating?: string
  seriesCode?: string // "GNX98"
  edpCode?: string
  darkMode?: boolean
  showDimensions?: boolean // default true
  showGrid?: boolean // default false
  className?: string
}

// ─── 상수 (하드코딩 방지용 내부 config) ────────────────────────────────────
const VIEW_W = 500
const VIEW_H = 420
const SIDE_VIEW_BOTTOM = 230
const TOP_VIEW_TOP = 240
const TOP_VIEW_BOTTOM = 400
const HEADER_H = 22
const FOOTER_Y = 414

// 색상 팔레트 (light / dark blueprint)
const PALETTE = {
  dark: {
    bg: "#0a1628",
    stroke: "#7dd3fc", // cyan-300
    strokeFaint: "#0e4a6a",
    dim: "#fbbf24", // amber-400
    gridLine: "#14304a",
    text: "#bae6fd",
    stamp: "#f0abfc",
  },
  light: {
    bg: "#ecfeff",
    stroke: "#0891b2", // cyan-700
    strokeFaint: "#a5f3fc",
    dim: "#b45309",
    gridLine: "#bae6fd",
    text: "#155e75",
    stamp: "#7c2d12",
  },
} as const

// 코팅 라벨 (디스플레이용)
const COATING_LABEL: Record<string, string> = {
  altin: "AlTiN",
  aicrn: "AlCrN",
  tialn: "TiAlN",
  tin: "TiN",
  dlc: "DLC",
  uncoated: "UNCOATED",
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function resolveCoating(c?: string): string | undefined {
  if (!c) return undefined
  const k = c.toLowerCase()
  return COATING_LABEL[k] ?? c.toUpperCase()
}

/**
 * ISO 치수선: 양끝 화살표 + 숫자 라벨 (수평/수직 자동).
 */
function DimLine({
  x1,
  y1,
  x2,
  y2,
  label,
  color,
  textColor,
  offset = 0,
  placement = "auto",
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  color: string
  textColor: string
  offset?: number
  placement?: "auto" | "above" | "below" | "left" | "right"
}) {
  const isHorizontal = Math.abs(y1 - y2) < 0.5
  const arrow = 3
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2

  // 화살표 (간단한 triangle)
  const arrows = isHorizontal
    ? [
        `M ${x1} ${y1} l ${arrow} ${-arrow / 2} l 0 ${arrow} z`,
        `M ${x2} ${y2} l ${-arrow} ${-arrow / 2} l 0 ${arrow} z`,
      ]
    : [
        `M ${x1} ${y1} l ${-arrow / 2} ${arrow} l ${arrow} 0 z`,
        `M ${x2} ${y2} l ${-arrow / 2} ${-arrow} l ${arrow} 0 z`,
      ]

  // label 위치
  let tx = midX
  let ty = midY
  let anchor: "start" | "middle" | "end" = "middle"
  if (isHorizontal) {
    ty = midY + (placement === "below" ? 10 : -4)
    anchor = "middle"
  } else {
    tx = midX + (placement === "right" ? 6 : -6)
    ty = midY + 3
    anchor = placement === "right" ? "start" : "end"
  }

  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={0.6} />
      {arrows.map((d, i) => (
        <path key={i} d={d} fill={color} />
      ))}
      <text
        x={tx}
        y={ty}
        textAnchor={anchor}
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={9}
        fill={textColor}
      >
        {label}
      </text>
    </g>
  )
}

export function ToolBlueprint({
  shape,
  diameter,
  shankDia,
  LOC,
  OAL,
  flutes,
  helixAngle = 38,
  cornerR,
  chamferDeg = 45,
  coating,
  seriesCode,
  edpCode,
  darkMode = false,
  showDimensions = true,
  showGrid = false,
  className,
}: ToolBlueprintProps) {
  const gridId = useId()
  const pal = darkMode ? PALETTE.dark : PALETTE.light
  const effShank = shankDia ?? diameter
  const coatingLabel = resolveCoating(coating)
  const today = useMemo(() => formatDate(new Date()), [])

  // ─── SIDE VIEW 스케일링 ───────────────────────────────────────────────
  // 세로로 OAL, 가로로 직경. 외곽 여유 30px.
  const sideBoxX = 30
  const sideBoxY = HEADER_H + 14
  const sideBoxW = VIEW_W - 60
  const sideBoxH = SIDE_VIEW_BOTTOM - sideBoxY - 10

  // 가로 스케일: shank, diameter 중 큰 값에 맞춤. sideBoxW의 최대 40% 정도만 차지.
  const maxDiaMm = Math.max(diameter, effShank, 1)
  const hScale = (sideBoxW * 0.4) / maxDiaMm
  const diaPx = diameter * hScale
  const shankPx = effShank * hScale

  // 세로 스케일: OAL. sideBoxH의 85% 차지.
  const oalPx = sideBoxH * 0.85
  const vScale = oalPx / Math.max(OAL, 1)
  const locPx = Math.min(LOC * vScale, oalPx)
  const shankLenPx = oalPx - locPx

  const centerX = sideBoxX + sideBoxW / 2
  const sideTopY = sideBoxY + (sideBoxH - oalPx) / 2
  const locTopY = sideTopY + shankLenPx
  const sideBottomY = sideTopY + oalPx

  const shankLeftX = centerX - shankPx / 2
  const shankRightX = centerX + shankPx / 2
  const bodyLeftX = centerX - diaPx / 2
  const bodyRightX = centerX + diaPx / 2

  // ─── TIP path (shape별) ──────────────────────────────────────────────
  const tipPath = useMemo(() => {
    if (shape === "ball") {
      // 반원 (diaPx 지름)
      return `M ${bodyLeftX} ${sideBottomY} A ${diaPx / 2} ${diaPx / 2} 0 0 0 ${bodyRightX} ${sideBottomY}`
    }
    if (shape === "radius") {
      const maxR = diaPx / 2
      const rMm = Math.min(Math.max(cornerR ?? 0.5, 0.05), diameter / 2)
      const rPx = Math.min(rMm * hScale, maxR)
      return `M ${bodyLeftX} ${sideBottomY - rPx} Q ${bodyLeftX} ${sideBottomY} ${bodyLeftX + rPx} ${sideBottomY} L ${bodyRightX - rPx} ${sideBottomY} Q ${bodyRightX} ${sideBottomY} ${bodyRightX} ${sideBottomY - rPx}`
    }
    if (shape === "chamfer") {
      // 45도 기본, chamferDeg만큼 기울임. 대각선 길이 = diaPx * tan(90-deg)/2 근사
      const rad = (chamferDeg * Math.PI) / 180
      const cut = Math.min((diaPx / 2) * Math.tan(Math.PI / 2 - rad), diaPx * 0.35)
      return `M ${bodyLeftX} ${sideBottomY - cut} L ${centerX} ${sideBottomY} L ${bodyRightX} ${sideBottomY - cut}`
    }
    // square
    return `M ${bodyLeftX} ${sideBottomY} L ${bodyRightX} ${sideBottomY}`
  }, [shape, bodyLeftX, bodyRightX, sideBottomY, diaPx, cornerR, diameter, hScale, centerX, chamferDeg])

  // ─── flute helix stripe lines ───────────────────────────────────────
  // helixAngle 만큼 기울어진 line, flutes 수만큼 균등 분포.
  const fluteLines = useMemo(() => {
    const items: { x1: number; y1: number; x2: number; y2: number }[] = []
    const n = Math.max(flutes, 1)
    const rad = (helixAngle * Math.PI) / 180
    // 수평 오프셋 per vertical unit (기울기)
    const slope = Math.tan(Math.PI / 2 - rad) // 38° → 기울기 약 1.28 (수직 기준 작은 각)
    // helix는 양쪽 모두 보여야 하므로 여러 offset으로 반복.
    // stripe 간격: body 폭을 flutes*2로 나눔 (앞면/뒷면 교차)
    const stripeSpacing = diaPx / Math.max(n, 2)
    const totalVert = locPx
    // 기울어진 stripe: x(t) = x0 + slope * (locPx - (sideBottomY-y))
    // 여러 x0 offset에 대해 그린다. 시작점은 body 영역 밖까지 확장.
    const extraSpan = Math.abs(slope * totalVert)
    const xStart = bodyLeftX - extraSpan
    const xEnd = bodyRightX
    for (let x0 = xStart; x0 <= xEnd; x0 += stripeSpacing / 1.2) {
      // 각 stripe는 (x0, locTopY) → (x0 + slope*locPx, sideBottomY) 방향으로 그린다.
      const sx1 = x0
      const sy1 = locTopY
      const sx2 = x0 + slope * locPx
      const sy2 = sideBottomY - 1
      // body 영역으로 clip 되도록 stroke (SVG clipPath 사용)
      items.push({ x1: sx1, y1: sy1, x2: sx2, y2: sy2 })
    }
    return items
  }, [flutes, helixAngle, diaPx, locPx, bodyLeftX, bodyRightX, locTopY, sideBottomY])

  // ─── TOP VIEW (정면도) 배치 ─────────────────────────────────────────
  const topCenterX = VIEW_W / 2
  const topCenterY = (TOP_VIEW_TOP + TOP_VIEW_BOTTOM) / 2
  const topRadiusMaxPx = (TOP_VIEW_BOTTOM - TOP_VIEW_TOP) / 2 - 20
  const topScale = topRadiusMaxPx / Math.max(diameter / 2, 0.5)
  const topR = (diameter / 2) * topScale

  // flute 분할선 (flutes 수만큼)
  const fluteDividers = useMemo(() => {
    const lines: { x2: number; y2: number }[] = []
    const n = Math.max(flutes, 1)
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2 - Math.PI / 2
      lines.push({ x2: topCenterX + Math.cos(theta) * topR, y2: topCenterY + Math.sin(theta) * topR })
    }
    return lines
  }, [flutes, topCenterX, topCenterY, topR])

  // ─── SHAPE 서브라벨 (top view 힌트) ─────────────────────────────────
  const shapeHint = useMemo(() => {
    if (shape === "ball") return `R=${(diameter / 2).toFixed(2)}`
    if (shape === "radius") return `CR=${(cornerR ?? 0.5).toFixed(2)}`
    if (shape === "chamfer") return `${chamferDeg.toFixed(0)}°`
    return "FLAT"
  }, [shape, diameter, cornerR, chamferDeg])

  // ─── 타이틀 문구 ──────────────────────────────────────────────────
  const titleText = `TECHNICAL DRAWING · ${shape.toUpperCase()} END MILL · ⌀${diameter}mm`
  const shapeDisplay = shape.charAt(0).toUpperCase() + shape.slice(1)

  // ─── 치수선 좌표 ─────────────────────────────────────────────────
  // 좌측 세로 직경 D (측면도 기준) — body 왼쪽 옆에 수직
  const dimDiaLeftX = bodyLeftX - 14
  const dimOalRightX = shankRightX + 22
  const dimLocRightX = bodyRightX + 14

  const stampX = VIEW_W - 150
  const stampY = SIDE_VIEW_BOTTOM - 70
  const stampW = 130
  const stampH = 60

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={className}
      style={{ width: "100%", maxWidth: 520, display: "block", background: pal.bg }}
      role="img"
      aria-label={`${shape} 엔드밀 기술 도면, 직경 ${diameter}mm`}
    >
      {/* grid pattern (optional) */}
      {showGrid && (
        <>
          <defs>
            <pattern id={`grid-${gridId}`} width={10} height={10} patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke={pal.gridLine} strokeWidth={0.3} />
            </pattern>
          </defs>
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill={`url(#grid-${gridId})`} />
        </>
      )}

      {/* outer frame */}
      <rect
        x={4}
        y={4}
        width={VIEW_W - 8}
        height={VIEW_H - 8}
        fill="none"
        stroke={pal.stroke}
        strokeWidth={0.8}
      />
      <rect
        x={8}
        y={8}
        width={VIEW_W - 16}
        height={VIEW_H - 16}
        fill="none"
        stroke={pal.stroke}
        strokeWidth={0.4}
      />

      {/* header title bar */}
      <g>
        <line x1={12} y1={HEADER_H + 8} x2={VIEW_W - 12} y2={HEADER_H + 8} stroke={pal.stroke} strokeWidth={0.4} />
        <text
          x={VIEW_W / 2}
          y={HEADER_H + 2}
          textAnchor="middle"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize={10}
          fill={pal.text}
          letterSpacing={1}
          fontWeight={600}
        >
          {titleText}
        </text>
      </g>

      {/* divider between side view and top view */}
      <line
        x1={12}
        y1={SIDE_VIEW_BOTTOM + 4}
        x2={VIEW_W - 12}
        y2={SIDE_VIEW_BOTTOM + 4}
        stroke={pal.strokeFaint}
        strokeWidth={0.4}
        strokeDasharray="4 3"
      />
      <text
        x={16}
        y={SIDE_VIEW_BOTTOM + 1}
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={8}
        fill={pal.text}
        opacity={0.7}
      >
        SIDE VIEW
      </text>
      <text
        x={16}
        y={TOP_VIEW_TOP + 10}
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={8}
        fill={pal.text}
        opacity={0.7}
      >
        TOP VIEW (⌀{diameter}mm)
      </text>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SIDE VIEW                                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* center axis (dashed) */}
      <line
        x1={centerX}
        y1={sideTopY - 6}
        x2={centerX}
        y2={sideBottomY + 6}
        stroke={pal.stroke}
        strokeWidth={0.4}
        strokeDasharray="2 2 6 2"
        opacity={0.7}
      />

      {/* shank (얇은 수직 stripe) */}
      <rect
        x={shankLeftX}
        y={sideTopY}
        width={shankPx}
        height={shankLenPx}
        fill="none"
        stroke={pal.stroke}
        strokeWidth={0.9}
      />
      {/* shank 좌우 세로 line 강조 */}
      <line x1={shankLeftX} y1={sideTopY} x2={shankLeftX} y2={sideTopY + shankLenPx} stroke={pal.stroke} strokeWidth={1} />
      <line x1={shankRightX} y1={sideTopY} x2={shankRightX} y2={sideTopY + shankLenPx} stroke={pal.stroke} strokeWidth={1} />

      {/* shank-to-body 전이 (수평 line) */}
      <line x1={shankLeftX} y1={locTopY} x2={bodyLeftX} y2={locTopY} stroke={pal.stroke} strokeWidth={0.7} />
      <line x1={shankRightX} y1={locTopY} x2={bodyRightX} y2={locTopY} stroke={pal.stroke} strokeWidth={0.7} />

      {/* flute body rect (outline) + clipPath 용 */}
      <defs>
        <clipPath id={`body-clip-${gridId}`}>
          <rect x={bodyLeftX} y={locTopY} width={diaPx} height={locPx} />
        </clipPath>
      </defs>
      <rect
        x={bodyLeftX}
        y={locTopY}
        width={diaPx}
        height={locPx}
        fill="none"
        stroke={pal.stroke}
        strokeWidth={1}
      />

      {/* helix stripes (clipped to body) */}
      <g clipPath={`url(#body-clip-${gridId})`}>
        {fluteLines.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke={pal.stroke}
            strokeWidth={0.4}
            opacity={0.55}
          />
        ))}
      </g>

      {/* tip */}
      <path d={tipPath} fill="none" stroke={pal.stroke} strokeWidth={1} />

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 치수선 (ISO)                                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {showDimensions && (
        <g>
          {/* 좌측 세로: 직경 D (측면도 body 위치) */}
          {/* extension lines */}
          <line x1={bodyLeftX} y1={locTopY + locPx / 2} x2={dimDiaLeftX - 2} y2={locTopY + locPx / 2} stroke={pal.dim} strokeWidth={0.3} opacity={0.7} />
          <line x1={bodyRightX} y1={locTopY + locPx / 2} x2={bodyRightX + 10} y2={locTopY + locPx / 2} stroke={pal.dim} strokeWidth={0.3} opacity={0.7} />
          <DimLine
            x1={dimDiaLeftX}
            y1={locTopY + 4}
            x2={dimDiaLeftX}
            y2={sideBottomY - 4}
            label={`⌀${diameter.toFixed(2)}`}
            color={pal.dim}
            textColor={pal.dim}
            placement="left"
          />

          {/* 우측 세로 OAL */}
          <line x1={shankRightX} y1={sideTopY} x2={dimOalRightX + 2} y2={sideTopY} stroke={pal.dim} strokeWidth={0.3} opacity={0.7} />
          <line x1={bodyRightX} y1={sideBottomY} x2={dimOalRightX + 2} y2={sideBottomY} stroke={pal.dim} strokeWidth={0.3} opacity={0.7} />
          <DimLine
            x1={dimOalRightX}
            y1={sideTopY}
            x2={dimOalRightX}
            y2={sideBottomY}
            label={`OAL ${OAL.toFixed(1)}`}
            color={pal.dim}
            textColor={pal.dim}
            placement="right"
          />

          {/* 우측 중앙: LOC */}
          <DimLine
            x1={dimLocRightX}
            y1={locTopY}
            x2={dimLocRightX}
            y2={sideBottomY}
            label={`LOC ${LOC.toFixed(1)}`}
            color={pal.dim}
            textColor={pal.dim}
            placement="right"
          />

          {/* 샹크 직경 (상단 가로) */}
          <DimLine
            x1={shankLeftX}
            y1={sideTopY - 8}
            x2={shankRightX}
            y2={sideTopY - 8}
            label={`⌀${effShank.toFixed(2)} (shank)`}
            color={pal.dim}
            textColor={pal.dim}
            placement="above"
          />

          {/* 정면도 가로 직경 */}
          <DimLine
            x1={topCenterX - topR}
            y1={TOP_VIEW_BOTTOM + 6}
            x2={topCenterX + topR}
            y2={TOP_VIEW_BOTTOM + 6}
            label={`⌀${diameter.toFixed(2)}`}
            color={pal.dim}
            textColor={pal.dim}
            placement="below"
          />
        </g>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TOP VIEW (정면도)                                              */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* outer circle */}
      <circle cx={topCenterX} cy={topCenterY} r={topR} fill="none" stroke={pal.stroke} strokeWidth={1} />
      {/* center mark */}
      <line x1={topCenterX - 4} y1={topCenterY} x2={topCenterX + 4} y2={topCenterY} stroke={pal.stroke} strokeWidth={0.5} />
      <line x1={topCenterX} y1={topCenterY - 4} x2={topCenterX} y2={topCenterY + 4} stroke={pal.stroke} strokeWidth={0.5} />

      {/* flute pie dividers (with slight helix curve hint) */}
      {fluteDividers.map((l, i) => (
        <line
          key={i}
          x1={topCenterX}
          y1={topCenterY}
          x2={l.x2}
          y2={l.y2}
          stroke={pal.stroke}
          strokeWidth={0.6}
          opacity={0.8}
        />
      ))}

      {/* shape hint (중앙) */}
      <text
        x={topCenterX}
        y={topCenterY + topR + 22}
        textAnchor="middle"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={9}
        fill={pal.text}
      >
        {shape.toUpperCase()} · Z={flutes} · {shapeHint}
      </text>

      {/* radius 모서리 호 표시 */}
      {shape === "radius" && cornerR && (
        <g>
          <circle cx={topCenterX + topR - 6} cy={topCenterY} r={2} fill="none" stroke={pal.dim} strokeWidth={0.5} />
          <text
            x={topCenterX + topR + 4}
            y={topCenterY + 3}
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
            fontSize={8}
            fill={pal.dim}
          >
            CR{cornerR.toFixed(2)}
          </text>
        </g>
      )}

      {/* chamfer 각도 표기 */}
      {shape === "chamfer" && (
        <g>
          <circle cx={topCenterX} cy={topCenterY} r={topR + 4} fill="none" stroke={pal.dim} strokeWidth={0.3} strokeDasharray="2 2" />
          <text
            x={topCenterX + topR + 6}
            y={topCenterY - topR - 2}
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
            fontSize={8}
            fill={pal.dim}
          >
            {chamferDeg.toFixed(0)}°
          </text>
        </g>
      )}

      {/* ball 반경 표시 */}
      {shape === "ball" && (
        <text
          x={topCenterX}
          y={topCenterY - 4}
          textAnchor="middle"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize={8}
          fill={pal.dim}
        >
          R{(diameter / 2).toFixed(2)}
        </text>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* YG-1 브랜딩 스탬프 (우하단)                                    */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <g transform={`translate(${stampX} ${stampY})`}>
        <rect x={0} y={0} width={stampW} height={stampH} fill={pal.bg} stroke={pal.stamp} strokeWidth={0.8} />
        <rect x={2} y={2} width={stampW - 4} height={stampH - 4} fill="none" stroke={pal.stamp} strokeWidth={0.4} />
        <text
          x={stampW / 2}
          y={15}
          textAnchor="middle"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize={13}
          fontWeight={800}
          fill={pal.stamp}
          letterSpacing={2}
        >
          YG-1
        </text>
        <line x1={8} y1={18} x2={stampW - 8} y2={18} stroke={pal.stamp} strokeWidth={0.3} />
        <text
          x={stampW / 2}
          y={28}
          textAnchor="middle"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize={8}
          fill={pal.text}
        >
          {seriesCode ?? "END MILL"} · {shapeDisplay}
        </text>
        {edpCode && (
          <text
            x={stampW / 2}
            y={37}
            textAnchor="middle"
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
            fontSize={7}
            fill={pal.text}
            opacity={0.85}
          >
            EDP: {edpCode}
          </text>
        )}
        {coatingLabel && (
          <text
            x={stampW / 2}
            y={edpCode ? 45 : 37}
            textAnchor="middle"
            fontFamily="ui-monospace, Menlo, Consolas, monospace"
            fontSize={7}
            fill={pal.dim}
          >
            COATING: {coatingLabel}
          </text>
        )}
        <line x1={8} y1={stampH - 12} x2={stampW - 8} y2={stampH - 12} stroke={pal.stamp} strokeWidth={0.3} />
        <text
          x={6}
          y={stampH - 3}
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize={7}
          fill={pal.text}
          opacity={0.8}
        >
          MADE IN KOREA
        </text>
        <text
          x={stampW - 6}
          y={stampH - 3}
          textAnchor="end"
          fontFamily="ui-monospace, Menlo, Consolas, monospace"
          fontSize={7}
          fill={pal.text}
          opacity={0.8}
        >
          {today}
        </text>
      </g>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* 푸터                                                            */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <text
        x={VIEW_W - 14}
        y={FOOTER_Y}
        textAnchor="end"
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={7}
        fill={pal.text}
        opacity={0.7}
      >
        DRAWN: ARIA v3 · SCALE: NOT TO SCALE · UNITS: mm
      </text>
      <text
        x={14}
        y={FOOTER_Y}
        fontFamily="ui-monospace, Menlo, Consolas, monospace"
        fontSize={7}
        fill={pal.text}
        opacity={0.7}
      >
        HELIX {helixAngle.toFixed(0)}° · Z={flutes}
      </text>
    </svg>
  )
}

// ─── 샘플 데이터 (스토리북/데모용) ─────────────────────────────────────
export const YG1_SAMPLE_TOOLS = [
  {
    seriesCode: "GNX98",
    edpCode: "GNX98030",
    diameter: 3,
    shankDia: 6,
    LOC: 8,
    OAL: 50,
    flutes: 4,
    shape: "square" as const,
    helixAngle: 38,
    coating: "altin",
  },
  {
    seriesCode: "GNX98",
    edpCode: "GNX98050",
    diameter: 5,
    shankDia: 6,
    LOC: 13,
    OAL: 57,
    flutes: 4,
    shape: "square" as const,
    helixAngle: 38,
    coating: "altin",
  },
  {
    seriesCode: "GNX98",
    edpCode: "GNX98100",
    diameter: 10,
    shankDia: 10,
    LOC: 25,
    OAL: 72,
    flutes: 4,
    shape: "square" as const,
    helixAngle: 38,
    coating: "altin",
  },
  {
    seriesCode: "SEM845",
    edpCode: "SEM845060",
    diameter: 6,
    shankDia: 6,
    LOC: 13,
    OAL: 57,
    flutes: 2,
    shape: "ball" as const,
    helixAngle: 30,
    cornerR: 3,
    coating: "tin",
  },
  {
    seriesCode: "SEM846",
    edpCode: "SEM846080",
    diameter: 8,
    shankDia: 8,
    LOC: 19,
    OAL: 63,
    flutes: 4,
    shape: "radius" as const,
    helixAngle: 38,
    cornerR: 1,
    coating: "aicrn",
  },
]

export default ToolBlueprint
