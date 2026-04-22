// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Time-lapse Sidecar
// 전체 가공 사이클을 N초 스토리보드로 압축해서 보여주는 가공 영상 다이제스트.
// Pure DOM + canvas + framer-motion. 외부 ffmpeg / recorder 없음 (향후 확장 여지).
// 래퍼: HolographicFrame accent=indigo. 이 파일만 신규 생성 — cutting-simulator-v2.tsx 불변.
"use client"

import * as React from "react"
import { motion, AnimatePresence, useAnimate } from "framer-motion"
import { HolographicFrame } from "./holographic-frame"
import { LiveIndicator } from "./live-indicator"
import { AnimatedNumber } from "./animated-number"

// ── Props ────────────────────────────────────────────────────────────
export interface TimeLapseSimProps {
  totalCycleMin: number              // 1 파트 풀 사이클 시간 (분)
  partsPerTool: number               // toolLife / cycleTime
  totalPartsToMake?: number          // default min(partsPerTool*1.5, 50)
  spindleRpm: number
  feedVfMmMin: number
  raUm: number
  toolLifeMin: number
  durationSec?: number               // 재생 길이 (default 30)
  autoPlay?: boolean                 // default false
  darkMode?: boolean
}

// ── SSOT Constants ──────────────────────────────────────────────────
const DEFAULT_DURATION_SEC = 30
const STAGE_W = 400
const STAGE_H = 220
const MAX_AUTO_PARTS = 50
const PARTS_MULTIPLIER = 1.5
const PHASE1_END = 0.10
const PHASE2_END = 0.80
const PHASE3_END = 0.95
const CHIP_COUNT = 8
const TOOL_SPIN_DEG_PER_SEC = 1080
const SPEEDS = [0.5, 1, 2] as const
type Speed = (typeof SPEEDS)[number]
type PhaseId = "prep" | "production" | "tool-change" | "done"

const PHASE_META: Record<PhaseId, { label: string; caption: string; accentHex: string; textCls: string }> = {
  prep: { label: "가공 준비", caption: "공구 접근 — 가공 시작 준비 중", accentHex: "#818cf8", textCls: "text-indigo-400" },
  production: { label: "양산 가공", caption: "사이클 반복 중 — 파트 생산", accentHex: "#22d3ee", textCls: "text-cyan-400" },
  "tool-change": { label: "공구 교체", caption: "TOOL CHANGE — 새 공구 장착", accentHex: "#f59e0b", textCls: "text-amber-400" },
  done: { label: "완료", caption: "가공 완료 — 요약 리포트", accentHex: "#10b981", textCls: "text-emerald-400" },
}

function classifyPhase(t: number): PhaseId {
  if (t < PHASE1_END) return "prep"
  if (t < PHASE2_END) return "production"
  if (t < PHASE3_END) return "tool-change"
  return "done"
}

// ── Chip particles ──────────────────────────────────────────────────
interface Chip { x: number; y: number; vx: number; vy: number; life: number }
function seedChips(n: number, w: number, h: number): Chip[] {
  return Array.from({ length: n }, () => ({
    x: w * 0.5, y: h * 0.45,
    vx: (Math.random() - 0.2) * 3.5,
    vy: -1 - Math.random() * 2.5,
    life: Math.random(),
  }))
}
function advanceChips(chips: Chip[], dt: number, w: number, h: number) {
  for (const c of chips) {
    c.x += c.vx * dt * 60; c.y += c.vy * dt * 60
    c.vy += 0.15 * dt * 60
    c.life += dt * 0.9
    if (c.life > 1 || c.x > w || c.y > h) {
      c.x = w * 0.5 + (Math.random() - 0.5) * 4
      c.y = h * 0.45
      c.vx = (Math.random() - 0.2) * 3.5
      c.vy = -1 - Math.random() * 2.5
      c.life = 0
    }
  }
}

// ── Canvas scene ────────────────────────────────────────────────────
function drawScene(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  phase: PhaseId, t: number, cycleT: number,
  toolSpinDeg: number, chips: Chip[], darkMode: boolean,
) {
  ctx.fillStyle = darkMode ? "#0f172a" : "#f1f5f9"
  ctx.fillRect(0, 0, w, h)
  // 그리드
  ctx.strokeStyle = darkMode ? "rgba(99,102,241,0.12)" : "rgba(99,102,241,0.18)"
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = 0; y <= h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  // 스테이지 floor
  const floorY = h * 0.78
  ctx.strokeStyle = darkMode ? "#475569" : "#64748b"
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(w, floorY); ctx.stroke()
  // Part — 우측이 cycleT 에 비례해 깎여나감
  const partLeft = w * 0.28
  const partTop = h * 0.42
  const partRightMax = w * 0.72
  const remaining = phase === "done" ? 0 : 1 - cycleT
  const partRight = partLeft + (partRightMax - partLeft) * remaining
  ctx.fillStyle = darkMode ? "#334155" : "#cbd5e1"
  ctx.fillRect(partLeft, partTop, Math.max(0, partRight - partLeft), floorY - partTop)
  ctx.strokeStyle = darkMode ? "#64748b" : "#475569"
  ctx.lineWidth = 1.2
  ctx.strokeRect(partLeft, partTop, Math.max(0, partRight - partLeft), floorY - partTop)
  // Tool
  let toolTipX: number, toolTipY: number
  if (phase === "prep") {
    toolTipX = partRightMax + 4
    toolTipY = h * 0.05 + (h * 0.3) * (t / PHASE1_END)
  } else if (phase === "done") {
    toolTipX = w * 0.88; toolTipY = h * 0.12
  } else {
    toolTipX = partRight + 4; toolTipY = partTop - 6
  }
  const toolW = 10, toolH = 70
  ctx.save()
  ctx.translate(toolTipX + toolW / 2, toolTipY - toolH / 2)
  ctx.rotate(Math.sin((toolSpinDeg * Math.PI) / 180) * 0.04)
  ctx.fillStyle = phase === "tool-change" ? "#fbbf24" : darkMode ? "#e2e8f0" : "#1e293b"
  ctx.fillRect(-toolW / 2, -toolH / 2, toolW, toolH)
  ctx.strokeStyle = darkMode ? "rgba(99,102,241,0.6)" : "rgba(99,102,241,0.75)"
  ctx.lineWidth = 1
  const stripeStep = toolH / 6
  for (let i = 0; i < 6; i++) {
    const y = -toolH / 2 + stripeStep * i + ((toolSpinDeg / 30) % stripeStep)
    ctx.beginPath(); ctx.moveTo(-toolW / 2, y); ctx.lineTo(toolW / 2, y); ctx.stroke()
  }
  ctx.restore()
  // 이송 마크
  ctx.strokeStyle = darkMode ? "rgba(34,211,238,0.4)" : "rgba(6,182,212,0.5)"
  for (let i = 0; i < 10; i++) {
    const x = (w / 10) * i + ((t * 80) % (w / 10))
    ctx.beginPath(); ctx.moveTo(x, floorY + 4); ctx.lineTo(x + 6, floorY + 4); ctx.stroke()
  }
  // 칩 스프레이 — production 단계
  if (phase === "production") {
    for (const c of chips) {
      ctx.fillStyle = `rgba(251, 191, 36, ${Math.max(0, 1 - c.life) * 0.85})`
      ctx.beginPath(); ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2); ctx.fill()
    }
  }
  // tool-change flash
  if (phase === "tool-change") {
    const pulse = 0.25 + Math.abs(Math.sin(t * Math.PI * 12)) * 0.2
    ctx.fillStyle = `rgba(251, 191, 36, ${pulse})`
    ctx.fillRect(0, 0, w, h)
  }
  // done — 체크 링
  if (phase === "done") {
    ctx.strokeStyle = "rgba(16,185,129,0.7)"; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 28, 0, Math.PI * 2); ctx.stroke()
    ctx.strokeStyle = "#10b981"; ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(w / 2 - 10, h / 2); ctx.lineTo(w / 2 - 2, h / 2 + 8); ctx.lineTo(w / 2 + 12, h / 2 - 10)
    ctx.stroke()
  }
}

// ── Main ────────────────────────────────────────────────────────────
export function TimeLapseSim({
  totalCycleMin, partsPerTool, totalPartsToMake,
  spindleRpm, feedVfMmMin, raUm, toolLifeMin,
  durationSec = DEFAULT_DURATION_SEC, autoPlay = false, darkMode = false,
}: TimeLapseSimProps): React.ReactElement {
  const safeParts =
    totalPartsToMake && totalPartsToMake > 0
      ? Math.floor(totalPartsToMake)
      : Math.max(1, Math.min(MAX_AUTO_PARTS, Math.floor(partsPerTool * PARTS_MULTIPLIER)))

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const chipsRef = React.useRef<Chip[]>(seedChips(CHIP_COUNT, STAGE_W, STAGE_H))
  const rafRef = React.useRef<number | null>(null)
  const lastTsRef = React.useRef<number>(0)
  const toolSpinRef = React.useRef<number>(0)

  const [progress, setProgress] = React.useState(0)
  const [playing, setPlaying] = React.useState(autoPlay)
  const [speed, setSpeed] = React.useState<Speed>(1)
  const [scope, animate] = useAnimate()

  const phase = classifyPhase(progress)
  const phaseMeta = PHASE_META[phase]

  // 파생 메트릭
  const productionProgress =
    Math.max(0, Math.min(1, (progress - PHASE1_END) / (PHASE2_END - PHASE1_END)))
  const partsMade = phase === "done" ? safeParts : Math.min(safeParts, Math.floor(productionProgress * safeParts))
  const elapsedMin = progress * totalCycleMin * safeParts
  const toolLifePct = toolLifeMin > 0 ? Math.min(100, (elapsedMin / toolLifeMin) * 100) : 0
  const currentCycleT =
    phase === "production" ? (productionProgress * safeParts) % 1
      : phase === "tool-change" ? 1
      : 0

  // RAF loop
  React.useEffect(() => {
    if (!playing) return
    let cancelled = false
    const step = (ts: number) => {
      if (cancelled) return
      if (!lastTsRef.current) lastTsRef.current = ts
      const dt = Math.max(0, Math.min(0.1, (ts - lastTsRef.current) / 1000))
      lastTsRef.current = ts
      toolSpinRef.current = (toolSpinRef.current + TOOL_SPIN_DEG_PER_SEC * dt * speed) % 360
      advanceChips(chipsRef.current, dt * speed, STAGE_W, STAGE_H)
      setProgress((prev) => {
        const next = prev + (dt * speed) / durationSec
        if (next >= 1) { cancelled = true; setPlaying(false); return 1 }
        return next
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastTsRef.current = 0
    }
  }, [playing, speed, durationSec])

  // Canvas draw
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    drawScene(ctx, STAGE_W, STAGE_H, phase, progress, currentCycleT, toolSpinRef.current, chipsRef.current, darkMode)
  }, [progress, phase, currentCycleT, darkMode])

  // Phase 전환 motion flourish
  const prevPhaseRef = React.useRef<PhaseId>(phase)
  React.useEffect(() => {
    if (prevPhaseRef.current !== phase && scope.current) {
      void animate(scope.current, { scale: [1, 1.03, 1] }, { duration: 0.45, ease: "easeOut" })
    }
    prevPhaseRef.current = phase
  }, [phase, animate, scope])

  const handlePlayPause = () => {
    if (progress >= 1) { setProgress(0); setPlaying(true); return }
    setPlaying((p) => !p)
  }
  const handleReset = () => {
    setPlaying(false); setProgress(0)
    lastTsRef.current = 0; toolSpinRef.current = 0
    chipsRef.current = seedChips(CHIP_COUNT, STAGE_W, STAGE_H)
  }
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) =>
    setProgress(Math.max(0, Math.min(1, Number(e.target.value) / 1000)))

  const outerBg = darkMode ? "bg-slate-950/70 text-slate-100" : "bg-white/80 text-slate-900"
  const secondaryText = darkMode ? "text-slate-400" : "text-slate-600"
  const btnCls = darkMode
    ? "bg-slate-800 hover:bg-slate-700 text-slate-100 ring-1 ring-slate-700"
    : "bg-slate-100 hover:bg-slate-200 text-slate-800 ring-1 ring-slate-300"
  const cardCls = `rounded-md p-2 ring-1 ${darkMode ? "ring-slate-700 bg-slate-900/60" : "ring-slate-200 bg-slate-50"}`

  return (
    <HolographicFrame accent="indigo" intensity="medium" darkMode={darkMode}>
      <div ref={scope} className={`relative p-4 ${outerBg}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold tracking-wide">Time-lapse · 가공 영상 다이제스트</h3>
            <LiveIndicator
              watch={[progress, partsMade]}
              label={playing ? "PLAYING" : progress >= 1 ? "DONE" : "PAUSED"}
              color={playing ? "emerald" : progress >= 1 ? "cyan" : "amber"}
              showCount={false}
              darkMode={darkMode}
            />
          </div>
          <div className="flex items-center gap-1 text-[11px]">
            {SPEEDS.map((s) => (
              <button
                key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}
                className={`px-2 py-0.5 rounded-md tabular-nums ${speed === s ? "bg-indigo-500 text-white" : btnCls}`}
              >{s}×</button>
            ))}
          </div>
        </div>

        {/* Stage + HUD */}
        <div className="flex gap-3">
          <div className="relative" style={{ width: STAGE_W, height: STAGE_H }}>
            <canvas
              ref={canvasRef} width={STAGE_W} height={STAGE_H}
              className="rounded-md block"
              style={{ width: STAGE_W, height: STAGE_H }}
              aria-label="Time-lapse 가공 스테이지"
            />
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.35 }}
                className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[11px] font-semibold backdrop-blur-sm"
                style={{
                  background: darkMode ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.8)",
                  border: `1px solid ${phaseMeta.accentHex}`, color: phaseMeta.accentHex,
                }}
              >{phaseMeta.caption}</motion.div>
            </AnimatePresence>
            <AnimatePresence>
              {phase === "tool-change" && (
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <span className="px-3 py-1 rounded-md bg-amber-500 text-slate-900 font-extrabold text-xs tracking-widest shadow-lg">
                    TOOL CHANGE
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {phase === "done" && (
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 16 }}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-500 text-white text-[11px] font-bold shadow-lg"
                >✓ {partsMade} 개 완료 · {elapsedMin.toFixed(1)} 분</motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* HUD */}
          <div className="flex-1 grid grid-cols-2 gap-2 text-[11px]">
            <div className={cardCls}>
              <div className={`uppercase tracking-wider ${secondaryText}`}>파트 생산</div>
              <div className="text-lg font-bold">
                <AnimatedNumber value={partsMade} suffix={` / ${safeParts}`} />
              </div>
            </div>
            <div className={cardCls}>
              <div className={`uppercase tracking-wider ${secondaryText}`}>공구 수명</div>
              <div className="text-lg font-bold">
                <AnimatedNumber value={toolLifePct} decimals={1} suffix=" %" />
              </div>
              <div className={`mt-1 h-1.5 rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-200"} overflow-hidden`}>
                <motion.div
                  className="h-full"
                  style={{ background: toolLifePct > 90 ? "#ef4444" : toolLifePct > 70 ? "#f59e0b" : "#22d3ee" }}
                  animate={{ width: `${toolLifePct}%` }} transition={{ duration: 0.2 }}
                />
              </div>
            </div>
            <div className={cardCls}>
              <div className={`uppercase tracking-wider ${secondaryText}`}>누적 시간</div>
              <div className="text-lg font-bold">
                <AnimatedNumber value={elapsedMin} decimals={1} suffix=" 분" />
              </div>
            </div>
            <div className={cardCls}>
              <div className={`uppercase tracking-wider ${secondaryText}`}>Ra (평균)</div>
              <div className="text-lg font-bold">
                <AnimatedNumber value={raUm} decimals={2} suffix=" μm" />
              </div>
            </div>
            <div className={`col-span-2 ${cardCls} flex items-center justify-between`}>
              <div>
                <div className={`uppercase tracking-wider ${secondaryText}`}>RPM / Vf</div>
                <div className="font-semibold tabular-nums">
                  {spindleRpm.toLocaleString("ko-KR")} / {feedVfMmMin.toLocaleString("ko-KR")}
                </div>
              </div>
              <motion.div
                className="w-8 h-8 rounded-full border-2 border-indigo-400 flex items-center justify-center text-[9px] font-bold text-indigo-400"
                animate={playing ? { rotate: 360 } : { rotate: 0 }}
                transition={{ duration: 1.2 / speed, ease: "linear", repeat: playing ? Infinity : 0 }}
              >SPIN</motion.div>
            </div>
          </div>
        </div>

        {/* Timeline + controls */}
        <div className="mt-3">
          <input
            type="range" min={0} max={1000} value={Math.round(progress * 1000)}
            onChange={handleScrub} className="w-full accent-indigo-500"
            aria-label="타임라인 스크럽"
          />
          <div className="flex items-center justify-between mt-1">
            <span className={`text-[11px] font-semibold ${phaseMeta.textCls}`}>{phaseMeta.label}</span>
            <span className={`text-[11px] tabular-nums ${secondaryText}`}>
              {(progress * durationSec).toFixed(1)}s / {durationSec}s
            </span>
          </div>
          <div className={`mt-1 h-1 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-200"}`}>
            <motion.div
              className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400"
              animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.05 }}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={handlePlayPause} className={`px-3 py-1 rounded-md text-xs font-semibold ${btnCls}`}>
            {playing ? "⏸ Pause" : progress >= 1 ? "↻ Replay" : "▶ Play"}
          </button>
          <button type="button" onClick={handleReset} className={`px-3 py-1 rounded-md text-xs font-semibold ${btnCls}`}>
            ⟲ Reset
          </button>
          <div className={`ml-auto text-[10px] ${secondaryText}`}>
            {safeParts} 파트 · 사이클 {totalCycleMin.toFixed(1)}분 · 수명 {toolLifeMin.toFixed(0)}분
          </div>
        </div>
      </div>
    </HolographicFrame>
  )
}

export default TimeLapseSim
