"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  FileText,
  Info,
  BookOpen,
  PlayCircle,
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { RecommendationCandidateDto } from "@/lib/contracts/recommendation"
import { useApp } from "@/lib/frontend/app-context"
import { findVideosForProduct } from "@/lib/data/video-mapping"
import { findCatalogsForProduct } from "@/lib/data/catalog-mapping"
import {
  buildCandidateDetailBadges,
  buildCandidateSpecFallback,
  buildSubtypeFirstSummary,
} from "@/lib/frontend/recommendation/recommendation-card-highlights"
import type {
  CuttingConditions,
  EvidenceSummary,
  InventorySnapshot,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
  ScoreBreakdown,
  ScoredProduct,
  SupportingEvidence,
  VerificationStatus,
} from "@/lib/frontend/recommendation/recommendation-types"

const STATUS_CONFIG = {
  exact: { ko: "정확 매칭", en: "Exact Match", cls: "bg-green-100 text-green-800 border-green-300", Icon: CheckCircle2, iconCls: "text-green-600" },
  approximate: { ko: "근사 후보", en: "Approximate", cls: "bg-amber-100 text-amber-800 border-amber-300", Icon: AlertTriangle, iconCls: "text-amber-600" },
  none: { ko: "매칭 없음", en: "No Match", cls: "bg-red-100 text-red-800 border-red-300", Icon: AlertCircle, iconCls: "text-red-600" },
}

const STOCK_CONFIG = {
  instock: { ko: "재고 있음", en: "In Stock", cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
  limited: { ko: "제한 재고", en: "Limited Stock", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  outofstock: { ko: "재고 없음", en: "Out of Stock", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
  unknown: { ko: "재고 미확인", en: "Stock Unknown", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
}

function MatchBadge({ status }: { status: "exact" | "approximate" | "none" }) {
  const { language } = useApp()
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.Icon

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.cls}`}>
      <Icon size={11} className={cfg.iconCls} />
      {cfg[language]}
    </span>
  )
}

function StockBadge({ status, total }: { status: string; total: number | null }) {
  const { language } = useApp()
  const cfg = STOCK_CONFIG[status as keyof typeof STOCK_CONFIG] ?? STOCK_CONFIG.unknown

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg[language]}
      {total !== null && total > 0 && <span>({total})</span>}
    </span>
  )
}

function SpecRow({ label, value }: { label: string; value: string | null | undefined }) {
  const hasValue = value != null && value !== ""
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium ${hasValue ? "text-gray-900" : "text-gray-300"}`}>
        {hasValue ? value : "-"}
      </span>
    </div>
  )
}

type InventoryLocationSummary = {
  warehouseOrRegion: string
  quantity: number
}

function summarizeInventoryLocations(rows: Pick<InventorySnapshot, "warehouseOrRegion" | "quantity">[]): InventoryLocationSummary[] {
  const grouped = new Map<string, number>()
  for (const row of rows) {
    if (row.quantity === null || row.quantity <= 0) continue
    const key = row.warehouseOrRegion?.trim()
    if (!key) continue
    grouped.set(key, (grouped.get(key) ?? 0) + row.quantity)
  }

  return Array.from(grouped.entries())
    .map(([warehouseOrRegion, quantity]) => ({ warehouseOrRegion, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.warehouseOrRegion.localeCompare(b.warehouseOrRegion))
}

function summarizeInventorySnapshotDate(rows: Pick<InventorySnapshot, "snapshotDate">[]): string | null {
  const dates = rows
    .map(row => row.snapshotDate)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort()

  return dates.length > 0 ? dates[dates.length - 1] : null
}

function InventoryBlock({
  totalStock,
  snapshotDate,
  locations,
}: {
  totalStock: number | null
  snapshotDate?: string | null
  locations?: InventoryLocationSummary[]
}) {
  const { language } = useApp()
  const safeLocations = locations ?? []

  if (totalStock === null && safeLocations.length === 0) {
    return (
      <div>
        <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "재고 정보" : "Inventory"}</div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
          <div className="text-[11px] text-gray-600">
            {language === "ko" ? "재고 데이터 미확인" : "Inventory data unavailable"}
          </div>
          {snapshotDate && (
            <div className="text-[10px] text-gray-500 mt-1">
              {language === "ko" ? `기준일: ${snapshotDate}` : `As of ${snapshotDate}`}
            </div>
          )}
        </div>
      </div>
    )
  }

  const visibleLocations = safeLocations.slice(0, 3)
  const remainingCount = safeLocations.length - visibleLocations.length

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "재고 정보" : "Inventory"}</div>
      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-2">
        <div className="text-[11px] font-medium text-emerald-800">
          {totalStock !== null
            ? (language === "ko" ? `전체 지역 합산 재고 ${totalStock}개` : `Total stock across all regions: ${totalStock}`)
            : (language === "ko" ? "총재고 미확인" : "Total stock unavailable")}
        </div>
        {snapshotDate && (
          <div className="text-[10px] text-emerald-700">
            {language === "ko" ? `기준일: ${snapshotDate}` : `As of ${snapshotDate}`}
          </div>
        )}
        {visibleLocations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleLocations.map(location => (
              <span
                key={location.warehouseOrRegion}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-200"
              >
                {location.warehouseOrRegion} {language === "ko" ? `${location.quantity}개` : `${location.quantity}`}
              </span>
            ))}
            {remainingCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-gray-500 border border-gray-200">
                {language === "ko" ? `+${remainingCount}개 지역` : `+${remainingCount} more`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EvidenceBadge({ conditions, confidence }: { conditions: CuttingConditions | null; confidence?: number }) {
  const { language } = useApp()
  const [open, setOpen] = useState(false)

  if (!conditions) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition-colors"
      >
        <FileText size={10} />
        {language === "ko" ? "절삭조건" : "Cutting Cond."}
        {confidence != null && <span className="text-purple-500">({Math.round(confidence * 100)}%)</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 sm:right-auto bg-white border border-gray-200 rounded-lg shadow-lg p-3 sm:w-64 max-w-[calc(100vw-2rem)]">
          <div className="text-xs font-semibold text-gray-700 mb-2">
            {language === "ko" ? "절삭조건 (카탈로그 데이터)" : "Cutting Conditions (Catalog Data)"}
          </div>
          <div className="space-y-1">
            {conditions.Vc && <SpecRow label={language === "ko" ? "Vc (절삭속도)" : "Vc (Cutting Speed)"} value={conditions.Vc} />}
            {conditions.n && <SpecRow label={language === "ko" ? "n (회전수)" : "n (RPM)"} value={conditions.n} />}
            {conditions.fz && <SpecRow label={language === "ko" ? "fz (이송)" : "fz (Feed/Tooth)"} value={conditions.fz} />}
            {conditions.vf && <SpecRow label={language === "ko" ? "vf (테이블이송)" : "vf (Table Feed)"} value={conditions.vf} />}
            {conditions.ap && <SpecRow label={language === "ko" ? "ap (절삭깊이)" : "ap (Depth of Cut)"} value={conditions.ap} />}
            {conditions.ae && <SpecRow label={language === "ko" ? "ae (절삭폭)" : "ae (Width of Cut)"} value={conditions.ae} />}
          </div>
          <div className="text-[10px] text-gray-400 mt-2 border-t pt-1">
            {language === "ko" ? "카탈로그 추출 데이터 · 실제 가공시 조정 필요" : "Catalog extracted data · Adjust for actual machining"}
          </div>
        </div>
      )}
    </div>
  )
}

function buildXaiNarrative(breakdown: ScoreBreakdown): string {
  const dims = [
    { key: "diameter" as const, label: "직경" },
    { key: "flutes" as const, label: "날수" },
    { key: "materialTag" as const, label: "소재" },
    { key: "operation" as const, label: "가공방식" },
    { key: "toolShape" as const, label: "공구형상 적합도" },
    { key: "coating" as const, label: "코팅" },
    { key: "evidence" as const, label: "절삭조건 근거" },
  ]

  const perfect: string[] = []
  const good: string[] = []
  const weak: string[] = []
  const missing: string[] = []

  for (const dim of dims) {
    const detail = breakdown[dim.key]
    if (detail.max === 0) continue
    const pct = Math.round((detail.score / detail.max) * 100)
    if (pct === 100) perfect.push(dim.label)
    else if (pct >= 50) good.push(dim.label)
    else if (pct > 0) weak.push(`${dim.label}(${detail.detail})`)
    else missing.push(dim.label)
  }

  const parts: string[] = []
  if (perfect.length > 0) parts.push(`${perfect.join(", ")} 조건은 정확히 일치합니다.`)
  if (good.length > 0) parts.push(`${good.join(", ")}은(는) 부분적으로 일치합니다.`)
  if (weak.length > 0) parts.push(`${weak.join(", ")} 항목은 다소 차이가 있습니다.`)
  if (missing.length > 0) parts.push(`${missing.join(", ")} 정보는 확인되지 않았습니다.`)

  const pct = breakdown.matchPct
  if (pct >= 80) parts.push("전반적으로 요청 조건에 매우 적합한 제품입니다.")
  else if (pct >= 60) parts.push("요청 조건에 대체로 부합하는 제품입니다.")
  else if (pct >= 40) parts.push("일부 조건만 맞아 더 세부 사항 확인이 필요합니다.")
  else parts.push("요청 조건과의 일치율이 낮아 주의가 필요합니다.")

  return parts.join(" ")
}

function ScoreBreakdownPanel({ breakdown, xaiNarrative }: { breakdown: ScoreBreakdown; xaiNarrative?: string | null }) {
  const { language } = useApp()
  const dimensions = [
    { key: "diameter", ko: "직경", en: "Diameter", emoji: "📏" },
    { key: "flutes", ko: "날수", en: "Flutes", emoji: "🔩" },
    { key: "materialTag", ko: "소재", en: "Material", emoji: "🧱" },
    { key: "operation", ko: "가공", en: "Operation", emoji: "⚙️" },
    { key: "toolShape", ko: "공구형상", en: "Tool Shape", emoji: "🔧" },
    { key: "coating", ko: "코팅", en: "Coating", emoji: "🛡️" },
    { key: "completeness", ko: "완성도", en: "Completeness", emoji: "📋" },
    { key: "evidence", ko: "절삭조건", en: "Cutting Cond.", emoji: "📊" },
  ] as const

  const narrative = buildXaiNarrative(breakdown)
  const llmNarrative = xaiNarrative?.trim() || null

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-lg border border-blue-100 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <Info size={11} className="text-blue-600" />
          {language === "ko" ? "추천 근거 (xAI)" : "Recommendation Basis (xAI)"}
        </div>
        <div className="text-xs font-bold text-blue-700">
          {breakdown.total}/{breakdown.maxTotal}pt ({breakdown.matchPct}%)
        </div>
      </div>
      {llmNarrative && (
        <div className="bg-blue-50/80 rounded-md px-2.5 py-2 border border-blue-200/70">
          <div className="text-[10px] font-semibold text-blue-700 mb-1">
            {language === "ko" ? "왜 이 제품이 최적인가" : "Why this product is optimal"}
          </div>
          <div className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-line">{llmNarrative}</div>
        </div>
      )}
      <div className="space-y-1.5">
        {dimensions.map(dim => {
          const detail = breakdown[dim.key]
          const pct = detail.max > 0 ? Math.round((detail.score / detail.max) * 100) : 0
          const barColor =
            pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : pct > 0 ? "bg-red-400" : "bg-gray-200"

          return (
            <div key={dim.key}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-600 flex items-center gap-1">
                  <span>{dim.emoji}</span>
                  {dim[language]}
                </span>
                <span className="font-mono text-slate-500">{detail.score}/{detail.max}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 w-16 text-right truncate">{detail.detail}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="bg-white/70 rounded-md px-2.5 py-2 border border-blue-100/50">
        <div className="text-[11px] text-slate-600 leading-relaxed">{narrative}</div>
      </div>
      <div className="text-[10px] text-slate-400 border-t border-slate-200 pt-1.5 mt-1">
        {language === "ko" ? "YG-1 제품 DB 기반 자동 평가 · 추정값 없음" : "Auto-evaluated from YG-1 product DB · No estimated values"}
      </div>
    </div>
  )
}

function ProductCard({
  scored,
  rank,
  isAlternative = false,
  evidenceSummary = null,
}: {
  scored: ScoredProduct
  rank: number
  isAlternative?: boolean
  evidenceSummary?: EvidenceSummary | null
}) {
  const { language } = useApp()
  const [open, setOpen] = useState(!isAlternative)
  const product = scored.product
  const bestCondition = evidenceSummary?.bestCondition ?? null
  const inventoryLocations = useMemo(() => summarizeInventoryLocations(scored.inventory), [scored.inventory])
  const inventorySnapshotDate = useMemo(() => summarizeInventorySnapshotDate(scored.inventory), [scored.inventory])
  const detailBadges = buildCandidateDetailBadges(product, language)

  return (
    <Card className={`border ${isAlternative ? "border-gray-200" : "border-blue-200 shadow-sm"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <img
            src={product.seriesIconUrl || "/images/series/todo-placeholder.svg"}
            alt={product.seriesName ?? ""}
            className="w-16 h-16 object-contain rounded border border-gray-100 shrink-0 bg-gray-50"
            onError={event => {
              (event.currentTarget as HTMLImageElement).src = "/images/series/todo-placeholder.svg"
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs text-gray-400 font-mono">#{rank}</span>
              <MatchBadge status={scored.matchStatus} />
              <StockBadge status={scored.stockStatus} total={scored.totalStock} />
            </div>
            <div className="font-mono text-sm font-bold text-gray-900">{product.displayCode}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {product.brand && <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{product.brand}</span>}
              {product.seriesName && <span className="text-xs text-blue-700 font-medium">{product.seriesName}</span>}
            </div>
            <div className="text-[11px] text-gray-600 mt-1 leading-relaxed font-medium">
              {buildSubtypeFirstSummary(product, language).join(" · ")}
            </div>
            {detailBadges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {detailBadges.map(badge => (
                  <div
                    key={`${badge.label}-${badge.value}`}
                    className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 shadow-sm"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600">
                      {badge.label}
                    </span>
                    <span>{badge.value}</span>
                  </div>
                ))}
              </div>
            )}
            {product.materialTags.length > 0 && (
              <div className="text-[10px] text-gray-400 mt-0.5">{product.materialTags.join("/")}군</div>
            )}
            {product.description && (
              <div className="text-[10px] text-gray-500 mt-1 italic leading-relaxed">
                {product.description.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setOpen(prev => !prev)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <SpecRow label={language === "ko" ? "공구 타입" : "Subtype"} value={product.toolSubtype} />
            <SpecRow label={language === "ko" ? "공구 재질" : "Tool Material"} value={product.toolMaterial} />
            <SpecRow label={language === "ko" ? "공구 직경" : "Tool Dia."} value={product.diameterMm != null ? `${product.diameterMm}mm` : null} />
            <SpecRow label={language === "ko" ? "생크 타입" : "Shank Type"} value={product.shankType ?? null} />
            <SpecRow label={language === "ko" ? "생크 직경" : "Shank Dia."} value={product.shankDiameterMm != null ? `${product.shankDiameterMm}mm` : null} />
            <SpecRow label={language === "ko" ? "넥 직경" : "Neck Dia."} value={product.neckDiameterMm != null ? `${product.neckDiameterMm}mm` : null} />
            <SpecRow label={language === "ko" ? "넥 길이" : "Neck Length"} value={product.neckLengthMm != null ? `${product.neckLengthMm}mm` : null} />
            <SpecRow label={language === "ko" ? "날장 길이" : "LOC"} value={product.lengthOfCutMm != null ? `${product.lengthOfCutMm}mm` : null} />
            <SpecRow label={language === "ko" ? "유효장" : "Effective Length"} value={product.effectiveLengthMm != null ? `${product.effectiveLengthMm}mm` : null} />
            <SpecRow label={language === "ko" ? "전체 길이" : "OAL"} value={product.overallLengthMm != null ? `${product.overallLengthMm}mm` : null} />
            <SpecRow label={language === "ko" ? "헬릭스각" : "Helix Angle"} value={product.helixAngleDeg != null ? `${product.helixAngleDeg}°` : null} />
            {(() => {
              const cornerR = product.cornerRadiusMm ?? product.ballRadiusMm
              const isBall = (product.toolSubtype ?? "").toLowerCase().includes("ball") || product.toolSubtype === "볼"
              const label = isBall
                ? (language === "ko" ? "볼 R" : "Ball R")
                : (language === "ko" ? "코너 R" : "Corner R")
              return <SpecRow label={label} value={cornerR != null ? `R${cornerR}` : null} />
            })()}
            <SpecRow
              label={language === "ko" ? "쿨런트홀" : "Coolant Hole"}
              value={product.coolantHole == null
                ? null
                : language === "ko"
                  ? (product.coolantHole ? "있음" : "없음")
                  : (product.coolantHole ? "Yes" : "No")}
            />

          </div>
          {product.featureText && (
            <div className="text-[11px] text-teal-700 bg-teal-50 rounded-lg p-2.5 leading-relaxed whitespace-pre-line">
              {product.featureText.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}
            </div>
          )}
          {product.materialTags.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "적용 소재" : "Materials"}</div>
              <div className="flex flex-wrap gap-1">
                {product.materialTags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {language === "ko" ? `${tag}군` : `${tag} Group`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <InventoryBlock totalStock={scored.totalStock} snapshotDate={inventorySnapshotDate} locations={inventoryLocations} />
          {bestCondition && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "절삭조건" : "Cutting Conditions"}</div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
                <div>
                  <div className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-1">
                    {language === "ko" ? "직경 매칭" : "Diameter Match"}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    {bestCondition.Vc && <span className="text-gray-700">Vc: {bestCondition.Vc}</span>}
                    {bestCondition.fz && <span className="text-gray-700">fz: {bestCondition.fz}</span>}
                    {bestCondition.ap && <span className="text-gray-700">ap: {bestCondition.ap}</span>}
                    {bestCondition.ae && <span className="text-gray-700">ae: {bestCondition.ae}</span>}
                    {bestCondition.n && <span className="text-gray-700">n: {bestCondition.n}</span>}
                    {bestCondition.vf && <span className="text-gray-700">vf: {bestCondition.vf}</span>}
                  </div>
                </div>
                {evidenceSummary?.seriesRangeByIso && evidenceSummary.seriesRangeByIso.length > 0 && (
                  <div className="border-t border-purple-200 pt-2">
                    <div className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-1">
                      {language === "ko" ? "시리즈 권장 범위 (ISO별)" : "Series Range (by ISO)"}
                    </div>
                    <div className="space-y-0.5 text-[11px]">
                      {evidenceSummary.seriesRangeByIso.map(r => {
                        const fmt = (rng: { min: number; max: number } | null) =>
                          rng ? (rng.min === rng.max ? `${rng.min}` : `${rng.min}~${rng.max}`) : "—"
                        return (
                          <div key={r.isoGroup} className="flex items-center gap-2 text-gray-700">
                            <span className="font-mono font-semibold text-purple-800 w-6">{r.isoGroup}</span>
                            <span>Vc {fmt(r.vc)}</span>
                            <span className="text-gray-400">·</span>
                            <span>fz {fmt(r.fz)}</span>
                            <span className="text-gray-400 ml-auto text-[10px]">{r.count}건</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-purple-600">
                  {language === "ko"
                    ? `카탈로그/DB 근거 · 신뢰도 ${Math.round((evidenceSummary?.bestConfidence ?? 0) * 100)}% · ${evidenceSummary?.sourceCount ?? 0}건`
                    : `Catalog/DB grounded · Confidence ${Math.round((evidenceSummary?.bestConfidence ?? 0) * 100)}% · ${evidenceSummary?.sourceCount ?? 0} sources`}
                </div>
              </div>
            </div>
          )}
          {scored.matchedFields.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "매칭 근거" : "Match Basis"}</div>
              <div className="flex flex-wrap gap-1">
                {scored.matchedFields.map((field, index) => (
                  <span key={index} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{field}</span>
                ))}
              </div>
            </div>
          )}
          {(() => {
            const videos = findVideosForProduct(product.seriesName, product.description, product.brand, language === "ko" ? "ko" : "en")
            if (videos.length === 0) return null
            return (
              <div>
                <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "제품 영상" : "Product Videos"}</div>
                <div className="space-y-1.5">
                  {videos.slice(0, 3).map((video, vi) => (
                    <a
                      key={vi}
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[11px] text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      <PlayCircle size={14} className="shrink-0" />
                      <span className="flex-1 truncate font-medium">{video.title}</span>
                      <span className="text-[9px] text-red-400 shrink-0 uppercase">{video.language === "both" ? "KO/EN" : video.language.toUpperCase()}</span>
                    </a>
                  ))}
                </div>
              </div>
            )
          })()}
          {(() => {
            const catalogs = findCatalogsForProduct(product.seriesName, product.description, product.brand, product.toolType ?? null, language === "ko" ? "ko" : "en")
            if (catalogs.length === 0) return null
            return (
              <div>
                <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "카탈로그" : "Catalogs"}</div>
                <div className="space-y-1.5">
                  {catalogs.slice(0, 3).map((catalog, ci) => (
                    <a
                      key={ci}
                      href={catalog.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[11px] text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5 transition-colors"
                    >
                      <BookOpen size={14} className="shrink-0" />
                      <span className="flex-1 truncate font-medium">{catalog.title}</span>
                      <span className="text-[9px] text-blue-400 shrink-0 uppercase">{catalog.language.toUpperCase()}</span>
                    </a>
                  ))}
                </div>
              </div>
            )
          })()}
          {scored.scoreBreakdown && (
            <ScoreBreakdownPanel
              breakdown={scored.scoreBreakdown}
              xaiNarrative={rank === 1 ? scored.xaiNarrative : null}
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function CandidateCard({ c }: { c: RecommendationCandidateDto }) {
  const { language } = useApp()
  const [showXai, setShowXai] = useState(false)
  const breakdown = c.scoreBreakdown
  const cleanedDescription = c.description
    ? c.description.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").trim()
    : null
  const detailBadges = buildCandidateDetailBadges(c, language)
  const fallbackSpecs = buildCandidateSpecFallback(c)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
      <div className="flex gap-2">
        <img
          src={c.seriesIconUrl || "/images/series/todo-placeholder.svg"}
          alt={c.seriesName ?? ""}
          className="w-12 h-12 object-contain rounded border border-gray-100 shrink-0 bg-gray-50"
          onError={event => {
            (event.currentTarget as HTMLImageElement).src = "/images/series/todo-placeholder.svg"
          }}
        />
        <div className="flex-1 min-w-0">
          {c.brand && <div className="text-xs font-bold text-purple-800 truncate">{c.brand}</div>}
          {cleanedDescription && <div className="text-[10px] text-gray-500 truncate">{cleanedDescription}</div>}
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span className="text-xs text-gray-400 font-mono">#{c.rank}</span>
            <MatchBadge status={c.matchStatus} />
            <StockBadge status={c.stockStatus} total={c.totalStock} />
          </div>
          <div className="font-mono text-sm font-bold text-gray-900">{c.displayCode}</div>
          <div className="text-[11px] text-gray-600 mt-1 leading-relaxed font-medium">
            {buildSubtypeFirstSummary(c, language).join(" · ")}
          </div>
          {c.materialTags.length > 0 && (
             <div className="text-[10px] text-gray-400 mt-0.5">{c.materialTags.join("/")}군</div>
          )}
        </div>
      </div>
      {detailBadges.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {detailBadges.map(badge => (
            <div
              key={`${badge.label}-${badge.value}`}
              className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600">
                {badge.label}
              </span>
              <span>{badge.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 text-xs text-gray-600">
          {fallbackSpecs.map(spec => (
            <span key={spec}>{spec}</span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        {c.hasEvidence && c.bestCondition && <EvidenceBadge conditions={c.bestCondition} />}
      </div>
      <InventoryBlock totalStock={c.totalStock} snapshotDate={c.inventorySnapshotDate} locations={c.inventoryLocations} />
      {breakdown && (
        <div className="pt-1">
          <button
            onClick={() => setShowXai(prev => !prev)}
            className="w-full flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-blue-600 transition-colors"
          >
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="bg-green-500 h-full" style={{ width: `${((breakdown?.diameter?.score ?? 0) / (breakdown?.maxTotal || 1)) * 100}%` }} />
              <div className="bg-blue-500 h-full" style={{ width: `${((breakdown?.flutes?.score ?? 0) / (breakdown?.maxTotal || 1)) * 100}%` }} />
              <div className="bg-amber-500 h-full" style={{ width: `${((breakdown?.materialTag?.score ?? 0) / (breakdown?.maxTotal || 1)) * 100}%` }} />
              <div className="bg-purple-500 h-full" style={{ width: `${((breakdown?.operation?.score ?? 0) / (breakdown?.maxTotal || 1)) * 100}%` }} />
              <div className="bg-cyan-500 h-full" style={{ width: `${((breakdown?.coating?.score ?? 0) / (breakdown?.maxTotal || 1)) * 100}%` }} />
              <div className="bg-gray-400 h-full" style={{ width: `${(((breakdown?.completeness?.score ?? 0) + (breakdown?.evidence?.score ?? 0)) / (breakdown?.maxTotal || 1)) * 100}%` }} />
            </div>
            <span className="font-mono shrink-0">{breakdown.matchPct}%</span>
            <Info size={9} />
          </button>
          {showXai && (
            <div className="mt-2 space-y-2">
              {c.seriesName && (
                <div className="text-[10px] text-blue-700 font-medium">
                  {language === "ko" ? "시리즈" : "Series"}: {c.seriesName}
                </div>
              )}
              <ScoreBreakdownPanel
                breakdown={breakdown}
                xaiNarrative={c.rank === 1 ? c.xaiNarrative : null}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { language } = useApp()
  const cfg = {
    verified: { ko: "확인됨", en: "Verified", cls: "bg-green-100 text-green-700 border-green-200" },
    partial: { ko: "부분확인", en: "Partial", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    conflict: { ko: "충돌", en: "Conflict", cls: "bg-red-100 text-red-700 border-red-200" },
    unverified: { ko: "미확인", en: "Unverified", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  }[status]

  return <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium border ${cfg.cls}`}>{cfg[language]}</span>
}

export function IntentSummaryCard({ prep }: { prep: RequestPreparationResult }) {
  const { language } = useApp()
  const intentLabels: Record<string, { ko: string; en: string }> = {
    product_recommendation: { ko: "제품 추천", en: "Product Recommendation" },
    substitute_search: { ko: "대체품 검색", en: "Substitute Search" },
    cutting_condition_query: { ko: "절삭조건 문의", en: "Cutting Condition Query" },
    product_lookup: { ko: "제품 정보 조회", en: "Product Lookup" },
    narrowing_answer: { ko: "축소 응답", en: "Narrowing Answer" },
    refinement: { ko: "조건 변경", en: "Refinement" },
    general_question: { ko: "일반 문의", en: "General Question" },
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
        <Zap size={11} />
        {language === "ko" ? "의도 분석" : "Intent Analysis"}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
          {intentLabels[prep.intent]?.[language] ?? prep.intent}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0 rounded ${
            prep.intentConfidence === "high"
              ? "bg-green-100 text-green-700"
              : prep.intentConfidence === "medium"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-500"
          }`}
        >
          {language === "ko" ? "신뢰도" : "Confidence"}: {prep.intentConfidence}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-blue-600">
        <span>{language === "ko" ? `슬롯 ${prep.slots.length}개` : `${prep.slots.length} slots`}</span>
        <span>{language === "ko" ? `완성도 ${prep.completeness.completionPct}%` : `${prep.completeness.completionPct}% complete`}</span>
        {prep.route.riskFlags.length > 0 && (
          <span className="text-amber-600">{language === "ko" ? "위험" : "Risk"}: {prep.route.riskFlags.join(", ")}</span>
        )}
      </div>
    </div>
  )
}

function WhyRecommendedCard({ explanation }: { explanation: RecommendationExplanation }) {
  const { language } = useApp()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
      <button onClick={() => setExpanded(prev => !prev)} className="flex items-center justify-between w-full text-xs font-semibold text-green-800">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={11} />
          {language === "ko" ? "왜 이 제품인가?" : "Why This Product?"}
          <span className="text-green-600 font-mono">({explanation.matchPct}% {language === "ko" ? "일치" : "match"})</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <div className="text-[11px] text-green-700">{explanation.summaryText}</div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {explanation.matchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-green-700 mb-1">{language === "ko" ? "일치 항목" : "Matched"}</div>
              {explanation.matchedFacts.map((fact, index) => (
                <div key={index} className="flex items-center gap-2 text-[11px] py-0.5">
                  <Check size={10} className="text-green-600 shrink-0" />
                  <span className="text-gray-700">{fact.label}: {fact.productValue}</span>
                  <span
                    className={`text-[10px] px-1 rounded ${
                      fact.matchType === "exact"
                        ? "bg-green-100 text-green-700"
                        : fact.matchType === "close"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {fact.matchType === "exact"
                      ? (language === "ko" ? "정확" : "Exact")
                      : fact.matchType === "close"
                        ? (language === "ko" ? "근사" : "Close")
                        : (language === "ko" ? "부분" : "Partial")}
                  </span>
                  <span className="text-gray-400 font-mono text-[10px] ml-auto">{fact.score}/{fact.maxScore}</span>
                </div>
              ))}
            </div>
          )}

          {explanation.unmatchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-amber-700 mb-1">{language === "ko" ? "불일치 항목" : "Unmatched"}</div>
              {explanation.unmatchedFacts.map((fact, index) => (
                <div key={index} className="flex items-start gap-2 text-[11px] py-0.5">
                  <AlertTriangle
                    size={10}
                    className={`shrink-0 mt-0.5 ${
                      fact.impact === "critical" ? "text-red-500" : fact.impact === "moderate" ? "text-amber-500" : "text-gray-400"
                    }`}
                  />
                  <div>
                    <span className="text-gray-700">{fact.label}: {fact.reason}</span>
                    <span
                      className={`ml-1 text-[10px] px-1 rounded ${
                        fact.impact === "critical"
                          ? "bg-red-100 text-red-600"
                          : fact.impact === "moderate"
                            ? "bg-amber-100 text-amber-600"
                            : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {fact.impact === "critical"
                        ? (language === "ko" ? "중요" : "Critical")
                        : fact.impact === "moderate"
                          ? (language === "ko" ? "보통" : "Moderate")
                          : (language === "ko" ? "경미" : "Minor")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FactCheckCard({ factCheck }: { factCheck: Record<string, unknown> }) {
  const { language } = useApp()
  const [expanded, setExpanded] = useState(false)
  const report = factCheck.factCheckReport as {
    steps: { step: number; label: string; passed: boolean; fieldsChecked: number; fieldsVerified: number; issues: string[] }[]
    overallStatus: VerificationStatus
    verificationPct: number
    criticalIssues: string[]
  }

  if (!report) return null

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <button onClick={() => setExpanded(prev => !prev)} className="flex items-center justify-between w-full text-xs font-semibold text-slate-700">
        <div className="flex items-center gap-1.5">
          <Database size={11} />
          Fact Check
          <VerificationBadge status={report.overallStatus} />
          <span className="font-mono text-slate-500">({report.verificationPct}%)</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              report.verificationPct >= 80 ? "bg-green-500" : report.verificationPct >= 50 ? "bg-amber-500" : "bg-red-400"
            }`}
            style={{ width: `${report.verificationPct}%` }}
          />
        </div>
        <span className="text-[10px] text-slate-500 font-mono">{report.verificationPct}%</span>
      </div>

      {expanded && (
        <div className="space-y-1.5 pt-1">
          {report.steps.map(step => (
            <div key={step.step} className="flex items-center gap-2 text-[11px]">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  step.passed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {step.step}
              </span>
              <span className="flex-1 text-slate-700">{step.label}</span>
              <span className="font-mono text-slate-400">{step.fieldsVerified}/{step.fieldsChecked}</span>
              {step.passed ? <Check size={10} className="text-green-500" /> : <AlertTriangle size={10} className="text-amber-500" />}
            </div>
          ))}
          {report.criticalIssues.length > 0 && (
            <div className="mt-1 pt-1 border-t border-slate-200">
              <div className="text-[10px] font-semibold text-red-600 mb-0.5">{language === "ko" ? "주의사항" : "Critical Issues"}</div>
              {report.criticalIssues.map((issue, index) => (
                <div key={index} className="text-[10px] text-red-500">{issue}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EvidenceSourceCard({ evidence }: { evidence: SupportingEvidence[] }) {
  const { language } = useApp()
  if (evidence.length === 0) return null

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-800">
        <FileText size={11} />
        {language === "ko" ? "근거 자료" : "Evidence Sources"}
      </div>
      {evidence.map((entry, index) => (
        <div key={index} className="flex items-start gap-2 text-[11px]">
          <span
            className={`shrink-0 px-1.5 py-0 rounded text-[10px] font-medium ${
              entry.type === "cutting_condition"
                ? "bg-purple-100 text-purple-700"
                : entry.type === "catalog_spec"
                  ? "bg-blue-100 text-blue-700"
                  : entry.type === "inventory"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-600"
            }`}
          >
            {entry.type === "cutting_condition"
              ? (language === "ko" ? "절삭조건" : "Cutting Cond.")
              : entry.type === "catalog_spec"
                ? (language === "ko" ? "카탈로그" : "Catalog")
                : entry.type === "inventory"
                    ? (language === "ko" ? "재고" : "Inventory")
                    : (language === "ko" ? "납기" : "Lead Time")}
          </span>
          <span className="text-gray-700">{entry.summary}</span>
        </div>
      ))}
    </div>
  )
}

export function RecommendationPanel({
  result,
  resultText,
  evidenceSummaries,
  explanation,
  factChecked,
}: {
  result: RecommendationResult
  resultText: string
  evidenceSummaries?: EvidenceSummary[] | null
  explanation?: RecommendationExplanation | null
  factChecked?: Record<string, unknown> | null
}) {
  const { language } = useApp()
  const { status, primaryProduct, alternatives, warnings, totalCandidatesConsidered } = result

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <MatchBadge status={status} />
        <span className="text-xs text-gray-500">
          {language === "ko" ? `${totalCandidatesConsidered}개 후보 검색` : `${totalCandidatesConsidered} candidates searched`}
        </span>
      </div>
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {warnings.map((warning, index) => (
              <div key={index} className="text-xs text-amber-800">{warning}</div>
            ))}
          </div>
        </div>
      )}
      {resultText && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
          {resultText}
        </div>
      )}

      {explanation && <WhyRecommendedCard explanation={explanation} />}
      {factChecked && <FactCheckCard factCheck={factChecked} />}
      {explanation && explanation.supportingEvidence.length > 0 && (
        <EvidenceSourceCard evidence={explanation.supportingEvidence} />
      )}

      {!explanation && evidenceSummaries && evidenceSummaries.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-purple-800 mb-2 flex items-center gap-1">
            <FileText size={11} />
            절삭조건 근거
          </div>
          {evidenceSummaries.map((summary, index) => (
            <div key={index} className="mb-2 last:mb-0">
              <div className="text-xs font-mono text-purple-700">{summary.productCode}</div>
              {summary.bestCondition && (
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                  {summary.bestCondition.Vc && <span className="text-gray-600">Vc: {summary.bestCondition.Vc}</span>}
                  {summary.bestCondition.fz && <span className="text-gray-600">fz: {summary.bestCondition.fz}</span>}
                  {summary.bestCondition.ap && <span className="text-gray-600">ap: {summary.bestCondition.ap}</span>}
                  {summary.bestCondition.ae && <span className="text-gray-600">ae: {summary.bestCondition.ae}</span>}
                  {summary.bestCondition.n && <span className="text-gray-600">n: {summary.bestCondition.n}</span>}
                  {summary.bestCondition.vf && <span className="text-gray-600">vf: {summary.bestCondition.vf}</span>}
                </div>
              )}
              <div className="text-[10px] text-purple-500 mt-0.5">
                신뢰도 {Math.round(summary.bestConfidence * 100)}% · {summary.sourceCount}건
              </div>
            </div>
          ))}
        </div>
      )}

      {primaryProduct && (
        <div>
          <div className="flex items-center gap-1 text-xs font-semibold text-gray-700 mb-2">
            <Zap size={12} className="text-blue-600" />
            {language === "ko" ? "추천 제품" : "Recommended Product"}
          </div>
          <ProductCard
            scored={primaryProduct}
            rank={1}
            evidenceSummary={evidenceSummaries?.find(summary => summary.productCode === primaryProduct?.product?.normalizedCode) ?? null}
          />
        </div>
      )}

      {alternatives.length > 0 && (() => {
        // Group alternatives by series so users see "GMG27 (3개)" headers instead
        // of a flat list. Order preserved per first-occurrence to keep score-based
        // ranking stable across groups.
        const seriesOrder: string[] = []
        const bySeries = new Map<string, typeof alternatives>()
        let runningRank = 2
        const ranks = new Map<string, number>()
        for (const alt of alternatives) {
          const key = (alt?.product?.seriesName?.trim() || "기타")
          if (!bySeries.has(key)) {
            bySeries.set(key, [])
            seriesOrder.push(key)
          }
          bySeries.get(key)!.push(alt)
          ranks.set(alt?.product?.id ?? `${key}-${runningRank}`, runningRank++)
        }
        return (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-2">
              {language === "ko"
                ? `대체 후보 (${alternatives.length}) · ${seriesOrder.length}개 시리즈`
                : `Alternatives (${alternatives.length}) · ${seriesOrder.length} series`}
            </div>
            <div className="space-y-3">
              {seriesOrder.map(seriesKey => {
                const members = bySeries.get(seriesKey) ?? []
                return (
                  <div key={seriesKey}>
                    <div className="text-[11px] font-semibold text-blue-700 mb-1 px-1">
                      {seriesKey} <span className="text-gray-400 font-normal">({members.length}{language === "ko" ? "개" : ""})</span>
                    </div>
                    <div className="space-y-2">
                      {members.map(alternative => (
                        <ProductCard
                          key={alternative?.product?.id}
                          scored={alternative}
                          rank={ranks.get(alternative?.product?.id ?? "") ?? 0}
                          isAlternative
                          evidenceSummary={evidenceSummaries?.find(summary => summary.productCode === alternative?.product?.normalizedCode) ?? null}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {status === "none" && (
        <div className="text-center py-8">
          <AlertCircle size={32} className="text-gray-200 mx-auto mb-2" />
          <div className="text-sm text-gray-500">{language === "ko" ? "조건에 맞는 제품 없음" : "No matching products found"}</div>
          <div className="text-xs text-gray-400 mt-1">
            {language === "ko" ? "직경이나 소재 조건을 조정해보세요" : "Try adjusting diameter or material conditions"}
          </div>
        </div>
      )}
    </div>
  )
}
