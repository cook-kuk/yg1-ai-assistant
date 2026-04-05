"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Search,
  BookOpen,
  FileText,
  MessageSquare,
  Tag,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Languages,
  Filter,
  Lightbulb,
  Hash,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApp } from "@/lib/store"

const CATEGORY_LABELS: Record<string, string> = {
  product_overview: "제품 개요",
  material_target: "소재 적합",
  feature: "특징",
  tool_shape: "형상/사양",
  application: "용도",
  selection: "제품 선택",
  coating_material: "코팅/재질",
  brand_overview: "브랜드 개요",
  brand_lineup: "브랜드 라인업",
  brand_application: "브랜드 용도",
}

const FEATURE_KEY_LABELS: Record<string, string> = {
  target_material: "소재별",
  application: "용도별",
  iso_group: "ISO 그룹별",
  tool_subtype: "형상별",
  flute_count: "날수별",
  coating: "코팅별",
  "material+tool_type": "소재+공구타입",
  "material+flute_count": "소재+날수",
  "iso+tool_subtype": "ISO+형상",
}

interface QAItem {
  question: string
  answer: string
  series?: string
  brand?: string
  category: string
  feature_key?: string
  feature_value?: string
  matched_count?: number
}

interface TermItem {
  en: string
  ko: string
}

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function KnowledgePage() {
  const { language } = useApp()
  const [activeTab, setActiveTab] = useState("qa")

  // QA state
  const [qaSearch, setQaSearch] = useState("")
  const [qaCategory, setQaCategory] = useState("")
  const [qaItems, setQaItems] = useState<QAItem[]>([])
  const [qaTotal, setQaTotal] = useState(0)
  const [qaCategories, setQaCategories] = useState<Record<string, number>>({})
  const [qaPage, setQaPage] = useState(1)
  const [qaLoading, setQaLoading] = useState(false)
  const [qaSelected, setQaSelected] = useState<QAItem | null>(null)

  // Feature state
  const [featSearch, setFeatSearch] = useState("")
  const [featKey, setFeatKey] = useState("")
  const [featItems, setFeatItems] = useState<QAItem[]>([])
  const [featTotal, setFeatTotal] = useState(0)
  const [featKeys, setFeatKeys] = useState<Record<string, number>>({})
  const [featPage, setFeatPage] = useState(1)
  const [featLoading, setFeatLoading] = useState(false)

  // Terminology state
  const [termSearch, setTermSearch] = useState("")
  const [terms, setTerms] = useState<TermItem[]>([])
  const [termLoading, setTermLoading] = useState(false)

  const debouncedQa = useDebounce(qaSearch, 300)
  const debouncedFeat = useDebounce(featSearch, 300)
  const debouncedTerm = useDebounce(termSearch, 300)

  const LIMIT = 20

  // Fetch QA
  const fetchQA = useCallback(async () => {
    setQaLoading(true)
    try {
      const params = new URLSearchParams({ tab: "qa", page: String(qaPage), limit: String(LIMIT) })
      if (debouncedQa) params.set("q", debouncedQa)
      if (qaCategory) params.set("category", qaCategory)
      const res = await fetch(`/api/knowledge?${params}`)
      const data = await res.json()
      setQaItems(data.items || [])
      setQaTotal(data.total || 0)
      if (data.categories) setQaCategories(data.categories)
    } catch { /* ignore */ }
    setQaLoading(false)
  }, [debouncedQa, qaCategory, qaPage])

  // Fetch Feature
  const fetchFeature = useCallback(async () => {
    setFeatLoading(true)
    try {
      const params = new URLSearchParams({ tab: "feature", page: String(featPage), limit: String(LIMIT) })
      if (debouncedFeat) params.set("q", debouncedFeat)
      if (featKey) params.set("category", featKey)
      const res = await fetch(`/api/knowledge?${params}`)
      const data = await res.json()
      setFeatItems(data.items || [])
      setFeatTotal(data.total || 0)
      if (data.featureKeys) setFeatKeys(data.featureKeys)
    } catch { /* ignore */ }
    setFeatLoading(false)
  }, [debouncedFeat, featKey, featPage])

  // Fetch Terminology
  const fetchTerminology = useCallback(async () => {
    setTermLoading(true)
    try {
      const params = new URLSearchParams({ tab: "terminology" })
      if (debouncedTerm) params.set("q", debouncedTerm)
      const res = await fetch(`/api/knowledge?${params}`)
      const data = await res.json()
      setTerms(data.items || [])
    } catch { /* ignore */ }
    setTermLoading(false)
  }, [debouncedTerm])

  useEffect(() => { fetchQA() }, [fetchQA])
  useEffect(() => { fetchFeature() }, [fetchFeature])
  useEffect(() => { fetchTerminology() }, [fetchTerminology])

  // Reset page on filter change
  useEffect(() => { setQaPage(1) }, [debouncedQa, qaCategory])
  useEffect(() => { setFeatPage(1) }, [debouncedFeat, featKey])

  const qaMaxPage = Math.max(1, Math.ceil(qaTotal / LIMIT))
  const featMaxPage = Math.max(1, Math.ceil(featTotal / LIMIT))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-card p-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              {language === "ko" ? "지식 베이스" : "Knowledge Base"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {language === "ko"
                ? `제품 QA ${qaTotal > 0 ? qaTotal.toLocaleString() + "건" : ""} / 소재별 추천 / 용어 사전`
                : `Product QA${qaTotal > 0 ? " (" + qaTotal.toLocaleString() + ")" : ""} / Material Recommendations / Terminology`}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="border-b px-6">
            <TabsList className="h-12">
              <TabsTrigger value="qa" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                {language === "ko" ? "제품 QA" : "Product QA"}
                <Badge variant="secondary" className="ml-1">{qaTotal.toLocaleString()}</Badge>
              </TabsTrigger>
              <TabsTrigger value="feature" className="gap-2">
                <Lightbulb className="h-4 w-4" />
                {language === "ko" ? "조건별 추천" : "Recommendations"}
                <Badge variant="secondary" className="ml-1">{featTotal.toLocaleString()}</Badge>
              </TabsTrigger>
              <TabsTrigger value="terminology" className="gap-2">
                <Languages className="h-4 w-4" />
                {language === "ko" ? "용어 사전" : "Terminology"}
                <Badge variant="secondary" className="ml-1">{terms.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ─── QA Tab ─── */}
          <TabsContent value="qa" className="flex-1 overflow-hidden m-0">
            <div className="flex h-full">
              {/* List */}
              <div className="w-1/2 border-r flex flex-col">
                <div className="p-4 border-b space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={language === "ko" ? "시리즈명, 브랜드, 키워드 검색..." : "Search series, brand, keyword..."}
                      className="pl-10"
                      value={qaSearch}
                      onChange={e => setQaSearch(e.target.value)}
                    />
                  </div>
                  <Select value={qaCategory} onValueChange={setQaCategory}>
                    <SelectTrigger className="w-full">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder={language === "ko" ? "전체 카테고리" : "All categories"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">{language === "ko" ? "전체" : "All"}</SelectItem>
                      {Object.entries(qaCategories).map(([key, count]) => (
                        <SelectItem key={key} value={key}>
                          {CATEGORY_LABELS[key] || key} ({count.toLocaleString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {qaLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : qaItems.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      {language === "ko" ? "결과 없음" : "No results"}
                    </p>
                  ) : (
                    qaItems.map((item, i) => (
                      <Card
                        key={`${item.series}-${item.category}-${i}`}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                          qaSelected === item ? "ring-2 ring-primary" : ""
                        }`}
                        onClick={() => setQaSelected(item)}
                      >
                        <CardContent className="p-3">
                          <p className="font-medium text-sm line-clamp-2">{item.question}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {item.brand && (
                              <Badge variant="outline" className="text-xs">{item.brand}</Badge>
                            )}
                            {item.series && (
                              <Badge variant="secondary" className="text-xs">{item.series}</Badge>
                            )}
                            <Badge className="text-xs">
                              {CATEGORY_LABELS[item.category] || item.category}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>

                {/* Pagination */}
                <div className="p-3 border-t flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {qaTotal.toLocaleString()}건 중 {((qaPage - 1) * LIMIT) + 1}-{Math.min(qaPage * LIMIT, qaTotal)}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={qaPage <= 1} onClick={() => setQaPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="px-2 py-1">{qaPage}/{qaMaxPage}</span>
                    <Button variant="outline" size="sm" disabled={qaPage >= qaMaxPage} onClick={() => setQaPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Detail */}
              <div className="w-1/2 overflow-y-auto">
                {qaSelected ? (
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      {qaSelected.brand && <Badge>{qaSelected.brand}</Badge>}
                      {qaSelected.series && <Badge variant="outline">{qaSelected.series}</Badge>}
                      <Badge variant="secondary">
                        {CATEGORY_LABELS[qaSelected.category] || qaSelected.category}
                      </Badge>
                    </div>
                    <h2 className="text-lg font-bold mb-4">{qaSelected.question}</h2>
                    <div className="bg-muted p-4 rounded-lg">
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                        {qaSelected.answer}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                      <p>{language === "ko" ? "QA를 선택하세요" : "Select a QA item"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ─── Feature Recommendations Tab ─── */}
          <TabsContent value="feature" className="flex-1 overflow-y-auto m-0 p-6">
            <div className="max-w-4xl mx-auto space-y-4">
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={language === "ko" ? "소재, 형상, 코팅 등 검색..." : "Search material, shape, coating..."}
                    className="pl-10"
                    value={featSearch}
                    onChange={e => setFeatSearch(e.target.value)}
                  />
                </div>
                <Select value={featKey} onValueChange={setFeatKey}>
                  <SelectTrigger className="w-48">
                    <Tag className="h-4 w-4 mr-2" />
                    <SelectValue placeholder={language === "ko" ? "전체 분류" : "All types"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{language === "ko" ? "전체" : "All"}</SelectItem>
                    {Object.entries(featKeys).map(([key, count]) => (
                      <SelectItem key={key} value={key}>
                        {FEATURE_KEY_LABELS[key] || key} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {featLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {featItems.map((item, i) => (
                    <Card key={`${item.feature_key}-${item.feature_value}-${i}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base">{item.question}</CardTitle>
                          <div className="flex gap-1 shrink-0">
                            <Badge variant="outline">
                              {FEATURE_KEY_LABELS[item.feature_key || ""] || item.feature_key}
                            </Badge>
                            {item.matched_count && (
                              <Badge variant="secondary">
                                <Hash className="h-3 w-3 mr-1" />
                                {item.matched_count}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground bg-muted p-3 rounded-lg max-h-48 overflow-y-auto">
                          {item.answer}
                        </pre>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Pagination */}
              <div className="flex items-center justify-between text-sm pt-2">
                <span className="text-muted-foreground">{featTotal}건</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={featPage <= 1} onClick={() => setFeatPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 py-1">{featPage}/{featMaxPage}</span>
                  <Button variant="outline" size="sm" disabled={featPage >= featMaxPage} onClick={() => setFeatPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ─── Terminology Tab ─── */}
          <TabsContent value="terminology" className="flex-1 overflow-y-auto m-0 p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={language === "ko" ? "영문 또는 한글로 검색..." : "Search in English or Korean..."}
                  className="pl-10"
                  value={termSearch}
                  onChange={e => setTermSearch(e.target.value)}
                />
              </div>

              {termLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-3 px-4 font-medium w-1/2">English</th>
                        <th className="text-left py-3 px-4 font-medium w-1/2">
                          {language === "ko" ? "한국어" : "Korean"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {terms.map((t, i) => (
                        <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="py-2 px-4 font-mono">{t.en}</td>
                          <td className="py-2 px-4">{t.ko}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
