// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Replay Timeline
//
// 공구 팁 좌표 궤적을 녹화(최대 60Hz × 60초 = 3600 프레임)하고
// 재생(interpolation + speed control)한다. DOM + rAF 기반 — Canvas 외부에 마운트 가능.
//
// 설계 노트:
//   - "useFrame with r3f" 대신 requestAnimationFrame 을 사용해 UI + 시간 루프를 한 컴포넌트에
//     공존시킨다 (r3f useFrame 은 Canvas 내부에서만 유효). 동작 의미는 동등.
//   - 녹화 주기 16.67ms throttle → 60Hz 상한.
//   - 메모리: frame = {t: number, pos: [3]}. 3600 개 × ≈ 24 byte ≈ 86 KB. 요구사항 내.
//   - 재생 시 각 rAF 틱에서 elapsed × speed 에 해당하는 시각 t 를 계산하고 두 frame 사이를
//     선형보간해 onFrame 으로 전달한다.
//
// Imperative handle:
//   clear()          — 전체 프레임 삭제
//   getDuration()    — 마지막 frame.t (sec)
//   seekTo(t)        — 재생 헤드를 t 로 이동 (playback=false 여도 onFrame 1회 호출)

"use client"

import * as React from "react"

// ── SSOT Constants ──────────────────────────────────────────────────
const MAX_HZ = 60
const MIN_FRAME_DT_MS = 1000 / MAX_HZ // 16.67ms
const DEFAULT_MAX_DURATION_SEC = 60
const MAX_FRAMES = MAX_HZ * DEFAULT_MAX_DURATION_SEC // 3600

const SPEEDS = [0.25, 0.5, 1, 2, 4] as const
export type ReplaySpeed = (typeof SPEEDS)[number]

export interface ReplayFrame {
  t: number
  pos: [number, number, number]
}

export interface ReplayTimelineHandle {
  clear: () => void
  getDuration: () => number
  seekTo: (t: number) => void
}

export interface ReplayTimelineProps {
  /** true 면 currentToolPosition 을 매 프레임 capture. */
  recording: boolean
  /** true 면 저장된 frames 를 onFrame 으로 방송. */
  playback: boolean
  /** 재생 배속 (default 1). */
  speed?: number
  /** 재생/seek 중 보간된 공구 위치. */
  onFrame: (toolPosition: [number, number, number], t: number) => void
  /** 라이브 공구 팁 좌표 (recording=true 일 때 저장). */
  currentToolPosition: [number, number, number]
  /** 타임라인 클릭/드래그로 seek 시 호출. */
  onTimelineSeek?: (t: number) => void
  /** 최대 녹화 시간 (초, default 60). MAX_HZ × maxDuration 프레임 상한. */
  maxDurationSec?: number
}

// ── Helpers ────────────────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

/** 주어진 시각 t 에서 frames 를 선형보간. */
function sampleFrames(frames: ReplayFrame[], t: number): [number, number, number] | null {
  if (frames.length === 0) return null
  if (frames.length === 1) return frames[0].pos
  if (t <= frames[0].t) return frames[0].pos
  const last = frames[frames.length - 1]
  if (t >= last.t) return last.pos
  // 선형 스캔 — 3600 프레임 안에서 한 번만 돌기 때문에 충분히 저렴.
  // 최적화 여지: 직전 인덱스 캐시 (monotonic playback 가정).
  for (let i = 1; i < frames.length; i++) {
    const f1 = frames[i]
    if (f1.t < t) continue
    const f0 = frames[i - 1]
    const span = f1.t - f0.t
    const u = span <= 0 ? 0 : (t - f0.t) / span
    return lerpVec3(f0.pos, f1.pos, u)
  }
  return last.pos
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const ms = Math.floor((sec - s) * 100)
  return `${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}s`
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ── Component ──────────────────────────────────────────────────────
export const ReplayTimeline = React.forwardRef<ReplayTimelineHandle, ReplayTimelineProps>(
  function ReplayTimeline(
    {
      recording,
      playback,
      speed = 1,
      onFrame,
      currentToolPosition,
      onTimelineSeek,
      maxDurationSec = DEFAULT_MAX_DURATION_SEC,
    },
    ref,
  ) {
    // frames 는 ref 로 보관 — 매 프레임 push 가 state 를 흔들면 렌더 폭탄.
    // UI 에 필요한 duration 만 state 로 흘린다.
    const framesRef = React.useRef<ReplayFrame[]>([])
    const [duration, setDuration] = React.useState(0)
    const [playhead, setPlayhead] = React.useState(0)

    // 녹화 기준 시각 (ms). recording 시작 시점에 설정.
    const recStartMsRef = React.useRef<number | null>(null)
    const lastRecAtRef = React.useRef<number>(0)
    // 재생 기준 시각. playback 시작 시점에 설정, seek 시 갱신.
    const playStartMsRef = React.useRef<number | null>(null)
    const playOffsetSecRef = React.useRef<number>(0)

    // 최신 콜백/좌표 를 ref 로 — rAF closure 안에서 stale 방지.
    const onFrameRef = React.useRef(onFrame)
    const currentPosRef = React.useRef(currentToolPosition)
    const speedRef = React.useRef(speed)
    React.useEffect(() => {
      onFrameRef.current = onFrame
    }, [onFrame])
    React.useEffect(() => {
      currentPosRef.current = currentToolPosition
    }, [currentToolPosition])
    React.useEffect(() => {
      speedRef.current = speed
    }, [speed])

    const maxFrames = Math.max(1, Math.min(MAX_FRAMES, Math.round(MAX_HZ * maxDurationSec)))

    // recording 시작/중지 hook.
    React.useEffect(() => {
      if (recording) {
        // 첫 녹화면 시작 시각 세팅. 누르고 떼고 반복해도 프레임이 이어지게
        // duration 연장 모드로 동작 — 필요 시 clear() 로 리셋.
        if (recStartMsRef.current === null) {
          const base = performance.now()
          // 기존 frames 가 있으면 그 뒤에 이어서 녹음하도록 offset.
          const offset = framesRef.current.length > 0
            ? framesRef.current[framesRef.current.length - 1].t
            : 0
          recStartMsRef.current = base - offset * 1000
        }
        lastRecAtRef.current = 0
      } else {
        recStartMsRef.current = null
      }
    }, [recording])

    // playback 시작/중지 hook.
    React.useEffect(() => {
      if (playback) {
        // 시작 오프셋: 현재 playhead 부터 재개.
        playStartMsRef.current = performance.now()
        playOffsetSecRef.current = playhead >= duration ? 0 : playhead
        if (playhead >= duration) setPlayhead(0)
      } else {
        playStartMsRef.current = null
      }
      // playhead 는 start 시 스냅샷만 — 의존성에 넣지 않음.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playback])

    // 메인 rAF 루프 — recording / playback 모두 여기서 처리.
    React.useEffect(() => {
      if (!recording && !playback) return
      let rafId = 0
      const tick = () => {
        rafId = requestAnimationFrame(tick)
        const now = performance.now()

        // ── Record ────────────────────────────────────────────────
        if (recording && recStartMsRef.current !== null) {
          if (now - lastRecAtRef.current >= MIN_FRAME_DT_MS) {
            lastRecAtRef.current = now
            const t = (now - recStartMsRef.current) / 1000
            if (t <= maxDurationSec) {
              const frames = framesRef.current
              const pos = currentPosRef.current
              // 마지막 프레임과 동일 좌표 + 동일 t 근처면 skip — 정지 상태 압축.
              const last = frames[frames.length - 1]
              const same = last
                && Math.abs(last.pos[0] - pos[0]) < 1e-6
                && Math.abs(last.pos[1] - pos[1]) < 1e-6
                && Math.abs(last.pos[2] - pos[2]) < 1e-6
              if (!same) {
                if (frames.length >= maxFrames) frames.shift()
                frames.push({ t, pos: [pos[0], pos[1], pos[2]] })
                // duration 갱신은 ~10Hz 로 스로틀해도 충분하지만 렌더 비용
                // 이 낮아서 매 샘플 흘려도 안전.
                setDuration(t)
              }
            }
          }
        }

        // ── Playback ──────────────────────────────────────────────
        if (playback && playStartMsRef.current !== null) {
          const elapsed = (now - playStartMsRef.current) / 1000
          const t = playOffsetSecRef.current + elapsed * speedRef.current
          const frames = framesRef.current
          const dur = frames.length > 0 ? frames[frames.length - 1].t : 0
          const clamped = clamp(t, 0, dur)
          const pos = sampleFrames(frames, clamped)
          if (pos) onFrameRef.current(pos, clamped)
          setPlayhead(clamped)
          // 끝에 도달하면 자연스럽게 멈춤 — 부모가 playback=false 로 내리지 않아도
          // 사운드 오프로 유지. 여기서는 playhead 만 홀드.
          if (t >= dur) {
            // no-op — 다음 틱에서도 동일 clamped 로 유지.
          }
        }
      }
      rafId = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(rafId)
    }, [recording, playback, maxDurationSec, maxFrames])

    // imperative API.
    React.useImperativeHandle(ref, () => ({
      clear: () => {
        framesRef.current = []
        setDuration(0)
        setPlayhead(0)
        recStartMsRef.current = null
        playStartMsRef.current = null
        playOffsetSecRef.current = 0
      },
      getDuration: () => {
        const frames = framesRef.current
        return frames.length > 0 ? frames[frames.length - 1].t : 0
      },
      seekTo: (t: number) => {
        const frames = framesRef.current
        const dur = frames.length > 0 ? frames[frames.length - 1].t : 0
        const clamped = clamp(t, 0, dur)
        setPlayhead(clamped)
        playOffsetSecRef.current = clamped
        playStartMsRef.current = performance.now()
        const pos = sampleFrames(frames, clamped)
        if (pos) onFrameRef.current(pos, clamped)
        onTimelineSeek?.(clamped)
      },
    }), [onTimelineSeek])

    // 타임라인 클릭 → seek.
    const barRef = React.useRef<HTMLDivElement | null>(null)
    const handleBarClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const el = barRef.current
      if (!el) return
      const frames = framesRef.current
      const dur = frames.length > 0 ? frames[frames.length - 1].t : 0
      if (dur <= 0) return
      const rect = el.getBoundingClientRect()
      const ratio = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
      const t = ratio * dur
      setPlayhead(t)
      playOffsetSecRef.current = t
      playStartMsRef.current = performance.now()
      const pos = sampleFrames(frames, t)
      if (pos) onFrameRef.current(pos, t)
      onTimelineSeek?.(t)
    }, [onTimelineSeek])

    const playRatio = duration > 0 ? clamp(playhead / duration, 0, 1) : 0

    return (
      <div className="rounded-lg border border-indigo-200 bg-white/80 px-3 py-2 text-[11px]">
        <div className="mb-2 flex items-center gap-2">
          <span className="font-semibold text-indigo-800">타임라인</span>
          {recording && (
            <span
              data-testid="replay-rec-indicator"
              className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-red-600"
            >
              <span aria-hidden>🔴</span> REC
            </span>
          )}
          {playback && (
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
              ▶ PLAY
            </span>
          )}
          <span className="ml-auto font-mono text-slate-600">
            {formatTime(playhead)} / {formatTime(duration)}
          </span>
        </div>

        <div
          ref={barRef}
          onClick={handleBarClick}
          data-testid="replay-timeline-bar"
          className="relative h-3 cursor-pointer overflow-hidden rounded bg-slate-200"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, duration)}
          aria-valuenow={playhead}
          tabIndex={0}
        >
          <div
            className="absolute left-0 top-0 h-full bg-indigo-400/70"
            style={{ width: `${playRatio * 100}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-indigo-700"
            style={{ left: `calc(${playRatio * 100}% - 1px)` }}
          />
        </div>
      </div>
    )
  },
)

ReplayTimeline.displayName = "ReplayTimeline"

export { SPEEDS as REPLAY_SPEEDS }

export default ReplayTimeline
