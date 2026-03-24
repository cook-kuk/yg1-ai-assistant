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
  Zap,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { RecommendationCandidateDto } from "@/lib/contracts/recommendation"
import { useApp } from "@/lib/frontend/app-context"
import {
  buildCandidateSpecFallback,
  buildCandidateSubtypeHighlight,
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
  exact: { ko: "?뺥솗 留ㅼ묶", en: "Exact Match", cls: "bg-green-100 text-green-800 border-green-300", Icon: CheckCircle2, iconCls: "text-green-600" },
  approximate: { ko: "洹쇱궗 ?꾨낫", en: "Approximate", cls: "bg-amber-100 text-amber-800 border-amber-300", Icon: AlertTriangle, iconCls: "text-amber-600" },
  none: { ko: "留ㅼ묶 ?놁쓬", en: "No Match", cls: "bg-red-100 text-red-800 border-red-300", Icon: AlertCircle, iconCls: "text-red-600" },
}

const STOCK_CONFIG = {
  instock: { ko: "?ш퀬 ?덉쓬", en: "In Stock", cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
  limited: { ko: "?뚮웾 ?ш퀬", en: "Limited Stock", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  outofstock: { ko: "?ш퀬 ?놁쓬", en: "Out of Stock", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
  unknown: { ko: "?ш퀬 誘명솗??, en: "Stock Unknown", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
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
  if (value == null) return null

  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs font-medium text-gray-900">{value}</span>
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
        <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "?ш퀬 ?뺣낫" : "Inventory"}</div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
          <div className="text-[11px] text-gray-600">
            {language === "ko" ? "?ш퀬 ?곗씠??誘명솗?? : "Inventory data unavailable"}
          </div>
          {snapshotDate && (
            <div className="text-[10px] text-gray-500 mt-1">
              {language === "ko" ? `湲곗???${snapshotDate}` : `As of ${snapshotDate}`}
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
      <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "?ш퀬 ?뺣낫" : "Inventory"}</div>
      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-2">
        <div className="text-[11px] font-medium text-emerald-800">
          {totalStock !== null
            ? (language === "ko" ? `?꾩껜 吏???⑹궛 ?ш퀬 ${totalStock}媛? : `Total stock across all regions: ${totalStock}`)
            : (language === "ko" ? "珥앹옱怨?誘명솗?? : "Total stock unavailable")}
        </div>
        {snapshotDate && (
          <div className="text-[10px] text-emerald-700">
            {language === "ko" ? `湲곗???${snapshotDate}` : `As of ${snapshotDate}`}
          </div>
        )}
        {visibleLocations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {visibleLocations.map(location => (
              <span
                key={location.warehouseOrRegion}
                className="text-[10px] px-2 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-200"
              >
                {location.warehouseOrRegion} {language === "ko" ? `${location.quantity}媛? : `${location.quantity}`}
              </span>
            ))}
            {remainingCount > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white text-gray-500 border border-gray-200">
                {language === "ko" ? `??${remainingCount}媛?吏?? : `+${remainingCount} more`}
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
        {language === "ko" ? "?덉궘議곌굔" : "Cutting Cond."}
        {confidence != null && <span className="text-purple-500">({Math.round(confidence * 100)}%)</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-64">
          <div className="text-xs font-semibold text-gray-700 mb-2">
            {language === "ko" ? "?덉궘議곌굔 (移댄깉濡쒓렇 ?곗씠??" : "Cutting Conditions (Catalog Data)"}
          </div>
          <div className="space-y-1">
            {conditions.Vc && <SpecRow label={language === "ko" ? "Vc (?덉궘?띾룄)" : "Vc (Cutting Speed)"} value={conditions.Vc} />}
            {conditions.n && <SpecRow label={language === "ko" ? "n (?뚯쟾??" : "n (RPM)"} value={conditions.n} />}
            {conditions.fz && <SpecRow label={language === "ko" ? "fz (?댁넚)" : "fz (Feed/Tooth)"} value={conditions.fz} />}
            {conditions.vf && <SpecRow label={language === "ko" ? "vf (?뚯씠釉붿씠??" : "vf (Table Feed)"} value={conditions.vf} />}
            {conditions.ap && <SpecRow label={language === "ko" ? "ap (?덉궘源딆씠)" : "ap (Depth of Cut)"} value={conditions.ap} />}
            {conditions.ae && <SpecRow label={language === "ko" ? "ae (?덉궘??" : "ae (Width of Cut)"} value={conditions.ae} />}
          </div>
          <div className="text-[10px] text-gray-400 mt-2 border-t pt-1">
            {language === "ko" ? "移댄깉濡쒓렇 異붿텧 ?곗씠??쨌 ?ㅼ젣 媛怨???議곗젙 ?꾩슂" : "Catalog extracted data 쨌 Adjust for actual machining"}
          </div>
        </div>
      )}
    </div>
  )
}

function buildXaiNarrative(breakdown: ScoreBreakdown): string {
  const dims = [
    { key: "diameter" as const, label: "吏곴꼍" },
    { key: "flutes" as const, label: "???? },
    { key: "materialTag" as const, label: "?뚯옱" },
    { key: "operation" as const, label: "媛怨?諛⑹떇" },
    { key: "coating" as const, label: "肄뷀똿" },
    { key: "evidence" as const, label: "?덉궘議곌굔 洹쇨굅" },
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
  if (perfect.length > 0) parts.push(`${perfect.join(", ")} 議곌굔???뺥솗???쇱튂?⑸땲??`)
  if (good.length > 0) parts.push(`${good.join(", ")}?(?? 遺遺꾩쟻?쇰줈 ?쇱튂?⑸땲??`)
  if (weak.length > 0) parts.push(`${weak.join(", ")} ??ぉ? ?ㅼ냼 李⑥씠媛 ?덉뒿?덈떎.`)
  if (missing.length > 0) parts.push(`${missing.join(", ")} ?뺣낫???뺤씤?섏? ?딆븯?듬땲??`)

  const pct = breakdown.matchPct
  if (pct >= 80) parts.push("?꾨컲?곸쑝濡??붿껌 議곌굔??留ㅼ슦 ?곹빀???쒗뭹?낅땲??")
  else if (pct >= 60) parts.push("?붿껌 議곌굔???泥대줈 遺?⑺븯???쒗뭹?낅땲??")
  else if (pct >= 40) parts.push("?쇰? 議곌굔? 留욎?留? ?몃? ?ы빆 ?뺤씤???꾩슂?⑸땲??")
  else parts.push("?붿껌 議곌굔怨쇱쓽 ?쇱튂?꾧? ??븘 二쇱쓽媛 ?꾩슂?⑸땲??")

  return parts.join(" ")
}

function ScoreBreakdownPanel({ breakdown }: { breakdown: ScoreBreakdown }) {
  const { language } = useApp()
  const dimensions = [
    { key: "diameter", ko: "吏곴꼍", en: "Diameter", emoji: "?뱪" },
    { key: "flutes", ko: "????, en: "Flutes", emoji: "?뵩" },
    { key: "materialTag", ko: "?뚯옱", en: "Material", emoji: "?㎟" },
    { key: "operation", ko: "媛怨?, en: "Operation", emoji: "?숋툘" },
    { key: "coating", ko: "肄뷀똿", en: "Coating", emoji: "?썳截? },
    { key: "completeness", ko: "?꾩꽦??, en: "Completeness", emoji: "?뱤" },
    { key: "evidence", ko: "?덉궘議곌굔", en: "Cutting Cond.", emoji: "?뱞" },
  ] as const

  const narrative = buildXaiNarrative(breakdown)

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-lg border border-blue-100 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <Info size={11} className="text-blue-600" />
          {language === "ko" ? "異붿쿇 洹쇨굅 (xAI)" : "Recommendation Basis (xAI)"}
        </div>
        <div className="text-xs font-bold text-blue-700">
          {breakdown.total}/{breakdown.maxTotal}pt ({breakdown.matchPct}%)
        </div>
      </div>
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
        {language === "ko" ? "YG-1 ?쒗뭹 DB 湲곕컲 ?먮룞 ?됯? 쨌 異붿젙媛??놁쓬" : "Auto-evaluated from YG-1 product DB 쨌 No estimated values"}
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

  return (
    <Card className={`border ${isAlternative ? "border-gray-200" : "border-blue-200 shadow-sm"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          {product.seriesIconUrl && (
            <img
              src={product.seriesIconUrl}
              alt={product.seriesName ?? ""}
              className="w-16 h-16 object-contain rounded border border-gray-100 shrink-0 bg-gray-50"
            />
          )}
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
              {buildSubtypeFirstSummary(product, language).join(" ? ")}
            </div>
            {product.materialTags.length > 0 && (
              <div className="text-[10px] text-gray-400 mt-0.5">{product.materialTags.join("/")}援?/div>
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
            <SpecRow label={language === "ko" ? "? ??" : "Subtype"} value={product.toolSubtype} />
            <SpecRow label={language === "ko" ? "??? ???" : "Tool Material"} value={product.toolMaterial} />
            <SpecRow label={language === "ko" ? "??? ???" : "Shank Dia."} value={product.shankDiameterMm != null ? `${product.shankDiameterMm}mm` : null} />
            <SpecRow label={language === "ko" ? "??? ???" : "LOC"} value={product.lengthOfCutMm != null ? `${product.lengthOfCutMm}mm` : null} />
            <SpecRow label={language === "ko" ? "??? ???" : "OAL"} value={product.overallLengthMm != null ? `${product.overallLengthMm}mm` : null} />
            <SpecRow label={language === "ko" ? "?????" : "Helix Angle"} value={product.helixAngleDeg != null ? `${product.helixAngleDeg}?` : null} />

          </div>
          {product.featureText && (
            <div className="text-[11px] text-teal-700 bg-teal-50 rounded-lg p-2.5 leading-relaxed whitespace-pre-line">
              {product.featureText.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}
            </div>
          )}
          {product.materialTags.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "?곸슜 ?뚯옱" : "Materials"}</div>
              <div className="flex flex-wrap gap-1">
                {product.materialTags.map(tag => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {language === "ko" ? `${tag}援? : `${tag} Group`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <InventoryBlock totalStock={scored.totalStock} snapshotDate={inventorySnapshotDate} locations={inventoryLocations} />
          {bestCondition && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "?덉궘議곌굔" : "Cutting Conditions"}</div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  {bestCondition.Vc && <span className="text-gray-700">Vc: {bestCondition.Vc}</span>}
                  {bestCondition.fz && <span className="text-gray-700">fz: {bestCondition.fz}</span>}
                  {bestCondition.ap && <span className="text-gray-700">ap: {bestCondition.ap}</span>}
                  {bestCondition.ae && <span className="text-gray-700">ae: {bestCondition.ae}</span>}
                  {bestCondition.n && <span className="text-gray-700">n: {bestCondition.n}</span>}
                  {bestCondition.vf && <span className="text-gray-700">vf: {bestCondition.vf}</span>}
                </div>
                <div className="text-[10px] text-purple-600 mt-2">
                  {language === "ko"
                    ? `移댄깉濡쒓렇/DB 洹쇨굅 쨌 ?좊ː??${Math.round((evidenceSummary?.bestConfidence ?? 0) * 100)}% 쨌 ${evidenceSummary?.sourceCount ?? 0}嫄?
                    : `Catalog/DB grounded 쨌 Confidence ${Math.round((evidenceSummary?.bestConfidence ?? 0) * 100)}% 쨌 ${evidenceSummary?.sourceCount ?? 0} sources`}
                </div>
              </div>
            </div>
          )}
          {scored.matchedFields.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === "ko" ? "留ㅼ묶 洹쇨굅" : "Match Basis"}</div>
              <div className="flex flex-wrap gap-1">
                {scored.matchedFields.map((field, index) => (
                  <span key={index} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{field}</span>
                ))}
              </div>
            </div>
          )}
          {scored.scoreBreakdown && <ScoreBreakdownPanel breakdown={scored.scoreBreakdown} />}
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
  const subtypeHighlight = buildCandidateSubtypeHighlight(c, language)
  const fallbackSpecs = buildCandidateSpecFallback(c)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
      <div className="flex gap-2">
        {c.seriesIconUrl && (
          <img
            src={c.seriesIconUrl}
            alt={c.seriesName ?? ""}
            className="w-12 h-12 object-contain rounded border border-gray-100 shrink-0 bg-gray-50"
            onError={event => {
              event.currentTarget.style.display = "none"
            }}
          />
        )}
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
            {buildSubtypeFirstSummary(c, language).join(" ? ")}
          </div>
          {c.materialTags.length > 0 && (
            <div className="text-[10px] text-gray-400 mt-0.5">{c.materialTags.join("/")}援?/div>
          )}
        </div>
      </div>
      {subtypeHighlight ? (
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 shadow-sm">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-600">
              {subtypeHighlight.label}
            </span>
            <span>{subtypeHighlight.value}</span>
          </div>
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
              <div className="bg-green-500 h-full" style={{ width: `${(breakdown.diameter.score / breakdown.maxTotal) * 100}%` }} />
              <div className="bg-blue-500 h-full" style={{ width: `${(breakdown.flutes.score / breakdown.maxTotal) * 100}%` }} />
              <div className="bg-amber-500 h-full" style={{ width: `${(breakdown.materialTag.score / breakdown.maxTotal) * 100}%` }} />
              <div className="bg-purple-500 h-full" style={{ width: `${(breakdown.operation.score / breakdown.maxTotal) * 100}%` }} />
              <div className="bg-cyan-500 h-full" style={{ width: `${(breakdown.coating.score / breakdown.maxTotal) * 100}%` }} />
              <div className="bg-gray-400 h-full" style={{ width: `${((breakdown.completeness.score + breakdown.evidence.score) / breakdown.maxTotal) * 100}%` }} />
            </div>
            <span className="font-mono shrink-0">{breakdown.matchPct}%</span>
            <Info size={9} />
          </button>
          {showXai && (
            <div className="mt-2 space-y-2">
              {c.seriesName && (
                <div className="text-[10px] text-blue-700 font-medium">
                  {language === "ko" ? "?쒕━利? : "Series"}: {c.seriesName}
                </div>
              )}
              <ScoreBreakdownPanel breakdown={breakdown} />
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
    verified: { ko: "?뺤씤??, en: "Verified", cls: "bg-green-100 text-green-700 border-green-200" },
    partial: { ko: "遺遺꾪솗??, en: "Partial", cls: "bg-amber-100 text-amber-700 border-amber-200" },
    conflict: { ko: "異⑸룎", en: "Conflict", cls: "bg-red-100 text-red-700 border-red-200" },
    unverified: { ko: "誘명솗??, en: "Unverified", cls: "bg-gray-100 text-gray-500 border-gray-200" },
  }[status]

  return <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium border ${cfg.cls}`}>{cfg[language]}</span>
}

export function IntentSummaryCard({ prep }: { prep: RequestPreparationResult }) {
  const { language } = useApp()
  const intentLabels: Record<string, { ko: string; en: string }> = {
    product_recommendation: { ko: "?쒗뭹 異붿쿇", en: "Product Recommendation" },
    substitute_search: { ko: "?泥댄뭹 寃??, en: "Substitute Search" },
    cutting_condition_query: { ko: "?덉궘議곌굔 臾몄쓽", en: "Cutting Condition Query" },
    product_lookup: { ko: "?쒗뭹 ?뺣낫 議고쉶", en: "Product Lookup" },
    narrowing_answer: { ko: "異뺤냼 ?묐떟", en: "Narrowing Answer" },
    refinement: { ko: "議곌굔 蹂寃?, en: "Refinement" },
    general_question: { ko: "?쇰컲 臾몄쓽", en: "General Question" },
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800">
        <Zap size={11} />
        {language === "ko" ? "?섎룄 遺꾩꽍" : "Intent Analysis"}
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
          {language === "ko" ? "?좊ː?? : "Confidence"}: {prep.intentConfidence}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-blue-600">
        <span>{language === "ko" ? `?щ’ ${prep.slots.length}媛? : `${prep.slots.length} slots`}</span>
        <span>{language === "ko" ? `?꾩꽦??${prep.completeness.completionPct}%` : `${prep.completeness.completionPct}% complete`}</span>
        {prep.route.riskFlags.length > 0 && (
          <span className="text-amber-600">{language === "ko" ? "?꾪뿕" : "Risk"}: {prep.route.riskFlags.join(", ")}</span>
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
          {language === "ko" ? "?????쒗뭹?멸??" : "Why This Product?"}
          <span className="text-green-600 font-mono">({explanation.matchPct}% {language === "ko" ? "?쇱튂" : "match"})</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <div className="text-[11px] text-green-700">{explanation.summaryText}</div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {explanation.matchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-green-700 mb-1">{language === "ko" ? "?쇱튂 ??ぉ" : "Matched"}</div>
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
                      ? (language === "ko" ? "?뺥솗" : "Exact")
                      : fact.matchType === "close"
                        ? (language === "ko" ? "洹쇱궗" : "Close")
                        : (language === "ko" ? "遺遺? : "Partial")}
                  </span>
                  <span className="text-gray-400 font-mono text-[10px] ml-auto">{fact.score}/{fact.maxScore}</span>
                </div>
              ))}
            </div>
          )}

          {explanation.unmatchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-amber-700 mb-1">{language === "ko" ? "遺덉씪移???ぉ" : "Unmatched"}</div>
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
                        ? (language === "ko" ? "以묒슂" : "Critical")
                        : fact.impact === "moderate"
                          ? (language === "ko" ? "蹂댄넻" : "Moderate")
                          : (language === "ko" ? "寃쎈?" : "Minor")}
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
              <div className="text-[10px] font-semibold text-red-600 mb-0.5">{language === "ko" ? "二쇱쓽?ы빆" : "Critical Issues"}</div>
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
        {language === "ko" ? "洹쇨굅 ?먮즺" : "Evidence Sources"}
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
              ? (language === "ko" ? "?덉궘議곌굔" : "Cutting Cond.")
              : entry.type === "catalog_spec"
                ? (language === "ko" ? "移댄깉濡쒓렇" : "Catalog")
                : entry.type === "inventory"
                  ? (language === "ko" ? "?ш퀬" : "Inventory")
                  : (language === "ko" ? "?⑷린" : "Lead Time")}
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
          {totalCandidatesConsidered}
          {language === "ko" ? "媛??꾨낫 寃?? : " candidates searched"}
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
            ?덉궘議곌굔 洹쇨굅
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
                ?좊ː?? {Math.round(summary.bestConfidence * 100)}% 쨌 {summary.sourceCount}嫄?
              </div>
            </div>
          ))}
        </div>
      )}

      {primaryProduct && (
        <div>
          <div className="flex items-center gap-1 text-xs font-semibold text-gray-700 mb-2">
            <Zap size={12} className="text-blue-600" />
            {language === "ko" ? "異붿쿇 ?쒗뭹" : "Recommended Product"}
          </div>
          <ProductCard
            scored={primaryProduct}
            rank={1}
            evidenceSummary={evidenceSummaries?.find(summary => summary.productCode === primaryProduct.product.normalizedCode) ?? null}
          />
        </div>
      )}

      {alternatives.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">
            {language === "ko" ? `?泥??꾨낫 (${alternatives.length})` : `Alternatives (${alternatives.length})`}
          </div>
          <div className="space-y-2">
            {alternatives.map((alternative, index) => (
              <ProductCard
                key={alternative.product.id}
                scored={alternative}
                rank={index + 2}
                isAlternative
                evidenceSummary={evidenceSummaries?.find(summary => summary.productCode === alternative.product.normalizedCode) ?? null}
              />
            ))}
          </div>
        </div>
      )}

      {status === "none" && (
        <div className="text-center py-8">
          <AlertCircle size={32} className="text-gray-200 mx-auto mb-2" />
          <div className="text-sm text-gray-500">{language === "ko" ? "議곌굔??留욌뒗 ?쒗뭹 ?놁쓬" : "No matching products found"}</div>
          <div className="text-xs text-gray-400 mt-1">
            {language === "ko" ? "吏곴꼍?대굹 ?뚯옱 議곌굔??議곗젙?대낫?몄슂" : "Try adjusting diameter or material conditions"}
          </div>
        </div>
      )}
    </div>
  )
}
