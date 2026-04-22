// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Beginner Lesson Cards (오늘의 팁 / 초보자 레슨)
// - 초보 모드 상단에 표시하는 교육용 카드. 15개 레슨을 자동 회전.
// - localStorage "yg1-sim-v3-lesson-index"로 마지막 본 index 기억 (다음 방문 시 다음 레슨부터).
// - rotateInterval(ms)마다 자동 다음 / hover 시 일시정지.
// - framer-motion AnimatePresence로 좌→우 슬라이드 트랜지션.
// - darkMode 완전 지원.
"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────
export type LessonColor =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "indigo"
  | "cyan"

export interface Lesson {
  id: string
  icon: string
  title: string
  body: string
  example?: string
  tip?: string
  color: LessonColor
}

export interface BeginnerLessonCardsProps {
  darkMode?: boolean
  rotateInterval?: number
  onClose?: () => void
}

// ── Constants ─────────────────────────────────────────────────────────
const LESSON_INDEX_KEY = "yg1-sim-v3-lesson-index"
const DEFAULT_ROTATE_MS = 8000

export const LESSONS: Lesson[] = [
  {
    id: "vc-basic",
    icon: "🎯",
    title: "Vc가 뭐에요?",
    body:
      "절삭 속도(Vc)란 공구 끝이 소재를 스치고 지나가는 속도예요. 단위는 m/min. 빠르면 많이 깎지만 공구가 빨리 닳아요.",
    example: "스테인리스는 Vc 120 m/min 정도가 안전",
    tip: "💡 처음엔 표준값에서 시작하고 10%씩 조정해보세요.",
    color: "sky",
  },
  {
    id: "fz-basic",
    icon: "⚡",
    title: "fz는요?",
    body:
      "날 하나가 한 바퀴 돌면서 얼마나 깊이 먹는지를 뜻해요. 보통 0.05mm 정도가 평균. 너무 작으면 공구가 소재를 \"긁기만\"해서 오히려 빨리 닳아요.",
    tip: "⚠ fz가 너무 작으면 rubbing(긁힘) 발생 — 공구 수명 급감.",
    color: "amber",
  },
  {
    id: "ap-ae",
    icon: "📐",
    title: "ap vs ae 차이",
    body:
      "ap는 깊이(아래로 얼마나 내려가는지), ae는 폭(옆으로 얼마나 먹는지)이에요. 공구 지름의 50% 이하 ae를 쓰면 \"chip thinning\" 현상이 발생해요.",
    example: "D10 공구라면 ae 5mm 이상이 chip thinning 회피 기준",
    color: "emerald",
  },
  {
    id: "climb-milling",
    icon: "🔧",
    title: "Climb 밀링이 왜 좋아요?",
    body:
      "공구 회전방향과 이송방향이 같은 방식이에요. 공구가 두꺼운 쪽에서 얇은 쪽으로 깎아 표면거칠기 -20%, 수명 +15%.",
    tip: "💡 강성이 낮은 기계에서는 백래시 주의 — 최신 CNC는 대부분 OK.",
    color: "indigo",
  },
  {
    id: "inconel-hard",
    icon: "🌡",
    title: "내열합금(Inconel)이 어려운 이유",
    body:
      "열이 칩으로 빠져나가지 않고 공구 끝에 고여서 공구가 녹아버려요. 그래서 Vc를 낮춰야 해요.",
    example: "Inconel 718은 Vc 45 m/min 이하 권장",
    tip: "⚠ 쿨런트 충분히, 공구는 AlCrN 코팅 추천.",
    color: "rose",
  },
  {
    id: "coating-basic",
    icon: "💎",
    title: "코팅이 뭐에요?",
    body:
      "공구 표면에 AlTiN / AlCrN 같은 얇은 세라믹 층을 입힌 거예요. 열·마찰을 줄여서 수명이 1.3~1.5배 늘어나요.",
    tip: "💡 알루미늄엔 오히려 코팅 없는 공구(uncoated)가 더 나을 때도 있어요 — 코팅 표면이 AL과 마찰 유발.",
    color: "violet",
  },
  {
    id: "chip-thinning",
    icon: "🎲",
    title: "Chip thinning",
    body:
      "ae가 좁으면 실제로 공구가 씹는 두께가 fz보다 작아져요 → rubbing → 공구 수명 급감. ae/D ≥ 0.5 가 권장 구간.",
    example: "D10 공구라면 ae 5mm 이상 유지",
    color: "cyan",
  },
  {
    id: "stickout",
    icon: "📏",
    title: "Stick-out 주의",
    body:
      "공구가 척에서 튀어나온 길이 / 공구 지름 > 5 이면 편향(deflection)이 급격히 증가해요. 가능한 짧게 물리세요.",
    tip: "⚠ L/D 비율 낮추는 것만으로 채터가 사라지는 경우 많음.",
    color: "amber",
  },
  {
    id: "chatter",
    icon: "🔺",
    title: "Chatter(채터) 원인",
    body:
      "공구가 파동처럼 떨리는 현상이에요. L/D가 높거나, 심한 절입, 느린 워크홀딩에서 발생해요. \"따르르르\" 소리가 나면 Vc를 바꿔보세요.",
    tip: "💡 Vc ±10% 조정 또는 ap 줄이기 → 대부분 해결.",
    color: "rose",
  },
  {
    id: "taylor",
    icon: "🛠",
    title: "공구 수명 Taylor 공식",
    body:
      "V × T^n = C. 속도를 10% 올리면 수명은 대략 40% 단축돼요. 빠르게 vs 오래 쓰기는 trade-off 관계.",
    example: "n=0.25인 초경 공구: Vc +10% → T ~ -34%",
    color: "indigo",
  },
  {
    id: "ra",
    icon: "🎨",
    title: "Ra (표면거칠기)",
    body:
      "깎은 면이 얼마나 울퉁불퉁한지를 μm 단위로 나타낸 값이에요. 마감은 0.8~1.6μm, 황삭은 6.3~12.5μm가 일반적이에요.",
    color: "emerald",
  },
  {
    id: "mrr",
    icon: "💰",
    title: "MRR이 왜 중요?",
    body:
      "Material Removal Rate — 분당 얼마나 많이 깎아내는지예요. 생산성의 핵심 척도. 단 MRR을 높이면 Pc(절삭력)도 올라서 공구 파손 위험이 커져요.",
    tip: "💡 MRR 극대화 ≠ 수익 극대화. 공구비 + 사이클타임 종합 판단.",
    color: "sky",
  },
  {
    id: "why-yg1",
    icon: "🇰🇷",
    title: "왜 YG-1?",
    body:
      "한국 제조 환경에 최적화된 카탈로그 + 가격 경쟁력이 있어요. 초경 + 코팅 기술은 유럽·미국 제품과 동등한 수준.",
    tip: "💡 납기 우위 + 기술영업 응대 속도도 강점.",
    color: "violet",
  },
  {
    id: "practice",
    icon: "🎓",
    title: "연습 팁",
    body:
      "새 공구를 만나면 먼저 예시 조건으로 시작하세요. 값을 바꿀 때는 한 번에 하나씩만. 안정되면 10%씩 단계적으로 조정해요.",
    tip: "💡 모든 변수를 동시에 바꾸면 무엇이 효과가 있었는지 알 수 없어요.",
    color: "cyan",
  },
  {
    id: "forbidden",
    icon: "🚨",
    title: "절대 금물",
    body:
      "ae > 공구지름(D), 또는 ap > 2×D 는 공구 즉시 파손이에요. 또한 ap < 날수 × 실 chip 두께면 rubbing이 발생해요.",
    tip: "⚠ 시뮬레이터의 빨간색 경고가 뜨면 진짜로 위험합니다.",
    color: "rose",
  },
]

// ── Color token mapping ───────────────────────────────────────────────
interface ColorTokens {
  bg: string
  bgDark: string
  border: string
  borderDark: string
  text: string
  textDark: string
  accent: string
  accentDark: string
  chipBg: string
  chipBgDark: string
}

const COLOR_MAP: Record<LessonColor, ColorTokens> = {
  sky: {
    bg: "bg-sky-50",
    bgDark: "bg-sky-950/30",
    border: "border-sky-200",
    borderDark: "border-sky-800",
    text: "text-sky-900",
    textDark: "text-sky-100",
    accent: "text-sky-700",
    accentDark: "text-sky-300",
    chipBg: "bg-sky-100",
    chipBgDark: "bg-sky-900/40",
  },
  emerald: {
    bg: "bg-emerald-50",
    bgDark: "bg-emerald-950/30",
    border: "border-emerald-200",
    borderDark: "border-emerald-800",
    text: "text-emerald-900",
    textDark: "text-emerald-100",
    accent: "text-emerald-700",
    accentDark: "text-emerald-300",
    chipBg: "bg-emerald-100",
    chipBgDark: "bg-emerald-900/40",
  },
  amber: {
    bg: "bg-amber-50",
    bgDark: "bg-amber-950/30",
    border: "border-amber-200",
    borderDark: "border-amber-800",
    text: "text-amber-900",
    textDark: "text-amber-100",
    accent: "text-amber-700",
    accentDark: "text-amber-300",
    chipBg: "bg-amber-100",
    chipBgDark: "bg-amber-900/40",
  },
  rose: {
    bg: "bg-rose-50",
    bgDark: "bg-rose-950/30",
    border: "border-rose-200",
    borderDark: "border-rose-800",
    text: "text-rose-900",
    textDark: "text-rose-100",
    accent: "text-rose-700",
    accentDark: "text-rose-300",
    chipBg: "bg-rose-100",
    chipBgDark: "bg-rose-900/40",
  },
  violet: {
    bg: "bg-violet-50",
    bgDark: "bg-violet-950/30",
    border: "border-violet-200",
    borderDark: "border-violet-800",
    text: "text-violet-900",
    textDark: "text-violet-100",
    accent: "text-violet-700",
    accentDark: "text-violet-300",
    chipBg: "bg-violet-100",
    chipBgDark: "bg-violet-900/40",
  },
  indigo: {
    bg: "bg-indigo-50",
    bgDark: "bg-indigo-950/30",
    border: "border-indigo-200",
    borderDark: "border-indigo-800",
    text: "text-indigo-900",
    textDark: "text-indigo-100",
    accent: "text-indigo-700",
    accentDark: "text-indigo-300",
    chipBg: "bg-indigo-100",
    chipBgDark: "bg-indigo-900/40",
  },
  cyan: {
    bg: "bg-cyan-50",
    bgDark: "bg-cyan-950/30",
    border: "border-cyan-200",
    borderDark: "border-cyan-800",
    text: "text-cyan-900",
    textDark: "text-cyan-100",
    accent: "text-cyan-700",
    accentDark: "text-cyan-300",
    chipBg: "bg-cyan-100",
    chipBgDark: "bg-cyan-900/40",
  },
}

function resolveColor(color: LessonColor): ColorTokens {
  return COLOR_MAP[color] ?? COLOR_MAP.sky
}

// ── localStorage helpers ──────────────────────────────────────────────
function readStoredIndex(): number {
  if (typeof window === "undefined") return -1
  try {
    const raw = window.localStorage.getItem(LESSON_INDEX_KEY)
    if (raw == null) return -1
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return -1
    return n
  } catch {
    return -1
  }
}

function writeStoredIndex(idx: number): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LESSON_INDEX_KEY, String(idx))
  } catch {
    // ignore (private mode / SSR)
  }
}

// ── Component ─────────────────────────────────────────────────────────
export function BeginnerLessonCards({
  darkMode = false,
  rotateInterval = DEFAULT_ROTATE_MS,
  onClose,
}: BeginnerLessonCardsProps) {
  const [index, setIndex] = useState<number>(0)
  const [playing, setPlaying] = useState<boolean>(true)
  const [hovering, setHovering] = useState<boolean>(false)
  const [visible, setVisible] = useState<boolean>(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = LESSONS.length
  const lesson = useMemo(() => LESSONS[index] ?? LESSONS[0], [index])
  const c = resolveColor(lesson.color)

  useEffect(() => {
    const last = readStoredIndex()
    if (last < 0) return
    setIndex((last + 1) % LESSONS.length)
  }, [])

  // index 바뀔 때마다 localStorage 갱신
  useEffect(() => {
    writeStoredIndex(index)
  }, [index])

  // 자동 회전
  useEffect(() => {
    if (!visible) return
    if (!playing || hovering) return
    if (rotateInterval <= 0) return
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % total)
    }, rotateInterval)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [index, playing, hovering, rotateInterval, total, visible])

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + total) % total)
  }, [total])

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % total)
  }, [total])

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p)
  }, [])

  const handleClose = useCallback(() => {
    setVisible(false)
    onClose?.()
  }, [onClose])

  if (!visible) return null

  const bgCls = darkMode ? c.bgDark : c.bg
  const borderCls = darkMode ? c.borderDark : c.border
  const accentCls = darkMode ? c.accentDark : c.accent
  const bodyCls = darkMode ? "text-slate-200" : "text-slate-800"
  const chipBgCls = darkMode ? c.chipBgDark : c.chipBg
  const subtleCls = darkMode ? "text-slate-400" : "text-slate-600"
  const exampleBoxCls = darkMode
    ? "bg-slate-900/60 border-slate-700 text-slate-200"
    : "bg-white/70 border-slate-200 text-slate-800"
  const tipBoxCls = darkMode
    ? "bg-slate-900/60 border-slate-700 text-slate-100"
    : "bg-white/80 border-slate-200 text-slate-900"
  const navBtnCls = darkMode
    ? "hover:bg-slate-800 text-slate-300 hover:text-white"
    : "hover:bg-white/80 text-slate-600 hover:text-slate-900"

  return (
    <section
      aria-label="오늘의 팁 · 초보자 레슨"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`relative rounded-xl border p-4 overflow-hidden transition-colors ${bgCls} ${borderCls}`}
    >
      {/* 상단: 제목 줄 + 진행 dots */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className={`text-[11px] font-semibold uppercase tracking-wider ${accentCls}`}>
          오늘의 팁 · 초보자 레슨
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded ${chipBgCls} ${accentCls}`}
            aria-live="polite"
          >
            {index + 1}/{total}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="레슨 카드 닫기"
            className={`p-1 rounded transition-colors ${navBtnCls}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 본문 + 좌측 큰 아이콘 */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={lesson.id}
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -20, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="flex items-start gap-4"
        >
          <div
            className="text-4xl leading-none shrink-0 select-none"
            aria-hidden="true"
          >
            {lesson.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`text-base font-bold leading-snug ${accentCls}`}>
              {lesson.title}
            </h3>
            <p className={`mt-1.5 text-sm leading-relaxed ${bodyCls}`}>
              {lesson.body}
            </p>

            {lesson.example && (
              <div
                className={`mt-2.5 text-xs rounded-lg border px-3 py-2 ${exampleBoxCls}`}
              >
                <span className={`font-semibold mr-1 ${accentCls}`}>예시</span>
                <span className="font-mono">{lesson.example}</span>
              </div>
            )}

            {lesson.tip && (
              <div
                className={`mt-2 text-xs rounded-lg border px-3 py-2 ${tipBoxCls}`}
              >
                {lesson.tip}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* 진행 dots (하단 상세) */}
      <div
        className="mt-3 flex items-center justify-center gap-1"
        role="tablist"
        aria-label="레슨 진행 상태"
      >
        {LESSONS.map((l, i) => {
          const active = i === index
          return (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${i + 1}/${total}: ${l.title}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                active
                  ? `w-6 ${darkMode ? "bg-slate-200" : "bg-slate-700"}`
                  : `w-1.5 ${darkMode ? "bg-slate-700 hover:bg-slate-500" : "bg-slate-300 hover:bg-slate-400"}`
              }`}
            />
          )
        })}
      </div>

      {/* 하단 네비 */}
      <div className="mt-3 flex items-center justify-between">
        <div className={`text-[11px] ${subtleCls}`}>
          {hovering ? "일시정지됨 (마우스 벗어나면 재개)" : playing ? "자동 재생 중" : "일시정지됨"}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrev}
            aria-label="이전 레슨"
            className={`p-1.5 rounded transition-colors ${navBtnCls}`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "자동 재생 일시정지" : "자동 재생 시작"}
            aria-pressed={playing}
            className={`p-1.5 rounded transition-colors ${navBtnCls}`}
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="다음 레슨"
            className={`p-1.5 rounded transition-colors ${navBtnCls}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  )
}

export default BeginnerLessonCards
