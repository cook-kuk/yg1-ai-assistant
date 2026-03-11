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

  const specs = [
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
    <div className="fixed bottom-0 left-64 right-0 bg-card border-t border-border shadow-lg z-40 animate-in slide-in-from-bottom-5">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">비교함</h3>
            <Badge variant="secondary">{compareProducts.length}/3</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={clearCompare}>
              <Trash2 className="h-4 w-4 mr-1" />
              전체 삭제
            </Button>
            <Button size="sm" asChild>
              <Link href="/products/compare">
                상세 비교
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground w-32">항목</th>
                {compareProducts.map(product => (
                  <th key={product.id} className="text-left py-2 px-3 min-w-48">
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
                  <td className="py-2 px-3 text-muted-foreground">{spec.label}</td>
                  {compareProducts.map(product => {
                    const value = product[spec.key as keyof typeof product]
                    const displayValue = spec.format 
                      ? spec.format(value as number)
                      : value
                    return (
                      <td key={product.id} className="py-2 px-3">
                        {displayValue}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-2 px-3 text-muted-foreground">호환 소재</td>
                {compareProducts.map(product => (
                  <td key={product.id} className="py-2 px-3">
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
