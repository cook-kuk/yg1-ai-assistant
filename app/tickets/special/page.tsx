"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Shield, AlertTriangle, Clock, User, FileText,
  ChevronRight, CheckCircle2, XCircle, Phone
} from "lucide-react"
import { cn } from "@/lib/utils"

const mockTickets = [
  {
    id: "SPT-001",
    createdAt: "2026-02-09 10:32",
    reason: "표준 규격 불일치",
    summary: "특수 형상 볼엔드밀 R2.5 비대칭 날 형상 요청. 기존 표준품으로는 고객 요구 면조도 Ra0.4 달성 불가.",
    missingInfo: ["정확한 형상 도면", "공차 요구사항"],
    reviewReason: "비표준 형상으로 표준 추천 엔진 적용 불가, 기술검토 필수",
    priority: "urgent" as const,
    status: "open" as const,
    customer: "삼성전자 반도체장비팀",
    assignee: null,
  },
  {
    id: "SPT-002",
    createdAt: "2026-02-08 15:21",
    reason: "불확실성 점수 높음",
    summary: "고객 제공 정보 부족 (소재/경도/장비 모두 미확인). AI 가정 적용 추천은 위험도 높음.",
    missingInfo: ["피삭재 종류", "경도 범위", "사용 장비"],
    reviewReason: "필수 3개 조건 미확인으로 표준 추천 신뢰도 35% 미만",
    priority: "normal" as const,
    status: "assigned" as const,
    customer: "현대위아 가공센터",
    assignee: "김기술 (R&D)",
  },
  {
    id: "SPT-003",
    createdAt: "2026-02-07 09:15",
    reason: "품질요구 과도",
    summary: "항공우주 부품 가공. Ra0.2 이하 + 동심도 5um 이내 요구. 표준 공구로 보증 불가.",
    missingInfo: [],
    reviewReason: "항공우주 품질 기준 적용 필요, 전용 라인 검토",
    priority: "urgent" as const,
    status: "resolved" as const,
    customer: "한화에어로스페이스",
    assignee: "박전문 (항공팀)",
  },
]

const priorityColors = {
  urgent: "bg-red-100 text-red-800 border-red-200",
  normal: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
}

const statusConfig = {
  open: { label: "대기중", color: "bg-red-500", icon: AlertTriangle },
  assigned: { label: "검토중", color: "bg-amber-500", icon: Clock },
  resolved: { label: "완료", color: "bg-green-500", icon: CheckCircle2 },
}

export default function SpecialTicketPage() {
  const [selected, setSelected] = useState(mockTickets[0])

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Ticket List */}
      <div className="w-96 border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-600" />
            특주/스페셜 티켓
          </h1>
          <p className="text-xs text-muted-foreground mt-1">자동 생성된 표준 외 요청 관리</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {mockTickets.map(ticket => {
            const st = statusConfig[ticket.status]
            return (
              <Card
                key={ticket.id}
                className={cn(
                  "cursor-pointer hover:bg-muted/50 transition-colors",
                  selected?.id === ticket.id && "ring-2 ring-[#ed1c24]/30 bg-muted/30"
                )}
                onClick={() => setSelected(ticket)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono text-muted-foreground">{ticket.id}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={cn("w-2 h-2 rounded-full", st.color)} />
                      <span className="text-[10px]">{st.label}</span>
                    </div>
                  </div>
                  <p className="text-sm font-medium mb-1 line-clamp-1">{ticket.reason}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-[10px]", priorityColors[ticket.priority])}>
                      {ticket.priority === "urgent" ? "긴급" : ticket.priority === "normal" ? "보통" : "낮음"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{ticket.customer}</span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Ticket Detail */}
      {selected && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Badge variant="outline" className="font-mono">{selected.id}</Badge>
                <Badge variant="outline" className={cn(priorityColors[selected.priority])}>
                  {selected.priority === "urgent" ? "긴급" : "보통"}
                </Badge>
                <Badge variant={selected.status === "resolved" ? "default" : "secondary"}>
                  {statusConfig[selected.status].label}
                </Badge>
              </div>
              <h2 className="text-xl font-bold">{selected.reason}</h2>
              <p className="text-sm text-muted-foreground mt-1">{selected.customer} | {selected.createdAt}</p>
            </div>

            {/* Why special */}
            <Card className="border-amber-200 bg-amber-50/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                  표준 추천이 위험한 이유
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{selected.reviewReason}</p>
              </CardContent>
            </Card>

            {/* Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">고객 요청 요약</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{selected.summary}</p>
              </CardContent>
            </Card>

            {/* Missing Info */}
            {selected.missingInfo.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    누락 정보
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {selected.missingInfo.map((info, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        {info}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              {selected.status === "open" && (
                <>
                  <Button className="bg-[#ed1c24] hover:bg-[#d01920]">
                    <User className="h-4 w-4 mr-1.5" />전문가 배정
                  </Button>
                  <Button variant="outline" className="bg-transparent">
                    <Phone className="h-4 w-4 mr-1.5" />고객 연락
                  </Button>
                </>
              )}
              {selected.status === "assigned" && (
                <Button className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />검토 완료
                </Button>
              )}
              <Button variant="outline" className="bg-transparent">
                <FileText className="h-4 w-4 mr-1.5" />기술 리포트 생성
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
