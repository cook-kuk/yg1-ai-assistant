"use client"

/**
 * BeforeAfterCompare
 *
 * Cook-forge YG-1 Simulator v3 전용 "AI 최적화 Before / After 대형 비교 대시보드".
 *
 * 영업 스토리 컴포넌트:
 *   - 좌: 현재 조건 (slate)
 *   - 우: AI 최적화 조건 (emerald glow)
 *   - 변화 매트릭스 8 rows (Vc/fz/ap/ae/n/Vf/MRR/Pc/ToolLife/Ra)
 *   - 핵심 KPI 3개 (MRR ↑%, ToolLife Δ, 개당 원가 Δ)
 *   - 월 임팩트 배너 (costPerPart 둘 다 있을 때)
 *   - AI 추천 이유 (violet/indigo box)
 *   - "✓ 이 조건 적용" / "↺ 되돌리기" 액션 버튼
 *
 * 애니메이션:
 *   - framer-motion staggered mount (stagger 0.08)
 *   - 숫자 tumbling (AnimatedNumber)
 *   - hover card tilt (subtle y: -2)
 *
 * 의존성: framer-motion ^12.38, lucide-react, AnimatedNumber (./animated-number)
 * 주의  : cutting-simulator-v2.tsx 는 절대 건드리지 않는다. 본 파일은 v3 신규.
 */

import { motion } from "framer-motion"
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronsUp,
  Clock,
  Equal,
  Minus,
  RotateCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Undo2,
  Wallet,
  X,
} from "lucide-react"
import type { ReactNode } from "react"
import { AnimatedNumber } from "./animated-number"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BeforeAfterConditions {
  /** 카드 제목 (기본 before="현재 조건", after="AI 최적화") */
  label?: string
  Vc: number          // m/min
  fz: number          // mm/tooth
  ap: number          // mm
  ae: number          // mm
  n: number           // rpm
  Vf: number          // mm/min
  MRR: number         // cm³/min
  Pc: number          // kW
  toolLifeMin: number // min
  Ra: number          // µm
  /** 개당 가공비 (원). 양쪽 모두 제공 시 절감액 계산에 사용 */
  costPerPart?: number
}

export interface BeforeAfterCompareProps {
  before: BeforeAfterConditions
  after: BeforeAfterConditions
  /** AI 추천 이유(한국어). violet 박스에 표시 */
  reasoning?: string
  darkMode?: boolean
  onApply?: () => void
  onRevert?: () => void
}

// ---------------------------------------------------------------------------
// 변화 매트릭스 정의
// ---------------------------------------------------------------------------

type Direction = "higher-better" | "lower-better" | "neutral"

interface MetricRow {
  key: keyof BeforeAfterConditions
  label: string
  unit: string
  decimals: number
  dir: Direction
}

const METRIC_ROWS: MetricRow[] = [
  { key: "Vc",          label: "Vc (절삭속도)",      unit: "m/min",   decimals: 1, dir: "neutral" },
  { key: "fz",          label: "fz (1날 이송)",      unit: "mm/t",    decimals: 4, dir: "neutral" },
  { key: "ap",          label: "ap (축방향 절입)",   unit: "mm",      decimals: 2, dir: "neutral" },
  { key: "ae",          label: "ae (경방향 절입)",   unit: "mm",      decimals: 2, dir: "neutral" },
  { key: "n",           label: "n (스핀들 회전)",    unit: "rpm",     decimals: 0, dir: "neutral" },
  { key: "Vf",          label: "Vf (테이블 이송)",   unit: "mm/min",  decimals: 0, dir: "neutral" },
  { key: "MRR",         label: "MRR (금속제거율)",   unit: "cm³/min", decimals: 2, dir: "higher-better" },
  { key: "Pc",          label: "Pc (소요동력)",      unit: "kW",      decimals: 2, dir: "lower-better" },
  { key: "toolLifeMin", label: "Tool Life (공구수명)", unit: "min",   decimals: 0, dir: "higher-better" },
  { key: "Ra",          label: "Ra (표면조도)",      unit: "µm",      decimals: 2, dir: "lower-better" },
]

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function safePct(before: number, after: number): number | null {
  if (!Number.isFinite(before) || Math.abs(before) < 1e-9) return null
  return ((after - before) / before) * 100
}

/** 개선 여부 판정 (|Δ| < 0.5% 는 동등 취급) */
function verdict(dir: Direction, pct: number | null): "good" | "bad" | "same" {
  if (pct == null) return "same"
  if (Math.abs(pct) < 0.5) return "same"
  if (dir === "higher-better") return pct > 0 ? "good" : "bad"
  if (dir === "lower-better") return pct < 0 ? "good" : "bad"
  return "same"
}

/** 변화량 표시용 색상 클래스 */
function verdictClass(v: "good" | "bad" | "same"): string {
  if (v === "good") return "text-emerald-600 dark:text-emerald-400"
  if (v === "bad") return "text-rose-600 dark:text-rose-400"
  return "text-slate-400 dark:text-slate-500"
}

function krwFormat(n: number): string {
  return "₩" + Math.round(n).toLocaleString("ko-KR")
}

// framer-motion variants: 카드/row staggered 등장
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] as const },
  },
}

// ---------------------------------------------------------------------------
// Sub components
// ---------------------------------------------------------------------------

interface SideCardProps {
  label: string
  tone: "before" | "after"
  cond: BeforeAfterConditions
  darkMode?: boolean
}

/** 2열 비교 카드 (before: slate / after: emerald glow) */
function SideCard({ label, tone, cond, darkMode }: SideCardProps) {
  const isAfter = tone === "after"

  const wrap = isAfter
    ? [
        "border-emerald-400/60 dark:border-emerald-400/40",
        "ring-1 ring-emerald-400/40 dark:ring-emerald-400/30",
        "shadow-[inset_0_0_50px_-8px_rgba(16,185,129,0.35)]",
        darkMode
          ? "bg-gradient-to-br from-emerald-950/70 via-slate-900/50 to-teal-950/70"
          : "bg-gradient-to-br from-emerald-50 via-white to-teal-50",
      ].join(" ")
    : [
        "border-slate-300/70 dark:border-slate-700/70",
        "ring-1 ring-slate-300/40 dark:ring-slate-700/40",
        darkMode
          ? "bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-slate-800/80"
          : "bg-gradient-to-br from-slate-50 via-white to-slate-100",
      ].join(" ")

  const badge = isAfter
    ? "bg-emerald-500 text-white"
    : darkMode
      ? "bg-slate-700 text-slate-200"
      : "bg-slate-200 text-slate-700"

  const titleColor = isAfter
    ? "text-emerald-700 dark:text-emerald-300"
    : darkMode
      ? "text-slate-200"
      : "text-slate-700"

  const numGrad = isAfter
    ? "from-emerald-500 via-teal-400 to-emerald-600 dark:from-emerald-300 dark:via-teal-200 dark:to-emerald-400"
    : "from-slate-500 via-slate-400 to-slate-600 dark:from-slate-300 dark:via-slate-200 dark:to-slate-400"

  const big = (value: number, decimals: number) => (
    <AnimatedNumber
      value={value}
      decimals={decimals}
      className={`bg-gradient-to-br ${numGrad} bg-clip-text text-transparent text-3xl md:text-4xl font-black tabular-nums`}
      flash={false}
    />
  )

  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -3, rotateX: 1.5, rotateY: isAfter ? -1.2 : 1.2 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={[
        "relative rounded-2xl border-2 p-5 md:p-6",
        "transition-shadow duration-200 hover:shadow-2xl",
        wrap,
      ].join(" ")}
      style={{ transformStyle: "preserve-3d" }}
    >
      <div className="flex items-center justify-between">
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
            "text-[10px] font-bold uppercase tracking-[0.22em]",
            badge,
          ].join(" ")}
        >
          {isAfter ? <Sparkles className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {isAfter ? "AFTER · AI" : "BEFORE"}
        </span>
      </div>

      <h3 className={`mt-2 text-lg md:text-xl font-bold ${titleColor}`}>{label}</h3>

      {/* 큰 4지표 2x2 */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:gap-4">
        <KpiTile name="Vc" unit="m/min">{big(cond.Vc, 1)}</KpiTile>
        <KpiTile name="fz" unit="mm/t">{big(cond.fz, 4)}</KpiTile>
        <KpiTile name="ap" unit="mm">{big(cond.ap, 2)}</KpiTile>
        <KpiTile name="ae" unit="mm">{big(cond.ae, 2)}</KpiTile>
      </div>
    </motion.div>
  )
}

function KpiTile({ name, unit, children }: { name: string; unit: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
        {name}
      </span>
      <div className="leading-none mt-1">{children}</div>
      <span className="text-[10px] mt-1 text-slate-500 dark:text-slate-400">{unit}</span>
    </div>
  )
}

interface DeltaRowProps {
  row: MetricRow
  beforeVal: number
  afterVal: number
}

function DeltaRow({ row, beforeVal, afterVal }: DeltaRowProps) {
  const pct = safePct(beforeVal, afterVal)
  const delta = afterVal - beforeVal
  const v = verdict(row.dir, pct)
  const vCls = verdictClass(v)

  let TrendIcon = Minus
  if (v === "good") TrendIcon = row.dir === "lower-better" ? TrendingDown : TrendingUp
  else if (v === "bad") TrendIcon = row.dir === "lower-better" ? TrendingUp : TrendingDown

  const VerdictIcon = v === "good" ? Check : v === "bad" ? X : Equal
  const verdictIconCls =
    v === "good"
      ? "text-emerald-500"
      : v === "bad"
        ? "text-rose-500"
        : "text-slate-400"

  return (
    <motion.tr
      variants={itemVariants}
      className="border-b border-slate-200/70 dark:border-slate-800/70 last:border-0 group"
    >
      <td className="py-2 pr-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {row.label}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{row.unit}</span>
        </div>
      </td>
      <td className="py-2 px-2 text-right">
        <AnimatedNumber
          value={beforeVal}
          decimals={row.decimals}
          className="text-sm font-mono tabular-nums text-slate-600 dark:text-slate-300"
          flash={false}
        />
      </td>
      <td className="py-2 px-2 text-right">
        <AnimatedNumber
          value={afterVal}
          decimals={row.decimals}
          className="text-sm font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-300"
          flash={false}
        />
      </td>
      <td className="py-2 px-2 text-right">
        <span className={`inline-flex items-center gap-1 text-xs font-mono tabular-nums ${vCls}`}>
          <TrendIcon className="h-3 w-3" />
          {pct != null ? (
            <>
              {pct > 0 ? "+" : ""}
              <AnimatedNumber value={pct} decimals={1} flash={false} suffix="%" />
            </>
          ) : (
            <span>—</span>
          )}
          <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1">
            (Δ {delta > 0 ? "+" : ""}
            {delta.toLocaleString("ko-KR", {
              minimumFractionDigits: row.decimals,
              maximumFractionDigits: row.decimals,
            })}
            )
          </span>
        </span>
      </td>
      <td className="py-2 pl-2 text-center">
        <VerdictIcon className={`h-4 w-4 inline-block ${verdictIconCls}`} />
      </td>
    </motion.tr>
  )
}

interface KpiHighlightProps {
  label: string
  children: ReactNode
  sub?: string
  accent: "emerald" | "violet" | "amber"
  icon: ReactNode
}

function KpiHighlight({ label, children, sub, accent, icon }: KpiHighlightProps) {
  const accentMap = {
    emerald: {
      wrap: "border-emerald-400/60 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-400/40",
      text: "text-emerald-700 dark:text-emerald-300",
    },
    violet: {
      wrap: "border-violet-400/60 bg-violet-50 dark:bg-violet-950/40 dark:border-violet-400/40",
      text: "text-violet-700 dark:text-violet-300",
    },
    amber: {
      wrap: "border-amber-400/60 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-400/40",
      text: "text-amber-700 dark:text-amber-300",
    },
  }[accent]

  return (
    <motion.div
      variants={itemVariants}
      whileHover={{ y: -2 }}
      className={[
        "relative rounded-xl border-2 p-4 md:p-5",
        "transition-shadow hover:shadow-xl",
        accentMap.wrap,
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className={accentMap.text}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <div className={`mt-2 text-2xl md:text-3xl font-black tabular-nums ${accentMap.text}`}>
        {children}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>
      ) : null}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BeforeAfterCompare({
  before,
  after,
  reasoning,
  darkMode,
  onApply,
  onRevert,
}: BeforeAfterCompareProps) {
  const beforeLabel = before.label ?? "현재 조건"
  const afterLabel = after.label ?? "AI 최적화"

  // 핵심 KPI 계산
  const mrrPct = safePct(before.MRR, after.MRR) ?? 0
  const toolLifeDelta = after.toolLifeMin - before.toolLifeMin

  const costBefore = before.costPerPart
  const costAfter = after.costPerPart
  const hasCost =
    typeof costBefore === "number" &&
    typeof costAfter === "number" &&
    Number.isFinite(costBefore) &&
    Number.isFinite(costAfter)
  const costDelta = hasCost ? (costAfter as number) - (costBefore as number) : 0 // +면 상승, -면 절감
  const costSavePerPart = hasCost ? -costDelta : 0 // 절감액(+면 절감)
  const monthlySaving = hasCost ? costSavePerPart * 1000 : 0 // 월 1000개 가정

  return (
    <motion.section
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className={[
        "relative rounded-3xl p-5 md:p-7 space-y-6",
        "border-2",
        darkMode
          ? "bg-slate-950/80 border-slate-800 text-slate-100"
          : "bg-white border-slate-200 text-slate-900",
        "shadow-xl",
      ].join(" ")}
      aria-label="Before After 비교 대시보드"
    >
      {/* 1. 상단 헤더 */}
      <motion.header variants={itemVariants} className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div
            className={[
              "flex h-11 w-11 items-center justify-center rounded-xl",
              "bg-gradient-to-br from-indigo-500 via-violet-500 to-emerald-500",
              "text-white shadow-lg shadow-violet-500/30",
            ].join(" ")}
            aria-hidden
          >
            <span className="text-xl">📊</span>
          </div>
          <div>
            <h2 className="text-xl md:text-2xl font-black tracking-tight">
              Before / After 비교
            </h2>
            <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              현재 조건 vs AI 최적화 조건 — 핵심 지표 변화를 한눈에
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
          <Sparkles className="h-3 w-3" /> AI Insights
        </span>
      </motion.header>

      {/* 2. 2열 비교 카드 + 중앙 화살표 */}
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-stretch">
        <SideCard label={beforeLabel} tone="before" cond={before} darkMode={darkMode} />
        <motion.div
          variants={itemVariants}
          className="flex items-center justify-center"
          aria-hidden
        >
          <div
            className={[
              "flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full",
              "bg-gradient-to-br from-indigo-500 to-emerald-500 text-white",
              "shadow-lg shadow-emerald-500/40 ring-4 ring-white dark:ring-slate-950",
            ].join(" ")}
          >
            <ArrowRight className="h-6 w-6 md:h-7 md:w-7" />
          </div>
        </motion.div>
        <SideCard label={afterLabel} tone="after" cond={after} darkMode={darkMode} />
      </div>

      {/* 3. 변화 매트릭스 */}
      <motion.div variants={itemVariants} className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <ChevronsUp className="h-4 w-4 text-indigo-500" />
            변화 매트릭스
          </h3>
        </div>
        <div className="overflow-x-auto">
          <motion.table
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="w-full text-sm"
          >
            <thead>
              <tr className="bg-slate-50/50 dark:bg-slate-900/40 text-[10px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                <th className="py-2 pl-4 pr-3 text-left font-semibold">항목</th>
                <th className="py-2 px-2 text-right font-semibold">Before</th>
                <th className="py-2 px-2 text-right font-semibold">After</th>
                <th className="py-2 px-2 text-right font-semibold">Δ</th>
                <th className="py-2 pl-2 pr-4 text-center font-semibold">판정</th>
              </tr>
            </thead>
            <tbody className="px-4">
              {METRIC_ROWS.map((row) => {
                const b = before[row.key] as number
                const a = after[row.key] as number
                return <DeltaRow key={row.key} row={row} beforeVal={b} afterVal={a} />
              })}
            </tbody>
          </motion.table>
        </div>
      </motion.div>

      {/* 4. 핵심 KPI 3개 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <KpiHighlight
          label="MRR 증가율"
          accent="emerald"
          icon={<TrendingUp className="h-4 w-4" />}
          sub="금속제거율 개선 = 가공 시간 단축"
        >
          {mrrPct >= 0 ? "+" : ""}
          <AnimatedNumber value={mrrPct} decimals={1} flash={false} suffix="%" />
        </KpiHighlight>

        <KpiHighlight
          label="공구 수명 변화"
          accent="violet"
          icon={<Clock className="h-4 w-4" />}
          sub={`${before.toolLifeMin.toLocaleString("ko-KR")} → ${after.toolLifeMin.toLocaleString("ko-KR")} min`}
        >
          {toolLifeDelta >= 0 ? "+" : ""}
          <AnimatedNumber value={toolLifeDelta} decimals={0} flash={false} suffix=" min" />
        </KpiHighlight>

        <KpiHighlight
          label="개당 원가 절감"
          accent="amber"
          icon={<Wallet className="h-4 w-4" />}
          sub={
            hasCost
              ? `${krwFormat(costBefore as number)} → ${krwFormat(costAfter as number)}`
              : "costPerPart 미제공"
          }
        >
          {hasCost ? (
            <>
              {costSavePerPart >= 0 ? "-" : "+"}
              <AnimatedNumber
                value={Math.abs(costSavePerPart)}
                decimals={0}
                flash={false}
                prefix="₩"
              />
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 text-xl">—</span>
          )}
        </KpiHighlight>
      </div>

      {/* 5. 월 임팩트 배너 */}
      {hasCost && costSavePerPart > 0 && (
        <motion.div
          variants={itemVariants}
          className={[
            "relative overflow-hidden rounded-2xl border-2 p-5 md:p-6",
            "border-emerald-400/70 dark:border-emerald-400/50",
            "bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-100 dark:from-emerald-950/60 dark:via-teal-950/40 dark:to-emerald-900/60",
            "shadow-lg shadow-emerald-500/20",
          ].join(" ")}
        >
          <div
            className="absolute inset-0 opacity-30 pointer-events-none"
            style={{
              background:
                "radial-gradient(600px 120px at 85% 50%, rgba(16,185,129,0.25), transparent 60%)",
            }}
            aria-hidden
          />
          <div className="relative flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/40">
                <Wallet className="h-6 w-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-300">
                  월간 예상 절감 (1,000개 기준)
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">
                  이 조건으로 바꾸면 한 달 예상 절감액
                </div>
              </div>
            </div>
            <div className="text-3xl md:text-4xl font-black tabular-nums text-emerald-700 dark:text-emerald-300">
              <AnimatedNumber
                value={monthlySaving}
                decimals={0}
                flash={false}
                prefix="₩"
              />
            </div>
          </div>
        </motion.div>
      )}

      {/* 6. AI 추천 이유 */}
      {reasoning && reasoning.trim() !== "" && (
        <motion.div
          variants={itemVariants}
          className={[
            "rounded-2xl border p-4 md:p-5",
            "border-violet-300/70 dark:border-violet-700/60",
            "bg-gradient-to-br from-violet-50 via-indigo-50 to-fuchsia-50",
            "dark:from-violet-950/50 dark:via-indigo-950/40 dark:to-fuchsia-950/50",
          ].join(" ")}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500 text-white shadow">
              <BookOpenCheck className="h-4 w-4" />
              <span className="sr-only">📘</span>
            </div>
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-700 dark:text-violet-300">
                AI 추천 이유
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line">
                {reasoning}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* 7. 액션 버튼 */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1"
      >
        <button
          type="button"
          onClick={onApply}
          disabled={!onApply}
          className={[
            "group inline-flex items-center justify-center gap-2",
            "rounded-xl px-5 py-3 md:py-3.5 font-bold text-sm md:text-base",
            "bg-gradient-to-r from-emerald-500 to-teal-500 text-white",
            "shadow-lg shadow-emerald-500/30",
            "hover:shadow-xl hover:shadow-emerald-500/40",
            "active:scale-[0.98] transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
            "flex-1",
          ].join(" ")}
          aria-label="AI 최적화 조건 적용"
        >
          <Check className="h-5 w-5" />
          <span>이 조건 적용</span>
        </button>
        <button
          type="button"
          onClick={onRevert}
          disabled={!onRevert}
          className={[
            "inline-flex items-center justify-center gap-2",
            "rounded-xl px-5 py-3 md:py-3.5 font-semibold text-sm md:text-base",
            "border-2",
            darkMode
              ? "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            "active:scale-[0.98] transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          ].join(" ")}
          aria-label="원래 조건으로 되돌리기"
        >
          <Undo2 className="h-4 w-4" />
          <span>되돌리기</span>
          <RotateCcw className="h-3.5 w-3.5 opacity-60" />
        </button>
      </motion.div>
    </motion.section>
  )
}

export default BeforeAfterCompare
