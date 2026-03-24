"use client"

import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  RefreshCw,
  ChevronLeft,
  Star,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import type { FeedbackListResponseDto, FeedbackEntryDto, FeedbackEventEntryDto } from "@/lib/contracts/feedback"

interface FeedbackAnalyticsProps {
  onBack: () => void
}

export function FeedbackAnalytics({ onBack }: FeedbackAnalyticsProps) {
  const [data, setData] = useState<FeedbackListResponseDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/feedback")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "피드백 로드 실패")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const stats = useMemo(() => {
    if (!data) return null

    const general = data.generalEntries ?? []
    const events = data.feedbackEntries ?? []

    // Turn feedback stats
    const turnFeedbacks = events.filter(e => e.type === "turn_feedback")
    const positive = turnFeedbacks.filter(e => e.feedback === "positive").length
    const negative = turnFeedbacks.filter(e => e.feedback === "negative").length
    const neutral = turnFeedbacks.filter(e => e.feedback === "neutral").length
    const totalTurn = turnFeedbacks.length

    // Response vs Chip feedback
    const responsePositive = turnFeedbacks.filter(e => e.responseFeedback === "positive").length
    const responseNegative = turnFeedbacks.filter(e => e.responseFeedback === "negative").length
    const chipPositive = turnFeedbacks.filter(e => e.chipFeedback === "positive").length
    const chipNegative = turnFeedbacks.filter(e => e.chipFeedback === "negative").length

    // Success/failure cases
    const successCases = events.filter(e => e.type === "success_case").length
    const failureCases = events.filter(e => e.type === "failure_case").length

    // Rating distribution
    const ratings: number[] = general.filter(g => g.rating != null).map(g => g.rating!)
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0
    const ratingDist = [1, 2, 3, 4, 5].map(r => ({
      rating: r,
      count: ratings.filter(v => v === r).length,
    }))

    // Tag distribution
    const tagCounts = new Map<string, number>()
    for (const g of general) {
      for (const tag of g.tags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
    const tagDistribution = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }))

    // Time trend (by date)
    const dateCounts = new Map<string, { positive: number; negative: number; total: number }>()
    for (const e of turnFeedbacks) {
      const date = e.timestamp?.slice(0, 10) ?? "unknown"
      const entry = dateCounts.get(date) ?? { positive: 0, negative: 0, total: 0 }
      entry.total++
      if (e.feedback === "positive") entry.positive++
      if (e.feedback === "negative") entry.negative++
      dateCounts.set(date, entry)
    }
    const timeTrend = Array.from(dateCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14) // last 14 days
      .map(([date, counts]) => ({ date: date.slice(5), ...counts }))

    // Mode distribution
    const modeCounts = new Map<string, number>()
    for (const e of turnFeedbacks) {
      const mode = e.mode ?? "unknown"
      modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1)
    }

    // Conversation length for success/failure
    const successLengths = events
      .filter(e => e.type === "success_case" && e.conversationLength)
      .map(e => e.conversationLength!)
    const failureLengths = events
      .filter(e => e.type === "failure_case" && e.conversationLength)
      .map(e => e.conversationLength!)
    const avgSuccessLength = successLengths.length > 0
      ? Math.round(successLengths.reduce((a, b) => a + b, 0) / successLengths.length)
      : 0
    const avgFailureLength = failureLengths.length > 0
      ? Math.round(failureLengths.reduce((a, b) => a + b, 0) / failureLengths.length)
      : 0

    // Recent feedback entries (latest 10)
    const recentGeneral = [...general].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10)
    const recentEvents = [...turnFeedbacks].sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? "")).slice(0, 10)

    return {
      totalGeneral: general.length,
      totalEvents: events.length,
      totalTurn,
      positive, negative, neutral,
      positiveRate: totalTurn > 0 ? Math.round((positive / totalTurn) * 100) : 0,
      responsePositive, responseNegative,
      chipPositive, chipNegative,
      successCases, failureCases,
      successRate: (successCases + failureCases) > 0
        ? Math.round((successCases / (successCases + failureCases)) * 100) : 0,
      avgRating: Math.round(avgRating * 10) / 10,
      ratingDist,
      tagDistribution,
      timeTrend,
      modeCounts: Array.from(modeCounts.entries()).sort((a, b) => b[1] - a[1]),
      avgSuccessLength,
      avgFailureLength,
      recentGeneral,
      recentEvents,
    }
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">피드백 데이터 로딩 중...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-600">{error}</p>
        <Button variant="outline" className="mt-4" onClick={fetchData}>다시 시도</Button>
      </div>
    )
  }

  if (!stats) return null

  const TAG_LABELS: Record<string, string> = {
    "wrong-product": "잘못된 추천",
    "good-result": "좋은 결과",
    "slow-response": "느린 응답",
    "missing-evidence": "근거 부족",
    "ui-issue": "UI 문제",
    "wrong-condition": "잘못된 조건",
    "good-evidence": "좋은 근거",
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" /> 돌아가기
          </Button>
          <h2 className="text-xl font-bold">피드백 분석</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData}>
          <RefreshCw className="h-4 w-4 mr-1" /> 새로고침
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">총 피드백</p>
                <p className="text-2xl font-bold">{stats.totalGeneral + stats.totalEvents}</p>
              </div>
              <MessageSquare className="h-8 w-8 text-blue-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              일반 {stats.totalGeneral} + 이벤트 {stats.totalEvents}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">긍정률</p>
                <p className="text-2xl font-bold text-green-600">{stats.positiveRate}%</p>
              </div>
              <ThumbsUp className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.positive}건 긍정 / {stats.totalTurn}건 턴 피드백
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">성공률</p>
                <p className="text-2xl font-bold text-blue-600">{stats.successRate}%</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-blue-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              성공 {stats.successCases} / 실패 {stats.failureCases}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">평균 별점</p>
                <p className="text-2xl font-bold text-amber-600">
                  {stats.avgRating > 0 ? `${stats.avgRating} / 5` : "—"}
                </p>
              </div>
              <Star className="h-8 w-8 text-amber-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.ratingDist.reduce((a, b) => a + b.count, 0)}건 평가
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Turn Feedback Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">턴별 피드백 분포</CardTitle>
            <CardDescription>{stats.totalTurn}건의 턴 피드백</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.totalTurn > 0 ? (
              <div className="space-y-3">
                <FeedbackBar label="긍정" count={stats.positive} total={stats.totalTurn} color="bg-green-500" />
                <FeedbackBar label="부정" count={stats.negative} total={stats.totalTurn} color="bg-red-500" />
                <FeedbackBar label="중립" count={stats.neutral} total={stats.totalTurn} color="bg-gray-400" />

                <div className="border-t pt-3 mt-3">
                  <p className="text-sm font-medium mb-2">응답 vs 칩 피드백</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">응답 평가</p>
                      <p><span className="text-green-600">{stats.responsePositive}</span> / <span className="text-red-600">{stats.responseNegative}</span></p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">칩 평가</p>
                      <p><span className="text-green-600">{stats.chipPositive}</span> / <span className="text-red-600">{stats.chipNegative}</span></p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">턴 피드백 데이터 없음</p>
            )}
          </CardContent>
        </Card>

        {/* Rating Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">별점 분포</CardTitle>
            <CardDescription>일반 피드백 별점</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.ratingDist.some(r => r.count > 0) ? (
              <div className="space-y-2">
                {[5, 4, 3, 2, 1].map(r => {
                  const item = stats.ratingDist.find(d => d.rating === r)!
                  const max = Math.max(...stats.ratingDist.map(d => d.count), 1)
                  return (
                    <div key={r} className="flex items-center gap-2">
                      <span className="text-sm w-12 text-right">{r}점</span>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all"
                          style={{ width: `${(item.count / max) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm w-8 text-muted-foreground">{item.count}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">별점 데이터 없음</p>
            )}
          </CardContent>
        </Card>

        {/* Tag Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">태그 분포</CardTitle>
            <CardDescription>피드백 태그 빈도</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.tagDistribution.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {stats.tagDistribution.map(({ tag, count }) => (
                  <Badge key={tag} variant={tag.includes("good") ? "default" : "secondary"} className="text-sm">
                    {TAG_LABELS[tag] ?? tag} ({count})
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">태그 데이터 없음</p>
            )}
          </CardContent>
        </Card>

        {/* Conversation Length */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">대화 길이 비교</CardTitle>
            <CardDescription>성공 vs 실패 평균 턴 수</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="text-center">
                <CheckCircle2 className="h-6 w-6 text-green-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-green-600">{stats.avgSuccessLength || "—"}</p>
                <p className="text-sm text-muted-foreground">성공 평균 턴</p>
              </div>
              <div className="text-center">
                <XCircle className="h-6 w-6 text-red-500 mx-auto mb-1" />
                <p className="text-2xl font-bold text-red-600">{stats.avgFailureLength || "—"}</p>
                <p className="text-sm text-muted-foreground">실패 평균 턴</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Daily Trend */}
        {stats.timeTrend.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">일별 피드백 트렌드</CardTitle>
              <CardDescription>최근 14일</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {stats.timeTrend.map(day => {
                  const max = Math.max(...stats.timeTrend.map(d => d.total), 1)
                  return (
                    <div key={day.date} className="flex items-center gap-2 text-sm">
                      <span className="w-12 text-muted-foreground">{day.date}</span>
                      <div className="flex-1 flex gap-0.5 h-4">
                        {day.positive > 0 && (
                          <div
                            className="bg-green-500 rounded-sm"
                            style={{ width: `${(day.positive / max) * 100}%` }}
                            title={`긍정 ${day.positive}`}
                          />
                        )}
                        {day.negative > 0 && (
                          <div
                            className="bg-red-500 rounded-sm"
                            style={{ width: `${(day.negative / max) * 100}%` }}
                            title={`부정 ${day.negative}`}
                          />
                        )}
                        {(day.total - day.positive - day.negative) > 0 && (
                          <div
                            className="bg-gray-300 rounded-sm"
                            style={{ width: `${((day.total - day.positive - day.negative) / max) * 100}%` }}
                            title={`중립 ${day.total - day.positive - day.negative}`}
                          />
                        )}
                      </div>
                      <span className="w-8 text-right text-muted-foreground">{day.total}</span>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-green-500" /> 긍정</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-red-500" /> 부정</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-sm bg-gray-300" /> 중립</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent General Feedback */}
        {stats.recentGeneral.length > 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">최근 일반 피드백</CardTitle>
              <CardDescription>최근 10건</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stats.recentGeneral.map(entry => (
                  <div key={entry.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{entry.authorType}</Badge>
                        <span className="text-sm font-medium">{entry.authorName}</span>
                        {entry.rating && (
                          <span className="text-amber-500 text-sm">{"★".repeat(entry.rating)}{"☆".repeat(5 - entry.rating)}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{entry.timestamp.slice(0, 10)}</span>
                    </div>
                    <p className="text-sm">{entry.comment}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {entry.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">{TAG_LABELS[tag] ?? tag}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function FeedbackBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-10">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm w-16 text-right text-muted-foreground">{count}건 ({pct}%)</span>
    </div>
  )
}
