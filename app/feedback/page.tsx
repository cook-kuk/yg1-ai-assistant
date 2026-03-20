"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Lock,
  MessageCircle,
  RefreshCw,
  Star,
  User,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { FeedbackEntryDto, FeedbackEventEntryDto } from "@/lib/contracts/feedback"
import { parseFeedbackListResponse } from "@/lib/frontend/feedback/feedback-client"
import { useApp } from "@/lib/store"

const AUTHOR_TYPE_CONFIG = {
  internal: { label: "내부 개발팀", cls: "bg-blue-100 text-blue-700" },
  customer: { label: "고객사", cls: "bg-green-100 text-green-700" },
  anonymous: { label: "익명", cls: "bg-gray-100 text-gray-600" },
} as const

const EVENT_TYPE_CONFIG = {
  turn_feedback: { label: "대화 피드백", cls: "bg-indigo-100 text-indigo-700", icon: MessageCircle },
  success_case: { label: "좋은 사례", cls: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  failure_case: { label: "문제 사례", cls: "bg-rose-100 text-rose-700", icon: AlertTriangle },
} as const

const TAG_COLORS: Record<string, string> = {
  "wrong-product": "bg-red-100 text-red-700",
  "good-result": "bg-green-100 text-green-700",
  "slow-response": "bg-amber-100 text-amber-700",
  "missing-evidence": "bg-purple-100 text-purple-700",
  "ui-issue": "bg-orange-100 text-orange-700",
  "good-evidence": "bg-emerald-100 text-emerald-700",
  "wrong-condition": "bg-red-100 text-red-700",
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function clipText(value: string | null | undefined, maxLength = 120) {
  const text = value?.trim() ?? ""
  if (!text) return "-"
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function formatFeedbackLabel(value: string | null) {
  if (value === "good") return "좋음"
  if (value === "bad") return "나쁨"
  if (value === "neutral") return "보통"
  return null
}

function feedbackTone(value: string | null) {
  if (value === "good") return "bg-emerald-100 text-emerald-700"
  if (value === "bad") return "bg-rose-100 text-rose-700"
  if (value === "neutral") return "bg-gray-100 text-gray-700"
  return "bg-gray-100 text-gray-500"
}

function buildFeedbackFileUrl(filename: string) {
  return `/api/feedback/files/${encodeURIComponent(filename)}`
}

function StarRating({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-xs text-gray-400">평가 없음</span>
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={14}
          className={i <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}
        />
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</h3>
}

function MessageBubble({
  role,
  text,
  chips,
}: {
  role: string
  text: string
  chips?: string[]
}) {
  const isUser = role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isUser ? "bg-blue-600 text-white" : "bg-white text-gray-800 border border-gray-200"
        }`}
      >
        <div className={`mb-1 text-[11px] font-semibold ${isUser ? "text-blue-100" : "text-gray-500"}`}>
          {isUser ? "사용자" : "AI"}
        </div>
        <div className="whitespace-pre-wrap break-words">{text}</div>
        {chips && chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <span
                key={chip}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  isUser ? "bg-white/15 text-blue-50" : "bg-gray-100 text-gray-600"
                }`}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecommendedProducts({
  entry,
}: {
  entry: FeedbackEventEntryDto
}) {
  if (!entry.candidateHighlights || entry.candidateHighlights.length === 0) return null

  return (
    <div className="space-y-3">
      <SectionTitle>추천 제품</SectionTitle>
      <div className="grid gap-2 rounded-3xl border border-gray-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
        {entry.candidateHighlights.map(candidate => (
          <div
            key={`${entry.id}-${candidate.productCode}-${candidate.rank ?? "na"}`}
            className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-900">
                  {candidate.productCode || candidate.displayCode}
                </div>
                <div className="text-xs text-gray-500">
                  Rank {candidate.rank ?? "-"}
                </div>
              </div>
              <div className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                Score {candidate.score ?? "-"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FeedbackViewerPage() {
  const { currentUser } = useApp()
  const [generalEntries, setGeneralEntries] = useState<FeedbackEntryDto[]>([])
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEventEntryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedGeneralEntry, setSelectedGeneralEntry] = useState<FeedbackEntryDto | null>(null)
  const [selectedFeedbackEntry, setSelectedFeedbackEntry] = useState<FeedbackEventEntryDto | null>(null)

  const fetchFeedback = async () => {
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch("/api/feedback", { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = parseFeedbackListResponse(await res.json())
      setGeneralEntries(data.generalEntries ?? [])
      setFeedbackEntries(data.feedbackEntries ?? [])
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("요청 시간이 초과되었습니다. 새로고침을 시도해주세요.")
      } else {
        setError(err instanceof Error ? err.message : "Failed to load")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFeedback()
  }, [])

  const averageRating = useMemo(() => {
    const ratedEntries = generalEntries.filter(entry => entry.rating != null)
    if (ratedEntries.length === 0) return "-"
    const total = ratedEntries.reduce((sum, entry) => sum + (entry.rating ?? 0), 0)
    return (total / ratedEntries.length).toFixed(1)
  }, [generalEntries])

  const turnFeedbackCount = feedbackEntries.filter(entry => entry.type === "turn_feedback").length
  const successCaseCount = feedbackEntries.filter(entry => entry.type === "success_case").length

  if (currentUser.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <Card className="border-gray-200 py-0">
            <CardContent className="flex flex-col items-center gap-4 px-8 py-12 text-center">
              <div className="rounded-full bg-gray-100 p-4 text-gray-500">
                <Lock className="h-8 w-8" />
              </div>
              <div className="space-y-1">
                <h1 className="text-xl font-semibold text-gray-900">관리자 모드에서만 확인할 수 있습니다</h1>
                <p className="text-sm text-gray-500">피드백 탭은 관리자 권한에서만 열 수 있도록 제한되어 있습니다.</p>
              </div>
              <Button variant="outline" onClick={() => window.history.back()} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                돌아가기
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => window.history.back()}>
              <ArrowLeft size={14} />
              돌아가기
            </Button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">피드백 관리</h1>
              <p className="text-xs text-gray-500">의견 남기기와 대화 피드백을 관리자 모드에서 검토합니다.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchFeedback} className="gap-1">
            <RefreshCw size={12} />
            새로고침
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="py-0">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{generalEntries.length}</div>
              <div className="text-xs text-gray-500">의견 남기기</div>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-indigo-600">{turnFeedbackCount}</div>
              <div className="text-xs text-gray-500">대화 피드백</div>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-600">{successCaseCount}</div>
              <div className="text-xs text-gray-500">좋은 사례</div>
            </CardContent>
          </Card>
          <Card className="py-0">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{averageRating}</div>
              <div className="text-xs text-gray-500">평균 평점</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="general" className="gap-4">
          <TabsList className="w-full justify-start bg-transparent p-0">
            <TabsTrigger value="general" className="border border-gray-200 bg-white px-4 data-[state=active]:border-blue-200 data-[state=active]:bg-blue-50">
              의견 남기기
            </TabsTrigger>
            <TabsTrigger value="history" className="border border-gray-200 bg-white px-4 data-[state=active]:border-blue-200 data-[state=active]:bg-blue-50">
              피드백 내역
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            {loading ? (
              <div className="py-12 text-center text-gray-500">로딩 중...</div>
            ) : error ? (
              <div className="py-12 text-center text-red-500">오류: {error}</div>
            ) : generalEntries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <div>저장된 의견이 없습니다.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {generalEntries.map(entry => {
                  const authorConfig = AUTHOR_TYPE_CONFIG[entry.authorType]
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedGeneralEntry(entry)}
                      className="block w-full text-left"
                    >
                      <Card className="border-gray-200 py-0 transition-shadow hover:shadow-md">
                        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${authorConfig.cls}`}>
                                {authorConfig.label}
                              </span>
                              {entry.authorName && (
                                <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
                                  <User size={12} />
                                  {entry.authorName}
                                </span>
                              )}
                              <StarRating rating={entry.rating} />
                            </div>
                            <div className="line-clamp-1 text-sm font-medium text-gray-900">
                              {clipText(entry.comment, 90)}
                            </div>
                            <div className="mt-1 line-clamp-1 text-xs text-gray-500">
                              {entry.tags.length > 0 ? entry.tags.join(" · ") : "태그 없음"}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock size={12} />
                            {formatDateTime(entry.timestamp)}
                          </div>
                        </CardContent>
                      </Card>
                    </button>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            {loading ? (
              <div className="py-12 text-center text-gray-500">로딩 중...</div>
            ) : error ? (
              <div className="py-12 text-center text-red-500">오류: {error}</div>
            ) : feedbackEntries.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <div>저장된 피드백 내역이 없습니다.</div>
              </div>
            ) : (
              <div className="space-y-3">
                {feedbackEntries.map(entry => {
                  const eventConfig = EVENT_TYPE_CONFIG[entry.type]
                  const EventIcon = eventConfig.icon
                  const responseTone = formatFeedbackLabel(entry.responseFeedback ?? entry.feedback)
                  const chipTone = formatFeedbackLabel(entry.chipFeedback)

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedFeedbackEntry(entry)}
                      className="block w-full text-left"
                    >
                      <Card className="border-gray-200 py-0 transition-shadow hover:shadow-md">
                        <CardContent className="space-y-3 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${eventConfig.cls}`}>
                                  <EventIcon className="h-3 w-3" />
                                  {eventConfig.label}
                                </span>
                                {responseTone && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${feedbackTone(entry.responseFeedback ?? entry.feedback)}`}>
                                    응답 {responseTone}
                                  </span>
                                )}
                                {chipTone && (
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${feedbackTone(entry.chipFeedback)}`}>
                                    선택지 {chipTone}
                                  </span>
                                )}
                                {entry.turnNumber != null && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                    Turn {entry.turnNumber}
                                  </span>
                                )}
                              </div>
                              <div className="line-clamp-1 text-sm font-medium text-gray-900">
                                질문: {clipText(entry.userMessage ?? entry.lastUserMessage, 80)}
                              </div>
                              <div className="line-clamp-2 text-sm text-gray-600">
                                응답: {clipText(entry.aiResponse ?? entry.lastAiResponse, 180)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock size={12} />
                              {formatDateTime(entry.timestamp)}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </button>
                  )
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={selectedGeneralEntry != null} onOpenChange={open => !open && setSelectedGeneralEntry(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
          {selectedGeneralEntry && (
            <>
              <DialogHeader className="border-b px-6 py-5">
                <DialogTitle>의견 남기기 상세</DialogTitle>
                <DialogDescription>
                  {formatDateTime(selectedGeneralEntry.timestamp)} · {AUTHOR_TYPE_CONFIG[selectedGeneralEntry.authorType].label}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[calc(90vh-88px)]">
                <div className="space-y-6 px-6 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StarRating rating={selectedGeneralEntry.rating} />
                    {selectedGeneralEntry.authorName && (
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                        작성자 {selectedGeneralEntry.authorName}
                      </span>
                    )}
                    {selectedGeneralEntry.tags.map(tag => (
                      <span key={tag} className={`rounded-full px-2 py-1 text-xs ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600"}`}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <SectionTitle>의견 내용</SectionTitle>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm whitespace-pre-wrap text-gray-800">
                      {selectedGeneralEntry.comment}
                    </div>
                  </div>

                  {selectedGeneralEntry.intakeSummary && (
                    <div className="space-y-2">
                      <SectionTitle>선택 조건</SectionTitle>
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">
                        {selectedGeneralEntry.intakeSummary}
                      </div>
                    </div>
                  )}

                  {selectedGeneralEntry.recommendationSummary && (
                    <div className="space-y-2">
                      <SectionTitle>추천 요약</SectionTitle>
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm whitespace-pre-wrap text-gray-700">
                        {selectedGeneralEntry.recommendationSummary}
                      </div>
                    </div>
                  )}

                  {selectedGeneralEntry.chatHistory && selectedGeneralEntry.chatHistory.length > 0 && (
                    <div className="space-y-2">
                      <SectionTitle>대화 내역</SectionTitle>
                      <div className="space-y-3 rounded-3xl border border-gray-200 bg-slate-50 p-4">
                        {selectedGeneralEntry.chatHistory.map((message, index) => (
                          <MessageBubble key={`${selectedGeneralEntry.id}-${index}`} role={message.role} text={message.text} />
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedGeneralEntry.screenshotPaths && selectedGeneralEntry.screenshotPaths.length > 0 && (
                    <div className="space-y-2">
                      <SectionTitle>첨부 파일</SectionTitle>
                      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
                        {selectedGeneralEntry.screenshotPaths.map(path => (
                          <a
                            key={path}
                            href={buildFeedbackFileUrl(path)}
                            target="_blank"
                            rel="noreferrer"
                            className="group overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 transition-colors hover:border-blue-200 hover:bg-blue-50"
                          >
                            <img
                              src={buildFeedbackFileUrl(path)}
                              alt={path}
                              className="h-48 w-full object-contain bg-white"
                            />
                            <div className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600 group-hover:text-blue-700">
                              {path}
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">
                    ID: {selectedGeneralEntry.id}
                    <br />
                    Session: {selectedGeneralEntry.sessionId ?? "N/A"}
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={selectedFeedbackEntry != null} onOpenChange={open => !open && setSelectedFeedbackEntry(null)}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[96vw] sm:max-w-[96vw] xl:w-[1400px] xl:max-w-[1400px] overflow-hidden p-0">
          {selectedFeedbackEntry && (
            <>
              <DialogHeader className="border-b px-6 py-5">
                <DialogTitle className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-xs ${EVENT_TYPE_CONFIG[selectedFeedbackEntry.type].cls}`}>
                    {EVENT_TYPE_CONFIG[selectedFeedbackEntry.type].label}
                  </span>
                  피드백 상세
                </DialogTitle>
                <DialogDescription>
                  {formatDateTime(selectedFeedbackEntry.timestamp)}
                  {selectedFeedbackEntry.sessionId ? ` · ${selectedFeedbackEntry.sessionId}` : ""}
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[calc(92vh-88px)]">
                <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr]">
                  <div className="space-y-4">
                    <SectionTitle>대화 흐름</SectionTitle>
                    <div className="space-y-3 rounded-3xl border border-gray-200 bg-slate-50 p-4">
                      {selectedFeedbackEntry.conversationSnapshot && selectedFeedbackEntry.conversationSnapshot.length > 0 ? (
                        selectedFeedbackEntry.conversationSnapshot.map(message => (
                          <MessageBubble
                            key={`${selectedFeedbackEntry.id}-${message.index ?? message.createdAt ?? message.text.slice(0, 10)}`}
                            role={message.role}
                            text={message.text}
                            chips={message.chips}
                          />
                        ))
                      ) : selectedFeedbackEntry.chatHistory && selectedFeedbackEntry.chatHistory.length > 0 ? (
                        selectedFeedbackEntry.chatHistory.map((message, index) => (
                          <MessageBubble key={`${selectedFeedbackEntry.id}-history-${index}`} role={message.role} text={message.text} />
                        ))
                      ) : (
                        <>
                          {(selectedFeedbackEntry.userMessage ?? selectedFeedbackEntry.lastUserMessage) && (
                            <MessageBubble role="user" text={selectedFeedbackEntry.userMessage ?? selectedFeedbackEntry.lastUserMessage ?? ""} />
                          )}
                          {(selectedFeedbackEntry.aiResponse ?? selectedFeedbackEntry.lastAiResponse) && (
                            <MessageBubble role="ai" text={selectedFeedbackEntry.aiResponse ?? selectedFeedbackEntry.lastAiResponse ?? ""} chips={selectedFeedbackEntry.chips} />
                          )}
                        </>
                      )}
                    </div>
                    <RecommendedProducts entry={selectedFeedbackEntry} />
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-3">
                      <SectionTitle>피드백 결과</SectionTitle>
                      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-600">응답 평가</span>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${feedbackTone(selectedFeedbackEntry.responseFeedback ?? selectedFeedbackEntry.feedback)}`}>
                            {formatFeedbackLabel(selectedFeedbackEntry.responseFeedback ?? selectedFeedbackEntry.feedback) ?? "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-600">선택지 평가</span>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${feedbackTone(selectedFeedbackEntry.chipFeedback)}`}>
                            {formatFeedbackLabel(selectedFeedbackEntry.chipFeedback) ?? "-"}
                          </span>
                        </div>
                        {selectedFeedbackEntry.userComment && (
                          <div className="space-y-1">
                            <div className="text-sm text-gray-600">사용자 코멘트</div>
                            <div className="rounded-xl bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-800">
                              {selectedFeedbackEntry.userComment}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <SectionTitle>요약 정보</SectionTitle>
                      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">질문</span>
                          <span className="max-w-[70%] text-right text-gray-800">{clipText(selectedFeedbackEntry.userMessage ?? selectedFeedbackEntry.lastUserMessage, 70)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">응답</span>
                          <span className="max-w-[70%] text-right text-gray-800">{clipText(selectedFeedbackEntry.aiResponse ?? selectedFeedbackEntry.lastAiResponse, 90)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">후보 수</span>
                          <span className="text-gray-800">{selectedFeedbackEntry.candidateCount ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-gray-500">대화 길이</span>
                          <span className="text-gray-800">{selectedFeedbackEntry.conversationLength ?? "-"}</span>
                        </div>
                        {selectedFeedbackEntry.turnNumber != null && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-gray-500">Turn</span>
                            <span className="text-gray-800">{selectedFeedbackEntry.turnNumber}</span>
                          </div>
                        )}
                        {selectedFeedbackEntry.conditions && (
                          <div className="space-y-1">
                            <div className="text-gray-500">선택 조건</div>
                            <div className="rounded-xl bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-800">
                              {selectedFeedbackEntry.conditions}
                            </div>
                          </div>
                        )}
                        {selectedFeedbackEntry.appliedFilters.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-gray-500">적용 필터</div>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedFeedbackEntry.appliedFilters.map(filter => (
                                <span key={filter} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                                  {filter}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
