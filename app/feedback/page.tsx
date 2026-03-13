"use client"

/**
 * /feedback — Feedback Viewer Page
 *
 * Shows all feedback entries with filtering.
 * Accessible to admin/developers for reviewing chatbot performance.
 */

import { useState, useEffect } from "react"
import { Star, User, Clock, Tag, MessageCircle, ChevronDown, ChevronUp, ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

interface FeedbackEntry {
  id: string
  timestamp: string
  authorType: "internal" | "customer" | "anonymous"
  authorName: string
  sessionId: string | null
  intakeSummary: string | null
  chatHistory: Array<{ role: string; text: string }> | null
  recommendationSummary: string | null
  rating: number | null
  comment: string
  tags: string[]
}

const AUTHOR_TYPE_CONFIG = {
  internal: { label: "내부 개발팀", cls: "bg-blue-100 text-blue-700" },
  customer: { label: "고객사", cls: "bg-green-100 text-green-700" },
  anonymous: { label: "익명", cls: "bg-gray-100 text-gray-600" },
}

const TAG_COLORS: Record<string, string> = {
  "wrong-product": "bg-red-100 text-red-700",
  "good-result": "bg-green-100 text-green-700",
  "slow-response": "bg-amber-100 text-amber-700",
  "missing-evidence": "bg-purple-100 text-purple-700",
  "ui-issue": "bg-orange-100 text-orange-700",
  "good-evidence": "bg-emerald-100 text-emerald-700",
  "wrong-condition": "bg-red-100 text-red-700",
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

export default function FeedbackViewerPage() {
  const [entries, setEntries] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "internal" | "customer" | "anonymous">("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const fetchFeedback = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/feedback")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchFeedback() }, [])

  const filtered = filter === "all"
    ? entries
    : entries.filter(e => e.authorType === filter)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Stats
  const totalFeedback = entries.length
  const avgRating = entries.filter(e => e.rating != null).length > 0
    ? (entries.filter(e => e.rating != null).reduce((sum, e) => sum + (e.rating ?? 0), 0) / entries.filter(e => e.rating != null).length).toFixed(1)
    : "-"
  const internalCount = entries.filter(e => e.authorType === "internal").length
  const customerCount = entries.filter(e => e.authorType === "customer").length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/products">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft size={14} />돌아가기
              </Button>
            </Link>
            <div>
              <h1 className="text-lg font-bold text-gray-900">피드백 관리</h1>
              <p className="text-xs text-gray-500">챗봇 결과에 대한 내부/고객 의견</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchFeedback} className="gap-1">
            <RefreshCw size={12} />새로고침
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="py-2">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-gray-900">{totalFeedback}</div>
              <div className="text-xs text-gray-500">총 피드백</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">{avgRating}</div>
              <div className="text-xs text-gray-500">평균 평점</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{internalCount}</div>
              <div className="text-xs text-gray-500">내부 의견</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardContent className="p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{customerCount}</div>
              <div className="text-xs text-gray-500">고객 의견</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {(["all", "internal", "customer", "anonymous"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {f === "all" ? "전체" : AUTHOR_TYPE_CONFIG[f].label} ({f === "all" ? entries.length : entries.filter(e => e.authorType === f).length})
            </button>
          ))}
        </div>

        {/* Entries */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">로딩 중...</div>
        ) : error ? (
          <div className="text-center py-12 text-red-500">오류: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <MessageCircle size={32} className="mx-auto mb-2 opacity-50" />
            <div>피드백이 없습니다</div>
            <div className="text-xs mt-1">제품 추천 페이지에서 피드백을 남겨주세요</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(entry => {
              const isExpanded = expanded.has(entry.id)
              const authorCfg = AUTHOR_TYPE_CONFIG[entry.authorType]
              return (
                <Card key={entry.id} className="overflow-hidden py-0">
                  <CardHeader
                    className="cursor-pointer py-3 px-4"
                    onClick={() => toggleExpand(entry.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <StarRating rating={entry.rating} />
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${authorCfg.cls}`}>
                          {authorCfg.label}
                        </span>
                        {entry.authorName && (
                          <span className="text-xs text-gray-600 font-medium flex items-center gap-1">
                            <User size={10} />{entry.authorName}
                          </span>
                        )}
                        {entry.tags.map(tag => (
                          <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded ${TAG_COLORS[tag] ?? "bg-gray-100 text-gray-600"}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(entry.timestamp).toLocaleString("ko-KR")}
                        </span>
                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </div>
                    </div>
                    <p className="text-sm text-gray-700 mt-1.5 line-clamp-2">{entry.comment}</p>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent className="pt-0 px-4 pb-4 border-t bg-gray-50 space-y-3">
                      {/* Full comment */}
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-1">의견</div>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{entry.comment}</p>
                      </div>

                      {/* Intake summary */}
                      {entry.intakeSummary && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">입력 조건</div>
                          <p className="text-xs text-gray-600 bg-white rounded p-2 border whitespace-pre-wrap">{entry.intakeSummary}</p>
                        </div>
                      )}

                      {/* Chat history */}
                      {entry.chatHistory && entry.chatHistory.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">대화 내역</div>
                          <div className="bg-white rounded border p-2 space-y-1.5 max-h-60 overflow-y-auto">
                            {entry.chatHistory.map((msg, mi) => (
                              <div key={mi} className={`text-xs ${msg.role === "user" ? "text-blue-700" : "text-gray-600"}`}>
                                <span className="font-semibold">{msg.role === "user" ? "고객" : "AI"}:</span>{" "}
                                <span className="whitespace-pre-wrap">{msg.text.slice(0, 300)}{msg.text.length > 300 ? "..." : ""}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Recommendation summary */}
                      {entry.recommendationSummary && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-1">추천 결과</div>
                          <p className="text-xs text-gray-600 bg-white rounded p-2 border whitespace-pre-wrap">{entry.recommendationSummary}</p>
                        </div>
                      )}

                      {/* Metadata */}
                      <div className="text-[10px] text-gray-400 pt-1 border-t">
                        ID: {entry.id} | Session: {entry.sessionId ?? "N/A"}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
