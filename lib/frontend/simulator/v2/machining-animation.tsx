// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — STEP 6-3: 가공 시뮬레이션 애니메이션
// 기존 cutting-action.tsx는 정적 SVG. 본 컴포넌트는 framer-motion을 활용해
// 공구 회전 + Feed 이동 + 칩 비산을 실시간으로 시각화한다.
"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Pause, Play, RotateCcw, Clock, Gauge, Timer } from "lucide-react"

// ─────────────────────────────────────────────
// 상수 (하드코딩 대신 이 파일 로컬 SSOT — 외부 config 필요 시 이후 분리)
// ─────────────────────────────────────────────
const SVG_W = 400
const SVG_H = 300

const SPEED_STEPS = [1, 10, 100, 1000] as const
type SpeedMultiplier = (typeof SPEED_STEPS)[number]

// 화면 좌표계 기준 — 블록 레이아웃
const BLOCK = {
  x: 70,
  y: 180,
  w: 260,
  h: 85,
} as const

// 공구 기본 pixel scale (D = 20mm 기준 80px → scale 4)
const TOOL_BASE_SCALE = 4 // px / mm
const MAX_TOOL_DIA_PX = 96

// Feed 이동: Vf[mm/min] → px/sec 로 변환 시 상수
// Feed 실제: Vf mm/min = Vf/60 mm/s → Vf/60 * TOOL_BASE_SCALE px/s
// 공작물 폭(BLOCK.w px = 260px) 에 대응되는 실제 mm 는 가변적이므로 SCALE 재계산.
// 여기서는 "블록 폭 = 공작물 길이 L_sim_mm" 으로 정의.
const SIM_WORKPIECE_LENGTH_MM = 80 // 80mm 를 260px 에 매핑
const FEED_PX_PER_MM = BLOCK.w / SIM_WORKPIECE_LENGTH_MM

// 칩 수명 (ms, 1x 기준) — 빠른 배속일수록 더 짧음
const CHIP_LIFETIME_MS = 900

// 생성 간격 (ms, 1x 기준) — RPM 에 비례하여 줄어듦
const CHIP_SPAWN_MIN_MS = 40
const CHIP_SPAWN_MAX_MS = 280

// 1분 시뮬 완료 판정
const SIM_DURATION_MIN = 1

export interface MachiningAnimationProps {
  D: number          // mm
  LOC: number        // mm
  ap: number         // mm
  ae: number         // mm
  Vf: number         // mm/min  (feed rate)
  n: number          // rpm     (spindle)
  MRR: number        // cm³/min
  shape: "square" | "ball" | "radius" | "chamfer"
  toolPath?: string
  educationMode?: boolean
  className?: string
}

interface Chip {
  id: number
  x: number        // spawn x (svg)
  y: number        // spawn y (svg)
  vx: number       // initial px/sec (at 1x)
  vy: number       // initial px/sec (at 1x, negative = up)
  spin: number     // deg / sec (at 1x)
  bornAt: number   // ms
  hue: number      // chip color variance
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function formatMMSS(ms: number): string {
  const sec = Math.floor(ms / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(1, "0")}:${s.toString().padStart(2, "0")}`
}

export function MachiningAnimation({
  D,
  LOC,
  ap,
  ae,
  Vf,
  n,
  MRR,
  shape,
  toolPath,
  educationMode = false,
  className,
}: MachiningAnimationProps) {
  // ─── 상태 ──────────────────────────────
  const [speed, setSpeed] = useState<SpeedMultiplier>(1)
  const [playing, setPlaying] = useState(true)
  // 시뮬 시간 (ms, 실제 경과 × speed 누산). 1분 = 60000ms 에 도달하면 완료.
  const [simElapsedMs, setSimElapsedMs] = useState(0)
  // tool X 위치 (svg px). 블록 좌측 밖에서 시작.
  const [toolX, setToolX] = useState<number>(BLOCK.x - 24)
  // 누적 회전각 (deg)
  const [spinDeg, setSpinDeg] = useState(0)
  // 칩 목록
  const [chips, setChips] = useState<Chip[]>([])

  // ─── 기하 스케일 (공구 크기) ────────────
  const dPx = useMemo(() => clamp(D * TOOL_BASE_SCALE, 20, MAX_TOOL_DIA_PX), [D])
  const shankPx = dPx * 0.62
  const scaleMmToPx = dPx / Math.max(0.5, D)           // 절삭부 세로 스케일
  const locPx = clamp(LOC * scaleMmToPx, 18, 90)
  const apPx = clamp(ap * scaleMmToPx, 2, locPx)
  const aePx = clamp(ae * scaleMmToPx, 2, dPx)

  // 공구 y: 블록 상단에서 ap 만큼 박혀있도록
  const toolTipY = BLOCK.y + apPx
  const toolTopY = 30
  const shankBottomY = toolTipY - locPx
  const holderY = toolTopY - 4

  // Feed 방향 이동 (우측). 블록 우측을 지나면 자동 랩.
  const feedStartX = BLOCK.x - 24
  const feedEndX = BLOCK.x + BLOCK.w + 24

  // ─── 애니메이션 타이밍 ──────────────────
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)
  const chipSpawnAccumRef = useRef<number>(0)
  const chipIdRef = useRef<number>(0)

  // 1분 가공 완료 여부
  const completed = simElapsedMs >= SIM_DURATION_MIN * 60_000

  // 초당 회전수 (rps). speed 반영.
  const rpsEffective = useMemo(() => (n / 60) * speed, [n, speed])
  // 초당 mm/s (feed) 반영.
  const mmPerSecEffective = useMemo(() => (Vf / 60) * speed, [Vf, speed])
  // 초당 px/s (feed on SVG).
  const feedPxPerSecEffective = useMemo(
    () => mmPerSecEffective * FEED_PX_PER_MM,
    [mmPerSecEffective],
  )

  // 칩 생성 간격: rpm 이 높을수록 빈번. speed 가 높아도 유지(시뮬 압축).
  const chipSpawnIntervalMs = useMemo(() => {
    // n(rpm) 200..20000 → interval 280..40 로 선형
    const raw = CHIP_SPAWN_MAX_MS - (CHIP_SPAWN_MAX_MS - CHIP_SPAWN_MIN_MS) * (clamp(n, 200, 20000) - 200) / (20000 - 200)
    // speed 를 반영: 빠를수록 짧게
    return clamp(raw / speed, 4, CHIP_SPAWN_MAX_MS)
  }, [n, speed])

  // ─── RAF 루프 ──────────────────────────
  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const realDt = ts - lastTsRef.current // ms (실제)
      lastTsRef.current = ts
      const simDt = realDt * speed // ms (시뮬)

      // 완료 판정 — 1분 이상이면 정지
      setSimElapsedMs(prev => {
        const next = prev + simDt
        if (next >= SIM_DURATION_MIN * 60_000) {
          setPlaying(false)
          return SIM_DURATION_MIN * 60_000
        }
        return next
      })

      // 회전 각도 누적 (연속): spin += rps * 360 * realDt/1000
      setSpinDeg(prev => (prev + rpsEffective * 360 * (realDt / 1000)) % 360)

      // Feed 이동: x += feedPxPerSec * realDt/1000
      setToolX(prev => {
        const dx = feedPxPerSecEffective * (realDt / 1000)
        let nextX = prev + dx
        if (nextX > feedEndX) {
          // 랩어라운드 (반복 절삭 시각화)
          nextX = feedStartX + (nextX - feedEndX)
        }
        return nextX
      })

      // 칩 스폰 — 실제 시간(real) 기반
      chipSpawnAccumRef.current += realDt
      while (chipSpawnAccumRef.current >= chipSpawnIntervalMs) {
        chipSpawnAccumRef.current -= chipSpawnIntervalMs
        // 현재 tool X, y 기준으로 칩 생성
        const curToolX = (() => {
          // prev state 가 아닌 최신을 참조하기 위해 함수형 setState 대신 ref 저장이 이상적이나,
          // 한 번 setState 람다 재사용으로 최근 toolX 를 가져옴
          return null as number | null
        })()
        void curToolX
        chipIdRef.current += 1
        const newChip: Chip = {
          id: chipIdRef.current,
          x: 0, // 아래에서 setChips 내부에서 toolX 기준으로 세팅
          y: BLOCK.y + 2 + Math.random() * (apPx * 0.4),
          vx: (Math.random() * 2 - 1) * 40 - 20, // -60 ~ +20 px/s (대부분 후방)
          vy: -(60 + Math.random() * 90),        // 위로 튐 (-60 ~ -150)
          spin: (Math.random() * 2 - 1) * 720,
          bornAt: ts,
          hue: 35 + Math.random() * 25,          // amber/gold
        }
        setChips(prev => {
          // toolX 최신값을 반영하기 위해 prev 처리 시 toolX 참조 대신 현재 값 캡처
          return [...prev, newChip]
        })
      }

      // 칩 수명 정리
      setChips(prev => prev.filter(c => ts - c.bornAt < (CHIP_LIFETIME_MS / Math.max(0.5, speed / 4 + 0.5))))

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastTsRef.current = null
    }
  }, [playing, speed, rpsEffective, feedPxPerSecEffective, chipSpawnIntervalMs, apPx, feedEndX, feedStartX])

  // 새로 스폰된 칩에 현재 toolX 를 반영 (effect 분리)
  useEffect(() => {
    setChips(prev =>
      prev.map(c => (c.x === 0 ? { ...c, x: toolX + (Math.random() * dPx - dPx / 2) } : c)),
    )
    // 의도적으로 toolX 에는 react 하지 않음 — 최초 한 번만 x=0 인 칩에 위치 주입
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips.length])

  // ─── 리셋 ──────────────────────────────
  const handleReset = useCallback(() => {
    setSimElapsedMs(0)
    setToolX(feedStartX)
    setSpinDeg(0)
    setChips([])
    chipSpawnAccumRef.current = 0
    lastTsRef.current = null
    setPlaying(true)
  }, [feedStartX])

  const handleToggleSpeed = useCallback(() => {
    setSpeed(prev => {
      const idx = SPEED_STEPS.indexOf(prev)
      const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length]
      return next
    })
  }, [])

  // 진행률 0..1
  const progress = clamp(simElapsedMs / (SIM_DURATION_MIN * 60_000), 0, 1)
  // 누적 MRR → 가공량 (cm³): MRR [cm³/min] * 분
  const cumulativeMinutes = simElapsedMs / 60_000
  const cumulativeVolumeCm3 = MRR * cumulativeMinutes

  // 현재 tool SVG centerX (회전축)
  const toolCenterX = toolX
  const shankBodyH = Math.max(12, shankBottomY - holderY - 8)

  // ─── 공구 팁 형상 path ──────────────────
  const tipPath = useMemo(() => {
    const half = dPx / 2
    if (shape === "ball") {
      return `M ${-half} 0 A ${half} ${half} 0 0 0 ${half} 0 Z`
    }
    if (shape === "chamfer") {
      const tipH = Math.min(half * 0.6, 10)
      return `M ${-half} ${-tipH} L 0 0 L ${half} ${-tipH} Z`
    }
    if (shape === "radius") {
      const r = Math.min(4, half * 0.3)
      return `M ${-half} 0 Q ${-half} ${r} ${-half + r} ${r} L ${half - r} ${r} Q ${half} ${r} ${half} 0 Z`
    }
    // square — flat bottom
    return `M ${-half} 0 L ${half} 0 L ${half} -2 L ${-half} -2 Z`
  }, [shape, dPx])

  // ─── 색상 · 라벨 ────────────────────────
  const toolPathLabel = toolPath ?? "—"
  const speedBadgeColor: Record<SpeedMultiplier, string> = {
    1: "bg-slate-600 text-white",
    10: "bg-blue-600 text-white",
    100: "bg-amber-600 text-white",
    1000: "bg-rose-600 text-white",
  }

  const rpsDisplay = (n / 60).toFixed(1)
  const mmPerSecDisplay = (Vf / 60).toFixed(1)

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden ${className ?? ""}`}
      role="region"
      aria-label="Machining simulation animation"
    >
      {/* 헤더 (컨트롤 바) */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-white">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            <Gauge className="w-3.5 h-3.5" />
            가공 시뮬레이터
          </div>
          <span className="text-[10px] text-slate-400 font-mono">{toolPathLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* 속도 배지 */}
          <button
            type="button"
            onClick={handleToggleSpeed}
            className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded-md transition ${speedBadgeColor[speed]} hover:brightness-110`}
            aria-label={`시뮬레이션 속도: ${speed}배속. 클릭하여 다음 단계로`}
            title="속도 전환 (1× / 10× / 100× / 1000×)"
          >
            {speed}×
          </button>
          {/* play/pause */}
          <button
            type="button"
            onClick={() => setPlaying(p => !p)}
            disabled={completed}
            className="p-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={playing ? "일시정지" : "재생"}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          {/* reset */}
          <button
            type="button"
            onClick={handleReset}
            className="p-1 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
            aria-label="처음부터 다시 시작"
            title="리셋"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="h-1 w-full bg-gray-100">
        <div
          className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 transition-all"
          style={{ width: `${(progress * 100).toFixed(1)}%` }}
        />
      </div>

      {/* SVG 스테이지 */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-auto"
          role="img"
          aria-label="Live machining animation"
        >
          {/* defs */}
          <defs>
            <pattern id="machHatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(-35)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="#9ca3af" strokeWidth="0.6" opacity="0.55" />
            </pattern>
            <linearGradient id="blockGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f3f4f6" />
              <stop offset="100%" stopColor="#d1d5db" />
            </linearGradient>
            <linearGradient id="toolGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e5e7eb" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
            <linearGradient id="shankGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
            <marker id="machFeedArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="#2563eb" />
            </marker>
          </defs>

          {/* 베드 */}
          <rect x={0} y={BLOCK.y + BLOCK.h} width={SVG_W} height={SVG_H - (BLOCK.y + BLOCK.h)} fill="#f9fafb" />
          <line x1={0} y1={BLOCK.y + BLOCK.h} x2={SVG_W} y2={BLOCK.y + BLOCK.h} stroke="#d1d5db" strokeWidth={0.8} />

          {/* 공작물 블록 */}
          <rect
            x={BLOCK.x}
            y={BLOCK.y}
            width={BLOCK.w}
            height={BLOCK.h}
            fill="url(#blockGrad)"
            stroke="#6b7280"
            strokeWidth={1}
          />
          <rect
            x={BLOCK.x}
            y={BLOCK.y}
            width={BLOCK.w}
            height={BLOCK.h}
            fill="url(#machHatch)"
            opacity={0.45}
          />
          {/* 블록 라벨 */}
          <text x={BLOCK.x + 4} y={BLOCK.y + BLOCK.h - 4} fontSize={8} fill="#6b7280">
            Workpiece {SIM_WORKPIECE_LENGTH_MM}mm
          </text>

          {/* 잘려나간 자국 (tool 뒤쪽에 남는 슬롯) */}
          <rect
            x={BLOCK.x}
            y={BLOCK.y}
            width={clamp(toolCenterX - BLOCK.x, 0, BLOCK.w)}
            height={apPx}
            fill="#9ca3af"
            opacity={0.55}
          />
          <rect
            x={BLOCK.x}
            y={BLOCK.y}
            width={clamp(toolCenterX - BLOCK.x, 0, BLOCK.w)}
            height={apPx}
            fill="url(#machHatch)"
            opacity={0.2}
          />

          {/* 공구 홀더 (화면 폭에 걸쳐) */}
          <rect x={0} y={holderY} width={SVG_W} height={10} fill="#475569" />
          <rect x={0} y={holderY + 10} width={SVG_W} height={3} fill="#334155" />

          {/* 공구 그룹 (feed 이동 + 스핀 회전) */}
          <g transform={`translate(${toolCenterX}, 0)`}>
            {/* 섕크 */}
            <rect
              x={-shankPx / 2}
              y={holderY + 13}
              width={shankPx}
              height={shankBodyH}
              fill="url(#shankGrad)"
              stroke="#475569"
              strokeWidth={0.6}
            />
            {/* LOC (회전 애니메이션 적용) */}
            <g transform={`translate(0, ${shankBottomY}) rotate(${spinDeg})`}>
              {/* LOC body */}
              <rect
                x={-dPx / 2}
                y={0}
                width={dPx}
                height={locPx}
                fill="url(#toolGrad)"
                stroke="#334155"
                strokeWidth={0.7}
              />
              {/* Flute 나선 — 4조 기준 */}
              {[0, 1, 2, 3].map(i => {
                const angleDeg = i * 90
                return (
                  <path
                    key={i}
                    d={`M ${-dPx / 2 + (i * dPx) / 4} 2 L ${-dPx / 2 + (i * dPx) / 4 - 5} ${locPx - 2}`}
                    stroke="#0f172a"
                    strokeWidth={0.6}
                    fill="none"
                    opacity={0.55}
                    transform={`rotate(${angleDeg * 0.12})`}
                  />
                )
              })}
              {/* 팁 — locPx 맨 아래에 부착 */}
              <g transform={`translate(0, ${locPx})`}>
                <path d={tipPath} fill="url(#toolGrad)" stroke="#334155" strokeWidth={0.7} />
              </g>
            </g>
          </g>

          {/* Engagement 녹색 하이라이트 (공구 현재 위치) */}
          <rect
            x={toolCenterX - aePx / 2}
            y={BLOCK.y}
            width={aePx}
            height={apPx}
            fill="#10b981"
            fillOpacity={0.35}
            stroke="#059669"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          {/* Feed 방향 화살표 — 블록 상단 */}
          <line
            x1={BLOCK.x + 4}
            y1={BLOCK.y - 10}
            x2={BLOCK.x + 64}
            y2={BLOCK.y - 10}
            stroke="#2563eb"
            strokeWidth={1.5}
            markerEnd="url(#machFeedArrow)"
          />
          <text x={BLOCK.x + 68} y={BLOCK.y - 6} fontSize={9} fill="#2563eb" fontWeight="bold">
            Feed {mmPerSecDisplay} mm/s
          </text>

          {/* 치수 라벨 */}
          <text x={BLOCK.x - 6} y={BLOCK.y + apPx / 2 + 3} textAnchor="end" fontSize={9} fill="#dc2626" fontWeight="bold">
            ap={ap.toFixed(1)}
          </text>
          <text x={toolCenterX} y={BLOCK.y + BLOCK.h + 18} textAnchor="middle" fontSize={9} fill="#dc2626" fontWeight="bold">
            ae={ae.toFixed(1)}mm
          </text>
          <text x={SVG_W - 6} y={shankBottomY + locPx / 2} textAnchor="end" fontSize={8} fill="#6b7280">
            ⌀{D.toFixed(1)}
          </text>

          {/* RPM 배지 — 공구 상단 */}
          <g transform={`translate(${toolCenterX}, ${holderY - 4})`}>
            <text textAnchor="middle" fontSize={10} fill="#1e40af" fontWeight="bold">
              ↻ {Math.round(n).toLocaleString()} rpm
            </text>
          </g>

          {/* 칩 (AnimatePresence 로 생성/사라짐) */}
          <AnimatePresence>
            {chips.map(chip => {
              // 칩 진행률 (0..1)
              const now = performance.now()
              const age = now - chip.bornAt
              const lifetime = CHIP_LIFETIME_MS / Math.max(0.5, speed / 4 + 0.5)
              const t = clamp(age / lifetime, 0, 1)
              // 중력: vy increases downward over time
              const g = 280
              const dxEff = (chip.vx * t) * (age / 1000)
              const dyEff = (chip.vy * t + 0.5 * g * (t * t)) * (age / 1000)
              const cx = chip.x + dxEff
              const cy = chip.y + dyEff
              const rot = chip.spin * (age / 1000)
              return (
                <motion.g
                  key={chip.id}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1 - t * 0.7, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.12 }}
                >
                  <path
                    d="M 0 0 q 3 -4 -1 -8 q 4 2 5 7 z"
                    transform={`translate(${cx}, ${cy}) rotate(${rot}) scale(${0.6 + t * 0.4})`}
                    fill={`hsl(${chip.hue}, 85%, 55%)`}
                    stroke={`hsl(${chip.hue - 10}, 70%, 35%)`}
                    strokeWidth={0.5}
                  />
                </motion.g>
              )
            })}
          </AnimatePresence>

          {/* 완료 오버레이 */}
          {completed && (
            <g>
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#000" opacity={0.55} />
              <g transform={`translate(${SVG_W / 2}, ${SVG_H / 2 - 18})`}>
                <circle r={26} fill="#10b981" />
                <g transform="translate(-10, -10)">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </g>
              </g>
              <text x={SVG_W / 2} y={SVG_H / 2 + 22} textAnchor="middle" fontSize={14} fill="#f9fafb" fontWeight="bold">
                1분 가공 완료
              </text>
              <text x={SVG_W / 2} y={SVG_H / 2 + 42} textAnchor="middle" fontSize={12} fill="#d1fae5">
                가공량 {cumulativeVolumeCm3.toFixed(1)} cm³ · MRR {MRR.toFixed(1)} cm³/min
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* 하단 상태 바 */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] bg-slate-50 border-t border-gray-100">
        <div className="flex items-center gap-1.5 text-slate-600">
          <Timer className="w-3.5 h-3.5 text-slate-500" />
          <span className="font-mono">{formatMMSS(simElapsedMs)}</span>
          <span className="text-slate-400">/ 01:00</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-slate-700">
          <span>
            <span className="text-slate-400">MRR</span> {MRR.toFixed(1)}
            <span className="text-slate-400"> cm³/min</span>
          </span>
          <span>
            <span className="text-slate-400">Vol</span> {cumulativeVolumeCm3.toFixed(2)}
            <span className="text-slate-400"> cm³</span>
          </span>
        </div>
      </div>

      {/* 교육 모드 — 물리 해설 */}
      {educationMode && (
        <div className="border-t border-blue-100 bg-blue-50/70 px-3 py-2 text-[11px] text-blue-900 space-y-1 leading-relaxed">
          <div className="flex items-start gap-1.5">
            <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-700" />
            <span>
              지금 공구가 <b>초당 {rpsDisplay} 바퀴</b> 돌면서{" "}
              <b>{mmPerSecDisplay} mm/s</b> 전진 중입니다 (표시 배속 {speed}×).
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <Gauge className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-700" />
            <span>
              이 속도라면 <b>1분당 {MRR.toFixed(1)} cm³</b> 제거 —
              작은 각설탕 ≈ 3 cm³ 이므로 분당 각설탕 {(MRR / 3).toFixed(1)}개 분량.
            </span>
          </div>
          <div className="text-blue-700/80">
            칩 색상은 열 발생량을 암시합니다 — 실제 현장 관찰과 매칭하여 열 관리 상태를 추정하세요.
          </div>
        </div>
      )}
    </div>
  )
}

export default MachiningAnimation
