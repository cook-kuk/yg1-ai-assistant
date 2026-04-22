// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Live Cutting Scene
// Canvas + requestAnimationFrame 기반 실시간 가공 장면 시각화.
// 슬라이더(Vc/fz/ap/ae) 변화에 맞춰 엔드밀/칩/스파크/진동 파티클이 동적 반응.
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"

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
const CHIP_SPAWN_HZ_MAX = 40
const CHIP_LIFETIME_MS = 1000
const MAX_CHIPS = 120

// 스파크
const SPARK_LIFETIME_MS = 450
const MAX_SPARKS = 80
const SPARK_VC_THRESHOLD = 250
const SPARK_VC_RED = 400

// 진동
const VIBRATION_AMPLITUDE_PX = 2

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
  darkMode?: boolean
  width?: number
  height?: number
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
    darkMode = false,
    width = DEFAULT_W,
    height = DEFAULT_H,
  } = props

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const chipsRef = useRef<Chip[]>([])
  const sparksRef = useRef<Spark[]>([])
  const lastChipSpawnRef = useRef<number>(0)
  const lastSparkSpawnRef = useRef<number>(0)
  const toolXRef = useRef<number>(0)
  const thetaRef = useRef<number>(0)
  const prevTsRef = useRef<number>(0)

  // props 를 ref 로 mirror — animation loop 이 prop 변경을 즉시 반영
  const propsRef = useRef(props)
  propsRef.current = props

  const [paused, setPaused] = useState<boolean>(false)
  const pausedRef = useRef<boolean>(false)
  pausedRef.current = paused

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

    if (pausedRef.current) {
      // paused: still clear not needed — just request next frame; keep scene
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    const p = propsRef.current

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
    const stockW = W - STOCK.xPad * 2
    const stockH = H - stockY - STOCK.bottomPad
    const tint = stockTintForGroup(p.materialGroup)

    // Tool path — x move by Vf
    const feedPxPerSec = p.Vf * (FEED_PX_PER_MM / 60) * FEED_VISUAL_MULTIPLIER
    toolXRef.current += feedPxPerSec * dt
    const pathStartX = stockX + 30
    const pathEndX = stockX + stockW - 30
    if (toolXRef.current > pathEndX - pathStartX) {
      toolXRef.current = 0
    }
    const toolCx = pathStartX + toolXRef.current + vib
    const toolDiaPx = toolPxForDiameter(p.diameter)
    const toolRadius = toolDiaPx / 2

    // 절삭된 자국: tool이 지나간 경로에 ae 깊이 slot
    const aePx = clamp(p.ae * TOOL_PX_PER_MM, 2, toolDiaPx)
    const apPx = clamp(p.ap * TOOL_PX_PER_MM, 1, stockH * 0.7)

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
    ctx.restore()

    // Stickout + shank
    const stickoutPx = stickoutPxFor(p.stickoutMm)
    const shankTopY = stockY - stickoutPx
    ctx.save()
    ctx.translate(vib, 0)
    ctx.strokeStyle = toolStroke
    ctx.lineWidth = 2
    ctx.fillStyle = darkMode ? "#475569" : "#cbd5e1"
    const shankW = Math.max(12, toolDiaPx * 0.7)
    ctx.fillRect(toolCx - shankW / 2, shankTopY - 20, shankW, stickoutPx - toolRadius + 20)
    ctx.strokeRect(toolCx - shankW / 2, shankTopY - 20, shankW, stickoutPx - toolRadius + 20)
    ctx.restore()

    // Tool body
    const toolCy = stockY - toolRadius + apPx * 0.5 // 절삭 깊이 만큼 잠김
    thetaRef.current += (p.rpm / 60) * Math.PI * 2 * ROTATION_VISUAL_MULTIPLIER * dt

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

    // Flute spokes
    ctx.strokeStyle = toolStroke
    ctx.lineWidth = 1.5
    const fluteCount = Math.max(2, Math.min(12, Math.round(p.flutes)))
    for (let i = 0; i < fluteCount; i++) {
      const ang = (i / fluteCount) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(ang) * toolRadius * 0.9, Math.sin(ang) * toolRadius * 0.9)
      ctx.stroke()
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
    ctx.moveTo(toolCx - aePx / 2, stockY - 2)
    ctx.lineTo(toolCx + aePx / 2, stockY - 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()

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
        ctx.arc(toolCx + vib, toolCy + vib, r, 0, Math.PI * 2)
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
      const dir = Math.random() < 0.5 ? -1 : 1
      const spread = (Math.random() - 0.5) * 1.2
      const speed = 60 + Math.random() * 40
      const chipSize = clamp(4 + p.ap * 0.3 + (p.Vf / p.rpm / p.flutes) * 30, 3, 14)
      chipsRef.current.push({
        x: toolCx + dir * toolRadius * 0.7,
        y: toolCy,
        vx: dir * speed + spread * 20,
        vy: -Math.abs(speed) * (0.6 + Math.random() * 0.4),
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
          x: toolCx,
          y: toolCy,
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

    rafRef.current = requestAnimationFrame(tick)
  }, [bgColor, gridColor, stockStrokeColor, toolFill, toolStroke, darkMode, shape])

  useEffect(() => {
    prevTsRef.current = 0
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [tick])

  const overlayTopLeft = useMemo(
    () =>
      `🎬 LIVE · Vc=${Math.round(Vc)}m/min · RPM=${Math.round(rpm)} · Vf=${Math.round(Vf)}mm/min`,
    [Vc, rpm, Vf],
  )
  const overlayBottomRight = useMemo(
    () => `chip=${chipMorph} · chatter=${chatterRisk}`,
    [chipMorph, chatterRisk],
  )

  const containerBg = darkMode ? "#020617" : "#ffffff"
  const textColor = darkMode ? "#f1f5f9" : "#0f172a"
  const chipBadgeBg = darkMode ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.82)"

  return (
    <div
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
          left: 16,
          top: 16,
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
        {overlayTopLeft}
      </div>

      {/* Bottom-right overlay */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 40,
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
        {overlayBottomRight}
      </div>

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
          (⌀{diameter}mm · Z{flutes} · ap={ap}mm · ae={ae}mm · stickout={stickoutMm}mm · {materialGroup})
        </span>
      </div>
    </div>
  )
}

export default LiveCuttingScene
