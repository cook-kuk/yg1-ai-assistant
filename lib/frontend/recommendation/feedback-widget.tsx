"use client"

import { useState } from "react"
import {
  CheckCircle2,
  MessageCircle,
  Star,
  X,
} from "lucide-react"

import type {
  RecommendationCandidateDto,
  RecommendationPublicSessionDto,
} from "@/lib/contracts/recommendation"
import { useApp } from "@/lib/frontend/app-context"
import type { ChatMsg } from "@/lib/frontend/recommendation/exploration-types"
import {
  type AnswerState,
  FIELD_CONFIGS,
  type ProductIntakeForm,
} from "@/lib/frontend/recommendation/intake-types"
import {
  getIntakeDisplayValue,
  getIntakeFieldLabel,
} from "@/lib/frontend/recommendation/intake-localization"

const FEEDBACK_TAGS = [
  { value: "wrong-product", ko: "잘못된 제품", en: "Wrong Product" },
  { value: "good-result", ko: "좋은 결과", en: "Good Result" },
  { value: "slow-response", ko: "느린 응답", en: "Slow Response" },
  { value: "missing-evidence", ko: "근거 부족", en: "Missing Evidence" },
  { value: "ui-issue", ko: "UI 문제", en: "UI Issue" },
  { value: "wrong-condition", ko: "절삭조건 오류", en: "Wrong Cutting Condition" },
  { value: "good-evidence", ko: "좋은 근거", en: "Good Evidence" },
]

type FeedbackAuthorType = "internal" | "customer" | "anonymous"

export function FeedbackWidget({
  form,
  messages,
  sessionState,
  candidateSnapshot,
}: {
  form: ProductIntakeForm
  messages: ChatMsg[]
  sessionState: RecommendationPublicSessionDto | null
  candidateSnapshot: RecommendationCandidateDto[] | null
}) {
  const { language } = useApp()
  const [open, setOpen] = useState(false)
  const [authorType, setAuthorType] = useState<FeedbackAuthorType>("internal")
  const [authorName, setAuthorName] = useState("")
  const [rating, setRating] = useState<number>(0)
  const [comment, setComment] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const authorTypeOptions: ReadonlyArray<readonly [FeedbackAuthorType, string]> = language === "ko"
    ? [["internal", "내부 개발팀"], ["customer", "고객사"], ["anonymous", "익명"]]
    : [["internal", "Internal Team"], ["customer", "Customer"], ["anonymous", "Anonymous"]]

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(value => value !== tag) : [...prev, tag])
  }

  const buildIntakeSummary = (): string => {
    return FIELD_CONFIGS.map(config => {
      const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
      if (state.status === "unanswered") return null
      const label = getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)
      const value = getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language)
      return `${label}: ${value}`
    }).filter(Boolean).join("\n")
  }

  const buildRecSummary = (): string | null => {
    const lastAiMsg = [...messages].reverse().find(message => message.role === "ai" && message.recommendation)
    if (!lastAiMsg?.recommendation) return null
    const recommendation = lastAiMsg.recommendation
    const primary = recommendation.primaryProduct
    if (!primary) return "매칭 없음"
    return `${primary.product.displayCode} (${recommendation.status}) - 점수: ${primary.score}`
  }

  const buildConversationSnapshot = () => {
    return messages.map((message, index) => ({
      index,
      role: message.role,
      text: message.text,
      isLoading: Boolean(message.isLoading),
      chips: message.chips ?? null,
      feedback: message.feedback ?? null,
      chipFeedback: message.chipFeedback ?? null,
      createdAt: message.createdAt ?? null,
      recommendation: message.recommendation ?? null,
      requestPayload: message.requestPayload ?? null,
      responsePayload: message.responsePayload ?? null,
    }))
  }

  const handleSubmit = async () => {
    if (!comment.trim() && rating === 0) return
    setSending(true)
    try {
      const chatHistory = messages.map(message => ({
        role: message.role,
        text: message.text.slice(0, 500),
      }))

      const lastAiMsg = [...messages].reverse().find(message => message.role === "ai" && !message.isLoading)

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientEventId: globalThis.crypto.randomUUID(),
          clientCapturedAt: new Date().toISOString(),
          authorType,
          authorName,
          sessionId: sessionState?.sessionId ?? null,
          intakeSummary: buildIntakeSummary(),
          chatHistory,
          recommendationSummary: buildRecSummary(),
          rating: rating > 0 ? rating : null,
          comment,
          tags,
          language,
          formSnapshot: form,
          sessionStateSnapshot: sessionState,
          candidateSnapshot,
          conversationSnapshot: buildConversationSnapshot(),
          requestPayload: lastAiMsg?.requestPayload ?? null,
          responsePayload: lastAiMsg?.responsePayload ?? null,
        }),
      })

      setSent(true)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setComment("")
        setRating(0)
        setTags([])
      }, 1500)
    } catch {
      alert("피드백 저장에 실패했습니다.")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all hover:scale-105"
      >
        <MessageCircle size={16} />
        <span className="text-sm font-medium">{language === "ko" ? "의견 남기기" : "Leave Feedback"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b">
              <h3 className="font-bold text-gray-900">{language === "ko" ? "의견 남기기" : "Leave Feedback"}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {sent ? (
              <div className="p-8 text-center">
                <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
                <div className="text-lg font-bold text-gray-900">{language === "ko" ? "감사합니다!" : "Thank you!"}</div>
                <div className="text-sm text-gray-500 mt-1">{language === "ko" ? "소중한 의견이 저장되었습니다" : "Your feedback has been saved"}</div>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === "ko" ? "작성자 유형" : "Author Type"}</label>
                  <div className="flex gap-2">
                    {authorTypeOptions.map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => setAuthorType(value)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          authorType === value
                            ? "bg-blue-50 border-blue-300 text-blue-700"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {authorType !== "anonymous" && (
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === "ko" ? "이름 (선택)" : "Name (optional)"}</label>
                    <input
                      type="text"
                      value={authorName}
                      onChange={event => setAuthorName(event.target.value)}
                      placeholder={language === "ko" ? "이름을 입력하세요" : "Enter your name"}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === "ko" ? "평점" : "Rating"}</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(index => (
                      <button key={index} onClick={() => setRating(index)} className="p-0.5">
                        <Star
                          size={24}
                          className={`transition-colors ${
                            index <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300 hover:text-yellow-300"
                          }`}
                        />
                      </button>
                    ))}
                    {rating > 0 && (
                      <button onClick={() => setRating(0)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">
                        {language === "ko" ? "초기화" : "Clear"}
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === "ko" ? "태그 (선택)" : "Tags (optional)"}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {FEEDBACK_TAGS.map(tag => (
                      <button
                        key={tag.value}
                        onClick={() => toggleTag(tag.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          tags.includes(tag.value)
                            ? "bg-blue-100 border-blue-300 text-blue-700"
                            : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {tag[language]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === "ko" ? "의견" : "Comment"}</label>
                  <textarea
                    value={comment}
                    onChange={event => setComment(event.target.value)}
                    placeholder={language === "ko" ? "추천 결과에 대한 의견을 남겨주세요. 잘못된 점, 개선사항 등 자유롭게 작성해주세요." : "Leave feedback on the recommendation. Feel free to share issues, improvements, or suggestions."}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>

                <div className="text-[10px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  {language === "ko" ? "현재 세션 정보가 자동으로 첨부됩니다 (입력 조건, 대화 내역, 추천 결과)" : "Session info will be automatically attached (conditions, chat history, recommendation result)"}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={sending || (!comment.trim() && rating === 0)}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? (language === "ko" ? "저장 중..." : "Saving...") : (language === "ko" ? "의견 제출" : "Submit Feedback")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
