"use client"

/**
 * /products — YG-1 Product Recommendation Page
 *
 * Data-grounded: every product shown is from real normalized data.
 * Hallucination prevention enforced at API layer (/api/recommend).
 *
 * Layout (mobile-first):
 *   - Mobile: single column, chat + results toggle
 *   - Desktop: 2-panel (chat | results)
 */

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Send, RefreshCw, AlertTriangle, CheckCircle2, Info,
  Package, Clock, ChevronDown, ChevronUp, Database,
  Zap, AlertCircle
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type {
  RecommendationResult, ScoredProduct, LLMRecommendResponse
} from "@/lib/types/canonical"

// ── Types ─────────────────────────────────────────────────────
interface Msg {
  id: string
  role: "user" | "ai"
  text: string
  chips?: string[]
  recommendation?: RecommendationResult | null
  msgId?: string
}

type Phase = "idle" | "chatting" | "complete"

// ── Config ────────────────────────────────────────────────────
const STATUS_CONFIG = {
  exact: {
    label: "정확 매칭",
    className: "bg-green-100 text-green-800 border-green-300",
    Icon: CheckCircle2,
    iconClass: "text-green-600",
  },
  approximate: {
    label: "근사 후보",
    className: "bg-amber-100 text-amber-800 border-amber-300",
    Icon: AlertTriangle,
    iconClass: "text-amber-600",
  },
  none: {
    label: "매칭 없음",
    className: "bg-red-100 text-red-800 border-red-300",
    Icon: AlertCircle,
    iconClass: "text-red-600",
  },
}

const STOCK_CONFIG = {
  instock: { label: "재고 있음", className: "bg-green-100 text-green-700", dot: "bg-green-500" },
  limited: { label: "소량 재고", className: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  outofstock: { label: "재고 없음", className: "bg-red-100 text-red-700", dot: "bg-red-500" },
  unknown: { label: "재고 미확인", className: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
}

const QUICK_STARTS = [
  { label: "알루미늄 황삭 φ6mm", text: "알루미늄 황삭 가공에 6mm 엔드밀 추천해줘" },
  { label: "SUS 정삭 4날", text: "스테인리스 정삭용 4날 엔드밀 추천" },
  { label: "고경도강 가공", text: "고경도강 HRC45 가공용 엔드밀 있어?" },
  { label: "티타늄 φ10mm", text: "티타늄 합금 가공 10mm 추천" },
]

// ── Small components ───────────────────────────────────────────
function MatchBadge({ status }: { status: "exact" | "approximate" | "none" }) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.Icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.className}`}>
      <Icon size={11} className={cfg.iconClass} />
      {cfg.label}
    </span>
  )
}

function StockBadge({ status, total }: { status: string; total: number | null }) {
  const cfg = STOCK_CONFIG[status as keyof typeof STOCK_CONFIG] ?? STOCK_CONFIG.unknown
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
      {total !== null && total > 0 && <span>({total})</span>}
    </span>
  )
}

function SpecRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value == null) return null
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-900">{value}</span>
    </div>
  )
}

function ProductCard({ scored, rank, isAlternative = false }: {
  scored: ScoredProduct; rank: number; isAlternative?: boolean
}) {
  const [open, setOpen] = useState(!isAlternative)
  const p = scored.product

  return (
    <Card className={`border ${isAlternative ? "border-gray-200" : "border-blue-200 shadow-sm"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs text-gray-400 font-mono">#{rank}</span>
              <MatchBadge status={scored.matchStatus} />
              <StockBadge status={scored.stockStatus} total={scored.totalStock} />
            </div>
            <div className="font-mono text-sm font-bold text-gray-900">{p.displayCode}</div>
            {p.seriesName && <div className="text-xs text-blue-700 font-medium">{p.seriesName}</div>}
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          {/* Specs */}
          <div className="bg-gray-50 rounded-lg p-3">
            <SpecRow label="직경" value={p.diameterMm != null ? `φ${p.diameterMm}mm` : null} />
            <SpecRow label="날 수" value={p.fluteCount != null ? `${p.fluteCount}날` : null} />
            <SpecRow label="코팅" value={p.coating} />
            <SpecRow label="공구 소재" value={p.toolMaterial} />
            <SpecRow label="섕크 직경" value={p.shankDiameterMm != null ? `${p.shankDiameterMm}mm` : null} />
            <SpecRow label="절삭 길이" value={p.lengthOfCutMm != null ? `${p.lengthOfCutMm}mm` : null} />
            <SpecRow label="전체 길이" value={p.overallLengthMm != null ? `${p.overallLengthMm}mm` : null} />
            <SpecRow label="나선각" value={p.helixAngleDeg != null ? `${p.helixAngleDeg}°` : null} />
            <SpecRow label="냉각홀" value={p.coolantHole != null ? (p.coolantHole ? "있음" : "없음") : null} />
          </div>

          {/* Material tags */}
          {p.materialTags.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">적용 소재</div>
              <div className="flex flex-wrap gap-1">
                {p.materialTags.map(t => (
                  <Badge key={t} variant="secondary" className="text-xs">{t}군</Badge>
                ))}
              </div>
            </div>
          )}

          {/* App shapes */}
          {p.applicationShapes.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">가공 형태</div>
              <div className="flex flex-wrap gap-1">
                {p.applicationShapes.slice(0, 4).map(s => (
                  <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Feature text */}
          {p.featureText && (
            <div>
              <div className="text-xs text-gray-500 mb-1">시리즈 특징</div>
              <div className="text-xs text-gray-700 leading-relaxed">
                {p.featureText.substring(0, 180)}{p.featureText.length > 180 ? "…" : ""}
              </div>
            </div>
          )}

          {/* Inventory */}
          {scored.inventory.filter(s => s.quantity != null && s.quantity > 0).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Package size={10} />재고 현황
                {scored.inventory[0]?.snapshotDate && (
                  <span className="text-gray-400">(기준일: {scored.inventory[0].snapshotDate})</span>
                )}
              </div>
              <div className="space-y-1">
                {scored.inventory.filter(s => s.quantity != null && s.quantity > 0).slice(0, 5).map((s, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-gray-600">{s.warehouseOrRegion}</span>
                    <span className="font-medium">{s.quantity?.toLocaleString()}개</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lead time */}
          {scored.leadTimes.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Clock size={10} />표준 납기
              </div>
              <div className="space-y-1">
                {scored.leadTimes.slice(0, 4).map((lt, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-gray-600">Plant {lt.plant}</span>
                    <span className="font-medium">{lt.leadTimeDays != null ? `${lt.leadTimeDays}일` : "정보 없음"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match rationale */}
          {scored.matchedFields.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">매칭 근거</div>
              <div className="flex flex-wrap gap-1">
                {scored.matchedFields.map((f, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Source */}
          <div className="pt-1 border-t border-gray-100">
            <div className="flex items-center gap-1">
              <Database size={10} className="text-gray-400" />
              <span className="text-xs text-gray-500">{p.rawSourceFile}</span>
              {p.rawSourceSheet && <span className="text-xs text-gray-400">/ {p.rawSourceSheet}</span>}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              데이터 완성도 {Math.round(p.dataCompletenessScore * 100)}% · 신뢰도: {p.sourceConfidence ?? "N/A"}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function RecommendationPanel({ result }: { result: RecommendationResult }) {
  const { status, primaryProduct, alternatives, warnings, deterministicSummary, totalCandidatesConsidered } = result

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MatchBadge status={status} />
          <span className="text-xs text-gray-500">{totalCandidatesConsidered}개 후보 검색</span>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {warnings.map((w, i) => <div key={i} className="text-xs text-amber-800">{w}</div>)}
          </div>
        </div>
      )}

      {/* Deterministic summary */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed">
        {deterministicSummary}
      </div>

      {/* Primary */}
      {primaryProduct && (
        <div>
          <div className="flex items-center gap-1 text-xs font-semibold text-gray-700 mb-2">
            <Zap size={12} className="text-blue-600" />추천 제품
          </div>
          <ProductCard scored={primaryProduct} rank={1} />
        </div>
      )}

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">대체 후보 ({alternatives.length})</div>
          <div className="space-y-2">
            {alternatives.map((alt, i) => (
              <ProductCard key={alt.product.id} scored={alt} rank={i + 2} isAlternative />
            ))}
          </div>
        </div>
      )}

      {status === "none" && (
        <div className="text-center py-8">
          <AlertCircle size={32} className="text-gray-200 mx-auto mb-2" />
          <div className="text-sm text-gray-500">조건에 맞는 제품 없음</div>
          <div className="text-xs text-gray-400 mt-1">직경이나 소재 조건을 조정해보세요</div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function ProductRecommendPage() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [messages, setMessages] = useState<Msg[]>([])
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "ai"; text: string }[]>([])
  const [answeredMsgIds, setAnsweredMsgIds] = useState<Set<string>>(new Set())
  const [inputText, setInputText] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [latestResult, setLatestResult] = useState<RecommendationResult | null>(null)
  const [showResults, setShowResults] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isTyping])

  const callAPI = useCallback(async (history: { role: "user" | "ai"; text: string }[]) => {
    setIsTyping(true)
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      })
      const data: LLMRecommendResponse = await res.json()
      if (data.error) throw new Error(data.detail ?? data.error)

      const msgId = `ai_${Date.now()}`
      const aiMsg: Msg = { id: msgId, role: "ai", text: data.text, chips: data.chips, recommendation: data.recommendation, msgId }
      setChatHistory(h => [...h, { role: "ai", text: data.text }])
      setMessages(m => [...m, aiMsg])

      if (data.isComplete && data.recommendation) {
        setLatestResult(data.recommendation)
        setShowResults(true)
        setPhase("complete")
      }
    } catch (err) {
      setMessages(m => [...m, {
        id: `err_${Date.now()}`, role: "ai",
        text: `오류: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
        chips: ["처음부터 다시"],
      }])
    } finally {
      setIsTyping(false)
    }
  }, [])

  const startChat = useCallback((text: string) => {
    setPhase("chatting")
    setMessages([{ id: "u0", role: "user", text }])
    setLatestResult(null)
    setShowResults(false)
    const hist = [{ role: "user" as const, text }]
    setChatHistory(hist)
    callAPI(hist)
  }, [callAPI])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text || isTyping) return
    setInputText("")
    if (phase === "idle" || phase === "complete") { startChat(text); return }
    const msg: Msg = { id: `u_${Date.now()}`, role: "user", text }
    setMessages(m => [...m, msg])
    const hist = [...chatHistory, { role: "user" as const, text }]
    setChatHistory(hist)
    callAPI(hist)
  }, [inputText, isTyping, phase, chatHistory, startChat, callAPI])

  const handleChip = useCallback((chip: string, msgId: string) => {
    setAnsweredMsgIds(s => new Set([...s, msgId]))
    const msg: Msg = { id: `u_${Date.now()}`, role: "user", text: chip }
    setMessages(m => [...m, msg])
    const hist = [...chatHistory, { role: "user" as const, text: chip }]
    setChatHistory(hist)
    callAPI(hist)
  }, [chatHistory, callAPI])

  const handleReset = () => {
    setPhase("idle"); setMessages([]); setChatHistory([])
    setAnsweredMsgIds(new Set()); setLatestResult(null)
    setShowResults(false); setInputText("")
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white shrink-0">
        <div>
          <h1 className="text-base font-bold text-gray-900">YG-1 제품 추천</h1>
          <p className="text-xs text-gray-500">실제 카탈로그 데이터 기반 · 없는 제품은 생성하지 않음</p>
        </div>
        {phase !== "idle" && (
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1 text-xs">
            <RefreshCw size={12} />처음부터
          </Button>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Chat panel */}
        <div className={`flex flex-col flex-1 min-w-0 ${showResults ? "hidden md:flex" : "flex"}`}>

          {/* Idle */}
          {phase === "idle" && (
            <div className="flex-1 overflow-y-auto px-4 py-8">
              <div className="max-w-lg mx-auto">
                <div className="text-center mb-8">
                  <div className="text-4xl mb-3">🔧</div>
                  <h2 className="text-lg font-bold text-gray-900 mb-2">어떤 공구를 찾고 계신가요?</h2>
                  <p className="text-sm text-gray-500">소재, 직경, 가공 방식을 알려주시면<br />실제 YG-1 카탈로그에서 매칭 제품을 찾아드립니다.</p>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-6">
                  {QUICK_STARTS.map(qs => (
                    <button key={qs.label} onClick={() => startChat(qs.text)}
                      className="text-left p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                      <div className="text-xs font-semibold text-gray-700">{qs.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5 leading-tight">{qs.text}</div>
                    </button>
                  ))}
                </div>

                <div className="p-3 bg-blue-50 rounded-lg flex items-start gap-2">
                  <Info size={12} className="text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-700">
                    <strong>샘플 데이터:</strong> YG-1 Smart Catalog 100 EDP + CSV 35개 (총 135개)
                    · 재고 300 EDPs · 납기 337건
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {phase !== "idle" && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[85%]">
                    <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-sm"
                        : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                    }`}>
                      {msg.text}
                    </div>

                    {msg.role === "ai" && msg.chips && msg.msgId && !answeredMsgIds.has(msg.msgId) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {msg.chips.map((chip, i) => (
                          <button key={i} onClick={() => handleChip(chip, msg.msgId!)}
                            className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-blue-700 text-xs font-medium hover:bg-blue-50 transition-colors">
                            {chip}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Mobile: view results button */}
                    {msg.recommendation && (
                      <button onClick={() => setShowResults(true)}
                        className="md:hidden mt-2 w-full py-2 bg-blue-600 text-white text-xs rounded-lg font-medium">
                        추천 결과 보기 →
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 px-4 py-3 bg-white border-t">
            <div className="flex gap-2 items-end max-w-lg mx-auto md:max-w-none">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder="소재, 직경, 가공 방식 입력... (예: 알루미늄 황삭 6mm)"
                className="flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[44px] max-h-[120px]"
                rows={1}
              />
              <Button onClick={handleSend} disabled={!inputText.trim() || isTyping}
                size="sm" className="rounded-xl h-11 w-11 p-0 shrink-0">
                <Send size={16} />
              </Button>
            </div>
          </div>
        </div>

        {/* Results panel */}
        <div className={`bg-gray-50 border-l flex-col overflow-y-auto
          w-full md:w-96 lg:w-[480px] shrink-0
          ${showResults ? "flex" : "hidden md:flex"}`}>

          {/* Mobile back */}
          <button onClick={() => setShowResults(false)}
            className="md:hidden flex items-center gap-1 px-4 py-3 text-xs text-blue-600 font-medium border-b bg-white shrink-0">
            ← 채팅으로 돌아가기
          </button>

          <div className="px-4 py-4 space-y-4 flex-1">
            {!latestResult ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Package size={48} className="text-gray-200 mb-4" />
                <div className="text-sm text-gray-400">질문에 답하시면<br />추천 결과가 여기 표시됩니다</div>
                <div className="text-xs text-gray-300 mt-2">실제 카탈로그 데이터만 표시</div>
              </div>
            ) : (
              <RecommendationPanel result={latestResult} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
