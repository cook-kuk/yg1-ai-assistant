"use client"

/**
 * DashboardHeroDisplay
 *
 * Cook-forge YG-1 Simulator v3 전용 "거대 KPI 영웅 디스플레이".
 * 시뮬레이터 상단에 배치되는 아이맥스(IMAX) 스케일 KPI 4종:
 *   - RPM          (blue-cyan)
 *   - MRR cm³/min  (emerald)
 *   - Pc kW        (orange-rose, flame)
 *   - ToolLife min (violet, clock + chatter badge)
 *
 * 거대한 tabular-nums 숫자 + framer-motion staggered mount + neon glow +
 * 위험시 scanline / red pulse / shake 이벤트를 제공한다. 영화 UI 톤.
 *
 * 의존성: framer-motion, lucide-react, AnimatedNumber (./animated-number)
 * 주의  : cutting-simulator-v2.tsx 는 절대 건드리지 않는다. 본 파일은 v3 신규.
 *
 * 사용 예:
 *   <DashboardHeroDisplay
 *     rpm={12500} rpmMax={15000}
 *     mrr={42.7}  mrrRef={34.2}
 *     pc={8.6}    pcMax={11.0}
 *     toolLifeMin={58}
 *     chatterLevel="med"
 *     darkMode
 *   />
 */

import { AnimatePresence, motion } from "framer-motion"
import { Clock3, Flame, Gauge, Zap } from "lucide-react"
import { AnimatedNumber } from "./animated-number"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ChatterLevel = "low" | "med" | "high"

export interface DashboardHeroDisplayProps {
  rpm: number
  rpmMax: number
  mrr: number // cm³/min
  mrrRef?: number // 비교 기준 (optional)
  pc: number // kW
  pcMax: number
  toolLifeMin: number
  chatterLevel: ChatterLevel
  darkMode?: boolean
  compact?: boolean // default false
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safe 0..1 ratio, 분모 0 방지. */
function ratio(v: number, max: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(Math.max(v / max, 0), 1)
}

/** Chatter 레벨별 색상 토큰. */
const CHATTER_STYLES: Record<
  ChatterLevel,
  { label: string; bg: string; text: string; ring: string }
> = {
  low: {
    label: "CHATTER · LOW",
    bg: "bg-emerald-500/15",
    text: "text-emerald-600 dark:text-emerald-300",
    ring: "ring-emerald-500/40",
  },
  med: {
    label: "CHATTER · MED",
    bg: "bg-amber-500/15",
    text: "text-amber-600 dark:text-amber-300",
    ring: "ring-amber-500/40",
  },
  high: {
    label: "CHATTER · HIGH",
    bg: "bg-rose-500/15",
    text: "text-rose-600 dark:text-rose-300",
    ring: "ring-rose-500/50",
  },
}

// framer-motion variants: 카드 staggered 등장
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
  },
}

// ---------------------------------------------------------------------------
// Shared Card primitive
// ---------------------------------------------------------------------------

interface HeroCardProps {
  label: string
  accent: "blue" | "emerald" | "orange" | "violet"
  danger?: boolean
  darkMode?: boolean
  compact?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}

const ACCENT_STYLES: Record<
  HeroCardProps["accent"],
  {
    border: string
    ring: string
    glow: string
    textGrad: string
    barFrom: string
    barTo: string
    bgLight: string
    bgDark: string
  }
> = {
  blue: {
    border: "border-sky-400/40",
    ring: "ring-sky-400/30",
    glow: "shadow-[inset_0_0_40px_-8px_rgba(56,189,248,0.35)]",
    textGrad: "from-sky-400 via-cyan-300 to-blue-500",
    barFrom: "from-sky-400",
    barTo: "to-cyan-300",
    bgLight: "from-sky-50 via-white to-cyan-50",
    bgDark: "from-sky-950/60 via-slate-900/40 to-cyan-950/60",
  },
  emerald: {
    border: "border-emerald-400/40",
    ring: "ring-emerald-400/30",
    glow: "shadow-[inset_0_0_40px_-8px_rgba(16,185,129,0.35)]",
    textGrad: "from-emerald-400 via-teal-300 to-emerald-500",
    barFrom: "from-emerald-400",
    barTo: "to-teal-300",
    bgLight: "from-emerald-50 via-white to-teal-50",
    bgDark: "from-emerald-950/60 via-slate-900/40 to-teal-950/60",
  },
  orange: {
    border: "border-orange-400/40",
    ring: "ring-orange-400/30",
    glow: "shadow-[inset_0_0_40px_-8px_rgba(249,115,22,0.35)]",
    textGrad: "from-orange-400 via-rose-400 to-amber-500",
    barFrom: "from-orange-400",
    barTo: "to-rose-400",
    bgLight: "from-orange-50 via-white to-rose-50",
    bgDark: "from-orange-950/60 via-slate-900/40 to-rose-950/60",
  },
  violet: {
    border: "border-violet-400/40",
    ring: "ring-violet-400/30",
    glow: "shadow-[inset_0_0_40px_-8px_rgba(139,92,246,0.35)]",
    textGrad: "from-violet-400 via-fuchsia-300 to-purple-500",
    barFrom: "from-violet-400",
    barTo: "to-fuchsia-300",
    bgLight: "from-violet-50 via-white to-fuchsia-50",
    bgDark: "from-violet-950/60 via-slate-900/40 to-fuchsia-950/60",
  },
}

function HeroCard({
  label,
  accent,
  danger,
  darkMode,
  compact,
  icon,
  children,
  footer,
}: HeroCardProps) {
  const a = ACCENT_STYLES[accent]
  const bg = darkMode
    ? `bg-gradient-to-br ${a.bgDark} backdrop-blur-xl`
    : `bg-gradient-to-br ${a.bgLight}`
  const dangerRing = danger
    ? "ring-2 ring-rose-500/70 ring-offset-2 animate-pulse"
    : `ring-1 ${a.ring}`
  const pad = compact ? "p-3" : "p-6"

  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -2 }}
      className={[
        "relative rounded-2xl border-2 transition-shadow duration-200",
        a.border,
        bg,
        a.glow,
        dangerRing,
        pad,
        "hover:shadow-2xl",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={[
            "text-[10px] font-bold uppercase tracking-[0.2em]",
            darkMode ? "text-slate-300" : "text-slate-500",
          ].join(" ")}
        >
          {label}
        </span>
        {icon ? <div className="opacity-80">{icon}</div> : null}
      </div>
      <div className="mt-2">{children}</div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bar with glow
// ---------------------------------------------------------------------------

function HeroBar({
  ratio: r,
  from,
  to,
  danger,
}: {
  ratio: number
  from: string
  to: string
  danger?: boolean
}) {
  const pct = Math.round(r * 100)
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200/50 dark:bg-slate-800/60">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={[
          "h-full rounded-full bg-gradient-to-r",
          from,
          to,
          danger ? "animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.6)]" : "shadow-[0_0_10px_rgba(125,211,252,0.4)]",
        ].join(" ")}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Spark / flame / clock micro-animations
// ---------------------------------------------------------------------------

function SparkLine() {
  return (
    <svg viewBox="0 0 120 20" className="h-5 w-full text-emerald-500 dark:text-emerald-400" aria-hidden>
      <motion.polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points="0,15 10,8 20,12 30,4 40,10 50,6 60,11 70,3 80,9 90,5 100,12 110,7 120,10"
        initial={{ pathLength: 0, opacity: 0.3 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
    </svg>
  )
}

function FlameIcon() {
  return (
    <motion.div
      animate={{ scale: [1, 1.08, 0.96, 1.05, 1], rotate: [0, -3, 2, -1, 0] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      className="text-orange-500 dark:text-orange-300"
    >
      <Flame className="h-4 w-4" />
    </motion.div>
  )
}

function ClockIcon() {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
      className="text-violet-500 dark:text-violet-300"
    >
      <Clock3 className="h-4 w-4" />
    </motion.div>
  )
}

/** % of max progress arc (orange-rose). */
function PowerArc({ r }: { r: number }) {
  const size = 36
  const stroke = 4
  const radius = (size - stroke) / 2
  const circ = 2 * Math.PI * radius
  const offset = circ * (1 - Math.min(Math.max(r, 0), 1))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-slate-300/40 dark:text-slate-700/60"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#powerArcGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <defs>
        <linearGradient id="powerArcGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fb923c" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DashboardHeroDisplay({
  rpm,
  rpmMax,
  mrr,
  mrrRef,
  pc,
  pcMax,
  toolLifeMin,
  chatterLevel,
  darkMode = false,
  compact = false,
}: DashboardHeroDisplayProps) {
  // ---------- 파생 상태 ----------
  const rpmR = ratio(rpm, rpmMax)
  const pcR = ratio(pc, pcMax)

  const rpmDanger = rpmR > 0.9
  const rpmCritical = rpmR > 0.95
  const pcDanger = pcR > 0.9
  const chatterDanger = chatterLevel === "high"

  const critical = rpmCritical || chatterDanger

  // MRR 비교 델타
  const mrrDelta =
    mrrRef && mrrRef > 0 && Number.isFinite(mrrRef)
      ? ((mrr - mrrRef) / mrrRef) * 100
      : null
  const mrrDeltaPositive = mrrDelta != null && mrrDelta >= 0

  const chatter = CHATTER_STYLES[chatterLevel]

  // ---------- 공통 스타일 ----------
  const numberBase = compact
    ? "text-2xl sm:text-3xl font-black leading-none tabular-nums"
    : "text-4xl sm:text-5xl lg:text-6xl font-black leading-none tabular-nums"

  const shakeAnim = rpmCritical
    ? {
        animate: { x: [0, -1.5, 1.5, -1, 1, 0] },
        transition: { duration: 0.35, repeat: Infinity, ease: "easeInOut" as const },
      }
    : {}

  // ---------- RENDER ----------
  return (
    <div
      className={[
        "relative w-full",
        darkMode ? "text-slate-100" : "text-slate-900",
      ].join(" ")}
      data-critical={critical ? "true" : "false"}
      aria-label="Simulator KPI hero display"
    >
      {/* ===== Scanline overlay (critical only) ===== */}
      <AnimatePresence>
        {critical && (
          <motion.div
            key="scanline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-2xl"
            aria-hidden
          >
            {/* 빨간 scanline stripes */}
            <div
              className="absolute inset-0 opacity-[0.12] mix-blend-screen"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(244,63,94,0.8) 0px, rgba(244,63,94,0.8) 1px, transparent 2px, transparent 4px)",
              }}
            />
            {/* moving bright scan line */}
            <motion.div
              className="absolute left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-rose-500 to-transparent blur-[1px]"
              initial={{ top: "-5%" }}
              animate={{ top: "105%" }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== CRITICAL 배지 ===== */}
      <AnimatePresence>
        {critical && (
          <motion.div
            key="critical-badge"
            initial={{ opacity: 0, y: -6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.9 }}
            className="absolute left-2 top-2 z-20 flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-lg shadow-rose-500/40"
          >
            <motion.span
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 0.9, repeat: Infinity }}
            >
              ⚠
            </motion.span>
            Critical Condition
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== Grid ===== */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className={[
          "relative z-0 grid gap-3 sm:gap-4",
          compact ? "grid-cols-4" : "grid-cols-2 lg:grid-cols-4",
        ].join(" ")}
      >
        {/* ----- 1. RPM ----- */}
        <HeroCard
          label="RPM"
          accent="blue"
          danger={rpmDanger}
          darkMode={darkMode}
          compact={compact}
          icon={<Gauge className="h-4 w-4 text-sky-500 dark:text-sky-300" />}
          footer={
            !compact ? (
              <HeroBar
                ratio={rpmR}
                from={ACCENT_STYLES.blue.barFrom}
                to={ACCENT_STYLES.blue.barTo}
                danger={rpmDanger}
              />
            ) : null
          }
        >
          <motion.div {...shakeAnim} className="flex items-baseline gap-2">
            <AnimatedNumber
              value={rpm}
              decimals={0}
              className={[
                numberBase,
                "bg-gradient-to-br bg-clip-text text-transparent",
                ACCENT_STYLES.blue.textGrad,
                "drop-shadow-[0_0_12px_rgba(56,189,248,0.35)]",
              ].join(" ")}
            />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              / {rpmMax.toLocaleString("ko-KR")}
            </span>
          </motion.div>
        </HeroCard>

        {/* ----- 2. MRR ----- */}
        <HeroCard
          label="MRR"
          accent="emerald"
          darkMode={darkMode}
          compact={compact}
          icon={<Zap className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />}
          footer={!compact ? <SparkLine /> : null}
        >
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={mrr}
              decimals={2}
              className={[
                numberBase,
                "bg-gradient-to-br bg-clip-text text-transparent",
                ACCENT_STYLES.emerald.textGrad,
                "drop-shadow-[0_0_12px_rgba(16,185,129,0.35)]",
              ].join(" ")}
            />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              cm³/min
            </span>
          </div>
          {mrrDelta != null && (
            <div className="mt-1">
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  mrrDeltaPositive
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                    : "bg-rose-500/15 text-rose-600 dark:text-rose-300",
                ].join(" ")}
              >
                {mrrDeltaPositive ? "▲" : "▼"}{" "}
                {mrrDeltaPositive ? "+" : ""}
                {mrrDelta.toFixed(1)}%
              </span>
            </div>
          )}
        </HeroCard>

        {/* ----- 3. Pc (power) ----- */}
        <HeroCard
          label="POWER · Pc"
          accent="orange"
          danger={pcDanger}
          darkMode={darkMode}
          compact={compact}
          icon={<FlameIcon />}
          footer={
            !compact ? (
              <div className="flex items-center gap-2">
                <PowerArc r={pcR} />
                <div className="flex flex-1 flex-col gap-1">
                  <HeroBar
                    ratio={pcR}
                    from={ACCENT_STYLES.orange.barFrom}
                    to={ACCENT_STYLES.orange.barTo}
                    danger={pcDanger}
                  />
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {Math.round(pcR * 100)}% of {pcMax.toFixed(1)} kW
                  </span>
                </div>
              </div>
            ) : null
          }
        >
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={pc}
              decimals={2}
              className={[
                numberBase,
                "bg-gradient-to-br bg-clip-text text-transparent",
                ACCENT_STYLES.orange.textGrad,
                "drop-shadow-[0_0_12px_rgba(249,115,22,0.35)]",
              ].join(" ")}
            />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              kW
            </span>
          </div>
        </HeroCard>

        {/* ----- 4. ToolLife ----- */}
        <HeroCard
          label="TOOL LIFE"
          accent="violet"
          danger={chatterDanger}
          darkMode={darkMode}
          compact={compact}
          icon={<ClockIcon />}
          footer={
            <div className={compact ? "" : "mt-0"}>
              <span
                className={[
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1",
                  chatter.bg,
                  chatter.text,
                  chatter.ring,
                ].join(" ")}
              >
                {chatter.label}
              </span>
            </div>
          }
        >
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={toolLifeMin}
              decimals={0}
              className={[
                numberBase,
                "bg-gradient-to-br bg-clip-text text-transparent",
                ACCENT_STYLES.violet.textGrad,
                "drop-shadow-[0_0_12px_rgba(139,92,246,0.35)]",
              ].join(" ")}
            />
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              min
            </span>
          </div>
        </HeroCard>
      </motion.div>
    </div>
  )
}
