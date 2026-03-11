"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  FileText,
  MessageSquare,
  ChevronRight,
  Search,
  Filter,
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Edit3,
  BookOpen,
  Send,
  Eye,
  Sparkles,
  AlertCircle
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
import { mockInquiries, mockProducts } from "@/lib/mock-data"

interface EscalationCase {
  id: string
  inquiryId: string
  customerName: string
  subject: string
  reason: string
  priority: "high" | "medium" | "low"
  status: "pending" | "reviewing" | "approved" | "rejected"
  requestedBy: string
  requestedAt: Date
  assignedTo?: string
  recommendedProducts: {
    productId: string
    confidence: number
    reason: string
  }[]
  aiSummary: string
  notes: string[]
}

const mockEscalations: EscalationCase[] = [
  {
    id: "ESC-001",
    inquiryId: "INQ-003",
    customerName: "한국정밀가공",
    subject: "인코넬 718 가공용 특수 엔드밀 문의",
    reason: "AI 추천 신뢰도 낮음 (62%) - 난삭재 전문가 검토 필요",
    priority: "high",
    status: "pending",
    requestedBy: "김영업",
    requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    recommendedProducts: [
      { productId: "P005", confidence: 62, reason: "인코넬 가공 가능하나 최적 조건 확인 필요" },
      { productId: "P006", confidence: 58, reason: "내열합금용 코팅, 추가 검증 필요" }
    ],
    aiSummary: "고객이 인코넬 718 항공부품 가공을 위한 엔드밀을 요청. 난삭재 특성상 가공 조건과 공구 수명 예측이 어려워 전문가 검토가 필요합니다.",
    notes: []
  },
  {
    id: "ESC-002",
    inquiryId: "INQ-005",
    customerName: "대한금형",
    subject: "SKD61 고경도강 금형 가공 - 경쟁사 대비 성능 확인",
    reason: "경쟁사 제품과 직접 비교 요청 - 기술 검증 필요",
    priority: "medium",
    status: "reviewing",
    requestedBy: "이영업",
    requestedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
    assignedTo: "박기술",
    recommendedProducts: [
      { productId: "P003", confidence: 78, reason: "SKD61 전용 설계, 고경도 코팅" },
      { productId: "P004", confidence: 72, reason: "금형 정삭 최적화" }
    ],
    aiSummary: "고객이 현재 사용 중인 Mitsubishi VCMHD 대비 YG-1 제품 성능 비교를 요청. 동일 가공 조건에서의 수명 및 표면조도 데이터 제공 필요.",
    notes: ["내부 테스트 데이터 확인 중 - 박기술"]
  },
  {
    id: "ESC-003",
    inquiryId: "INQ-007",
    customerName: "삼성전자 협력사",
    subject: "대량 발주 특별 단가 및 납기 확인",
    reason: "대량 주문 (5,000개+) - 특별 가격/납기 승인 필요",
    priority: "high",
    status: "pending",
    requestedBy: "김영업",
    requestedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    recommendedProducts: [
      { productId: "P001", confidence: 92, reason: "표준 제품, 대량 재고 보유" },
      { productId: "P002", confidence: 88, reason: "알루미늄 전용, 납기 2주" }
    ],
    aiSummary: "대기업 협력사에서 연간 계약 기준 대량 발주 문의. 표준 단가 대비 15% 할인 및 2주 납기 보장 요청. 영업 관리자 승인 필요.",
    notes: []
  },
  {
    id: "ESC-004",
    inquiryId: "INQ-009",
    customerName: "현대자동차",
    subject: "신규 EV 부품 가공용 공구 세트 구성",
    reason: "복합 가공 공정 - 여러 공구 조합 검토 필요",
    priority: "medium",
    status: "approved",
    requestedBy: "최영업",
    requestedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    assignedTo: "이기술",
    recommendedProducts: [
      { productId: "P001", confidence: 95, reason: "알루미늄 하우징 황삭" },
      { productId: "P002", confidence: 93, reason: "알루미늄 정삭" },
      { productId: "P007", confidence: 90, reason: "홀 가공" }
    ],
    aiSummary: "EV 모터 하우징 가공을 위한 공구 세트 구성. 알루미늄 다이캐스팅 소재, 황삭-정삭-홀가공 공정에 최적화된 조합 제안.",
    notes: ["가공 시뮬레이션 완료, 사이클 타임 15% 단축 가능 - 이기술", "고객사 방문 테스트 일정 조율 중"]
  }
]

export default function EscalationPage() {
  const { toast } = useToast()
  const [escalations, setEscalations] = useState(mockEscalations)
  const [selectedCase, setSelectedCase] = useState<EscalationCase | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [filterPriority, setFilterPriority] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false)
  const [reviewAction, setReviewAction] = useState<"approve" | "reject" | null>(null)
  const [reviewNote, setReviewNote] = useState("")
  const [editedReason, setEditedReason] = useState("")
  const [knowledgeNote, setKnowledgeNote] = useState("")

  const filteredEscalations = escalations.filter(esc => {
    if (filterStatus !== "all" && esc.status !== filterStatus) return false
    if (filterPriority !== "all" && esc.priority !== filterPriority) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        esc.customerName.toLowerCase().includes(query) ||
        esc.subject.toLowerCase().includes(query) ||
        esc.id.toLowerCase().includes(query)
      )
    }
    return true
  })

  const pendingCount = escalations.filter(e => e.status === "pending").length
  const reviewingCount = escalations.filter(e => e.status === "reviewing").length

  const handleStartReview = (esc: EscalationCase) => {
    setEscalations(prev => prev.map(e => 
      e.id === esc.id ? { ...e, status: "reviewing" as const, assignedTo: "현재 사용자" } : e
    ))
    setSelectedCase({ ...esc, status: "reviewing", assignedTo: "현재 사용자" })
    toast({
      title: "검토 시작",
      description: `${esc.id} 케이스 검토를 시작합니다.`
    })
  }

  const handleOpenReviewDialog = (action: "approve" | "reject") => {
    setReviewAction(action)
    setEditedReason(selectedCase?.recommendedProducts[0]?.reason || "")
    setIsReviewDialogOpen(true)
  }

  const handleSubmitReview = () => {
    if (!selectedCase || !reviewAction) return

    const newStatus = reviewAction === "approve" ? "approved" : "rejected"
    const updatedCase = {
      ...selectedCase,
      status: newStatus as "approved" | "rejected",
      notes: [
        ...selectedCase.notes,
        `${reviewAction === "approve" ? "승인" : "반려"}: ${reviewNote || "검토 완료"} - 현재 사용자`,
        ...(knowledgeNote ? [`지식 노트: ${knowledgeNote}`] : [])
      ],
      recommendedProducts: selectedCase.recommendedProducts.map((p, i) => 
        i === 0 ? { ...p, reason: editedReason || p.reason } : p
      )
    }

    setEscalations(prev => prev.map(e => e.id === selectedCase.id ? updatedCase : e))
    setSelectedCase(updatedCase)
    setIsReviewDialogOpen(false)
    setReviewNote("")
    setKnowledgeNote("")

    toast({
      title: reviewAction === "approve" ? "승인 완료" : "반려 완료",
      description: `${selectedCase.id} 케이스가 ${reviewAction === "approve" ? "승인" : "반려"}되었습니다. 영업 담당자에게 알림이 전송됩니다.`
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50">대기중</Badge>
      case "reviewing":
        return <Badge variant="outline" className="text-blue-600 border-blue-300 bg-blue-50">검토중</Badge>
      case "approved":
        return <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">승인됨</Badge>
      case "rejected":
        return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50">반려됨</Badge>
      default:
        return null
    }
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "high":
        return <Badge className="bg-red-500">긴급</Badge>
      case "medium":
        return <Badge className="bg-yellow-500 text-yellow-900">보통</Badge>
      case "low":
        return <Badge variant="secondary">낮음</Badge>
      default:
        return null
    }
  }

  const formatTimeAgo = (date: Date) => {
    const diff = Date.now() - date.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return "방금 전"
    if (hours < 24) return `${hours}시간 전`
    return `${Math.floor(hours / 24)}일 전`
  }

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">전문가 검토</h1>
              <p className="text-muted-foreground text-sm">Specialist Review Queue</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <span>대기: {pendingCount}</span>
                </div>
                <Separator orientation="vertical" className="h-4" />
                <div className="flex items-center gap-1">
                  <Eye className="h-4 w-4 text-blue-500" />
                  <span>검토중: {reviewingCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="고객명, 제목, ID로 검색..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="pending">대기중</SelectItem>
                <SelectItem value="reviewing">검토중</SelectItem>
                <SelectItem value="approved">승인됨</SelectItem>
                <SelectItem value="rejected">반려됨</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="우선순위" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                <SelectItem value="high">긴급</SelectItem>
                <SelectItem value="medium">보통</SelectItem>
                <SelectItem value="low">낮음</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Case List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
            {filteredEscalations.map((esc) => (
              <Card 
                key={esc.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedCase?.id === esc.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setSelectedCase(esc)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">{esc.id}</span>
                        {getPriorityBadge(esc.priority)}
                        {getStatusBadge(esc.status)}
                      </div>
                      <h3 className="font-medium truncate">{esc.subject}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{esc.customerName}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {esc.reason}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-muted-foreground">{formatTimeAgo(esc.requestedAt)}</p>
                      <p className="text-xs mt-1">요청: {esc.requestedBy}</p>
                      {esc.assignedTo && (
                        <p className="text-xs text-blue-600">담당: {esc.assignedTo}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredEscalations.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>검토 대기 케이스가 없습니다</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      <Sheet open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedCase && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <SheetTitle>{selectedCase.id}</SheetTitle>
                  {getPriorityBadge(selectedCase.priority)}
                  {getStatusBadge(selectedCase.status)}
                </div>
                <SheetDescription>{selectedCase.subject}</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Customer Info */}
                <div>
                  <h4 className="text-sm font-medium mb-2">고객 정보</h4>
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{selectedCase.customerName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{selectedCase.customerName}</p>
                          <Link 
                            href={`/inbox/${selectedCase.inquiryId}`}
                            className="text-sm text-primary hover:underline"
                          >
                            문의 상세 보기
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Escalation Reason */}
                <div>
                  <h4 className="text-sm font-medium mb-2">이관 사유</h4>
                  <Card className="border-orange-200 bg-orange-50">
                    <CardContent className="p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5" />
                        <p className="text-sm">{selectedCase.reason}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* AI Summary */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    AI 요약
                  </h4>
                  <Card>
                    <CardContent className="p-3">
                      <p className="text-sm">{selectedCase.aiSummary}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Recommended Products */}
                <div>
                  <h4 className="text-sm font-medium mb-2">AI 추천 제품</h4>
                  <div className="space-y-2">
                    {selectedCase.recommendedProducts.map((rec, idx) => {
                      const product = mockProducts.find(p => p.id === rec.productId)
                      if (!product) return null
                      return (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-sm">{product.name}</span>
                                  <Badge 
                                    variant={rec.confidence >= 80 ? "default" : "secondary"}
                                    className={rec.confidence >= 80 ? "bg-green-600" : rec.confidence >= 60 ? "bg-yellow-500 text-yellow-900" : "bg-red-500"}
                                  >
                                    {rec.confidence}%
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">{product.sku || product.modelNumber}</p>
                                <p className="text-sm mt-1">{rec.reason}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>

                {/* Notes */}
                {selectedCase.notes.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">검토 노트</h4>
                    <div className="space-y-2">
                      {selectedCase.notes.map((note, idx) => (
                        <Card key={idx}>
                          <CardContent className="p-3">
                            <p className="text-sm">{note}</p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                {selectedCase.status === "pending" && (
                  <div className="pt-4 border-t">
                    <Button 
                      className="w-full" 
                      onClick={() => handleStartReview(selectedCase)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      검토 시작하기
                    </Button>
                  </div>
                )}

                {selectedCase.status === "reviewing" && (
                  <div className="pt-4 border-t space-y-3">
                    <div className="flex gap-2">
                      <Button 
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => handleOpenReviewDialog("approve")}
                      >
                        <ThumbsUp className="h-4 w-4 mr-2" />
                        승인
                      </Button>
                      <Button 
                        variant="outline" 
                        className="flex-1 border-red-300 text-red-600 hover:bg-red-50 bg-transparent"
                        onClick={() => handleOpenReviewDialog("reject")}
                      >
                        <ThumbsDown className="h-4 w-4 mr-2" />
                        반려
                      </Button>
                    </div>
                    <p className="text-xs text-center text-muted-foreground">
                      승인 시 영업 담당자에게 알림이 전송되며, 고객 발송이 가능해집니다.
                    </p>
                  </div>
                )}

                {(selectedCase.status === "approved" || selectedCase.status === "rejected") && (
                  <div className="pt-4 border-t">
                    <div className={`p-4 rounded-lg ${selectedCase.status === "approved" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                      <div className="flex items-center gap-2">
                        {selectedCase.status === "approved" ? (
                          <CheckCircle2 className="h-5 w-5" />
                        ) : (
                          <XCircle className="h-5 w-5" />
                        )}
                        <span className="font-medium">
                          {selectedCase.status === "approved" ? "승인 완료" : "반려됨"}
                        </span>
                      </div>
                      <p className="text-sm mt-1">
                        {selectedCase.status === "approved" 
                          ? "영업 담당자에게 알림이 전송되었습니다."
                          : "반려 사유와 함께 영업 담당자에게 전달되었습니다."
                        }
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Review Dialog */}
      <Dialog open={isReviewDialogOpen} onOpenChange={setIsReviewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "approve" ? "추천 승인" : "추천 반려"}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "approve" 
                ? "승인 후 영업 담당자가 고객에게 견적을 발송할 수 있습니다."
                : "반려 사유를 입력해주세요. 영업 담당자에게 전달됩니다."
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {reviewAction === "approve" && (
              <div className="space-y-2">
                <Label>추천 이유 수정 (선택)</Label>
                <Textarea
                  placeholder="AI가 생성한 추천 이유를 수정하거나 보완할 수 있습니다."
                  value={editedReason}
                  onChange={(e) => setEditedReason(e.target.value)}
                  rows={3}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>{reviewAction === "approve" ? "승인 코멘트 (선택)" : "반려 사유 (필수)"}</Label>
              <Textarea
                placeholder={reviewAction === "approve" ? "추가 코멘트가 있다면 입력하세요." : "반려 사유를 입력하세요."}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                지식 노트 추가 (선택)
              </Label>
              <Textarea
                placeholder="이 케이스에서 중요한 판단 근거나 학습 포인트를 기록하세요. 향후 유사 케이스에 참고됩니다."
                value={knowledgeNote}
                onChange={(e) => setKnowledgeNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReviewDialogOpen(false)}>
              취소
            </Button>
            <Button 
              onClick={handleSubmitReview}
              className={reviewAction === "approve" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              disabled={reviewAction === "reject" && !reviewNote.trim()}
            >
              {reviewAction === "approve" ? "승인하기" : "반려하기"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
