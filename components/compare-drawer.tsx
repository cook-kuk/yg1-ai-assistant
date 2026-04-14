"use client"

import Link from "next/link"
import { X, Scale, Trash2, ArrowRight } from "lucide-react"
import { useApp } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function CompareDrawer() {
  const { compareProducts, removeFromCompare, clearCompare } = useApp()

  if (compareProducts.length === 0) return null

  const specs: Array<{
    key: string
    label: string
    format?: (value: number) => string
  }> = [
    { key: "toolType", label: "공구 종류" },
    { key: "diameter", label: "직경 (mm)" },
    { key: "flute", label: "날수" },
    { key: "coating", label: "코팅" },
    { key: "application", label: "용도" },
    { key: "unitPrice", label: "단가 (원)", format: (v: number) => (v || 0).toLocaleString() },
    { key: "leadTime", label: "납기" },
    { key: "moq", label: "MOQ" }
  ] as const

  return (
    <div className="fixed bottom-0 left-0 right-0 lg:left-64 bg-card border-t border-border shadow-lg z-40 animate-in slide-in-from-bottom-5 max-h-[60vh] overflow-y-auto">
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Scale className="h-5 w-5 text-primary shrink-0" />
            <h3 className="font-semibold truncate">비교함</h3>
            <Badge variant="secondary">{compareProducts.length}/3</Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={clearCompare} className="px-2 sm:px-3">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">전체 삭제</span>
            </Button>
            <Button size="sm" asChild>
              <Link href="/products/compare">
                <span className="hidden sm:inline">상세 비교</span>
                <span className="sm:hidden">비교</span>
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 sm:px-3 font-medium text-muted-foreground w-24 sm:w-32">항목</th>
                {compareProducts.map(product => (
                  <th key={product.id} className="text-left py-2 px-2 sm:px-3 min-w-32 sm:min-w-48">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{product.sku}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeFromCompare(product.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {specs.map((spec, idx) => (
                <tr key={spec.key} className={cn(idx % 2 === 0 && "bg-muted/30")}>
                  <td className="py-2 px-2 sm:px-3 text-muted-foreground">{spec.label}</td>
                  {compareProducts.map(product => {
                    const value = product[spec.key as keyof typeof product]
                    const displayValue = spec.format
                      ? spec.format(value as number)
                      : value
                    return (
                      <td key={product.id} className="py-2 px-2 sm:px-3">
                        {displayValue}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-2 px-2 sm:px-3 text-muted-foreground">호환 소재</td>
                {compareProducts.map(product => (
                  <td key={product.id} className="py-2 px-2 sm:px-3">
                    <div className="flex flex-wrap gap-1">
                      {product.compatibleMaterials.slice(0, 3).map(mat => (
                        <Badge key={mat} variant="outline" className="text-xs">
                          {mat}
                        </Badge>
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
