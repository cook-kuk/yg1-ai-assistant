// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 아날로그 게이지 계기판 (RPM / Vf / Pc / Tool Life + Chatter)
// - 자동차 계기판 스타일, SVG + framer-motion spring 애니메이션
// - 100% 클라이언트 사이드, cutting-simulator-v2.tsx 에 손대지 않음
// - darkMode 완전 지원, 반응형 (grid-cols-2 md:grid-cols-4)
"use client"

import { useMemo, useId } from "react"
import { motion, useReducedMotion } from "framer-motion"

// ─────────────────────────────────────────────────────────────────────
// 상수 (로컬 SSOT — 눈금/각도/임계치)
// ─────────────────────────────────────────────────────────────────────

const VIEW = 200
const CX = VIEW / 2
const CY = VIEW / 2

// 바늘 회전 각도 (0% → -135°, 100% → +135°)
const ANGLE_MIN = -135
const ANGLE_MAX = 135
const ANGLE_SPAN = ANGLE_MAX - ANGLE_MIN

// 위험 임계치 (백분율)
const DANGER_PCT = 90
const WARN_PCT = 60
const PC_CAUTION_PCT = 85

// 눈금
const TICK_COUNT = 30              // 총 눈금 수
const TICK_MAJOR_EVERY = 3         // 3번째마다 주눈금
const TICK_OUTER_R = 90
const TICK_MAJOR_LEN = 12
const TICK_MINOR_LEN = 6

// 바깥 테두리
const BEZEL_OUTER_R = 96
const BEZEL_INNER_R = 82
const ARC_RADIUS = 78              // 위험영역 arc 반지름

// 바늘
const NEEDLE_TIP_Y = -72           // cy 기준 위쪽 (음수)
const NEEDLE_BACK_Y = 14

// 애니메이션
const SPRING = { type: "spring" as const, stiffness: 80, damping: 12, mass: 0.8 }
const SWEEP_DURATION = 0.5

// 서브 인디케이터 bar
const SUB_BAR_H = 6

// ─────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────

export interface AnalogGaugesProps {
  rpm: number
  rpmMax: number
  Vf: number
  VfMax: number
  Pc: number
  PcMax: number
  /** 0~100 (남은 공구 수명 %) */
  toolLifePct: number
  /** 0~100 (Chatter 위험도 %) */
  chatterRisk: number
  darkMode?: boolean
}

// ─────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function pctOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return clamp((value / max) * 100, 0, 100)
}

function angleFromPct(pct: number): number {
  const p = clamp(pct, 0, 100) / 100
  return ANGLE_MIN + p * ANGLE_SPAN
}

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  // 0° = 위쪽(-Y), 양수 = 시계방향
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg)
  const [x2, y2] = polar(cx, cy, r, endDeg)
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg > startDeg ? 1 : 0
  return `M ${x1.toFixed(3)} ${y1.toFixed(3)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(3)} ${y2.toFixed(3)}`
}

function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return Math.round(n).toLocaleString()
}

function fmt2(n: number): string {
  if (!Number.isFinite(n)) return "—"
  return n.toFixed(2)
}

// ─────────────────────────────────────────────────────────────────────
// 테마 팔레트 (per-gauge)
// ─────────────────────────────────────────────────────────────────────

type Theme = "rpm" | "vf" | "pc" | "life"

interface Palette {
  needleFrom: string
  needleTo: string
  accent: string
  glow: string
  textCenter: string
  textLabel: string
  textUnit: string
  bezelFrom: string
  bezelTo: string
  bezelStroke: string
  faceFrom: string
  faceTo: string
  tickMinor: string
  tickMajor: string
  tickLit: string
  dangerArc: string
  warnArc: string
  safeArc: string
  subBarBg: string
  subBarFill: string
  glowFilterColor: string
}

function palette(theme: Theme, darkMode: boolean): Palette {
  // 게이지 페이스 (중심 바닥)
  const faceFrom = darkMode ? "#0a0e1a" : "#f8fafc"
  const faceTo = darkMode ? "#020617" : "#e2e8f0"
  const bezelFrom = darkMode ? "#64748b" : "#94a3b8"
  const bezelTo = darkMode ? "#1e293b" : "#64748b"
  const bezelStroke = darkMode ? "#334155" : "#cbd5e1"
  const tickMinor = darkMode ? "#475569" : "#94a3b8"
  const tickMajor = darkMode ? "#cbd5e1" : "#334155"
  const subBarBg = darkMode ? "#1e293b" : "#e2e8f0"

  switch (theme) {
    case "rpm":
      return {
        needleFrom: "#ffffff",
        needleTo: "#38bdf8",
        accent: darkMode ? "#38bdf8" : "#0284c7",
        glow: darkMode ? "#0ea5e9" : "#0284c7",
        textCenter: darkMode ? "text-sky-200" : "text-sky-800",
        textLabel: darkMode ? "text-sky-400" : "text-sky-700",
        textUnit: darkMode ? "text-slate-400" : "text-slate-500",
        bezelFrom, bezelTo, bezelStroke, faceFrom, faceTo, tickMinor, tickMajor,
        tickLit: darkMode ? "#7dd3fc" : "#0284c7",
        dangerArc: "#ef4444",
        warnArc: "#f59e0b",
        safeArc: darkMode ? "#0ea5e9" : "#0284c7",
        subBarBg,
        subBarFill: darkMode ? "#38bdf8" : "#0284c7",
        glowFilterColor: "#0ea5e9",
      }
    case "vf":
      return {
        needleFrom: "#ffffff",
        needleTo: "#34d399",
        accent: darkMode ? "#34d399" : "#059669",
        glow: darkMode ? "#10b981" : "#059669",
        textCenter: darkMode ? "text-emerald-200" : "text-emerald-800",
        textLabel: darkMode ? "text-emerald-400" : "text-emerald-700",
        textUnit: darkMode ? "text-slate-400" : "text-slate-500",
        bezelFrom, bezelTo, bezelStroke, faceFrom, faceTo, tickMinor, tickMajor,
        tickLit: darkMode ? "#6ee7b7" : "#059669",
        dangerArc: "#ef4444",
        warnArc: "#f59e0b",
        safeArc: darkMode ? "#10b981" : "#059669",
        subBarBg,
        subBarFill: darkMode ? "#34d399" : "#059669",
        glowFilterColor: "#10b981",
      }
    case "pc":
      return {
        needleFrom: "#ffffff",
        needleTo: "#fb923c",
        accent: darkMode ? "#fb923c" : "#ea580c",
        glow: darkMode ? "#f97316" : "#ea580c",
        textCenter: darkMode ? "text-orange-200" : "text-orange-800",
        textLabel: darkMode ? "text-orange-400" : "text-orange-700",
        textUnit: darkMode ? "text-slate-400" : "text-slate-500",
        bezelFrom, bezelTo, bezelStroke, faceFrom, faceTo, tickMinor, tickMajor,
        tickLit: darkMode ? "#fdba74" : "#ea580c",
        dangerArc: "#ef4444",
        warnArc: "#f59e0b",
        safeArc: darkMode ? "#22c55e" : "#16a34a",
        subBarBg,
        subBarFill: darkMode ? "#fb923c" : "#ea580c",
        glowFilterColor: "#f97316",
      }
    case "life":
      return {
        needleFrom: "#ffffff",
        needleTo: "#a78bfa",
        accent: darkMode ? "#a78bfa" : "#7c3aed",
        glow: darkMode ? "#8b5cf6" : "#7c3aed",
        textCenter: darkMode ? "text-violet-200" : "text-violet-800",
        textLabel: darkMode ? "text-violet-400" : "text-violet-700",
        textUnit: darkMode ? "text-slate-400" : "text-slate-500",
        bezelFrom, bezelTo, bezelStroke, faceFrom, faceTo, tickMinor, tickMajor,
        tickLit: darkMode ? "#c4b5fd" : "#7c3aed",
        dangerArc: "#ef4444",
        warnArc: "#f59e0b",
        safeArc: darkMode ? "#22c55e" : "#16a34a",
        subBarBg,
        subBarFill: darkMode ? "#a78bfa" : "#7c3aed",
        glowFilterColor: "#8b5cf6",
      }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 게이지 하위 컴포넌트
// ─────────────────────────────────────────────────────────────────────

interface GaugeProps {
  theme: Theme
  label: string
  unit: string
  value: number
  max: number
  /** 중앙에 크게 표시할 텍스트 */
  display: string
  /** 위험(빨강) 임계치, 0~100 */
  dangerPct?: number
  /** 경고(노랑) 임계치, 0~100 */
  warnPct?: number
  /** Pc처럼 3-band(녹/노/빨) 배경 원호를 쓸지 */
  threeBand?: boolean
  /** Tool Life 처럼 "낮을수록 위험"인 경우 반전 */
  invert?: boolean
  darkMode: boolean
}

function Gauge({
  theme,
  label,
  unit,
  value,
  max,
  display,
  dangerPct = DANGER_PCT,
  warnPct = WARN_PCT,
  threeBand = false,
  invert = false,
  darkMode,
}: GaugeProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const pal = palette(theme, darkMode)
  const reduce = useReducedMotion()

  const pct = pctOf(value, max)
  // "invert" : toolLifePct는 0%면 위험, 100%면 안전 → 시각 비율은 pct 그대로 쓰되 위험 판정 반전
  const dangerOn = invert ? pct <= 100 - dangerPct : pct >= dangerPct
  const warnOn = invert ? pct <= 100 - warnPct : pct >= warnPct

  const angle = angleFromPct(pct)

  const ticks = useMemo(() => {
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean; lit: boolean }[] = []
    for (let i = 0; i <= TICK_COUNT; i++) {
      const tPct = (i / TICK_COUNT) * 100
      const a = angleFromPct(tPct)
      const major = i % TICK_MAJOR_EVERY === 0
      const len = major ? TICK_MAJOR_LEN : TICK_MINOR_LEN
      const [x1, y1] = polar(CX, CY, TICK_OUTER_R, a)
      const [x2, y2] = polar(CX, CY, TICK_OUTER_R - len, a)
      const lit = tPct <= pct
      out.push({ x1, y1, x2, y2, major, lit })
    }
    return out
  }, [pct])

  // 배경 arc들
  const fullArc = arcPath(CX, CY, ARC_RADIUS, ANGLE_MIN, ANGLE_MAX)
  const dangerArcPath = arcPath(
    CX, CY, ARC_RADIUS,
    angleFromPct(dangerPct), ANGLE_MAX,
  )
  const warnArcPath = threeBand
    ? arcPath(CX, CY, ARC_RADIUS, angleFromPct(warnPct), angleFromPct(dangerPct))
    : null

  // glow/위험 배경
  const bgGlow = dangerOn ? pal.dangerArc : warnOn ? pal.warnArc : null

  // 바늘 shake (위험 구간 진입 시)
  const needleAnimate = dangerOn && !reduce
    ? { rotate: [angle - 2, angle + 2, angle - 1.5, angle + 1.5, angle] }
    : { rotate: angle }
  const needleTransition = dangerOn && !reduce
    ? { duration: 0.35, repeat: Infinity, repeatType: "loop" as const, ease: "easeInOut" as const }
    : SPRING

  return (
    <div
      className={[
        "relative flex flex-col items-center rounded-2xl border p-3 transition-all",
        darkMode
          ? "border-slate-700 bg-slate-900/70"
          : "border-slate-200 bg-white/80",
        dangerOn
          ? darkMode
            ? "shadow-[0_0_24px_rgba(239,68,68,0.45)]"
            : "shadow-[0_0_20px_rgba(239,68,68,0.35)]"
          : warnOn
          ? darkMode
            ? "shadow-[0_0_18px_rgba(245,158,11,0.35)]"
            : "shadow-[0_0_14px_rgba(245,158,11,0.30)]"
          : darkMode
          ? "shadow-[0_0_12px_rgba(56,189,248,0.10)]"
          : "shadow-sm",
      ].join(" ")}
      role="meter"
      aria-label={`${label} ${display}`}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamp(value, 0, max)}
    >
      {/* 라벨 (상단) */}
      <div className="mb-1 flex w-full items-center justify-between px-1">
        <span className={["text-[11px] font-semibold uppercase tracking-wider", pal.textLabel].join(" ")}>
          {label}
        </span>
        <span className={["text-[10px] font-medium tabular-nums", pal.textUnit].join(" ")}>
          max {fmtInt(max)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="h-full w-full"
        style={{ maxHeight: 220 }}
        role="img"
        aria-hidden="true"
      >
        <defs>
          {/* 금속 베젤 */}
          <linearGradient id={`bezel-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={pal.bezelFrom} />
            <stop offset="100%" stopColor={pal.bezelTo} />
          </linearGradient>
          {/* 페이스 (어두운 중앙) */}
          <radialGradient id={`face-${uid}`} cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor={pal.faceFrom} />
            <stop offset="100%" stopColor={pal.faceTo} />
          </radialGradient>
          {/* 바늘 그라디언트 */}
          <linearGradient id={`needle-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={pal.needleTo} />
            <stop offset="60%" stopColor={pal.needleFrom} />
            <stop offset="100%" stopColor={darkMode ? "#1e293b" : "#475569"} />
          </linearGradient>
          {/* drop-shadow for needle */}
          <filter id={`needleShadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx="0"
              dy="1.5"
              stdDeviation="2"
              floodColor={dangerOn ? pal.dangerArc : pal.glow}
              floodOpacity={dangerOn ? 0.7 : 0.45}
            />
          </filter>
          {/* glow for danger arc */}
          {bgGlow && (
            <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* 외곽 베젤 (금속 링) */}
        <circle
          cx={CX}
          cy={CY}
          r={BEZEL_OUTER_R}
          fill={`url(#bezel-${uid})`}
          stroke={pal.bezelStroke}
          strokeWidth={1}
        />
        {/* 내부 페이스 */}
        <circle
          cx={CX}
          cy={CY}
          r={BEZEL_INNER_R}
          fill={`url(#face-${uid})`}
        />

        {/* 위험 구간 arc (배경) — 3-band 또는 단일 danger arc */}
        {threeBand && warnArcPath && (
          <path
            d={warnArcPath}
            stroke={pal.warnArc}
            strokeWidth={5}
            strokeLinecap="round"
            fill="none"
            opacity={0.55}
          />
        )}
        <path
          d={dangerArcPath}
          stroke={pal.dangerArc}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          opacity={dangerOn ? 0.9 : 0.55}
          filter={dangerOn ? `url(#glow-${uid})` : undefined}
        >
          {dangerOn && !reduce && (
            <animate attributeName="opacity" values="0.55;1;0.55" dur="0.8s" repeatCount="indefinite" />
          )}
        </path>
        {/* 안전영역 미약한 힌트 arc (전체) */}
        <path
          d={fullArc}
          stroke={pal.safeArc}
          strokeWidth={1}
          strokeLinecap="round"
          fill="none"
          opacity={0.25}
        />

        {/* 눈금 */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.lit ? pal.tickLit : t.major ? pal.tickMajor : pal.tickMinor}
            strokeWidth={t.major ? 2 : 1}
            strokeLinecap="round"
            opacity={t.lit ? 1 : t.major ? 0.85 : 0.55}
          />
        ))}

        {/* 최소/최대 레이블 */}
        <text
          x={polar(CX, CY, TICK_OUTER_R - TICK_MAJOR_LEN - 10, ANGLE_MIN)[0]}
          y={polar(CX, CY, TICK_OUTER_R - TICK_MAJOR_LEN - 10, ANGLE_MIN)[1]}
          fontSize={9}
          fill={pal.tickMajor}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={0.8}
        >
          0
        </text>
        <text
          x={polar(CX, CY, TICK_OUTER_R - TICK_MAJOR_LEN - 10, ANGLE_MAX)[0]}
          y={polar(CX, CY, TICK_OUTER_R - TICK_MAJOR_LEN - 10, ANGLE_MAX)[1]}
          fontSize={9}
          fill={pal.tickMajor}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={0.8}
        >
          {fmtInt(max)}
        </text>

        {/* 바늘 — framer-motion 회전 (sweep on mount + spring on change) */}
        <motion.g
          initial={reduce ? false : { rotate: ANGLE_MIN }}
          animate={needleAnimate}
          transition={
            reduce
              ? { duration: 0 }
              : // 마운트 시 더 빠른 sweep, 업데이트 시 spring (or shake when danger)
                (dangerOn ? needleTransition : {
                  ...SPRING,
                  // initial sweep은 framer가 initial→animate로 처리
                })
          }
          style={{ originX: `${CX}px`, originY: `${CY}px`, transformBox: "fill-box" as const }}
          // transformOrigin 호환용 (transformBox 사용)
          transform-origin={`${CX} ${CY}`}
        >
          <path
            d={`M ${CX} ${CY + NEEDLE_BACK_Y}
               L ${CX - 4} ${CY}
               L ${CX - 1.2} ${CY + NEEDLE_TIP_Y}
               L ${CX + 1.2} ${CY + NEEDLE_TIP_Y}
               L ${CX + 4} ${CY}
               Z`}
            fill={`url(#needle-${uid})`}
            stroke={dangerOn ? pal.dangerArc : pal.accent}
            strokeWidth={0.6}
            filter={`url(#needleShadow-${uid})`}
          />
        </motion.g>

        {/* 중앙 허브 */}
        <circle cx={CX} cy={CY} r={9} fill={pal.bezelTo} stroke={pal.bezelStroke} strokeWidth={1} />
        <circle cx={CX} cy={CY} r={4} fill={pal.accent} />

        {/* 초기 sweep을 위한 별도 motion path (마운트 0→angle) — 위 motion.g 의 initial/animate 가 담당 */}
      </svg>

      {/* 중앙 디지털 숫자 (SVG 바깥 오버레이) */}
      <div className="-mt-14 flex flex-col items-center pointer-events-none select-none">
        <div
          className={[
            "text-2xl font-extrabold leading-none tabular-nums",
            pal.textCenter,
          ].join(" ")}
        >
          {display}
        </div>
        <div className={["mt-1 text-[10px] font-medium uppercase tracking-wider", pal.textUnit].join(" ")}>
          {unit}
        </div>
      </div>

      {/* 서브 인디케이터 bar (하단) */}
      <div className="mt-3 w-full px-2">
        <div
          className="relative w-full overflow-hidden rounded-full"
          style={{ height: SUB_BAR_H, background: pal.subBarBg }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{ background: dangerOn ? pal.dangerArc : warnOn ? pal.warnArc : pal.subBarFill }}
            initial={reduce ? false : { width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={reduce ? { duration: 0 } : { ...SPRING, duration: SWEEP_DURATION }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[9px] tabular-nums">
          <span className={pal.textUnit}>0</span>
          <span className={pal.textUnit}>{pct.toFixed(0)}%</span>
          <span className={pal.textUnit}>{fmtInt(max)}</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────

export default function AnalogGauges({
  rpm,
  rpmMax,
  Vf,
  VfMax,
  Pc,
  PcMax,
  toolLifePct,
  chatterRisk,
  darkMode = false,
}: AnalogGaugesProps) {
  return (
    <div
      className={[
        "w-full rounded-2xl border p-3 md:p-4 transition-colors",
        darkMode
          ? "border-slate-800 bg-[#0a0e1a]"
          : "border-slate-200 bg-slate-50",
      ].join(" ")}
      data-component="analog-gauges"
    >
      {/* 헤더 */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className={[
              "inline-block h-2 w-2 animate-pulse rounded-full",
              darkMode ? "bg-emerald-400" : "bg-emerald-600",
            ].join(" ")}
            aria-hidden="true"
          />
          <span
            className={[
              "text-xs font-bold uppercase tracking-wider",
              darkMode ? "text-slate-300" : "text-slate-700",
            ].join(" ")}
          >
            Machine Dashboard
          </span>
        </div>
        <span className={["text-[10px] font-mono", darkMode ? "text-slate-500" : "text-slate-400"].join(" ")}>
          LIVE
        </span>
      </div>

      {/* 4열 그리드: mobile 2x2 → md 1x4 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Gauge
          theme="rpm"
          label="RPM"
          unit="spindle"
          value={rpm}
          max={rpmMax}
          display={fmtInt(rpm)}
          dangerPct={DANGER_PCT}
          warnPct={WARN_PCT}
          darkMode={darkMode}
        />
        <Gauge
          theme="vf"
          label="Feed Vf"
          unit="mm/min"
          value={Vf}
          max={VfMax}
          display={fmtInt(Vf)}
          dangerPct={DANGER_PCT}
          warnPct={WARN_PCT}
          darkMode={darkMode}
        />
        <Gauge
          theme="pc"
          label="Power Pc"
          unit="kW"
          value={Pc}
          max={PcMax}
          display={fmt2(Pc)}
          dangerPct={PC_CAUTION_PCT}
          warnPct={WARN_PCT}
          threeBand
          darkMode={darkMode}
        />
        {/* Tool Life + Chatter : 하나의 게이지 카드에 2-게이지 배치 (세로 2분할 또는 1개 주 + mini) */}
        <DualLifeChatterGauge
          toolLifePct={toolLifePct}
          chatterRisk={chatterRisk}
          darkMode={darkMode}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Tool Life + Chatter 이중 게이지
// - 한 카드에 두 개의 작은 반원형 게이지를 나란히
// - 왼쪽: Tool Life (녹→amber→red), 오른쪽: Chatter (녹→red)
// ─────────────────────────────────────────────────────────────────────

interface DualProps {
  toolLifePct: number
  chatterRisk: number
  darkMode: boolean
}

function DualLifeChatterGauge({ toolLifePct, chatterRisk, darkMode }: DualProps) {
  const pal = palette("life", darkMode)
  const reduce = useReducedMotion()
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "")

  const life = clamp(toolLifePct, 0, 100)
  const chat = clamp(chatterRisk, 0, 100)

  // Tool life: 낮을수록 위험 (life <= 30 → red, <= 60 → amber)
  const lifeBand = life <= 20 ? "danger" : life <= 40 ? "warn" : "safe"
  // Chatter: 높을수록 위험
  const chatBand = chat >= 70 ? "danger" : chat >= 40 ? "warn" : "safe"

  const dangerOn = lifeBand === "danger" || chatBand === "danger"
  const warnOn = lifeBand === "warn" || chatBand === "warn"

  const lifeColor =
    lifeBand === "danger" ? "#ef4444" : lifeBand === "warn" ? "#f59e0b" : darkMode ? "#34d399" : "#10b981"
  const chatColor =
    chatBand === "danger" ? "#ef4444" : chatBand === "warn" ? "#f59e0b" : darkMode ? "#34d399" : "#10b981"

  // 반원 arc (좌/우 분할)
  // 왼쪽 반원: -180° (9시) → 0° (12시) 경유 → 0° (12시) 아님... 단순화: -180° → 0° 시계방향
  // 여기서는 아래쪽 반원을 활용 (좌: -180→-90→0 상단 호)
  // 구현: 좌측 반원 = -180° ~ 0° (상단), 우측 반원 = 0° ~ 180° (하단) — 대신에
  // 간단히 세로 두 compact 게이지로 표현

  const leftPct = life
  const rightPct = chat
  const leftAngle = -90 + (leftPct / 100) * 180     // -90 (빈) → +90 (가득)  반원 바늘
  const rightAngle = -90 + (rightPct / 100) * 180

  const SUB_VIEW = 120
  const scx = SUB_VIEW / 2
  const scy = SUB_VIEW * 0.72  // 반원이므로 중심을 아래쪽으로
  const subR = 44

  return (
    <div
      className={[
        "relative flex flex-col items-center rounded-2xl border p-3 transition-all",
        darkMode ? "border-slate-700 bg-slate-900/70" : "border-slate-200 bg-white/80",
        dangerOn
          ? darkMode
            ? "shadow-[0_0_24px_rgba(239,68,68,0.45)]"
            : "shadow-[0_0_20px_rgba(239,68,68,0.35)]"
          : warnOn
          ? darkMode
            ? "shadow-[0_0_18px_rgba(245,158,11,0.35)]"
            : "shadow-[0_0_14px_rgba(245,158,11,0.30)]"
          : darkMode
          ? "shadow-[0_0_12px_rgba(167,139,250,0.10)]"
          : "shadow-sm",
      ].join(" ")}
      role="group"
      aria-label="Tool Life and Chatter"
    >
      <div className="mb-1 flex w-full items-center justify-between px-1">
        <span className={["text-[11px] font-semibold uppercase tracking-wider", pal.textLabel].join(" ")}>
          Life · Chatter
        </span>
        <span className={["text-[10px] font-medium tabular-nums", pal.textUnit].join(" ")}>dual</span>
      </div>

      <div className="grid w-full grid-cols-2 gap-1">
        {/* LEFT : Tool Life (남은 수명 %) */}
        <SemiGauge
          uid={`life-${uid}`}
          size={SUB_VIEW}
          scx={scx}
          scy={scy}
          r={subR}
          angle={leftAngle}
          color={lifeColor}
          label="LIFE"
          value={`${Math.round(life)}%`}
          darkMode={darkMode}
          reduce={!!reduce}
          dangerPulse={lifeBand === "danger"}
        />
        {/* RIGHT : Chatter risk */}
        <SemiGauge
          uid={`chat-${uid}`}
          size={SUB_VIEW}
          scx={scx}
          scy={scy}
          r={subR}
          angle={rightAngle}
          color={chatColor}
          label="CHATTER"
          value={`${Math.round(chat)}%`}
          darkMode={darkMode}
          reduce={!!reduce}
          dangerPulse={chatBand === "danger"}
        />
      </div>

      {/* 하단 dual sub-bar */}
      <div className="mt-2 w-full space-y-1 px-1">
        <div className="flex items-center gap-2">
          <span className={["w-12 text-[9px] font-semibold uppercase", pal.textUnit].join(" ")}>Life</span>
          <div
            className="relative h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: pal.subBarBg }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: lifeColor }}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${life}%` }}
              transition={reduce ? { duration: 0 } : SPRING}
            />
          </div>
          <span className={["w-8 text-right text-[9px] tabular-nums", pal.textUnit].join(" ")}>
            {Math.round(life)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={["w-12 text-[9px] font-semibold uppercase", pal.textUnit].join(" ")}>Chatter</span>
          <div
            className="relative h-1.5 flex-1 overflow-hidden rounded-full"
            style={{ background: pal.subBarBg }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: chatColor }}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${chat}%` }}
              transition={reduce ? { duration: 0 } : SPRING}
            />
          </div>
          <span className={["w-8 text-right text-[9px] tabular-nums", pal.textUnit].join(" ")}>
            {Math.round(chat)}%
          </span>
        </div>
      </div>
    </div>
  )
}

interface SemiGaugeProps {
  uid: string
  size: number
  scx: number
  scy: number
  r: number
  angle: number
  color: string
  label: string
  value: string
  darkMode: boolean
  reduce: boolean
  dangerPulse: boolean
}

function SemiGauge({
  uid, size, scx, scy, r, angle, color, label, value, darkMode, reduce, dangerPulse,
}: SemiGaugeProps) {
  // 반원 배경 arc: -90°(좌) → +90°(우)  = 상단 반원
  const arc = (() => {
    const [x1, y1] = polar(scx, scy, r, -90)
    const [x2, y2] = polar(scx, scy, r, 90)
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  })()

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${size} ${size * 0.85}`} className="w-full" role="img" aria-hidden="true">
        <defs>
          <filter id={`ns-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor={color} floodOpacity={0.5} />
          </filter>
        </defs>
        {/* 반원 배경 */}
        <path
          d={arc}
          stroke={darkMode ? "#1e293b" : "#e2e8f0"}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
        {/* 채워진 progress arc */}
        <ProgressArc
          scx={scx}
          scy={scy}
          r={r}
          angle={angle}
          color={color}
          reduce={reduce}
        />
        {/* 눈금 (주 5개) */}
        {[-90, -45, 0, 45, 90].map((a, i) => {
          const [tx1, ty1] = polar(scx, scy, r + 2, a)
          const [tx2, ty2] = polar(scx, scy, r - 6, a)
          return (
            <line
              key={i}
              x1={tx1}
              y1={ty1}
              x2={tx2}
              y2={ty2}
              stroke={darkMode ? "#475569" : "#94a3b8"}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )
        })}
        {/* 바늘 */}
        <motion.g
          initial={reduce ? false : { rotate: -90 }}
          animate={dangerPulse && !reduce
            ? { rotate: [angle - 2, angle + 2, angle] }
            : { rotate: angle }}
          transition={reduce
            ? { duration: 0 }
            : dangerPulse
              ? { duration: 0.4, repeat: Infinity, ease: "easeInOut" as const }
              : SPRING
          }
          style={{ originX: `${scx}px`, originY: `${scy}px`, transformBox: "fill-box" as const }}
          transform-origin={`${scx} ${scy}`}
        >
          <path
            d={`M ${scx} ${scy + 6}
               L ${scx - 2} ${scy}
               L ${scx} ${scy - r + 4}
               L ${scx + 2} ${scy}
               Z`}
            fill={color}
            stroke={darkMode ? "#0f172a" : "#ffffff"}
            strokeWidth={0.6}
            filter={`url(#ns-${uid})`}
          />
        </motion.g>
        {/* 중심 허브 */}
        <circle cx={scx} cy={scy} r={4} fill={darkMode ? "#0f172a" : "#ffffff"} stroke={color} strokeWidth={1} />
      </svg>
      <div className="-mt-2 text-center">
        <div className={["text-base font-extrabold tabular-nums leading-none", darkMode ? "text-slate-100" : "text-slate-800"].join(" ")}>
          {value}
        </div>
        <div className={["mt-0.5 text-[9px] font-semibold uppercase tracking-wider", darkMode ? "text-slate-400" : "text-slate-500"].join(" ")}>
          {label}
        </div>
      </div>
    </div>
  )
}

// 별도 컴포넌트: progress arc 길이 애니메이션 (stroke-dashoffset)
function ProgressArc({
  scx, scy, r, angle, color, reduce,
}: { scx: number; scy: number; r: number; angle: number; color: string; reduce: boolean }) {
  // 각도를 pct로 역산: angle ∈ [-90, 90] → pct ∈ [0, 1]
  const pct = clamp((angle + 90) / 180, 0, 1)
  const len = Math.PI * r          // 반원 둘레
  const arcLen = len * pct
  const arc = (() => {
    const [x1, y1] = polar(scx, scy, r, -90)
    const [x2, y2] = polar(scx, scy, r, 90)
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
  })()
  return (
    <motion.path
      d={arc}
      stroke={color}
      strokeWidth={6}
      fill="none"
      strokeLinecap="round"
      strokeDasharray={`${len} ${len}`}
      initial={reduce ? false : { strokeDashoffset: len }}
      animate={{ strokeDashoffset: len - arcLen }}
      transition={reduce ? { duration: 0 } : { ...SPRING, duration: SWEEP_DURATION }}
    />
  )
}
