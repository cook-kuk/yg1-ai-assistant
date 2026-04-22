// SPDX-License-Identifier: MIT
/**
 * YG-1 ARIA Simulator v3 — STEP 6-6
 * 학습 모드 (신입 엔지니어용 6단계 완주형 튜토리얼)
 *
 * 교육 모드(useEducation)와는 별개의 일회성 코스.
 *  - 첫 방문자(localStorage에 배지 없음) 자동 오픈
 *  - 단계마다 data-learning-step="..." 속성을 가진 UI에 스포트라이트
 *  - 각 단계 종료 시 3문제 퀴즈 (틀리면 해설 + 재시도)
 *  - 완주 시 배지 저장: localStorage["yg1-sim-learning-badge"] = ISO date
 *
 * 외부에서 쓰는 예:
 *   <LearningMode autoOpen onComplete={...} onSkip={...} />
 *   DOM에 data-learning-step="tool" / "material" / "operation" / "machine" / "params" / "recommendations" 지정 필요.
 *   없으면 스포트라이트는 생략하고 말풍선만 중앙 고정.
 */

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookOpen, GraduationCap, Sparkles, ChevronLeft, ChevronRight, X, Check,
  Award, AlertCircle, Info, Target,
} from "lucide-react"

// ── Props ───────────────────────────────────────────
export interface LearningModeProps {
  autoOpen?: boolean
  onComplete?: () => void
  onSkip?: () => void
}

// ── 단계 정의 ───────────────────────────────────────
interface LearningStep {
  key: string
  targetAttr: string // data-learning-step="..."
  icon: typeof BookOpen
  title: string
  subtitle: string
  tip: string
  why: string
  quiz: QuizQuestion[]
}

interface QuizQuestion {
  q: string
  options: string[]
  answerIdx: number
  explain: string
}

// Vc 120 m/min, D=10mm 일 때 n = (1000 × 120) / (π × 10) ≈ 3820 rpm
const STEPS: LearningStep[] = [
  {
    key: "tool",
    targetAttr: "tool",
    icon: Target,
    title: "1. 공구 선택",
    subtitle: "재질과 가공법에 맞는 엔드밀을 먼저 고릅니다",
    tip: "재질별 대표 시리즈 예시 중 하나를 고르세요. 직경 · 날수 · LOC · shape가 자동 채워집니다.",
    why: "공구가 바뀌면 추천 Vc/fz/ap/ae가 모두 달라집니다. 재질과 어울리지 않는 공구를 고르면 그 뒤 단계의 계산이 비현실적인 값으로 나옵니다. ENDMILL_EXAMPLES의 대표 조건을 출발점으로 삼는 이유입니다.",
    quiz: [
      {
        q: "SUS304(스테인리스)를 측면가공 할 때 가장 먼저 확인해야 할 공구 속성은?",
        options: ["공구 가격", "ISO 그룹(M)과 날수", "브랜드명", "제품 사진"],
        answerIdx: 1,
        explain: "스테인리스는 ISO M 그룹이고, 4~6날이 일반적. 재질 미스매치면 Vc 설정이 무효해집니다.",
      },
      {
        q: "날수(flutes)가 많을수록 어떤 효과가 커지나요?",
        options: ["1날당 이송 fz", "피니시 & 이송속도 Vf", "이송 여유 공간(chip pocket)", "직경"],
        answerIdx: 1,
        explain: "날수↑ → 같은 fz에서 Vf = fz×Z×n이 커집니다. 대신 칩 포켓은 작아져 슬로팅에는 불리.",
      },
      {
        q: "LOC(Length of Cut)가 의미하는 것은?",
        options: ["공구 전체 길이", "실제 절삭 가능한 날 부분 길이", "샹크 길이", "돌출 길이"],
        answerIdx: 1,
        explain: "LOC는 절삭날 부분. ap는 LOC를 넘을 수 없습니다.",
      },
    ],
  },
  {
    key: "material",
    targetAttr: "material",
    icon: BookOpen,
    title: "2. 재질 선택",
    subtitle: "ISO 그룹 → 세부 subgroup → 경화 조건 순서로 좁힙니다",
    tip: "P(탄소강) / M(SS) / K(주철) / N(비철) / S(내열) / H(고경도) 중 하나를 고르고, subgroup과 조건(Annealed·Hardened 등)을 맞추세요.",
    why: "ISO 그룹은 비절삭저항 kc 테이블의 키입니다. kc가 잘못 들어가면 Pc·Fc·편향 전부 틀립니다. Subgroup/경도까지 맞추면 Vc derate가 자동 적용됩니다.",
    quiz: [
      {
        q: "Inconel 718은 어느 ISO 그룹에 속하나요?",
        options: ["P (탄소강)", "M (스테인리스)", "S (내열합금)", "H (고경도강)"],
        answerIdx: 2,
        explain: "Inconel · Hastelloy 등 니켈/티타늄 내열합금은 ISO S. Vc를 크게 낮춰야 합니다 (~30~80 m/min).",
      },
      {
        q: "같은 ISO P 재질이라도 경도가 40 HRC로 올라가면?",
        options: ["Vc 그대로", "Vc 약 15% 하향", "Vc 약 50% 하향", "Vc 상향"],
        answerIdx: 2,
        explain: "hardnessVcDerate()에 따라 40 HRC → 약 0.85 × (15% 하향) 가 적용됩니다.",
      },
      {
        q: "오스테나이트 스테인리스(304/316)의 가공상 주의사항은?",
        options: ["너무 낮은 fz → 가공경화", "dry 가공 필수", "HSS만 사용", "ap < 0.1mm 필요"],
        answerIdx: 0,
        explain: "최소 chip thickness 이하의 fz는 cutting 대신 rubbing을 유발, 가공경화로 공구가 망가집니다.",
      },
    ],
  },
  {
    key: "operation",
    targetAttr: "operation",
    icon: Sparkles,
    title: "3. Operation 선택",
    subtitle: "Side / Slot / HEM / Profiling / Facing / Pocketing",
    tip: "Operation이 바뀌면 OPERATION_DEFAULTS의 apRatio · aeRatio · fzMult · vcMult가 자동 반영됩니다.",
    why: "Slotting은 ae=D 전폭 → fz 70%로 낮춰야 파손 방지. HEM은 얕은 ae + 깊은 ap + 고속이송으로 공구 수명 +3~5배.",
    quiz: [
      {
        q: "슬롯(Slot) 가공에서 fz가 자동으로 낮아지는 이유는?",
        options: ["정밀도 향상", "ae = D 전폭 → 칩 하중 증가", "공구가 부러지지 않게", "RPM이 낮기 때문"],
        answerIdx: 1,
        explain: "슬로팅은 전 직경이 계합 → chip load·열 모두 최대. fzMult 0.7로 자동 하향.",
      },
      {
        q: "HEM(High Efficiency Milling)의 핵심 원칙은?",
        options: ["깊은 ap + 얕은 ae + 고속이송", "얕은 ap + 깊은 ae", "ae = D", "플런지 가공"],
        answerIdx: 0,
        explain: "HEM은 chip thinning을 활용해 공구 수명을 늘리고 MRR도 유지. ae는 10~20%D.",
      },
      {
        q: "Profiling의 aeRatio 디폴트는 얼마인가요?",
        options: ["1.0", "0.5", "0.2", "0.1"],
        answerIdx: 3,
        explain: "Profiling은 경계 따라가므로 얕은 ae(0.1·D). 그 대신 vcMult 1.1로 올라갑니다.",
      },
    ],
  },
  {
    key: "machine",
    targetAttr: "machine",
    icon: Target,
    title: "4. 기계 설정",
    subtitle: "스핀들 · 홀더 · Workholding Security",
    tip: "VMC 표준 / 고속 / HSM / 미세가공 중 하나를 고르세요. Workholding 슬라이더는 보수~강건을 결정.",
    why: "스핀들 최대 RPM·kW를 초과하면 경고. Workholding security는 ap·ae 상한과 공격도를 결정 — 동일 공구·재질이라도 지그가 약하면 조건이 보수적으로 잡혀야 합니다.",
    quiz: [
      {
        q: "Workholding security가 50% 이하일 때 일어나는 일은?",
        options: ["Vc 상향", "chatter 리스크 점수 +25", "fz 상향", "RPM 상향"],
        answerIdx: 1,
        explain: "estimateChatterRisk()에서 50 미만이면 +25점. 70 미만이면 +10점.",
      },
      {
        q: "Shrink Fit 홀더가 ER 콜릿보다 유리한 이유는?",
        options: ["싸다", "강성(rigidity) 85 vs 55 — chatter에 강함", "RPM이 더 올라간다", "교체가 빠르다"],
        answerIdx: 1,
        explain: "Shrink fit rigidity 85, ER 55. 고속·깊이 가공일수록 강성이 필수.",
      },
      {
        q: "스핀들 Pc가 max_kW의 85%를 넘으면?",
        options: ["아무 일 없음", "경고 + 조건 하향 권장", "자동 정지", "RPM만 낮춘다"],
        answerIdx: 1,
        explain: "buildWarnings()에서 Pc > 85% → warn. 100% 넘으면 error.",
      },
    ],
  },
  {
    key: "params",
    targetAttr: "params",
    icon: BookOpen,
    title: "5. 파라미터 조정",
    subtitle: "Vc (절삭속도) · fz (이송) · ap · ae",
    tip: "카탈로그 범위 안에서 슬라이더로 조정. productivity/balanced/toollife 모드가 출발점을 자동 설정합니다.",
    why: "Vc = π·D·n/1000. Vf = fz·Z·n. 네 가지는 서로 연결돼 있고, MRR·Pc·수명·Ra에 동시에 영향을 줍니다.",
    quiz: [
      {
        q: "⌀10mm 엔드밀로 Vc = 120 m/min을 내려면 RPM은?",
        options: ["약 1200 rpm", "약 3820 rpm", "약 7640 rpm", "약 12000 rpm"],
        answerIdx: 1,
        explain: "n = 1000·Vc/(π·D) = 1000·120/(π·10) ≈ 3820 rpm.",
      },
      {
        q: "fz를 2배 올리면 chip thickness(hex)는?",
        options: ["그대로", "2배", "절반", "RCTF에 따라 다름"],
        answerIdx: 3,
        explain: "hex = fz × RCTF. ae/D < 0.5면 RCTF<1이라 실제 chip은 fz보다 작음. 얕은 ae에서 fz를 올려야 하는 이유.",
      },
      {
        q: "ap가 LOC를 넘으면?",
        options: ["문제없음", "공구 제원 초과 경고", "자동으로 줄여짐", "RPM만 재계산"],
        answerIdx: 1,
        explain: "ap > LOC는 샹크가 절삭에 닿는 것. 반드시 경고가 떠야 합니다.",
      },
    ],
  },
  {
    key: "recommendations",
    targetAttr: "recommendations",
    icon: Award,
    title: "6. 결과 해석",
    subtitle: "MRR · Tool Life · Pc · Fc · Deflection · Ra · Chatter Risk",
    tip: "각 지표를 읽고 경고 배너를 확인하세요. 경고 error는 가공 전에 반드시 해결.",
    why: "추천값이 나왔다고 바로 쓰면 안 됩니다. 공구편향 > 50μm, chatter risk ≥ 55, Pc 초과 중 하나라도 있으면 수정 필요.",
    quiz: [
      {
        q: "chatter risk 레벨이 'high'로 표시되면 먼저 체크할 것은?",
        options: ["RPM만 올린다", "L/D 비율 & Workholding 확인", "fz 2배로 올린다", "공구 교체"],
        answerIdx: 1,
        explain: "chatter의 주된 원인은 돌출 과대(L/D>6) 또는 Workholding 낮음. 둘 다 ap/Vc 하향으로 완화.",
      },
      {
        q: "공구편향(deflection)이 30μm 초과일 때 가장 먼저 할 일은?",
        options: ["fz 상향", "ap 하향 + 스틱아웃 축소", "Vc 상향", "날수 늘리기"],
        answerIdx: 1,
        explain: "δ = F·L³/(3EI). L(스틱아웃)의 세제곱에 비례 → L을 줄이면 8~27배 개선.",
      },
      {
        q: "공구수명이 1분 이하로 나오면?",
        options: ["그대로 가공", "Vc 하향 + coating mult 확인", "MRR만 본다", "fz 2배로"],
        answerIdx: 1,
        explain: "Taylor: V·T^n = C. Vc를 10% 낮추면 수명이 수 배 늘어납니다.",
      },
    ],
  },
]

const BADGE_KEY = "yg1-sim-learning-badge"

// ── 배지 유틸 (export) ─────────────────────────────
export function hasLearningBadge(): boolean {
  if (typeof window === "undefined") return false
  try {
    return !!localStorage.getItem(BADGE_KEY)
  } catch {
    return false
  }
}

function saveBadge() {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(BADGE_KEY, new Date().toISOString().slice(0, 10))
  } catch {
    // ignore
  }
}

// ── 메인 컴포넌트 ───────────────────────────────────
export function LearningMode({ autoOpen, onComplete, onSkip }: LearningModeProps) {
  const [open, setOpen] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [mode, setMode] = useState<"tour" | "quiz" | "done">("tour")
  const [quizIdx, setQuizIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [wrongCount, setWrongCount] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)

  // 자동 오픈 (배지 없고 autoOpen=true)
  useEffect(() => {
    if (autoOpen && !hasLearningBadge()) {
      const t = setTimeout(() => setOpen(true), 500)
      return () => clearTimeout(t)
    }
  }, [autoOpen])

  const step = STEPS[stepIdx]

  // 스포트라이트 타겟 측정
  useEffect(() => {
    if (!open || mode !== "tour") {
      setSpotlightRect(null)
      return
    }
    const measure = () => {
      if (typeof document === "undefined") return
      const el = document.querySelector(`[data-learning-step="${step.targetAttr}"]`)
      if (el instanceof HTMLElement) {
        setSpotlightRect(el.getBoundingClientRect())
        // 스크롤 자동 이동
        el.scrollIntoView({ behavior: "smooth", block: "center" })
      } else {
        setSpotlightRect(null)
      }
    }
    measure()
    const onResize = () => measure()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onResize, true)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onResize, true)
    }
  }, [open, mode, stepIdx, step.targetAttr])

  const goNext = useCallback(() => {
    if (mode === "tour") {
      setMode("quiz")
      setQuizIdx(0)
      setSelected(null)
      setRevealed(false)
    } else if (mode === "quiz") {
      // 이 단계 퀴즈 완료?
      if (quizIdx + 1 < step.quiz.length) {
        setQuizIdx(i => i + 1)
        setSelected(null)
        setRevealed(false)
      } else {
        // 다음 단계?
        if (stepIdx + 1 < STEPS.length) {
          setStepIdx(i => i + 1)
          setMode("tour")
          setQuizIdx(0)
          setSelected(null)
          setRevealed(false)
        } else {
          // 완주
          saveBadge()
          setMode("done")
          onComplete?.()
        }
      }
    } else {
      setOpen(false)
    }
  }, [mode, quizIdx, step, stepIdx, onComplete])

  const goBack = useCallback(() => {
    if (mode === "quiz" && quizIdx > 0) {
      setQuizIdx(i => i - 1)
      setSelected(null)
      setRevealed(false)
      return
    }
    if (mode === "quiz" && quizIdx === 0) {
      setMode("tour")
      return
    }
    if (mode === "tour" && stepIdx > 0) {
      setStepIdx(i => i - 1)
      setMode("quiz")
      setQuizIdx(STEPS[stepIdx - 1].quiz.length - 1)
      setSelected(null)
      setRevealed(true)
    }
  }, [mode, quizIdx, stepIdx])

  const handleAnswer = (idx: number) => {
    if (revealed) return
    setSelected(idx)
    setRevealed(true)
    if (idx !== step.quiz[quizIdx].answerIdx) {
      setWrongCount(c => c + 1)
    }
  }

  const retry = () => {
    setSelected(null)
    setRevealed(false)
  }

  const handleSkip = () => {
    setOpen(false)
    onSkip?.()
  }

  const handleOpen = () => {
    setStepIdx(0)
    setMode("tour")
    setQuizIdx(0)
    setSelected(null)
    setRevealed(false)
    setWrongCount(0)
    setOpen(true)
  }

  const progress = useMemo(() => {
    const totalSteps = STEPS.length * 2 // tour + quiz
    const done = stepIdx * 2 + (mode === "tour" ? 0 : 1)
    return Math.round((done / totalSteps) * 100)
  }, [stepIdx, mode])

  // ── 트리거 버튼 (배지 있으면 "재수강" 표시) ──
  if (!open) {
    const badge = typeof window !== "undefined" ? (() => {
      try { return localStorage.getItem(BADGE_KEY) } catch { return null }
    })() : null
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 px-3 py-1.5 text-sm text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/50"
      >
        <GraduationCap className="h-4 w-4" />
        {badge ? `학습모드 재수강 (수료 ${badge})` : "학습모드 시작 (6단계)"}
      </button>
    )
  }

  // ── 오버레이 + 패널 ──
  return (
    <div className="fixed inset-0 z-50">
      {/* 반투명 배경 + 스포트라이트 홀 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-auto" onClick={handleSkip} />
      {spotlightRect && mode === "tour" && (
        <div
          className="absolute pointer-events-none rounded-lg ring-4 ring-amber-400 ring-offset-2 ring-offset-black/20"
          style={{
            left: spotlightRect.left - 8,
            top: spotlightRect.top - 8,
            width: spotlightRect.width + 16,
            height: spotlightRect.height + 16,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            borderRadius: 8,
          }}
        />
      )}

      {/* 우측 steps 패널 */}
      <aside className="absolute right-0 top-0 bottom-0 w-80 max-w-full bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-sm">YG-1 ARIA 학습모드</span>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 진행 바 */}
        <div className="px-4 pt-3">
          <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">진행률 {progress}% · 오답 {wrongCount}개</div>
        </div>

        {/* 단계 리스트 */}
        <nav className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <ul className="space-y-1 text-xs">
            {STEPS.map((s, i) => {
              const active = i === stepIdx
              const done = i < stepIdx
              return (
                <li
                  key={s.key}
                  className={`flex items-center gap-2 py-1 px-2 rounded ${
                    active
                      ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-medium"
                      : done
                        ? "text-muted-foreground"
                        : "text-muted-foreground/70"
                  }`}
                >
                  {done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <s.icon className="h-3.5 w-3.5" />}
                  <span>{s.title}</span>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {mode === "tour" && <TourPanel step={step} />}
          {mode === "quiz" && (
            <QuizPanel
              step={step}
              q={step.quiz[quizIdx]}
              index={quizIdx}
              total={step.quiz.length}
              selected={selected}
              revealed={revealed}
              onAnswer={handleAnswer}
              onRetry={retry}
            />
          )}
          {mode === "done" && <DonePanel wrongCount={wrongCount} onClose={() => setOpen(false)} />}
        </div>

        {/* 푸터 네비 */}
        {mode !== "done" && (
          <footer className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 gap-2">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIdx === 0 && mode === "tour"}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 이전
            </button>
            <button
              type="button"
              onClick={handleSkip}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              스킵
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={mode === "quiz" && !revealed}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {mode === "tour" ? "퀴즈" : (quizIdx + 1 < step.quiz.length || stepIdx + 1 < STEPS.length ? "다음" : "수료")}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </footer>
        )}
      </aside>

      {/* 말풍선 (스포트라이트 근처 또는 중앙) */}
      {mode === "tour" && (
        <BubbleTip rect={spotlightRect} step={step} />
      )}
    </div>
  )
}

// ── 투어 패널 ─────────────────────────────────────
function TourPanel({ step }: { step: LearningStep }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <step.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-semibold">{step.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{step.subtitle}</p>
        </div>
      </div>

      <div className="rounded-md bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 p-3 text-xs">
        <div className="flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" />
          <span>{step.tip}</span>
        </div>
      </div>

      <div className="text-xs">
        <div className="font-semibold mb-1 flex items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          왜 이게 먼저인가?
        </div>
        <p className="text-muted-foreground">{step.why}</p>
      </div>
    </div>
  )
}

// ── 퀴즈 패널 ─────────────────────────────────────
function QuizPanel(props: {
  step: LearningStep
  q: QuizQuestion
  index: number
  total: number
  selected: number | null
  revealed: boolean
  onAnswer: (idx: number) => void
  onRetry: () => void
}) {
  const { step, q, index, total, selected, revealed, onAnswer, onRetry } = props
  const correct = revealed && selected === q.answerIdx
  const wrong = revealed && selected !== null && selected !== q.answerIdx

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" />
        <span>{step.title} — 퀴즈 {index + 1}/{total}</span>
      </div>

      <div className="text-sm font-medium">{q.q}</div>

      <div className="space-y-1.5">
        {q.options.map((opt, i) => {
          const isSelected = selected === i
          const isAnswer = q.answerIdx === i
          let cls = "w-full text-left text-xs px-3 py-2 rounded border "
          if (revealed) {
            if (isAnswer) cls += "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
            else if (isSelected) cls += "border-rose-400 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300"
            else cls += "border-zinc-200 dark:border-zinc-800 opacity-60"
          } else {
            cls += "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }
          return (
            <button
              key={i}
              type="button"
              onClick={() => onAnswer(i)}
              disabled={revealed}
              className={cls}
            >
              <span className="font-mono text-[10px] text-muted-foreground mr-1.5">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          )
        })}
      </div>

      {correct && (
        <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 p-2 text-xs">
          <div className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300 mb-1">
            <Check className="h-3.5 w-3.5" /> 정답!
          </div>
          <div className="text-emerald-800 dark:text-emerald-400/80">{q.explain}</div>
        </div>
      )}

      {wrong && (
        <div className="rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/20 p-2 text-xs space-y-1">
          <div className="flex items-center gap-1 font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle className="h-3.5 w-3.5" /> 오답 — 해설
          </div>
          <div className="text-rose-800 dark:text-rose-400/80">{q.explain}</div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  )
}

// ── 완주 패널 ─────────────────────────────────────
function DonePanel({ wrongCount, onClose }: { wrongCount: number; onClose: () => void }) {
  const grade = wrongCount === 0 ? "A+" : wrongCount <= 2 ? "A" : wrongCount <= 4 ? "B" : "수료"
  return (
    <div className="text-center space-y-4 py-6">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700">
        <Award className="h-10 w-10 text-amber-600 dark:text-amber-400" />
      </div>
      <div>
        <h3 className="font-semibold text-lg">YG-1 가공조건 기초 수료</h3>
        <p className="text-xs text-muted-foreground mt-1">
          6단계 투어 + {STEPS.reduce((s, x) => s + x.quiz.length, 0)}개 퀴즈 완주.
        </p>
        <div className="mt-2 text-sm">
          등급 <span className="font-mono font-semibold">{grade}</span> · 오답 {wrongCount}개
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1 px-4 py-2 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700"
      >
        <Check className="h-4 w-4" /> 시뮬레이터로 돌아가기
      </button>
      <p className="text-[11px] text-muted-foreground">
        배지가 localStorage에 저장되었습니다. 재수강은 언제든 가능합니다.
      </p>
    </div>
  )
}

// ── 말풍선 ────────────────────────────────────────
function BubbleTip({ rect, step }: { rect: DOMRect | null; step: LearningStep }) {
  // rect 있으면 상단/하단 여유에 따라 배치, 없으면 화면 중앙 상단 고정
  const bubbleRef = useRef<HTMLDivElement>(null)
  if (!rect) {
    return (
      <div
        ref={bubbleRef}
        className="absolute left-1/2 top-8 -translate-x-1/2 max-w-sm bg-white dark:bg-zinc-950 border border-amber-300 dark:border-amber-700 rounded-lg shadow-xl p-3 text-xs pointer-events-auto"
      >
        <BubbleBody step={step} />
      </div>
    )
  }

  // 기본: 타겟 하단에 배치, 화면 아래로 벗어나면 상단
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800
  const below = rect.bottom + 180 < viewportH
  const top = below ? rect.bottom + 12 : Math.max(12, rect.top - 180)
  const left = Math.min(
    Math.max(rect.left, 12),
    (typeof window !== "undefined" ? window.innerWidth : 1200) - 360 - 12,
  )

  return (
    <div
      ref={bubbleRef}
      className="absolute max-w-sm bg-white dark:bg-zinc-950 border border-amber-300 dark:border-amber-700 rounded-lg shadow-xl p-3 text-xs pointer-events-auto"
      style={{ top, left, width: 360 }}
    >
      <BubbleBody step={step} />
    </div>
  )
}

function BubbleBody({ step }: { step: LearningStep }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 font-semibold text-sm">
        <step.icon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
        {step.title}
      </div>
      <div className="text-muted-foreground">{step.subtitle}</div>
      <div className="text-foreground">{step.tip}</div>
    </div>
  )
}

export default LearningMode
