"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Users, Eye, EyeOff, ShieldCheck, Package, Truck,
  AlertTriangle, CheckCircle2, ArrowRight
} from "lucide-react"
import { candidateProducts, type UserRole } from "@/lib/demo-data"
import { cn } from "@/lib/utils"

export default function PolicySimulatorPage() {
  const [activeRole, setActiveRole] = useState<UserRole>("customer")

  const roles: { role: UserRole; label: string; desc: string }[] = [
    { role: "customer", label: "고객", desc: "계약/수량 조건별 예상가만 표시" },
    { role: "dealer", label: "대리점", desc: "채널 기준가 + 조건부 할인 안내" },
    { role: "sales", label: "영업", desc: "내부 기준단가 + 권장 마진 범위" },
    { role: "cs", label: "CS", desc: "내부 기준단가 + 재고/납기 우선" },
  ]

  const getPriceLabel = (role: UserRole) => {
    switch (role) {
      case "customer": return "예상가 (계약조건별 변동)"
      case "dealer": return "채널가 (조건부 할인)"
      case "sales": return "내부 기준단가 (마진 포함)"
      case "cs": return "내부 기준단가"
    }
  }

  const getVisibility = (role: UserRole) => {
    return {
      price: true,
      margin: role === "sales" || role === "cs",
      internalCost: role === "sales" || role === "cs",
      dealerDiscount: role === "dealer" || role === "sales",
      stockDetail: true,
      warehouseInfo: role !== "customer",
      salesContact: role === "customer" || role === "dealer",
      techReview: true,
    }
  }

  const vis = getVisibility(activeRole)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-yg1" />
            역할별 정책 시뮬레이터
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            동일한 추천 결과가 역할에 따라 어떻게 다르게 표시되는지 확인합니다
          </p>
        </div>

        {/* Role Selector */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {roles.map(r => (
            <Card
              key={r.role}
              className={cn(
                "cursor-pointer transition-all",
                activeRole === r.role ? "ring-2 ring-[#ed1c24] bg-yg1/5" : "hover:bg-muted/50"
              )}
              onClick={() => setActiveRole(r.role)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4" />
                  <span className="font-semibold text-sm">{r.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{r.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Visibility Matrix */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">정보 공개 매트릭스</CardTitle>
            <CardDescription className="text-xs">현재 역할: <strong>{roles.find(r => r.role === activeRole)?.label}</strong></CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "가격 표시", visible: vis.price },
                { label: "마진 정보", visible: vis.margin },
                { label: "내부 원가", visible: vis.internalCost },
                { label: "대리점 할인", visible: vis.dealerDiscount },
                { label: "재고 상세", visible: vis.stockDetail },
                { label: "창고 위치", visible: vis.warehouseInfo },
                { label: "담당 영업 연결", visible: vis.salesContact },
                { label: "기술 검토", visible: vis.techReview },
              ].map((item, i) => (
                <div key={i} className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                  item.visible ? "bg-green-50 text-green-800" : "bg-muted text-muted-foreground"
                )}>
                  {item.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {item.label}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Product Cards by Role */}
        <h3 className="font-semibold text-sm mb-3">제품별 역할 기반 표시 예시</h3>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {candidateProducts.map((cp, i) => {
            const price = activeRole === "customer" ? cp.price.customer :
                          activeRole === "dealer" ? cp.price.dealer : cp.price.internal
            return (
              <Card key={cp.id} className={cn(i === 0 && "ring-2 ring-[#ed1c24]/20")}>
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-1">{cp.name}</p>
                  <p className="text-xs text-muted-foreground mb-3">{cp.sku}</p>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{getPriceLabel(activeRole)}</span>
                      <span className="font-medium">{price}</span>
                    </div>
                    
                    {vis.margin && (
                      <div className="flex justify-between text-green-700">
                        <span>권장 마진</span>
                        <span className="font-medium">10-15%</span>
                      </div>
                    )}

                    <Separator />

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">재고</span>
                      <Badge variant={cp.stock === "instock" ? "default" : cp.stock === "limited" ? "secondary" : "destructive"} className="text-[10px]">
                        {cp.stock === "instock" ? `즉시출고 (${cp.stockQty})` : cp.stock === "limited" ? `한정 ${cp.stockQty}개` : "재고없음"}
                      </Badge>
                    </div>

                    {vis.warehouseInfo && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">출하지</span>
                        <span>{cp.warehouse}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex gap-1.5">
                    <Button size="sm" className="flex-1 text-xs bg-yg1 hover:bg-yg1-hover">견적요청</Button>
                    {vis.salesContact && (
                      <Button size="sm" variant="outline" className="flex-1 text-xs bg-transparent">영업연결</Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Stock/Lead Time Fallback */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Package className="h-4 w-4" />
              재고/납기 폴백 로직 시뮬레이터
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { status: "instock", label: "즉시출고", desc: "화성 중앙창고 150개 보유", color: "text-green-700 bg-green-50" },
              { status: "limited", label: "제한수량", desc: "오산 물류센터 12개 한정, 추가 입고 5일 소요", color: "text-amber-700 bg-amber-50" },
              { status: "outofstock", label: "재고없음", desc: "대체품 자동 제시 + 예상 입고일 안내 + 가까운 대리점 연결", color: "text-red-700 bg-red-50" },
            ].map((item, i) => (
              <div key={i} className={cn("rounded-lg p-3 text-sm", item.color)}>
                <div className="flex items-center gap-2 mb-1">
                  {item.status === "instock" ? <CheckCircle2 className="h-4 w-4" /> :
                   item.status === "limited" ? <AlertTriangle className="h-4 w-4" /> :
                   <Truck className="h-4 w-4" />}
                  <span className="font-semibold">{item.label}</span>
                </div>
                <p className="text-xs ml-6">{item.desc}</p>
                {item.status === "outofstock" && (
                  <div className="ml-6 mt-2 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">대체: YG-EM4-SUS-08</Badge>
                    <ArrowRight className="h-3 w-3" />
                    <Badge variant="outline" className="text-[10px]">서울공구 (즉시출고 가능)</Badge>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
