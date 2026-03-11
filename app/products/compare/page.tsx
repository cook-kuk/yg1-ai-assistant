"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft,
  X,
  Check,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Package,
  Sparkles,
  Plus,
  Send
} from "lucide-react"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"

export default function ComparePage() {
  const router = useRouter()
  const { compareProducts, removeFromCompare, clearCompare, addNotification } = useApp()

  const handleSelectFinal = (productId: string) => {
    const product = compareProducts.find(p => p.id === productId)
    if (product) {
      addNotification({
        type: "success",
        title: "최종 선택 완료",
        message: `${product.name}이(가) 견적 준비 목록에 추가되었습니다.`
      })
    }
  }

  if (compareProducts.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" onClick={() => router.push('/products')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            제품 탐색으로 돌아가기
          </Button>
        
          <div className="text-center py-16">
            <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">비교할 제품이 없습니다</h2>
            <p className="text-muted-foreground mb-6">
              제품 탐색에서 비교할 제품을 추가해주세요 (최대 3개)
            </p>
            <Button asChild>
              <Link href="/products">
                제품 탐색하기
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Get all unique specs to compare
  const specRows = [
    { label: "공구 종류", key: "toolType" },
    { label: "직경", key: "diameter", unit: "mm" },
    { label: "날수", key: "flute" },
    { label: "코팅", key: "coating" },
    { label: "용도", key: "application" },
    { label: "호환 소재", key: "compatibleMaterials", isArray: true },
    { label: "단가", key: "unitPrice", isCurrency: true },
    { label: "가격 유형", key: "priceType", isBadge: true },
    { label: "납기", key: "leadTime" },
    { label: "납기 유형", key: "leadTimeType", isBadge: true },
    { label: "MOQ", key: "moq", unit: "개" },
  ]

  // Find best values for highlighting
  const findBest = (key: string) => {
    if (key === "unitPrice") {
      const min = Math.min(...compareProducts.map(p => p.unitPrice))
      return compareProducts.filter(p => p.unitPrice === min).map(p => p.id)
    }
    if (key === "diameter") {
      // No "best" for diameter
      return []
    }
    return []
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" onClick={() => router.push('/products')} className="mb-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              제품 탐색으로
            </Button>
            <h1 className="text-2xl font-bold text-foreground">제품 비교</h1>
            <p className="text-sm text-muted-foreground">Product Comparison</p>
          </div>
          <Button variant="outline" onClick={clearCompare}>
            <X className="h-4 w-4 mr-2" />
            비교함 비우기
          </Button>
        </div>

        {/* Comparison Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                {/* Product Headers */}
                <thead>
                  <tr className="border-b">
                    <th className="p-4 text-left w-40 bg-muted/30">
                      <span className="text-sm font-medium text-muted-foreground">항목</span>
                    </th>
                    {compareProducts.map((product, index) => (
                      <th key={product.id} className={cn(
                        "p-4 text-left min-w-[200px]",
                        index === 0 && "bg-primary/5"
                      )}>
                        <div className="flex items-start justify-between">
                          <div>
                            <Badge variant="outline" className="mb-2">{product.toolType}</Badge>
                            <h3 className="font-semibold">{product.name}</h3>
                            <p className="text-xs font-mono text-muted-foreground">{product.sku}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFromCompare(product.id)}
                            className="shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {index === 0 && (
                          <Badge className="mt-2" variant="default">
                            <Sparkles className="h-3 w-3 mr-1" />
                            AI 추천
                          </Badge>
                        )}
                      </th>
                    ))}
                    {compareProducts.length < 3 && (
                      <th className="p-4 text-center min-w-[200px] bg-muted/20">
                        <Link href="/products" className="inline-flex flex-col items-center text-muted-foreground hover:text-primary transition-colors">
                          <Plus className="h-8 w-8 mb-2" />
                          <span className="text-sm">제품 추가</span>
                        </Link>
                      </th>
                    )}
                  </tr>
                </thead>

                {/* Spec Rows */}
                <tbody>
                  {specRows.map((row, rowIndex) => {
                    const bestIds = findBest(row.key)
                    
                    return (
                      <tr key={row.key} className={cn(
                        "border-b",
                        rowIndex % 2 === 0 && "bg-muted/10"
                      )}>
                        <td className="p-4 text-sm font-medium text-muted-foreground bg-muted/30">
                          {row.label}
                        </td>
                        {compareProducts.map((product, index) => {
                          const value = product[row.key as keyof typeof product]
                          const isBest = bestIds.includes(product.id)
                          
                          return (
                            <td 
                              key={product.id} 
                              className={cn(
                                "p-4",
                                index === 0 && "bg-primary/5",
                                isBest && "font-semibold text-primary"
                              )}
                            >
                              {row.isArray && Array.isArray(value) ? (
                                <div className="flex flex-wrap gap-1">
                                  {(value as string[]).slice(0, 3).map(v => (
                                    <Badge key={v} variant="secondary" className="text-xs">
                                      {v}
                                    </Badge>
                                  ))}
                                  {(value as string[]).length > 3 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{(value as string[]).length - 3}
                                    </Badge>
                                  )}
                                </div>
                              ) : row.isCurrency ? (
                                <span className={cn(isBest && "text-primary")}>
                                  {(value as number).toLocaleString()}원
                                  {isBest && <CheckCircle2 className="inline h-4 w-4 ml-1 text-primary" />}
                                </span>
                              ) : row.isBadge ? (
                                <Badge variant={value === "confirmed" ? "default" : "outline"}>
                                  {value === "confirmed" ? "확정" : "추정"}
                                </Badge>
                              ) : (
                                <span>
                                  {value as string | number}{row.unit || ''}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        {compareProducts.length < 3 && (
                          <td className="p-4 bg-muted/20">
                            <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                          </td>
                        )}
                      </tr>
                    )
                  })}

                  {/* Key Selling Points */}
                  <tr className="border-b">
                    <td className="p-4 text-sm font-medium text-muted-foreground bg-muted/30 align-top">
                      주요 특장점
                    </td>
                    {compareProducts.map((product, index) => (
                      <td key={product.id} className={cn("p-4 align-top", index === 0 && "bg-primary/5")}>
                        <ul className="space-y-1">
                          {product.keySellingPoints.map((point, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm">
                              <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                              {point}
                            </li>
                          ))}
                        </ul>
                      </td>
                    ))}
                    {compareProducts.length < 3 && (
                      <td className="p-4 bg-muted/20">
                        <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                      </td>
                    )}
                  </tr>

                  {/* Actions Row */}
                  <tr>
                    <td className="p-4 bg-muted/30">
                      <span className="text-sm font-medium text-muted-foreground">선택</span>
                    </td>
                    {compareProducts.map((product, index) => (
                      <td key={product.id} className={cn("p-4", index === 0 && "bg-primary/5")}>
                        <div className="flex flex-col gap-2">
                          <Button 
                            onClick={() => handleSelectFinal(product.id)}
                            className="w-full"
                            variant={index === 0 ? "default" : "outline"}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            최종 선택
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/products/${product.id}`}>
                              상세 보기
                            </Link>
                          </Button>
                        </div>
                      </td>
                    ))}
                    {compareProducts.length < 3 && (
                      <td className="p-4 bg-muted/20" />
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Difference Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              차이점 요약
            </CardTitle>
            <CardDescription>AI가 분석한 주요 차이점</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {compareProducts.length >= 2 && (
                <>
                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      {compareProducts[0].name} 장점
                    </h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      <li>- {compareProducts[0].keySellingPoints[0]}</li>
                      {compareProducts[0].unitPrice < compareProducts[1].unitPrice && (
                        <li>- 더 낮은 단가 ({((1 - compareProducts[0].unitPrice / compareProducts[1].unitPrice) * 100).toFixed(0)}% 저렴)</li>
                      )}
                      {compareProducts[0].compatibleMaterials.length > compareProducts[1].compatibleMaterials.length && (
                        <li>- 더 넓은 소재 호환성</li>
                      )}
                    </ul>
                  </div>

                  <div className="p-4 bg-muted/30 rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      {compareProducts[1].name} 장점
                    </h4>
                    <ul className="text-sm space-y-1 text-muted-foreground">
                      <li>- {compareProducts[1].keySellingPoints[0]}</li>
                      {compareProducts[1].unitPrice < compareProducts[0].unitPrice && (
                        <li>- 더 낮은 단가 ({((1 - compareProducts[1].unitPrice / compareProducts[0].unitPrice) * 100).toFixed(0)}% 저렴)</li>
                      )}
                      {compareProducts[1].flute > compareProducts[0].flute && (
                        <li>- 더 많은 날수로 정삭 가공에 유리</li>
                      )}
                    </ul>
                  </div>

                  {compareProducts[0].coating !== compareProducts[1].coating && (
                    <div className="p-4 bg-warning/10 rounded-lg border border-warning/30">
                      <h4 className="font-medium mb-2 flex items-center gap-2 text-warning-foreground">
                        <AlertTriangle className="h-4 w-4" />
                        코팅 차이 주의
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {compareProducts[0].name}은 {compareProducts[0].coating}, {compareProducts[1].name}은 {compareProducts[1].coating} 코팅입니다. 
                        가공 소재와 조건에 따라 적합한 코팅을 선택하세요.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="flex justify-center gap-4">
          <Button variant="outline" asChild>
            <Link href="/products">
              <ArrowLeft className="h-4 w-4 mr-2" />
              제품 더 찾기
            </Link>
          </Button>
          <Button>
            <Send className="h-4 w-4 mr-2" />
            선택 제품으로 견적 준비
          </Button>
        </div>
      </div>
    </div>
  )
}
