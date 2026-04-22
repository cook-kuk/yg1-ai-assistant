// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Vibration / Chatter Oscilloscope
// Canvas + requestAnimationFrame 기반 실시간 스핀들 진동 waveform 시각화.
// chatterRisk / chatterLevel 에 따라 진폭·고조파·노이즈·색상이 동적으로 반응한다.
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"

// ─────────────────────────────────────────────
// Local SSOT — 모든 상수는 이 블록에서만 관리
// ─────────────────────────────────────────────
const DEFAULT_W = 520
const DEFAULT_H = 180

// Grid
const GRID_DIVISIONS_X = 10           // 수직 time 축 division 수
const GRID_DIVISIONS_Y = 5            // 수평 dB line 수 (center 제외 위아래 합)
const TIME_WINDOW_MS = 100            // 화면에 보이는 총 시간(ms)
const SAMPLES_PER_DIV = 32            // 1 division 당 sample 수 → 총 샘플 = GRID_DIVISIONS_X × SAMPLES_PER_DIV

// Waveform 진폭 매핑 (chatterRisk 0~100 → amplitude 0~1)
const AMP_LOW_MIN = 0.10
const AMP_LOW_MAX = 0.20
const AMP_MED_MIN = 0.30
const AMP_MED_MAX = 0.50
const AMP_HIGH_MIN = 0.60
const AMP_HIGH_MAX = 0.95

// Structural mode: stickout/D 비율이 높으면 주파수가 낮아지는 경향
const STRUCTURAL_RATIO_THRESHOLD = 4      // stickout/D >= 4 이면 감쇠 시작
const STRUCTURAL_FREQ_ATTENUATION = 0.35  // 최대 35% 주파수 감쇠

// 고조파 세기 (chatterRisk 증가 시 가중)
const HARMONIC_2F_BASE = 0.25
const HARMONIC_3F_BASE = 0.15
const HARMONIC_SCALE = 0.01               // risk(%) × scale → 추가 고조파 가중

// 노이즈
const NOISE_AMP_HIGH = 0.20
const NOISE_AMP_MED = 0.08
const NOISE_AMP_LOW = 0.02

// CRT glow (shadow blur)
const GLOW_BLUR_LOW = 4
const GLOW_BLUR_MED = 8
const GLOW_BLUR_HIGH = 14
const FLICKER_PERIOD_MS = 120             // high 일 때 깜빡임 주기
const WARN_BLINK_PERIOD_MS = 600          // "CHATTER DETECTED" 경고 깜빡임

// 프레임
const TARGET_FPS = 60
const FRAME_MS = 1000 / TARGET_FPS

// 스펙트럼 mini
const SPECTRUM_BAR_COUNT = 6              // 1f~6f harmonics
const SPECTRUM_WIDTH_PX = 70
const SPECTRUM_PAD = 6

// 컬러 — dark / light 팔레트
const PALETTE = {
  dark: {
    bg: "#0a1628",
    grid: "#1e3a5f",
    gridStrong: "#2a4d7a",
    text: "#94a3b8",
    textStrong: "#e2e8f0",
    phosphorTint: "rgba(16,185,129,0.05)",
  },
  light: {
    bg: "#f0f9ff",
    grid: "#bae6fd",
    gridStrong: "#7dd3fc",
    text: "#475569",
    textStrong: "#0f172a",
    phosphorTint: "rgba(16,185,129,0.03)",
  },
} as const

const LEVEL_COLOR: Record<"low" | "med" | "high", { wave: string; glow: string; badgeBg: string; badgeFg: string; label: string }> = {
  low:  { wave: "#10b981", glow: "#34d399", badgeBg: "#065f46", badgeFg: "#ecfdf5", label: "STABLE" },
  med:  { wave: "#f59e0b", glow: "#fbbf24", badgeBg: "#78350f", badgeFg: "#fffbeb", label: "CAUTION" },
  high: { wave: "#ef4444", glow: "#f87171", badgeBg: "#7f1d1d", badgeFg: "#fef2f2", label: "CHATTER" },
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type ChatterLevel = "low" | "med" | "high"

export interface VibrationOscilloscopeProps {
  rpm: number
  chatterRisk: number       // 0~100
  chatterLevel: ChatterLevel
  flutes: number
  stickoutMm: number
  diameter: number
  darkMode?: boolean
  width?: number
  height?: number
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function amplitudeFor(level: ChatterLevel, risk: number): number {
  const r = clamp(risk, 0, 100) / 100
  if (level === "low") return lerp(AMP_LOW_MIN, AMP_LOW_MAX, r)
  if (level === "med") return lerp(AMP_MED_MIN, AMP_MED_MAX, r)
  return lerp(AMP_HIGH_MIN, AMP_HIGH_MAX, r)
}

function noiseFor(level: ChatterLevel): number {
  if (level === "low") return NOISE_AMP_LOW
  if (level === "med") return NOISE_AMP_MED
  return NOISE_AMP_HIGH
}

function glowBlurFor(level: ChatterLevel): number {
  if (level === "low") return GLOW_BLUR_LOW
  if (level === "med") return GLOW_BLUR_MED
  return GLOW_BLUR_HIGH
}

// tooth-pass 주파수(Hz) — stickout/D 크면 구조 모드로 감쇠
function computeFreq(rpm: number, flutes: number, stickoutMm: number, diameter: number): number {
  const base = (Math.max(rpm, 0) / 60) * Math.max(flutes, 1)
  const ratio = diameter > 0 ? stickoutMm / diameter : 0
  if (ratio <= STRUCTURAL_RATIO_THRESHOLD) return base
  // 선형 감쇠 (ratio 4 → 0%, ratio 10 → STRUCTURAL_FREQ_ATTENUATION)
  const over = clamp((ratio - STRUCTURAL_RATIO_THRESHOLD) / 6, 0, 1)
  return base * (1 - STRUCTURAL_FREQ_ATTENUATION * over)
}

// 최종 waveform 샘플 — t 단위 초
function sampleWaveform(params: {
  t: number
  freq: number
  amp: number
  risk: number
  noise: number
}): number {
  const { t, freq, amp, risk, noise } = params
  const w = 2 * Math.PI * freq
  const h2 = HARMONIC_2F_BASE + risk * HARMONIC_SCALE
  const h3 = HARMONIC_3F_BASE + risk * HARMONIC_SCALE * 0.6
  const fundamental = Math.sin(w * t)
  const second = h2 * Math.sin(w * 2 * t)
  const third = h3 * Math.sin(w * 3 * t)
  const noiseVal = (Math.random() * 2 - 1) * noise
  // 전체 진폭 스케일
  return (fundamental + second + third + noiseVal) * amp
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────
function VibrationOscilloscope(props: VibrationOscilloscopeProps) {
  const {
    rpm,
    chatterRisk,
    chatterLevel,
    flutes,
    stickoutMm,
    diameter,
    darkMode = true,
    width = DEFAULT_W,
    height = DEFAULT_H,
  } = props

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const samplesRef = useRef<number[]>([])       // 최근 샘플 링버퍼 (length = TOTAL_SAMPLES)
  const lastFrameRef = useRef<number>(0)
  const tSecRef = useRef<number>(0)              // waveform 진행 시간(초)
  const [paused, setPaused] = useState<boolean>(false)
  const [muted, setMuted] = useState<boolean>(false) // UI 전용(오디오 없음)

  const palette = darkMode ? PALETTE.dark : PALETTE.light
  const colorSet = LEVEL_COLOR[chatterLevel]

  const TOTAL_SAMPLES = GRID_DIVISIONS_X * SAMPLES_PER_DIV

  const toothFreq = useMemo(
    () => computeFreq(rpm, flutes, stickoutMm, diameter),
    [rpm, flutes, stickoutMm, diameter],
  )

  // 샘플 버퍼 초기화 — TOTAL_SAMPLES 가 바뀌지는 않지만 mount 시 0 채움
  useEffect(() => {
    samplesRef.current = new Array(TOTAL_SAMPLES).fill(0)
  }, [TOTAL_SAMPLES])

  const drawFrame = useCallback(
    (nowMs: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      // ── 1) 배경 + phosphor tint ──
      ctx.fillStyle = palette.bg
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = palette.phosphorTint
      ctx.fillRect(0, 0, width, height)

      // ── 2) 그리드 ──
      const plotLeft = 0
      const plotRight = width - SPECTRUM_WIDTH_PX - SPECTRUM_PAD * 2
      const plotTop = 0
      const plotBottom = height
      const plotW = plotRight - plotLeft
      const plotH = plotBottom - plotTop
      const cy = plotTop + plotH / 2

      ctx.strokeStyle = palette.grid
      ctx.lineWidth = 1
      ctx.setLineDash([2, 3])
      // 수평 dB line
      for (let i = 1; i < GRID_DIVISIONS_Y; i++) {
        const y = plotTop + (plotH * i) / GRID_DIVISIONS_Y
        ctx.beginPath()
        ctx.moveTo(plotLeft, y)
        ctx.lineTo(plotRight, y)
        ctx.stroke()
      }
      // 수직 time tick
      for (let i = 1; i < GRID_DIVISIONS_X; i++) {
        const x = plotLeft + (plotW * i) / GRID_DIVISIONS_X
        ctx.beginPath()
        ctx.moveTo(x, plotTop)
        ctx.lineTo(x, plotBottom)
        ctx.stroke()
      }
      ctx.setLineDash([])
      // center line 강조
      ctx.strokeStyle = palette.gridStrong
      ctx.beginPath()
      ctx.moveTo(plotLeft, cy)
      ctx.lineTo(plotRight, cy)
      ctx.stroke()

      // 시간축 division 레이블 (ms 단위, 우측이 현재)
      ctx.fillStyle = palette.text
      ctx.font = "9px monospace"
      ctx.textAlign = "center"
      for (let i = 0; i <= GRID_DIVISIONS_X; i++) {
        const x = plotLeft + (plotW * i) / GRID_DIVISIONS_X
        const msFromNow = -(TIME_WINDOW_MS - (TIME_WINDOW_MS * i) / GRID_DIVISIONS_X)
        const label = `${Math.round(msFromNow)}ms`
        ctx.fillText(label, x, plotBottom - 2)
      }

      // ── 3) 새 샘플 생성 (paused 아닐 때만) ──
      if (!paused) {
        const last = lastFrameRef.current || nowMs
        const dtMs = Math.min(nowMs - last, 64) // 큰 delta 방지
        lastFrameRef.current = nowMs
        // 이번 프레임에 추가할 샘플 수: 시간창 비례
        const samplesPerMs = TOTAL_SAMPLES / TIME_WINDOW_MS
        const toAdd = Math.max(1, Math.round(dtMs * samplesPerMs))
        const amp = amplitudeFor(chatterLevel, chatterRisk)
        const noise = noiseFor(chatterLevel)
        // sample 간 시간 간격
        const dtSec = dtMs / 1000 / toAdd
        const buf = samplesRef.current
        for (let i = 0; i < toAdd; i++) {
          tSecRef.current += dtSec
          const v = sampleWaveform({
            t: tSecRef.current,
            freq: toothFreq,
            amp,
            risk: chatterRisk,
            noise,
          })
          buf.shift()
          buf.push(v)
        }
      } else {
        lastFrameRef.current = nowMs
      }

      // ── 4) Waveform 렌더 (CRT glow + flicker) ──
      const buf = samplesRef.current
      const ampScaleY = plotH * 0.45 // 화면 높이의 45%를 최대 진폭 반영 범위로
      // flicker (high 만)
      let flickerAlpha = 1
      if (chatterLevel === "high") {
        const phase = (nowMs % FLICKER_PERIOD_MS) / FLICKER_PERIOD_MS
        flickerAlpha = 0.75 + 0.25 * Math.sin(phase * 2 * Math.PI)
      }

      ctx.save()
      ctx.globalAlpha = flickerAlpha
      ctx.strokeStyle = colorSet.wave
      ctx.lineWidth = 1.75
      ctx.shadowColor = colorSet.glow
      ctx.shadowBlur = glowBlurFor(chatterLevel)
      ctx.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = plotLeft + (plotW * i) / (buf.length - 1)
        const y = cy - clamp(buf[i] ?? 0, -1.5, 1.5) * ampScaleY
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.restore()

      // 현재 sample point highlight
      const lastIdx = buf.length - 1
      if (lastIdx >= 0) {
        const xHead = plotRight
        const yHead = cy - clamp(buf[lastIdx] ?? 0, -1.5, 1.5) * ampScaleY
        ctx.save()
        ctx.shadowColor = colorSet.glow
        ctx.shadowBlur = 12
        ctx.fillStyle = colorSet.wave
        ctx.beginPath()
        ctx.arc(xHead, yHead, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // ── 5) FFT mini bar chart (우측) ──
      const specLeft = plotRight + SPECTRUM_PAD
      const specRight = width - SPECTRUM_PAD
      const specTop = plotTop + 8
      const specBottom = plotBottom - 14
      const specW = specRight - specLeft
      const specH = specBottom - specTop
      // 배경 박스
      ctx.strokeStyle = palette.grid
      ctx.strokeRect(specLeft, specTop, specW, specH)
      // 라벨
      ctx.fillStyle = palette.text
      ctx.font = "8px monospace"
      ctx.textAlign = "center"
      ctx.fillText("FFT", specLeft + specW / 2, specBottom + 10)

      // 각 harmonic의 가상 세기
      const ampNow = amplitudeFor(chatterLevel, chatterRisk)
      const riskFactor = clamp(chatterRisk / 100, 0, 1)
      const harmIntensities: number[] = []
      for (let k = 1; k <= SPECTRUM_BAR_COUNT; k++) {
        // 1f 강함, 고조파는 risk 에 비례
        let base = 1 / k
        if (k >= 2) base *= HARMONIC_2F_BASE + riskFactor * 0.6
        if (k >= 3) base *= 1 + riskFactor * 0.8
        base *= ampNow
        // flicker 소폭
        base *= 0.85 + Math.random() * 0.15
        harmIntensities.push(clamp(base, 0, 1.2))
      }
      const maxIntensity = Math.max(1e-3, ...harmIntensities)
      const barW = specW / SPECTRUM_BAR_COUNT
      for (let k = 0; k < SPECTRUM_BAR_COUNT; k++) {
        const h = (harmIntensities[k] / maxIntensity) * specH
        const x = specLeft + k * barW + 1
        const y = specBottom - h
        ctx.fillStyle = colorSet.wave
        ctx.globalAlpha = 0.85
        ctx.fillRect(x, y, barW - 2, h)
        ctx.globalAlpha = 1
      }

      // ── 6) UI 오버레이 ──
      ctx.fillStyle = palette.textStrong
      ctx.font = "bold 11px monospace"
      ctx.textAlign = "left"
      ctx.fillText(`📡 SPINDLE VIBRATION · ${toothFreq.toFixed(1)} Hz`, 8, 14)

      // 우상단 배지
      const badgeText = colorSet.label
      ctx.font = "bold 10px monospace"
      const badgeW = ctx.measureText(badgeText).width + 14
      const badgeH = 16
      const badgeX = plotRight - badgeW - 4
      const badgeY = 4
      ctx.fillStyle = colorSet.badgeBg
      ctx.fillRect(badgeX, badgeY, badgeW, badgeH)
      ctx.fillStyle = colorSet.badgeFg
      ctx.textAlign = "center"
      ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + 11)

      // 좌하단 Risk
      ctx.fillStyle = colorSet.wave
      ctx.font = "bold 18px monospace"
      ctx.textAlign = "left"
      ctx.fillText(`Risk: ${Math.round(chatterRisk)}%`, 8, plotBottom - 16)

      // 우하단 tooth freq (작은)
      ctx.fillStyle = palette.text
      ctx.font = "9px monospace"
      ctx.textAlign = "right"
      ctx.fillText(`Tooth pass: ${toothFreq.toFixed(0)} Hz`, plotRight - 4, plotBottom - 16)

      // chatter high 일 때 경고 blink
      if (chatterLevel === "high") {
        const phase = (nowMs % WARN_BLINK_PERIOD_MS) / WARN_BLINK_PERIOD_MS
        if (phase < 0.6) {
          ctx.fillStyle = "#fecaca"
          ctx.font = "bold 11px monospace"
          ctx.textAlign = "left"
          ctx.fillText("📛 CHATTER DETECTED", 8, 30)
        }
      }

      // paused 오버레이
      if (paused) {
        ctx.fillStyle = "rgba(0,0,0,0.45)"
        ctx.fillRect(plotLeft, plotTop, plotW, plotH)
        ctx.fillStyle = "#f1f5f9"
        ctx.font = "bold 14px monospace"
        ctx.textAlign = "center"
        ctx.fillText("⏸ PAUSED", plotLeft + plotW / 2, plotTop + plotH / 2 + 4)
      }
    },
    [
      palette,
      width,
      height,
      paused,
      chatterLevel,
      chatterRisk,
      toothFreq,
      colorSet,
    ],
  )

  // RAF 루프
  useEffect(() => {
    let stopped = false
    const tick = (now: number) => {
      if (stopped) return
      drawFrame(now)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      stopped = true
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [drawFrame])

  // ── UI 버튼 ──
  const controlBtnClass =
    "inline-flex items-center justify-center w-7 h-7 rounded border text-xs " +
    (darkMode
      ? "bg-slate-900/70 border-slate-700 text-slate-200 hover:bg-slate-800"
      : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50")

  return (
    <div
      className="relative inline-block select-none"
      style={{ width, height }}
      role="img"
      aria-label="spindle vibration oscilloscope"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width, height, display: "block", borderRadius: 6 }}
      />
      {/* 좌상단 컨트롤 오버레이 */}
      <div className="absolute top-1 right-1 flex gap-1" style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          className={controlBtnClass}
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "resume" : "pause"}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <button
          type="button"
          className={controlBtnClass}
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "unmute" : "mute"}
          title={muted ? "Unmute (UI only)" : "Mute (UI only)"}
        >
          {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </button>
      </div>
    </div>
  )
}

export default VibrationOscilloscope
export { VibrationOscilloscope }
