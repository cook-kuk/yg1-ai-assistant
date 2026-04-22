"use client"

/**
 * <SoundEngine> — headless Web Audio renderer for the v2 cutting simulator.
 *
 *  - Spindle whine  : sawtooth @ (rpm/60 * 2) Hz  → lowpass(4kHz) → gain
 *  - Chip impact    : noise-buffer bursts at (rpm/60 * fluteCount) Hz
 *
 *  AudioContext is lazy-created on first `enabled=true` tick (user-gesture
 *  triggered) to respect browser autoplay policy. All nodes are torn down
 *  and `.close()` is called on unmount or when `enabled` flips to false.
 *  Production rate is clamped to CHIP_TICK_MAX_HZ (60 Hz) to stay sane
 *  — above that the audio becomes an aggregated "hiss" rather than ticks.
 */

import { useEffect, useRef } from "react"

// ─────────────────────────────────────────────────────────────────────────
// 🎛 Constants
// ─────────────────────────────────────────────────────────────────────────
const SPINDLE_FUND_MIN_HZ = 60         // audibility floor for fundamental
const SPINDLE_LOWPASS_HZ = 4000
const SPINDLE_GAIN_COEFF = 0.08        // relative to masterVolume
const SPINDLE_RAMP_TAU = 0.1           // setTargetAtTime time constant (s)
const CHIP_TICK_MAX_HZ = 60            // clamp — above this, audio is aggregated
const CHIP_BURST_MS = 100              // AudioBufferSourceNode lifetime
const CHIP_DECAY_MS = 80               // exp envelope time constant
const NOISE_BUFFER_SECS = 0.2          // pre-computed white noise length

type SoundEngineProps = {
  enabled: boolean
  rpm: number
  fluteCount: number
  fz?: number
  masterVolume?: number
}

// Cross-browser AudioContext resolver (webkit fallback for older Safari).
type AudioContextCtor = typeof AudioContext
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECS)
  const buf = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

export default function SoundEngine({
  enabled,
  rpm,
  fluteCount,
  fz = 0.05,
  masterVolume = 0.3,
}: SoundEngineProps): null {
  // ─── refs ─────────────────────────────────────────────────────────────
  const ctxRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const filterRef = useRef<BiquadFilterNode | null>(null)
  const spindleGainRef = useRef<GainNode | null>(null)
  const chipGainRef = useRef<GainNode | null>(null)   // shared master gain for ticks
  const noiseBufRef = useRef<AudioBuffer | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pausedRef = useRef(false)

  // Track latest prop values without re-running the main effect.
  const rpmRef = useRef(rpm)
  const fluteRef = useRef(fluteCount)
  const fzRef = useRef(fz)
  const masterRef = useRef(masterVolume)

  // ─── Mount/unmount — own AudioContext lifetime ────────────────────────
  useEffect(() => {
    if (!enabled) return

    const Ctor = getAudioContextCtor()
    if (!Ctor) return // SSR or unsupported browser

    let disposed = false
    const ctx = new Ctor()
    ctxRef.current = ctx

    // Spindle whine graph: osc → lowpass → gain → destination
    const osc = ctx.createOscillator()
    osc.type = "sawtooth"
    const fund = Math.max(SPINDLE_FUND_MIN_HZ, (rpmRef.current / 60) * 2)
    osc.frequency.value = fund

    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.value = SPINDLE_LOWPASS_HZ

    const spindleGain = ctx.createGain()
    spindleGain.gain.value = SPINDLE_GAIN_COEFF * masterRef.current

    osc.connect(filter)
    filter.connect(spindleGain)
    spindleGain.connect(ctx.destination)
    osc.start()

    // Chip impact master gain
    const chipGain = ctx.createGain()
    chipGain.gain.value = masterRef.current
    chipGain.connect(ctx.destination)

    oscRef.current = osc
    filterRef.current = filter
    spindleGainRef.current = spindleGain
    chipGainRef.current = chipGain
    noiseBufRef.current = makeNoiseBuffer(ctx)

    // Chip tick scheduler — recomputed each interval fire from latest refs.
    const scheduleTicks = () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      const rawHz = (rpmRef.current / 60) * fluteRef.current
      const hz = Math.min(CHIP_TICK_MAX_HZ, Math.max(0, rawHz))
      if (hz <= 0) {
        tickTimerRef.current = null
        return
      }
      const periodMs = 1000 / hz
      tickTimerRef.current = setInterval(() => {
        if (pausedRef.current) return
        const c = ctxRef.current
        const buf = noiseBufRef.current
        const masterChipGain = chipGainRef.current
        if (!c || !buf || !masterChipGain) return
        const src = c.createBufferSource()
        src.buffer = buf
        const env = c.createGain()
        // Volume ∝ fz — 0.05 fz (default) → ~0.35 peak before master.
        const peak = Math.min(1, Math.max(0.05, fzRef.current * 7))
        const now = c.currentTime
        env.gain.setValueAtTime(peak, now)
        env.gain.exponentialRampToValueAtTime(0.0001, now + CHIP_DECAY_MS / 1000)
        src.connect(env)
        env.connect(masterChipGain)
        src.start(now)
        src.stop(now + CHIP_BURST_MS / 1000)
      }, periodMs)
    }
    scheduleTicks()
    // Re-schedule whenever external rpm/flute refs diverge (see prop effect).
    ;(ctx as unknown as { __scheduleTicks?: () => void }).__scheduleTicks = scheduleTicks

    // ─── Visibility — pause ticks & mute spindle gain while hidden ─────
    const onVisibility = () => {
      if (typeof document === "undefined") return
      const hidden = document.hidden
      pausedRef.current = hidden
      const g = spindleGainRef.current
      if (g && !disposed) {
        const target = hidden ? 0 : SPINDLE_GAIN_COEFF * masterRef.current
        g.gain.setTargetAtTime(target, ctx.currentTime, SPINDLE_RAMP_TAU)
      }
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }

    return () => {
      disposed = true
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current)
        tickTimerRef.current = null
      }
      try { osc.stop() } catch { /* already stopped */ }
      try { osc.disconnect() } catch { /* noop */ }
      try { filter.disconnect() } catch { /* noop */ }
      try { spindleGain.disconnect() } catch { /* noop */ }
      try { chipGain.disconnect() } catch { /* noop */ }
      oscRef.current = null
      filterRef.current = null
      spindleGainRef.current = null
      chipGainRef.current = null
      noiseBufRef.current = null
      ctxRef.current = null
      ctx.close().catch(() => { /* swallow — context may already be closed */ })
    }
  }, [enabled])

  // ─── Prop sync — smooth spindle freq ramp & re-schedule ticks on change.
  useEffect(() => {
    rpmRef.current = rpm
    fluteRef.current = fluteCount
    fzRef.current = fz
    masterRef.current = masterVolume

    const ctx = ctxRef.current
    const osc = oscRef.current
    const sGain = spindleGainRef.current
    if (ctx && osc && sGain) {
      const fund = Math.max(SPINDLE_FUND_MIN_HZ, (rpm / 60) * 2)
      osc.frequency.setTargetAtTime(fund, ctx.currentTime, SPINDLE_RAMP_TAU)
      const target = pausedRef.current ? 0 : SPINDLE_GAIN_COEFF * masterVolume
      sGain.gain.setTargetAtTime(target, ctx.currentTime, SPINDLE_RAMP_TAU)
    }
    const reschedule = ctx
      ? (ctx as unknown as { __scheduleTicks?: () => void }).__scheduleTicks
      : undefined
    if (reschedule) reschedule()
  }, [rpm, fluteCount, fz, masterVolume])

  return null
}
