"use client"

import { useState, useRef, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Markdown } from "@/components/ui/markdown"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import {
  Send, Sparkles, HelpCircle, CheckCircle2, AlertTriangle,
  ChevronRight, Package, Settings, Layers, Ruler,
  ArrowRight, Upload, MessageSquare, Zap, Shield,
  Target, BarChart3
} from "lucide-react"
import { wowScenarios, candidateProducts, type CandidateProduct } from "@/lib/demo-data"
import { parseChatResponse } from "@/lib/frontend/chat/chat-client"
import type { ChatResponseDto } from "@/lib/contracts/chat"
import { findVideosForProduct, countryToLanguage } from "@/lib/data/video-mapping"
import { findCatalogsForProduct } from "@/lib/data/catalog-mapping"
import { useApp } from "@/lib/frontend/app-context"

// ── Typing animation hook ──
function useTypingAnimation() {
  const fullTextRef = useRef("")
  const displayedRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callbackRef = useRef<((text: string) => void) | null>(null)
  const doneCallbackRef = useRef<(() => void) | null>(null)

  const start = (fullText: string, onUpdate: (text: string) => void, onDone: () => void) => {
    stop()
    fullTextRef.current = fullText
    displayedRef.current = 0
    callbackRef.current = onUpdate
    doneCallbackRef.current = onDone

    timerRef.current = setInterval(() => {
      const full = fullTextRef.current
      const current = displayedRef.current
      if (current >= full.length) {
        stop()
        doneCallbackRef.current?.()
        return
      }
      // Variable speed: 2-5 chars per tick for natural feel
      const step = Math.min(full.length - current, 2 + Math.floor(Math.random() * 4))
      displayedRef.current = current + step
      callbackRef.current?.(full.slice(0, displayedRef.current))
    }, 25)
  }

  const stop = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => stop, [])

  return { start, stop }
}
import { cn } from "@/lib/utils"
import { DealerPopupTriggerButton } from "@/components/DealerLocator/DealerPopupTriggerButton"
import { LocationPermissionBanner } from "@/components/DealerLocator/LocationPermissionBanner"

// ===== TYPES =====

interface ChatProduct {
  displayCode: string
  seriesName: string | null
  brand: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  materialTags: string[]
  toolType: string | null
  toolSubtype: string | null
  toolMaterial: string | null
  featureText: string | null
  description: string | null
  seriesIconUrl: string | null
  shankDiameterMm: number | null
  lengthOfCutMm: number | null
  overallLengthMm: number | null
  helixAngleDeg: number | null
  stockStatus?: "instock" | "limited" | "outofstock" | "unknown"
  totalStock?: number | null
}

interface ChatMessage {
  id: string
  role: "user" | "ai" | "system"
  text: string
  purpose?: string
  chips?: string[]
  products?: ChatProduct[]
  timestamp: string
}

interface ExtractedField {
  label: string
  value: string | null
  confidence: "high" | "medium" | "low" | null
  step: number
}

const STEPS = [
  { id: 0, label: "문의 접수", icon: MessageSquare },
  { id: 1, label: "장비 조건", icon: Settings },
  { id: 2, label: "소재 분석", icon: Layers },
  { id: 3, label: "가공 목적", icon: Target },
  { id: 4, label: "형상/제약", icon: Ruler },
  { id: 5, label: "추천/실행", icon: Package },
]

// ===== COMPONENT =====

export default function AssistantNewPage() {
  const searchParams = useSearchParams()
  const { country } = useApp()
  const scenarioId = searchParams.get("scenario")
  const scenario = wowScenarios.find(s => s.id === scenarioId)
  const preferredLang = countryToLanguage(country)

  const [mode, setMode] = useState<"simple" | "precision">("simple")
  const [currentStep, setCurrentStep] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [typing, setTyping] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedField[]>([])
  const [completeness, setCompleteness] = useState(0)
  const [showResult, setShowResult] = useState(false)
  const [chatProducts, setChatProducts] = useState<ChatProduct[]>([])
  const [uncertainty, setUncertainty] = useState(100)
  const [candidates, setCandidates] = useState(120)
  const [recommendations, setRecommendations] = useState<CandidateProduct[]>(candidateProducts)

  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, typing])

  // Initialize with scenario or welcome
  useEffect(() => {
    if (scenario) {
      setMessages([{
        id: "sys-0", role: "system", text: `시나리오: ${scenario.title}`,
        timestamp: new Date().toISOString()
      }])
      setTimeout(() => {
        handleSend(scenario.input)
      }, 500)
    } else {
      setMessages([{
        id: "ai-welcome", role: "ai",
        text: "안녕하세요. YG-1 AI 추천 에이전트입니다.\n\n가공 관련 문의를 자유롭게 입력해주세요.\n경쟁사 품번, 소재, 가공 조건 등 어떤 형태든 가능합니다.",
        chips: ["가공 품질 개선이 필요해요", "경쟁사 제품 대체", "SUS304 엔드밀 추천", "이번 주 출고 가능한 것만"],
        timestamp: new Date().toISOString()
      }])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const streamingIdRef = useRef("")
  const typingAnim = useTypingAnimation()

  const callLLM = async (currentMessages: ChatMessage[]) => {
    const aiMsgId = `ai-${Date.now()}`
    streamingIdRef.current = aiMsgId

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: currentMessages, mode }),
      })
      if (!res.ok) throw new Error("API error")
      const data = parseChatResponse(await res.json())

      // Add empty AI bubble, then animate text in
      setMessages(prev => [...prev, {
        id: aiMsgId,
        role: "ai",
        text: "",
        purpose: data.purpose,
        timestamp: new Date().toISOString(),
      }])

      typingAnim.start(
        data.text,
        // onUpdate: progressively reveal text
        (partialText) => {
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text: partialText } : m
          ))
        },
        // onDone: animation complete, show chips + process metadata
        () => {
          setTyping(false)
          const products = (data as any).recommendedProducts ?? undefined
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId ? { ...m, text: data.text, chips: data.chips ?? undefined, products } : m
          ))
          // Update right panel with chat products
          if (products && products.length > 0) {
            setChatProducts(products)
            setShowResult(true)
          }

          if (data.extractedField) {
            const extractedField = data.extractedField
            setExtracted(prev => {
              const updated = [...prev, {
                label: extractedField.label,
                value: extractedField.value,
                confidence: extractedField.confidence,
                step: extractedField.step,
              }]
              const total = mode === "simple" ? 4 : 9
              const pct = Math.min(100, Math.round((updated.length / total) * 100))
              setCompleteness(pct)
              setUncertainty(Math.max(5, 100 - pct))
              setCandidates(Math.max(3, Math.round(120 * (1 - pct / 100))))
              return updated
            })
            setCurrentStep(extractedField.step)
          }

          if (data.isComplete) {
            setCurrentStep(5)
            setCompleteness(100)
            setUncertainty(8)
            setCandidates(3)
            setShowResult(true)
            if (data.recommendationIds?.length) {
              const recs = data.recommendationIds
                .map((id: string) => candidateProducts.find(p => p.id === id))
                .filter(Boolean) as CandidateProduct[]
              if (recs.length > 0) setRecommendations(recs)
            }
          }
        },
      )
    } catch {
      setTyping(false)
      setMessages(prev => [...prev, {
        id: `ai-err-${Date.now()}`,
        role: "ai",
        text: "죄송합니다. 응답을 가져오는데 실패했습니다. 다시 시도해주세요.",
        timestamp: new Date().toISOString(),
      }])
    }
  }

  const handleSend = (text?: string) => {
    const msg = text || input.trim()
    if (!msg || typing) return
    setInput("")

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: msg,
      timestamp: new Date().toISOString()
    }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setTyping(true)
    callLLM(updatedMessages)
  }

  return (
    <TooltipProvider>
      <div className="flex flex-1 h-full min-h-0">
        {/* LEFT PANEL: Steps + Controls */}
        <div className="w-56 border-r bg-muted/20 flex flex-col">
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={mode === "simple" ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => setMode("simple")}>
                {"간편"}
              </Badge>
              <Badge variant={mode === "precision" ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => setMode("precision")}>
                {"정밀"}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {mode === "simple" ? "핵심 4개 질문" : "전체 9개 질문"}
            </div>
          </div>

          {/* Stepper */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {STEPS.map((step) => {
                const isActive = step.id === currentStep
                const isDone = step.id < currentStep || (step.id === 5 && showResult)
                const stepFields = extracted.filter(e => e.step === step.id)
                return (
                  <div key={step.id} className={cn(
                    "rounded-lg p-2 transition-all",
                    isActive && "bg-[#ed1c24]/10 border border-[#ed1c24]/30",
                    isDone && "bg-green-50 border border-green-200",
                    !isActive && !isDone && "opacity-50"
                  )}>
                    <div className="flex items-center gap-2 mb-1">
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : isActive ? (
                        <step.icon className="h-3.5 w-3.5 text-[#ed1c24]" />
                      ) : (
                        <step.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-xs font-medium">{step.label}</span>
                    </div>
                    {stepFields.length > 0 && (
                      <div className="ml-5 space-y-0.5">
                        {stepFields.map((f, i) => (
                          <div key={i} className="text-[10px] flex items-center gap-1">
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              f.confidence === "high" ? "bg-green-500" : f.confidence === "medium" ? "bg-amber-500" : "bg-red-400"
                            )} />
                            <span className="text-muted-foreground truncate">{f.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Completeness */}
          <div className="p-3 border-t bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">완성도</div>
            <Progress value={completeness} className="h-2 mb-1" />
            <div className="text-xs font-medium">{completeness}%</div>
          </div>
        </div>

        {/* CENTER: Chat */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Location Permission Banner */}
          <LocationPermissionBanner />
          {/* Chat header */}
          <div className="h-12 border-b flex items-center px-4 gap-3">
            <Sparkles className="h-4 w-4 text-[#ed1c24]" />
            <span className="font-medium text-sm">AI 추천 대화</span>
            {scenario && (
              <Badge variant="outline" className="text-xs">{scenario.title}</Badge>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.filter(m => !(m.text === "" && typing)).map(msg => (
              <div key={msg.id} className={cn(
                "flex",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}>
                <div className={cn(
                  "max-w-[85%] rounded-xl px-4 py-2.5",
                  msg.role === "user" ? "bg-[#ed1c24] text-white" :
                  msg.role === "system" ? "bg-amber-50 border border-amber-200 text-amber-800" :
                  "bg-muted"
                )}>
                  {msg.role === "ai" ? (
                    (() => {
                      const markerRegex = /\{"action":"offer_dealer_popup","region":"([^"]+)","top_dealer":"([^"]+)"\}/;
                      const match = msg.text.match(markerRegex);
                      if (match) {
                        const cleanText = msg.text.replace(markerRegex, '').trim();
                        const [, region, topDealer] = match;
                        return (
                          <div>
                            <div className="text-sm"><Markdown stripDoubleTilde disableStrikethrough>{cleanText}</Markdown></div>
                            <DealerPopupTriggerButton region={region} topDealer={topDealer} />
                          </div>
                        );
                      }
                      return <div className="text-sm"><Markdown stripDoubleTilde disableStrikethrough>{msg.text}</Markdown></div>;
                    })()
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  )}

                  {/* Product cards */}
                  {msg.products && msg.products.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.products.slice(0, 5).map((p, i) => {
                        const stockBadge = p.stockStatus === "instock"
                          ? { label: `재고 있음${p.totalStock ? ` (${p.totalStock})` : ""}`, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
                          : p.stockStatus === "limited"
                          ? { label: `재고 한정${p.totalStock ? ` (${p.totalStock})` : ""}`, cls: "bg-amber-50 text-amber-700 border-amber-200" }
                          : p.stockStatus === "outofstock"
                          ? { label: "재고 없음", cls: "bg-red-50 text-red-600 border-red-200" }
                          : { label: "재고 미확인", cls: "bg-gray-50 text-gray-500 border-gray-200" }
                        const cleanFeature = (p.featureText || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
                        const cleanDesc = (p.description || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
                        return (
                          <div key={p.displayCode} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                            {/* Header: image + info */}
                            <div className="flex gap-3">
                              <img
                                src={p.seriesIconUrl || "/images/series/todo-placeholder.svg"}
                                alt={p.displayCode}
                                className="w-14 h-14 object-contain rounded-lg border border-gray-100 bg-gray-50 p-0.5"
                                onError={(e) => { (e.target as HTMLImageElement).src = "/images/series/todo-placeholder.svg" }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={cn(
                                    "text-xs font-mono text-gray-400"
                                  )}>#{i + 1}</span>
                                  {stockBadge && (
                                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", stockBadge.cls)}>
                                      {stockBadge.label}
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-sm font-bold text-gray-900 mt-0.5">{p.displayCode}</div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {p.brand && <span className="text-xs font-bold text-purple-700">{p.brand}</span>}
                                  {p.seriesName && <span className="text-xs text-green-600">{p.seriesName}</span>}
                                </div>
                              </div>
                            </div>
                            {/* Spec summary line */}
                            <div className="text-[11px] text-gray-600 font-medium">
                              형상 {[
                                p.toolSubtype,
                                p.toolMaterial,
                                p.shankDiameterMm ? `Shank ${p.shankDiameterMm}mm` : null,
                                p.lengthOfCutMm ? `CL ${p.lengthOfCutMm}mm` : null,
                                p.overallLengthMm ? `OAL ${p.overallLengthMm}mm` : null,
                                p.helixAngleDeg ? `${p.helixAngleDeg}°` : null,
                              ].filter(Boolean).join(" · ")}
                            </div>
                            {p.materialTags?.length > 0 && (
                              <div className="text-[10px] text-gray-400">{p.materialTags.join("/")}군</div>
                            )}
                            {/* Feature text */}
                            {cleanFeature && <p className="text-[10px] text-gray-500 italic line-clamp-1">{cleanFeature}</p>}
                            {cleanDesc && !cleanFeature && <p className="text-[10px] text-gray-500 italic line-clamp-1">{cleanDesc}</p>}
                            {/* Video & Catalog buttons */}
                            {(() => {
                              const videos = findVideosForProduct(p.seriesName, p.description, p.brand, preferredLang)
                              const catalogs = findCatalogsForProduct(p.seriesName, p.description, p.brand, p.toolType, preferredLang)
                              if (videos.length === 0 && catalogs.length === 0) return null
                              return (
                                <div className="flex gap-1.5 mt-1.5">
                                  {videos.length > 0 && (
                                    <a href={videos[0].url} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[9px] font-medium text-red-700 hover:bg-red-100">
                                      ▶ {videos[0].title}
                                    </a>
                                  )}
                                  {catalogs.length > 0 && (
                                    <a href={catalogs[0].url} target="_blank" rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[9px] font-medium text-blue-700 hover:bg-blue-100">
                                      📄 카탈로그
                                    </a>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* Purpose tooltip */}
                  {msg.purpose && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs opacity-70">
                      <HelpCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>{msg.purpose}</span>
                    </div>
                  )}

                  {/* Quick reply chips */}
                  {msg.chips && (() => {
                    const lastAiMsg = [...messages].reverse().find(m => m.role === "ai")
                    const isLatestAi = lastAiMsg?.id === msg.id
                    const isCtaChip = (chip: string) => chip.includes("제품 보기") || chip.includes("AI 상세 분석")
                    const normalChips = msg.chips.filter(chip => !isCtaChip(chip))
                    const ctaChips = isLatestAi ? msg.chips.filter(chip => isCtaChip(chip)) : []
                    return (
                      <>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {normalChips.map((chip, i) => (
                            <Button
                              key={i}
                              variant="outline"
                              size="sm"
                              className={cn(
                                "text-xs h-7",
                                isLatestAi
                                  ? "bg-transparent hover:bg-gray-50"
                                  : "opacity-35 pointer-events-none bg-gray-50/50 border-gray-200 text-gray-400",
                                chip.includes("모르겠") && isLatestAi && "border-amber-300 text-amber-700"
                              )}
                              onClick={() => isLatestAi && handleSend(chip)}
                            >
                              {chip}
                            </Button>
                          ))}
                        </div>
                        {ctaChips.length > 0 && (
                          <div className="flex gap-2 mt-2">
                            {ctaChips.map((chip, i) => (
                              <button
                                key={`cta-${i}`}
                                onClick={() => handleSend(chip)}
                                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                                  chip.includes("제품 보기")
                                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
                                    : "bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                                }`}
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            ))}

            {typing && !messages.some(m => m.text.length > 0 && m.id === streamingIdRef.current) && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-xl px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-muted-foreground">분석 중...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="shrink-0 bg-transparent">
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>도면/이미지 업로드</TooltipContent>
              </Tooltip>
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="가공 조건이나 문의사항을 입력하세요..."
                className="flex-1"
              />
              <Button onClick={() => handleSend()} className="bg-[#ed1c24] hover:bg-[#d01920]">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Extraction + Results */}
        <div className="w-80 border-l bg-muted/10 flex flex-col overflow-y-auto">
          {/* Uncertainty / Funnel */}
          <div className="p-3 border-b space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">불확실도</span>
                <span className={cn(
                  "text-xs font-bold",
                  uncertainty > 60 ? "text-red-500" : uncertainty > 30 ? "text-amber-500" : "text-green-500"
                )}>{uncertainty}%</span>
              </div>
              <Progress
                value={100 - uncertainty}
                className="h-2"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">후보군</span>
                <span className="text-xs font-bold">{candidates}개</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span>120</span>
                <ArrowRight className="h-2.5 w-2.5" />
                <span className="font-medium text-foreground">{candidates}</span>
              </div>
            </div>
          </div>

          {/* Extracted fields */}
          <div className="p-3 border-b">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              추출된 조건
            </h4>
            {extracted.length === 0 ? (
              <p className="text-xs text-muted-foreground">대화를 시작하면 조건이 추출됩니다</p>
            ) : (
              <div className="space-y-1.5">
                {extracted.map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-background rounded px-2 py-1.5 border">
                    <span className="text-muted-foreground">{f.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate max-w-[120px]">{f.value}</span>
                      <span className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        f.confidence === "high" ? "bg-green-500" : f.confidence === "medium" ? "bg-amber-500" : "bg-red-400"
                      )} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Results */}
          {chatProducts.length > 0 ? (
            <div className="p-3 space-y-2">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#ed1c24]" />
                추천 제품 ({chatProducts.length}개)
              </h4>
              {chatProducts.slice(0, 5).map((p, i) => (
                <Card key={p.displayCode} className={cn("overflow-hidden", i === 0 && "ring-2 ring-[#ed1c24]/30")}>
                  <CardContent className="p-2.5">
                    <div className="flex gap-2 mb-1.5">
                      <img
                        src={p.seriesIconUrl || "/images/series/todo-placeholder.svg"}
                        alt={p.displayCode}
                        className="w-10 h-10 object-contain rounded border border-gray-100 bg-gray-50"
                        onError={(e) => { (e.target as HTMLImageElement).src = "/images/series/todo-placeholder.svg" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge className={cn("text-[10px]", i === 0 ? "bg-[#ed1c24]" : "bg-muted-foreground")}>#{i + 1}</Badge>
                          {p.brand && <span className="text-[10px] font-bold text-purple-800 truncate">{p.brand}</span>}
                        </div>
                        <p className="text-xs font-mono font-bold text-gray-900">{p.displayCode}</p>
                      </div>
                    </div>
                    {(() => {
                      const cleanDesc = (p.description || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim()
                      const cleanFeat = (p.featureText || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim()
                      return (<>
                        {cleanDesc && <p className="text-[10px] text-gray-500 line-clamp-1 mb-1">{cleanDesc}</p>}
                        <div className="text-[10px] text-gray-600 font-medium mb-1">
                          {[
                            p.toolSubtype,
                            p.toolMaterial,
                            p.lengthOfCutMm ? `CL ${p.lengthOfCutMm}mm` : null,
                            p.overallLengthMm ? `OAL ${p.overallLengthMm}mm` : null,
                          ].filter(Boolean).join(" · ")}
                        </div>
                        <div className="flex flex-wrap gap-1 text-[9px]">
                          {p.diameterMm != null && <span className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-blue-700 font-semibold">φ{p.diameterMm}mm</span>}
                          {p.fluteCount != null && <span className="rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-green-700">{p.fluteCount}날</span>}
                          {p.coating && <span className="rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-amber-700">{p.coating}</span>}
                          {p.materialTags?.length > 0 && <span className="rounded-full bg-red-50 border border-red-200 px-1.5 py-0.5 text-red-700">{p.materialTags.join("/")}</span>}
                        </div>
                        {cleanFeat && <p className="mt-1 text-[10px] text-gray-400 line-clamp-2">{cleanFeat}</p>}
                      </>)
                    })()}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : showResult ? (
            <div className="p-3 space-y-3">
              <h4 className="text-xs font-semibold flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#ed1c24]" />
                Top-3 추천
              </h4>
              {recommendations.map((cp, i) => (
                <Card key={cp.id} className={cn(
                  "overflow-hidden",
                  i === 0 && "ring-2 ring-[#ed1c24]/30"
                )}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <img
                        src={cp.imageUrl || "/images/series/todo-placeholder.svg"}
                        alt={cp.name}
                        className="w-12 h-12 rounded object-cover bg-muted"
                        onError={(e) => { (e.target as HTMLImageElement).src = "/images/series/todo-placeholder.svg" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge className={cn(
                            "text-[10px]",
                            i === 0 ? "bg-[#ed1c24]" : "bg-muted-foreground"
                          )}>#{i + 1}</Badge>
                          <Badge variant="outline" className="text-[10px]">{cp.fitTag}</Badge>
                        </div>
                        <p className="font-medium text-xs mt-1 truncate">{cp.name}</p>
                        <p className="text-[10px] text-muted-foreground">{cp.sku}</p>
                      </div>
                    </div>

                    {/* Score */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-muted-foreground">적합도</span>
                      <Progress value={cp.score.total} className="h-1.5 flex-1" />
                      <span className="text-xs font-bold">{cp.score.total}</span>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-4 gap-1 mb-2">
                      {[
                        { l: "속도", v: cp.metrics.cycleTime },
                        { l: "수명", v: cp.metrics.toolLife },
                        { l: "비용", v: cp.metrics.costIndex },
                        { l: "CO2", v: cp.metrics.co2Index },
                      ].map((m, j) => (
                        <div key={j} className="bg-muted/50 rounded p-1 text-center">
                          <p className="text-[9px] text-muted-foreground">{m.l}</p>
                          <p className="text-[10px] font-bold">{m.v}</p>
                        </div>
                      ))}
                    </div>

                    {/* Reasons */}
                    <div className="space-y-0.5 mb-2">
                      {cp.reasons.slice(0, 2).map((r, j) => (
                        <div key={j} className="flex items-start gap-1 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>

                    {/* Risk */}
                    {cp.risks[0] && (
                      <div className="flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50 rounded px-1.5 py-1 mb-2">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>{cp.risks[0].text}</span>
                      </div>
                    )}

                    {/* Stock + Price */}
                    <div className="flex items-center justify-between text-[10px] mb-2">
                      <Badge variant={cp.stock === "instock" ? "default" : cp.stock === "limited" ? "secondary" : "destructive"} className="text-[10px]">
                        {cp.stock === "instock" ? "즉시출고" : cp.stock === "limited" ? `${cp.stockQty}개 한정` : "재고없음"}
                      </Badge>
                      <span className="text-muted-foreground">{cp.price.customer.split(" ").pop()}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1">
                      <Button size="sm" className="flex-1 text-[10px] h-7 bg-[#ed1c24] hover:bg-[#d01920]">견적요청</Button>
                      <Button size="sm" variant="outline" className="flex-1 text-[10px] h-7 bg-transparent">비교함</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Commercial Action Bar */}
              <Card className="bg-[#ed1c24]/5 border-[#ed1c24]/20">
                <CardContent className="p-3 space-y-2">
                  <h5 className="text-xs font-semibold">실행 액션</h5>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button size="sm" className="text-[10px] h-7 bg-[#ed1c24] hover:bg-[#d01920]">견적 요청</Button>
                    <Button size="sm" variant="outline" className="text-[10px] h-7 bg-transparent">재고/납기 확인</Button>
                    <Button size="sm" variant="outline" className="text-[10px] h-7 bg-transparent">담당 영업 연결</Button>
                    <Button size="sm" variant="outline" className="text-[10px] h-7 bg-transparent">주문 의사 전달</Button>
                  </div>
                  <Button size="sm" variant="outline" className="w-full text-[10px] h-7 bg-transparent">
                    <Shield className="h-3 w-3 mr-1" />
                    기술 검토 요청
                  </Button>
                </CardContent>
              </Card>

              {/* Link to full result */}
              <Link href="/assistant/result/demo">
                <Button variant="outline" className="w-full text-xs bg-transparent">
                  전체 추천 보드 보기 <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="p-3">
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted/50 mb-3">
                  <Zap className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">대화가 진행되면<br />추천 결과가 여기 표시됩니다</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
