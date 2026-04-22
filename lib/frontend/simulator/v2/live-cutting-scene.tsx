// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Live Cutting Scene
// Canvas + requestAnimationFrame 기반 실시간 가공 장면 시각화.
// 슬라이더(Vc/fz/ap/ae) 변화에 맞춰 엔드밀/칩/스파크/진동 파티클이 동적 반응.
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { LiveIndicator } from "./live-indicator"

// ─────────────────────────────────────────────
// 로컬 SSOT (하드코딩 대신 이 파일 상수로 집약)
// ─────────────────────────────────────────────
const DEFAULT_W = 640
const DEFAULT_H = 300

// 공작물 배치 — canvas 하단
const STOCK = {
  xPad: 40,
  topRatio: 0.58,   // canvas 높이 대비 공작물 상단 y
  bottomPad: 30,
} as const

// 공구 시각 스케일: diameter(mm) → px
const TOOL_PX_PER_MM = 3.2
const MAX_TOOL_PX = 140
const MIN_TOOL_PX = 24

// Stickout 스케일
const STICKOUT_PX_PER_MM = 0.9
const MAX_STICKOUT_PX = 120

// Feed 이동 — Vf mm/min 을 canvas px/sec 로 환산
const FEED_PX_PER_MM = 2.2
const FEED_VISUAL_MULTIPLIER = 0.25 // 실 Vf 대비 시각 감속

// Rotation visual — rpm/60 rad/s 는 너무 빠르므로 감속
const ROTATION_VISUAL_MULTIPLIER = 0.08

// 칩 스폰 빈도 제한 (flute × rpm/60 Hz 너무 높으면 눈에 안 보임)
// UI 성능 최적화를 위해 파티클 상한 하향
const CHIP_SPAWN_HZ_MAX = 30
const CHIP_LIFETIME_MS = 1000
const MAX_CHIPS = 80

// 스파크
const SPARK_LIFETIME_MS = 450
const MAX_SPARKS = 50
const SPARK_VC_THRESHOLD = 250
const SPARK_VC_RED = 400

// 진동
const VIBRATION_AMPLITUDE_PX = 2

// ─────────────────────────────────────────────
// 안정화 (댐핑) — raw prop 대신 lerp 된 값으로 렌더해 Vf/rpm 슬라이더를
// 확 움직였을 때 공구가 급가속/급감속하며 딱딱해 보이는 것을 방지.
// tau 는 exponential decay 시간상수 (초) — 90% 도달 ≈ 2.3 × tau.
const FEED_SMOOTH_TAU_SEC = 0.16
const RPM_SMOOTH_TAU_SEC = 0.18

// 부러짐 애니메이션 임계. breakProgress 0→1 누적, 최대치에서 crack
// 오버레이 + 카오틱 쉐이크 + 적색 파편 버스트 발동.
const BREAK_VC_THRESHOLD = 380        // m/min — chatter high 와 AND 조건
const BREAK_FEED_RATIO_THRESHOLD = 7  // Vf / (diameter·60) — OR 조건
const BREAK_RAMP_SEC = 1.5            // 트리거 지속 시 0→1 까지 걸리는 시간
const BREAK_DECAY_SEC = 0.9           // 해제 시 1→0 감쇠
const BREAK_BURST_INTERVAL_MS = 180

// 경로 양끝 fade 구간 — 하드 리셋 시 텔레포트 티 안 나게.
const PATH_EDGE_FADE_RATIO = 0.05

// 컬러 팔레트
const STOCK_TINT: Record<string, string> = {
  P: "#6b7280", // steel-gray
  M: "#71717a", // stainless-gray
  K: "#57534e", // cast-iron warmer
  N: "#a8a29e", // aluminum bright
  S: "#44403c", // nickel darker
  H: "#3f3f46", // hardened darker
}
const STOCK_TINT_DEFAULT = "#64748b"

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type LiveShape = "square" | "ball" | "radius" | "chamfer"
export type ChatterRisk = "low" | "med" | "high"
export type BueRisk = "none" | "low" | "mid" | "high"
export type ChipMorph = "continuous" | "segmented" | "discontinuous" | "bue"

export interface LiveCuttingSceneProps {
  shape: LiveShape
  diameter: number
  flutes: number
  helixAngle?: number
  Vc: number
  Vf: number
  rpm: number
  ap: number
  ae: number
  stickoutMm: number
  materialGroup: string
  chatterRisk: ChatterRisk
  bueRisk?: BueRisk
  chipMorph?: ChipMorph
  viewMode?: "side" | "top"
  stockLengthMm?: number
  stockWidthMm?: number
  stockHeightMm?: number
  roughPasses?: number
  finishPasses?: number
  toolPathStrategy?: "zigzag" | "spiral" | "trochoidal" | "adaptive" | "slot"
  darkMode?: boolean
  width?: number
  height?: number
  compact?: boolean
}

interface Chip {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  morph: ChipMorph
  size: number
  color: string
  rot: number
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  born: number
  red: boolean
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function chipColorByVc(Vc: number): string {
  if (Vc < 100) return "#cbd5e1"       // silver
  if (Vc < 250) return "#facc15"       // yellow
  if (Vc < 400) return "#fb923c"       // orange
  return "#ef4444"                      // red
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function stockTintForGroup(g: string): string {
  const key = (g ?? "").trim().toUpperCase().charAt(0)
  return STOCK_TINT[key] ?? STOCK_TINT_DEFAULT
}

function toolPxForDiameter(d: number): number {
  return clamp(d * TOOL_PX_PER_MM, MIN_TOOL_PX, MAX_TOOL_PX)
}

function stickoutPxFor(mm: number): number {
  return clamp(mm * STICKOUT_PX_PER_MM, 10, MAX_STICKOUT_PX)
}

// ─────────────────────────────────────────────
// Chip shape drawing
// ─────────────────────────────────────────────
function drawChip(ctx: CanvasRenderingContext2D, c: Chip, alpha: number): void {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(c.x, c.y)
  ctx.rotate(c.rot)
  ctx.fillStyle = c.color
  ctx.strokeStyle = c.color
  ctx.lineWidth = 1.2

  switch (c.morph) {
    case "continuous": {
      // 스프링 스파이럴
      ctx.beginPath()
      const turns = 2
      const steps = 18
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const angle = t * Math.PI * 2 * turns
        const r = c.size * (0.3 + t * 0.7)
        const px = Math.cos(angle) * r
        const py = Math.sin(angle) * r * 0.4
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      break
    }
    case "segmented": {
      // 톱니
      ctx.beginPath()
      const teeth = 4
      for (let i = 0; i < teeth; i++) {
        const x0 = (-c.size) + (i * c.size * 2) / teeth
        ctx.moveTo(x0, 0)
        ctx.lineTo(x0 + c.size / teeth, -c.size * 0.6)
        ctx.lineTo(x0 + (2 * c.size) / teeth, 0)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case "discontinuous": {
      // 작은 점 3개
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath()
        ctx.arc(i * c.size * 0.5, 0, c.size * 0.22, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }
    case "bue": {
      // 뭉친 덩어리
      ctx.beginPath()
      ctx.moveTo(0, -c.size)
      ctx.lineTo(c.size, c.size * 0.8)
      ctx.lineTo(-c.size, c.size * 0.8)
      ctx.closePath()
      ctx.fill()
      break
    }
  }
  ctx.restore()
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
export function LiveCuttingScene(props: LiveCuttingSceneProps) {
  const {
    shape,
    diameter,
    flutes,
    helixAngle = 38,
    Vc,
    Vf,
    rpm,
    ap,
    ae,
    stickoutMm,
    materialGroup,
    chatterRisk,
    bueRisk = "none",
    chipMorph = "continuous",
    viewMode = "side",
    stockLengthMm = 80,
    stockWidthMm = 50,
    stockHeightMm = 20,
    roughPasses = 1,
    finishPasses = 2,
    toolPathStrategy = "zigzag",
    darkMode = false,
    width = DEFAULT_W,
    height = DEFAULT_H,
    compact = false,
  } = props

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const chipsRef = useRef<Chip[]>([])
  const sparksRef = useRef<Spark[]>([])
  const lastChipSpawnRef = useRef<number>(0)
  const lastSparkSpawnRef = useRef<number>(0)
  const toolXRef = useRef<number>(0)
  const thetaRef = useRef<number>(0)
  const prevTsRef = useRef<number>(0)
  const propsRef = useRef(props)

  // 댐핑 refs — smoothedVf/Rpm 를 tick() 에서 lerp 하여 렌더 (raw prop 대신).
  // 슬라이더 큰 변화에도 공구 속도가 tau 시간에 걸쳐 부드럽게 수렴.
  const smoothedVfRef = useRef<number>(props.Vf)
  const smoothedRpmRef = useRef<number>(props.rpm)

  // 부러짐 진행도 0..1. 극한 조건에서 누적 → 공구 렌더에 crack + shake +
  // 파편 버스트. Badge 는 5Hz throttled state 로 노출 (React 리렌더 최소화).
  const breakProgressRef = useRef<number>(0)
  const lastBreakBurstRef = useRef<number>(0)
  const lastBadgeUpdateRef = useRef<number>(0)
  const [breakBadgeLevel, setBreakBadgeLevel] = useState<"safe" | "warn" | "danger">("safe")

  const [paused, setPaused] = useState<boolean>(false)
  const pausedRef = useRef<boolean>(false)
  const [isInViewport, setIsInViewport] = useState(true)
  const [isDocumentVisible, setIsDocumentVisible] = useState(true)
  const shouldAnimateRef = useRef(true)

  useEffect(() => {
    propsRef.current = props
  }, [props])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (typeof document === "undefined") return
    const onVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden")
    }
    onVisibilityChange()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [])

  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry?.isIntersecting ?? true)
      },
      { threshold: 0.08 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // 배경색
  const bgColor = darkMode ? "#0f172a" : "#f1f5f9"
  const gridColor = darkMode ? "#1e293b" : "#e2e8f0"
  const stockStrokeColor = darkMode ? "#cbd5e1" : "#334155"
  const toolFill = darkMode ? "#94a3b8" : "#e2e8f0"
  const toolStroke = darkMode ? "#e2e8f0" : "#1f2937"
  const captionColor = darkMode ? "#cbd5e1" : "#475569"

  // ─────────────────────────────────────────────
  // Render loop
  // ─────────────────────────────────────────────
  const tick = useCallback((ts: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    const W = canvas.width
    const H = canvas.height

    const dtMs = prevTsRef.current === 0 ? 16 : ts - prevTsRef.current
    prevTsRef.current = ts
    const dt = Math.min(dtMs, 64) / 1000 // cap 64ms (to avoid huge steps after tab-hidden)

    if (!shouldAnimateRef.current || pausedRef.current) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    const p = propsRef.current

    // ─── 댐핑: Vf/rpm 을 tau 시간상수로 lerp 하여 smoothed 값 유지 ──
    // 슬라이더 급변에도 공구가 jerky 하지 않게. 렌더·스폰·피드 계산에
    // 아래 smVf/smRpm 사용 (raw p.Vf/p.rpm 대신).
    const vfAlpha = 1 - Math.exp(-dt / FEED_SMOOTH_TAU_SEC)
    const rpmAlpha = 1 - Math.exp(-dt / RPM_SMOOTH_TAU_SEC)
    smoothedVfRef.current += (p.Vf - smoothedVfRef.current) * vfAlpha
    smoothedRpmRef.current += (p.rpm - smoothedRpmRef.current) * rpmAlpha
    const smVf = smoothedVfRef.current
    const smRpm = smoothedRpmRef.current

    // ─── 부러짐 진행도 업데이트 ────────────────────────────────────
    // 트리거 조건:
    //   (A) chatterRisk high AND Vc > 380 m/min
    //   (B) feedRatio = Vf / (D·60) > 7  (초고속 feed 대비 소경)
    // 지속되면 BREAK_RAMP_SEC 에 걸쳐 0→1, 해제되면 DECAY_SEC 에 1→0.
    const feedRatio = p.diameter > 0 ? p.Vf / (p.diameter * 60) : 0
    const breakTrigger =
      (p.chatterRisk === "high" && p.Vc > BREAK_VC_THRESHOLD) ||
      feedRatio > BREAK_FEED_RATIO_THRESHOLD
    breakProgressRef.current = clamp(
      breakTrigger
        ? breakProgressRef.current + dt / BREAK_RAMP_SEC
        : breakProgressRef.current - dt / BREAK_DECAY_SEC,
      0,
      1,
    )
    const breakProg = breakProgressRef.current

    // Badge state 는 5Hz 로 throttle — RAF 마다 setState 하면 React
    // 리렌더가 폭증하므로 200ms 간격으로만 전이 반영.
    if (ts - lastBadgeUpdateRef.current > 200) {
      lastBadgeUpdateRef.current = ts
      const nextLevel: "safe" | "warn" | "danger" =
        breakProg >= 0.7 ? "danger" : breakProg >= 0.35 ? "warn" : "safe"
      setBreakBadgeLevel(prev => (prev === nextLevel ? prev : nextLevel))
    }

    // Background
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)

    // Subtle grid
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    const gridStep = 40
    for (let x = 0; x <= W; x += gridStep) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
      ctx.stroke()
    }
    for (let y = 0; y <= H; y += gridStep) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }

    // Vibration offset
    const vib = p.chatterRisk === "high"
      ? Math.sin(ts / 30) * VIBRATION_AMPLITUDE_PX
      : 0

    // Stock geometry
    const stockX = STOCK.xPad
    const stockY = H * STOCK.topRatio
    const stockLengthSafe = Math.max(10, p.stockLengthMm ?? stockLengthMm)
    const stockWidthSafe = Math.max(6, p.stockWidthMm ?? stockWidthMm)
    const stockHeightSafe = Math.max(3, p.stockHeightMm ?? stockHeightMm)
    const stockEnvelopeW = W - STOCK.xPad * 2
    const stockEnvelopeH = H - stockY - STOCK.bottomPad
    const stockLengthRatio = clamp(stockLengthSafe / Math.max(stockLengthSafe, stockWidthSafe), 0.45, 1)
    const stockHeightRatio = clamp(stockHeightSafe / Math.max(stockLengthSafe * 0.35, 1), 0.12, 0.5)
    const stockW = clamp(stockEnvelopeW * stockLengthRatio, stockEnvelopeW * 0.58, stockEnvelopeW)
    const stockH = clamp(stockEnvelopeH * (0.45 + stockHeightRatio), stockEnvelopeH * 0.28, stockEnvelopeH * 0.88)
    const tint = stockTintForGroup(p.materialGroup)

    // Tool path — x move by Vf
    const feedPxPerSec = p.Vf * (FEED_PX_PER_MM / 60) * FEED_VISUAL_MULTIPLIER
    toolXRef.current += feedPxPerSec * dt
    const pathStartX = stockX + 30
    const pathEndX = stockX + stockW - 30
    const pathSpanX = pathEndX - pathStartX
    if (toolXRef.current > pathSpanX) {
      toolXRef.current = 0
    }
    const linearProgress = clamp(pathSpanX <= 0 ? 0 : toolXRef.current / pathSpanX, 0, 0.9995)
    const toolCx = pathStartX + toolXRef.current + vib
    const toolDiaPx = toolPxForDiameter(p.diameter)
    const toolRadius = toolDiaPx / 2

    // 절삭된 자국: tool이 지나간 경로에 ae 깊이 slot
    const aePx = clamp(p.ae * TOOL_PX_PER_MM, 4, toolDiaPx)
    const apPx = clamp(p.ap * TOOL_PX_PER_MM, 3, stockH * 0.7)
    const engagementRatio = clamp(aePx / Math.max(toolDiaPx, 1), 0.08, 1)
    const helixAngleLive = clamp(p.helixAngle ?? helixAngle, 20, 55)
    const helixSkew = ((helixAngleLive - 20) / 35) * toolRadius * 0.9
    const fluteCount = Math.max(2, Math.min(12, Math.round(p.flutes)))
    const flutePatternLabel = fluteCount <= 2 ? "wide chip" : fluteCount === 3 ? "triple balance" : fluteCount === 4 ? "general purpose" : fluteCount === 5 ? "dense finish" : "micro pitch"
    const fluteSpraySpread = fluteCount <= 2 ? 1.45 : fluteCount === 3 ? 1.15 : fluteCount === 4 ? 0.95 : fluteCount === 5 ? 0.78 : 0.62
    let renderToolCx = toolCx
    let renderToolCy = stockY - toolRadius + apPx * 0.5

    if (viewMode === "top") {
      const topStockY = H * 0.22
      const topStockH = clamp(H * (0.22 + Math.min(0.38, stockWidthSafe / Math.max(stockLengthSafe, 1) * 0.42)), H * 0.28, H * 0.58)
      const topToolHalfW = aePx * 0.5
      const topToolHalfH = toolRadius * 0.68
      const topRowPitch = Math.max(aePx * 0.95, 12)
      const widthDrivenRows = Math.ceil(stockWidthSafe / Math.max(p.ae, 0.2))
      const topRowCount = clamp(
        Math.max(2, Math.floor((topStockH - aePx) / topRowPitch) + 1, widthDrivenRows, (p.roughPasses ?? roughPasses) * 2),
        2,
        18,
      )
      const laneProgress = linearProgress * topRowCount
      const currentLane = Math.min(topRowCount - 1, Math.floor(laneProgress))
      const laneLocalProgress = clamp(laneProgress - currentLane, 0, 1)
      const topLaneStartY = topStockY + aePx * 0.5
      const topLaneEndY = topStockY + topStockH - aePx * 0.5
      const topLaneY = clamp(topLaneStartY + currentLane * topRowPitch, topLaneStartY, topLaneEndY)
      const laneForward = currentLane % 2 === 0
      const topLaneX = laneForward
        ? pathStartX + laneLocalProgress * pathSpanX
        : pathEndX - laneLocalProgress * pathSpanX
      renderToolCx = topLaneX + vib
      renderToolCy = topLaneY + vib

      ctx.save()
      ctx.translate(vib, 0)
      ctx.fillStyle = tint
      ctx.strokeStyle = stockStrokeColor
      ctx.lineWidth = 1.5
      ctx.fillRect(stockX, topStockY, stockW, topStockH)
      ctx.strokeRect(stockX, topStockY, stockW, topStockH)

      for (let lane = 0; lane < topRowCount; lane++) {
        const laneY = clamp(topLaneStartY + lane * topRowPitch, topLaneStartY, topLaneEndY)
        const laneIsForward = lane % 2 === 0
        let cutStart = pathStartX
        let cutWidth = 0
        if (lane < currentLane) {
          cutWidth = pathSpanX
        } else if (lane === currentLane) {
          cutWidth = laneLocalProgress * pathSpanX
          cutStart = laneIsForward ? pathStartX : pathEndX - cutWidth
        }
        if (cutWidth <= 0) continue

        ctx.fillStyle = darkMode ? "#020617" : "#1e293b"
        ctx.fillRect(cutStart, laneY - aePx * 0.5, cutWidth, aePx)
        ctx.fillStyle = darkMode ? "rgba(56,189,248,0.1)" : "rgba(14,165,233,0.1)"
        ctx.fillRect(cutStart, laneY - aePx * 0.5, cutWidth, Math.max(2, aePx * 0.24))
      }

      ctx.strokeStyle = darkMode ? "rgba(56,189,248,0.45)" : "rgba(14,165,233,0.5)"
      ctx.lineWidth = 1.1
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      for (let lane = 0; lane < topRowCount; lane++) {
        const laneY = clamp(topLaneStartY + lane * topRowPitch, topLaneStartY, topLaneEndY)
        const laneFromX = lane % 2 === 0 ? pathStartX : pathEndX
        const laneToX = lane % 2 === 0 ? pathEndX : pathStartX
        if (lane === 0) ctx.moveTo(laneFromX, laneY)
        else ctx.lineTo(laneFromX, laneY)
        ctx.lineTo(laneToX, laneY)
      }
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = darkMode ? "rgba(56,189,248,0.18)" : "rgba(14,165,233,0.18)"
      ctx.fillRect(topLaneX - aePx * 0.5, topLaneY - aePx * 0.5, aePx, aePx)
      ctx.restore()

      ctx.save()
      ctx.translate(renderToolCx, renderToolCy)
      ctx.rotate(thetaRef.current)
      ctx.fillStyle = toolFill
      ctx.strokeStyle = toolStroke
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(0, 0, topToolHalfW, topToolHalfH, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      for (let i = 0; i < fluteCount; i++) {
        const ang = (i / fluteCount) * Math.PI * 2
        ctx.beginPath()
        ctx.moveTo(Math.cos(ang) * topToolHalfW * 0.2, Math.sin(ang) * topToolHalfH * 0.2)
        ctx.lineTo(Math.cos(ang) * topToolHalfW, Math.sin(ang) * topToolHalfH)
        ctx.stroke()
      }
      ctx.restore()
    } else {
      // Stock body
      ctx.save()
      ctx.translate(vib, 0)
      ctx.fillStyle = tint
      ctx.strokeStyle = stockStrokeColor
      ctx.lineWidth = 1.5
      ctx.fillRect(stockX, stockY, stockW, stockH)
      ctx.strokeRect(stockX, stockY, stockW, stockH)

      // Groove (이미 지나간 경로만)
      ctx.fillStyle = darkMode ? "#020617" : "#1e293b"
      const grooveEndX = Math.min(toolCx - vib, pathEndX)
      const grooveStartX = pathStartX
      const grooveW = Math.max(0, grooveEndX - grooveStartX)
      ctx.fillRect(grooveStartX, stockY, grooveW, apPx)
      ctx.fillStyle = darkMode ? "rgba(56,189,248,0.16)" : "rgba(14,165,233,0.16)"
      ctx.fillRect(Math.max(grooveStartX, toolCx - aePx), stockY, aePx, apPx)
      ctx.restore()
    }

    // Stickout + shank
    const stickoutPx = stickoutPxFor(p.stickoutMm)
    const shankTopY = stockY - stickoutPx
    if (viewMode !== "top") {
      ctx.save()
      ctx.translate(vib, 0)
      ctx.strokeStyle = toolStroke
      ctx.lineWidth = 2
      ctx.fillStyle = darkMode ? "#475569" : "#cbd5e1"
      const shankW = Math.max(12, toolDiaPx * 0.7)
      ctx.fillRect(toolCx - shankW / 2, shankTopY - 20, shankW, stickoutPx - toolRadius + 20)
      ctx.strokeRect(toolCx - shankW / 2, shankTopY - 20, shankW, stickoutPx - toolRadius + 20)
      ctx.restore()
    }

    // Tool body
    const toolCy = stockY - toolRadius + apPx * 0.5 // 절삭 깊이 만큼 잠김
    thetaRef.current += (p.rpm / 60) * Math.PI * 2 * ROTATION_VISUAL_MULTIPLIER * dt

    if (viewMode !== "top") {
      ctx.save()
      ctx.translate(toolCx, toolCy + vib)
      ctx.rotate(thetaRef.current)

    ctx.fillStyle = toolFill
    ctx.strokeStyle = toolStroke
    ctx.lineWidth = 2

    // Shape variants
    if (shape === "ball") {
      ctx.beginPath()
      ctx.arc(0, 0, toolRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else if (shape === "radius") {
      ctx.beginPath()
      ctx.moveTo(-toolRadius, -toolRadius)
      ctx.lineTo(toolRadius, -toolRadius)
      ctx.lineTo(toolRadius, toolRadius * 0.5)
      ctx.quadraticCurveTo(toolRadius, toolRadius, toolRadius * 0.5, toolRadius)
      ctx.lineTo(-toolRadius * 0.5, toolRadius)
      ctx.quadraticCurveTo(-toolRadius, toolRadius, -toolRadius, toolRadius * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else if (shape === "chamfer") {
      ctx.beginPath()
      ctx.moveTo(-toolRadius, -toolRadius)
      ctx.lineTo(toolRadius, -toolRadius)
      ctx.lineTo(toolRadius * 0.7, toolRadius)
      ctx.lineTo(-toolRadius * 0.7, toolRadius)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    } else {
      // square
      ctx.beginPath()
      ctx.arc(0, 0, toolRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Engagement zone
    ctx.save()
    ctx.translate(toolCx, toolCy + vib)
    ctx.fillStyle = darkMode ? "rgba(56,189,248,0.24)" : "rgba(14,165,233,0.22)"
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(
      0,
      0,
      toolRadius * 0.98,
      Math.PI - engagementRatio * Math.PI,
      Math.PI,
    )
    ctx.closePath()
    ctx.fill()
      ctx.restore()
    }

    // Helical flute arcs
    ctx.strokeStyle = toolStroke
    ctx.lineWidth = 1.35
    for (let i = 0; i < fluteCount; i++) {
      const ang = (i / fluteCount) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(ang) * toolRadius * 0.2, Math.sin(ang) * toolRadius * 0.2)
      ctx.bezierCurveTo(
        Math.cos(ang + 0.25) * toolRadius * 0.55,
        Math.sin(ang + 0.25) * toolRadius * 0.4 - helixSkew * 0.15,
        Math.cos(ang + 0.45) * toolRadius * 0.8,
        Math.sin(ang + 0.45) * toolRadius * 0.7 + helixSkew * 0.15,
        Math.cos(ang + 0.62) * toolRadius * 0.92,
        Math.sin(ang + 0.62) * toolRadius * 0.92,
      )
      ctx.stroke()

      ctx.save()
      ctx.fillStyle = i % 2 === 0 ? "#38bdf8" : "#f59e0b"
      ctx.beginPath()
      ctx.arc(
        Math.cos(ang + 0.62) * toolRadius * 0.98,
        Math.sin(ang + 0.62) * toolRadius * 0.98,
        fluteCount >= 5 ? 1.8 : 2.4,
        0,
        Math.PI * 2,
      )
      ctx.fill()
      ctx.restore()
    }

    // Center dot
    ctx.fillStyle = toolStroke
    ctx.beginPath()
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // ae indicator — 공구 밑 칼날 폭
    ctx.save()
    ctx.translate(vib, 0)
    ctx.strokeStyle = darkMode ? "#fbbf24" : "#d97706"
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    if (viewMode === "top") {
      ctx.moveTo(toolCx - aePx, H / 2 - aePx * 0.7)
      ctx.lineTo(toolCx, H / 2 - aePx * 0.7)
    } else {
      ctx.moveTo(toolCx - aePx, stockY - 2)
      ctx.lineTo(toolCx, stockY - 2)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

    // Helix lean guide on shank
    if (viewMode !== "top") {
      ctx.save()
      ctx.translate(vib, 0)
      ctx.strokeStyle = darkMode ? "#38bdf8" : "#0284c7"
      ctx.lineWidth = 1.4
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(toolCx, shankTopY - 14)
      ctx.lineTo(toolCx + helixSkew * 0.55, toolCy - toolRadius * 0.7)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
    }

    // ─────────────────────────────────────────────
    // Chatter wave rings
    // ─────────────────────────────────────────────
    if (p.chatterRisk === "high") {
      const wavePhase = (ts / 400) % 1
      for (let i = 0; i < 3; i++) {
        const r = toolRadius + (wavePhase + i * 0.33) * 40
        const alpha = clamp(1 - ((wavePhase + i * 0.33) % 1), 0, 1) * 0.4
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = "#ef4444"
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.arc(renderToolCx, renderToolCy, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    // ─────────────────────────────────────────────
    // Chip spawn
    // ─────────────────────────────────────────────
    const rawSpawnHz = p.flutes * (p.rpm / 60)
    const spawnHz = clamp(rawSpawnHz, 1, CHIP_SPAWN_HZ_MAX)
    const spawnIntervalMs = 1000 / spawnHz
    if (ts - lastChipSpawnRef.current >= spawnIntervalMs && chipsRef.current.length < MAX_CHIPS) {
      lastChipSpawnRef.current = ts
      const morph: ChipMorph = p.bueRisk === "high" ? "bue" : (p.chipMorph ?? "continuous")
      const color = morph === "bue" ? "#ca8a04" : chipColorByVc(p.Vc)
      const flutePhase = ((ts / 1000) * Math.max(1, p.rpm / 600)) % fluteCount
      const chipBaseAngle = -Math.PI / 2 + ((flutePhase / fluteCount) * Math.PI * 2)
      const spread = (Math.random() - 0.5) * fluteSpraySpread
      const dir = Math.cos(chipBaseAngle) >= 0 ? 1 : -1
      const speed = 54 + Math.random() * (fluteCount <= 2 ? 70 : fluteCount >= 5 ? 28 : 46)
      const chipSize = clamp((fluteCount <= 2 ? 7 : fluteCount === 3 ? 6 : fluteCount === 4 ? 5 : fluteCount === 5 ? 4 : 3) + p.ap * 0.18 + (p.Vf / p.rpm / p.flutes) * 24, 2.5, 16)
      chipsRef.current.push({
        x: renderToolCx + dir * toolRadius * 0.7,
        y: renderToolCy,
        vx: Math.cos(chipBaseAngle + spread) * speed,
        vy: Math.sin(chipBaseAngle + spread) * speed - Math.abs(speed) * 0.18,
        born: ts,
        morph,
        size: chipSize,
        color,
        rot: Math.random() * Math.PI * 2,
      })
    }

    // Update + draw chips
    const gravity = 220 // px/s^2
    const nextChips: Chip[] = []
    for (const c of chipsRef.current) {
      const age = ts - c.born
      if (age > CHIP_LIFETIME_MS) continue
      c.vy += gravity * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.rot += dt * 3
      if (c.y > H + 20) continue
      const alpha = clamp(1 - age / CHIP_LIFETIME_MS, 0, 1)
      drawChip(ctx, c, alpha)
      nextChips.push(c)
    }
    chipsRef.current = nextChips

    // ─────────────────────────────────────────────
    // Sparks
    // ─────────────────────────────────────────────
    const wantSparks = p.Vc > SPARK_VC_THRESHOLD || p.bueRisk === "high"
    if (wantSparks) {
      const vcNorm = clamp((p.Vc - SPARK_VC_THRESHOLD) / 300, 0, 1)
      const sparkHz = 10 + vcNorm * 40 // 10~50Hz
      const sparkInterval = 1000 / sparkHz
      if (
        ts - lastSparkSpawnRef.current >= sparkInterval &&
        sparksRef.current.length < MAX_SPARKS
      ) {
        lastSparkSpawnRef.current = ts
        const red = p.Vc > SPARK_VC_RED || p.chatterRisk === "high"
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI
        const spd = 80 + Math.random() * 120
        sparksRef.current.push({
          x: renderToolCx,
          y: renderToolCy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          born: ts,
          red: red && Math.random() < 0.45,
        })
      }
    }

    const nextSparks: Spark[] = []
    for (const s of sparksRef.current) {
      const age = ts - s.born
      if (age > SPARK_LIFETIME_MS) continue
      s.vy += gravity * 0.6 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      const alpha = clamp(1 - age / SPARK_LIFETIME_MS, 0, 1)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = s.red ? "#ef4444" : "#fde047"
      ctx.beginPath()
      ctx.arc(s.x, s.y, 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      nextSparks.push(s)
    }
    sparksRef.current = nextSparks

    if (shouldAnimateRef.current) {
      rafRef.current = requestAnimationFrame(tick)
    } else {
      rafRef.current = null
    }
  }, [bgColor, gridColor, stockStrokeColor, toolFill, toolStroke, darkMode, shape])

  const animationState = paused
    ? "paused"
    : isDocumentVisible && isInViewport
      ? "active"
      : "sleeping"

  useEffect(() => {
    shouldAnimateRef.current = isDocumentVisible && isInViewport
    if (!shouldAnimateRef.current) {
      prevTsRef.current = 0
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }
    prevTsRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isDocumentVisible, isInViewport, tick])

  const overlayTopLeft = useMemo(
    () =>
      compact
        ? `LIVE · ${viewMode === "top" ? "TOP" : "SIDE"}`
        : `🎬 LIVE · Vc=${Math.round(Vc)}m/min · RPM=${Math.round(rpm)} · Vf=${Math.round(Vf)}mm/min`,
    [Vc, rpm, Vf, compact, viewMode],
  )
  const overlayBottomRight = useMemo(
    () =>
      compact
        ? `R${roughPasses}/F${finishPasses} · ${toolPathStrategy}`
        : `chip=${chipMorph} · chatter=${chatterRisk} · helix=${Math.round(helixAngle)}°${viewMode === "top" ? ` · ${toolPathStrategy === "slot" ? "slot scan" : toolPathStrategy}` : ""}`,
    [chipMorph, chatterRisk, helixAngle, viewMode, compact, flutes, roughPasses, finishPasses, toolPathStrategy],
  )
  const overlayBottomLeft = useMemo(
    () => `Z${Math.round(flutes)} · ${Math.round(helixAngle)}° · ${Math.round(stickoutMm)}mm · ${Math.round(stockLengthMm)}×${Math.round(stockWidthMm)}×${Math.round(stockHeightMm)}`,
    [flutes, helixAngle, stickoutMm, stockLengthMm, stockWidthMm, stockHeightMm],
  )
  const flutePatternText = useMemo(
    () => {
      const safeFlutes = Math.max(2, Math.min(12, Math.round(flutes)))
      return safeFlutes <= 2 ? "wide chip pattern" : safeFlutes === 3 ? "balanced triple" : safeFlutes === 4 ? "general 4F" : safeFlutes === 5 ? "dense 5F" : "micro-pitch 6F+"
    },
    [flutes],
  )

  const containerBg = darkMode ? "#020617" : "#ffffff"
  const textColor = darkMode ? "#f1f5f9" : "#0f172a"
  const chipBadgeBg = darkMode ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.82)"

  return (
    <div
      ref={rootRef}
      data-live-state={animationState}
      data-removal-signature={`${Math.round(stockLengthMm)}x${Math.round(stockWidthMm)}x${Math.round(stockHeightMm)}-r${roughPasses}-f${finishPasses}-${toolPathStrategy}`}
      style={{
        position: "relative",
        width,
        background: containerBg,
        borderRadius: 12,
        padding: 8,
        boxShadow: darkMode
          ? "0 1px 2px rgba(0,0,0,0.4)"
          : "0 1px 2px rgba(15,23,42,0.08)",
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          width,
          height,
          display: "block",
          borderRadius: 8,
        }}
        aria-label="실시간 가공 시뮬레이션"
        role="img"
      />

      {/* Top-left overlay */}
      <div
        style={{
          position: "absolute",
          left: compact ? 10 : 16,
          top: compact ? 10 : 16,
          padding: compact ? "3px 8px" : "4px 10px",
          borderRadius: 999,
          fontSize: compact ? 10 : 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: chipBadgeBg,
          color: textColor,
          border: darkMode ? "1px solid #334155" : "1px solid #e2e8f0",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: compact ? 4 : 6,
          maxWidth: compact ? "44%" : undefined,
          whiteSpace: compact ? "nowrap" : undefined,
        }}
      >
        <LiveIndicator watch={[rpm, Vf, Vc, ap, ae]} color="emerald" darkMode={darkMode} />
        <span>{overlayTopLeft}</span>
      </div>

      {/* Bottom-right overlay */}
      <div
        style={{
          position: "absolute",
          right: compact ? 10 : 16,
          top: compact ? 10 : undefined,
          bottom: compact ? undefined : 40,
          padding: compact ? "3px 8px" : "4px 10px",
          borderRadius: 999,
          fontSize: compact ? 10 : 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: chipBadgeBg,
          color: textColor,
          border: darkMode ? "1px solid #334155" : "1px solid #e2e8f0",
          pointerEvents: "none",
          maxWidth: compact ? "44%" : undefined,
          whiteSpace: compact ? "nowrap" : undefined,
        }}
      >
        {overlayBottomRight}
      </div>

      {!compact && (
        <>
          {/* Pause button — bottom-left */}
          <button
            type="button"
            onClick={() => setPaused((prev) => !prev)}
            aria-label={paused ? "재생" : "일시정지"}
            style={{
              position: "absolute",
              left: 16,
              bottom: 40,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              background: chipBadgeBg,
              color: textColor,
              border: darkMode ? "1px solid #334155" : "1px solid #e2e8f0",
              cursor: "pointer",
            }}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? "재생" : "정지"}
          </button>

          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 72,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              background: chipBadgeBg,
              color: textColor,
              border: darkMode ? "1px solid #334155" : "1px solid #e2e8f0",
              pointerEvents: "none",
            }}
          >
            {overlayBottomLeft} · {viewMode === "top" ? "TOP" : "SIDE"}
          </div>

          {/* Caption */}
          <div
            style={{
              marginTop: 6,
              textAlign: "center",
              fontSize: 11,
              color: captionColor,
            }}
          >
            🎬 실시간 가공 시뮬레이션 · 슬라이더를 움직여보세요
            {" "}
            <span style={{ opacity: 0.7 }}>
              (⌀{diameter}mm · Z{flutes} · helix={helixAngle}° · ap={ap}mm · ae={ae}mm · stickout={stickoutMm}mm · {materialGroup})
            </span>
            {" "}
            <span style={{ opacity: 0.72 }}>· {flutePatternText} · {viewMode === "top" ? "top-down stock view" : "side travel view"}</span>
          </div>
        </>
      )}
    </div>
  )
}

export default LiveCuttingScene
