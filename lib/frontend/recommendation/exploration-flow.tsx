"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  ArrowRight,
  ChevronDown,
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
  type RecommendationCandidateSeriesGroup,
} from "@/lib/frontend/recommendation/recommendation-grouping"
import { isUndoChipEnabled } from "@/lib/frontend/recommendation/recommendation-view-model"
import {
  type AnswerState,
  FIELD_CONFIGS,
  type ProductIntakeForm,
} from "@/lib/frontend/recommendation/intake-types"
import {
  getIntakeDisplayValue,
  getIntakeFieldLabel,
  localizeIntakeText,
} from "@/lib/frontend/recommendation/intake-localization"
import type { ChatMsg, TurnFeedback } from "@/lib/frontend/recommendation/exploration-types"
import { DebugPanel, DebugToggle } from "@/components/debug/debug-panel"

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
  if (rating === "GOOD") return language === "ko" ? "GOOD" : "GOOD"
  return "BAD"
}

function getSeriesRatingBadgeClass(rating: "EXCELLENT" | "GOOD" | "NULL" | null | undefined): string {
  if (rating === "EXCELLENT") return "bg-emerald-100 text-emerald-700 border-emerald-200"
  if (rating === "GOOD") return "bg-amber-100 text-amber-700 border-amber-200"
  return "bg-rose-100 text-rose-700 border-rose-200"
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

function ExplorationSidebar({
  form,
  sessionState,
  onEdit,
  messages,
}: {
  form: ProductIntakeForm
  sessionState: RecommendationPublicSessionDto | null
  onEdit: () => void
  messages: ChatMsg[]
}) {
  const { language } = useApp()
  const latestPrep = [...messages].reverse().find(message => message.requestPreparation)?.requestPreparation ?? null
  const uiNarrowingPath = sessionState?.uiNarrowingPath ?? []
  const displayedGroups = sessionState?.displayedSeriesGroups ?? []
  const currentMaterialLabel = getCurrentMaterialLabel(form, language)

  return (
    <div className="p-3 space-y-3">
      {latestPrep && <IntentSummaryCard prep={latestPrep} />}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">{language === "ko" ? "입력 조건" : "Input Conditions"}</span>
          <button onClick={onEdit} className="text-[10px] text-blue-500 hover:text-blue-700">{language === "ko" ? "수정" : "Edit"}</button>
        </div>
        <div className="space-y-1">
          {FIELD_CONFIGS.map(config => {
            const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
            const isUnknown = state.status === "unknown"
            const isUnanswered = state.status === "unanswered"
            if (isUnanswered) return null

            return (
              <div key={config.key} className="flex justify-between items-center text-xs bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                <span className="text-gray-500">{config.emoji}</span>
                <span className={`flex-1 ml-1.5 truncate ${isUnknown ? "text-gray-400 italic" : "text-gray-800 font-medium"}`}>
                  {getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {sessionState && (uiNarrowingPath.length > 0 || sessionState.appliedFilters.length > 0) && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Filter size={10} />
            {language === "ko" ? "적용 필터" : "Applied Filters"}
          </div>
          <div className="space-y-0.5">
            {uiNarrowingPath.length > 0
              ? uiNarrowingPath.map((entry, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1 border border-blue-100 bg-blue-50">
                  <ArrowRight size={8} className="text-blue-400 shrink-0" />
                  <span className="text-blue-600 font-medium truncate">
                    {entry.field === "fluteCount"
                      ? (language === "ko" ? "날수" : "Flutes")
                      : entry.field === "toolSubtype"
                        ? (language === "ko" ? "형상" : "Shape")
                        : entry.field === "coating"
                          ? (language === "ko" ? "코팅" : "Coating")
                          : entry.field === "seriesName"
                            ? (language === "ko" ? "시리즈" : "Series")
                            : localizeIntakeText(entry.field ?? entry.label, language)}
                    : {localizeIntakeText(entry.value ?? entry.label, language)}
                  </span>
                  {entry.candidateCountBefore != null && (
                    <span className="text-[9px] text-blue-400 shrink-0 ml-auto">
                      {entry.candidateCountBefore}→{entry.candidateCount}
                    </span>
                  )}
                </div>
              ))
              : sessionState.appliedFilters.filter(filter => filter.op !== "skip").map((filter, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1 border border-blue-100 bg-blue-50">
                  <ArrowRight size={8} className="text-blue-400 shrink-0" />
                  <span className="text-blue-600 font-medium truncate">
                    {filter.field === "fluteCount"
                      ? (language === "ko" ? "날수" : "Flutes")
                      : filter.field === "toolSubtype"
                        ? (language === "ko" ? "형상" : "Shape")
                        : filter.field === "coating"
                          ? (language === "ko" ? "코팅" : "Coating")
                          : filter.field === "seriesName"
                            ? (language === "ko" ? "시리즈" : "Series")
                            : localizeIntakeText(filter.field, language)}
                    : {localizeIntakeText(filter.value, language)}
                  </span>
                </div>
              ))}
            <div className="text-[10px] text-gray-500 px-2.5 pt-1 font-medium">
              {language === "ko" ? `→ 현재 후보: ${sessionState.candidateCount}개` : `-> Current candidates: ${sessionState.candidateCount}`}
            </div>
          </div>
        </div>
      )}

      {sessionState && sessionState.narrowingHistory.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2">{language === "ko" ? "축소 이력" : "Narrowing History"}</div>
          <div className="space-y-1">
            {sessionState.narrowingHistory.map((history, index) => (
              <div key={index} className="text-[10px] text-gray-600 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                <div className="font-medium">
                  Turn {index + 1}: {history.extractedFilters.filter(f => f.op !== "skip").map(f => `${f.field}=${f.value}`).join(", ") || localizeIntakeText(history.answer, language)}
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

function NarrowingChat({
  messages,
  isSending,
  capabilities,
  onSend,
  onReset,
  onFeedback,
  onChipFeedback,
}: {
  messages: ChatMsg[]
  isSending: boolean
  capabilities: RecommendationCapabilityDto
  onSend: (text: string) => void
  onReset?: () => void
  onFeedback?: (messageIndex: number, feedback: TurnFeedback) => void
  onChipFeedback?: (messageIndex: number, feedback: TurnFeedback) => void
}) {
  const { language } = useApp()
  const [input, setInput] = useState("")
  const [debugMode, setDebugMode] = useState(false)
  const lastAiMsg = [...messages].reverse().find(message => message.role === "ai" && !message.isLoading)
  const lastAiHasChips = (lastAiMsg?.chips?.length ?? 0) > 0
  const needsFeedback = lastAiMsg && !isSending && (
    lastAiMsg.feedback === undefined ||
    (lastAiHasChips && lastAiMsg.chipFeedback === undefined)
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((message, index) => (
          <div key={index} className={`flex items-end gap-2 ${message.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              message.role === "ai" ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
            }`}>
              {message.role === "ai" ? <Sparkles size={13} /> : (language === "ko" ? "나" : "Me")}
            </div>

            <div className="max-w-[82%] space-y-2">
              {message.text && !message.isLoading && (
                <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}>
                  {message.role === "ai" ? <Markdown stripDoubleTilde disableStrikethrough>{message.text}</Markdown> : message.text}
                </div>
              )}

              {message.isLoading && (
                <div className="flex gap-1.5 px-4 py-3 bg-gray-100 rounded-2xl rounded-bl-sm w-fit">
                  {[0, 1, 2].map(dot => (
                    <div key={dot} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${dot * 0.15}s` }} />
                  ))}
                </div>
              )}

              {message.role === "ai" && message.chips && message.chips.length > 0 && !message.isLoading && (() => {
                const isLatest = index === messages.length - 1 && !isSending
                const productListChip = message.chips.find(c => c.includes("제품 보기"))
                const aiAnalysisChip = message.chips.find(c => c.includes("AI 상세 분석"))
                const normalChips = message.chips.filter(c => !c.includes("제품 보기") && !c.includes("AI 상세 분석"))
                const chipGroups = message.chipGroups?.filter(group => group.chips.length > 0) ?? []
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
                    {isLatest && (productListChip || aiAnalysisChip) && (
                      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-100">
                        {productListChip && (
                          <button
                            onClick={() => { setInput(""); onSend(productListChip) }}
                            className="w-full py-2.5 text-sm font-bold rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-md"
                          >
                            {productListChip}
                          </button>
                        )}
                        {aiAnalysisChip && (
                          <button
                            onClick={() => { setInput(""); onSend(aiAnalysisChip) }}
                            className="w-full py-2.5 text-sm font-medium rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50"
                          >
                            {aiAnalysisChip}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}

              {message.recommendation && !message.isLoading && (
                <RecommendationPanel
                  result={message.recommendation}
                  resultText=""
                  evidenceSummaries={message.evidenceSummaries}
                  explanation={message.primaryExplanation}
                  factChecked={message.primaryFactChecked}
                />
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

      <div className="shrink-0 px-4 py-3 border-t bg-white">
        {needsFeedback && (
          <div className="text-center text-xs text-amber-600 bg-amber-50 rounded-lg py-1.5 mb-2">
            {language === "ko"
              ? (lastAiMsg?.feedback === undefined ? "위 응답을 평가해주세요 (👍/😐/👎)" : "선택지도 평가해주세요 (👍/😐/👎)")
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
            className="flex-1 px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm focus:outline-none focus:border-blue-400 resize-none min-h-[42px] max-h-[120px]"
          />
          <Button onClick={handleSend} disabled={!input.trim() || isSending || !!needsFeedback} size="sm" className="h-[42px] w-[42px] p-0 shrink-0 rounded-xl">
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
  const displayCandidates = candidates ?? null
  const hasMore = page + 1 < totalPages
  const hasPrev = page > 0

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
                  {group.seriesIconUrl && (
                    <img
                      src={group.seriesIconUrl}
                      alt={group.seriesName}
                      className="w-8 h-8 object-contain rounded border border-gray-100 shrink-0 bg-white"
                      onError={event => {
                        event.currentTarget.style.display = "none"
                      }}
                    />
                  )}
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
  candidateSnapshot,
  candidatePagination,
  isCandidatePageLoading,
  capabilities,
  onSend,
  onPageChange,
  onReset,
  onEdit,
  onFeedback,
  onChipFeedback,
  onSuccessCapture,
}: {
  form: ProductIntakeForm
  messages: ChatMsg[]
  isSending: boolean
  sessionState: RecommendationPublicSessionDto | null
  candidateSnapshot: RecommendationCandidateDto[] | null
  candidatePagination: RecommendationPaginationDto | null
  isCandidatePageLoading: boolean
  capabilities: RecommendationCapabilityDto
  onSend: (text: string) => void
  onPageChange: (page: number) => void
  onReset: () => void
  onEdit: () => void
  onFeedback: (messageIndex: number, feedback: TurnFeedback) => void
  onChipFeedback: (messageIndex: number, feedback: TurnFeedback) => void
  onSuccessCapture: (comment: string) => void
}) {
  const { language } = useApp()
  const [showSidebar, setShowSidebar] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">{language === "ko" ? "AI 제품 탐색" : "AI Product Search"}</h2>
          {sessionState && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RESOLUTION_CONFIG[sessionState.resolutionStatus]?.cls ?? "bg-gray-100 text-gray-600"}`}>
              {RESOLUTION_CONFIG[sessionState.resolutionStatus]?.[language] ?? sessionState.resolutionStatus}
            </span>
          )}
          {sessionState && sessionState.candidateCount > 0 && sessionState.resolutionStatus !== "broad" && (
            <span className="text-xs text-gray-500">
              {sessionState.candidateCount > 50
                ? (language === "ko" ? "후보군 넓음" : "Wide candidate pool")
                : language === "ko"
                  ? `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)}개 추천`
                  : `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)} recommended`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setShowSidebar(prev => !prev)} className="gap-1 text-xs h-7 px-2 lg:hidden">
            <Filter size={11} />
            {language === "ko" ? "조건" : "Filters"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCandidates(prev => !prev)} className="gap-1 text-xs h-7 px-2 lg:hidden">
            <Activity size={11} />
            {language === "ko" ? "후보" : "Results"}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs h-7 px-2">
            <Edit2 size={11} />
            {language === "ko" ? "조건 수정" : "Edit Conditions"}
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} className="gap-1 text-xs h-7 px-2 border-orange-300 text-orange-700 hover:bg-orange-50">
            <RotateCcw size={11} />
            {language === "ko" ? "새 검색" : "New Search"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSuccessModal(true)} className="gap-1 text-xs h-7 px-2 border-yellow-300 text-yellow-700 hover:bg-yellow-50">
            <Star size={11} />
            {language === "ko" ? "좋은 사례 저장" : "Save Success Case"}
          </Button>
        </div>
      </div>

      <CaseCaptureModal open={showSuccessModal} onClose={() => setShowSuccessModal(false)} onSubmit={onSuccessCapture} />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className={`w-60 border-r bg-gray-50 flex-shrink-0 overflow-y-auto transition-all ${showSidebar ? "block" : "hidden"} lg:block`}>
          <ExplorationSidebar form={form} sessionState={sessionState} onEdit={onEdit} messages={messages} />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <NarrowingChat
            messages={messages}
            isSending={isSending}
            capabilities={capabilities}
            onSend={onSend}
            onReset={onReset}
            onFeedback={onFeedback}
            onChipFeedback={onChipFeedback}
          />
        </div>

        <div className={`w-80 border-l bg-white flex-shrink-0 overflow-y-auto transition-all ${showCandidates ? "block" : "hidden"} lg:block`}>
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
