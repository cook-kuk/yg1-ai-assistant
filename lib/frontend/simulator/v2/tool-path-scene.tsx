// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Tool Path Scene (실시간 가공 경로 애니메이션)
//
// 상면도(top view)에서 공구가 공작물 위를 zigzag/spiral/trochoidal/adaptive 로
// 이동하며 경로가 실시간으로 그려진다. Vf(이송속도) 에 비례하여 애니메이션 속도 변화.
//
// 주의: cutting-simulator-v2.tsx 는 건드리지 않는다. 본 컴포넌트는 독립 마운트 가능.
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play, RotateCcw, Repeat } from "lucide-react"

// ─────────────────────────────────────────────
// 로컬 SSOT 상수 (외부 config 합치기 전까지 파일 내부에서 관리)
// ─────────────────────────────────────────────
const DEFAULT_WIDTH = 520
const DEFAULT_HEIGHT = 280
const SCENE_PADDING = 24          // 공작물 주변 여백 (px)
const REPLAY_DELAY_MS = 2000      // 완료 후 재시작 대기
const FLASH_DURATION_MS = 600     // 완료 플래시 길이
const VISUAL_SPEED_DIVISOR = 10   // Vf 실제의 1/10 배속 (너무 빠르면 보기 어려움)
const MIN_MM_PER_SEC = 2          // 최저 시각화 속도 (mm/s)
const MAX_MM_PER_SEC = 200        // 최고 시각화 속도 (mm/s)
const TROCHOIDAL_LOOP_SEGMENTS = 24
const ADAPTIVE_SEGMENTS = 48
const SPIRAL_SEGMENTS = 160
const TRAIL_POINTS = 22           // 공구 뒷꼬리 점 개수

// coating → 색 tint (간단 매핑)
const COATING_TINTS: Record<string, string> = {
  altin: "#fbbf24",   // gold
  tin:   "#f59e0b",
  ticn:  "#60a5fa",
  dlc:   "#a78bfa",
  uncoated: "#e5e7eb",
}

type Strategy = "zigzag" | "spiral" | "trochoidal" | "adaptive"
type Shape = "square" | "ball" | "radius" | "chamfer"

export interface ToolPathSceneProps {
  strategy: Strategy
  stockWidth: number     // mm (X)
  stockLength: number    // mm (Y)
  diameter: number       // mm
  ae: number             // mm (radial stepover)
  Vf: number             // mm/min
  shape: Shape
  darkMode?: boolean
  autoReplay?: boolean
  width?: number
  height?: number
  coating?: string       // optional coating key (e.g. "altin")
  className?: string
}

interface Pt { x: number; y: number }

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function dist(a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function formatSeconds(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0"
  return (ms / 1000).toFixed(1)
}

// ─────────────────────────────────────────────
// 경로 생성기 (mm 좌표계 기반 — 좌상단 (0,0), X→right, Y→down)
// 반환: polyline 포인트 배열 + 패스 수(totalPasses)
// ─────────────────────────────────────────────
function buildZigzagPath(w: number, l: number, ae: number): { pts: Pt[]; totalPasses: number } {
  const safeAe = Math.max(0.1, ae)
  const passes = Math.max(1, Math.ceil(l / safeAe))
  const pts: Pt[] = []
  for (let i = 0; i <= passes; i++) {
    const y = clamp(i * safeAe, 0, l)
    // 왕복: 짝수 pass → 좌→우, 홀수 pass → 우→좌
    const leftFirst = i % 2 === 0
    const xStart = leftFirst ? 0 : w
    const xEnd = leftFirst ? w : 0
    if (pts.length === 0) {
      pts.push({ x: xStart, y })
    } else {
      // 연결선 (stepover)
      pts.push({ x: pts[pts.length - 1]!.x, y })
    }
    pts.push({ x: xEnd, y })
  }
  return { pts, totalPasses: passes }
}

function buildSpiralPath(w: number, l: number, ae: number): { pts: Pt[]; totalPasses: number } {
  const cx = w / 2
  const cy = l / 2
  const rMax = Math.min(w, l) / 2
  const safeAe = Math.max(0.1, ae)
  // 아르키메데스 나선: r = a * theta → 한 바퀴 돌 때 r 증가량 = 2πa = ae
  const a = safeAe / (2 * Math.PI)
  const totalR = rMax
  const totalTheta = totalR / a
  const pts: Pt[] = []
  const segs = Math.max(SPIRAL_SEGMENTS, Math.ceil(totalTheta * 8))
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * totalTheta
    const r = a * t
    const x = clamp(cx + r * Math.cos(t), 0, w)
    const y = clamp(cy + r * Math.sin(t), 0, l)
    pts.push({ x, y })
  }
  const totalPasses = Math.max(1, Math.ceil(totalR / safeAe))
  return { pts, totalPasses }
}

function buildTrochoidalPath(w: number, l: number, ae: number): { pts: Pt[]; totalPasses: number } {
  // 작은 원 loop들이 X 방향으로 진행하며 Y 방향으로 zigzag 되는 복합 패턴
  const safeAe = Math.max(0.1, ae)
  const loopR = Math.max(safeAe * 1.2, 2) // 루프 반경 (mm)
  const advance = loopR * 0.9              // 루프 당 전진량 (mm)
  const rowCount = Math.max(1, Math.ceil(l / (loopR * 2.2)))
  const pts: Pt[] = []
  for (let row = 0; row < rowCount; row++) {
    const yc = clamp(loopR + row * loopR * 2.2, loopR, l - loopR)
    const leftToRight = row % 2 === 0
    const xStart = leftToRight ? loopR : w - loopR
    const xEnd = leftToRight ? w - loopR : loopR
    const dir = Math.sign(xEnd - xStart) || 1
    const loops = Math.max(1, Math.ceil(Math.abs(xEnd - xStart) / advance))
    for (let li = 0; li < loops; li++) {
      const cx = xStart + dir * advance * li
      // 원 그리기 (방향별 시작 각도 다르게)
      for (let s = 0; s <= TROCHOIDAL_LOOP_SEGMENTS; s++) {
        const theta = (s / TROCHOIDAL_LOOP_SEGMENTS) * Math.PI * 2
        const px = clamp(cx + loopR * Math.cos(theta) * dir, 0, w)
        const py = clamp(yc + loopR * Math.sin(theta), 0, l)
        pts.push({ x: px, y: py })
      }
    }
  }
  const totalPasses = rowCount
  return { pts, totalPasses }
}

function buildAdaptivePath(w: number, l: number, ae: number): { pts: Pt[]; totalPasses: number } {
  // 불규칙 곡선 근사: 여러 arc를 조합 (pseudo-random but deterministic)
  const safeAe = Math.max(0.1, ae)
  const rowCount = Math.max(2, Math.ceil(l / (safeAe * 1.6)))
  const pts: Pt[] = []
  let seed = 13 * rowCount + Math.round(w + l)
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let row = 0; row <= rowCount; row++) {
    const y0 = clamp((row / rowCount) * l, 0, l)
    const leftToRight = row % 2 === 0
    for (let s = 0; s <= ADAPTIVE_SEGMENTS; s++) {
      const u = s / ADAPTIVE_SEGMENTS
      const xRaw = leftToRight ? u * w : (1 - u) * w
      // y에 작은 wave + 랜덤 오프셋
      const wave = Math.sin(u * Math.PI * 3 + row * 0.7) * safeAe * 0.4
      const jitter = (rnd() - 0.5) * safeAe * 0.25
      const y = clamp(y0 + wave + jitter, 0, l)
      pts.push({ x: clamp(xRaw, 0, w), y })
    }
  }
  return { pts, totalPasses: rowCount }
}

function buildPath(strategy: Strategy, w: number, l: number, ae: number): { pts: Pt[]; totalPasses: number } {
  switch (strategy) {
    case "zigzag":     return buildZigzagPath(w, l, ae)
    case "spiral":     return buildSpiralPath(w, l, ae)
    case "trochoidal": return buildTrochoidalPath(w, l, ae)
    case "adaptive":   return buildAdaptivePath(w, l, ae)
    default:           return buildZigzagPath(w, l, ae)
  }
}

// 누적 거리 테이블 계산 (mm 단위)
function buildCumDist(pts: Pt[]): { cum: number[]; total: number } {
  const cum: number[] = new Array(pts.length).fill(0)
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += dist(pts[i - 1]!, pts[i]!)
    cum[i] = total
  }
  return { cum, total }
}

// 주어진 누적 거리(mm) 에서 pts 위 (x,y) 보간
function pointAtDistance(pts: Pt[], cum: number[], d: number): { p: Pt; idx: number } {
  if (pts.length === 0) return { p: { x: 0, y: 0 }, idx: 0 }
  if (d <= 0) return { p: pts[0]!, idx: 0 }
  const total = cum[cum.length - 1] ?? 0
  if (d >= total) return { p: pts[pts.length - 1]!, idx: pts.length - 1 }
  // binary search
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if ((cum[mid] ?? 0) <= d) lo = mid
    else hi = mid
  }
  const segStart = cum[lo] ?? 0
  const segEnd = cum[hi] ?? segStart
  const segLen = Math.max(1e-6, segEnd - segStart)
  const t = clamp((d - segStart) / segLen, 0, 1)
  const a = pts[lo]!
  const b = pts[hi]!
  return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, idx: lo }
}

// ─────────────────────────────────────────────
// React 컴포넌트
// ─────────────────────────────────────────────
export default function ToolPathScene({
  strategy,
  stockWidth,
  stockLength,
  diameter,
  ae,
  Vf,
  shape,
  darkMode = false,
  autoReplay = true,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  coating,
  className,
}: ToolPathSceneProps) {
  // ─── 기하 + 경로 (메모화) ─────────────────
  const { pts, totalPasses } = useMemo(
    () => buildPath(strategy, Math.max(1, stockWidth), Math.max(1, stockLength), Math.max(0.1, ae)),
    [strategy, stockWidth, stockLength, ae]
  )
  const { cum, total: totalMm } = useMemo(() => buildCumDist(pts), [pts])

  // ─── mm → px 스케일 (공작물 박스가 씬에 fit) ──
  const boxW = width - SCENE_PADDING * 2
  const boxH = height - SCENE_PADDING * 2 - 28 // 하단 진행 바 28px
  const scale = useMemo(() => {
    const sx = boxW / Math.max(1, stockWidth)
    const sy = boxH / Math.max(1, stockLength)
    return Math.max(0.1, Math.min(sx, sy))
  }, [boxW, boxH, stockWidth, stockLength])

  const drawW = stockWidth * scale
  const drawH = stockLength * scale
  const originX = SCENE_PADDING + (boxW - drawW) / 2
  const originY = SCENE_PADDING + (boxH - drawH) / 2

  const toMm = useCallback(
    (p: Pt): Pt => ({ x: originX + p.x * scale, y: originY + p.y * scale }),
    [originX, originY, scale]
  )

  // 전체 SVG path (preview + 진행선 공용)
  const fullPathD = useMemo(() => {
    if (pts.length === 0) return ""
    const head = toMm(pts[0]!)
    let d = `M ${head.x.toFixed(2)} ${head.y.toFixed(2)}`
    for (let i = 1; i < pts.length; i++) {
      const p = toMm(pts[i]!)
      d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    }
    return d
  }, [pts, toMm])

  // ─── 진행률 / 애니메이션 상태 ───────────────
  const [playing, setPlaying] = useState(true)
  const [replayOn, setReplayOn] = useState(autoReplay)
  const [progressMm, setProgressMm] = useState(0)
  const [flashAt, setFlashAt] = useState<number | null>(null)

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const replayTimerRef = useRef<number | null>(null)

  // autoReplay prop 변경 sync
  useEffect(() => {
    setReplayOn(autoReplay)
  }, [autoReplay])

  // strategy / stock 바뀌면 리셋
  useEffect(() => {
    setProgressMm(0)
    setFlashAt(null)
    lastTsRef.current = null
    if (replayTimerRef.current !== null) {
      window.clearTimeout(replayTimerRef.current)
      replayTimerRef.current = null
    }
  }, [strategy, stockWidth, stockLength, ae])

  // Vf → 시각화 mm/s
  const visualMmPerSec = useMemo(() => {
    const raw = (Vf / 60) / VISUAL_SPEED_DIVISOR
    return clamp(raw, MIN_MM_PER_SEC, MAX_MM_PER_SEC)
  }, [Vf])

  // 예상 총 시간(초) — 시각화 속도 기준
  const estimatedTotalSec = totalMm / Math.max(0.01, visualMmPerSec)

  // ─── RAF 루프 ───────────────────────────
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastTsRef.current = null
      return
    }
    const tick = (ts: number) => {
      const last = lastTsRef.current
      lastTsRef.current = ts
      const dtSec = last === null ? 0 : Math.min(0.1, (ts - last) / 1000)
      setProgressMm((prev) => {
        if (totalMm <= 0) return 0
        const next = prev + visualMmPerSec * dtSec
        if (next >= totalMm) {
          // 완료
          if (flashAt === null) setFlashAt(performance.now())
          return totalMm
        }
        return next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [playing, visualMmPerSec, totalMm, flashAt])

  // 완료 → replay 타이머
  useEffect(() => {
    if (progressMm < totalMm || totalMm <= 0) return
    if (!replayOn) return
    if (replayTimerRef.current !== null) return
    replayTimerRef.current = window.setTimeout(() => {
      setProgressMm(0)
      setFlashAt(null)
      lastTsRef.current = null
      replayTimerRef.current = null
    }, REPLAY_DELAY_MS)
    return () => {
      if (replayTimerRef.current !== null) {
        window.clearTimeout(replayTimerRef.current)
        replayTimerRef.current = null
      }
    }
  }, [progressMm, totalMm, replayOn])

  // 언마운트 cleanup
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (replayTimerRef.current !== null) window.clearTimeout(replayTimerRef.current)
    }
  }, [])

  // ─── 현재 공구 위치 + 꼬리 ─────────────────
  const toolNow = useMemo(() => {
    const { p, idx } = pointAtDistance(pts, cum, progressMm)
    return { p: toMm(p), idx }
  }, [pts, cum, progressMm, toMm])

  const trail = useMemo((): Pt[] => {
    const n = pts.length
    if (n === 0) return []
    const out: Pt[] = []
    const step = Math.max(0.5, visualMmPerSec * 0.04) // 40ms 간격 근사
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const d = progressMm - i * step
      if (d <= 0) break
      const { p } = pointAtDistance(pts, cum, d)
      out.push(toMm(p))
    }
    return out
  }, [pts, cum, progressMm, visualMmPerSec, toMm])

  // ─── 진행선 stroke-dash 기반 reveal ────────
  // SVG strokeDasharray: [진행px, 나머지px]. 경로 전체 px 길이 필요 — 비율로 근사.
  const pct = totalMm > 0 ? clamp(progressMm / totalMm, 0, 1) : 0
  const pctCompleted = Math.round(pct * 100)
  const remainingSec = Math.max(0, estimatedTotalSec * (1 - pct))
  const currentPass = Math.min(totalPasses, Math.max(1, Math.ceil(pct * totalPasses)))

  const completed = totalMm > 0 && progressMm >= totalMm
  const flashActive = flashAt !== null && performance.now() - flashAt < FLASH_DURATION_MS

  // ─── 색상 팔레트 ────────────────────────
  const bg = darkMode ? "#0f172a" : "#f8fafc"
  const stockFill = darkMode ? "#1e293b" : "#e2e8f0"
  const stockStroke = darkMode ? "#475569" : "#64748b"
  const previewStroke = darkMode ? "#334155" : "#cbd5e1"
  const progressStroke = completed ? "#f59e0b" : "#06b6d4" // 완료 amber, 진행 cyan
  const headGlow = "#10b981"
  const toolTint = (coating && COATING_TINTS[coating.toLowerCase()]) || (darkMode ? "#e2e8f0" : "#0f172a")
  const textColor = darkMode ? "#e2e8f0" : "#0f172a"
  const subText = darkMode ? "#94a3b8" : "#475569"

  // 공구 반지름 px (상면도 공구 원)
  const toolRadiusPx = Math.max(3, (diameter / 2) * scale)

  // 공구 shape별 하이라이트 (작은 보조 도형)
  const shapeDot = (() => {
    if (shape === "ball") return <circle cx={toolNow.p.x} cy={toolNow.p.y} r={toolRadiusPx * 0.35} fill={toolTint} opacity={0.5} />
    if (shape === "radius") return <circle cx={toolNow.p.x} cy={toolNow.p.y} r={toolRadiusPx * 0.55} fill="none" stroke={toolTint} strokeWidth={1.2} />
    if (shape === "chamfer") return <rect x={toolNow.p.x - toolRadiusPx * 0.4} y={toolNow.p.y - toolRadiusPx * 0.4} width={toolRadiusPx * 0.8} height={toolRadiusPx * 0.8} transform={`rotate(45 ${toolNow.p.x} ${toolNow.p.y})`} fill="none" stroke={toolTint} strokeWidth={1.2} />
    return null // square
  })()

  // ─── 핸들러 ────────────────────────────
  const togglePlay = useCallback(() => setPlaying((p) => !p), [])
  const reset = useCallback(() => {
    setProgressMm(0)
    setFlashAt(null)
    lastTsRef.current = null
    if (replayTimerRef.current !== null) {
      window.clearTimeout(replayTimerRef.current)
      replayTimerRef.current = null
    }
  }, [])
  const toggleReplay = useCallback(() => setReplayOn((r) => !r), [])

  // 진행 바 계산
  const progressBarY = height - SCENE_PADDING - 8
  const progressBarH = 6
  const progressBarX = SCENE_PADDING
  const progressBarW = width - SCENE_PADDING * 2

  // 경로 전체 path length 근사 (SVG 기본 getTotalLength 대신 pixel 비율 사용)
  const totalPathPx = useMemo(() => {
    if (pts.length < 2) return 0
    let acc = 0
    for (let i = 1; i < pts.length; i++) {
      const a = toMm(pts[i - 1]!)
      const b = toMm(pts[i]!)
      acc += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
    }
    return acc
  }, [pts, toMm])

  const dashLen = totalPathPx * pct

  return (
    <div
      className={className}
      style={{
        width: "100%",
        maxWidth: width,
        position: "relative",
        userSelect: "none",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        style={{
          background: bg,
          borderRadius: 10,
          display: "block",
          boxShadow: darkMode ? "0 1px 0 rgba(255,255,255,0.04) inset" : "0 1px 0 rgba(0,0,0,0.04) inset",
        }}
        role="img"
        aria-label={`Tool path animation (${strategy})`}
      >
        {/* 플래시 오버레이 */}
        {flashActive && (
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill={headGlow}
            opacity={0.15}
          />
        )}

        {/* 공작물 */}
        <rect
          x={originX}
          y={originY}
          width={drawW}
          height={drawH}
          fill={stockFill}
          stroke={stockStroke}
          strokeWidth={1.2}
          rx={3}
        />

        {/* 미완 경로 preview (점선 연한 회색) */}
        <path
          d={fullPathD}
          fill="none"
          stroke={previewStroke}
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.55}
        />

        {/* 진행 완료 경로 (진한 cyan/amber) — dash 기반 reveal */}
        <path
          d={fullPathD}
          fill="none"
          stroke={progressStroke}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${dashLen} ${Math.max(0, totalPathPx - dashLen)}`}
          style={{
            filter: completed ? "drop-shadow(0 0 4px rgba(245,158,11,0.55))" : undefined,
          }}
        />

        {/* 공구 꼬리 (trail) — emerald glow */}
        {trail.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={Math.max(1.2, toolRadiusPx * 0.35 * (1 - i / TRAIL_POINTS))}
            fill={headGlow}
            opacity={(1 - i / TRAIL_POINTS) * 0.5}
          />
        ))}

        {/* 공구 본체 (상면도 원) */}
        <circle
          cx={toolNow.p.x}
          cy={toolNow.p.y}
          r={toolRadiusPx}
          fill="none"
          stroke={toolTint}
          strokeWidth={1.6}
          opacity={0.95}
        />
        <circle
          cx={toolNow.p.x}
          cy={toolNow.p.y}
          r={Math.max(2, toolRadiusPx * 0.6)}
          fill={toolTint}
          opacity={0.25}
        />
        {/* 앞쪽 절입 포인트 (bright dot) */}
        <circle
          cx={toolNow.p.x}
          cy={toolNow.p.y}
          r={Math.max(1.6, toolRadiusPx * 0.2)}
          fill={headGlow}
        />
        {shapeDot}

        {/* 우상단: Vf / 패스 */}
        <text
          x={width - SCENE_PADDING}
          y={SCENE_PADDING - 6}
          textAnchor="end"
          fontSize={11}
          fill={subText}
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          Vf={Math.round(Vf)} mm/min · 패스 {currentPass}/{totalPasses}
        </text>

        {/* 좌하단: 전략 / Stock / ae */}
        <text
          x={SCENE_PADDING}
          y={height - SCENE_PADDING - 14}
          fontSize={11}
          fill={subText}
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          전략: {strategy} · Stock {Math.round(stockWidth)}×{Math.round(stockLength)}mm · ae={ae}mm
        </text>

        {/* 진행 바 배경 */}
        <rect
          x={progressBarX}
          y={progressBarY}
          width={progressBarW}
          height={progressBarH}
          fill={darkMode ? "#1e293b" : "#e2e8f0"}
          rx={3}
        />
        {/* 진행 바 채움 */}
        <rect
          x={progressBarX}
          y={progressBarY}
          width={progressBarW * pct}
          height={progressBarH}
          fill={completed ? "#f59e0b" : "#06b6d4"}
          rx={3}
        />
        {/* 남은 시간 + % */}
        <text
          x={width - SCENE_PADDING}
          y={progressBarY - 4}
          textAnchor="end"
          fontSize={10}
          fill={textColor}
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          예상 {formatSeconds(remainingSec * 1000)}초 · {pctCompleted}%
        </text>
      </svg>

      {/* 컨트롤 (좌상단 over SVG) */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          display: "flex",
          gap: 4,
          padding: "4px 6px",
          background: darkMode ? "rgba(15,23,42,0.7)" : "rgba(248,250,252,0.8)",
          backdropFilter: "blur(4px)",
          borderRadius: 6,
          border: `1px solid ${darkMode ? "#334155" : "#cbd5e1"}`,
        }}
      >
        <button
          type="button"
          onClick={togglePlay}
          title={playing ? "일시정지" : "재생"}
          aria-label={playing ? "일시정지" : "재생"}
          style={btnStyle(darkMode)}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          onClick={reset}
          title="리셋"
          aria-label="리셋"
          style={btnStyle(darkMode)}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          onClick={toggleReplay}
          title={replayOn ? "replay ON" : "replay OFF"}
          aria-label="replay 토글"
          style={{
            ...btnStyle(darkMode),
            color: replayOn ? "#10b981" : (darkMode ? "#94a3b8" : "#64748b"),
          }}
        >
          <Repeat size={14} />
        </button>
      </div>
    </div>
  )
}

function btnStyle(darkMode: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    background: "transparent",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    color: darkMode ? "#e2e8f0" : "#0f172a",
    padding: 0,
  }
}
