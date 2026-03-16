"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  FileText,
  Send,
  Clock,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  ArrowRight
} from "lucide-react"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"

const statusConfig = {
  draft: { label: "초안", icon: FileText, className: "bg-muted text-muted-foreground" },
  "pending-approval": { label: "승인대기", icon: Clock, className: "bg-warning/10 text-warning-foreground" },
  approved: { label: "승인됨", icon: CheckCircle, className: "bg-success/10 text-success" },
  sent: { label: "발송완료", icon: Send, className: "bg-primary/10 text-primary" }
}

const toneConfig = {
  formal: { label: "격식체", description: "정중하고 격식있는 표현" },
  concise: { label: "간결체", description: "핵심만 간결하게" },
  friendly: { label: "친근체", description: "친근하고 부드러운 표현" }
}

export default function QuotesPageWrapper() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-500">로딩 중...</div>}>
      <QuotesPage />
    </Suspense>
  )
}

function QuotesPage() {
  const { quotes, inquiries, products, updateQuoteStatus, addNotification } = useApp()
  const searchParams = useSearchParams()
  const [selectedInquiry, setSelectedInquiry] = useState<string>("")

  // Auto-select inquiry from query param (e.g., /quotes?inquiry=INQ-001)
  useEffect(() => {
    const inquiryParam = searchParams.get("inquiry")
    if (inquiryParam && inquiries.some(inq => inq.id === inquiryParam)) {
      setSelectedInquiry(inquiryParam)
    }
  }, [searchParams, inquiries])
  const [selectedTone, setSelectedTone] = useState<"formal" | "concise" | "friendly">("formal")
  const [customNotes, setCustomNotes] = useState("")

  const selectedInquiryData = inquiries.find(inq => inq.id === selectedInquiry)
  const recommendedProducts = selectedInquiryData?.recommendedProducts || []

  const handleRequestApproval = (quoteId: string) => {
    updateQuoteStatus(quoteId, "pending-approval")
    addNotification({
      type: "info",
      title: "검토 요청됨",
      message: "견적서가 내부 검토 대기 상태가 되었습니다."
    })
  }

  const handleSimulateSend = (quoteId: string) => {
    updateQuoteStatus(quoteId, "sent")
    addNotification({
      type: "success",
      title: "발송 완료 (시뮬레이션)",
      message: "견적서가 고객에게 발송되었습니다."
    })
  }

  const generateQuotePreview = () => {
    if (!selectedInquiryData) return ""

    const greeting = {
      formal: `${selectedInquiryData.customer}님께,\n\n귀사의 문의에 감사드립니다. 요청하신 제품에 대한 견적을 아래와 같이 안내드립니다.`,
      concise: `${selectedInquiryData.customer}님,\n\n요청하신 견적입니다.`,
      friendly: `${selectedInquiryData.customer}님, 안녕하세요!\n\n문의 주신 제품 견적을 보내드립니다.`
    }

    const closing = {
      formal: `\n\n기타 문의사항이 있으시면 언제든 연락 주시기 바랍니다.\n감사합니다.`,
      concise: `\n\n문의: 담당자 연락처`,
      friendly: `\n\n궁금한 점 있으시면 편하게 연락 주세요!`
    }

    let productList = ""
    if (recommendedProducts.length > 0) {
      productList = recommendedProducts.map((rec, idx) => {
        const p = rec.product
        return `\n${idx + 1}. ${p.name} (${p.sku})
   - 수량: ${selectedInquiryData.quantity}개
   - 단가: ${p.unitPrice.toLocaleString()}원 (${p.priceType === "confirmed" ? "확정" : "추정"})
   - 납기: ${p.leadTime} (${p.leadTimeType === "confirmed" ? "확정" : "추정"})
   - MOQ: ${p.moq}개`
      }).join("\n")
    }

    return `${greeting[selectedTone]}${productList}${customNotes ? `\n\n비고: ${customNotes}` : ""}${closing[selectedTone]}`
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">견적 초안</h1>
            <p className="text-sm text-muted-foreground">Quote Draft</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Quote Builder */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">새 견적 작성</CardTitle>
                <CardDescription>Create New Quote</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Inquiry Selection */}
                <div className="space-y-2">
                  <Label>문의 선택</Label>
                  <Select value={selectedInquiry} onValueChange={setSelectedInquiry}>
                    <SelectTrigger>
                      <SelectValue placeholder="견적을 작성할 문의를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {inquiries
                        .filter(inq => inq.status !== "sent" && inq.status !== "won" && inq.status !== "lost")
                        .map(inq => (
                          <SelectItem key={inq.id} value={inq.id}>
                            {inq.id} - {inq.customer} ({inq.company})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedInquiryData && (
                  <>
                    {/* Inquiry Summary */}
                    <div className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                      <p><span className="text-muted-foreground">고객:</span> {selectedInquiryData.customer} / {selectedInquiryData.company}</p>
                      <p><span className="text-muted-foreground">요청:</span> {selectedInquiryData.requestedToolType} x {selectedInquiryData.quantity}</p>
                      <p><span className="text-muted-foreground">납기:</span> {selectedInquiryData.targetDelivery}</p>
                    </div>

                    {/* Recommended Products */}
                    {recommendedProducts.length > 0 && (
                      <div className="space-y-2">
                        <Label>추천 제품 (자동 포함)</Label>
                        {recommendedProducts.map((rec) => (
                          <div key={rec.product.id} className="p-3 border rounded-lg flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm">{rec.product.name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{rec.product.sku}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{rec.product.unitPrice.toLocaleString()}원</p>
                              <div className="flex items-center gap-1">
                                <Badge variant={rec.product.priceType === "confirmed" ? "default" : "outline"} className="text-[10px]">
                                  {rec.product.priceType === "confirmed" ? "확정" : "추정"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <Separator />

                    {/* Tone Selection */}
                    <div className="space-y-2">
                      <Label>문장 톤 선택</Label>
                      <RadioGroup
                        value={selectedTone}
                        onValueChange={(v) => setSelectedTone(v as typeof selectedTone)}
                        className="grid grid-cols-3 gap-3"
                      >
                        {(Object.entries(toneConfig) as [keyof typeof toneConfig, typeof toneConfig[keyof typeof toneConfig]][]).map(([key, config]) => (
                          <div key={key}>
                            <RadioGroupItem value={key} id={key} className="peer sr-only" />
                            <Label
                              htmlFor={key}
                              className={cn(
                                "flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary cursor-pointer",
                                selectedTone === key && "border-primary"
                              )}
                            >
                              <span className="text-sm font-medium">{config.label}</span>
                              <span className="text-xs text-muted-foreground">{config.description}</span>
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </div>

                    {/* Custom Notes */}
                    <div className="space-y-2">
                      <Label>추가 메모 (선택)</Label>
                      <Textarea
                        placeholder="견적서에 포함할 추가 내용..."
                        value={customNotes}
                        onChange={(e) => setCustomNotes(e.target.value)}
                        rows={3}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quote Preview */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">견적 미리보기</CardTitle>
                <CardDescription>Quote Preview</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedInquiryData ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-muted/30 rounded-lg font-mono text-sm whitespace-pre-wrap min-h-64">
                      {generateQuotePreview()}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 bg-transparent"
                        onClick={() => handleRequestApproval(selectedInquiryData.id)}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        내부 검토 요청
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => handleSimulateSend(selectedInquiryData.id)}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        고객에게 발송
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p>문의를 선택하면 견적 미리보기가 표시됩니다.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Existing Quotes */}
        {quotes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">작성된 견적</CardTitle>
              <CardDescription>Existing Quotes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {quotes.map(quote => {
                  const inquiry = inquiries.find(i => i.id === quote.inquiryId)
                  const config = statusConfig[quote.status]
                  const StatusIcon = config.icon

                  return (
                    <div key={quote.id} className="p-4 border rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", config.className)}>
                          <StatusIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{quote.id}</p>
                          <p className="text-sm text-muted-foreground">
                            {inquiry?.customer} ({inquiry?.company})
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline">{config.label}</Badge>
                        {quote.status === "draft" && (
                          <Button size="sm" variant="outline" onClick={() => handleRequestApproval(quote.id)}>
                            검토 요청
                          </Button>
                        )}
                        {quote.status === "approved" && (
                          <Button size="sm" onClick={() => handleSimulateSend(quote.id)}>
                            발송
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
