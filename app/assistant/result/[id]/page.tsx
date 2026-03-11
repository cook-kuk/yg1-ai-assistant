"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sparkles, ArrowLeft, CheckCircle2, AlertTriangle, Shield,
  Package, Clock, Truck, Phone, FileText, Send, ChevronDown,
  BarChart3, Zap, Users, ArrowRight
} from "lucide-react"
import { candidateProducts, crossReferences, warehouses, distributors, type UserRole } from "@/lib/demo-data"
import { cn } from "@/lib/utils"

export default function ResultPage() {
  const params = useParams()
  const [role, setRole] = useState<UserRole>("customer")
  const [expandedScore, setExpandedScore] = useState<string | null>(null)

  const roleLabels: Record<UserRole, string> = {
    customer: "고객",
    dealer: "대리점",
    sales: "영업",
    cs: "CS"
  }

  const getPriceByRole = (cp: typeof candidateProducts[0]) => {
    switch (role) {
      case "customer": return cp.price.customer
      case "dealer": return cp.price.dealer
      case "sales": case "cs": return cp.price.internal
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="border-b bg-muted/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/assistant/new">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-lg font-bold flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-[#ed1c24]" />
                  추천 결과 보드
                </h1>
                <p className="text-xs text-muted-foreground">
                  {"SUS304 측면가공 | 엔드밀 D10 | 후보군 120 → 3"}
                </p>
              </div>
            </div>
            {/* Role Switch */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              {(Object.entries(roleLabels) as [UserRole, string][]).map(([r, label]) => (
                <Button
                  key={r}
                  variant={role === r ? "default" : "ghost"}
                  size="sm"
                  className={cn("text-xs h-7", role === r && "bg-[#ed1c24] hover:bg-[#d01920]")}
                  onClick={() => setRole(r)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <Tabs defaultValue="candidates">
          <TabsList className="mb-4">
            <TabsTrigger value="candidates">Top-3 추천</TabsTrigger>
            <TabsTrigger value="compare">비교 테이블</TabsTrigger>
            <TabsTrigger value="crossref">크로스레퍼런스</TabsTrigger>
          </TabsList>

          {/* TAB: Candidates */}
          <TabsContent value="candidates">
            <div className="grid grid-cols-3 gap-4 mb-6">
              {candidateProducts.map((cp, i) => (
                <Card key={cp.id} className={cn(
                  "overflow-hidden",
                  i === 0 && "ring-2 ring-[#ed1c24]/30"
                )}>
                  {i === 0 && (
                    <div className="bg-[#ed1c24] text-white text-center text-xs py-1 font-medium">
                      최적 추천
                    </div>
                  )}
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <img src={cp.imageUrl || "/placeholder.svg"} alt={cp.name} className="w-16 h-16 rounded-lg object-cover bg-muted" />
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge className={cn(
                            "text-[10px]",
                            i === 0 ? "bg-[#ed1c24]" : "bg-muted-foreground"
                          )}>#{i + 1}</Badge>
                          <Badge variant="outline" className="text-[10px]">{cp.fitTag}</Badge>
                        </div>
                        <p className="font-semibold text-sm">{cp.name}</p>
                        <p className="text-xs text-muted-foreground">{cp.sku}</p>
                      </div>
                    </div>

                    {/* Score */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">적합도</span>
                        <span className="text-sm font-bold">{cp.score.total}점</span>
                      </div>
                      <Progress value={cp.score.total} className="h-2" />
                    </div>

                    {/* Score breakdown toggle */}
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"
                      onClick={() => setExpandedScore(expandedScore === cp.id ? null : cp.id)}
                    >
                      <ChevronDown className={cn("h-3 w-3 transition-transform", expandedScore === cp.id && "rotate-180")} />
                      점수 상세
                    </button>
                    {expandedScore === cp.id && (
                      <div className="bg-muted/30 rounded-lg p-2 mb-3 space-y-1.5">
                        {[
                          { l: "필수조건", v: cp.score.gatePass ? "PASS" : "FAIL", ok: cp.score.gatePass },
                          { l: "성능 적합도", v: cp.score.performance },
                          { l: "안정성", v: cp.score.stability },
                          { l: "납기 적합도", v: cp.score.delivery },
                          { l: "비용 적합도", v: cp.score.cost },
                        ].map((s, j) => (
                          <div key={j} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{s.l}</span>
                            <span className={cn("font-medium", typeof s.v === "string" && s.ok ? "text-green-600" : "")}>{s.v}</span>
                          </div>
                        ))}
                        {cp.score.changeReason && (
                          <div className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
                            {cp.score.changeReason}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Metrics */}
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {[
                        { l: "cycle time", v: cp.metrics.cycleTime },
                        { l: "tool life", v: cp.metrics.toolLife },
                        { l: "cost", v: cp.metrics.costIndex },
                        { l: "CO2", v: cp.metrics.co2Index },
                      ].map((m, j) => (
                        <div key={j} className="bg-muted/50 rounded p-1.5 text-center">
                          <p className="text-[9px] text-muted-foreground">{m.l}</p>
                          <p className="text-xs font-bold">{m.v}</p>
                        </div>
                      ))}
                    </div>

                    {/* Reasons */}
                    <div className="space-y-1 mb-3">
                      {cp.reasons.map((r, j) => (
                        <div key={j} className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>

                    {/* Risks */}
                    {cp.risks.map((r, j) => (
                      <div key={j} className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2 text-xs">
                        <div className="flex items-start gap-1.5 text-amber-800 mb-1">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span className="font-medium">{r.text}</span>
                        </div>
                        <p className="ml-4.5 text-amber-600">{r.mitigation}</p>
                      </div>
                    ))}

                    <Separator className="my-3" />

                    {/* Price + Stock */}
                    <div className="space-y-2 mb-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">가격</span>
                        <span className="font-medium">{getPriceByRole(cp)}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">재고</span>
                        <Badge variant={cp.stock === "instock" ? "default" : cp.stock === "limited" ? "secondary" : "destructive"} className="text-[10px]">
                          {cp.stock === "instock" ? `즉시출고 (${cp.stockQty}개)` : cp.stock === "limited" ? `한정 ${cp.stockQty}개` : "재고없음"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">납기</span>
                        <span>{cp.leadTimeDays === 0 ? "당일 출하" : `${cp.leadTimeDays}일`}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">출하지</span>
                        <span>{cp.warehouse}</span>
                      </div>
                    </div>

                    {/* Competitor Equivalents */}
                    {cp.competitorEquivalents.length > 0 && (
                      <div className="bg-blue-50 rounded-lg p-2 mb-3">
                        <p className="text-[10px] font-semibold text-blue-700 mb-1">경쟁사 대응</p>
                        {cp.competitorEquivalents.map((eq, j) => (
                          <div key={j} className="flex items-center justify-between text-[10px]">
                            <span className="text-blue-800">{eq.brand} {eq.model}</span>
                            <Badge variant="outline" className="text-[9px] border-blue-300 text-blue-700">
                              {eq.level === "equivalent" ? "동등" : "상위"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="space-y-1.5">
                      <Button size="sm" className="w-full text-xs bg-[#ed1c24] hover:bg-[#d01920]">
                        <FileText className="h-3 w-3 mr-1" />견적 요청
                      </Button>
                      {role !== "customer" && (
                        <Button size="sm" variant="outline" className="w-full text-xs bg-transparent">
                          <Phone className="h-3 w-3 mr-1" />담당 영업 연결
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Commercial Action Panel */}
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-[#ed1c24]" />
                  실행 액션 패널
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-5 gap-2">
                  <Button className="bg-[#ed1c24] hover:bg-[#d01920]">
                    <FileText className="h-4 w-4 mr-1.5" />견적 요청
                  </Button>
                  <Button variant="outline" className="bg-transparent">
                    <Package className="h-4 w-4 mr-1.5" />재고/납기 확인
                  </Button>
                  <Button variant="outline" className="bg-transparent">
                    <Phone className="h-4 w-4 mr-1.5" />담당 영업 연결
                  </Button>
                  <Button variant="outline" className="bg-transparent">
                    <Send className="h-4 w-4 mr-1.5" />주문 의사 전달
                  </Button>
                  <Button variant="outline" className="bg-transparent">
                    <Shield className="h-4 w-4 mr-1.5" />기술 검토 요청
                  </Button>
                </div>

                {/* Price Policy Notice */}
                <div className="mt-4 bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
                  {role === "customer" && "표시 가격은 계약/수량 조건에 따라 변동되는 예상가입니다. 정확한 단가는 견적 요청 시 확정됩니다."}
                  {role === "dealer" && "표시 가격은 채널 기준가이며, 조건부 할인이 별도 적용될 수 있습니다."}
                  {(role === "sales" || role === "cs") && "내부 기준단가 및 권장 마진 범위가 표시됩니다. 외부 노출에 주의하세요."}
                </div>
              </CardContent>
            </Card>

            {/* YG-1 Advantage */}
            <Card className="bg-gradient-to-r from-[#1a1a2e] to-[#16213e] text-white">
              <CardContent className="p-5">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  왜 YG-1 Agent가 유리한가
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-xs">
                    <p className="font-medium mb-1">정밀 입력 + 대화형 보정</p>
                    <p className="text-white/60">ITA급 정밀도와 ChatUX 편의성을 동시에</p>
                  </div>
                  <div className="text-xs">
                    <p className="font-medium mb-1">추천에서 실행까지 연결</p>
                    <p className="text-white/60">견적/납기/재고/영업까지 원클릭 액션</p>
                  </div>
                  <div className="text-xs">
                    <p className="font-medium mb-1">스탠다드/스페셜 자동 분기</p>
                    <p className="text-white/60">실패 없는 운영, 위험 자동 감지 안전망</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Compare Table */}
          <TabsContent value="compare">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">항목</th>
                        {candidateProducts.map((cp, i) => (
                          <th key={cp.id} className={cn("text-center px-4 py-3 text-xs font-medium", i === 0 && "bg-[#ed1c24]/5")}>
                            {cp.sku}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "적합도", render: (cp: typeof candidateProducts[0]) => `${cp.score.total}점` },
                        { label: "예상가", render: (cp: typeof candidateProducts[0]) => getPriceByRole(cp) },
                        { label: "재고", render: (cp: typeof candidateProducts[0]) => cp.stock === "instock" ? `즉시 (${cp.stockQty})` : cp.stock === "limited" ? `한정 ${cp.stockQty}` : "없음" },
                        { label: "납기", render: (cp: typeof candidateProducts[0]) => cp.leadTimeDays === 0 ? "당일" : `${cp.leadTimeDays}일` },
                        { label: "속도 지수", render: (cp: typeof candidateProducts[0]) => String(cp.metrics.cycleTime) },
                        { label: "수명 지수", render: (cp: typeof candidateProducts[0]) => String(cp.metrics.toolLife) },
                        { label: "비용 지수", render: (cp: typeof candidateProducts[0]) => String(cp.metrics.costIndex) },
                        { label: "추천 근거", render: (cp: typeof candidateProducts[0]) => cp.reasons[0] },
                      ].map((row, j) => (
                        <tr key={j} className="border-b last:border-0">
                          <td className="px-4 py-2.5 text-xs font-medium text-muted-foreground">{row.label}</td>
                          {candidateProducts.map((cp, i) => (
                            <td key={cp.id} className={cn("px-4 py-2.5 text-xs text-center", i === 0 && "bg-[#ed1c24]/5 font-medium")}>
                              {row.render(cp)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr className="border-t">
                        <td className="px-4 py-2.5 text-xs font-medium text-muted-foreground">액션</td>
                        {candidateProducts.map((cp, i) => (
                          <td key={cp.id} className={cn("px-4 py-2.5 text-center", i === 0 && "bg-[#ed1c24]/5")}>
                            <Button size="sm" className={cn("text-[10px] h-6", i === 0 ? "bg-[#ed1c24] hover:bg-[#d01920]" : "")}>
                              견적요청
                            </Button>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Cross Reference */}
          <TabsContent value="crossref">
            <div className="grid grid-cols-2 gap-4">
              {crossReferences.map((cr, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{cr.competitorBrand}</Badge>
                        <span className="text-sm font-medium">{cr.competitorModel}</span>
                      </div>
                      <Badge className={cn(
                        "text-xs",
                        cr.level === "upgrade" ? "bg-green-600" : cr.level === "equivalent" ? "bg-blue-600" : "bg-amber-600"
                      )}>
                        {cr.level === "equivalent" ? "동등" : cr.level === "upgrade" ? "상위 대체" : "절감 대안"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-medium text-foreground">{cr.ygSku}</span>
                      <span>{cr.ygName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">매핑 신뢰도</span>
                      <Progress value={cr.confidence} className="h-1.5 flex-1" />
                      <span className="text-xs font-bold">{cr.confidence}%</span>
                    </div>
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
