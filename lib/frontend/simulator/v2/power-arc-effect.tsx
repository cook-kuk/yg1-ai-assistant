// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Power Arc Effect
// 공구-공작물 절삭 지점의 파워(Pc) 시각화:
//   • 전기 아크(번개) — zigzag path + Perlin-like jitter + glow/white core
//   • 불꽃 스파크   — radial particles with gravity + temperature gradient color
//   • 열 파동      — sinusoidal aurora ripple
//   • 중앙 코어 glow — pulse + riskLevel color + critical shake
//   • 번개 플래시  — high intensity 시 drastically short white frame
//
// 성능: Canvas 2D + requestAnimationFrame, 파티클/아크 useRef (렌더 영향 없음).
// prefers-reduced-motion: 아크/스파크/플래시 비활성, 코어 glow만 유지.
// SSR safe: "use client" + typeof window guard.
"use client"

import { useEffect, useMemo, useRef } from "react"

// ─────────────────────────────────────────────
// Local SSOT (하드코딩 대신 상수로 집약)
// ─────────────────────────────────────────────
const TARGET_FPS = 60
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS

// 전기 아크
const ARC_INTENSITY_THRESHOLD = 30    // 이 % 미만이면 아크 미생성
const ARC_MIN_COUNT = 2               // intensity=30 기준
const ARC_MAX_COUNT = 8               // intensity=100 기준
const ARC_SEGMENTS_MIN = 10
const ARC_SEGMENTS_MAX = 22
const ARC_JITTER_AMP_PX = 22          // 수직 jitter 최대 진폭
const ARC_LIFETIME_MIN_MS = 80
const ARC_LIFETIME_MAX_MS = 120
const ARC_SPAWN_BASE_HZ = 2           // 초당 기본 스폰 (intensity=30 기준)
const ARC_SPAWN_MAX_HZ = 28           // intensity=100 기준
const ARC_CORE_WIDTH_PX = 1.2
const ARC_GLOW_WIDTH_PX = 6

// 불꽃 스파크
const SPARK_MAX = 60
const SPARK_SPAWN_BASE_HZ = 4         // intensity=1 기준
const SPARK_SPAWN_MAX_HZ = 140        // intensity=100 기준
const SPARK_SPEED_MIN = 60            // px/sec
const SPARK_SPEED_MAX = 260
const SPARK_GRAVITY_PX_S2 = 340
const SPARK_DRAG = 0.92               // per-frame damping (60fps)
const SPARK_LIFETIME_MIN_MS = 420
const SPARK_LIFETIME_MAX_MS = 900
const SPARK_RADIUS_MIN = 0.8
const SPARK_RADIUS_MAX = 2.6

// 열 파동 (aurora ripple)
const HEAT_RING_COUNT = 4
const HEAT_MAX_OPACITY = 0.3          // intensity=100 기준
const HEAT_DRIFT_HZ = 0.15            // 초당 사이클

// 중앙 코어 glow
const CORE_RADIUS_FRAC = 0.22         // canvas min(w,h) 대비
const CORE_PULSE_MIN = 0.9
const CORE_PULSE_MAX = 1.1
const CORE_PULSE_HZ = 1.6
const CORE_SHAKE_AMP_PX = 3           // critical 시

// 플래시
const FLASH_INTENSITY_THRESHOLD = 80
const FLASH_BASE_HZ = 0.4             // 80%일 때
const FLASH_MAX_HZ = 2.2              // 100%일 때
const FLASH_DURATION_MS = 10

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type PowerArcTheme = "blue" | "electric" | "plasma" | "fire"
export type PowerArcRiskLevel = "safe" | "warning" | "critical"

export interface PowerArcEffectProps {
  intensity: number // 0~100 (Pc %)
  riskLevel?: PowerArcRiskLevel
  theme?: PowerArcTheme
  width?: number
  height?: number
  darkMode?: boolean
}

interface ThemePalette {
  arcCore: string          // center highlight (보통 white or near-white)
  arcGlow: string          // outer glow (rgb string w/o alpha)
  coreHot: string          // core glow radial center
  coreEdge: string         // core glow radial edge
  sparkStages: string[]    // [white, yellow, orange, red] gradient stops
  heatTint: string         // heat ripple stroke rgb
}

// 테마별 팔레트 (SSOT)
const THEMES: Record<PowerArcTheme, ThemePalette> = {
  blue: {
    arcCore: "255,255,255",
    arcGlow: "59,130,246",          // #3b82f6
    coreHot: "6,182,212",           // cyan
    coreEdge: "29,78,216",          // indigo-700
    sparkStages: ["255,255,255", "191,219,254", "96,165,250", "30,64,175"],
    heatTint: "59,130,246",
  },
  electric: {
    arcCore: "255,255,255",
    arcGlow: "34,211,238",          // #22d3ee
    coreHot: "255,255,255",
    coreEdge: "14,165,233",
    sparkStages: ["255,255,255", "224,242,254", "34,211,238", "14,116,144"],
    heatTint: "34,211,238",
  },
  plasma: {
    arcCore: "255,255,255",
    arcGlow: "168,85,247",          // #a855f7
    coreHot: "233,213,255",
    coreEdge: "126,34,206",
    sparkStages: ["255,255,255", "233,213,255", "168,85,247", "88,28,135"],
    heatTint: "168,85,247",
  },
  fire: {
    arcCore: "255,255,224",
    arcGlow: "249,115,22",          // #f97316
    coreHot: "254,215,170",
    coreEdge: "154,52,18",
    sparkStages: ["255,255,240", "253,224,71", "249,115,22", "153,27,27"],
    heatTint: "249,115,22",
  },
}

// riskLevel별 코어 색 오버라이드 (테마 color 대신 우선)
const RISK_CORE: Record<PowerArcRiskLevel, { hot: string; edge: string }> = {
  safe:     { hot: "103,232,249", edge: "8,145,178" },      // cyan
  warning:  { hot: "253,224,71",  edge: "180,83,9" },       // amber
  critical: { hot: "254,202,202", edge: "185,28,28" },      // red
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  bornMs: number
  lifeMs: number
  // color gradient 참조용 stage index 가중치
  stageSeed: number // 0..1
}

interface Arc {
  points: { x: number; y: number }[]
  bornMs: number
  lifeMs: number
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** "r,g,b" 두 문자열을 선형 보간 */
function lerpRgbString(a: string, b: string, t: number): string {
  const as = a.split(",").map(Number)
  const bs = b.split(",").map(Number)
  const r = Math.round(lerp(as[0] ?? 255, bs[0] ?? 255, t))
  const g = Math.round(lerp(as[1] ?? 255, bs[1] ?? 255, t))
  const bch = Math.round(lerp(as[2] ?? 255, bs[2] ?? 255, t))
  return `${r},${g},${bch}`
}

/** intensity(0~100) → arc 개수 (30 이하는 0) */
function arcCountForIntensity(intensity: number): number {
  if (intensity < ARC_INTENSITY_THRESHOLD) return 0
  const t = (intensity - ARC_INTENSITY_THRESHOLD) / (100 - ARC_INTENSITY_THRESHOLD)
  return Math.round(lerp(ARC_MIN_COUNT, ARC_MAX_COUNT, clamp(t, 0, 1)))
}

/** intensity(0~100) → 아크 스폰 Hz */
function arcSpawnHz(intensity: number): number {
  if (intensity < ARC_INTENSITY_THRESHOLD) return 0
  const t = (intensity - ARC_INTENSITY_THRESHOLD) / (100 - ARC_INTENSITY_THRESHOLD)
  return lerp(ARC_SPAWN_BASE_HZ, ARC_SPAWN_MAX_HZ, clamp(t, 0, 1))
}

/** intensity(0~100) → spark spawn Hz */
function sparkSpawnHz(intensity: number): number {
  if (intensity <= 0) return 0
  const t = clamp(intensity / 100, 0, 1)
  return lerp(SPARK_SPAWN_BASE_HZ, SPARK_SPAWN_MAX_HZ, t)
}

/** 아크 경로 생성: (cx,cy) 중심 양쪽으로 zigzag */
function makeArcPath(
  cx: number,
  cy: number,
  halfLen: number,
  angle: number,
): { x: number; y: number }[] {
  const segs = Math.round(rand(ARC_SEGMENTS_MIN, ARC_SEGMENTS_MAX))
  const pts: { x: number; y: number }[] = []
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  // perp vector
  const px = -sinA
  const py = cosA
  for (let i = 0; i <= segs; i++) {
    const tt = i / segs
    // -halfLen..+halfLen
    const along = lerp(-halfLen, halfLen, tt)
    // jitter shape: 중앙에서 더 크고 양끝은 좁게 (sin envelope)
    const envelope = Math.sin(tt * Math.PI) // 0..1..0
    const jitter = (Math.random() - 0.5) * 2 * ARC_JITTER_AMP_PX * envelope
    const bx = cx + cosA * along + px * jitter
    const by = cy + sinA * along + py * jitter
    pts.push({ x: bx, y: by })
  }
  return pts
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function PowerArcEffect({
  intensity,
  riskLevel = "safe",
  theme = "electric",
  width,
  height,
  darkMode = true,
}: PowerArcEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number>(0)
  const reducedMotionRef = useRef<boolean>(false)

  const sparksRef = useRef<Spark[]>([])
  const arcsRef = useRef<Arc[]>([])
  const arcSpawnAccumRef = useRef<number>(0)
  const sparkSpawnAccumRef = useRef<number>(0)
  const flashAccumRef = useRef<number>(0)
  const flashUntilRef = useRef<number>(0)

  const sizeRef = useRef<{ w: number; h: number }>({ w: width ?? 600, h: height ?? 400 })

  const palette = useMemo(() => THEMES[theme], [theme])
  const risk = useMemo(() => RISK_CORE[riskLevel], [riskLevel])

  // intensity는 루프 내에서 최신값 참조되도록 ref 동기화
  const intensityRef = useRef<number>(intensity)
  intensityRef.current = intensity
  const riskRef = useRef<PowerArcRiskLevel>(riskLevel)
  riskRef.current = riskLevel

  useEffect(() => {
    if (typeof window === "undefined") return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // reduced motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotionRef.current = mq.matches
    const onMqChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches
    }
    mq.addEventListener("change", onMqChange)

    // resize 핸들러 — width/height prop 없으면 container full 사용
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      let w = width ?? 0
      let h = height ?? 0
      if (!w || !h) {
        const el = containerRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          if (!w) w = Math.max(1, Math.floor(rect.width))
          if (!h) h = Math.max(1, Math.floor(rect.height))
        }
      }
      // 최소 보정
      w = Math.max(1, w || 600)
      h = Math.max(1, h || 400)
      sizeRef.current = { w, h }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    // ResizeObserver (container full 모드 대응)
    let ro: ResizeObserver | null = null
    if (!width || !height) {
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        ro = new ResizeObserver(() => resize())
        ro.observe(containerRef.current)
      }
      window.addEventListener("resize", resize)
    }

    const spawnArc = (cx: number, cy: number) => {
      const { w, h } = sizeRef.current
      const halfLen = Math.min(w, h) * 0.42
      const angle = rand(0, Math.PI * 2)
      const pts = makeArcPath(cx, cy, halfLen, angle)
      arcsRef.current.push({
        points: pts,
        bornMs: performance.now(),
        lifeMs: rand(ARC_LIFETIME_MIN_MS, ARC_LIFETIME_MAX_MS),
      })
      // 개수 상한: arcCountForIntensity 의 2배까지만 보관
      const maxKeep = Math.max(4, arcCountForIntensity(intensityRef.current) * 2)
      if (arcsRef.current.length > maxKeep) {
        arcsRef.current.splice(0, arcsRef.current.length - maxKeep)
      }
    }

    const spawnSpark = (cx: number, cy: number) => {
      if (sparksRef.current.length >= SPARK_MAX) return
      const ang = rand(0, Math.PI * 2)
      const sp = rand(SPARK_SPEED_MIN, SPARK_SPEED_MAX)
      sparksRef.current.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - rand(20, 80), // 위로 살짝 편향
        r: rand(SPARK_RADIUS_MIN, SPARK_RADIUS_MAX),
        bornMs: performance.now(),
        lifeMs: rand(SPARK_LIFETIME_MIN_MS, SPARK_LIFETIME_MAX_MS),
        stageSeed: Math.random(),
      })
    }

    // 메인 draw
    const draw = (timestamp: number) => {
      const last = lastFrameRef.current || timestamp
      const elapsed = timestamp - last
      if (elapsed < FRAME_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrameRef.current = timestamp
      const dt = Math.min(elapsed, 80) / 1000 // seconds

      const { w, h } = sizeRef.current
      const cx = w / 2
      const cy = h / 2
      const reduced = reducedMotionRef.current
      const I = clamp(intensityRef.current, 0, 100)
      const curRisk = riskRef.current
      const riskColors = RISK_CORE[curRisk]

      // clear
      ctx.clearRect(0, 0, w, h)

      // ── 1. 열 파동 (heat ripple) ──
      if (!reduced && I > 0) {
        const maxOpacity = (I / 100) * HEAT_MAX_OPACITY
        const tSec = timestamp / 1000
        const baseR = Math.min(w, h) * 0.3
        for (let i = 0; i < HEAT_RING_COUNT; i++) {
          const phase = tSec * HEAT_DRIFT_HZ * Math.PI * 2 + (i * Math.PI * 2) / HEAT_RING_COUNT
          const rr = baseR + Math.sin(phase) * baseR * 0.35 + i * 18
          const ringAlpha = maxOpacity * (1 - i / HEAT_RING_COUNT) * (0.55 + 0.45 * Math.sin(phase * 0.7))
          if (ringAlpha <= 0.005) continue
          ctx.beginPath()
          ctx.strokeStyle = `rgba(${palette.heatTint},${ringAlpha.toFixed(3)})`
          ctx.lineWidth = 2
          ctx.arc(cx, cy, rr, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // ── 2. 중앙 코어 glow ──
      {
        const pulsePhase = (timestamp / 1000) * CORE_PULSE_HZ * Math.PI * 2
        const pulse = reduced
          ? 1.0
          : lerp(CORE_PULSE_MIN, CORE_PULSE_MAX, (Math.sin(pulsePhase) + 1) / 2)
        const baseR = Math.min(w, h) * CORE_RADIUS_FRAC
        const r = baseR * pulse * (0.6 + 0.4 * (I / 100))
        let ox = 0
        let oy = 0
        if (!reduced && curRisk === "critical") {
          ox = (Math.random() - 0.5) * 2 * CORE_SHAKE_AMP_PX
          oy = (Math.random() - 0.5) * 2 * CORE_SHAKE_AMP_PX
        }
        const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r)
        grad.addColorStop(0, `rgba(${riskColors.hot},0.95)`)
        grad.addColorStop(0.35, `rgba(${palette.coreHot},0.55)`)
        grad.addColorStop(0.75, `rgba(${riskColors.edge},0.22)`)
        grad.addColorStop(1, `rgba(${palette.coreEdge},0)`)
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── 3. 전기 아크 ──
      if (!reduced && I >= ARC_INTENSITY_THRESHOLD) {
        // spawn scheduling
        const spawnHz = arcSpawnHz(I)
        arcSpawnAccumRef.current += dt * spawnHz
        let safety = 0
        while (arcSpawnAccumRef.current >= 1 && safety < 16) {
          arcSpawnAccumRef.current -= 1
          safety++
          // 아크 최대 개수 초과 시 스폰 skip
          const maxArcs = arcCountForIntensity(I)
          if (arcsRef.current.length < maxArcs * 2) {
            spawnArc(cx, cy)
          }
        }
        // 렌더 + 수명 관리
        const surviving: Arc[] = []
        for (const a of arcsRef.current) {
          const age = timestamp - a.bornMs
          if (age > a.lifeMs) continue
          surviving.push(a)
          const lifeT = age / a.lifeMs // 0..1
          const fade = 1 - lifeT // linear
          // outer glow
          ctx.save()
          ctx.lineCap = "round"
          ctx.lineJoin = "round"
          ctx.shadowColor = `rgba(${palette.arcGlow},${(0.8 * fade).toFixed(3)})`
          ctx.shadowBlur = 14
          ctx.strokeStyle = `rgba(${palette.arcGlow},${(0.55 * fade).toFixed(3)})`
          ctx.lineWidth = ARC_GLOW_WIDTH_PX
          ctx.beginPath()
          for (let i = 0; i < a.points.length; i++) {
            const p = a.points[i]!
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          }
          ctx.stroke()
          // white core
          ctx.shadowBlur = 4
          ctx.shadowColor = `rgba(${palette.arcCore},${(0.9 * fade).toFixed(3)})`
          ctx.strokeStyle = `rgba(${palette.arcCore},${(0.95 * fade).toFixed(3)})`
          ctx.lineWidth = ARC_CORE_WIDTH_PX
          ctx.beginPath()
          for (let i = 0; i < a.points.length; i++) {
            const p = a.points[i]!
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          }
          ctx.stroke()
          ctx.restore()
        }
        arcsRef.current = surviving
      } else {
        // reduced or low intensity: arcs 클리어
        if (arcsRef.current.length) arcsRef.current = []
        arcSpawnAccumRef.current = 0
      }

      // ── 4. 불꽃 스파크 ──
      if (!reduced && I > 0) {
        const shz = sparkSpawnHz(I)
        sparkSpawnAccumRef.current += dt * shz
        let safety = 0
        while (sparkSpawnAccumRef.current >= 1 && safety < 32) {
          sparkSpawnAccumRef.current -= 1
          safety++
          spawnSpark(cx, cy)
        }
        // 업데이트 & 렌더
        const surviving: Spark[] = []
        for (const s of sparksRef.current) {
          const age = performance.now() - s.bornMs
          if (age > s.lifeMs) continue
          // 물리
          s.vy += SPARK_GRAVITY_PX_S2 * dt
          s.vx *= SPARK_DRAG
          s.vy *= SPARK_DRAG
          s.x += s.vx * dt
          s.y += s.vy * dt
          surviving.push(s)
          // 색 gradient: age 가 커질수록 white→yellow→orange→red
          const t = clamp(age / s.lifeMs, 0, 1)
          const stages = palette.sparkStages
          // 4 stop: 0, 0.33, 0.66, 1
          let color: string
          if (t < 0.33) {
            color = lerpRgbString(stages[0]!, stages[1]!, t / 0.33)
          } else if (t < 0.66) {
            color = lerpRgbString(stages[1]!, stages[2]!, (t - 0.33) / 0.33)
          } else {
            color = lerpRgbString(stages[2]!, stages[3]!, (t - 0.66) / 0.34)
          }
          const alpha = 1 - t
          ctx.beginPath()
          ctx.fillStyle = `rgba(${color},${alpha.toFixed(3)})`
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fill()
        }
        sparksRef.current = surviving
      } else {
        if (sparksRef.current.length) sparksRef.current = []
        sparkSpawnAccumRef.current = 0
      }

      // ── 5. 플래시 (intensity > 80) ──
      if (!reduced && I > FLASH_INTENSITY_THRESHOLD) {
        const ft = clamp((I - FLASH_INTENSITY_THRESHOLD) / (100 - FLASH_INTENSITY_THRESHOLD), 0, 1)
        const flashHz = lerp(FLASH_BASE_HZ, FLASH_MAX_HZ, ft)
        flashAccumRef.current += dt * flashHz
        if (flashAccumRef.current >= 1) {
          flashAccumRef.current -= 1
          flashUntilRef.current = timestamp + FLASH_DURATION_MS
        }
        if (timestamp < flashUntilRef.current) {
          ctx.fillStyle = "rgba(255,255,255,0.55)"
          ctx.fillRect(0, 0, w, h)
        }
      } else {
        flashAccumRef.current = 0
        flashUntilRef.current = 0
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      window.removeEventListener("resize", resize)
      mq.removeEventListener("change", onMqChange)
      if (ro) ro.disconnect()
      sparksRef.current = []
      arcsRef.current = []
    }
  }, [width, height, palette, risk])

  // 컨테이너 스타일: width/height 지정 시 고정, 아니면 full
  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: width ? `${width}px` : "100%",
    height: height ? `${height}px` : "100%",
    overflow: "hidden",
    pointerEvents: "none",
    background: darkMode
      ? "radial-gradient(ellipse at center, rgba(2,6,23,0.55) 0%, rgba(2,6,23,0.0) 70%)"
      : "radial-gradient(ellipse at center, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 70%)",
  }

  return (
    <div ref={containerRef} aria-hidden style={containerStyle}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  )
}
