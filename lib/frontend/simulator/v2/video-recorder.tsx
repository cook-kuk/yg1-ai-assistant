// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v2 — Canvas Video Recorder
//
// Records the live WebGL canvas via `canvas.captureStream(30)` + MediaRecorder
// and triggers a WebM download on stop. Intended to sit next to the
// <Cutting3DScene/> controls so users can capture short demo clips of their
// cutting simulation.
//
// Graceful degradation:
//   - SSR / older browsers without MediaRecorder → button is disabled with hint.
//   - vp9 unsupported → falls back to vp8.
//   - canvasRef not populated yet → inline error on click (no crash).
"use client"

import { useEffect, useRef, useState } from "react"

export interface VideoRecorderProps {
  /** Target canvas element to capture. Ref may be null until the 3D scene mounts. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** Base file name (no extension). Default "cutting-simulator-recording". */
  fileName?: string
}

/**
 * Pick the best supported WebM codec at runtime. vp9 first (better compression),
 * fall back to vp8, finally plain "video/webm" if the browser only advertises
 * generic support. Returns null when MediaRecorder itself is missing.
 */
function pickMimeType(): string | null {
  if (typeof window === "undefined") return null
  if (typeof MediaRecorder === "undefined") return null
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ]
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {
      // isTypeSupported can throw on some embedded browsers — keep trying.
    }
  }
  return null
}

/**
 * Trigger a browser download via Blob + object URL anchor. Matches the pattern
 * used by mesh-export.tsx so behavior/UX is consistent across exporters.
 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Format seconds as mm:ss (elapsed timer display). */
function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

export function VideoRecorder({
  canvasRef,
  fileName = "cutting-simulator-recording",
}: VideoRecorderProps): React.ReactElement {
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [chunks, setChunks] = useState<Blob[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Non-state refs for cleanup: we need to stop tracks / clear timer from
  // effects regardless of React state timing.
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const startTimeRef = useRef<number>(0)
  // Mirror of `chunks` so the MediaRecorder event handler (captured at start
  // time) can push into a stable array without stale closures.
  const chunksRef = useRef<Blob[]>([])

  // SSR-safe feature detection — evaluated once on mount.
  const [supported, setSupported] = useState(true)
  useEffect(() => {
    if (typeof window === "undefined") {
      setSupported(false)
      return
    }
    setSupported(pickMimeType() !== null)
  }, [])

  // Tear down stream + timer if the component unmounts mid-recording. We
  // intentionally do NOT save the partial recording on unmount — the user never
  // clicked stop, so we just stop tracks to release GPU/capture resources.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      const stream = streamRef.current
      if (stream) {
        for (const track of stream.getTracks()) track.stop()
        streamRef.current = null
      }
    }
  }, [])

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const cleanupStream = () => {
    const stream = streamRef.current
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      streamRef.current = null
    }
  }

  const handleStart = () => {
    setError(null)
    if (recording) return
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      setError("이 브라우저에서는 녹화를 지원하지 않습니다.")
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      setError("3D 캔버스가 아직 준비되지 않았습니다.")
      return
    }
    const mimeType = pickMimeType()
    if (!mimeType) {
      setError("이 브라우저의 MediaRecorder 가 WebM 을 지원하지 않습니다.")
      return
    }

    let stream: MediaStream
    try {
      stream = canvas.captureStream(30)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`캔버스 스트림 획득 실패: ${msg}`)
      return
    }
    streamRef.current = stream

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch (e) {
      cleanupStream()
      const msg = e instanceof Error ? e.message : String(e)
      setError(`MediaRecorder 생성 실패: ${msg}`)
      return
    }

    chunksRef.current = []
    setChunks([])

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
        setChunks(prev => [...prev, event.data])
      }
    }

    recorder.onstop = () => {
      stopTimer()
      const finalChunks = chunksRef.current
      if (finalChunks.length > 0) {
        const blob = new Blob(finalChunks, { type: mimeType })
        triggerDownload(blob, `${fileName}.webm`)
      }
      chunksRef.current = []
      setChunks([])
      setElapsed(0)
      setRecording(false)
      setMediaRecorder(null)
      cleanupStream()
    }

    recorder.onerror = (event: Event) => {
      const anyEvent = event as Event & { error?: { message?: string } }
      setError(`녹화 오류: ${anyEvent.error?.message ?? "unknown"}`)
    }

    try {
      recorder.start()
    } catch (e) {
      cleanupStream()
      const msg = e instanceof Error ? e.message : String(e)
      setError(`녹화 시작 실패: ${msg}`)
      return
    }

    setMediaRecorder(recorder)
    setRecording(true)
    setElapsed(0)
    startTimeRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startTimeRef.current) / 1000)
    }, 250)
  }

  const handleStop = () => {
    if (!recording || !mediaRecorder) return
    try {
      // `stop` fires ondataavailable + onstop; download + cleanup run there.
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`녹화 중지 실패: ${msg}`)
      // Best-effort cleanup if stop threw before onstop could run.
      stopTimer()
      cleanupStream()
      setRecording(false)
      setMediaRecorder(null)
    }
  }

  const disabled = !supported

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={recording ? handleStop : handleStart}
        disabled={disabled}
        className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${
          recording
            ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
            : "border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
        }`}
        aria-label={recording ? "녹화 중지" : "녹화 시작"}
      >
        <span>{recording ? "⏹ 녹화 중지" : "🎥 녹화 시작"}</span>
      </button>
      {recording && (
        <span
          className="flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-700"
          role="status"
          aria-live="polite"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden />
          REC {formatElapsed(elapsed)}
        </span>
      )}
      {!supported && (
        <span className="text-[11px] text-slate-500">
          브라우저 미지원
        </span>
      )}
      {error && (
        <span className="text-[11px] text-rose-600" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default VideoRecorder
