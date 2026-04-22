// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Voice Warning Sidecar.
// SpeechSynthesis 기반 한국어 음성 경고 어나운서 (sidecar only).
"use client"

import * as React from "react"
import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"

// ── SSOT ──────────────────────────────────────────────────────────────────────
const DEFAULT_LANGUAGE = "ko-KR"
const DEFAULT_RATE = 1.0
const DEFAULT_PITCH = 1.0
const DEFAULT_AUTO_SPEAK = true
const DEFAULT_ENABLED = false
const RATE_MIN = 0.5
const RATE_MAX = 2.0
const RATE_STEP = 0.05
const PITCH_MIN = 0.0
const PITCH_MAX = 2.0
const PITCH_STEP = 0.05
const RECENT_HISTORY_SIZE = 5
const TEST_UTTERANCE = "시뮬레이터 음성 경고 시스템 테스트입니다"

interface LevelProfile {
  prefix: string
  rateMul: number
  pitchMul: number
  icon: string
  label: string
  colorDark: string
  colorLight: string
}

const LEVEL_PROFILE: Record<"info" | "warn" | "danger", LevelProfile> = {
  danger: { prefix: "경고!", rateMul: 0.95, pitchMul: 1.15, icon: "🚨", label: "위험", colorDark: "text-rose-300", colorLight: "text-rose-700" },
  warn: { prefix: "주의.", rateMul: 1.0, pitchMul: 1.05, icon: "⚠", label: "주의", colorDark: "text-amber-300", colorLight: "text-amber-700" },
  info: { prefix: "알림.", rateMul: 1.0, pitchMul: 1.0, icon: "ℹ", label: "정보", colorDark: "text-sky-300", colorLight: "text-sky-700" },
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type VoiceWarningLevel = "info" | "warn" | "danger"

export interface VoiceWarningItem {
  level: VoiceWarningLevel
  message: string
  key?: string
}

export interface VoiceWarningProps {
  warnings: VoiceWarningItem[]
  enabled?: boolean
  autoSpeak?: boolean
  language?: string
  rate?: number
  pitch?: number
  darkMode?: boolean
}

interface SpokenEntry {
  key: string
  level: VoiceWarningLevel
  message: string
  at: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// djb2-ish 경량 해시 (dedupe 용도, crypto 아님)
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function deriveKey(w: VoiceWarningItem): string {
  return w.key && w.key.length > 0 ? w.key : hashString(`${w.level}::${w.message}`)
}

function isSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

// ── Component ─────────────────────────────────────────────────────────────────
function VoiceWarning(props: VoiceWarningProps): React.ReactElement {
  const {
    warnings,
    enabled: enabledProp = DEFAULT_ENABLED,
    autoSpeak: autoSpeakProp = DEFAULT_AUTO_SPEAK,
    language = DEFAULT_LANGUAGE,
    rate: rateProp = DEFAULT_RATE,
    pitch: pitchProp = DEFAULT_PITCH,
    darkMode = true,
  } = props

  const available = React.useMemo(isSpeechAvailable, [])

  const [enabled, setEnabled] = React.useState<boolean>(enabledProp)
  const [autoSpeak, setAutoSpeak] = React.useState<boolean>(autoSpeakProp)
  const [rate, setRate] = React.useState<number>(clamp(rateProp, RATE_MIN, RATE_MAX))
  const [pitch, setPitch] = React.useState<number>(clamp(pitchProp, PITCH_MIN, PITCH_MAX))
  const [availableVoices, setAvailableVoices] = React.useState<SpeechSynthesisVoice[]>([])
  const [selectedVoiceURI, setSelectedVoiceURI] = React.useState<string>("")
  const [recent, setRecent] = React.useState<SpokenEntry[]>([])

  React.useEffect(() => { setEnabled(enabledProp) }, [enabledProp])
  React.useEffect(() => { setAutoSpeak(autoSpeakProp) }, [autoSpeakProp])

  const spokenKeysRef = React.useRef<Set<string>>(new Set())
  const queueRef = React.useRef<SpeechSynthesisUtterance[]>([])
  const speakingRef = React.useRef<boolean>(false)

  // 1) 보이스 목록 (voiceschanged 이벤트 필수 — Chrome 지연 로드)
  React.useEffect(() => {
    if (!available) return
    const synth = window.speechSynthesis
    const load = (): void => {
      const list = synth.getVoices()
      if (list && list.length > 0) setAvailableVoices(list)
    }
    load()
    synth.addEventListener?.("voiceschanged", load)
    return () => synth.removeEventListener?.("voiceschanged", load)
  }, [available])

  const langVoices = React.useMemo(() => {
    const prefix = (language || DEFAULT_LANGUAGE).slice(0, 2).toLowerCase()
    return availableVoices.filter((v) => v.lang.toLowerCase().startsWith(prefix))
  }, [availableVoices, language])

  React.useEffect(() => {
    if (selectedVoiceURI || langVoices.length === 0) return
    const pick = langVoices.find((v) => v.default) ?? langVoices[0]
    if (pick) setSelectedVoiceURI(pick.voiceURI)
  }, [langVoices, selectedVoiceURI])

  const selectedVoice = React.useMemo(() => {
    if (!selectedVoiceURI) return null
    return availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ?? null
  }, [availableVoices, selectedVoiceURI])

  const pumpQueue = React.useCallback((): void => {
    if (!available || speakingRef.current) return
    const next = queueRef.current.shift()
    if (!next) return
    speakingRef.current = true
    try { window.speechSynthesis.speak(next) } catch { speakingRef.current = false }
  }, [available])

  const enqueue = React.useCallback((entry: SpokenEntry): void => {
    if (!available) return
    const profile = LEVEL_PROFILE[entry.level]
    const utter = new SpeechSynthesisUtterance(`${profile.prefix} ${entry.message}`.trim())
    utter.lang = language
    utter.rate = clamp(rate * profile.rateMul, RATE_MIN, RATE_MAX)
    utter.pitch = clamp(pitch * profile.pitchMul, PITCH_MIN, PITCH_MAX)
    if (selectedVoice) utter.voice = selectedVoice
    utter.onend = () => { speakingRef.current = false; pumpQueue() }
    utter.onerror = () => { speakingRef.current = false; pumpQueue() }
    queueRef.current.push(utter)
    setRecent((prev) => [entry, ...prev].slice(0, RECENT_HISTORY_SIZE))
    pumpQueue()
  }, [available, language, rate, pitch, selectedVoice, pumpQueue])

  const cancelAll = React.useCallback((): void => {
    if (!available) return
    try { window.speechSynthesis.cancel() } catch { /* noop */ }
    queueRef.current = []
    speakingRef.current = false
  }, [available])

  // 2) warnings prop 변화 → 신규만 enqueue
  React.useEffect(() => {
    if (!available || !enabled || !autoSpeak) return
    const spoken = spokenKeysRef.current
    for (const w of warnings) {
      const key = deriveKey(w)
      if (spoken.has(key)) continue
      spoken.add(key)
      enqueue({ key, level: w.level, message: w.message, at: Date.now() })
    }
  }, [warnings, enabled, autoSpeak, available, enqueue])

  // 3) enabled off → 즉시 중단
  React.useEffect(() => {
    if (!enabled) cancelAll()
  }, [enabled, cancelAll])

  // 4) 탭 hidden → cancel + 큐 리셋
  React.useEffect(() => {
    if (!available) return
    const onVis = (): void => { if (document.hidden) cancelAll() }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [available, cancelAll])

  // 5) unmount cleanup
  React.useEffect(() => {
    return () => {
      if (available) { try { window.speechSynthesis.cancel() } catch { /* noop */ } }
      queueRef.current = []
      speakingRef.current = false
    }
  }, [available])

  const handleTest = React.useCallback((): void => {
    if (!available || !enabled) return
    enqueue({ key: `test-${Date.now()}`, level: "info", message: TEST_UTTERANCE, at: Date.now() })
  }, [available, enabled, enqueue])

  const hasActiveDanger = React.useMemo(
    () => warnings.some((w) => w.level === "danger"),
    [warnings],
  )

  // ── UI ──────────────────────────────────────────────────────────────────────
  const textCls = darkMode ? "text-slate-100" : "text-slate-900"
  const subCls = darkMode ? "text-slate-400" : "text-slate-500"
  const panelBg = darkMode ? "bg-slate-900/60" : "bg-white/70"
  const borderCls = darkMode ? "border-slate-700" : "border-slate-200"

  if (!available) {
    return (
      <HolographicFrame accent="amber" intensity="subtle" darkMode={darkMode}>
        <div className="p-3 space-y-1 select-none">
          <div className={`text-xs font-bold tracking-wide uppercase ${textCls}`}>🔊 음성 경고 안내</div>
          <div className={`text-[11px] ${subCls}`}>브라우저 미지원 — SpeechSynthesis API 를 사용할 수 없습니다.</div>
        </div>
      </HolographicFrame>
    )
  }

  const toggleBtnCls = enabled
    ? "bg-amber-500 hover:bg-amber-400 text-slate-950"
    : darkMode ? "bg-slate-700 hover:bg-slate-600 text-slate-200" : "bg-slate-300 hover:bg-slate-400 text-slate-800"

  return (
    <HolographicFrame accent="amber" intensity={enabled && hasActiveDanger ? "strong" : "medium"} darkMode={darkMode}>
      <div className="p-3 space-y-2 select-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <LiveIndicator
              watch={[warnings.length, hasActiveDanger ? 1 : 0, enabled ? 1 : 0, rate, pitch]}
              color={enabled && hasActiveDanger ? "rose" : "amber"}
              darkMode={darkMode}
              label={enabled && hasActiveDanger ? "ALERT" : "VOICE"}
            />
            <span className={`text-xs font-bold tracking-wide uppercase ${textCls}`}>🔊 음성 경고 안내</span>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
            aria-label="master voice toggle"
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${toggleBtnCls}`}
          >
            <span className={`inline-block w-6 h-3 rounded-full relative transition-colors ${enabled ? "bg-slate-950/40" : "bg-slate-500/40"}`}>
              <span className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-all ${enabled ? "left-3.5" : "left-0.5"}`} />
            </span>
            {enabled ? "ON" : "OFF"}
          </button>
        </div>

        <label className="flex items-center gap-2">
          <span className={`text-[10px] uppercase tracking-wider w-14 ${subCls}`}>보이스</span>
          <select
            value={selectedVoiceURI}
            onChange={(e) => setSelectedVoiceURI(e.target.value)}
            className={`flex-1 text-[11px] rounded-md px-1.5 py-1 border ${borderCls} ${panelBg} ${textCls}`}
            aria-label="voice selection"
          >
            <option value="">시스템 기본</option>
            {langVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className={`text-[10px] uppercase tracking-wider ${subCls}`}>속도 <span className="tabular-nums">{rate.toFixed(2)}</span></span>
            <input type="range" min={RATE_MIN} max={RATE_MAX} step={RATE_STEP} value={rate} onChange={(e) => setRate(clamp(parseFloat(e.target.value), RATE_MIN, RATE_MAX))} className="accent-amber-500" aria-label="speech rate" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className={`text-[10px] uppercase tracking-wider ${subCls}`}>피치 <span className="tabular-nums">{pitch.toFixed(2)}</span></span>
            <input type="range" min={PITCH_MIN} max={PITCH_MAX} step={PITCH_STEP} value={pitch} onChange={(e) => setPitch(clamp(parseFloat(e.target.value), PITCH_MIN, PITCH_MAX))} className="accent-amber-500" aria-label="speech pitch" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} className="accent-amber-500" aria-label="auto speak new warnings" />
            <span className={`text-[11px] ${textCls}`}>자동 낭독</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={handleTest} disabled={!enabled} className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${enabled ? "bg-amber-600 hover:bg-amber-500 text-white" : "bg-slate-600/40 text-slate-400 cursor-not-allowed"}`} aria-label="test speech">🔊 테스트 음성</button>
            <button type="button" onClick={cancelAll} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-rose-700 hover:bg-rose-600 text-white transition-colors" aria-label="stop speech">🔇 즉시 중단</button>
          </div>
        </div>

        <div className="space-y-0.5 pt-1">
          <div className={`text-[9px] uppercase tracking-wider ${subCls}`}>최근 낭독 (last {RECENT_HISTORY_SIZE})</div>
          {recent.length === 0 ? (
            <div className={`text-[10px] italic ${subCls}`}>아직 낭독된 경고가 없습니다.</div>
          ) : (
            <ul className={`text-[11px] leading-snug space-y-0.5 ${subCls}`}>
              {recent.map((r) => {
                const profile = LEVEL_PROFILE[r.level]
                const colorCls = darkMode ? profile.colorDark : profile.colorLight
                return (
                  <li key={`${r.key}-${r.at}`} className="flex items-start gap-1.5 opacity-80">
                    <span className={colorCls} aria-hidden="true">{profile.icon}</span>
                    <span className={`${colorCls} w-8 shrink-0 text-[9px] uppercase tracking-wider pt-0.5`}>{profile.label}</span>
                    <span className="flex-1 truncate">{r.message}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className={`text-[9px] leading-tight ${subCls}`}>
          SpeechSynthesis · {language} · {enabled ? "활성" : "비활성"} · {autoSpeak ? "자동" : "수동"} · voice: {selectedVoice ? selectedVoice.name : "시스템 기본"}
        </div>
      </div>
    </HolographicFrame>
  )
}

export default VoiceWarning
export { VoiceWarning }
