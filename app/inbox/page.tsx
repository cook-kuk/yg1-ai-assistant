"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import {
  Search,
  Filter,
  MoreVertical,
  Sparkles,
  MessageSquarePlus,
  FileText,
  UserCheck,
  AlertTriangle,
  Paperclip,
  ExternalLink,
  ChevronRight
} from "lucide-react"
import { useApp } from "@/lib/store"
import { filterOptions, type InquiryStatus, type Urgency } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const statusConfig: Record<InquiryStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  new: { label: "신규", variant: "default" },
  "in-review": { label: "검토중", variant: "secondary" },
  "need-info": { label: "정보필요", variant: "outline" },
  "quote-drafted": { label: "견적작성", variant: "secondary" },
  sent: { label: "발송완료", variant: "secondary" },
  escalated: { label: "이관", variant: "destructive" },
  won: { label: "수주", variant: "default" },
  lost: { label: "실주", variant: "outline" }
}

const urgencyConfig: Record<Urgency, { label: string; className: string }> = {
  high: { label: "긴급", className: "bg-destructive/10 text-destructive" },
  medium: { label: "보통", className: "bg-warning/10 text-warning-foreground" },
  low: { label: "낮음", className: "bg-muted text-muted-foreground" }
}

export default function InboxPage() {
  const { inquiries, addNotification, demoScenario } = useApp()
  const [searchQuery, setSearchQuery] = useState("")
  const [regionFilter, setRegionFilter] = useState<string>("all")
  const [industryFilter, setIndustryFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all")

  const filteredInquiries = inquiries.filter(inq => {
    if (searchQuery && !inq.customer.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !inq.company.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }
    if (regionFilter !== "all" && inq.region !== regionFilter) return false
    if (industryFilter !== "all" && inq.industry !== industryFilter) return false
    if (statusFilter !== "all" && inq.status !== statusFilter) return false
    if (urgencyFilter !== "all" && inq.urgency !== urgencyFilter) return false
    return true
  })

  const handleQuickAction = (action: string, inquiryId: string) => {
    const actionMessages: Record<string, { title: string; message: string }> = {
      summary: { title: "AI 요약 생성됨", message: "문의 내용이 요약되었습니다." },
      recommend: { title: "추천 생성됨", message: "AI가 제품을 추천했습니다." },
      question: { title: "추가 질문 생성됨", message: "고객에게 보낼 질문이 준비되었습니다." },
      quote: { title: "견적 초안 생성됨", message: "견적서 초안이 작성되었습니다." },
      escalate: { title: "전문가 이관 완료", message: "R&D 전문가에게 문의가 이관되었습니다." }
    }
    
    addNotification({
      type: "success",
      ...actionMessages[action] || { title: "작업 완료", message: `${action} for ${inquiryId}` }
    })
  }

  return (
    <TooltipProvider>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">문의함</h1>
              <p className="text-sm text-muted-foreground">Inquiry Inbox</p>
            </div>
            <Badge variant="outline">{filteredInquiries.length}건</Badge>
          </div>

          {/* Demo Scenario Highlight */}
          {demoScenario && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3 flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary" />
                <p className="text-sm">
                  <span className="font-medium">Demo Mode:</span>{" "}
                  해당 시나리오의 문의를 클릭하여 진행해보세요
                </p>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="고객명 또는 회사명 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  
                  <Select value={regionFilter} onValueChange={setRegionFilter}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="지역" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 지역</SelectItem>
                      {filterOptions.regions.map(r => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={industryFilter} onValueChange={setIndustryFilter}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="산업" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 산업</SelectItem>
                      {filterOptions.industries.map(i => (
                        <SelectItem key={i} value={i}>{i}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="상태" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 상태</SelectItem>
                      {filterOptions.statuses.map(s => (
                        <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="긴급도" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {filterOptions.urgencies.map(u => (
                        <SelectItem key={u} value={u}>{urgencyConfig[u].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Inquiry Table */}
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">문의 목록</CardTitle>
              <CardDescription>Inquiry List - 클릭하여 상세 보기</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>고객/회사</TableHead>
                    <TableHead>요청 제품</TableHead>
                    <TableHead>피삭재</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>긴급도</TableHead>
                    <TableHead>접수일</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInquiries.map((inquiry) => (
                    <TableRow 
                      key={inquiry.id} 
                      className={cn(
                        "cursor-pointer hover:bg-muted/50",
                        demoScenario && inquiry.id === `INQ-00${demoScenario === 'A' ? '1' : demoScenario === 'B' ? '2' : demoScenario === 'C' ? '3' : demoScenario === 'D' ? '4' : '5'}` && "bg-primary/5 ring-1 ring-primary/20"
                      )}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {inquiry.flagged && (
                            <Tooltip>
                              <TooltipTrigger>
                                <AlertTriangle className="h-4 w-4 text-destructive" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">{inquiry.flagReason}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {(inquiry.hasDrawing || inquiry.hasSpec) && (
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/inbox/${inquiry.id}`} className="block">
                          <p className="font-medium text-foreground">{inquiry.customer}</p>
                          <p className="text-xs text-muted-foreground">{inquiry.company} / {inquiry.country}</p>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{inquiry.requestedToolType}</span>
                        <span className="text-xs text-muted-foreground ml-1">x{inquiry.quantity}</span>
                      </TableCell>
                      <TableCell>
                        {inquiry.workpieceMaterial ? (
                          <span className="text-sm">{inquiry.workpieceMaterial}</span>
                        ) : (
                          <Badge variant="outline" className="text-warning-foreground border-warning/30 text-xs">
                            미입력
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusConfig[inquiry.status].variant}>
                          {statusConfig[inquiry.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-xs px-2 py-1 rounded-full", urgencyConfig[inquiry.urgency].className)}>
                          {urgencyConfig[inquiry.urgency].label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {new Date(inquiry.createdAt).toLocaleDateString('ko-KR')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleQuickAction("summary", inquiry.id)}>
                              <Sparkles className="h-4 w-4 mr-2" />
                              AI 요약
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleQuickAction("recommend", inquiry.id)}>
                              <Sparkles className="h-4 w-4 mr-2" />
                              추천 생성
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleQuickAction("question", inquiry.id)}>
                              <MessageSquarePlus className="h-4 w-4 mr-2" />
                              추가 질문 보내기
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleQuickAction("quote", inquiry.id)}>
                              <FileText className="h-4 w-4 mr-2" />
                              견적 초안
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleQuickAction("escalate", inquiry.id)}>
                              <UserCheck className="h-4 w-4 mr-2" />
                              전문가에게 이관
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link href={`/inbox/${inquiry.id}`}>
                                <ExternalLink className="h-4 w-4 mr-2" />
                                상세 보기
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {filteredInquiries.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">필터 조건에 맞는 문의가 없습니다.</p>
                  <p className="text-sm text-muted-foreground">No inquiries match your filter criteria.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  )
}
