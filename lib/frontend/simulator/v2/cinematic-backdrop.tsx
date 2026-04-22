// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Cinematic Backdrop
// 전체 시뮬레이터 뒤에 깔리는 고급스러운 움직이는 배경.
// 3 레이어 composite: animated gradient blobs + metallic dust canvas + hi-tech grid.
// 성능: requestAnimationFrame + prefers-reduced-motion 대응 + SSR safe.
"use client"

import { useEffect, useMemo, useRef } from "react"

// ─────────────────────────────────────────────
// 로컬 SSOT (하드코딩 대신 상수로 집약)
// ─────────────────────────────────────────────
const TARGET_FPS = 30
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS

// 파티클 밀도 (intensity 별) — UI 성능 최적화 위해 하향 조정
const PARTICLE_DENSITY: Record<Intensity, number> = {
  low: 50,
  medium: 90,
  high: 130,
}

// blob opacity (intensity 별)
const BLOB_OPACITY: Record<Intensity, number> = {
  low: 0.1,
  medium: 0.2,
  high: 0.35,
}

// 파티클 크기/속도
const PARTICLE_MIN_R = 0.4
const PARTICLE_MAX_R = 1.8
const PARTICLE_DRIFT_UP = 0.08      // px/frame 기본 상승
const PARTICLE_BROWNIAN = 0.12      // px/frame 랜덤 변동
const PARTICLE_TWINKLE_HZ = 0.6     // opacity 진동 주기 Hz

// blob 크기
const BLOB_SIZE_PX = 800
const BLOB_BLUR_PX = 150

// 그리드 오버레이
const GRID_OPACITY = 0.04
const GRID_CELL_PX = 48

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type Intensity = "low" | "medium" | "high"
export type BackdropTheme = "aurora" | "metallic" | "neon" | "plasma"

export interface CinematicBackdropProps {
  intensity?: Intensity
  theme?: BackdropTheme
  darkMode?: boolean
}

interface ThemePalette {
  blobs: string[]        // 3 blob colors
  particle: string[]     // particle rgb tints (랜덤 선택)
  grid: string           // grid line color
}

// 테마별 팔레트 (SSOT)
const THEMES: Record<BackdropTheme, ThemePalette> = {
  aurora: {
    blobs: ["#6366f1", "#a855f7", "#06b6d4"],   // indigo / violet / cyan
    particle: ["180,180,220", "200,180,255", "160,220,240"],
    grid: "rgba(148,163,184,1)",
  },
  metallic: {
    blobs: ["#64748b", "#71717a", "#a3a3a3"],   // slate / zinc / neutral
    particle: ["200,200,210", "220,220,230", "180,185,195"],
    grid: "rgba(120,120,130,1)",
  },
  neon: {
    blobs: ["#ec4899", "#22d3ee", "#84cc16"],   // pink / cyan / lime
    particle: ["255,180,220", "180,240,255", "200,255,180"],
    grid: "rgba(236,72,153,1)",
  },
  plasma: {
    blobs: ["#f97316", "#ef4444", "#a855f7"],   // orange / red / purple
    particle: ["255,200,160", "255,160,160", "220,180,255"],
    grid: "rgba(249,115,22,1)",
  },
}

interface Particle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  tint: string          // "r,g,b"
  twinklePhase: number  // 0..2π
  twinkleSpeed: number  // rad/sec
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function CinematicBackdrop({
  intensity = "medium",
  theme = "aurora",
  darkMode = true,
}: CinematicBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const lastFrameRef = useRef<number>(0)
  const reducedMotionRef = useRef<boolean>(false)

  const palette = useMemo(() => THEMES[theme], [theme])
  const density = PARTICLE_DENSITY[intensity]
  const blobAlpha = BLOB_OPACITY[intensity]

  // ── Canvas 파티클 루프 ──
  useEffect(() => {
    if (typeof window === "undefined") return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // reduced motion 확인
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    reducedMotionRef.current = mq.matches
    const onMqChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches
    }
    mq.addEventListener("change", onMqChange)

    // DPR 대응 리사이즈
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    // 파티클 초기화
    const initParticles = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const arr: Particle[] = []
      for (let i = 0; i < density; i++) {
        arr.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: PARTICLE_MIN_R + Math.random() * (PARTICLE_MAX_R - PARTICLE_MIN_R),
          vx: (Math.random() - 0.5) * PARTICLE_BROWNIAN,
          vy: -(PARTICLE_DRIFT_UP * (0.5 + Math.random())),
          tint: palette.particle[i % palette.particle.length] ?? palette.particle[0]!,
          twinklePhase: Math.random() * Math.PI * 2,
          twinkleSpeed: PARTICLE_TWINKLE_HZ * 2 * Math.PI * (0.6 + Math.random() * 0.8),
        })
      }
      particlesRef.current = arr
    }
    initParticles()

    // 애니메이션 루프
    const draw = (timestamp: number) => {
      const last = lastFrameRef.current
      const elapsed = timestamp - last
      if (elapsed < FRAME_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      lastFrameRef.current = timestamp
      const dt = Math.min(elapsed, 100) / 1000 // seconds, clamp

      const w = window.innerWidth
      const h = window.innerHeight
      ctx.clearRect(0, 0, w, h)

      const particles = particlesRef.current
      const reduced = reducedMotionRef.current

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]!
        if (!reduced) {
          // Brownian drift
          p.vx += (Math.random() - 0.5) * PARTICLE_BROWNIAN * 0.3
          p.vx *= 0.96 // damping
          p.x += p.vx
          p.y += p.vy
          p.twinklePhase += p.twinkleSpeed * dt
          // wrap
          if (p.y < -4) {
            p.y = h + 4
            p.x = Math.random() * w
          }
          if (p.x < -4) p.x = w + 4
          if (p.x > w + 4) p.x = -4
        }
        // twinkle opacity: 0.25..0.9
        const twinkle = reduced ? 0.55 : 0.55 + 0.35 * Math.sin(p.twinklePhase)
        const alpha = Math.max(0.15, Math.min(0.95, twinkle))
        ctx.beginPath()
        ctx.fillStyle = `rgba(${p.tint},${alpha.toFixed(3)})`
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      window.removeEventListener("resize", resize)
      mq.removeEventListener("change", onMqChange)
    }
  }, [density, palette])

  // ── 그리드 배경 (CSS linear-gradient) ──
  const gridStyle: React.CSSProperties | undefined =
    intensity === "high"
      ? {
          backgroundImage: `linear-gradient(${palette.grid.replace(",1)", `,${GRID_OPACITY})`)} 1px, transparent 1px), linear-gradient(90deg, ${palette.grid.replace(",1)", `,${GRID_OPACITY})`)} 1px, transparent 1px)`,
          backgroundSize: `${GRID_CELL_PX}px ${GRID_CELL_PX}px`,
        }
      : undefined

  const baseBg = darkMode
    ? "radial-gradient(ellipse at 50% 0%, #0b1220 0%, #05070d 70%, #02030a 100%)"
    : "radial-gradient(ellipse at 50% 0%, #f1f5f9 0%, #e2e8f0 70%, #cbd5e1 100%)"

  return (
    <>
      {/* Layer 0: base background color */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-30"
        style={{ background: baseBg }}
      />

      {/* Layer 1: animated gradient blobs — 3→2 로 하향 (UI 성능 최적화) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-20 overflow-hidden">
        <div
          className="cf-backdrop-blob cf-backdrop-blob-a"
          style={{
            background: palette.blobs[0],
            opacity: blobAlpha,
          }}
        />
        <div
          className="cf-backdrop-blob cf-backdrop-blob-b"
          style={{
            background: palette.blobs[1],
            opacity: blobAlpha,
          }}
        />
      </div>

      {/* Layer 2: metallic dust particles */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
      />

      {/* Layer 3: hi-tech grid overlay (intensity=high only) */}
      {intensity === "high" && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10"
          style={gridStyle}
        />
      )}

      {/* Styled-jsx scoped keyframes & blob 정의 */}
      <style jsx>{`
        .cf-backdrop-blob {
          position: absolute;
          width: ${BLOB_SIZE_PX}px;
          height: ${BLOB_SIZE_PX}px;
          border-radius: 50%;
          filter: blur(${BLOB_BLUR_PX}px);
          will-change: transform;
          mix-blend-mode: screen;
        }
        .cf-backdrop-blob-a {
          top: -20%;
          left: -15%;
          animation: cfDriftA 28s ease-in-out infinite;
        }
        .cf-backdrop-blob-b {
          top: 20%;
          right: -20%;
          animation: cfDriftB 36s ease-in-out infinite;
        }
        .cf-backdrop-blob-c {
          bottom: -25%;
          left: 20%;
          animation: cfDriftC 42s ease-in-out infinite;
        }
        @keyframes cfDriftA {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(30vw, 20vh) scale(1.15); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes cfDriftB {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(-25vw, 15vh) scale(1.2); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes cfDriftC {
          0%   { transform: translate(0, 0) scale(1.05); }
          50%  { transform: translate(20vw, -25vh) scale(0.9); }
          100% { transform: translate(0, 0) scale(1.05); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cf-backdrop-blob-a,
          .cf-backdrop-blob-b,
          .cf-backdrop-blob-c {
            animation: none !important;
          }
        }
      `}</style>
    </>
  )
}
