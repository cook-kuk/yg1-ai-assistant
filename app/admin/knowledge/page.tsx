"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  BookOpen, Search, FileText, ArrowRight, CheckCircle2,
  Clock, User
} from "lucide-react"
import { crossReferences } from "@/lib/demo-data"
import { cn } from "@/lib/utils"

const rules = [
  { id: "R001", name: "SUS 계열 코팅 매칭", desc: "SUS304/316 소재 시 TiAlN 코팅 우선 적용", category: "소재매칭", status: "active" },
  { id: "R002", name: "단속 절삭 안정성 감점", desc: "단속절삭 조건 시 안정성 가중치 1.5배 적용", category: "점수로직", status: "active" },
  { id: "R003", name: "고이송 정삭 제외", desc: "Hi-Feed 계열 공구는 정삭 모드에서 후보 제외", category: "필터링", status: "active" },
  { id: "R004", name: "긴급 납기 재고 우선", desc: "납기 우선 시 즉시출고 가능 제품만 상위 랭크", category: "랭킹", status: "active" },
  { id: "R005", name: "L/D 4 이상 경고", desc: "가공 깊이/직경 비율 4 초과 시 안정성 경고 표시", category: "안전", status: "active" },
  { id: "R006", name: "항공우주 특주 분기", desc: "항공 인증 요구 시 자동 특주 티켓 생성", category: "분기로직", status: "active" },
]

const approvalLogs = [
  { id: "AL001", action: "규칙 추가", target: "R006", user: "박관리자", date: "2026-02-08 14:30", status: "승인" },
  { id: "AL002", action: "크로스레퍼런스 갱신", target: "SANDVIK 신규 8건", user: "김기술", date: "2026-02-07 10:15", status: "승인" },
  { id: "AL003", action: "가격 정책 변경", target: "마진 범위 10→12%", user: "이영업", date: "2026-02-06 16:40", status: "대기" },
]

export default function KnowledgePage() {
  const [searchTerm, setSearchTerm] = useState("")

  const filteredRules = rules.filter(r =>
    r.name.includes(searchTerm) || r.desc.includes(searchTerm) || r.category.includes(searchTerm)
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#ed1c24]" />
            지식 베이스 / 규칙 관리
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            추천 규칙, 크로스레퍼런스, 승인 로그를 관리합니다
          </p>
        </div>

        <Tabs defaultValue="rules">
          <TabsList className="mb-4">
            <TabsTrigger value="rules">추천 규칙</TabsTrigger>
            <TabsTrigger value="crossref">크로스레퍼런스</TabsTrigger>
            <TabsTrigger value="logs">승인 로그</TabsTrigger>
          </TabsList>

          {/* Rules */}
          <TabsContent value="rules">
            <div className="flex gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="규칙 검색..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              <Button className="bg-[#ed1c24] hover:bg-[#d01920]">규칙 추가</Button>
            </div>

            <div className="space-y-2">
              {filteredRules.map(rule => (
                <Card key={rule.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-mono text-muted-foreground w-12">{rule.id}</span>
                      <div>
                        <p className="font-medium text-sm">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">{rule.desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{rule.category}</Badge>
                      <Badge className="bg-green-600 text-xs">활성</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Cross Reference */}
          <TabsContent value="crossref">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">경쟁사</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">경쟁사 모델</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground" />
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">YG-1 SKU</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">YG-1 제품명</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">신뢰도</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">유형</th>
                    </tr>
                  </thead>
                  <tbody>
                    {crossReferences.map((cr, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-2.5 text-xs">{cr.competitorBrand}</td>
                        <td className="px-4 py-2.5 text-xs font-mono">{cr.competitorModel}</td>
                        <td className="px-4 py-2.5 text-center"><ArrowRight className="h-3 w-3 text-muted-foreground mx-auto" /></td>
                        <td className="px-4 py-2.5 text-xs font-mono font-medium">{cr.ygSku}</td>
                        <td className="px-4 py-2.5 text-xs">{cr.ygName}</td>
                        <td className="px-4 py-2.5 text-center text-xs font-bold">{cr.confidence}%</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge className={cn(
                            "text-[10px]",
                            cr.level === "upgrade" ? "bg-green-600" : cr.level === "equivalent" ? "bg-blue-600" : "bg-amber-600"
                          )}>
                            {cr.level === "equivalent" ? "동등" : cr.level === "upgrade" ? "상위" : "절감"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Approval Logs */}
          <TabsContent value="logs">
            <div className="space-y-2">
              {approvalLogs.map(log => (
                <Card key={log.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full",
                        log.status === "승인" ? "bg-green-100" : "bg-amber-100"
                      )}>
                        {log.status === "승인" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Clock className="h-4 w-4 text-amber-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{log.action}: {log.target}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          <span>{log.user}</span>
                          <span>{log.date}</span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={log.status === "승인" ? "default" : "secondary"} className="text-xs">
                      {log.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
