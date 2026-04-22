// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 위젯 5종
// 교육 모드 ON이면 UI 요소 옆에 "?"가 활성. OFF면 숨김/옅음.
"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { HelpCircle, Info, BookOpen, Lightbulb, ChevronRight, ChevronLeft, X } from "lucide-react"
import { useEducation } from "./education-context"
import { getEntry } from "./education-content"

/* ═════════════════════════════════════════════════════════════════
 * 위젯 1: <EduLabel> — 라벨 옆 ? 아이콘, 클릭시 팝오버
 * ═════════════════════════════════════════════════════════════════ */
export function EduLabel({
  id,
  className = "",
  size = "sm",
}: {
  id: string
  className?: string
  size?: "xs" | "sm" | "md"
}) {
  const edu = useEducation()
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  const entry = getEntry(id)
  if (!entry) return null

  // 교육 모드 OFF면 거의 안 보이게 (완전 숨김 대신 아주 옅게 — 유저가 우연히 발견 가능)
  const baseOpacity = edu.enabled ? "opacity-80 hover:opacity-100" : "opacity-20 hover:opacity-70"
  const color = edu.enabled ? "text-blue-600" : "text-gray-400 dark:text-slate-500"
  const sizePx = size === "xs" ? 10 : size === "sm" ? 12 : 14

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`${entry.korean} 설명 열기`}
        className={`inline-flex align-middle ${baseOpacity} ${color} transition-opacity ${className}`}
      >
        <HelpCircle style={{ width: sizePx, height: sizePx }} />
      </button>
      {open && (
        <div
          ref={popRef}
          className="absolute z-50 left-0 top-full mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-blue-200 bg-white dark:bg-slate-900 shadow-xl p-3 text-left"
          style={{ fontFamily: "inherit" }}
        >
          <EduCard entry={entry} level={edu.level} showFormulas={edu.showFormulas}
            showExamples={edu.showExamples} showPitfalls={edu.showPitfalls}
            onJump={(targetId) => { setOpen(false); setTimeout(() => {
              // 다른 EduLabel 팝오버 띄우기는 자체적으로 불가 → 스크롤만
              const target = document.querySelector(`[data-edu-id="${targetId}"]`)
              if (target) (target as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" })
            }, 100) }}
          />
        </div>
      )}
      <span className="sr-only" data-edu-id={id}>{entry.korean}</span>
    </span>
  )
}

function EduCard({
  entry, level, showFormulas, showExamples, showPitfalls, onJump,
}: {
  entry: ReturnType<typeof getEntry>
  level: "beginner" | "intermediate" | "expert"
  showFormulas: boolean
  showExamples: boolean
  showPitfalls: boolean
  onJump: (id: string) => void
}) {
  if (!entry) return null
  return (
    <div className="space-y-2 text-xs">
      <div>
        <div className="font-bold text-gray-900 dark:text-slate-100 text-sm">{entry.korean}</div>
        <div className="text-[10px] text-gray-500 dark:text-slate-400 font-mono">{entry.english}</div>
      </div>
      <div className="text-gray-800 dark:text-slate-200 leading-relaxed">
        {entry.definition[level]}
      </div>
      {showFormulas && entry.formula && (
        <div className="rounded bg-blue-50 border border-blue-200 px-2 py-1 font-mono text-[11px] text-blue-900">
          <span className="text-[9px] uppercase tracking-wider text-blue-600 mr-1">공식</span>
          {entry.formula}
        </div>
      )}
      <div className="text-[11px] text-gray-700 dark:text-slate-200">
        <span className="font-semibold text-gray-800 dark:text-slate-100">왜 중요?</span> {entry.whyItMatters}
      </div>
      {showExamples && (
        <div className="text-[11px] text-emerald-800 bg-emerald-50 rounded px-2 py-1">
          <span className="font-semibold">예시</span> · {entry.realWorldExample}
        </div>
      )}
      {showPitfalls && entry.commonPitfall && (
        <div className="text-[11px] text-rose-800 bg-rose-50 rounded px-2 py-1">
          <span className="font-semibold">⚠ 함정</span> · {entry.commonPitfall}
        </div>
      )}
      {entry.relatedConcepts.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100 dark:border-slate-800">
          <span className="text-[10px] text-gray-500 dark:text-slate-400">관련:</span>
          {entry.relatedConcepts.map(r => (
            <button key={r} onClick={() => onJump(r)}
              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-mono">
              {r}
            </button>
          ))}
        </div>
      )}
      {entry.sourceAuthority && (
        <div className="text-[9px] text-gray-400 dark:text-slate-500 italic border-t border-gray-100 dark:border-slate-800 pt-1">
          출처: {entry.sourceAuthority}
        </div>
      )}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * 위젯 2: <EduBanner> — 큰 섹션 상단 배너
 * 교육 모드 ON에만 표시. 토글형.
 * ═════════════════════════════════════════════════════════════════ */
export function EduBanner({
  icon = "💡",
  title,
  description,
  mapEquivalent,
}: {
  icon?: string
  title: string
  description: string
  mapEquivalent?: string  // 예: "MAP의 [Material] 섹션에 해당"
}) {
  const edu = useEducation()
  const [dismissed, setDismissed] = useState(false)
  if (!edu.enabled || dismissed) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 mb-2 flex items-start gap-2 text-[11px]">
      <span className="text-base flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-amber-900">{title}</div>
        <div className="text-amber-800 leading-relaxed mt-0.5">
          {description}
          {mapEquivalent && <span className="ml-1 text-[10px] text-amber-600 italic">({mapEquivalent})</span>}
        </div>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="배너 닫기"
        className="text-amber-600 hover:text-amber-900 flex-shrink-0">
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * 위젯 3: <EduOverlay> — 결과값 옆 어노테이션
 * ═════════════════════════════════════════════════════════════════ */
export function EduOverlay({
  id,
  shortHint,
}: {
  id: string
  shortHint?: string  // "RPM 6,112 ← 공구가 1분에 6112번 회전. SFM×3.82/D."
}) {
  const edu = useEducation()
  if (!edu.enabled) return null
  const entry = getEntry(id)
  if (!entry && !shortHint) return null
  return (
    <div className="text-[10px] text-indigo-700 bg-indigo-50/70 rounded px-1.5 py-0.5 mt-0.5 font-normal leading-tight">
      <Lightbulb className="inline h-2.5 w-2.5 mr-0.5" />
      {shortHint ?? entry?.definition.beginner}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * 위젯 4: <EduCallout> — 경고 확장 설명
 * ═════════════════════════════════════════════════════════════════ */
export function EduCallout({
  level: severity,
  title,
  detail,
  relatedId,
}: {
  level: "info" | "warn" | "error"
  title: string
  detail: string       // "채터(chatter)는 공구와 가공물이 공진해서..."
  relatedId?: string
}) {
  const edu = useEducation()
  const colorMap = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
  }
  return (
    <div className={`rounded-lg border px-3 py-2 text-[11px] ${colorMap[severity]}`}>
      <div className="font-bold">{title}</div>
      {edu.enabled && (
        <div className="mt-1 leading-relaxed text-[10px] opacity-90">
          {detail}
          {relatedId && (
            <>
              {" "}<EduLabel id={relatedId} size="xs" />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * 위젯 5: <EduTheater> — 전체 화면 투어 (6 STEP)
 * ═════════════════════════════════════════════════════════════════ */
interface TheaterStep {
  selector: string         // CSS selector to highlight
  title: string
  description: string
  eduId?: string
}

const DEFAULT_STEPS: TheaterStep[] = [
  { selector: "[data-edu-section='tool']", title: "1. TOOL — 공구", description: "가공에 쓸 공구를 선택. 시리즈명이나 EDP 코드 입력 또는 예시에서 선택. 공구 직경·날수·형상이 이후 모든 계산의 기준.", eduId: "cutter-diameter" },
  { selector: "[data-edu-section='material']", title: "2. MATERIAL — 가공물 재질", description: "ISO 6분류(P/M/K/N/S/H) + 서브그룹 + 열처리 상태 + 경도. 재질이 SFM(절삭속도) 권장 범위를 결정.", eduId: "iso-p" },
  { selector: "[data-edu-section='operation']", title: "3. OPERATION — 가공 유형·경로", description: "Side Milling / Slotting / HEM 등. Tool Path에 따라 ap·ae 기본값 자동 조정.", eduId: "hem" },
  { selector: "[data-edu-section='machine']", title: "4. MACHINE — 머신·홀더·고정", description: "스핀들 규격, 홀더 종류, 최대 RPM/IPM, Workholding 강성. 머신 한계를 초과하는 조건은 자동 clamp.", eduId: "workholding-security" },
  { selector: "[data-edu-section='parameters']", title: "5. PARAMETERS — 4 독립 변수", description: "Stick Out + Vc + fz + ap + ae. 5 슬라이더로 조건 직접 조정. 2D ADOC/RDOC Adjuster로 시각적 탐색.", eduId: "vc" },
  { selector: "[data-edu-section='recommendations']", title: "6. RECOMMENDATIONS — 결과 해석", description: "RPM/Vf/MRR/Pc/Fc/편향/수명/Ra/Chatter 등 14+ 지표. Speed/Feed ±% 다이얼로 미세조정. 경고가 뜨면 반드시 확인.", eduId: "mrr" },
]

export function EduTheater() {
  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!active) return
    const step = DEFAULT_STEPS[stepIndex]
    const el = document.querySelector(step.selector)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      setTimeout(() => {
        const r = el.getBoundingClientRect()
        setRect(r)
      }, 300)
    } else {
      setRect(null)
    }
  }, [active, stepIndex])

  if (!active) {
    return (
      <button type="button" onClick={() => { setActive(true); setStepIndex(0) }}
        className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-white px-3 py-1.5 text-xs font-semibold hover:from-amber-600 hover:to-amber-700 shadow-sm">
        <BookOpen className="h-3.5 w-3.5" />
        전체 투어 시작
      </button>
    )
  }

  const step = DEFAULT_STEPS[stepIndex]

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {/* 어두운 오버레이 + 하이라이트 컷아웃 */}
      <div className="absolute inset-0 bg-black/60 pointer-events-auto" onClick={() => setActive(false)} />
      {rect && (
        <div
          className="absolute border-4 border-amber-400 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
          }}
        />
      )}
      {/* 하단 설명 박스 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl rounded-xl bg-white dark:bg-slate-900 shadow-2xl p-5 pointer-events-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">
            STEP {stepIndex + 1} / {DEFAULT_STEPS.length}
          </div>
          <button onClick={() => setActive(false)} aria-label="투어 종료"
            className="text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="text-lg font-bold text-gray-900 dark:text-slate-100">{step.title}</div>
        <div className="text-sm text-gray-700 dark:text-slate-200 mt-1.5 leading-relaxed">{step.description}</div>
        {step.eduId && (
          <div className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
            관련 용어: <EduLabel id={step.eduId} /> {getEntry(step.eduId)?.korean}
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <button onClick={() => setStepIndex(Math.max(0, stepIndex - 1))} disabled={stepIndex === 0}
            className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" /> 이전
          </button>
          <div className="flex gap-1">
            {DEFAULT_STEPS.map((_, i) => (
              <div key={i}
                className={`h-1.5 w-6 rounded-full ${i === stepIndex ? "bg-amber-500" : i < stepIndex ? "bg-amber-300" : "bg-gray-200 dark:bg-slate-700"}`} />
            ))}
          </div>
          {stepIndex < DEFAULT_STEPS.length - 1 ? (
            <button onClick={() => setStepIndex(stepIndex + 1)}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 text-white px-3 py-1.5 text-sm font-semibold hover:bg-amber-600">
              다음 <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={() => setActive(false)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-emerald-700">
              완료 ✓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * 헤더 컨트롤 — 교육 모드 on/off + 레벨 + 옵션 + 투어 시작
 * ═════════════════════════════════════════════════════════════════ */
export function EducationControl() {
  const edu = useEducation()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  // SSR/초기 렌더는 항상 OFF 상태로 그린다 → hydration mismatch 방지
  const isEnabledForRender = mounted && edu.enabled

  return (
    <div className="relative" ref={ref} suppressHydrationWarning>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          isEnabledForRender
            ? "border-amber-400 bg-amber-50 text-amber-800"
            : "border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
        }`}
        aria-label="교육 모드 설정"
        aria-expanded={open}
        suppressHydrationWarning
      >
        <BookOpen className="h-3.5 w-3.5" />
        🎓 교육 모드 {isEnabledForRender ? "ON" : "OFF"}
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={edu.enabled} onChange={(e) => edu.setEnabled(e.target.checked)} />
            <span className="text-sm font-semibold">교육 모드 켜기</span>
          </label>

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold">설명 단계</div>
            <div className="flex gap-1">
              {(["beginner", "intermediate", "expert"] as const).map(l => (
                <button key={l} onClick={() => edu.setLevel(l)}
                  className={`flex-1 rounded px-2 py-1 text-[10px] font-medium ${
                    edu.level === l ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300"
                  }`}>
                  {l === "beginner" ? "초급" : l === "intermediate" ? "중급" : "고급"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={edu.showFormulas} onChange={(e) => edu.setShowFormulas(e.target.checked)} />
              공식 표시
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={edu.showExamples} onChange={(e) => edu.setShowExamples(e.target.checked)} />
              실전 예시
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={edu.showPitfalls} onChange={(e) => edu.setShowPitfalls(e.target.checked)} />
              흔한 함정 (경고)
            </label>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-800 pt-2">
            <EduTheater />
          </div>
        </div>
      )}
    </div>
  )
}
