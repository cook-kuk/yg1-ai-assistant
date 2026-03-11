"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowLeft,
  Sparkles,
  CheckCircle,
  AlertCircle,
  MessageSquarePlus,
  FileText,
  UserCheck,
  Paperclip,
  Send,
  HelpCircle,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Info
} from "lucide-react"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"
import type { ConfidenceLevel } from "@/lib/mock-data"
import { use } from "react"

const confidenceConfig: Record<ConfidenceLevel, { label: string; className: string }> = {
  high: { label: "높음", className: "bg-success/10 text-success" },
  medium: { label: "보통", className: "bg-warning/10 text-warning-foreground" },
  low: { label: "낮음", className: "bg-destructive/10 text-destructive" }
}

export default function InquiryDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { inquiries, addMessageToInquiry, addNotification, updateInquiryStatus, products } = useApp()
  const [isLoadingSummary, setIsLoadingSummary] = useState(false)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [generatedQuestions, setGeneratedQuestions] = useState<string[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "rejected" | null>(null)

  const inquiry = inquiries.find(inq => inq.id === id)

  if (!inquiry) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">문의를 찾을 수 없습니다.</p>
          <Button variant="link" asChild>
            <Link href="/inbox">목록으로 돌아가기</Link>
          </Button>
        </div>
      </div>
    )
  }

  const handleGenerateSummary = () => {
    setIsLoadingSummary(true)
    setTimeout(() => {
      setAiSummary(`${inquiry.company}의 ${inquiry.customer}님이 ${inquiry.requestedToolType} ${inquiry.quantity}개를 요청하셨습니다. ${inquiry.workpieceMaterial ? `피삭재는 ${inquiry.workpieceMaterial}이며, ` : "피삭재 정보가 누락되어 있으며, "}${inquiry.targetDelivery} 납기를 원하십니다. ${inquiry.competitorReference ? `현재 ${inquiry.competitorReference}를 사용 중입니다.` : ""}`)
      setIsLoadingSummary(false)
      addNotification({ type: "success", title: "요약 생성 완료", message: "AI가 문의 내용을 요약했습니다." })
    }, 1500)
  }

  const handleGenerateQuestions = () => {
    const questions = inquiry.missingFields.map(field => {
      const questionMap: Record<string, string> = {
        "피삭재": "가공하실 소재(피삭재)가 무엇인가요?",
        "가공기계": "사용하시는 가공 기계(장비)는 무엇인가요?",
        "직경": "필요하신 공구의 직경은 어떻게 되나요?",
        "도면/스펙": "도면이나 스펙 시트를 첨부해 주실 수 있나요?",
        "도면": "도면을 첨부해 주실 수 있나요?",
        "스펙시트": "스펙 시트를 첨부해 주실 수 있나요?",
        "가공 조건": "절삭 속도, 이송 속도 등 가공 조건을 알려주시겠어요?"
      }
      return questionMap[field] || `${field} 정보를 알려주시겠어요?`
    })
    setGeneratedQuestions(questions)
    addNotification({ type: "success", title: "질문 생성 완료", message: `${questions.length}개의 추가 질문이 생성되었습니다.` })
  }

  const handleSendQuestions = () => {
    if (generatedQuestions.length > 0) {
      addMessageToInquiry(inquiry.id, {
        sender: "sales",
        content: `추가 확인 사항:\n${generatedQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
      })
      setGeneratedQuestions([])
      updateInquiryStatus(inquiry.id, "need-info")
      addNotification({ type: "success", title: "메시지 발송됨", message: "추가 질문이 고객에게 전송되었습니다." })
    }
  }

  const handleSendMessage = () => {
    if (newMessage.trim()) {
      addMessageToInquiry(inquiry.id, {
        sender: "sales",
        content: newMessage
      })
      setNewMessage("")
      addNotification({ type: "success", title: "메시지 발송됨", message: "메시지가 전송되었습니다." })
    }
  }

  const handleEscalate = () => {
    updateInquiryStatus(inquiry.id, "escalated")
    addNotification({ type: "info", title: "전문가 이관 완료", message: "R&D 전문가에게 문의가 이관되었습니다." })
  }

  const handleApproval = (approved: boolean) => {
    setApprovalStatus(approved ? "approved" : "rejected")
    addNotification({
      type: approved ? "success" : "warning",
      title: approved ? "승인 완료" : "반려됨",
      message: approved ? "견적 발송이 승인되었습니다." : "추가 검토가 필요합니다."
    })
  }

  const needsApproval = inquiry.recommendedProducts?.some(r => r.confidence !== "high")

  return (
    <TooltipProvider>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/inbox">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{inquiry.customer}</h1>
              <Badge variant={inquiry.status === "escalated" ? "destructive" : "secondary"}>
                {inquiry.status === "new" && "신규"}
                {inquiry.status === "in-review" && "검토중"}
                {inquiry.status === "need-info" && "정보필요"}
                {inquiry.status === "quote-drafted" && "견적작성"}
                {inquiry.status === "sent" && "발송완료"}
                {inquiry.status === "escalated" && "전문가 이관"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {inquiry.company} / {inquiry.country} / {inquiry.industry}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleEscalate}>
              <UserCheck className="h-4 w-4 mr-2" />
              전문가 이관
            </Button>
            <Button asChild>
              <Link href={`/quotes/new?inquiry=${inquiry.id}`}>
                <FileText className="h-4 w-4 mr-2" />
                견적 초안
              </Link>
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left: Message Thread */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">문의 내용</CardTitle>
                <CardDescription>Customer Message Thread</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Inquiry Details */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-muted/50 rounded-lg text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">요청 제품</p>
                    <p className="font-medium">{inquiry.requestedToolType} x {inquiry.quantity}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">피삭재</p>
                    <p className="font-medium">{inquiry.workpieceMaterial || <span className="text-warning-foreground">미입력</span>}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">가공 공정</p>
                    <p className="font-medium">{inquiry.process}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">가공 기계</p>
                    <p className="font-medium">{inquiry.machine || <span className="text-warning-foreground">미입력</span>}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">희망 납기</p>
                    <p className="font-medium">{inquiry.targetDelivery}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">예산 힌트</p>
                    <p className="font-medium">{inquiry.budgetHint || "-"}</p>
                  </div>
                  {inquiry.competitorReference && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs">경쟁사 제품 참조</p>
                      <p className="font-medium font-mono text-primary">{inquiry.competitorReference}</p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Messages */}
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {inquiry.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "p-3 rounded-lg",
                        message.sender === "customer" && "bg-muted",
                        message.sender === "sales" && "bg-primary/10 ml-8",
                        message.sender === "ai" && "bg-accent/10 border border-accent/20",
                        message.sender === "system" && "bg-warning/10 text-sm"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">
                          {message.sender === "customer" && "고객"}
                          {message.sender === "sales" && "영업담당"}
                          {message.sender === "ai" && "AI"}
                          {message.sender === "system" && "시스템"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(message.timestamp).toLocaleString('ko-KR')}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                          <Paperclip className="h-3 w-3 text-muted-foreground" />
                          {message.attachments.map(att => (
                            <Badge key={att} variant="outline" className="text-xs">
                              {att}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Reply Box */}
                <div className="space-y-2">
                  <Textarea
                    placeholder="메시지 작성..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    rows={3}
                  />
                  <div className="flex justify-end">
                    <Button onClick={handleSendMessage} disabled={!newMessage.trim()}>
                      <Send className="h-4 w-4 mr-2" />
                      발송
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: AI Panel */}
          <div className="space-y-4">
            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="summary">요약</TabsTrigger>
                <TabsTrigger value="checklist">체크리스트</TabsTrigger>
                <TabsTrigger value="recommend">추천</TabsTrigger>
                <TabsTrigger value="pricing">가격/납기</TabsTrigger>
              </TabsList>

              {/* Summary Tab */}
              <TabsContent value="summary">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AI 문의 요약
                    </CardTitle>
                    <CardDescription>1-Click Summary</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!aiSummary ? (
                      <Button
                        onClick={handleGenerateSummary}
                        disabled={isLoadingSummary}
                        className="w-full"
                      >
                        {isLoadingSummary ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            요약 생성 중...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            문의 요약 생성
                          </>
                        )}
                      </Button>
                    ) : (
                      <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                        <p className="text-sm leading-relaxed">{aiSummary}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Checklist Tab */}
              <TabsContent value="checklist">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-success" />
                      필수 정보 체크리스트
                    </CardTitle>
                    <CardDescription>Required Information Checklist</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      {[
                        { field: "피삭재", value: inquiry.workpieceMaterial },
                        { field: "가공 공정", value: inquiry.process },
                        { field: "가공 기계", value: inquiry.machine },
                        { field: "도면", value: inquiry.hasDrawing },
                        { field: "스펙 시트", value: inquiry.hasSpec },
                        { field: "수량", value: inquiry.quantity },
                        { field: "희망 납기", value: inquiry.targetDelivery }
                      ].map((item) => (
                        <div key={item.field} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                          {item.value ? (
                            <CheckCircle className="h-4 w-4 text-success shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                          )}
                          <span className="text-sm flex-1">{item.field}</span>
                          {item.value ? (
                            <span className="text-sm text-muted-foreground">
                              {typeof item.value === "boolean" ? "있음" : item.value}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-warning-foreground border-warning/30 text-xs">
                              누락
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>

                    {inquiry.missingFields.length > 0 && (
                      <>
                        <Separator />
                        <div className="space-y-3">
                          <Button
                            variant="outline"
                            className="w-full bg-transparent"
                            onClick={handleGenerateQuestions}
                            disabled={generatedQuestions.length > 0}
                          >
                            <MessageSquarePlus className="h-4 w-4 mr-2" />
                            추가 질문 자동 생성
                          </Button>

                          {generatedQuestions.length > 0 && (
                            <div className="space-y-2 p-3 bg-accent/5 rounded-lg border border-accent/10">
                              <p className="text-xs font-medium text-accent">생성된 질문:</p>
                              {generatedQuestions.map((q, i) => (
                                <p key={q} className="text-sm">{i + 1}. {q}</p>
                              ))}
                              <Button size="sm" onClick={handleSendQuestions} className="w-full mt-2">
                                <Send className="h-4 w-4 mr-2" />
                                고객에게 발송
                              </Button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Recommendations Tab */}
              <TabsContent value="recommend">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      추천 후보
                    </CardTitle>
                    <CardDescription>AI Recommended Products</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {inquiry.recommendedProducts && inquiry.recommendedProducts.length > 0 ? (
                      <>
                        {inquiry.recommendedProducts.map((rec, idx) => (
                          <div key={rec.product.id} className="p-4 border rounded-lg space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium text-muted-foreground">#{idx + 1}</span>
                                  <h4 className="font-medium">{rec.product.name}</h4>
                                </div>
                                <p className="text-xs font-mono text-muted-foreground">{rec.product.sku}</p>
                              </div>
                              <span className={cn("text-xs px-2 py-1 rounded-full", confidenceConfig[rec.confidence].className)}>
                                신뢰도: {confidenceConfig[rec.confidence].label}
                              </span>
                            </div>
                            
                            <div className="p-2 bg-muted/30 rounded text-sm">
                              <div className="flex items-start gap-2">
                                <HelpCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">왜 이 제품인가?</p>
                                  <p className="text-sm">{rec.reason}</p>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-muted-foreground">대체품:</span>
                              {rec.alternativeIds.map(altId => {
                                const alt = products.find(p => p.id === altId)
                                return alt ? (
                                  <Badge key={altId} variant="outline" className="text-xs">
                                    {alt.sku}
                                  </Badge>
                                ) : null
                              })}
                            </div>
                          </div>
                        ))}

                        {/* Human-in-the-loop Approval */}
                        {needsApproval && (
                          <div className="p-4 bg-warning/5 border border-warning/20 rounded-lg">
                            <div className="flex items-start gap-3">
                              <Info className="h-5 w-5 text-warning shrink-0" />
                              <div className="flex-1">
                                <p className="font-medium text-sm">Human-in-the-loop 승인 필요</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  추천 신뢰도가 낮아 전문가 승인이 필요합니다.
                                </p>
                                
                                {approvalStatus === null ? (
                                  <div className="flex items-center gap-2 mt-3">
                                    <Button size="sm" onClick={() => handleApproval(true)}>
                                      <ThumbsUp className="h-4 w-4 mr-1" />
                                      승인
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleApproval(false)}>
                                      <ThumbsDown className="h-4 w-4 mr-1" />
                                      반려
                                    </Button>
                                  </div>
                                ) : (
                                  <Badge variant={approvalStatus === "approved" ? "default" : "destructive"} className="mt-3">
                                    {approvalStatus === "approved" ? "승인됨" : "반려됨"}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground">추천 제품이 없습니다.</p>
                        <p className="text-sm text-muted-foreground">필수 정보를 먼저 수집해주세요.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Pricing Tab */}
              <TabsContent value="pricing">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">가격/납기 표시 규칙</CardTitle>
                    <CardDescription>Pricing & Lead Time Rules</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                      <div className="flex items-center gap-3">
                        <Badge variant="default">확정</Badge>
                        <span className="text-sm">재고 확인된 제품의 확정 가격/납기</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">추정</Badge>
                        <span className="text-sm">생산/수입 필요 시 추정 가격/납기</span>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>• 가격은 계약 조건에 따라 변동될 수 있습니다</p>
                      <p>• 납기는 재고/생산 상황에 따라 변동될 수 있습니다</p>
                      <p>• 대량 주문 시 별도 협의가 필요합니다</p>
                    </div>

                    {inquiry.recommendedProducts && inquiry.recommendedProducts[0] && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <p className="text-sm font-medium">선택된 제품 가격 정보:</p>
                          <div className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm">{inquiry.recommendedProducts[0].product.name}</span>
                              <Badge variant={inquiry.recommendedProducts[0].product.priceType === "confirmed" ? "default" : "outline"}>
                                {inquiry.recommendedProducts[0].product.priceType === "confirmed" ? "확정" : "추정"}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">단가: </span>
                                <span className="font-medium">{inquiry.recommendedProducts[0].product.unitPrice.toLocaleString()}원</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">납기: </span>
                                <span className="font-medium">{inquiry.recommendedProducts[0].product.leadTime}</span>
                                <Badge variant="outline" className="ml-1 text-xs">
                                  {inquiry.recommendedProducts[0].product.leadTimeType === "confirmed" ? "확정" : "추정"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
