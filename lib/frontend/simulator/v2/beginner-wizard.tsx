// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Beginner Wizard (5단계 질문형)
// - "가공을 하나도 모르는 사람" 을 위한 대화형 5-step 플로우
// - STEP 1 소재 / STEP 2 가공방식 / STEP 3 공구지름 / STEP 4 우선순위 / STEP 5 확인&적용
// - AnimatePresence slide transition / progress indicator / darkMode 완전 지원
// - cutting-simulator-v2.tsx 는 수정하지 않음 (상위에서 props 로 연결)
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────
export interface BeginnerWizardPreset {
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  activeShape: string
}

export interface BeginnerWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApply: (preset: BeginnerWizardPreset) => void
  darkMode?: boolean
}

type MaterialKey = "P" | "M" | "K" | "N" | "S" | "H"
type OperationKey = "side-milling" | "slotting" | "finishing" | "roughing"
type PriorityKey = "speed" | "life" | "quality"

interface MaterialOption {
  key: MaterialKey
  emoji: string
  title: string
  description: string
  examples: string
  gradient: string
}

interface OperationOption {
  key: OperationKey
  emoji: string
  title: string
  description: string
  hint: string
  gradient: string
}

interface PriorityOption {
  key: PriorityKey
  emoji: string
  title: string
  description: string
  hint: string
  gradient: string
}

// ── Constants ─────────────────────────────────────────────────────────
const MATERIALS: MaterialOption[] = [
  {
    key: "P",
    emoji: "⚙️",
    title: "탄소강",
    description: "일반 철 / 기계 부품",
    examples: "예시: S45C, SCM440, SM45C",
    gradient: "from-blue-400 to-sky-500",
  },
  {
    key: "M",
    emoji: "✨",
    title: "스테인리스",
    description: "SUS304/316 등 녹 방지",
    examples: "예시: SUS304, SUS316L, 17-4PH",
    gradient: "from-emerald-400 to-teal-500",
  },
  {
    key: "K",
    emoji: "🧱",
    title: "주철",
    description: "GC/FCD 등 무거운 부품",
    examples: "예시: GC250, FCD450, FC300",
    gradient: "from-stone-400 to-slate-500",
  },
  {
    key: "N",
    emoji: "🪙",
    title: "비철",
    description: "알루미늄/구리/황동",
    examples: "예시: Al6061, Al7075, C3604",
    gradient: "from-amber-400 to-yellow-500",
  },
  {
    key: "S",
    emoji: "🚀",
    title: "내열합금",
    description: "Inconel/Ti 등 어려움",
    examples: "예시: Inconel 718, Ti-6Al-4V",
    gradient: "from-rose-500 to-red-600",
  },
  {
    key: "H",
    emoji: "💎",
    title: "고경도강",
    description: "HRC 45+ 경화 금형",
    examples: "예시: SKD11 (HRC52), STAVAX",
    gradient: "from-violet-500 to-purple-600",
  },
]

const OPERATIONS: OperationOption[] = [
  {
    key: "side-milling",
    emoji: "📏",
    title: "측면 가공",
    description: "옆면 깎기",
    hint: "벽이나 둘레를 다듬을 때",
    gradient: "from-sky-400 to-blue-500",
  },
  {
    key: "slotting",
    emoji: "⬇️",
    title: "슬로팅",
    description: "홈 파기",
    hint: "공구 전체 지름으로 파고들 때",
    gradient: "from-indigo-400 to-violet-500",
  },
  {
    key: "finishing",
    emoji: "🎯",
    title: "정삭",
    description: "깔끔하게 마감",
    hint: "치수·면조도 우선, 얇게",
    gradient: "from-emerald-400 to-green-500",
  },
  {
    key: "roughing",
    emoji: "🚀",
    title: "황삭",
    description: "빠르게 많이",
    hint: "재료를 많이 제거할 때",
    gradient: "from-orange-400 to-rose-500",
  },
]

const PRIORITIES: PriorityOption[] = [
  {
    key: "speed",
    emoji: "⚡",
    title: "속도",
    description: "생산성 우선",
    hint: "Vc ↑ · fz ↑ · 공구 조금 아껴요",
    gradient: "from-amber-400 to-orange-500",
  },
  {
    key: "life",
    emoji: "🛡️",
    title: "수명",
    description: "공구 오래 쓰기",
    hint: "Vc ↓ · fz ↓ · 가장 안전한 선택",
    gradient: "from-sky-400 to-indigo-500",
  },
  {
    key: "quality",
    emoji: "🎯",
    title: "품질",
    description: "표면조도 우선",
    hint: "fz ↓ · 정삭 스타일 · 매끄럽게",
    gradient: "from-emerald-400 to-teal-500",
  },
]

const DIAMETER_PRESETS: number[] = [3, 6, 10, 12, 16]
const DIAMETER_MIN = 3
const DIAMETER_MAX = 20
const DIAMETER_STEP = 0.5

const STEP_GRADIENTS: string[] = [
  "from-emerald-400 via-green-500 to-teal-500", // STEP 1 소재
  "from-sky-400 via-blue-500 to-indigo-500", // STEP 2 가공방식
  "from-violet-400 via-purple-500 to-fuchsia-500", // STEP 3 지름
  "from-amber-400 via-orange-500 to-rose-500", // STEP 4 우선순위
  "from-emerald-400 via-sky-500 to-violet-500", // STEP 5 확인
]

const STEP_TITLES: string[] = [
  "소재 선택",
  "가공 방식",
  "공구 지름",
  "우선순위",
  "최종 확인",
]

// ── Param derivation ──────────────────────────────────────────────────
export function deriveParams(
  material: MaterialKey,
  operation: OperationKey,
  diameter: number,
  priority: PriorityKey,
): BeginnerWizardPreset {
  const baseVc: Record<MaterialKey, number> = {
    P: 180,
    M: 120,
    K: 200,
    N: 500,
    S: 45,
    H: 80,
  }
  const baseFz: Record<MaterialKey, number> = {
    P: 0.06,
    M: 0.04,
    K: 0.08,
    N: 0.08,
    S: 0.02,
    H: 0.025,
  }

  let vc = baseVc[material]
  let fz = baseFz[material]

  if (priority === "speed") {
    vc *= 1.15
    fz *= 1.2
  } else if (priority === "life") {
    vc *= 0.85
    fz *= 0.9
  } else if (priority === "quality") {
    fz *= 0.7
  }

  let ap = diameter * 0.8
  let ae = diameter * 0.3
  if (operation === "slotting") {
    ae = diameter * 1.0
  } else if (operation === "finishing") {
    ap = 0.3
    ae = diameter * 0.2
  } else if (operation === "roughing") {
    ap = diameter * 1.5
    ae = diameter * 0.4
  }

  const subgroup: Record<MaterialKey, string> = {
    P: "low-carbon-steel",
    M: "austenitic-ss",
    K: "gray-iron",
    N: "aluminum-wrought",
    S: "inconel",
    H: "hardened-50hrc",
  }

  const coating: Record<MaterialKey, string> = {
    P: "altin",
    M: "altin",
    K: "altin",
    N: "uncoated",
    S: "aicrn",
    H: "aicrn",
  }

  return {
    isoGroup: material,
    subgroupKey: subgroup[material],
    operation,
    coating: coating[material],
    Vc: Math.round(vc),
    fz: parseFloat(fz.toFixed(3)),
    ap: parseFloat(ap.toFixed(1)),
    ae: parseFloat(ae.toFixed(1)),
    diameter: parseFloat(diameter.toFixed(1)),
    fluteCount: 4,
    activeShape: "square",
  }
}

// ── Friendly explanation ──────────────────────────────────────────────
function reasonFor(material: MaterialKey, priority: PriorityKey): string {
  const matReason: Record<MaterialKey, string> = {
    P: "탄소강은 Vc 180 전후가 안정적이에요",
    M: "스테인리스는 Vc 120 이 안전해요 (열 축적 주의)",
    K: "주철은 열 전달이 좋아 Vc 200 까지 올려도 괜찮아요",
    N: "알루미늄은 Vc 500 이상 고속이 기본이에요",
    S: "인코넬/티타늄은 Vc 45 로 보수적으로 가야 해요",
    H: "고경도강은 Vc 80 근방, AlCrN 코팅 필수에요",
  }
  const prioReason: Record<PriorityKey, string> = {
    speed: "속도 우선이라 Vc·fz 를 15~20% 올렸어요",
    life: "수명 우선이라 Vc·fz 를 10~15% 낮췄어요",
    quality: "품질 우선이라 fz 를 30% 낮춰 면조도를 개선했어요",
  }
  return `${matReason[material]} · ${prioReason[priority]}`
}

// ── Component ─────────────────────────────────────────────────────────
export function BeginnerWizard({
  open,
  onOpenChange,
  onApply,
  darkMode = false,
}: BeginnerWizardProps) {
  const [step, setStep] = useState<number>(1)
  const [material, setMaterial] = useState<MaterialKey | null>(null)
  const [operation, setOperation] = useState<OperationKey | null>(null)
  const [diameter, setDiameter] = useState<number>(10)
  const [priority, setPriority] = useState<PriorityKey | null>(null)
  const [hoveredMaterial, setHoveredMaterial] = useState<MaterialKey | null>(
    null,
  )

  // 닫힐 때 상태 리셋
  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => {
        setStep(1)
        setMaterial(null)
        setOperation(null)
        setDiameter(10)
        setPriority(null)
        setHoveredMaterial(null)
      }, 200)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // ESC 로 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, onOpenChange])

  const preview = useMemo<BeginnerWizardPreset | null>(() => {
    if (!material || !operation || !priority) return null
    return deriveParams(material, operation, diameter, priority)
  }, [material, operation, diameter, priority])

  const canNext = useMemo(() => {
    if (step === 1) return material !== null
    if (step === 2) return operation !== null
    if (step === 3) return diameter >= DIAMETER_MIN && diameter <= DIAMETER_MAX
    if (step === 4) return priority !== null
    return true
  }, [step, material, operation, diameter, priority])

  const handleNext = useCallback(() => {
    if (step < 5 && canNext) setStep(step + 1)
  }, [step, canNext])

  const handlePrev = useCallback(() => {
    if (step > 1) setStep(step - 1)
  }, [step])

  const handleReset = useCallback(() => {
    setStep(1)
    setMaterial(null)
    setOperation(null)
    setDiameter(10)
    setPriority(null)
  }, [])

  const handleApply = useCallback(() => {
    if (!preview) return
    onApply(preview)
    onOpenChange(false)
  }, [preview, onApply, onOpenChange])

  if (!open) return null

  const cardBgCls = darkMode
    ? "bg-slate-900 text-slate-100 ring-1 ring-slate-700"
    : "bg-white text-slate-900 ring-1 ring-slate-200"

  const currentGradient = STEP_GRADIENTS[step - 1] ?? STEP_GRADIENTS[0]

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="yg1-beginner-wizard-title"
      className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur flex items-center justify-center p-4"
    >
      {/* backdrop click */}
      <div
        className="absolute inset-0"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* card */}
      <div
        className={`relative max-w-2xl w-full max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl ${cardBgCls}`}
      >
        {/* 그라디언트 헤더 */}
        <div
          className={`relative px-6 py-5 text-white bg-gradient-to-r ${currentGradient} transition-colors duration-500`}
        >
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="초보자 위저드 닫기"
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-start gap-3 pr-8">
            <Sparkles className="w-6 h-6 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2
                id="yg1-beginner-wizard-title"
                className="text-lg md:text-xl font-bold leading-snug"
              >
                🌱 초보자 위저드 — 5단계만 답하면 완성!
              </h2>
              <p className="mt-1 text-sm text-white/90">
                STEP {step}/5 · {STEP_TITLES[step - 1]}
              </p>
            </div>
          </div>

          {/* 진행 표시줄 */}
          <div
            className="mt-4 flex items-center gap-1.5"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemin={1}
            aria-valuemax={5}
            aria-label={`진행 단계 ${step} / 5`}
          >
            {[1, 2, 3, 4, 5].map((n) => {
              const isDone = n < step
              const isCurrent = n === step
              const base = "h-1.5 flex-1 rounded-full transition-all duration-300"
              if (isDone) return <div key={n} className={`${base} bg-emerald-300`} />
              if (isCurrent)
                return (
                  <div
                    key={n}
                    className={`${base} bg-white/90 animate-pulse`}
                  />
                )
              return (
                <div
                  key={n}
                  className={`${base} ${darkMode ? "bg-white/20" : "bg-white/30"}`}
                />
              )
            })}
          </div>
        </div>

        {/* 본문 */}
        <div className="px-4 sm:px-6 py-5 min-h-[360px] relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -40, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {step === 1 && (
                <StepMaterial
                  darkMode={darkMode}
                  selected={material}
                  onSelect={(k) => setMaterial(k)}
                  hovered={hoveredMaterial}
                  onHover={setHoveredMaterial}
                />
              )}
              {step === 2 && (
                <StepOperation
                  darkMode={darkMode}
                  selected={operation}
                  onSelect={(k) => setOperation(k)}
                />
              )}
              {step === 3 && (
                <StepDiameter
                  darkMode={darkMode}
                  value={diameter}
                  onChange={setDiameter}
                />
              )}
              {step === 4 && (
                <StepPriority
                  darkMode={darkMode}
                  selected={priority}
                  onSelect={(k) => setPriority(k)}
                />
              )}
              {step === 5 && preview && material && operation && priority && (
                <StepConfirm
                  darkMode={darkMode}
                  preview={preview}
                  material={material}
                  operation={operation}
                  priority={priority}
                  reason={reasonFor(material, priority)}
                />
              )}
              {step === 5 && !preview && (
                <div
                  className={`text-sm ${
                    darkMode ? "text-slate-400" : "text-slate-600"
                  }`}
                >
                  앞의 단계를 모두 선택해주세요.
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 하단 버튼 */}
        <div
          className={`px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 border-t ${
            darkMode
              ? "border-slate-700 bg-slate-900/60"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={step === 1}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                step === 1
                  ? darkMode
                    ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : darkMode
                    ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              이전 단계로
            </button>
            <button
              type="button"
              onClick={handleReset}
              className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                darkMode
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              처음부터
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                darkMode
                  ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}
            >
              건너뛰기
            </button>
            {step < 5 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canNext}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all ${
                  canNext
                    ? `bg-gradient-to-r ${currentGradient} hover:brightness-110 shadow-md`
                    : "bg-slate-400 cursor-not-allowed"
                }`}
              >
                다음 단계
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={!preview}
                className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-all shadow-lg ${
                  preview
                    ? "bg-gradient-to-r from-emerald-500 via-sky-500 to-violet-500 hover:brightness-110"
                    : "bg-slate-400 cursor-not-allowed"
                }`}
              >
                <Check className="w-4 h-4" />
                시뮬레이터에 적용
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── STEP 1 — Material ─────────────────────────────────────────────────
interface StepMaterialProps {
  darkMode: boolean
  selected: MaterialKey | null
  onSelect: (k: MaterialKey) => void
  hovered: MaterialKey | null
  onHover: (k: MaterialKey | null) => void
}

function StepMaterial({
  darkMode,
  selected,
  onSelect,
  hovered,
  onHover,
}: StepMaterialProps) {
  const focusKey = hovered ?? selected
  const focus = focusKey
    ? MATERIALS.find((m) => m.key === focusKey) ?? null
    : null

  return (
    <div>
      <h3
        className={`text-base md:text-lg font-bold mb-1 ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
      >
        어떤 소재를 가공하시나요? 🤔
      </h3>
      <p
        className={`text-sm mb-4 ${
          darkMode ? "text-slate-400" : "text-slate-600"
        }`}
      >
        ISO 분류 기준으로 고르시면 됩니다. 잘 모르시면 재질 이름으로 힌트를 드려요.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-stretch">
        {MATERIALS.map((m) => {
          const isSelected = selected === m.key
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onSelect(m.key)}
              onMouseEnter={() => onHover(m.key)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(m.key)}
              onBlur={() => onHover(null)}
              aria-pressed={isSelected}
              aria-label={`ISO ${m.key} ${m.title} 선택 — ${m.description}`}
              className={`group relative h-full text-left rounded-xl p-3 transition-all duration-200 focus:outline-none ${
                isSelected
                  ? `bg-gradient-to-br ${m.gradient} text-white shadow-lg ring-2 ring-white scale-[1.02]`
                  : darkMode
                    ? "bg-slate-800 ring-1 ring-slate-700 hover:ring-slate-500 hover:bg-slate-700/80"
                    : "bg-white ring-1 ring-slate-200 hover:ring-slate-400 hover:shadow-md"
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <div className="text-2xl leading-none flex-shrink-0" aria-hidden="true">
                  {m.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-bold ${
                      isSelected
                        ? "text-white"
                        : darkMode
                          ? "text-slate-100"
                          : "text-slate-900"
                    }`}
                  >
                    <span className="opacity-80 mr-1">ISO {m.key}</span>
                    {m.title}
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 break-words ${
                      isSelected
                        ? "text-white/90"
                        : darkMode
                          ? "text-slate-400"
                          : "text-slate-600"
                    }`}
                  >
                    {m.description}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* hover / selected 예시 미리보기 */}
      <div
        className={`mt-4 rounded-lg px-3 py-2 text-xs min-h-[36px] transition-colors ${
          focus
            ? darkMode
              ? "bg-slate-800 text-slate-200 ring-1 ring-slate-700"
              : "bg-slate-50 text-slate-700 ring-1 ring-slate-200"
            : darkMode
              ? "bg-slate-900/40 text-slate-500"
              : "bg-slate-50/40 text-slate-600"
        }`}
      >
        {focus ? (
          <>
            <span className="font-semibold mr-1">{focus.emoji} {focus.title}</span>
            <span className="opacity-80">— {focus.examples}</span>
          </>
        ) : (
          "마우스를 카드에 올려 예시 재질을 확인하실 수 있어요."
        )}
      </div>
    </div>
  )
}

// ── STEP 2 — Operation ────────────────────────────────────────────────
interface StepOperationProps {
  darkMode: boolean
  selected: OperationKey | null
  onSelect: (k: OperationKey) => void
}

function StepOperation({ darkMode, selected, onSelect }: StepOperationProps) {
  return (
    <div>
      <h3
        className={`text-base md:text-lg font-bold mb-1 ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
      >
        어떤 형태로 깎으시나요? ✂️
      </h3>
      <p
        className={`text-sm mb-4 ${
          darkMode ? "text-slate-400" : "text-slate-600"
        }`}
      >
        가공 목적에 따라 이송·절입량이 달라져요.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
        {OPERATIONS.map((o) => {
          const isSelected = selected === o.key
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => onSelect(o.key)}
              aria-pressed={isSelected}
              aria-label={`${o.title} 선택 — ${o.hint}`}
              className={`h-full text-left rounded-xl p-4 transition-all duration-200 focus:outline-none ${
                isSelected
                  ? `bg-gradient-to-br ${o.gradient} text-white shadow-lg ring-2 ring-white scale-[1.01]`
                  : darkMode
                    ? "bg-slate-800 ring-1 ring-slate-700 hover:ring-slate-500 hover:bg-slate-700/80"
                    : "bg-white ring-1 ring-slate-200 hover:ring-slate-400 hover:shadow-md"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-3xl leading-none flex-shrink-0" aria-hidden="true">
                  {o.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm font-bold ${
                      isSelected
                        ? "text-white"
                        : darkMode
                          ? "text-slate-100"
                          : "text-slate-900"
                    }`}
                  >
                    {o.title}{" "}
                    <span className="text-xs opacity-75 font-medium">
                      ({o.description})
                    </span>
                  </div>
                  <div
                    className={`text-xs mt-0.5 break-words ${
                      isSelected
                        ? "text-white/90"
                        : darkMode
                          ? "text-slate-400"
                          : "text-slate-600"
                    }`}
                  >
                    {o.hint}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── STEP 3 — Diameter ─────────────────────────────────────────────────
interface StepDiameterProps {
  darkMode: boolean
  value: number
  onChange: (v: number) => void
}

function StepDiameter({ darkMode, value, onChange }: StepDiameterProps) {
  // 프리뷰 SVG 원: 3~20 → 반지름 12~56 px
  const svgSize = 140
  const cx = svgSize / 2
  const cy = svgSize / 2
  const r = 12 + ((value - DIAMETER_MIN) / (DIAMETER_MAX - DIAMETER_MIN)) * 44

  return (
    <div>
      <h3
        className={`text-base md:text-lg font-bold mb-1 ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
      >
        공구 지름은 어떻게 되나요? 📐
      </h3>
      <p
        className={`text-sm mb-4 ${
          darkMode ? "text-slate-400" : "text-slate-600"
        }`}
      >
        지름이 클수록 MRR↑, 수명↑, 가격↑, 진동 조심 ⚠️
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 items-center">
        {/* 슬라이더 + 프리셋 */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div
              className={`text-xs ${
                darkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              {DIAMETER_MIN} mm
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  darkMode ? "text-violet-300" : "text-violet-600"
                }`}
              >
                {value.toFixed(1)}
              </span>
              <span
                className={`text-sm font-medium ${
                  darkMode ? "text-slate-400" : "text-slate-600"
                }`}
              >
                mm
              </span>
            </div>
            <div
              className={`text-xs ${
                darkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              {DIAMETER_MAX} mm
            </div>
          </div>

          <input
            type="range"
            min={DIAMETER_MIN}
            max={DIAMETER_MAX}
            step={DIAMETER_STEP}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            aria-label="공구 지름 (mm)"
            className={`w-full h-2 rounded-full appearance-none cursor-pointer ${
              darkMode ? "bg-slate-700" : "bg-slate-200"
            } accent-violet-500`}
          />

          <div className="mt-3 flex flex-wrap gap-1.5">
            {DIAMETER_PRESETS.map((d) => {
              const isActive = Math.abs(value - d) < 0.01
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChange(d)}
                  aria-pressed={isActive}
                  aria-label={`공구 지름 ${d} 밀리미터 선택`}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-violet-500 text-white shadow"
                      : darkMode
                        ? "bg-slate-800 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-700"
                        : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                  }`}
                >
                  {d} mm
                </button>
              )
            })}
          </div>
        </div>

        {/* 라이브 SVG 프리뷰 */}
        <div
          className={`rounded-xl p-2 flex items-center justify-center ${
            darkMode
              ? "bg-slate-800/60 ring-1 ring-slate-700"
              : "bg-slate-50 ring-1 ring-slate-200"
          }`}
        >
          <svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            aria-label={`공구 단면 프리뷰 (지름 ${value.toFixed(1)}mm)`}
          >
            <defs>
              <radialGradient id="toolGrad" cx="35%" cy="35%" r="70%">
                <stop offset="0%" stopColor="#c4b5fd" />
                <stop offset="100%" stopColor="#7c3aed" />
              </radialGradient>
            </defs>
            {/* 가이드 원 (최대 크기) */}
            <circle
              cx={cx}
              cy={cy}
              r={56}
              fill="none"
              stroke={darkMode ? "#334155" : "#cbd5e1"}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            {/* 실제 공구 단면 */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="url(#toolGrad)"
              stroke={darkMode ? "#1e1b4b" : "#ffffff"}
              strokeWidth={2}
            />
            {/* 중심점 */}
            <circle cx={cx} cy={cy} r={2} fill={darkMode ? "#fbbf24" : "#f59e0b"} />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ── STEP 4 — Priority ─────────────────────────────────────────────────
interface StepPriorityProps {
  darkMode: boolean
  selected: PriorityKey | null
  onSelect: (k: PriorityKey) => void
}

function StepPriority({ darkMode, selected, onSelect }: StepPriorityProps) {
  return (
    <div>
      <h3
        className={`text-base md:text-lg font-bold mb-1 ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
      >
        무엇이 가장 중요한가요? ⚖️
      </h3>
      <p
        className={`text-sm mb-4 ${
          darkMode ? "text-slate-400" : "text-slate-600"
        }`}
      >
        하나만 고르시면 돼요. 나머지는 자동으로 균형을 맞춰드려요.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
        {PRIORITIES.map((p) => {
          const isSelected = selected === p.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onSelect(p.key)}
              aria-pressed={isSelected}
              aria-label={`${p.title} 우선 — ${p.description}`}
              className={`flex h-full flex-col text-left rounded-xl p-4 transition-all duration-200 focus:outline-none ${
                isSelected
                  ? `bg-gradient-to-br ${p.gradient} text-white shadow-lg ring-2 ring-white scale-[1.02]`
                  : darkMode
                    ? "bg-slate-800 ring-1 ring-slate-700 hover:ring-slate-500 hover:bg-slate-700/80"
                    : "bg-white ring-1 ring-slate-200 hover:ring-slate-400 hover:shadow-md"
              }`}
            >
              <div className="text-3xl leading-none mb-2" aria-hidden="true">
                {p.emoji}
              </div>
              <div
                className={`truncate text-sm font-bold ${
                  isSelected
                    ? "text-white"
                    : darkMode
                      ? "text-slate-100"
                      : "text-slate-900"
                }`}
              >
                {p.title}
              </div>
              <div
                className={`text-xs mt-0.5 break-words ${
                  isSelected
                    ? "text-white/90"
                    : darkMode
                      ? "text-slate-400"
                      : "text-slate-600"
                }`}
              >
                {p.description}
              </div>
              <div
                className={`text-[11px] mt-2 font-mono break-words ${
                  isSelected
                    ? "text-white/80"
                    : darkMode
                      ? "text-slate-500"
                      : "text-slate-500"
                }`}
              >
                {p.hint}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── STEP 5 — Confirm ──────────────────────────────────────────────────
interface StepConfirmProps {
  darkMode: boolean
  preview: BeginnerWizardPreset
  material: MaterialKey
  operation: OperationKey
  priority: PriorityKey
  reason: string
}

function StepConfirm({
  darkMode,
  preview,
  material,
  operation,
  priority,
  reason,
}: StepConfirmProps) {
  const mat = MATERIALS.find((m) => m.key === material)
  const op = OPERATIONS.find((o) => o.key === operation)
  const prio = PRIORITIES.find((p) => p.key === priority)

  const rowBg = darkMode ? "bg-slate-800/70" : "bg-slate-50"
  const rowRing = darkMode ? "ring-1 ring-slate-700" : "ring-1 ring-slate-200"
  const labelCls = darkMode ? "text-slate-400" : "text-slate-500"
  const valueCls = darkMode ? "text-slate-100" : "text-slate-900"

  return (
    <div>
      <h3
        className={`text-base md:text-lg font-bold mb-1 ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
      >
        이렇게 세팅해드릴게요! ✨
      </h3>
      <p className={`text-sm mb-4 ${labelCls}`}>
        아래 조건이 시뮬레이터에 자동 입력됩니다.
      </p>

      {/* 선택 요약 */}
      <div className={`rounded-xl p-3 ${rowBg} ${rowRing} mb-3`}>
        <div className={`text-xs font-semibold mb-2 ${labelCls}`}>
          ✅ 선택 요약
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <SummaryItem
            darkMode={darkMode}
            label="소재"
            value={`${mat?.emoji} ${mat?.title}`}
          />
          <SummaryItem
            darkMode={darkMode}
            label="가공"
            value={`${op?.emoji} ${op?.title}`}
          />
          <SummaryItem
            darkMode={darkMode}
            label="지름"
            value={`📐 ${preview.diameter} mm`}
          />
          <SummaryItem
            darkMode={darkMode}
            label="우선순위"
            value={`${prio?.emoji} ${prio?.title}`}
          />
        </div>
      </div>

      {/* 권장 조건 미리보기 */}
      <div className={`rounded-xl p-3 ${rowBg} ${rowRing} mb-3`}>
        <div className={`text-xs font-semibold mb-2 ${labelCls}`}>
          🔧 권장 가공 조건
        </div>
        <div className={`text-sm ${valueCls} mb-2`}>
          재질:{" "}
          <span className="font-semibold">
            ISO {preview.isoGroup}
          </span>
          <span className={`mx-1 ${labelCls}`}>·</span>
          <span className="font-mono text-xs">{preview.subgroupKey}</span>
          <span className={`mx-1 ${labelCls}`}>·</span>
          코팅 <span className="font-mono text-xs">{preview.coating}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <ParamChip
            darkMode={darkMode}
            label="Vc"
            value={`${preview.Vc}`}
            unit="m/min"
          />
          <ParamChip
            darkMode={darkMode}
            label="fz"
            value={preview.fz.toFixed(3)}
            unit="mm/t"
          />
          <ParamChip
            darkMode={darkMode}
            label="ap"
            value={preview.ap.toFixed(1)}
            unit="mm"
          />
          <ParamChip
            darkMode={darkMode}
            label="ae"
            value={preview.ae.toFixed(1)}
            unit="mm"
          />
        </div>
      </div>

      {/* 이유 설명 */}
      <div
        className={`rounded-xl p-3 text-xs ${
          darkMode
            ? "bg-sky-950/40 ring-1 ring-sky-800 text-sky-200"
            : "bg-sky-50 ring-1 ring-sky-200 text-sky-900"
        }`}
      >
        <div className="font-semibold mb-1">💡 왜 이렇게 추천하나요?</div>
        <div className="leading-relaxed">{reason}</div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────
function SummaryItem({
  darkMode,
  label,
  value,
}: {
  darkMode: boolean
  label: string
  value: string
}) {
  return (
    <div
      className={`min-w-0 rounded-lg px-2 py-1.5 ${
        darkMode ? "bg-slate-900/60" : "bg-white"
      }`}
    >
      <div
        className={`truncate text-[10px] font-semibold uppercase tracking-wider ${
          darkMode ? "text-slate-500" : "text-slate-600"
        }`}
      >
        {label}
      </div>
      <div
        className={`truncate text-sm font-medium ${
          darkMode ? "text-slate-100" : "text-slate-900"
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function ParamChip({
  darkMode,
  label,
  value,
  unit,
}: {
  darkMode: boolean
  label: string
  value: string
  unit: string
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${
        darkMode
          ? "bg-slate-900/60 ring-1 ring-slate-700"
          : "bg-white ring-1 ring-slate-200"
      }`}
    >
      <div className="flex items-baseline gap-1">
        <span
          className={`text-xs font-semibold ${
            darkMode ? "text-violet-300" : "text-violet-600"
          }`}
        >
          {label}
        </span>
        <span
          className={`text-base font-bold font-mono tabular-nums ${
            darkMode ? "text-slate-100" : "text-slate-900"
          }`}
        >
          {value}
        </span>
        <span
          className={`text-[10px] ${
            darkMode ? "text-slate-500" : "text-slate-500"
          }`}
        >
          {unit}
        </span>
      </div>
    </div>
  )
}

export default BeginnerWizard
