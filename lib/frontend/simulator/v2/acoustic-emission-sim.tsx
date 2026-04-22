// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Acoustic Emission Sidecar
// Web Audio API 기반 실시간 절삭음 합성 + Canvas 2D 파형/스펙트럼 시각화.
// sidecar only — cutting-simulator-v2.tsx 는 절대 수정하지 않는다.
"use client"

import * as React from "react"
import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"

// ── SSOT (하드코딩 금지) ─────────────────────────────────────────────
const CANVAS_W = 300
const CANVAS_H = 100

const AMP_FUNDAMENTAL = 0.4
const AMP_SECOND_HARM = 0.2
const AMP_CHATTER_MAX = 0.5
const AMP_NOISE = 0.1

const CHATTER_F_LO = 850
const CHATTER_F_HI = 1100

const ENV_DIV = 1000
const ENV_MIN = 0.05
const ENV_MAX = 0.5

const MASTER_GAIN_CAP = 0.5 // 청력 안전 — 절대 초과 금지
const DEFAULT_VOLUME = 0.2

const PINK_LP_ALPHA = 0.03
const FFT_SIZE = 512
const FFT_SMOOTHING = 0.6
const SPEC_DISPLAY_MAX_HZ = 4000
const SPEC_BAR_COUNT = 64

const PALETTE = {
  dark: { bg: "#0a0a14", grid: "#2a1a2a", wave: "#fb7185", waveGlow: "#f43f5e", spectrum: "#fda4af", textMuted: "#9ca3af" },
  light: { bg: "#fff1f2", grid: "#fecaca", wave: "#e11d48", waveGlow: "#be123c", spectrum: "#fb7185", textMuted: "#64748b" },
} as const

const SEVERITY_STOPS: Array<{ pct: number; hex: string }> = [
  { pct: 0, hex: "#10b981" },
  { pct: 40, hex: "#facc15" },
  { pct: 70, hex: "#f97316" },
  { pct: 100, hex: "#ef4444" },
]

// ── Types ──────────────────────────────────────────────────────────
export interface AcousticEmissionSimProps {
  spindleRpm: number     // n (rpm)
  teethCount: number     // z
  VcMmin: number         // 절삭속도 (m/min)
  apMm: number           // 축방향 절입 (mm)
  chatterRiskPct: number // 0-100
  darkMode?: boolean
}

interface AudioGraph {
  ctx: AudioContext
  master: GainNode
  analyser: AnalyserNode
  fundOsc: OscillatorNode; fundGain: GainNode
  secondOsc: OscillatorNode; secondGain: GainNode
  chatterOsc: OscillatorNode; chatterGain: GainNode
  noiseSrc: AudioBufferSourceNode; noiseGain: GainNode
}

// ── Helpers ────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
function lerpHex(a: string, b: string, t: number): string {
  const ar = hexToRgb(a), br = hexToRgb(b)
  return `rgb(${Math.round(ar[0] + (br[0] - ar[0]) * t)}, ${Math.round(ar[1] + (br[1] - ar[1]) * t)}, ${Math.round(ar[2] + (br[2] - ar[2]) * t)})`
}
function severityColor(pct: number): string {
  const p = clamp(pct, 0, 100)
  for (let i = 1; i < SEVERITY_STOPS.length; i++) {
    const a = SEVERITY_STOPS[i - 1]
    const b = SEVERITY_STOPS[i]
    if (p <= b.pct) return lerpHex(a.hex, b.hex, (p - a.pct) / Math.max(b.pct - a.pct, 1))
  }
  return SEVERITY_STOPS[SEVERITY_STOPS.length - 1].hex
}
function toothPassFreq(rpm: number, teeth: number): number {
  return (Math.max(rpm, 0) / 60) * Math.max(teeth, 1)
}
function envelopeGain(apMm: number, VcMmin: number): number {
  return clamp((Math.max(apMm, 0) * Math.max(VcMmin, 0)) / ENV_DIV, ENV_MIN, ENV_MAX)
}
function createPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.floor(sr * seconds))
  const buf = ctx.createBuffer(1, len, sr)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    last = last + PINK_LP_ALPHA * (white - last) // 1-pole low-pass → pink-ish
    data[i] = last * 4 + white * 0.1
  }
  return buf
}

// ── Component ──────────────────────────────────────────────────────
function AcousticEmissionSim(props: AcousticEmissionSimProps): React.ReactElement {
  const { spindleRpm, teethCount, VcMmin, apMm, chatterRiskPct, darkMode = true } = props
  const palette = darkMode ? PALETTE.dark : PALETTE.light
  const ftp = toothPassFreq(spindleRpm, teethCount)
  const envGain = envelopeGain(apMm, VcMmin)
  const chatterAmp = (clamp(chatterRiskPct, 0, 100) / 100) * AMP_CHATTER_MAX
  const severity = severityColor(chatterRiskPct)

  const [playing, setPlaying] = React.useState(false)
  const [volume, setVolume] = React.useState(DEFAULT_VOLUME)

  const graphRef = React.useRef<AudioGraph | null>(null)
  const waveCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const specCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const timeBufRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null)
  const freqBufRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null)

  const teardown = React.useCallback(() => {
    const g = graphRef.current
    if (!g) return
    const sources: Array<OscillatorNode | AudioBufferSourceNode> = [g.fundOsc, g.secondOsc, g.chatterOsc, g.noiseSrc]
    const nodes: AudioNode[] = [...sources, g.fundGain, g.secondGain, g.chatterGain, g.noiseGain, g.analyser, g.master]
    try { sources.forEach((s) => s.stop()) } catch { /* already stopped */ }
    try { nodes.forEach((n) => n.disconnect()) } catch { /* best effort */ }
    g.ctx.close().catch(() => { /* swallow */ })
    graphRef.current = null
  }, [])

  // 반드시 user click 안에서 호출 (autoplay 정책)
  const startAudio = React.useCallback(() => {
    if (graphRef.current) return
    const AudioCtor: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined
    if (!AudioCtor) return
    const ctx = new AudioCtor()

    const master = ctx.createGain()
    master.gain.value = clamp(volume, 0, 1) * MASTER_GAIN_CAP
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = FFT_SMOOTHING

    const mkOsc = (type: OscillatorType, freq: number, gainVal: number): [OscillatorNode, GainNode] => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq
      const gain = ctx.createGain(); gain.gain.value = gainVal
      osc.connect(gain)
      return [osc, gain]
    }
    const [fundOsc, fundGain] = mkOsc("sine", Math.max(ftp, 20), AMP_FUNDAMENTAL * envGain)
    const [secondOsc, secondGain] = mkOsc("sine", Math.max(ftp * 2, 40), AMP_SECOND_HARM * envGain)
    const [chatterOsc, chatterGain] = mkOsc("triangle", (CHATTER_F_LO + CHATTER_F_HI) / 2, chatterAmp * envGain)

    const noiseSrc = ctx.createBufferSource()
    noiseSrc.buffer = createPinkNoiseBuffer(ctx, 2); noiseSrc.loop = true
    const noiseGain = ctx.createGain(); noiseGain.gain.value = AMP_NOISE * envGain
    noiseSrc.connect(noiseGain)

    fundGain.connect(analyser); secondGain.connect(analyser)
    chatterGain.connect(analyser); noiseGain.connect(analyser)
    analyser.connect(master); master.connect(ctx.destination)

    fundOsc.start(); secondOsc.start(); chatterOsc.start(); noiseSrc.start()

    timeBufRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize))
    freqBufRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

    graphRef.current = {
      ctx, master, analyser,
      fundOsc, fundGain, secondOsc, secondGain,
      chatterOsc, chatterGain, noiseSrc, noiseGain,
    }
  }, [ftp, envGain, chatterAmp, volume])

  const handleToggle = React.useCallback(() => {
    if (playing) { teardown(); setPlaying(false) }
    else { startAudio(); setPlaying(true) }
  }, [playing, startAudio, teardown])

  // 프로퍼티 변경을 활성 그래프에 라이브 반영
  React.useEffect(() => {
    const g = graphRef.current
    if (!g) return
    const now = g.ctx.currentTime
    g.fundOsc.frequency.setTargetAtTime(Math.max(ftp, 20), now, 0.05)
    g.secondOsc.frequency.setTargetAtTime(Math.max(ftp * 2, 40), now, 0.05)
    g.fundGain.gain.setTargetAtTime(AMP_FUNDAMENTAL * envGain, now, 0.05)
    g.secondGain.gain.setTargetAtTime(AMP_SECOND_HARM * envGain, now, 0.05)
    g.chatterGain.gain.setTargetAtTime(chatterAmp * envGain, now, 0.05)
    g.noiseGain.gain.setTargetAtTime(AMP_NOISE * envGain, now, 0.05)
  }, [ftp, envGain, chatterAmp])

  React.useEffect(() => {
    const g = graphRef.current
    if (!g) return
    g.master.gain.setTargetAtTime(clamp(volume, 0, 1) * MASTER_GAIN_CAP, g.ctx.currentTime, 0.03)
  }, [volume])

  // 탭이 백그라운드면 뮤트 (autoplay / 집중 UX)
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onVis = () => {
      const g = graphRef.current
      if (!g) return
      const target = document.visibilityState === "visible"
        ? clamp(volume, 0, 1) * MASTER_GAIN_CAP
        : 0
      g.master.gain.setTargetAtTime(target, g.ctx.currentTime, 0.02)
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [volume])

  // unmount cleanup
  React.useEffect(() => () => {
    teardown()
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [teardown])

  // ── Canvas draw loop ─────────────────────────────────────────────
  const draw = React.useCallback(() => {
    const waveCv = waveCanvasRef.current
    const specCv = specCanvasRef.current
    if (!waveCv || !specCv) return
    const wctx = waveCv.getContext("2d")
    const sctx = specCv.getContext("2d")
    if (!wctx || !sctx) return

    wctx.fillStyle = palette.bg; wctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    sctx.fillStyle = palette.bg; sctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    wctx.strokeStyle = palette.grid; wctx.lineWidth = 1
    wctx.beginPath(); wctx.moveTo(0, CANVAS_H / 2); wctx.lineTo(CANVAS_W, CANVAS_H / 2); wctx.stroke()

    const g = graphRef.current
    const timeBuf = timeBufRef.current
    const freqBuf = freqBufRef.current

    if (g && timeBuf && freqBuf) {
      g.analyser.getByteTimeDomainData(timeBuf)
      g.analyser.getByteFrequencyData(freqBuf)

      // waveform
      wctx.strokeStyle = palette.wave; wctx.lineWidth = 1.5
      wctx.shadowColor = palette.waveGlow; wctx.shadowBlur = 6
      wctx.beginPath()
      const step = timeBuf.length / CANVAS_W
      for (let x = 0; x < CANVAS_W; x++) {
        const v = ((timeBuf[Math.floor(x * step)] ?? 128) / 128) - 1
        const y = CANVAS_H / 2 - v * (CANVAS_H / 2 - 2)
        if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y)
      }
      wctx.stroke(); wctx.shadowBlur = 0

      // spectrum
      const bins = freqBuf.length
      const nyq = g.ctx.sampleRate / 2
      const maxBin = Math.min(bins - 1, Math.floor((SPEC_DISPLAY_MAX_HZ / nyq) * bins))
      const barW = CANVAS_W / SPEC_BAR_COUNT
      for (let i = 0; i < SPEC_BAR_COUNT; i++) {
        const binIdx = Math.floor((i / SPEC_BAR_COUNT) * maxBin)
        const magn = (freqBuf[binIdx] ?? 0) / 255
        const h = magn * (CANVAS_H - 4)
        const hz = (binIdx / bins) * nyq
        sctx.fillStyle = hz >= CHATTER_F_LO && hz <= CHATTER_F_HI ? severity : palette.spectrum
        sctx.fillRect(i * barW, CANVAS_H - h - 2, Math.max(barW - 1, 1), h)
      }
      const loX = Math.floor((CHATTER_F_LO / SPEC_DISPLAY_MAX_HZ) * CANVAS_W)
      const hiX = Math.ceil((CHATTER_F_HI / SPEC_DISPLAY_MAX_HZ) * CANVAS_W)
      sctx.strokeStyle = severity; sctx.globalAlpha = 0.5
      sctx.strokeRect(loX, 0, Math.max(hiX - loX, 1), CANVAS_H)
      sctx.globalAlpha = 1
    } else {
      wctx.fillStyle = palette.textMuted; wctx.font = "10px monospace"; wctx.textAlign = "center"
      wctx.fillText("▶ Press Play to synthesize", CANVAS_W / 2, CANVAS_H / 2 + 3)
      sctx.fillStyle = palette.textMuted; sctx.font = "10px monospace"; sctx.textAlign = "center"
      sctx.fillText("FFT spectrum (idle)", CANVAS_W / 2, CANVAS_H / 2 + 3)
    }

    rafRef.current = requestAnimationFrame(draw)
  }, [palette, severity])

  React.useEffect(() => {
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [draw])

  // ── UI ───────────────────────────────────────────────────────────
  const textCls = darkMode ? "text-slate-100" : "text-slate-900"
  const subCls = darkMode ? "text-slate-400" : "text-slate-500"
  const btnCls = playing
    ? "bg-rose-600 hover:bg-rose-500 text-white"
    : "bg-slate-700 hover:bg-slate-600 text-white"

  return (
    <HolographicFrame accent="rose" intensity="medium" darkMode={darkMode}>
      <div className="p-3 space-y-2 select-none">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LiveIndicator watch={[spindleRpm, teethCount, VcMmin, apMm, chatterRiskPct]} color="rose" darkMode={darkMode} label="AE" />
            <span className={`text-xs font-bold tracking-wide uppercase ${textCls}`}>Acoustic Emission</span>
          </div>
          <span className={`text-[10px] ${subCls}`} aria-hidden="true">Web Audio · sine + chatter band</span>
        </div>

        <div className="flex items-baseline gap-3">
          <div>
            <div className={`text-[10px] uppercase tracking-wider ${subCls}`}>치폐 통과 주파수 (f_tp)</div>
            <div className={`text-2xl font-bold tabular-nums ${textCls}`}>{ftp.toFixed(1)}<span className={`text-xs font-normal ml-1 ${subCls}`}>Hz</span></div>
          </div>
          <div className="ml-auto text-right">
            <div className={`text-[10px] uppercase tracking-wider ${subCls}`}>채터 대역 850-1100 Hz</div>
            <div className="text-xs font-bold tabular-nums" style={{ color: severity }}>Risk {chatterRiskPct.toFixed(0)}%</div>
          </div>
        </div>

        <div className="space-y-1">
          <div className={`text-[9px] uppercase tracking-wider ${subCls}`}>Waveform (time)</div>
          <canvas ref={waveCanvasRef} width={CANVAS_W} height={CANVAS_H} aria-label="acoustic waveform" role="img"
            style={{ width: CANVAS_W, height: CANVAS_H, display: "block", borderRadius: 4 }} />
          <div className={`text-[9px] uppercase tracking-wider ${subCls} mt-1`}>Spectrum (FFT)</div>
          <canvas ref={specCanvasRef} width={CANVAS_W} height={CANVAS_H} aria-label="acoustic frequency spectrum" role="img"
            style={{ width: CANVAS_W, height: CANVAS_H, display: "block", borderRadius: 4 }} />
        </div>

        <div className="space-y-0.5">
          <div className="flex items-center justify-between">
            <span className={`text-[9px] uppercase tracking-wider ${subCls}`}>Chatter severity</span>
            <span className="text-[10px] tabular-nums" style={{ color: severity }}>{chatterRiskPct.toFixed(0)} / 100</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: darkMode ? "#1f2937" : "#e5e7eb" }}>
            <div className="h-full transition-all duration-300"
              style={{ width: `${clamp(chatterRiskPct, 0, 100)}%`, background: `linear-gradient(90deg, ${SEVERITY_STOPS[0].hex}, ${severity})` }} />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={handleToggle} aria-label={playing ? "stop audio" : "start audio"} aria-pressed={playing}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${btnCls}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              {playing
                ? <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />
                : <polygon points="2,1 2,9 9,5" fill="currentColor" />}
            </svg>
            {playing ? "Stop" : "Play"}
          </button>
          <label className="flex items-center gap-1.5 flex-1">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M1 4 L3 4 L6 1 L6 11 L3 8 L1 8 Z" fill={darkMode ? "#cbd5e1" : "#475569"} />
              <path d="M8 3 Q10 6 8 9" stroke={darkMode ? "#cbd5e1" : "#475569"} strokeWidth="1" fill="none" />
            </svg>
            <input type="range" min={0} max={1} step={0.01} value={volume} disabled={!playing} aria-label="volume"
              onChange={(e) => setVolume(parseFloat(e.target.value))} className="flex-1 accent-rose-500" />
            <span className={`text-[10px] tabular-nums w-8 text-right ${subCls}`}>{(volume * 100).toFixed(0)}%</span>
          </label>
        </div>
        <div className={`text-[9px] leading-tight ${subCls}`}>
          envelope ∝ ap × Vc = {envGain.toFixed(3)} · master cap {MASTER_GAIN_CAP}
        </div>
      </div>
    </HolographicFrame>
  )
}

export default AcousticEmissionSim
export { AcousticEmissionSim }
