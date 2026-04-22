"use client"

/**
 * 🎤 음성 입력 버튼 (v3)
 *
 * - Web Speech API (webkitSpeechRecognition || SpeechRecognition) 감지
 * - 클릭 → 녹음 → 최종 인식 결과를 onTranscript 콜백으로 전달
 * - 중간 결과(interim) 실시간 회색 텍스트 표시
 * - 녹음 중 ring pulse + sound wave 확산 애니메이션
 * - 마이크 권한 거부 / 미지원 브라우저 처리
 * - 다크모드 지원
 *
 * cutting-simulator-v2.tsx는 건드리지 않음.
 * AiQueryBar와 조합해 /api/simulator/nl-query 자동 프리셋으로 활용.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Mic, MicOff, AlertTriangle } from "lucide-react"

// ─────────────────────────────────────────────────────────────
// Web Speech API minimal type shims
// (lib.dom.d.ts 에 표준 SpeechRecognition 이 없는 환경 대비)
// ─────────────────────────────────────────────────────────────

interface SpeechRecognitionAlternativeLite {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResultLite {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternativeLite
  [index: number]: SpeechRecognitionAlternativeLite
}

interface SpeechRecognitionResultListLite {
  readonly length: number
  item(index: number): SpeechRecognitionResultLite
  [index: number]: SpeechRecognitionResultLite
}

interface SpeechRecognitionEventLite extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLite
}

interface SpeechRecognitionErrorEventLite extends Event {
  readonly error: string
  readonly message?: string
}

interface SpeechRecognitionLite extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((ev: SpeechRecognitionEventLite) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEventLite) => void) | null
  onend: ((ev: Event) => void) | null
  onstart: ((ev: Event) => void) | null
  onspeechend: ((ev: Event) => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLite

interface WindowWithSpeech extends Window {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface VoiceInputButtonProps {
  /** 최종 인식 결과 콜백 */
  onTranscript: (text: string) => void
  /** 언어 (default "ko-KR") */
  lang?: string
  darkMode?: boolean
  className?: string
}

type Phase = "idle" | "listening" | "finalizing" | "error" | "unsupported"

type PermissionStatusState = "granted" | "denied" | "prompt" | "unknown"

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function resolveRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as WindowWithSpeech
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function humanizeSpeechError(err: string): string {
  switch (err) {
    case "no-speech":
      return "음성이 감지되지 않았습니다"
    case "audio-capture":
      return "마이크를 사용할 수 없습니다"
    case "not-allowed":
    case "service-not-allowed":
      return "마이크 권한 허용 필요"
    case "network":
      return "네트워크 오류"
    case "aborted":
      return "중단됨"
    case "language-not-supported":
      return "지원하지 않는 언어"
    default:
      return `음성 인식 오류: ${err}`
  }
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

function VoiceInputButton({
  onTranscript,
  lang = "ko-KR",
  darkMode = false,
  className = "",
}: VoiceInputButtonProps) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [interim, setInterim] = useState<string>("")
  const [finalText, setFinalText] = useState<string>("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [permission, setPermission] = useState<PermissionStatusState>("unknown")
  const [supported, setSupported] = useState<boolean>(true)

  const recognitionRef = useRef<SpeechRecognitionLite | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Initial feature & permission check ────────────────────
  useEffect(() => {
    const ctor = resolveRecognitionCtor()
    if (!ctor) {
      setSupported(false)
      setPhase("unsupported")
      return
    }

    // permissions API (옵셔널)
    const nav = typeof navigator !== "undefined" ? navigator : null
    const permApi = nav?.permissions as
      | { query?: (d: { name: PermissionName }) => Promise<PermissionStatus> }
      | undefined
    if (permApi?.query) {
      permApi
        .query({ name: "microphone" as PermissionName })
        .then((status) => {
          setPermission(status.state as PermissionStatusState)
          status.onchange = () => {
            setPermission(status.state as PermissionStatusState)
          }
        })
        .catch(() => {
          // 일부 브라우저는 microphone 이름을 지원하지 않음 — 무시
          setPermission("unknown")
        })
    }
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      try {
        recognitionRef.current?.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [])

  // ── Start recording ───────────────────────────────────────
  const start = useCallback(() => {
    if (phase === "listening") return

    const ctor = resolveRecognitionCtor()
    if (!ctor) {
      setSupported(false)
      setPhase("unsupported")
      showToast("이 브라우저는 음성 입력을 지원하지 않습니다")
      return
    }

    if (permission === "denied") {
      setPhase("error")
      setErrorMsg("마이크 권한 허용 필요")
      showToast("마이크 권한 허용 필요")
      return
    }

    // 이전 세션 정리
    try {
      recognitionRef.current?.abort()
    } catch {
      // ignore
    }

    const rec = new ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setInterim("")
      setFinalText("")
      setErrorMsg(null)
      setPhase("listening")
    }

    rec.onresult = (ev: SpeechRecognitionEventLite) => {
      let interimBuf = ""
      let finalBuf = ""
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i]
        const alt = result[0]
        if (!alt) continue
        if (result.isFinal) {
          finalBuf += alt.transcript
        } else {
          interimBuf += alt.transcript
        }
      }
      if (interimBuf) setInterim(interimBuf)
      if (finalBuf) {
        setFinalText((prev) => (prev + finalBuf).trim())
      }
    }

    rec.onerror = (ev: SpeechRecognitionErrorEventLite) => {
      const msg = humanizeSpeechError(ev.error)
      setErrorMsg(msg)
      setPhase("error")
      showToast(msg)
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setPermission("denied")
      }
    }

    rec.onend = () => {
      // finalize — emit transcript and fade out
      setPhase((prev) => {
        if (prev === "error" || prev === "unsupported") return prev
        return "finalizing"
      })
      // 최종 텍스트 결정: finalText 우선, 없으면 interim 사용
      setFinalText((finalBuf) => {
        const text = (finalBuf || interim || "").trim()
        if (text) {
          try {
            onTranscript(text)
          } catch {
            // 사용자 콜백 오류는 내부 상태에 영향 X
          }
        }
        // fade-out 후 리셋
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = setTimeout(() => {
          setInterim("")
          setFinalText("")
          setPhase((p) => (p === "finalizing" ? "idle" : p))
        }, 600)
        return finalBuf
      })
    }

    recognitionRef.current = rec
    try {
      rec.start()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setPhase("error")
      showToast(`음성 인식 시작 실패: ${msg}`)
    }
  }, [phase, permission, lang, interim, onTranscript, showToast])

  // ── Stop (manual) ─────────────────────────────────────────
  const stop = useCallback(() => {
    const rec = recognitionRef.current
    if (!rec) return
    try {
      rec.stop()
    } catch {
      // ignore
    }
  }, [])

  const onButtonClick = useCallback(() => {
    if (!supported) {
      showToast("이 브라우저는 음성 입력을 지원하지 않습니다")
      return
    }
    if (phase === "listening") {
      stop()
    } else {
      start()
    }
  }, [supported, phase, start, stop, showToast])

  // ── Style tokens ──────────────────────────────────────────
  const isListening = phase === "listening"
  const isFinalizing = phase === "finalizing"

  const btnBaseBg = darkMode
    ? "bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700"
    : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200"

  const btnRecordingBg =
    "bg-gradient-to-br from-rose-500 to-red-600 text-white border-rose-400 shadow-[0_0_28px_rgba(244,63,94,0.6)]"

  const btnDisabledBg = darkMode
    ? "bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed"
    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"

  const interimColor = darkMode ? "text-slate-400" : "text-slate-500"
  const finalColor = darkMode ? "text-slate-100" : "text-slate-900"

  const disabled = !supported

  const tooltip = !supported
    ? "음성 입력 미지원"
    : permission === "denied"
      ? "마이크 권한 허용 필요"
      : isListening
        ? "클릭하여 종료"
        : "클릭하여 음성 입력 시작"

  return (
    <div
      className={`relative inline-flex flex-col items-center gap-2 ${className}`}
    >
      {/* Button + rings */}
      <div className="relative flex items-center justify-center">
        {/* Expanding rings (listening only) */}
        <AnimatePresence>
          {isListening &&
            [0, 1, 2].map((i) => (
              <motion.span
                key={`ring-${i}`}
                aria-hidden
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: 0, scale: 2.4 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 1.6,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: i * 0.45,
                }}
                className="absolute inset-0 rounded-full border-2 border-rose-400 pointer-events-none"
              />
            ))}
        </AnimatePresence>

        {/* Sound waves (SVG circles) */}
        {isListening && (
          <svg
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
          >
            {[0, 1, 2].map((i) => (
              <motion.circle
                key={`wave-${i}`}
                cx="50"
                cy="50"
                r="22"
                fill="none"
                stroke={darkMode ? "#f43f5e" : "#fb7185"}
                strokeWidth="1.5"
                initial={{ opacity: 0.9, scale: 0.4 }}
                animate={{ opacity: 0, scale: 1.8 }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: i * 0.35,
                }}
                style={{ transformOrigin: "50px 50px" }}
              />
            ))}
          </svg>
        )}

        <motion.button
          type="button"
          onClick={onButtonClick}
          disabled={disabled}
          aria-label={tooltip}
          title={tooltip}
          animate={
            isListening
              ? { scale: [1, 1.06, 1] }
              : isFinalizing
                ? { opacity: [1, 0.6] }
                : { scale: 1, opacity: 1 }
          }
          transition={
            isListening
              ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
              : isFinalizing
                ? { duration: 0.6, ease: "easeOut" }
                : { duration: 0.2 }
          }
          className={`relative z-10 flex items-center justify-center w-16 h-16 rounded-full border-2 transition-colors duration-200 ${
            disabled
              ? btnDisabledBg
              : isListening
                ? btnRecordingBg
                : btnBaseBg
          }`}
        >
          {!supported ? (
            <MicOff className="w-7 h-7" />
          ) : (
            <Mic className="w-7 h-7" />
          )}
        </motion.button>
      </div>

      {/* Status label */}
      <div className="min-h-[1.25rem] text-[11px] tracking-wide">
        {phase === "unsupported" && (
          <span className="inline-flex items-center gap-1 text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            음성 입력 미지원
          </span>
        )}
        {phase === "listening" && (
          <span className={darkMode ? "text-rose-300" : "text-rose-600"}>
            듣는 중...
          </span>
        )}
        {phase === "finalizing" && (
          <span className={darkMode ? "text-emerald-300" : "text-emerald-600"}>
            전송 중
          </span>
        )}
        {phase === "idle" && permission === "denied" && (
          <span className="inline-flex items-center gap-1 text-amber-500">
            <AlertTriangle className="w-3 h-3" />
            마이크 권한 허용 필요
          </span>
        )}
        {phase === "error" && errorMsg && (
          <span className="inline-flex items-center gap-1 text-rose-500">
            <AlertTriangle className="w-3 h-3" />
            {errorMsg}
          </span>
        )}
      </div>

      {/* Transcript preview (interim + final) */}
      <AnimatePresence>
        {(interim || finalText) && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: isFinalizing ? 0 : 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className={`max-w-xs text-center text-sm px-3 py-1.5 rounded-lg border ${
              darkMode
                ? "bg-slate-900/80 border-slate-700"
                : "bg-white/90 border-slate-200"
            }`}
          >
            <span className={finalColor}>{finalText}</span>
            {interim && (
              <span className={`${interimColor} italic ml-1`}>{interim}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="voice-toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-3 py-1.5 text-xs shadow-lg ${
              darkMode
                ? "bg-slate-800 text-slate-100 border border-slate-700"
                : "bg-slate-900 text-white"
            }`}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default VoiceInputButton
