"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Database,
  Edit2,
  FileText,
  Filter,
  MessageCircle,
  Package,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  X,
  Zap,
} from "lucide-react"

import { Markdown } from "@/components/ui/markdown"
import { TypewriterText } from "@/lib/frontend/recommendation/typewriter-text"
import { Button } from "@/components/ui/button"
import {
  type RecommendationCapabilityDto,
  type RecommendationCandidateDto,
  type RecommendationPaginationDto,
  type RecommendationPublicSessionDto,
} from "@/lib/contracts/recommendation"
import { useApp } from "@/lib/frontend/app-context"
import { CandidateCard, IntentSummaryCard, RecommendationPanel } from "@/lib/frontend/recommendation/recommendation-display"
import {
  groupRecommendationCandidatesBySeries,
  sortCandidatesByPriority,
  type RecommendationCandidateSeriesGroup,
} from "@/lib/frontend/recommendation/recommendation-grouping"
import { isUndoChipEnabled } from "@/lib/frontend/recommendation/recommendation-view-model"
import {
  type ProductIntakeForm,
} from "@/lib/frontend/recommendation/intake-types"
import {
  getIntakeDisplayValue,
  localizeIntakeText,
} from "@/lib/frontend/recommendation/intake-localization"
import {
  buildSidebarConditionItems,
  getFilterDisplayValue,
} from "@/lib/frontend/recommendation/sidebar-condition-items"
import type { ChatMsg, TurnFeedback } from "@/lib/frontend/recommendation/exploration-types"
import { DebugPanel, DebugToggle } from "@/components/debug/debug-panel"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

const MAX_DISPLAY_CANDIDATES = 10
const RESOLUTION_CONFIG: Record<string, { ko: string; en: string; cls: string }> = {
  broad: { ko: "탐색 중", en: "Exploring", cls: "bg-blue-100 text-blue-700" },
  narrowing: { ko: "축소 중", en: "Narrowing", cls: "bg-amber-100 text-amber-700" },
  resolved_exact: { ko: "정확 매칭", en: "Exact Match", cls: "bg-green-100 text-green-700" },
  resolved_approximate: { ko: "근사 매칭", en: "Approximate", cls: "bg-amber-100 text-amber-700" },
  resolved_none: { ko: "매칭 없음", en: "No Match", cls: "bg-red-100 text-red-700" },
}

function getSeriesRatingLabel(
  rating: "EXCELLENT" | "GOOD" | "NULL" | null | undefined,
  language: "ko" | "en"
): string | null {
  if (rating === "EXCELLENT") return language === "ko" ? "EXCELLENT" : "EXCELLENT"
  if (rating === "GOOD" || rating === "NULL" || rating == null) return language === "ko" ? "GOOD" : "GOOD"
  return language === "ko" ? "GOOD" : "GOOD"
}

function getSeriesRatingBadgeClass(rating: "EXCELLENT" | "GOOD" | "NULL" | null | undefined): string {
  if (rating === "EXCELLENT") return "bg-emerald-100 text-emerald-700 border-emerald-200"
  if (rating === "GOOD") return "bg-amber-100 text-amber-700 border-amber-200"
  return "bg-amber-100 text-amber-700 border-amber-200"
}

function getCurrentMaterialLabel(form: ProductIntakeForm, language: "ko" | "en"): string | null {
  if (form.material.status !== "known") return null
  const label = getIntakeDisplayValue("material", form.material, language).trim()
  return label.length > 0 ? label : null
}

function buildSeriesMaterialTitle(seriesName: string, materialLabel: string | null): string {
  if (!materialLabel) return seriesName
  return `${seriesName} · ${materialLabel}`
}

function extractSeriesCode(value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text) return null
  const match = text.match(/\b([A-Z]{1,5}\d[A-Z0-9]{1,})\b/i)
  return match?.[1]?.toUpperCase() ?? null
}

function resolveSeriesPrimaryLabel(group: Pick<RecommendationCandidateSeriesGroup, "seriesKey" | "seriesName" | "members">): string {
  const codeFromKey = extractSeriesCode(group.seriesKey)
  if (codeFromKey) return codeFromKey

  const codeFromName = extractSeriesCode(group.seriesName)
  if (codeFromName) return codeFromName

  const codeFromMembers = group.members
    .map(member => extractSeriesCode(member.displayCode) ?? extractSeriesCode(member.productCode))
    .find((value): value is string => Boolean(value))
  if (codeFromMembers) return codeFromMembers

  const seriesKey = group.seriesKey?.trim()
  if (seriesKey && seriesKey !== "__ungrouped__") return seriesKey
  return group.seriesName
}

function getPrimaryBrandLabel(group: RecommendationCandidateSeriesGroup): string | null {
  const brands = Array.from(
    new Set(
      group.members
        .map(member => member.brand?.trim())
        .filter((value): value is string => Boolean(value))
    )
  )
  if (brands.length === 0) return null
  if (brands.length === 1) return brands[0]
  return brands.join(" / ")
}

function CaseCaptureModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (comment: string) => void
}) {
  const [comment, setComment] = useState("")
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) {
      setComment("")
      setSent(false)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={event => event.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-2">✅</div>
            <div className="text-sm font-semibold text-gray-800">좋은 사례를 저장했고 개발자에게 공유했어요.</div>
            <Button size="sm" className="mt-3" onClick={onClose}>닫기</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Star size={18} className="text-yellow-500" />
              <h3 className="text-sm font-bold text-gray-900">좋은 사례 저장</h3>
            </div>
            <p className="text-xs text-gray-500">현재 대화 상태와 추천 결과를 좋은 사례로 저장합니다.</p>
            <textarea
              value={comment}
              onChange={event => setComment(event.target.value)}
              placeholder="어떤 점이 좋았나요? (선택 사항)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-20 focus:outline-none focus:border-blue-400"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>취소</Button>
              <Button
                size="sm"
                className="bg-yellow-500 hover:bg-yellow-600 text-white"
                onClick={() => {
                  onSubmit(comment)
                  setSent(true)
                }}
              >
                <Star size={13} className="mr-1" /> 좋은 사례 저장
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Range filter UI options. label 은 자연어 디스패치 시 deterministic-scr 가
// 인식하는 키워드여야 한다 (NUMERIC_FIELD_CUES + 단위 포함).
const RANGE_FILTER_OPTIONS: Array<{ key: string; ko: string; en: string; unit: string; integer?: boolean }> = [
  { key: "직경", ko: "직경", en: "Diameter", unit: "mm" },
  { key: "전장", ko: "전장", en: "Overall length", unit: "mm" },
  { key: "절삭길이", ko: "절삭 길이", en: "Cutting length", unit: "mm" },
  { key: "날수", ko: "날수", en: "Flutes", unit: "", integer: true },
]

export function buildRangeQueryText(fieldKo: string, unit: string, min: string, max: string): string | null {
  const hasMin = min.trim() !== ""
  const hasMax = max.trim() !== ""
  if (!hasMin && !hasMax) return null
  const minN = hasMin ? Number(min) : null
  const maxN = hasMax ? Number(max) : null
  if (hasMin && (!Number.isFinite(minN) || (minN as number) < 0)) return null
  if (hasMax && (!Number.isFinite(maxN) || (maxN as number) < 0)) return null
  if (hasMin && hasMax) {
    // 같은 값이면 between 의미가 없으니 eq 형태로
    if (minN === maxN) return `${fieldKo} ${minN}${unit}`
    const lo = Math.min(minN as number, maxN as number)
    const hi = Math.max(minN as number, maxN as number)
    return `${fieldKo} ${lo}${unit} 이상 ${hi}${unit} 이하`
  }
  if (hasMin) return `${fieldKo} ${minN}${unit} 이상`
  return `${fieldKo} ${maxN}${unit} 이하`
}

function RangeFilterAdder({
  language,
  onSend,
}: {
  language: "ko" | "en"
  onSend: ((text: string) => void) | undefined
}) {
  const [fieldKey, setFieldKey] = useState<string>(RANGE_FILTER_OPTIONS[0].key)
  const [minVal, setMinVal] = useState<string>("")
  const [maxVal, setMaxVal] = useState<string>("")

  if (!onSend) return null

  const opt = RANGE_FILTER_OPTIONS.find(o => o.key === fieldKey) ?? RANGE_FILTER_OPTIONS[0]
  const fieldLabel = language === "ko" ? opt.ko : opt.en
  const fieldKoForQuery = opt.ko
  const handleApply = () => {
    const text = buildRangeQueryText(fieldKoForQuery, opt.unit, minVal, maxVal)
    if (!text) return
    onSend(text)
    setMinVal("")
    setMaxVal("")
  }
  const canApply = minVal.trim() !== "" || maxVal.trim() !== ""

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 mt-2">
      <div className="text-[10px] font-semibold text-gray-600 mb-1.5">
        {language === "ko" ? "📐 범위 필터 추가" : "📐 Add range filter"}
      </div>
      <div className="flex items-center gap-1">
        <select
          value={fieldKey}
          onChange={e => setFieldKey(e.target.value)}
          className="text-[10px] border border-gray-200 rounded px-1 py-1 bg-white text-gray-700 focus:outline-none focus:border-blue-400"
        >
          {RANGE_FILTER_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{language === "ko" ? o.ko : o.en}</option>
          ))}
        </select>
        <input
          type="number"
          inputMode={opt.integer ? "numeric" : "decimal"}
          step={opt.integer ? 1 : "any"}
          min={0}
          value={minVal}
          onChange={e => setMinVal(e.target.value)}
          placeholder={language === "ko" ? "최소" : "Min"}
          className="w-12 text-[10px] border border-gray-200 rounded px-1 py-1 focus:outline-none focus:border-blue-400"
          aria-label={`${fieldLabel} ${language === "ko" ? "최소" : "min"}`}
        />
        <span className="text-[10px] text-gray-400">~</span>
        <input
          type="number"
          inputMode={opt.integer ? "numeric" : "decimal"}
          step={opt.integer ? 1 : "any"}
          min={0}
          value={maxVal}
          onChange={e => setMaxVal(e.target.value)}
          placeholder={language === "ko" ? "최대" : "Max"}
          className="w-12 text-[10px] border border-gray-200 rounded px-1 py-1 focus:outline-none focus:border-blue-400"
          aria-label={`${fieldLabel} ${language === "ko" ? "최대" : "max"}`}
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="ml-auto text-[10px] px-2 py-1 rounded bg-blue-500 text-white font-semibold hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400"
        >
          {language === "ko" ? "적용" : "Apply"}
        </button>
      </div>
    </div>
  )
}

function ExplorationSidebar({
  form,
  sessionState,
  engineSessionState,
  onEdit,
  onSend,
  messages,
}: {
  form: ProductIntakeForm
  sessionState: RecommendationPublicSessionDto | null
  engineSessionState: ExplorationSessionState | null
  onEdit: () => void
  onSend?: (text: string) => void
  messages: ChatMsg[]
}) {
  const { language } = useApp()
  const latestPrep = [...messages].reverse().find(message => message.requestPreparation)?.requestPreparation ?? null
  const uiNarrowingPath = sessionState?.uiNarrowingPath ?? []
  const displayedGroups = sessionState?.displayedSeriesGroups ?? []
  const currentMaterialLabel = getCurrentMaterialLabel(form, language)
  const sidebarConditionItems = useMemo(
    () => buildSidebarConditionItems(form, sessionState, engineSessionState, language),
    [engineSessionState, form, language, sessionState]
  )

  return (
    <div className="p-3 space-y-3">
      {latestPrep && <IntentSummaryCard prep={latestPrep} />}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">{language === "ko" ? "조건 및 필터" : "Conditions & Filters"}</span>
          <button onClick={onEdit} className="text-[10px] text-blue-500 hover:text-blue-700">{language === "ko" ? "수정" : "Edit"}</button>
        </div>
        <div className="space-y-1">
          {sidebarConditionItems.map(item => {
            const isFilterValue = item.source === "filter"
            const isUnknown = item.value === "모름" || item.value === "Unknown"
            return (
              <div
                key={item.key}
                className={`rounded-lg px-2.5 py-1.5 border text-xs ${isFilterValue ? "border-blue-100 bg-blue-50" : "border-gray-100 bg-white"}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={isFilterValue ? "text-blue-500" : "text-gray-500"}>{item.emoji}</span>
                  <span className={`shrink-0 text-[10px] ${isFilterValue ? "text-blue-500 font-semibold" : "text-gray-500"}`}>
                    {item.label}
                  </span>
                  {isFilterValue && (
                    <span className="ml-auto rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-600">
                      {language === "ko" ? "필터" : "Filter"}
                    </span>
                  )}
                </div>
                <div className={`mt-1 truncate pl-6 ${isUnknown ? "text-gray-400 italic" : isFilterValue ? "text-blue-700 font-medium" : "text-gray-800 font-medium"}`}>
                  {item.value}
                </div>
              </div>
            )
          })}
          {sessionState && (
            <div className="text-[10px] text-gray-500 px-2.5 pt-1 font-medium">
              {language === "ko" ? `현재 후보 ${sessionState.candidateCount}개` : `${sessionState.candidateCount} candidates`}
            </div>
          )}
          <RangeFilterAdder language={language} onSend={onSend} />
        </div>
      </div>

      {sessionState && sessionState.narrowingHistory.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2">{language === "ko" ? "축소 이력" : "Narrowing History"}</div>
          <div className="space-y-1">
            {sessionState.narrowingHistory.map((history, index) => (
              <div key={index} className="text-[10px] text-gray-600 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                <div className="font-medium">
                  Turn {index + 1}: {history.extractedFilters.map(f => `${f.field}=${getFilterDisplayValue(f, language)}`).join(", ") || localizeIntakeText(history.answer, language)}
                </div>
                <div className="text-gray-400">{history.candidateCountBefore}→{history.candidateCountAfter}{language === "ko" ? "개" : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {displayedGroups.length >= 2 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Package size={10} />
            {language === "ko" ? "시리즈 그룹" : "Series Groups"}
          </div>
          <div className="space-y-0.5">
            {displayedGroups.slice(0, 5).map(group => (
              <div key={group.seriesKey} className="flex items-center justify-between text-[10px] bg-white rounded-lg px-2.5 py-1 border border-gray-100">
                <div className="min-w-0 flex items-center gap-1.5">
                  {(() => {
                    const ratingLabel = getSeriesRatingLabel(group.materialRating, language)
                    return (
                      <>
                  <span className="text-gray-700 font-medium truncate">{buildSeriesMaterialTitle(resolveSeriesPrimaryLabel({
                    ...group,
                    members: [],
                  }), currentMaterialLabel)}</span>
                        {ratingLabel && (
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${getSeriesRatingBadgeClass(group.materialRating)}`}>
                            {ratingLabel}
                    </span>
                        )}
                      </>
                    )
                  })()}
                </div>
                <span className="text-gray-400 shrink-0 ml-1">{group.candidateCount}{language === "ko" ? "개" : ""}</span>
              </div>
            ))}
            {displayedGroups.length > 5 && (
              <div className="text-[10px] text-gray-400 px-2.5">
                +{displayedGroups.length - 5}{language === "ko" ? "개 더" : " more"}
              </div>
            )}
          </div>
        </div>
      )}

      {sessionState?.currentTask?.checkpoints && sessionState.currentTask.checkpoints.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Clock size={10} />
            {language === "ko" ? "체크포인트" : "Checkpoints"}
          </div>
          <div className="space-y-0.5">
            {sessionState.currentTask.checkpoints.slice(-3).map(checkpoint => (
              <div key={checkpoint.checkpointId} className="text-[10px] text-gray-600 bg-white rounded-lg px-2.5 py-1 border border-gray-100 truncate">
                {checkpoint.summary}
              </div>
            ))}
          </div>
        </div>
      )}

      {sessionState && (
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <div className="text-[10px] text-gray-500 mb-1">{language === "ko" ? "해결 상태" : "Resolution Status"}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RESOLUTION_CONFIG[sessionState.resolutionStatus]?.cls ?? "bg-gray-100 text-gray-600"}`}>
            {RESOLUTION_CONFIG[sessionState.resolutionStatus]?.[language] ?? sessionState.resolutionStatus}
          </span>
          <div className="text-[10px] text-gray-400 mt-1">
            {language === "ko" ? `후보 ${sessionState.candidateCount}개` : `${sessionState.candidateCount} candidates`} · Turn {sessionState.turnCount}
          </div>
        </div>
      )}
    </div>
  )
}

// ChatGPT/Claude-style reasoning block: 헤드라인 + 경과시간 + 토글 본문.
// 스트리밍 중에는 100ms 단위 타이머가 흐르고, 끝나면 최종 경과시간을 고정한다.
function ReasoningBlock({
  trail,
  deep,
  isLoading,
  language,
}: {
  trail: string
  deep: string
  isLoading: boolean
  language: "ko" | "en"
}) {
  const [deepOpen, setDeepOpen] = useState(true)
  const [open, setOpen] = useState(true)
  // 사용자가 수동으로 토글한 적이 있으면 자동 접기/펴기를 멈춘다 (의도 존중).
  const userToggledRef = useRef(false)
  const wasLoadingRef = useRef(isLoading)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number | null>(null)
  const finalMsRef = useRef<number | null>(null)

  // 최근 추론 소요시간 이동평균(localStorage) — 첫 사용시 12s fallback.
  const STORAGE_KEY = "yg1.reasoningDurations.v1"
  const [estimateMs, setEstimateMs] = useState<number>(() => {
    if (typeof window === "undefined") return 12_000
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as number[]
      if (!Array.isArray(arr) || arr.length === 0) return 12_000
      return arr.reduce((a, b) => a + b, 0) / arr.length
    } catch { return 12_000 }
  })

  // 로딩 중/완료 모두 펼친 상태를 유지 — 사용자가 명시적으로 접기 전까진 CoT 본문을 보존.
  // (이전엔 로딩 종료 시 자동 접기로 인해 상세 내용이 "사라진 것처럼" 보였음.)
  useEffect(() => {
    if (userToggledRef.current) {
      wasLoadingRef.current = isLoading
      return
    }
    if (isLoading) setOpen(true)
    wasLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    if (isLoading) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now()
      finalMsRef.current = null
      const id = setInterval(() => {
        if (startedAtRef.current !== null) {
          setElapsedMs(Date.now() - startedAtRef.current)
        }
      }, 100)
      return () => clearInterval(id)
    }
    if (startedAtRef.current !== null && finalMsRef.current === null) {
      const final = Date.now() - startedAtRef.current
      finalMsRef.current = final
      setElapsedMs(final)
      try {
        const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as number[]
        const next = [...(Array.isArray(prev) ? prev : []), final].slice(-10)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        setEstimateMs(next.reduce((a, b) => a + b, 0) / next.length)
      } catch {}
    }
    return undefined
  }, [isLoading])

  const seconds = Math.max(0, elapsedMs / 1000)
  // 동적 ETA: elapsed가 estimate의 80%를 넘으면 estimate를 자동 연장 → 항상 양수.
  const liveEstimateMs = isLoading
    ? Math.max(estimateMs, elapsedMs / 0.8, elapsedMs + 2_000)
    : estimateMs
  const rawProgress = !isLoading ? 1 : Math.min(0.95, elapsedMs / liveEstimateMs)
  const remainingS = Math.max(1, Math.ceil((liveEstimateMs - elapsedMs) / 1000))
  const timerLabel = !isLoading
    ? `${Math.round(seconds)}s`
    : (language === "ko" ? `${seconds.toFixed(1)}s · 약 ${remainingS}s 남음` : `${seconds.toFixed(1)}s · ~${remainingS}s left`)
  const headlineText = isLoading
    ? (language === "ko" ? "추론 중" : "Thinking")
    : (language === "ko" ? `${Math.max(1, Math.round(seconds))}초 동안 추론함` : `Thought for ${Math.max(1, Math.round(seconds))}s`)

  // 원형 progress ring
  const RING_SIZE = 14
  const RING_STROKE = 2
  const RING_R = (RING_SIZE - RING_STROKE) / 2
  const RING_C = 2 * Math.PI * RING_R
  const ringOffset = RING_C * (1 - rawProgress)

  return (
    <div className="mt-1 max-w-full">
      <button
        type="button"
        onClick={() => { userToggledRef.current = true; setOpen(v => !v) }}
        className="group flex items-center gap-2 px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors"
      >
        {isLoading ? (
          <span className="relative inline-flex items-center justify-center shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} fill="none" stroke="#e5e7eb" strokeWidth={RING_STROKE} />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke="#3b82f6"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={ringOffset}
                style={{ transition: "stroke-dashoffset 200ms linear" }}
              />
            </svg>
          </span>
        ) : (
          <Brain size={12} className="text-blue-500 shrink-0" />
        )}
        <span className={`text-[11px] font-medium text-gray-700 leading-none ${isLoading ? "shimmer-text" : ""}`}>
          {headlineText}
        </span>
        <span className="text-[10px] tabular-nums text-gray-500 leading-none font-mono">
          {timerLabel}
        </span>
        <ChevronRight
          size={12}
          className={`text-gray-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 leading-relaxed whitespace-pre-wrap min-h-[1.6em]">
          {trail || (isLoading
            ? <span className="text-amber-700/70 italic">{language === "ko" ? "추론 내용을 가져오는 중…" : "Fetching reasoning…"}</span>
            : null)}
        </div>
      )}
      {deep && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setDeepOpen(v => !v)}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700"
          >
            <ChevronRight size={10} className={`transition-transform ${deepOpen ? "rotate-90" : ""}`} />
            <span>{language === "ko" ? `🧠 상세 사고 과정 (${deep.length.toLocaleString()}자)` : `🧠 Full chain-of-thought (${deep.length.toLocaleString()} chars)`}</span>
          </button>
          {deepOpen && (
            <div className="mt-1 p-2 bg-indigo-50 border border-indigo-200 rounded text-[11px] text-indigo-900 leading-relaxed whitespace-pre-wrap max-h-[600px] overflow-y-auto font-mono">
              {deep}
            </div>
          )}
        </div>
      )}
      <style jsx>{`
        .shimmer-text {
          background: linear-gradient(
            90deg,
            #6b7280 0%,
            #6b7280 40%,
            #d1d5db 50%,
            #6b7280 60%,
            #6b7280 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmer 1.6s linear infinite;
        }
        @keyframes shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  )
}

function NarrowingChat({
  messages,
  isSending,
  capabilities,
  onSend,
  onReset,
  onShowCandidates,
  onShowProductCards,
  onFeedback,
  onChipFeedback,
  onRecommendationFeedback,
}: {
  messages: ChatMsg[]
  isSending: boolean
  capabilities: RecommendationCapabilityDto
  onSend: (text: string) => void
  onReset?: () => void
  onShowCandidates?: () => void
  /** "제품 보기" CTA — pours the current candidate snapshot into the chat. */
  onShowProductCards?: () => void
  onFeedback?: (messageIndex: number, feedback: TurnFeedback) => void
  onChipFeedback?: (messageIndex: number, feedback: TurnFeedback) => void
  onRecommendationFeedback?: (messageIndex: number, feedback: TurnFeedback) => void
}) {
  const { language } = useApp()
  const [input, setInput] = useState("")
  const [debugMode, setDebugMode] = useState(false)
  const lastAiMsg = [...messages].reverse().find(message => message.role === "ai" && !message.isLoading)
  const lastAiHasChips = (lastAiMsg?.chips?.length ?? 0) > 0
  const lastAiHasRecommendation = !!lastAiMsg?.recommendation
  const needsFeedback = lastAiMsg && !isSending && (
    lastAiMsg.feedback === undefined ||
    (lastAiHasChips && lastAiMsg.chipFeedback === undefined) ||
    (lastAiHasRecommendation && lastAiMsg.recommendationFeedback === undefined)
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isSending) return
    setInput("")
    onSend(text)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end px-4 pt-2">
        <DebugToggle enabled={debugMode} onToggle={() => setDebugMode(prev => !prev)} />
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-4 sm:px-4">
        {messages.map((message, index) => (
          <div key={index} className={`flex items-end gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              message.role === "ai" ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
            }`}>
              {message.role === "ai" ? <Sparkles size={13} /> : (language === "ko" ? "나" : "Me")}
            </div>

            <div className="max-w-[85%] sm:max-w-[82%] min-w-0 space-y-2">
              {message.text && !message.isLoading && (
                <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}>
                  {message.role === "ai" ? (
                    // Typewriter only on the latest AI message; older messages render instantly
                    // so scrolling back doesn't re-animate. See typewriter-text.tsx for
                    // streaming-B/C TODOs (progressive cards + true token streaming).
                    <TypewriterText
                      text={message.text}
                      instant={index !== messages.length - 1 || isSending}
                      render={partial => (
                        <Markdown stripDoubleTilde disableStrikethrough>{partial}</Markdown>
                      )}
                    />
                  ) : message.text}
                </div>
              )}

              {message.isLoading && !message.thinkingProcess && (
                <div className="flex gap-1.5 px-4 py-3 bg-gray-100 rounded-2xl rounded-bl-sm w-fit">
                  {[0, 1, 2].map(dot => (
                    <div key={dot} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${dot * 0.15}s` }} />
                  ))}
                </div>
              )}

              {message.role === "ai" && (message.thinkingProcess || message.thinkingDeep || message.isLoading) && (
                <ReasoningBlock
                  trail={message.thinkingProcess ?? ""}
                  deep={message.thinkingDeep ?? ""}
                  isLoading={!!message.isLoading}
                  language={language}
                />
              )}

              {message.role === "ai" && message.chips && message.chips.length > 0 && !message.isLoading && (() => {
                const isLatest = index === messages.length - 1 && !isSending
                const isCtaChip = (chip: string) => chip.includes("제품 보기") || chip.includes("AI 상세 분석")
                const normalChips = message.chips.filter(chip => !isCtaChip(chip))
                // "제품 보기" CTA is a UI action (open candidate panel) and should remain
                // clickable on the latest AI message even if the user has already clicked it once.
                // "AI 상세 분석" only renders on the latest message because it sends a chat turn.
                const ctaChips = message.chips.filter(chip => {
                  if (!isCtaChip(chip)) return false
                  if (chip.includes("제품 보기")) return isLatest
                  return isLatest
                })
                const chipGroups = (message.chipGroups ?? [])
                  .map(group => ({
                    ...group,
                    chips: group.chips.filter(chip => !isCtaChip(chip)),
                  }))
                  .filter(group => group.chips.length > 0)
                console.log("[chip-groups:client:render]", {
                  messageIndex: index,
                  isLatest,
                  chipCount: message.chips.length,
                  chipPreview: message.chips.slice(0, 6),
                  normalChipCount: normalChips.length,
                  normalChipPreview: normalChips.slice(0, 6),
                  chipGroupCount: chipGroups.length,
                  chipGroups: chipGroups.map(group => ({
                    label: group.label,
                    count: group.chips.length,
                    preview: group.chips.slice(0, 4),
                  })),
                })
                const handleCtaClick = (chip: string) => {
                  if (isSending) return
                  if (chip.includes("제품 보기") && !isLatest) return
                  if (chip.includes("AI 상세 분석") && (!isLatest || needsFeedback)) return
                  if (chip.includes("제품 보기")) {
                    // "제품 보기"는 챗 라우터를 거치지 않는 순수 UI 액션.
                    // 사이드 패널을 여는 대신, 현재 후보 스냅샷을 채팅창에
                    // 새 AI 메시지로 부어준다 (제품 카드를 대화 흐름 안에서
                    // 직접 보고 싶다는 사용자 요구 — 2026-04-09).
                    setInput("")
                    if (onShowProductCards) onShowProductCards()
                  } else if (chip.includes("AI 상세 분석")) {
                    setInput(""); onSend("AI 상세 분석 해줘")
                  }
                }
                const renderChipButton = (chip: string, chipIndex: number) => {
                  const isResetChip = chip === "처음부터 다시" || chip === "처음부터"
                  const isUndoChip = isUndoChipEnabled(chip, capabilities)
                  return (
                    <button
                      key={`${chip}-${chipIndex}`}
                      onClick={() => {
                        if (!isLatest || needsFeedback || isSending) return
                        if (isResetChip && onReset) onReset()
                        else { setInput(""); onSend(chip) }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                        !isLatest
                          ? "bg-gray-50/50 border border-gray-200 text-gray-400 opacity-35 pointer-events-none"
                          : needsFeedback
                            ? "bg-gray-50 border border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
                            : isResetChip
                              ? "bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                              : isUndoChip
                                ? "bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-400"
                                : "bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                      }`}
                    >
                      {chip}
                    </button>
                  )
                }
                return (
                  <>
                    {chipGroups.length > 0 ? (
                      <div className="mt-1 space-y-2">
                        {chipGroups.map((group, groupIndex) => (
                          <div key={`${group.label}-${groupIndex}`} className="space-y-1">
                            <div className="text-[10px] font-medium text-gray-400 px-1">{group.label}</div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.chips.map((chip, chipIndex) => renderChipButton(chip, chipIndex))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {normalChips.map((chip, chipIndex) => renderChipButton(chip, chipIndex))}
                      </div>
                    )}
                    {ctaChips.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {ctaChips.map((chip, i) => (
                          <button
                            key={`cta-${i}`}
                            onClick={() => handleCtaClick(chip)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                              chip.includes("제품 보기")
                                ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                : needsFeedback
                                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                                  : "bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                            }`}
                          >
                            {chip.includes("제품 보기") ? <Package size={13} /> : <Sparkles size={13} />}
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}

              {message.candidateCards && message.candidateCards.length > 0 && !message.isLoading && (
                <div className="mt-1 space-y-2">
                  {message.candidateCards.map(candidate => (
                    <CandidateCard key={candidate.productCode} c={candidate} />
                  ))}
                </div>
              )}

              {message.recommendation && !message.isLoading && (
                <>
                  <RecommendationPanel
                    result={message.recommendation}
                    resultText=""
                    evidenceSummaries={message.evidenceSummaries}
                    explanation={message.primaryExplanation}
                    factChecked={message.primaryFactChecked}
                  />
                  {onRecommendationFeedback && (
                    <div className="border-t border-gray-100 pt-2 mt-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {message.recommendationFeedback ? (
                          <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                            {language === "ko" ? "추천 결과" : "Recommendation"}: {message.recommendationFeedback === "good" ? "👍" : message.recommendationFeedback === "bad" ? "👎" : "😐"}
                          </span>
                        ) : (
                          <>
                            <span className="text-[10px] text-gray-500 font-medium">{language === "ko" ? "추천 결과:" : "Recommendation:"}</span>
                            {([
                              { value: "good" as TurnFeedback, icon: "👍", cls: "hover:bg-green-100" },
                              { value: "neutral" as TurnFeedback, icon: "😐", cls: "hover:bg-gray-200" },
                              { value: "bad" as TurnFeedback, icon: "👎", cls: "hover:bg-red-100" },
                            ]).map(feedback => (
                              <button
                                key={feedback.value}
                                onClick={() => onRecommendationFeedback(index, feedback.value)}
                                className={`px-2 py-0.5 text-sm rounded-full border border-gray-200 ${feedback.cls} transition-colors`}
                              >
                                {feedback.icon}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {message.role === "ai" && !message.isLoading && onFeedback && (
                <div className="border-t border-gray-100 pt-3 mt-3 space-y-1.5">
                  <div className="text-[10px] text-gray-400 font-medium mb-1">{language === "ko" ? "평가" : "Feedback"}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {message.feedback ? (
                      <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                        {language === "ko" ? "응답" : "Response"}: {message.feedback === "good" ? "👍" : message.feedback === "bad" ? "👎" : "😐"}
                      </span>
                    ) : (
                      <>
                        <span className="text-[10px] text-gray-500 font-medium">{language === "ko" ? "응답:" : "Response:"}</span>
                        {([
                          { value: "good" as TurnFeedback, icon: "👍", cls: "hover:bg-green-100" },
                          { value: "neutral" as TurnFeedback, icon: "😐", cls: "hover:bg-gray-200" },
                          { value: "bad" as TurnFeedback, icon: "👎", cls: "hover:bg-red-100" },
                        ]).map(feedback => (
                          <button
                            key={feedback.value}
                            onClick={() => onFeedback(index, feedback.value)}
                            className={`px-2 py-0.5 text-sm rounded-full border border-gray-200 ${feedback.cls} transition-colors`}
                          >
                            {feedback.icon}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  {message.chips && message.chips.length > 0 && onChipFeedback && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {message.chipFeedback ? (
                        <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">
                          {language === "ko" ? "선택지" : "Options"}: {message.chipFeedback === "good" ? "👍" : message.chipFeedback === "bad" ? "👎" : "😐"}
                        </span>
                      ) : (
                        <>
                          <span className="text-[10px] text-gray-500 font-medium">{language === "ko" ? "선택지:" : "Options:"}</span>
                          {([
                            { value: "good" as TurnFeedback, icon: "👍", cls: "hover:bg-green-100" },
                            { value: "neutral" as TurnFeedback, icon: "😐", cls: "hover:bg-gray-200" },
                            { value: "bad" as TurnFeedback, icon: "👎", cls: "hover:bg-red-100" },
                          ]).map(feedback => (
                            <button
                              key={feedback.value}
                              onClick={() => onChipFeedback(index, feedback.value)}
                              className={`px-2 py-0.5 text-sm rounded-full border border-gray-200 ${feedback.cls} transition-colors`}
                            >
                              {feedback.icon}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {debugMode && message.role === "ai" && message.debugTrace && (
                <DebugPanel trace={message.debugTrace} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-3 py-2.5 border-t bg-white sm:px-4 sm:py-3" style={{ paddingBottom: "calc(0.625rem + env(safe-area-inset-bottom))" }}>
        {needsFeedback && (
          <div className="text-center text-xs text-amber-600 bg-amber-50 rounded-lg py-1.5 mb-2">
            {language === "ko"
              ? (lastAiMsg?.feedback === undefined
                ? "위 응답을 평가해주세요 (👍/😐/👎)"
                : lastAiHasRecommendation && lastAiMsg?.recommendationFeedback === undefined
                  ? "추천 결과도 평가해주세요 (👍/😐/👎)"
                  : "선택지도 평가해주세요 (👍/😐/👎)")
              : "Please rate the response above"}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder={language === "ko" ? "추가 질문이나 조건을 입력하세요..." : "Enter additional questions or conditions..."}
            rows={1}
            disabled={isSending || !!needsFeedback}
            className="flex-1 px-3 py-2.5 rounded-xl border-2 border-gray-200 text-base sm:text-sm focus:outline-none focus:border-blue-400 resize-none min-h-[44px] max-h-[120px]"
          />
          <Button onClick={handleSend} disabled={!input.trim() || isSending || !!needsFeedback} size="sm" className="h-[44px] w-[44px] p-0 shrink-0 rounded-xl">
            <Send size={15} />
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          {language === "ko" ? "YG-1 제품 DB 기반 · 추정/생성 없음 · 절삭조건 카탈로그 근거" : "Based on YG-1 product DB · No estimation · Catalog-grounded cutting conditions"}
        </p>
      </div>
    </div>
  )
}

function CandidatePanel({
  candidates,
  pagination,
  isPageLoading,
  messages,
  form,
  sessionState,
  onSend,
  onPageChange,
}: {
  candidates: RecommendationCandidateDto[] | null
  pagination: RecommendationPaginationDto | null
  isPageLoading: boolean
  messages: ChatMsg[]
  form: ProductIntakeForm
  sessionState?: RecommendationPublicSessionDto | null
  onSend?: (text: string) => void
  onPageChange?: (page: number) => void
}) {
  const { language } = useApp()
  const lastRecommendation = [...messages].reverse().find(message => message.recommendation)?.recommendation
  const totalCount = pagination?.totalItems ?? candidates?.length ?? 0
  const page = pagination?.page ?? 0
  const pageSize = pagination?.pageSize ?? Math.max(candidates?.length ?? 0, 1)
  const totalPages = pagination?.totalPages ?? (totalCount > 0 ? 1 : 0)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const currentMaterialLabel = useMemo(() => getCurrentMaterialLabel(form, language), [form, language])
  const groups = useMemo(
    () => candidates ? groupRecommendationCandidatesBySeries(candidates, sessionState?.displayedSeriesGroups ?? null) : [],
    [candidates, sessionState?.displayedSeriesGroups]
  )
  const useAccordion = groups.length > 0
  const pageStart = page * pageSize
  const pageEnd = pageStart + (candidates?.length ?? 0)
  // 플랫 모드에서도 그룹 모드와 동일한 우선순위 정책 적용 (score → matchStatus → stockStatus → totalStock)
  const displayCandidates = useMemo(
    () => candidates ? sortCandidatesByPriority(candidates) : null,
    [candidates]
  )
  const hasMore = page + 1 < totalPages
  const hasPrev = page > 0
  const activeFilterCount = sessionState?.appliedFilters?.filter(filter => filter.op !== "skip").length ?? 0
  const hasZeroCandidateResult = !!sessionState && (sessionState.candidateCount ?? totalCount) === 0 && activeFilterCount > 0

  useEffect(() => {
    setOpenGroups(new Set())
  }, [page, candidates])

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
        <Activity size={11} />
        {totalCount > 0 ? (
          language === "ko"
            ? <>추천 후보 {pageStart + 1}~{Math.min(pageEnd, totalCount)}위<span className="text-gray-400 font-normal ml-1">(현재 {groups.length}개 시리즈 / 전체 {totalCount}개)</span></>
            : <>Candidates #{pageStart + 1}-{Math.min(pageEnd, totalCount)}<span className="text-gray-400 font-normal ml-1"> ({groups.length} series / {totalCount} total)</span></>
        ) : (
          <>{language === "ko" ? "추천 후보" : "Candidates"}</>
        )}
      </div>

      {useAccordion ? (
        <div className="space-y-2">
          {groups.map(group => {
            const primaryBrandLabel = getPrimaryBrandLabel(group)
            const groupTitle = buildSeriesMaterialTitle(resolveSeriesPrimaryLabel(group), currentMaterialLabel)
            return (
              <div key={group.seriesKey} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.seriesKey)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                >
                  <img
                    src={group.seriesIconUrl || "/images/series/todo-placeholder.svg"}
                    alt={group.seriesName}
                    className="w-8 h-8 object-contain rounded border border-gray-100 shrink-0 bg-white"
                    onError={event => {
                      (event.currentTarget as HTMLImageElement).src = "/images/series/todo-placeholder.svg"
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-900 truncate">{groupTitle}</div>
                    {primaryBrandLabel && (
                      <div className="text-[10px] font-medium text-blue-700 truncate">{primaryBrandLabel}</div>
                    )}
                    {group.description && (
                      <div className="text-[10px] text-gray-600 truncate">{group.description.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {getSeriesRatingLabel(group.materialRating, language) && (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${getSeriesRatingBadgeClass(group.materialRating)}`}>
                          {getSeriesRatingLabel(group.materialRating, language)}
                        </span>
                      )}
                      <div className="text-[10px] text-gray-500">
                        {group.candidateCount}{language === "ko" ? "개" : ""} · {language === "ko" ? "최고" : "Top"} {group.topScore}{language === "ko" ? "점" : "pt"}
                      </div>
                    </div>
                  </div>
                  {openGroups.has(group.seriesKey) ? <ChevronUp size={14} className="text-gray-400 shrink-0" /> : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
                </button>
                {openGroups.has(group.seriesKey) && (
                  <div className="p-2 space-y-2 bg-white">
                    {group.members.map(candidate => (
                      <CandidateCard key={candidate.productCode} c={candidate} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : displayCandidates && displayCandidates.length > 0 ? (
        <div className="space-y-2">
          {displayCandidates.map(candidate => (
            <CandidateCard key={candidate.productCode} c={candidate} />
          ))}
        </div>
      ) : hasZeroCandidateResult ? (
        <div className="text-center py-8 text-gray-500">
          <Database size={24} className="mx-auto mb-2 opacity-50" />
          <div className="text-xs font-semibold text-gray-700">
            {language === "ko" ? "현재 필터 기준 결과 0건" : "0 results for current filters"}
          </div>
          <div className="text-[11px] mt-1 leading-relaxed">
            {language === "ko"
              ? `적용된 필터 ${activeFilterCount}개 기준으로 일치하는 후보가 없습니다. 이전 단계로 돌아가거나 조건을 조정하세요.`
              : `No candidates match the ${activeFilterCount} applied filters. Go back or adjust the filters.`}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <Database size={24} className="mx-auto mb-2 opacity-50" />
          <div className="text-xs">{language === "ko" ? "조건을 입력하면 후보를 검색합니다" : "Enter conditions to search candidates"}</div>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          {hasPrev && (
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={isPageLoading}
              className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {language === "ko" ? `← 이전 ${pageSize}개` : `← Prev ${pageSize}`}
            </button>
          )}
          <span className="text-[10px] text-gray-400">
            {isPageLoading ? (language === "ko" ? "불러오는 중..." : "Loading...") : `${page + 1} / ${Math.max(totalPages, 1)}`}
          </span>
          {hasMore && (
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={isPageLoading}
              className="px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
            >
              {language === "ko" ? `다음 ${pageSize}개 →` : `Next ${pageSize} →`}
            </button>
          )}
        </div>
      )}

      {sessionState?.taskHistory && sessionState.taskHistory.length > 0 && (
        <div className="border-t pt-3">
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <FileText size={11} className="text-purple-600" />
            {language === "ko" ? "이전 추천 작업" : "Previous Tasks"}
          </div>
          <div className="space-y-1">
            {sessionState.taskHistory.map(task => (
              <button
                key={task.taskId}
                onClick={() => onSend?.(`이전 작업 재개: ${task.taskId}`)}
                className="w-full text-left text-[10px] text-purple-700 bg-purple-50 rounded-lg px-2.5 py-1.5 border border-purple-100 hover:bg-purple-100 transition-colors"
              >
                <div className="font-medium truncate">{task.intakeSummary}</div>
                <div className="text-purple-500">
                  {language === "ko" ? `체크포인트 ${task.checkpointCount}개` : `${task.checkpointCount} checkpoints`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {lastRecommendation && (
        <div className="border-t pt-3">
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Zap size={11} className="text-blue-600" />
            {language === "ko" ? "최종 추천" : "Final Recommendation"}
          </div>
          {!lastRecommendation.primaryProduct ? (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5">{language === "ko" ? "매칭 없음" : "No Match"}</div>
          ) : (
            <div className="bg-blue-50 rounded-lg border border-blue-100 overflow-hidden">
              <div className="px-3 py-2">
                <div className="font-mono text-xs font-bold text-gray-900">{lastRecommendation.primaryProduct?.product?.displayCode}</div>
                <div className="text-[10px] text-gray-600">
                  {lastRecommendation.primaryProduct?.product?.brand && (
                    <span className="font-semibold text-purple-700">{lastRecommendation.primaryProduct?.product?.brand}</span>
                  )}
                  {lastRecommendation.primaryProduct?.product?.brand && " | "}
                  {lastRecommendation.status === "exact"
                    ? (language === "ko" ? "정확 매칭" : "Exact Match")
                    : (language === "ko" ? "근사 후보" : "Approximate")}
                  {" · "}
                  {lastRecommendation.primaryProduct.score}{language === "ko" ? "점" : "pt"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ExplorationScreen({
  form,
  messages,
  isSending,
  sessionState,
  engineSessionState,
  candidateSnapshot,
  candidatePagination,
  isCandidatePageLoading,
  capabilities,
  onSend,
  onPageChange,
  onReset,
  onEdit,
  onShowProductCards,
  onFeedback,
  onChipFeedback,
  onRecommendationFeedback,
  onSuccessCapture,
}: {
  form: ProductIntakeForm
  messages: ChatMsg[]
  isSending: boolean
  sessionState: RecommendationPublicSessionDto | null
  engineSessionState: ExplorationSessionState | null
  candidateSnapshot: RecommendationCandidateDto[] | null
  candidatePagination: RecommendationPaginationDto | null
  isCandidatePageLoading: boolean
  capabilities: RecommendationCapabilityDto
  onSend: (text: string) => void
  onPageChange: (page: number) => void
  onReset: () => void
  onEdit: () => void
  onShowProductCards?: () => void
  onFeedback: (messageIndex: number, feedback: TurnFeedback) => void
  onChipFeedback: (messageIndex: number, feedback: TurnFeedback) => void
  onRecommendationFeedback: (messageIndex: number, feedback: TurnFeedback) => void
  onSuccessCapture: (comment: string) => void
}) {
  const { language } = useApp()
  const [showSidebar, setShowSidebar] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [pulseCandidates, setPulseCandidates] = useState(false)
  const candidatePanelRef = useRef<HTMLDivElement>(null)
  const handleShowCandidates = () => {
    setShowCandidates(true)
    setPulseCandidates(true)
    // Defer scroll until after the panel becomes visible (it may be display:none on small screens
    // until showCandidates flips). rAF ensures the DOM has been updated before scrollIntoView.
    requestAnimationFrame(() => {
      candidatePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    window.setTimeout(() => setPulseCandidates(false), 1800)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b bg-white sm:px-4 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-sm font-bold text-gray-900">{language === "ko" ? "AI 탐색" : "AI Search"}</h2>
          {sessionState && (
            <span className={`shrink-0 text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-medium ${RESOLUTION_CONFIG[sessionState.resolutionStatus]?.cls ?? "bg-gray-100 text-gray-600"}`}>
              {RESOLUTION_CONFIG[sessionState.resolutionStatus]?.[language] ?? sessionState.resolutionStatus}
            </span>
          )}
          {sessionState && sessionState.resolutionStatus !== "broad" && (
            <span className="hidden sm:inline text-xs text-gray-500 truncate">
              {sessionState.candidateCount === 0
                ? (language === "ko" ? "0건" : "0 results")
                : sessionState.candidateCount > 50
                  ? (language === "ko" ? "후보군 넓음" : "Wide candidate pool")
                  : language === "ko"
                    ? `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)}개 추천`
                    : `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)} recommended`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 sm:gap-1.5">
          <button
            type="button"
            aria-label={language === "ko" ? "조건" : "Filters"}
            onClick={() => setShowSidebar(prev => !prev)}
            className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            <Filter size={15} />
          </button>
          <button
            type="button"
            aria-label={language === "ko" ? "후보" : "Results"}
            onClick={() => setShowCandidates(prev => !prev)}
            className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            <Activity size={15} />
          </button>
          <button
            type="button"
            aria-label={language === "ko" ? "조건 수정" : "Edit Conditions"}
            onClick={onEdit}
            className="inline-flex items-center justify-center h-9 w-9 sm:w-auto sm:px-2.5 gap-1 rounded-md border border-gray-200 text-xs text-gray-700 hover:bg-gray-50 active:bg-gray-100"
          >
            <Edit2 size={15} className="sm:hidden" />
            <Edit2 size={11} className="hidden sm:inline" />
            <span className="hidden sm:inline">{language === "ko" ? "조건 수정" : "Edit"}</span>
          </button>
          <button
            type="button"
            aria-label={language === "ko" ? "새 검색" : "New Search"}
            onClick={onReset}
            className="inline-flex items-center justify-center h-9 w-9 sm:w-auto sm:px-2.5 gap-1 rounded-md border border-orange-300 text-xs text-orange-700 hover:bg-orange-50 active:bg-orange-100"
          >
            <RotateCcw size={15} className="sm:hidden" />
            <RotateCcw size={11} className="hidden sm:inline" />
            <span className="hidden sm:inline">{language === "ko" ? "새 검색" : "New"}</span>
          </button>
          <button
            type="button"
            aria-label={language === "ko" ? "좋은 사례 저장" : "Save Success Case"}
            onClick={() => setShowSuccessModal(true)}
            className="inline-flex items-center justify-center h-9 w-9 sm:w-auto sm:px-2.5 gap-1 rounded-md border border-yellow-300 text-xs text-yellow-700 hover:bg-yellow-50 active:bg-yellow-100"
          >
            <Star size={15} className="sm:hidden" />
            <Star size={11} className="hidden sm:inline" />
            <span className="hidden sm:inline">{language === "ko" ? "사례 저장" : "Save"}</span>
          </button>
        </div>
      </div>

      <CaseCaptureModal open={showSuccessModal} onClose={() => setShowSuccessModal(false)} onSubmit={onSuccessCapture} />

      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {showSidebar && (
          <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setShowSidebar(false)} />
        )}
        <div className={`${showSidebar ? "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-xs shadow-xl" : "hidden"} lg:static lg:block lg:w-60 lg:shadow-none lg:max-w-none border-r bg-gray-50 flex-shrink-0 overflow-y-auto transition-all`}>
          {showSidebar && (
            <div className="lg:hidden flex items-center justify-between px-3 py-2 border-b bg-white sticky top-0">
              <span className="text-xs font-semibold text-gray-700">{language === "ko" ? "조건 및 필터" : "Filters"}</span>
              <button onClick={() => setShowSidebar(false)} className="p-1 -mr-1 rounded hover:bg-gray-100" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          )}
          <ExplorationSidebar form={form} sessionState={sessionState} engineSessionState={engineSessionState} onEdit={onEdit} onSend={onSend} messages={messages} />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <NarrowingChat
            messages={messages}
            isSending={isSending}
            capabilities={capabilities}
            onSend={onSend}
            onReset={onReset}
            onShowCandidates={handleShowCandidates}
            onShowProductCards={onShowProductCards}
            onFeedback={onFeedback}
            onChipFeedback={onChipFeedback}
            onRecommendationFeedback={onRecommendationFeedback}
          />
        </div>

        {showCandidates && (
          <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setShowCandidates(false)} />
        )}
        <div ref={candidatePanelRef} className={`${showCandidates ? "fixed inset-y-0 right-0 z-50 w-[90vw] max-w-sm shadow-xl" : "hidden"} lg:static lg:block lg:w-80 lg:shadow-none lg:max-w-none border-l bg-white flex-shrink-0 overflow-y-auto transition-all ${pulseCandidates ? "ring-4 ring-blue-500 ring-inset shadow-[0_0_24px_rgba(59,130,246,0.55)] animate-pulse" : ""}`}>
          {showCandidates && (
            <div className="lg:hidden flex items-center justify-between px-3 py-2 border-b bg-white sticky top-0 z-10">
              <span className="text-xs font-semibold text-gray-700">{language === "ko" ? "추천 후보" : "Candidates"}</span>
              <button onClick={() => setShowCandidates(false)} className="p-1 -mr-1 rounded hover:bg-gray-100" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          )}
          <CandidatePanel
            candidates={candidateSnapshot}
            pagination={candidatePagination}
            isPageLoading={isCandidatePageLoading}
            messages={messages}
            form={form}
            sessionState={sessionState}
            onSend={onSend}
            onPageChange={onPageChange}
          />
        </div>
      </div>
    </div>
  )
}
