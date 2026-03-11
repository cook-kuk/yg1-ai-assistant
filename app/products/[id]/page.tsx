"use client"

import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  ArrowLeft,
  Scale,
  Plus,
  Check,
  Sparkles,
  Package,
  Clock,
  Tag,
  Wrench,
  FileText,
  MessageSquare,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  CheckCircle2
} from "lucide-react"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useState } from "react"

export default function ProductDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { products, addToCompare, compareProducts, addNotification } = useApp()
  
  const product = products.find(p => p.id === id)
  const [expertComment, setExpertComment] = useState("")
  const [commentRequested, setCommentRequested] = useState(false)
  
  if (!product) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">제품을 찾을 수 없습니다.</p>
        <Button variant="outline" className="mt-4 bg-transparent" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>
      </div>
    )
  }
  
  const isInCompare = compareProducts.some(p => p.id === product.id)
  
  // Find similar products
  const similarProducts = products.filter(p => 
    p.id !== product.id && 
    (p.toolType === product.toolType || p.coating === product.coating)
  ).slice(0, 4)
  
  // Find alternatives (same type, different specs)
  const alternatives = products.filter(p => 
    p.id !== product.id && 
    p.toolType === product.toolType &&
    Math.abs(p.diameter - product.diameter) <= 2
  ).slice(0, 3)
  
  const handleAddToCompare = () => {
    if (compareProducts.length >= 3) {
      addNotification({
        type: "warning",
        title: "비교함 초과",
        message: "최대 3개 제품만 비교할 수 있습니다."
      })
      return
    }
    addToCompare(product)
    addNotification({
      type: "success",
      title: "비교함 추가",
      message: `${product.name}이(가) 비교함에 추가되었습니다.`
    })
  }
  
  const handleRequestExpertComment = () => {
    setCommentRequested(true)
    addNotification({
      type: "info",
      title: "전문가 코멘트 요청됨",
      message: "R&D 전문가에게 검토 요청이 전송되었습니다."
    })
    // Simulate expert response
    setTimeout(() => {
      setExpertComment("이 제품은 고속 가공 조건에서 우수한 성능을 보입니다. 특히 스테인리스강 가공 시 절삭유 사용을 권장하며, 권장 절삭 속도는 120-150m/min입니다. 공구 수명을 최대화하려면 DOC 0.5xD 이하로 유지하세요.")
    }, 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Back Button */}
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        제품 탐색으로 돌아가기
      </Button>

      {/* Hero Section */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Product Image Placeholder */}
        <div className="lg:w-1/3">
          <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
            <Package className="h-24 w-24 text-muted-foreground" />
          </div>
        </div>

        {/* Product Info */}
        <div className="lg:w-2/3 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">{product.toolType}</Badge>
                <Badge variant={product.priceType === "confirmed" ? "default" : "secondary"}>
                  {product.priceType === "confirmed" ? "가격 확정" : "가격 추정"}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold text-foreground">{product.name}</h1>
              <p className="text-lg font-mono text-muted-foreground">{product.sku}</p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">직경</p>
              <p className="text-lg font-semibold">{product.diameter}mm</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">날수</p>
              <p className="text-lg font-semibold">{product.flute}날</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">코팅</p>
              <p className="text-lg font-semibold">{product.coating}</p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">MOQ</p>
              <p className="text-lg font-semibold">{product.moq}개</p>
            </div>
          </div>

          {/* Price & Availability */}
          <div className="flex items-center gap-6 p-4 bg-primary/5 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground mb-1">단가</p>
              <p className="text-2xl font-bold text-primary">{product.unitPrice.toLocaleString()}원</p>
              <Badge variant={product.priceType === "confirmed" ? "default" : "outline"} className="mt-1">
                {product.priceType === "confirmed" ? "확정" : "추정"}
              </Badge>
            </div>
            <Separator orientation="vertical" className="h-16" />
            <div>
              <p className="text-xs text-muted-foreground mb-1">납기</p>
              <p className="text-xl font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5" />
                {product.leadTime}
              </p>
              <Badge variant={product.leadTimeType === "confirmed" ? "default" : "outline"} className="mt-1">
                {product.leadTimeType === "confirmed" ? "확정" : "추정"}
              </Badge>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant={isInCompare ? "secondary" : "outline"}
              onClick={handleAddToCompare}
              disabled={isInCompare}
            >
              {isInCompare ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  비교함에 추가됨
                </>
              ) : (
                <>
                  <Scale className="h-4 w-4 mr-2" />
                  비교함 담기
                </>
              )}
            </Button>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              견적 준비로 보내기
            </Button>
            <Button variant="outline" onClick={handleRequestExpertComment} disabled={commentRequested}>
              <MessageSquare className="h-4 w-4 mr-2" />
              전문가 코멘트 요청 {commentRequested && "(요청됨)"}
            </Button>
          </div>
        </div>
      </div>

      {/* Expert Comment */}
      {expertComment && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              전문가 코멘트
            </CardTitle>
            <CardDescription>R&D 기술팀</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{expertComment}</p>
          </CardContent>
        </Card>
      )}

      {/* Detailed Tabs */}
      <Tabs defaultValue="specs" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-4">
          <TabsTrigger value="specs">스펙</TabsTrigger>
          <TabsTrigger value="materials">적용 소재</TabsTrigger>
          <TabsTrigger value="conditions">추천 조건</TabsTrigger>
          <TabsTrigger value="alternatives">유사/대체품</TabsTrigger>
        </TabsList>

        {/* Specs Tab */}
        <TabsContent value="specs" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="h-4 w-4" />
                상세 스펙
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">공구 종류</span>
                    <span className="font-medium">{product.toolType}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">직경</span>
                    <span className="font-medium">{product.diameter}mm</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">날수</span>
                    <span className="font-medium">{product.flute}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">코팅</span>
                    <span className="font-medium">{product.coating}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">용도</span>
                    <span className="font-medium">{product.application}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">최소 주문량</span>
                    <span className="font-medium">{product.moq}개</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">단가</span>
                    <span className="font-medium">{product.unitPrice.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between py-2 border-b">
                    <span className="text-muted-foreground">납기</span>
                    <span className="font-medium">{product.leadTime}</span>
                  </div>
                </div>
              </div>

              {/* Key Selling Points */}
              <div className="mt-6">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  주요 특장점
                </h4>
                <ul className="space-y-2">
                  {product.keySellingPoints.map((point, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Materials Tab */}
        <TabsContent value="materials" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Tag className="h-4 w-4" />
                적용 가능 소재 / 가공
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-3">호환 소재</h4>
                  <div className="flex flex-wrap gap-2">
                    {product.compatibleMaterials.map(mat => (
                      <Badge key={mat} variant="secondary" className="px-3 py-1">
                        {mat}
                      </Badge>
                    ))}
                  </div>
                </div>
                
                <Separator />
                
                <div>
                  <h4 className="font-medium mb-3">권장 가공</h4>
                  <Badge variant="outline" className="px-3 py-1">
                    {product.application}
                  </Badge>
                </div>

                {product.competitorEquivalents && product.competitorEquivalents.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-medium mb-3">경쟁사 동등품</h4>
                      <div className="flex flex-wrap gap-2">
                        {product.competitorEquivalents.map(eq => (
                          <Badge key={eq} variant="outline" className="px-3 py-1 font-mono text-xs">
                            {eq}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Recommended Conditions Tab */}
        <TabsContent value="conditions" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                추천 가공 조건 (예시)
              </CardTitle>
              <CardDescription>
                실제 조건은 기계 및 환경에 따라 달라질 수 있습니다
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 bg-warning/10 rounded-lg mb-4 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5" />
                <p className="text-sm text-warning-foreground">
                  아래 조건은 참고용 예시입니다. 실제 적용 시 전문가 검토를 권장합니다.
                </p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium">스틸(S45C) 가공 시</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">절삭 속도</span>
                      <span className="font-mono">120-150 m/min</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">이송 속도</span>
                      <span className="font-mono">0.08-0.12 mm/tooth</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">절삭 깊이 (Ap)</span>
                      <span className="font-mono">0.5-1.0 x D</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">폭 (Ae)</span>
                      <span className="font-mono">0.3-0.5 x D</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">스테인리스(SUS304) 가공 시</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">절삭 속도</span>
                      <span className="font-mono">80-100 m/min</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">이송 속도</span>
                      <span className="font-mono">0.05-0.08 mm/tooth</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">절삭 깊이 (Ap)</span>
                      <span className="font-mono">0.3-0.8 x D</span>
                    </div>
                    <div className="flex justify-between py-2 border-b">
                      <span className="text-muted-foreground">폭 (Ae)</span>
                      <span className="font-mono">0.2-0.4 x D</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alternatives Tab */}
        <TabsContent value="alternatives" className="mt-6">
          <div className="space-y-6">
            {/* Similar Products */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">유사 제품</CardTitle>
                <CardDescription>비슷한 사양의 다른 제품들</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {similarProducts.map(p => (
                    <Link
                      key={p.id}
                      href={`/products/${p.id}`}
                      className="p-4 border rounded-lg hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                        </div>
                        <Badge variant="outline">{p.toolType}</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>D{p.diameter}</span>
                        <span>{p.flute}날</span>
                        <span>{p.coating}</span>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="font-medium">{p.unitPrice.toLocaleString()}원</span>
                        <ChevronRight className="h-4 w-4" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Direct Alternatives */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">대체품</CardTitle>
                <CardDescription>동일 용도의 대체 가능한 제품</CardDescription>
              </CardHeader>
              <CardContent>
                {alternatives.length > 0 ? (
                  <div className="space-y-3">
                    {alternatives.map(p => (
                      <Link
                        key={p.id}
                        href={`/products/${p.id}`}
                        className="flex items-center justify-between p-3 border rounded-lg hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="font-medium">{p.name}</p>
                            <p className="text-xs font-mono text-muted-foreground">{p.sku}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-medium">{p.unitPrice.toLocaleString()}원</p>
                            <p className="text-xs text-muted-foreground">{p.leadTime}</p>
                          </div>
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">대체 가능한 제품이 없습니다.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  )
}
