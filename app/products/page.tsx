"use client"

/**
 * /products — YG-1 Product Exploration
 *
 * 4-phase flow:
 *   1. Intake Gate — 6 required fields, each "known" or "모름"
 *   2. Intake Summary — review before submitting
 *   3. Loading — initial hybrid retrieval
 *   4. Exploration — 3-panel: sidebar + narrowing chat + candidate panel
 *
 * Hybrid retrieval + info-gain narrowing + RAG-grounded evidence.
 * All data from normalized JSON — no hallucination.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import {
  ChevronDown, ChevronUp, CheckCircle2, AlertTriangle,
  AlertCircle, Package, Clock, Database, Zap, Info,
  ArrowRight, Edit2, RotateCcw, HelpCircle, Check,
  Sparkles, Send, Filter, FileText, Activity,
  MessageCircle, Star, X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Markdown } from "@/components/ui/markdown"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import type { RecommendationResult, ScoredProduct, ScoreBreakdown } from "@/lib/types/canonical"
import type { CandidateSnapshot, ExplorationSessionState } from "@/lib/types/exploration"
import type { EvidenceSummary, CuttingConditions } from "@/lib/types/evidence"
import type { RecommendationExplanation, MatchedFact, UnmatchedFact, SupportingEvidence } from "@/lib/types/explanation"
import type { VerificationStatus } from "@/lib/types/fact-check"
import type { RequestPreparationResult } from "@/lib/types/request-preparation"
import {
  type ProductIntakeForm,
  type AnswerState,
  type IntakeFieldConfig,
  INITIAL_INTAKE_FORM,
  FIELD_CONFIGS,
  allRequiredAnswered,
  countAnswered,
  countUnknowns,
} from "@/lib/types/intake"
import {
  getIntakeDisplayValue,
  getIntakeFieldLabel,
  localizeIntakeText,
} from "@/lib/domain/intake-localization"
import { useApp } from "@/lib/store"

// ── Phase ─────────────────────────────────────────────────────
type Phase = "intake" | "summary" | "loading" | "explore"

// ── Badge helpers ─────────────────────────────────────────────
const STATUS_CONFIG = {
  exact: { ko: "정확 매칭", en: "Exact Match", cls: "bg-green-100 text-green-800 border-green-300", Icon: CheckCircle2, iconCls: "text-green-600" },
  approximate: { ko: "근사 후보", en: "Approximate", cls: "bg-amber-100 text-amber-800 border-amber-300", Icon: AlertTriangle, iconCls: "text-amber-600" },
  none: { ko: "매칭 없음", en: "No Match", cls: "bg-red-100 text-red-800 border-red-300", Icon: AlertCircle, iconCls: "text-red-600" },
}
const STOCK_CONFIG = {
  instock: { ko: "재고 있음", en: "In Stock", cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
  limited: { ko: "소량 재고", en: "Limited Stock", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  outofstock: { ko: "재고 없음", en: "Out of Stock", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
  unknown: { ko: "재고 미확인", en: "Stock Unknown", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
}

const MAX_DISPLAY_CANDIDATES = 5

const RESOLUTION_CONFIG: Record<string, { ko: string; en: string; cls: string }> = {
  broad: { ko: "탐색 중", en: "Exploring", cls: "bg-blue-100 text-blue-700" },
  narrowing: { ko: "축소 중", en: "Narrowing", cls: "bg-amber-100 text-amber-700" },
  resolved_exact: { ko: "정확 매칭", en: "Exact Match", cls: "bg-green-100 text-green-700" },
  resolved_approximate: { ko: "근사 매칭", en: "Approximate", cls: "bg-amber-100 text-amber-700" },
  resolved_none: { ko: "매칭 없음", en: "No Match", cls: "bg-red-100 text-red-700" },
}

function MatchBadge({ status }: { status: "exact" | "approximate" | "none" }) {
  const { language } = useApp()
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.Icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.cls}`}>
      <Icon size={11} className={cfg.iconCls} />{cfg[language]}
    </span>
  )
}
function StockBadge({ status, total }: { status: string; total: number | null }) {
  const { language } = useApp()
  const cfg = STOCK_CONFIG[status as keyof typeof STOCK_CONFIG] ?? STOCK_CONFIG.unknown
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg[language]}{total !== null && total > 0 && <span>({total})</span>}
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

// ── Evidence Badge ───────────────────────────────────────────
function EvidenceBadge({ conditions, confidence }: { conditions: CuttingConditions | null; confidence?: number }) {
  const { language } = useApp()
  const [open, setOpen] = useState(false)
  if (!conditions) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition-colors"
      >
        <FileText size={10} />{language === 'ko' ? '절삭조건' : 'Cutting Cond.'}
        {confidence != null && <span className="text-purple-500">({Math.round(confidence * 100)}%)</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-64">
          <div className="text-xs font-semibold text-gray-700 mb-2">{language === 'ko' ? '절삭조건 (카탈로그 데이터)' : 'Cutting Conditions (Catalog Data)'}</div>
          <div className="space-y-1">
            {conditions.Vc && <SpecRow label={language === 'ko' ? 'Vc (절삭속도)' : 'Vc (Cutting Speed)'} value={conditions.Vc} />}
            {conditions.n && <SpecRow label={language === 'ko' ? 'n (회전수)' : 'n (RPM)'} value={conditions.n} />}
            {conditions.fz && <SpecRow label={language === 'ko' ? 'fz (이송)' : 'fz (Feed/Tooth)'} value={conditions.fz} />}
            {conditions.vf && <SpecRow label={language === 'ko' ? 'vf (테이블이송)' : 'vf (Table Feed)'} value={conditions.vf} />}
            {conditions.ap && <SpecRow label={language === 'ko' ? 'ap (절삭깊이)' : 'ap (Depth of Cut)'} value={conditions.ap} />}
            {conditions.ae && <SpecRow label={language === 'ko' ? 'ae (절삭폭)' : 'ae (Width of Cut)'} value={conditions.ae} />}
          </div>
          <div className="text-[10px] text-gray-400 mt-2 border-t pt-1">
            {language === 'ko' ? '카탈로그 추출 데이터 · 실제 가공 시 조정 필요' : 'Catalog extracted data · Adjust for actual machining'}
          </div>
        </div>
      )}
    </div>
  )
}

// ── xAI Natural Language Explanation ──────────────────────────
function buildXaiNarrative(breakdown: ScoreBreakdown): string {
  const dims = [
    { key: "diameter" as const, label: "직경" },
    { key: "flutes" as const, label: "날 수" },
    { key: "materialTag" as const, label: "소재" },
    { key: "operation" as const, label: "가공 방식" },
    { key: "coating" as const, label: "코팅" },
    { key: "evidence" as const, label: "절삭조건 근거" },
  ]

  const perfect: string[] = []
  const good: string[] = []
  const weak: string[] = []
  const missing: string[] = []

  for (const dim of dims) {
    const d = breakdown[dim.key]
    if (d.max === 0) continue
    const pct = Math.round((d.score / d.max) * 100)
    if (pct === 100) perfect.push(dim.label)
    else if (pct >= 50) good.push(dim.label)
    else if (pct > 0) weak.push(`${dim.label}(${d.detail})`)
    else missing.push(dim.label)
  }

  const parts: string[] = []

  if (perfect.length > 0) {
    parts.push(`${perfect.join(", ")} 조건이 정확히 일치합니다.`)
  }
  if (good.length > 0) {
    parts.push(`${good.join(", ")}은(는) 부분적으로 일치합니다.`)
  }
  if (weak.length > 0) {
    parts.push(`${weak.join(", ")} 항목은 다소 차이가 있습니다.`)
  }
  if (missing.length > 0) {
    parts.push(`${missing.join(", ")} 정보는 확인되지 않았습니다.`)
  }

  // Overall verdict
  const pct = breakdown.matchPct
  if (pct >= 80) {
    parts.push("전반적으로 요청 조건에 매우 적합한 제품입니다.")
  } else if (pct >= 60) {
    parts.push("요청 조건에 대체로 부합하는 제품입니다.")
  } else if (pct >= 40) {
    parts.push("일부 조건은 맞지만, 세부 사항 확인이 필요합니다.")
  } else {
    parts.push("요청 조건과의 일치도가 낮아 주의가 필요합니다.")
  }

  return parts.join(" ")
}

// ── Score Breakdown (xAI — Explainable AI) ────────────────────
function ScoreBreakdownPanel({ breakdown }: { breakdown: ScoreBreakdown }) {
  const { language } = useApp()
  const dimensions = [
    { key: "diameter", ko: "직경", en: "Diameter", emoji: "📐" },
    { key: "flutes", ko: "날 수", en: "Flutes", emoji: "🔧" },
    { key: "materialTag", ko: "소재", en: "Material", emoji: "🧱" },
    { key: "operation", ko: "가공", en: "Operation", emoji: "⚙️" },
    { key: "coating", ko: "코팅", en: "Coating", emoji: "🛡️" },
    { key: "completeness", ko: "완성도", en: "Completeness", emoji: "📊" },
    { key: "evidence", ko: "절삭조건", en: "Cutting Cond.", emoji: "📄" },
  ] as const

  const narrative = buildXaiNarrative(breakdown)

  return (
    <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-lg border border-blue-100 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
          <Info size={11} className="text-blue-600" />{language === 'ko' ? '추천 근거 (xAI)' : 'Recommendation Basis (xAI)'}
        </div>
        <div className="text-xs font-bold text-blue-700">
          {breakdown.total}/{breakdown.maxTotal}pt ({breakdown.matchPct}%)
        </div>
      </div>
      <div className="space-y-1.5">
        {dimensions.map(dim => {
          const d = breakdown[dim.key]
          const pct = d.max > 0 ? Math.round((d.score / d.max) * 100) : 0
          const barColor = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-500" : pct > 0 ? "bg-red-400" : "bg-gray-200"
          return (
            <div key={dim.key}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-600 flex items-center gap-1">
                  <span>{dim.emoji}</span>{dim[language]}
                </span>
                <span className="font-mono text-slate-500">{d.score}/{d.max}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 w-16 text-right truncate">{d.detail}</span>
              </div>
            </div>
          )
        })}
      </div>
      {/* Natural language explanation */}
      <div className="bg-white/70 rounded-md px-2.5 py-2 border border-blue-100/50">
        <div className="text-[11px] text-slate-600 leading-relaxed">
          {narrative}
        </div>
      </div>
      <div className="text-[10px] text-slate-400 border-t border-slate-200 pt-1.5 mt-1">
        {language === 'ko' ? 'YG-1 제품 DB 기반 자동 평가 · 추정값 없음' : 'Auto-evaluated from YG-1 product DB · No estimated values'}
      </div>
    </div>
  )
}

// ── ProductCard ────────────────────────────────────────────────
function ProductCard({ scored, rank, isAlternative = false }: {
  scored: ScoredProduct; rank: number; isAlternative?: boolean
}) {
  const { language } = useApp()
  const [open, setOpen] = useState(!isAlternative)
  const p = scored.product
  return (
    <Card className={`border ${isAlternative ? "border-gray-200" : "border-blue-200 shadow-sm"}`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          {p.seriesIconUrl && (
            <img src={p.seriesIconUrl} alt={p.seriesName ?? ""} className="w-16 h-16 object-contain rounded border border-gray-100 shrink-0 bg-gray-50" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs text-gray-400 font-mono">#{rank}</span>
              <MatchBadge status={scored.matchStatus} />
              <StockBadge status={scored.stockStatus} total={scored.totalStock} />
            </div>
            <div className="font-mono text-sm font-bold text-gray-900">{p.displayCode}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {p.brand && <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{p.brand}</span>}
              {p.seriesName && <span className="text-xs text-blue-700 font-medium">{p.seriesName}</span>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 pt-0 space-y-3">
          <div className="bg-gray-50 rounded-lg p-3">
            <SpecRow label={language === 'ko' ? '직경' : 'Diameter'} value={p.diameterMm != null ? `φ${p.diameterMm}mm` : null} />
            <SpecRow label={language === 'ko' ? '날 수' : 'Flutes'} value={p.fluteCount != null ? `${p.fluteCount}${language === 'ko' ? '날' : 'FL'}` : null} />
            <SpecRow label={language === 'ko' ? '코팅' : 'Coating'} value={p.coating} />
            <SpecRow label={language === 'ko' ? '공구 소재' : 'Tool Material'} value={p.toolMaterial} />
            <SpecRow label={language === 'ko' ? '섕크 직경' : 'Shank Dia.'} value={p.shankDiameterMm != null ? `${p.shankDiameterMm}mm` : null} />
            <SpecRow label={language === 'ko' ? '절삭 길이' : 'LOC'} value={p.lengthOfCutMm != null ? `${p.lengthOfCutMm}mm` : null} />
            <SpecRow label={language === 'ko' ? '전체 길이' : 'OAL'} value={p.overallLengthMm != null ? `${p.overallLengthMm}mm` : null} />
            <SpecRow label={language === 'ko' ? '나선각' : 'Helix Angle'} value={p.helixAngleDeg != null ? `${p.helixAngleDeg}°` : null} />
          </div>
          {p.materialTags.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === 'ko' ? '적용 소재' : 'Materials'}</div>
              <div className="flex flex-wrap gap-1">
                {p.materialTags.map(t => <Badge key={t} variant="secondary" className="text-xs">{language === "ko" ? `${t}군` : `${t} Group`}</Badge>)}
              </div>
            </div>
          )}
          {scored.matchedFields.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">{language === 'ko' ? '매칭 근거' : 'Match Basis'}</div>
              <div className="flex flex-wrap gap-1">
                {scored.matchedFields.map((f, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{f}</span>
                ))}
              </div>
            </div>
          )}
          {scored.scoreBreakdown && (
            <ScoreBreakdownPanel breakdown={scored.scoreBreakdown} />
          )}
        </CardContent>
      )}
    </Card>
  )
}

// ── Candidate Card (lightweight, for sidebar) ────────────────
function CandidateCard({ c }: { c: CandidateSnapshot }) {
  const { language } = useApp()
  const [showXai, setShowXai] = useState(false)
  const bd = c.scoreBreakdown
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
      <div className="flex gap-2">
        {c.seriesIconUrl && (
          <img src={c.seriesIconUrl} alt={c.seriesName ?? ""} className="w-12 h-12 object-contain rounded border border-gray-100 shrink-0 bg-gray-50" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-mono">#{c.rank}</span>
            <MatchBadge status={c.matchStatus} />
            <StockBadge status={c.stockStatus} total={c.totalStock} />
          </div>
          <div className="font-mono text-sm font-bold text-gray-900">{c.displayCode}</div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {c.brand && <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{c.brand}</span>}
            {c.seriesName && <span className="text-xs text-blue-700 font-medium">{c.seriesName}</span>}
          </div>
          {/* ── Inline spec summary: D-POWER GRAPHITE | EIB04 → Ø2mm · 2F · TiAlN · N군 · 7mm ── */}
          <div className="text-[11px] text-gray-500 mt-0.5">
            {[
              c.diameterMm != null ? `Ø${c.diameterMm}mm` : null,
              c.fluteCount != null ? `${c.fluteCount}F` : null,
              c.coating ?? null,
              c.materialTags.length > 0 ? `${c.materialTags.join("/")}군` : null,
              c.displayLabel ?? null,
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {c.hasEvidence && c.bestCondition && (
          <EvidenceBadge conditions={c.bestCondition} />
        )}
      </div>
      {/* Compact score bar + xAI toggle */}
      {bd && (
        <div className="pt-1">
          <button onClick={() => setShowXai(o => !o)}
            className="w-full flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-blue-600 transition-colors">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
              <div className="bg-green-500 h-full" style={{ width: `${(bd.diameter.score / bd.maxTotal) * 100}%` }} />
              <div className="bg-blue-500 h-full" style={{ width: `${(bd.flutes.score / bd.maxTotal) * 100}%` }} />
              <div className="bg-amber-500 h-full" style={{ width: `${(bd.materialTag.score / bd.maxTotal) * 100}%` }} />
              <div className="bg-purple-500 h-full" style={{ width: `${(bd.operation.score / bd.maxTotal) * 100}%` }} />
              <div className="bg-cyan-500 h-full" style={{ width: `${(bd.coating.score / bd.maxTotal) * 100}%` }} />
              <div className="bg-gray-400 h-full" style={{ width: `${((bd.completeness.score + bd.evidence.score) / bd.maxTotal) * 100}%` }} />
            </div>
            <span className="font-mono shrink-0">{bd.matchPct}%</span>
            <Info size={9} />
          </button>
          {showXai && <div className="mt-2"><ScoreBreakdownPanel breakdown={bd} /></div>}
        </div>
      )}
    </div>
  )
}

// ── Verification Status Badge ─────────────────────────────────
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

// ── Intent Summary Card ───────────────────────────────────────
function IntentSummaryCard({ prep }: { prep: RequestPreparationResult }) {
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
        <Zap size={11} />{language === 'ko' ? '의도 분석' : 'Intent Analysis'}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
          {intentLabels[prep.intent]?.[language] ?? prep.intent}
        </span>
        <span className={`text-[10px] px-1.5 py-0 rounded ${
          prep.intentConfidence === "high" ? "bg-green-100 text-green-700"
          : prep.intentConfidence === "medium" ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-500"
        }`}>
          {language === 'ko' ? '신뢰도' : 'Confidence'}: {prep.intentConfidence}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-blue-600">
        <span>{language === 'ko' ? `슬롯 ${prep.slots.length}개` : `${prep.slots.length} slots`}</span>
        <span>{language === 'ko' ? `완성도 ${prep.completeness.completionPct}%` : `${prep.completeness.completionPct}% complete`}</span>
        {prep.route.riskFlags.length > 0 && (
          <span className="text-amber-600">{language === 'ko' ? '위험' : 'Risk'}: {prep.route.riskFlags.join(", ")}</span>
        )}
      </div>
    </div>
  )
}

// ── Why Recommended Card ──────────────────────────────────────
function WhyRecommendedCard({ explanation }: { explanation: RecommendationExplanation }) {
  const { language } = useApp()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
      <button onClick={() => setExpanded(o => !o)}
        className="flex items-center justify-between w-full text-xs font-semibold text-green-800">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={11} />{language === 'ko' ? '왜 이 제품인가?' : 'Why This Product?'}
          <span className="text-green-600 font-mono">({explanation.matchPct}% {language === 'ko' ? '일치' : 'match'})</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Always show summary */}
      <div className="text-[11px] text-green-700">{explanation.summaryText}</div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {/* Matched facts */}
          {explanation.matchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-green-700 mb-1">{language === 'ko' ? '일치 항목' : 'Matched'}</div>
              {explanation.matchedFacts.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                  <Check size={10} className="text-green-600 shrink-0" />
                  <span className="text-gray-700">{f.label}: {f.productValue}</span>
                  <span className={`text-[10px] px-1 rounded ${
                    f.matchType === "exact" ? "bg-green-100 text-green-700"
                    : f.matchType === "close" ? "bg-blue-100 text-blue-700"
                    : "bg-amber-100 text-amber-700"
                  }`}>
                    {f.matchType === "exact"
                      ? (language === 'ko' ? "정확" : "Exact")
                      : f.matchType === "close"
                      ? (language === 'ko' ? "근사" : "Close")
                      : (language === 'ko' ? "부분" : "Partial")}
                  </span>
                  <span className="text-gray-400 font-mono text-[10px] ml-auto">{f.score}/{f.maxScore}</span>
                </div>
              ))}
            </div>
          )}

          {/* Unmatched facts */}
          {explanation.unmatchedFacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-amber-700 mb-1">{language === 'ko' ? '불일치 항목' : 'Unmatched'}</div>
              {explanation.unmatchedFacts.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] py-0.5">
                  <AlertTriangle size={10} className={`shrink-0 mt-0.5 ${
                    f.impact === "critical" ? "text-red-500" : f.impact === "moderate" ? "text-amber-500" : "text-gray-400"
                  }`} />
                  <div>
                    <span className="text-gray-700">{f.label}: {f.reason}</span>
                    <span className={`ml-1 text-[10px] px-1 rounded ${
                      f.impact === "critical" ? "bg-red-100 text-red-600"
                      : f.impact === "moderate" ? "bg-amber-100 text-amber-600"
                      : "bg-gray-100 text-gray-500"
                    }`}>
                      {f.impact === "critical"
                        ? (language === 'ko' ? "중요" : "Critical")
                        : f.impact === "moderate"
                        ? (language === 'ko' ? "보통" : "Moderate")
                        : (language === 'ko' ? "경미" : "Minor")}
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

// ── Fact Check Card ───────────────────────────────────────────
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
      <button onClick={() => setExpanded(o => !o)}
        className="flex items-center justify-between w-full text-xs font-semibold text-slate-700">
        <div className="flex items-center gap-1.5">
          <Database size={11} />Fact Check
          <VerificationBadge status={report.overallStatus} />
          <span className="font-mono text-slate-500">({report.verificationPct}%)</span>
        </div>
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${
            report.verificationPct >= 80 ? "bg-green-500"
            : report.verificationPct >= 50 ? "bg-amber-500"
            : "bg-red-400"
          }`} style={{ width: `${report.verificationPct}%` }} />
        </div>
        <span className="text-[10px] text-slate-500 font-mono">{report.verificationPct}%</span>
      </div>

      {expanded && (
        <div className="space-y-1.5 pt-1">
          {report.steps.map((step) => (
            <div key={step.step} className="flex items-center gap-2 text-[11px]">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                step.passed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
              }`}>
                {step.step}
              </span>
              <span className="flex-1 text-slate-700">{step.label}</span>
              <span className="font-mono text-slate-400">{step.fieldsVerified}/{step.fieldsChecked}</span>
              {step.passed ? <Check size={10} className="text-green-500" /> : <AlertTriangle size={10} className="text-amber-500" />}
            </div>
          ))}
          {report.criticalIssues.length > 0 && (
            <div className="mt-1 pt-1 border-t border-slate-200">
              <div className="text-[10px] font-semibold text-red-600 mb-0.5">{language === 'ko' ? '주의사항' : 'Critical Issues'}</div>
              {report.criticalIssues.map((issue, i) => (
                <div key={i} className="text-[10px] text-red-500">{issue}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Evidence Source Card ───────────────────────────────────────
function EvidenceSourceCard({ evidence }: { evidence: SupportingEvidence[] }) {
  const { language } = useApp()
  if (evidence.length === 0) return null

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-800">
        <FileText size={11} />{language === 'ko' ? '근거 자료' : 'Evidence Sources'}
      </div>
      {evidence.map((e, i) => (
        <div key={i} className="flex items-start gap-2 text-[11px]">
          <span className={`shrink-0 px-1.5 py-0 rounded text-[10px] font-medium ${
            e.type === "cutting_condition" ? "bg-purple-100 text-purple-700"
            : e.type === "catalog_spec" ? "bg-blue-100 text-blue-700"
            : e.type === "inventory" ? "bg-green-100 text-green-700"
            : "bg-gray-100 text-gray-600"
          }`}>
            {e.type === "cutting_condition" ? (language === 'ko' ? "절삭조건" : "Cutting Cond.")
            : e.type === "catalog_spec" ? (language === 'ko' ? "카탈로그" : "Catalog")
            : e.type === "inventory" ? (language === 'ko' ? "재고" : "Inventory")
            : (language === 'ko' ? "납기" : "Lead Time")}
          </span>
          <span className="text-gray-700">{e.summary}</span>
        </div>
      ))}
    </div>
  )
}

function RecommendationPanel({ result, resultText, evidenceSummaries, explanation, factChecked }: {
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
        <span className="text-xs text-gray-500">{totalCandidatesConsidered}{language === 'ko' ? '개 후보 검색' : ' candidates searched'}</span>
      </div>
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            {warnings.map((w, i) => <div key={i} className="text-xs text-amber-800">{w}</div>)}
          </div>
        </div>
      )}
      {resultText && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
          {resultText}
        </div>
      )}

      {/* NEW: Why Recommended Card */}
      {explanation && <WhyRecommendedCard explanation={explanation} />}

      {/* NEW: Fact Check Card */}
      {factChecked && <FactCheckCard factCheck={factChecked} />}

      {/* NEW: Evidence Source Card */}
      {explanation && explanation.supportingEvidence.length > 0 && (
        <EvidenceSourceCard evidence={explanation.supportingEvidence} />
      )}

      {/* Legacy evidence section (kept as fallback if no explanation) */}
      {!explanation && evidenceSummaries && evidenceSummaries.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="text-xs font-semibold text-purple-800 mb-2 flex items-center gap-1">
            <FileText size={11} />절삭조건 근거
          </div>
          {evidenceSummaries.map((es, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <div className="text-xs font-mono text-purple-700">{es.productCode}</div>
              {es.bestCondition && (
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                  {es.bestCondition.Vc && <span className="text-gray-600">Vc: {es.bestCondition.Vc}</span>}
                  {es.bestCondition.fz && <span className="text-gray-600">fz: {es.bestCondition.fz}</span>}
                  {es.bestCondition.ap && <span className="text-gray-600">ap: {es.bestCondition.ap}</span>}
                  {es.bestCondition.ae && <span className="text-gray-600">ae: {es.bestCondition.ae}</span>}
                  {es.bestCondition.n && <span className="text-gray-600">n: {es.bestCondition.n}</span>}
                  {es.bestCondition.vf && <span className="text-gray-600">vf: {es.bestCondition.vf}</span>}
                </div>
              )}
              <div className="text-[10px] text-purple-500 mt-0.5">
                신뢰도: {Math.round(es.bestConfidence * 100)}% · {es.sourceCount}건
              </div>
            </div>
          ))}
        </div>
      )}
      {primaryProduct && (
        <div>
          <div className="flex items-center gap-1 text-xs font-semibold text-gray-700 mb-2">
            <Zap size={12} className="text-blue-600" />{language === 'ko' ? '추천 제품' : 'Recommended Product'}
          </div>
          <ProductCard scored={primaryProduct} rank={1} />
        </div>
      )}
      {alternatives.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">{language === 'ko' ? `대체 후보 (${alternatives.length})` : `Alternatives (${alternatives.length})`}</div>
          <div className="space-y-2">
            {alternatives.map((alt, i) => (
              <ProductCard key={alt.product.id} scored={alt} rank={i + 2} isAlternative />
            ))}
          </div>
        </div>
      )}
      {status === "none" && (
        <div className="text-center py-8">
          <AlertCircle size={32} className="text-gray-200 mx-auto mb-2" />
          <div className="text-sm text-gray-500">{language === 'ko' ? '조건에 맞는 제품 없음' : 'No matching products found'}</div>
          <div className="text-xs text-gray-400 mt-1">{language === 'ko' ? '직경이나 소재 조건을 조정해보세요' : 'Try adjusting diameter or material conditions'}</div>
        </div>
      )}
    </div>
  )
}

// ── Intake: single option button ───────────────────────────────
function OptionBtn({
  label, selected, isUnknown = false, tag, onClick, disabled = false,
}: {
  label: string; selected: boolean; isUnknown?: boolean; tag?: string; onClick: () => void; disabled?: boolean
}) {
  const { language } = useApp()
  if (disabled) {
    return (
      <div
        className="relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left min-h-[44px] bg-gray-50 text-gray-400 border-2 border-gray-100 cursor-not-allowed select-none"
        title={language === "ko" ? "준비 중" : "Coming Soon"}
      >
        <span className="flex-1">{label}</span>
        {tag && <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-gray-100 text-gray-300">{tag}</span>}
        <span className="text-[10px] text-gray-300 whitespace-nowrap">{language === "ko" ? "준비 중" : "Coming Soon"}</span>
      </div>
    )
  }

  return (
    <button
      onClick={onClick}
      className={[
        "relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left min-h-[44px]",
        selected
          ? isUnknown
            ? "bg-gray-200 text-gray-700 border-2 border-gray-400"
            : "bg-blue-600 text-white border-2 border-blue-600 shadow-sm"
          : isUnknown
            ? "bg-white text-gray-500 border-2 border-dashed border-gray-300 hover:border-gray-400"
            : "bg-white text-gray-700 border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50",
      ].join(" ")}
    >
      {selected && !isUnknown && <Check size={13} className="shrink-0 text-blue-200" />}
      {isUnknown && <HelpCircle size={13} className={selected ? "shrink-0 text-gray-500" : "shrink-0 text-gray-400"} />}
      <span className="flex-1">{label}</span>
      {tag && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${selected && !isUnknown ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500"}`}>
          {tag}
        </span>
      )}
    </button>
  )
}

// ── Single intake field section ────────────────────────────────
function IntakeFieldSection({
  config, index, state, onChange,
}: {
  config: IntakeFieldConfig
  index: number
  state: AnswerState<string>
  onChange: (s: AnswerState<string>) => void
}) {
  const { language } = useApp()
  const [showCustom, setShowCustom] = useState(false)
  const [customVal, setCustomVal] = useState(
    state.status === "known" &&
      !config.options.some(o => o.value === (state as { status: "known"; value: string }).value)
      ? (state as { status: "known"; value: string }).value
      : ""
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const currentValue = state.status === "known" ? (state as { status: "known"; value: string }).value : null

  // Multi-select: parse comma-separated values into Set
  const selectedValues = useMemo(() => {
    if (!config.multiSelect || !currentValue) return new Set<string>()
    return new Set(currentValue.split(",").map(v => v.trim()).filter(Boolean))
  }, [config.multiSelect, currentValue])

  const isQuickOption = currentValue !== null && config.options.some(o =>
    config.multiSelect ? selectedValues.has(o.value) : o.value === currentValue
  )
  const isCustom = currentValue !== null && !isQuickOption && !config.multiSelect

  const handleCustomClick = () => {
    setShowCustom(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const handleCustomChange = (val: string) => {
    setCustomVal(val)
    if (val.trim()) onChange({ status: "known", value: val.trim() })
    else onChange({ status: "unanswered" })
  }

  // Multi-select toggle handler
  const handleMultiToggle = (optValue: string) => {
    const next = new Set(selectedValues)
    if (next.has(optValue)) {
      next.delete(optValue)
    } else {
      next.add(optValue)
    }
    if (next.size === 0) {
      onChange({ status: "unanswered" })
    } else {
      onChange({ status: "known", value: [...next].join(",") })
    }
  }

  const selectedCount = config.multiSelect ? selectedValues.size : (state.status === "known" ? 1 : 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{config.emoji}</span>
            <span className="text-sm font-semibold text-gray-900">{getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}</span>
            {state.status !== "unanswered" && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${state.status === "unknown" ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}>
                {state.status === "unknown"
                  ? (language === 'ko' ? "모름" : "Unknown")
                  : config.multiSelect && selectedCount > 1
                  ? `✓ ${selectedCount}${language === 'ko' ? '개 선택' : ' selected'}`
                  : (language === 'ko' ? "✓ 선택됨" : "✓ Selected")}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{localizeIntakeText(config.description, language)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {config.options.map(opt => (
          <OptionBtn
            key={opt.value}
            label={localizeIntakeText(opt.label, language)}
            tag={opt.tag}
            disabled={opt.disabled}
            selected={config.multiSelect
              ? selectedValues.has(opt.value)
              : state.status === "known" && currentValue === opt.value
            }
            onClick={() => {
              setShowCustom(false)
              if (config.multiSelect) {
                handleMultiToggle(opt.value)
              } else {
                onChange({ status: "known", value: opt.value })
              }
            }}
          />
        ))}
        {config.hasCustomInput && (
          <OptionBtn
            label={localizeIntakeText(config.customInputLabel ?? "직접입력", language)}
            selected={isCustom || (showCustom && state.status !== "unknown")}
            onClick={handleCustomClick}
          />
        )}
      </div>
      {config.hasCustomInput && (showCustom || isCustom) && state.status !== "unknown" && (
        <input
          ref={inputRef}
          value={customVal}
          onChange={e => handleCustomChange(e.target.value)}
          placeholder={localizeIntakeText(config.customInputPlaceholder ?? "직접 입력", language)}
          className="w-full px-3 py-2.5 rounded-xl border-2 border-blue-300 text-sm focus:outline-none focus:border-blue-500"
        />
      )}
      <div className="pt-1 border-t border-gray-100">
        <OptionBtn
          label={localizeIntakeText(config.unknownLabel, language)}
          isUnknown
          selected={state.status === "unknown"}
          onClick={() => {
            setShowCustom(false)
            setCustomVal("")
            onChange({ status: "unknown" })
          }}
        />
      </div>
    </div>
  )
}

// ── Step 1: Intake Gate ────────────────────────────────────────
function IntakeGate({
  form, onChange, onNext,
}: {
  form: ProductIntakeForm
  onChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
  onNext: () => void
}) {
  const { language } = useApp()
  const answered = countAnswered(form)
  const allDone = allRequiredAnswered(form)
  const purposeIsSubstitute =
    form.inquiryPurpose.status === "known" &&
    ((form.inquiryPurpose as { status: "known"; value: InquiryPurpose }).value === "substitute" ||
      (form.inquiryPurpose as { status: "known"; value: InquiryPurpose }).value === "inventory_substitute")

  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const scrollToNextUnanswered = (justAnsweredKey: string) => {
    const idx = FIELD_CONFIGS.findIndex(c => c.key === justAnsweredKey)
    for (let offset = 1; offset <= FIELD_CONFIGS.length; offset++) {
      const nextIdx = (idx + offset) % FIELD_CONFIGS.length
      const nextKey = FIELD_CONFIGS[nextIdx].key
      const nextState = form[nextKey as keyof ProductIntakeForm] as AnswerState<string>
      if (nextState.status === "unanswered") {
        const el = fieldRefs.current[nextKey]
        if (el && scrollContainerRef.current) {
          setTimeout(() => {
            el.scrollIntoView({ behavior: "smooth", block: "center" })
            el.classList.add("ring-2", "ring-blue-400", "ring-offset-2")
            setTimeout(() => el.classList.remove("ring-2", "ring-blue-400", "ring-offset-2"), 1500)
          }, 200)
        }
        return
      }
    }
  }

  const handleFieldChange = (key: keyof ProductIntakeForm, val: AnswerState<string>) => {
    onChange(key, val)
    if (val.status !== "unanswered") {
      scrollToNextUnanswered(key as string)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-5 pb-4 border-b bg-white">
        <h2 className="text-base font-bold text-gray-900">{language === 'ko' ? '추천 전 기본 정보 확인' : 'Basic Info Before Recommendation'}</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {language === 'ko'
            ? <span>모르는 항목은 비워두지 말고 <strong>&apos;모름&apos;</strong>을 선택해주세요. 추정하지 않습니다.</span>
            : <span>For unknown fields, select <strong>&apos;Unknown&apos;</strong> instead of leaving blank. No guessing.</span>
          }
        </p>
        <div className="flex items-center gap-2 mt-3">
          {FIELD_CONFIGS.map((_, i) => {
            const fieldState = form[FIELD_CONFIGS[i].key as keyof ProductIntakeForm] as AnswerState<string>
            const done = fieldState.status !== "unanswered"
            return (
              <button key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors cursor-pointer hover:opacity-80 ${done ? "bg-blue-500" : "bg-gray-200"}`}
                onClick={() => {
                  const el = fieldRefs.current[FIELD_CONFIGS[i].key]
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
                }}
                title={getIntakeFieldLabel(FIELD_CONFIGS[i].key as keyof ProductIntakeForm, language)}
              />
            )
          })}
          <span className="text-xs text-gray-500 whitespace-nowrap">{answered}/6</span>
        </div>
      </div>
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {FIELD_CONFIGS.map((cfg, i) => {
          const highlight = purposeIsSubstitute && cfg.key === "toolTypeOrCurrentProduct"
          return (
            <div key={cfg.key} ref={el => { fieldRefs.current[cfg.key] = el }} className="rounded-xl transition-all duration-300">
              {highlight && (
                <div className="flex items-center gap-1.5 mb-2 px-2">
                  <Info size={11} className="text-blue-500" />
                  <span className="text-xs text-blue-600 font-medium">
                    {localizeIntakeText("대체품 찾기 → 현재 사용 중인 EDP/품번을 입력하면 더 정확합니다", language)}
                  </span>
                </div>
              )}
              <IntakeFieldSection
                config={cfg} index={i}
                state={form[cfg.key as keyof ProductIntakeForm] as AnswerState<string>}
                onChange={(val) => handleFieldChange(cfg.key as keyof ProductIntakeForm, val)}
              />
            </div>
          )
        })}
        <div className="h-4" />
      </div>
      <div className="shrink-0 px-4 py-3 bg-white border-t shadow-md">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <span className="text-sm text-gray-600">
            {allDone
              ? <span className="text-green-700 font-medium flex items-center gap-1"><CheckCircle2 size={14} />{language === 'ko' ? '모두 완료되었습니다' : 'All fields complete'}</span>
              : <span>{answered}/6 {language === 'ko' ? `항목 완료 · ${6 - answered}개 남음` : `complete · ${6 - answered} remaining`}</span>
            }
          </span>
          <Button onClick={onNext} disabled={!allDone} className="gap-2">
            {language === 'ko' ? '조건 요약 확인' : 'Review Conditions'} <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Step 2: Intake Summary ─────────────────────────────────────
function IntakeSummaryScreen({
  form, onEdit, onStart,
}: {
  form: ProductIntakeForm
  onEdit: () => void
  onStart: () => void
}) {
  const { language } = useApp()
  const unknownCount = countUnknowns(form)
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-5 pb-4 border-b bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{language === 'ko' ? '입력 조건 요약' : 'Condition Summary'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{language === 'ko' ? '아래 조건으로 탐색합니다. 모르는 정보는 추정하지 않습니다.' : 'Will search with these conditions. Unknown fields are not guessed.'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs">
            <Edit2 size={12} />{language === 'ko' ? '수정' : 'Edit'}
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {FIELD_CONFIGS.map(cfg => {
          const state = form[cfg.key as keyof ProductIntakeForm] as AnswerState<string>
          const isUnknown = state.status === "unknown"
          const displayVal = getIntakeDisplayValue(cfg.key as keyof ProductIntakeForm, state, language)
          return (
            <div key={cfg.key}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${isUnknown ? "bg-gray-50 border-gray-200" : "bg-white border-gray-200"}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${isUnknown ? "bg-gray-200" : "bg-green-100"}`}>
                {isUnknown ? <HelpCircle size={14} className="text-gray-400" /> : <Check size={14} className="text-green-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-500">{cfg.emoji} {getIntakeFieldLabel(cfg.key as keyof ProductIntakeForm, language)}</div>
                <div className={`text-sm font-medium mt-0.5 ${isUnknown ? "text-gray-400 italic" : "text-gray-900"}`}>
                  {displayVal}
                </div>
              </div>
              <button onClick={onEdit} className="text-xs text-blue-500 hover:text-blue-700 shrink-0">{language === 'ko' ? '수정' : 'Edit'}</button>
            </div>
          )
        })}
        {unknownCount > 0 && (
          <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800 leading-relaxed">
              {language === 'ko' ? (
                <><strong>{unknownCount}개 항목이 &quot;모름&quot;</strong>으로 설정되어 있습니다.
                {unknownCount >= 3
                  ? " 많은 조건이 없어 정확 추천 대신 근사 후보로 제공됩니다."
                  : " 해당 조건은 필터에서 제외되고, 알려진 조건 기준으로만 추천됩니다."
                }</>
              ) : (
                <><strong>{unknownCount} field(s) set to &quot;Unknown&quot;</strong>.
                {unknownCount >= 3
                  ? " Many conditions unknown — approximate candidates will be provided instead of exact matches."
                  : " Unknown fields will be excluded from filters; recommendation based on known conditions only."
                }</>
              )}
            </div>
          </div>
        )}
        {unknownCount === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
            <CheckCircle2 size={14} className="text-green-600" />
            <span className="text-xs text-green-800">{language === 'ko' ? '모든 조건이 입력되었습니다. 정확한 추천이 가능합니다.' : 'All conditions entered. Exact recommendations are possible.'}</span>
          </div>
        )}
        <div className="h-4" />
      </div>
      <div className="shrink-0 px-4 py-3 bg-white border-t shadow-md space-y-2">
        <div className="max-w-lg mx-auto">
          <Button onClick={onStart} className="w-full gap-2">
            {language === 'ko' ? '이 조건으로 추천 시작' : 'Start Recommendation'} <ArrowRight size={14} />
          </Button>
          <Button variant="ghost" onClick={onEdit} className="w-full mt-1 text-xs text-gray-500 gap-1">
            <Edit2 size={11} />{language === 'ko' ? '추가 조건 수정하기' : 'Edit Conditions'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Loading screen ─────────────────────────────────────────────
function LoadingScreen() {
  const { language } = useApp()
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex gap-1.5 mb-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div className="text-sm font-medium text-gray-700">{language === 'ko' ? '실제 데이터에서 제품 검색 중...' : 'Searching products from real data...'}</div>
      <div className="text-xs text-gray-400 mt-1">{language === 'ko' ? '없는 제품은 생성하지 않습니다' : 'Only real products — no hallucination'}</div>
    </div>
  )
}

// ── Chat message type ──────────────────────────────────────────
interface ChatMsg {
  role: "user" | "ai"
  text: string
  recommendation?: RecommendationResult | null
  chips?: string[]
  evidenceSummaries?: EvidenceSummary[] | null
  isLoading?: boolean
  // New: explanation + fact check data
  requestPreparation?: RequestPreparationResult | null
  primaryExplanation?: RecommendationExplanation | null
  primaryFactChecked?: Record<string, unknown> | null
  altExplanations?: RecommendationExplanation[]
}

// ── Build intake prompt text ────────────────────────────────────
function buildIntakePromptText(form: ProductIntakeForm, language: "ko" | "en"): string {
  const parts: string[] = []
  FIELD_CONFIGS.forEach(cfg => {
    const state = form[cfg.key as keyof ProductIntakeForm] as AnswerState<string>
    const val = getIntakeDisplayValue(cfg.key as keyof ProductIntakeForm, state, language)
    const label = getIntakeFieldLabel(cfg.key as keyof ProductIntakeForm, language)
    parts.push(`${cfg.emoji} ${label}: ${val}`)
  })
  parts.push(language === "ko"
    ? "\n위 조건으로 적합한 YG-1 제품을 추천해주세요."
    : "\nPlease recommend suitable YG-1 products based on the conditions above.")
  return parts.join("\n")
}

// ════════════════════════════════════════════════════════════════
// EXPLORATION SCREEN — 3-Panel Layout
// Left: Sidebar (intake + filters + resolution)
// Center: Narrowing chat
// Right: Candidate cards
// ════════════════════════════════════════════════════════════════

function ExplorationScreen({
  form, messages, isSending, sessionState, candidateSnapshot,
  onSend, onReset, onEdit,
}: {
  form: ProductIntakeForm
  messages: ChatMsg[]
  isSending: boolean
  sessionState: ExplorationSessionState | null
  candidateSnapshot: CandidateSnapshot[] | null
  onSend: (text: string) => void
  onReset: () => void
  onEdit: () => void
}) {
  const { language } = useApp()
  const [showSidebar, setShowSidebar] = useState(false)
  const [showCandidates, setShowCandidates] = useState(false)

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">{language === 'ko' ? 'AI 제품 탐색' : 'AI Product Search'}</h2>
          {sessionState && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RESOLUTION_CONFIG[sessionState.resolutionStatus]?.cls ?? "bg-gray-100 text-gray-600"}`}>
              {RESOLUTION_CONFIG[sessionState.resolutionStatus]?.[language] ?? sessionState.resolutionStatus}
            </span>
          )}
          {sessionState && sessionState.candidateCount > 0 && sessionState.resolutionStatus !== "broad" && (
            <span className="text-xs text-gray-500">
              {sessionState.candidateCount > 50
                ? (language === 'ko' ? '후보군 넓음' : 'Wide candidate pool')
                : language === 'ko'
                  ? `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)}개 추천`
                  : `${Math.min(sessionState.candidateCount, MAX_DISPLAY_CANDIDATES)} recommended`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Mobile toggles */}
          <Button variant="outline" size="sm" onClick={() => setShowSidebar(o => !o)}
            className="gap-1 text-xs h-7 px-2 lg:hidden">
            <Filter size={11} />{language === 'ko' ? '조건' : 'Filters'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCandidates(o => !o)}
            className="gap-1 text-xs h-7 px-2 lg:hidden">
            <Activity size={11} />{language === 'ko' ? '후보' : 'Results'}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1 text-xs h-7 px-2">
            <Edit2 size={11} />{language === 'ko' ? '조건 수정' : 'Edit Conditions'}
          </Button>
          <Button variant="outline" size="sm" onClick={onReset} className="gap-1 text-xs h-7 px-2 border-orange-300 text-orange-700 hover:bg-orange-50">
            <RotateCcw size={11} />{language === 'ko' ? '새 검색' : 'New Search'}
          </Button>
        </div>
      </div>

      {/* 3-panel body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left sidebar */}
        <div className={`w-60 border-r bg-gray-50 flex-shrink-0 overflow-y-auto transition-all ${showSidebar ? "block" : "hidden"} lg:block`}>
          <ExplorationSidebar form={form} sessionState={sessionState} onEdit={onEdit} messages={messages} />
        </div>

        {/* Center chat */}
        <div className="flex-1 min-w-0 flex flex-col">
          <NarrowingChat
            messages={messages}
            isSending={isSending}
            onSend={onSend}
            onReset={onReset}
          />
        </div>

        {/* Right candidate panel */}
        <div className={`w-80 border-l bg-white flex-shrink-0 overflow-y-auto transition-all ${showCandidates ? "block" : "hidden"} lg:block`}>
          <CandidatePanel candidates={candidateSnapshot} messages={messages} />
        </div>
      </div>
    </div>
  )
}

// ── Left Sidebar: Intake + Filters + Resolution ──────────────
function ExplorationSidebar({
  form, sessionState, onEdit, messages,
}: {
  form: ProductIntakeForm
  sessionState: ExplorationSessionState | null
  onEdit: () => void
  messages: ChatMsg[]
}) {
  const { language } = useApp()
  // Find the latest requestPreparation from messages
  const latestPrep = [...messages].reverse().find(m => m.requestPreparation)?.requestPreparation ?? null

  return (
    <div className="p-3 space-y-3">
      {/* Intent Summary Card */}
      {latestPrep && <IntentSummaryCard prep={latestPrep} />}

      {/* Intake summary */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">{language === 'ko' ? '입력 조건' : 'Input Conditions'}</span>
          <button onClick={onEdit} className="text-[10px] text-blue-500 hover:text-blue-700">{language === 'ko' ? '수정' : 'Edit'}</button>
        </div>
        <div className="space-y-1">
          {FIELD_CONFIGS.map(cfg => {
            const state = form[cfg.key as keyof ProductIntakeForm] as AnswerState<string>
            const isUnknown = state.status === "unknown"
            const isUnanswered = state.status === "unanswered"
            if (isUnanswered) return null
            return (
              <div key={cfg.key} className="flex justify-between items-center text-xs bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                <span className="text-gray-500">{cfg.emoji}</span>
                <span className={`flex-1 ml-1.5 truncate ${isUnknown ? "text-gray-400 italic" : "text-gray-800 font-medium"}`}>
                  {getIntakeDisplayValue(cfg.key as keyof ProductIntakeForm, state, language)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Applied filters */}
      {sessionState && sessionState.appliedFilters.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Filter size={10} />{language === 'ko' ? '적용 필터' : 'Applied Filters'}
          </div>
          <div className="space-y-1">
            {sessionState.appliedFilters.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg px-2.5 py-1.5 border border-blue-100">
                <span className="font-medium">{localizeIntakeText(f.value, language)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Narrowing history */}
      {sessionState && sessionState.narrowingHistory.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-700 mb-2">{language === 'ko' ? '축소 이력' : 'Narrowing History'}</div>
          <div className="space-y-1">
            {sessionState.narrowingHistory.map((h, i) => (
              <div key={i} className="text-[10px] text-gray-600 bg-white rounded-lg px-2.5 py-1.5 border border-gray-100">
                <div className="font-medium">Turn {i + 1}: &quot;{localizeIntakeText(h.answer, language)}&quot;</div>
                <div className="text-gray-400">{h.candidateCountBefore} → {h.candidateCountAfter}{language === 'ko' ? '개' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resolution status */}
      {sessionState && (
        <div className="bg-white rounded-lg border border-gray-100 p-2.5">
          <div className="text-[10px] text-gray-500 mb-1">{language === 'ko' ? '해결 상태' : 'Resolution Status'}</div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RESOLUTION_CONFIG[sessionState.resolutionStatus]?.cls ?? "bg-gray-100 text-gray-600"}`}>
            {RESOLUTION_CONFIG[sessionState.resolutionStatus]?.[language] ?? sessionState.resolutionStatus}
          </span>
          <div className="text-[10px] text-gray-400 mt-1">
            {language === 'ko' ? `후보 ${sessionState.candidateCount}개` : `${sessionState.candidateCount} candidates`} · Turn {sessionState.turnCount}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Center: Narrowing Chat ───────────────────────────────────
function NarrowingChat({
  messages, isSending, onSend, onReset,
}: {
  messages: ChatMsg[]
  isSending: boolean
  onSend: (text: string) => void
  onReset?: () => void
}) {
  const { language } = useApp()
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isSending) return
    setInput("")
    onSend(text)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              msg.role === "ai" ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-600"
            }`}>
              {msg.role === "ai" ? <Sparkles size={13} /> : (language === 'ko' ? "나" : "Me")}
            </div>

            <div className="max-w-[82%] space-y-2">
              {msg.text && !msg.isLoading && (
                <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}>
                  {msg.role === "ai" ? <Markdown>{msg.text}</Markdown> : msg.text}
                </div>
              )}

              {msg.isLoading && (
                <div className="flex gap-1.5 px-4 py-3 bg-gray-100 rounded-2xl rounded-bl-sm w-fit">
                  {[0, 1, 2].map(j => (
                    <div key={j} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: `${j * 0.15}s` }} />
                  ))}
                </div>
              )}

              {/* Chips — only for last AI message */}
              {msg.role === "ai" && msg.chips && msg.chips.length > 0 && !msg.isLoading && !isSending && i === messages.length - 1 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {msg.chips.map((chip, ci) => {
                    // Special action chips — handle client-side instead of sending as message
                    const isResetChip = chip === "처음부터 다시" || chip === "처음부터"
                    const isUndoChip = chip === "⟵ 이전 단계"
                    return (
                      <button key={ci}
                        onClick={() => {
                          if (isResetChip && onReset) {
                            onReset()
                          } else {
                            setInput("")
                            onSend(chip)
                          }
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                          isResetChip
                            ? "bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                            : isUndoChip
                            ? "bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 hover:border-amber-400"
                            : "bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                        }`}
                      >
                        {chip}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Recommendation result with evidence */}
              {msg.recommendation && !msg.isLoading && (
                <RecommendationPanel
                  result={msg.recommendation}
                  resultText=""
                  evidenceSummaries={msg.evidenceSummaries}
                  explanation={msg.primaryExplanation}
                  factChecked={msg.primaryFactChecked}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 py-3 border-t bg-white">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={language === 'ko' ? "추가 질문이나 조건을 입력하세요..." : "Enter additional questions or conditions..."}
            rows={1}
            disabled={isSending}
            className="flex-1 px-3 py-2.5 rounded-xl border-2 border-gray-200 text-sm focus:outline-none focus:border-blue-400 resize-none min-h-[42px] max-h-[120px]"
          />
          <Button onClick={handleSend} disabled={!input.trim() || isSending}
            size="sm" className="h-[42px] w-[42px] p-0 shrink-0 rounded-xl">
            <Send size={15} />
          </Button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">
          {language === 'ko' ? 'YG-1 제품 DB 기반 · 추정/생성 없음 · 절삭조건 카탈로그 근거' : 'Based on YG-1 product DB · No estimation · Catalog-grounded cutting conditions'}
        </p>
      </div>
    </div>
  )
}

// ── Right: Candidate Panel ───────────────────────────────────

function CandidatePanel({
  candidates, messages,
}: {
  candidates: CandidateSnapshot[] | null
  messages: ChatMsg[]
}) {
  const { language } = useApp()
  // Find the last recommendation in messages
  const lastRec = [...messages].reverse().find(m => m.recommendation)?.recommendation

  // Cap displayed candidates to 5
  const displayCandidates = candidates?.slice(0, MAX_DISPLAY_CANDIDATES) ?? null
  const totalCount = candidates?.length ?? 0
  const hasMore = totalCount > MAX_DISPLAY_CANDIDATES

  return (
    <div className="p-3 space-y-3">
      <div className="text-xs font-semibold text-gray-700 flex items-center gap-1">
        <Activity size={11} />
        {totalCount > 0 ? (
          language === 'ko'
            ? <>상위 추천 후보 {displayCandidates?.length ?? 0}개{hasMore && <span className="text-gray-400 font-normal">(전체 {totalCount}개 중)</span>}</>
            : <>Top {displayCandidates?.length ?? 0} Candidates{hasMore && <span className="text-gray-400 font-normal"> (of {totalCount})</span>}</>
        ) : (
          <>{language === 'ko' ? '추천 후보' : 'Candidates'}</>
        )}
      </div>

      {displayCandidates && displayCandidates.length > 0 ? (
        <div className="space-y-2">
          {displayCandidates.map(c => (
            <CandidateCard key={c.productCode} c={c} />
          ))}
          {hasMore && (
            <div className="text-center text-[10px] text-gray-400 py-1">
              +{totalCount - MAX_DISPLAY_CANDIDATES}{language === 'ko' ? '개 추가 후보 있음' : ' more candidates'}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">
          <Database size={24} className="mx-auto mb-2 opacity-50" />
          <div className="text-xs">{language === 'ko' ? '조건을 입력하면 후보를 검색합니다' : 'Enter conditions to search candidates'}</div>
        </div>
      )}

      {/* Final recommendation summary if available */}
      {lastRec && (
        <div className="border-t pt-3">
          <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <Zap size={11} className="text-blue-600" />{language === 'ko' ? '최종 추천' : 'Final Recommendation'}
          </div>
          <div className="text-xs text-gray-600 bg-blue-50 rounded-lg p-2.5 border border-blue-100">
            {lastRec.primaryProduct
              ? `${lastRec.primaryProduct.product.displayCode} (${lastRec.status === "exact" ? (language === 'ko' ? "정확 매칭" : "Exact Match") : (language === 'ko' ? "근사 후보" : "Approximate")})`
              : (language === 'ko' ? "매칭 없음" : "No Match")
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// FEEDBACK WIDGET — Bottom-right floating button + modal
// ════════════════════════════════════════════════════════════════

const FEEDBACK_TAGS = [
  { value: "wrong-product", ko: "잘못된 제품", en: "Wrong Product" },
  { value: "good-result", ko: "좋은 결과", en: "Good Result" },
  { value: "slow-response", ko: "느린 응답", en: "Slow Response" },
  { value: "missing-evidence", ko: "근거 부족", en: "Missing Evidence" },
  { value: "ui-issue", ko: "UI 문제", en: "UI Issue" },
  { value: "wrong-condition", ko: "절삭조건 오류", en: "Wrong Cutting Condition" },
  { value: "good-evidence", ko: "좋은 근거", en: "Good Evidence" },
]

type FeedbackAuthorType = "internal" | "customer" | "anonymous"

function FeedbackWidget({
  form,
  messages,
  sessionState,
}: {
  form: ProductIntakeForm
  messages: ChatMsg[]
  sessionState: ExplorationSessionState | null
}) {
  const { language } = useApp()
  const [open, setOpen] = useState(false)
  const [authorType, setAuthorType] = useState<FeedbackAuthorType>("internal")
  const [authorName, setAuthorName] = useState("")
  const [rating, setRating] = useState<number>(0)
  const [comment, setComment] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const authorTypeOptions: ReadonlyArray<readonly [FeedbackAuthorType, string]> = language === "ko"
    ? [["internal", "내부 개발팀"], ["customer", "고객사"], ["anonymous", "익명"]]
    : [["internal", "Internal Team"], ["customer", "Customer"], ["anonymous", "Anonymous"]]

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const buildIntakeSummary = (): string => {
    return FIELD_CONFIGS.map(cfg => {
      const state = form[cfg.key as keyof ProductIntakeForm] as AnswerState<string>
      if (state.status === "unanswered") return null
      const label = getIntakeFieldLabel(cfg.key as keyof ProductIntakeForm, language)
      const value = getIntakeDisplayValue(cfg.key as keyof ProductIntakeForm, state, language)
      return `${label}: ${value}`
    }).filter(Boolean).join("\n")
  }

  const buildRecSummary = (): string | null => {
    const lastAiMsg = [...messages].reverse().find(m => m.role === "ai" && m.recommendation)
    if (!lastAiMsg?.recommendation) return null
    const r = lastAiMsg.recommendation
    const primary = r.primaryProduct
    if (!primary) return "매칭 없음"
    return `${primary.product.displayCode} (${r.status}) - 점수: ${primary.score}`
  }

  const handleSubmit = async () => {
    if (!comment.trim() && rating === 0) return
    setSending(true)
    try {
      const chatHistory = messages.map(m => ({
        role: m.role,
        text: m.text.slice(0, 500),
      }))

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorType,
          authorName,
          sessionId: sessionState?.sessionId ?? null,
          intakeSummary: buildIntakeSummary(),
          chatHistory,
          recommendationSummary: buildRecSummary(),
          rating: rating > 0 ? rating : null,
          comment,
          tags,
        }),
      })

      setSent(true)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setComment("")
        setRating(0)
        setTags([])
      }, 1500)
    } catch {
      alert("피드백 저장에 실패했습니다.")
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all hover:scale-105"
      >
        <MessageCircle size={16} />
        <span className="text-sm font-medium">{language === 'ko' ? '의견 남기기' : 'Leave Feedback'}</span>
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b">
              <h3 className="font-bold text-gray-900">{language === 'ko' ? '의견 남기기' : 'Leave Feedback'}</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {sent ? (
              <div className="p-8 text-center">
                <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
                <div className="text-lg font-bold text-gray-900">{language === 'ko' ? '감사합니다!' : 'Thank you!'}</div>
                <div className="text-sm text-gray-500 mt-1">{language === 'ko' ? '소중한 의견이 저장되었습니다' : 'Your feedback has been saved'}</div>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Author type */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === 'ko' ? '작성자 유형' : 'Author Type'}</label>
                  <div className="flex gap-2">
                    {authorTypeOptions.map(([val, label]) => (
                      <button
                        key={val}
                        onClick={() => setAuthorType(val)}
                        className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                          authorType === val
                            ? "bg-blue-50 border-blue-300 text-blue-700"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Author name */}
                {authorType !== "anonymous" && (
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === 'ko' ? '이름 (선택)' : 'Name (optional)'}</label>
                    <input
                      type="text"
                      value={authorName}
                      onChange={e => setAuthorName(e.target.value)}
                      placeholder={language === 'ko' ? "이름을 입력하세요" : "Enter your name"}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                )}

                {/* Rating */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === 'ko' ? '평점' : 'Rating'}</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <button key={i} onClick={() => setRating(i)} className="p-0.5">
                        <Star
                          size={24}
                          className={`transition-colors ${
                            i <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300 hover:text-yellow-300"
                          }`}
                        />
                      </button>
                    ))}
                    {rating > 0 && (
                      <button onClick={() => setRating(0)} className="ml-2 text-xs text-gray-400 hover:text-gray-600">{language === 'ko' ? '초기화' : 'Clear'}</button>
                    )}
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === 'ko' ? '태그 (선택)' : 'Tags (optional)'}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {FEEDBACK_TAGS.map(t => (
                      <button
                        key={t.value}
                        onClick={() => toggleTag(t.value)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          tags.includes(t.value)
                            ? "bg-blue-100 border-blue-300 text-blue-700"
                            : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {t[language]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comment */}
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1.5 block">{language === 'ko' ? '의견' : 'Comment'}</label>
                  <textarea
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder={language === 'ko' ? "추천 결과에 대한 의견을 남겨주세요. 잘못된 점, 개선사항 등 자유롭게 작성해주세요." : "Leave feedback on the recommendation. Feel free to share issues, improvements, or suggestions."}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </div>

                {/* Context info */}
                <div className="text-[10px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  {language === 'ko' ? '현재 세션 정보가 자동으로 첨부됩니다 (입력 조건, 대화 내역, 추천 결과)' : 'Session info will be automatically attached (conditions, chat history, recommendation result)'}
                </div>

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={sending || (!comment.trim() && rating === 0)}
                  className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? (language === 'ko' ? "저장 중..." : "Saving...") : (language === 'ko' ? "의견 제출" : "Submit Feedback")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════

export default function ProductRecommendPage() {
  const searchParams = useSearchParams()
  const { language } = useApp()
  const resetKey = searchParams.get("reset")

  const [phase, setPhase] = useState<Phase>("intake")
  const [form, setForm] = useState<ProductIntakeForm>(INITIAL_INTAKE_FORM)
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [isChatSending, setIsChatSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<ExplorationSessionState | null>(null)
  const [candidateSnapshot, setCandidateSnapshot] = useState<CandidateSnapshot[] | null>(null)

  // Reset all state when ?reset param changes (e.g. clicking "제품 탐색" again)
  useEffect(() => {
    if (resetKey) {
      setForm(INITIAL_INTAKE_FORM)
      setChatMessages([])
      setIsChatSending(false)
      setError(null)
      setSessionState(null)
      setCandidateSnapshot(null)
      setPhase("intake")
    }
  }, [resetKey])

  const handleFieldChange = (key: keyof ProductIntakeForm, val: AnswerState<string>) => {
    setForm(f => ({ ...f, [key]: val }))
  }

  const runRecommendation = async () => {
    setPhase("loading")
    setError(null)
    try {
      const intakeText = buildIntakePromptText(form, language)

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intakeForm: form, messages: [], sessionState: null }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.detail ?? data.error)

      // Store session state and candidates
      setSessionState(data.sessionState ?? null)
      setCandidateSnapshot(data.candidateSnapshot ?? null)

      // Seed chat
      setChatMessages([
        { role: "user", text: intakeText },
        {
          role: "ai",
          text: data.text ?? "",
          chips: data.chips ?? [],
          recommendation: data.recommendation ?? null,
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
        },
      ])
      setPhase("explore")
    } catch (err) {
      setError(err instanceof Error ? err.message : "알 수 없는 오류")
      setPhase("summary")
    }
  }

  const handleChatSend = async (text: string) => {
    if (isChatSending) return

    setChatMessages(prev => [
      ...prev,
      { role: "user", text },
      { role: "ai", text: "", isLoading: true },
    ])
    setIsChatSending(true)

    try {
      const history = chatMessages.map(m => ({ role: m.role, text: m.text }))
      history.push({ role: "user", text })

      // 현재 표시된 추천 제품 목록을 같이 전송 → LLM이 후속 질문에 활용
      const displayedProducts = candidateSnapshot?.slice(0, 10).map(c => ({
        rank: c.rank,
        code: c.displayCode,
        brand: c.brand,
        series: c.seriesName,
        diameter: c.diameterMm,
        flute: c.fluteCount,
        coating: c.coating,
        materialTags: c.materialTags,
        score: c.score,
        matchStatus: c.matchStatus,
      })) ?? null

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intakeForm: form,
          messages: history,
          sessionState,
          displayedProducts,
        }),
      })
      const data = await res.json()

      // Update session state and candidates
      if (data.sessionState) setSessionState(data.sessionState)
      if (data.candidateSnapshot) setCandidateSnapshot(data.candidateSnapshot)

      setChatMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "ai",
          text: data.text ?? "",
          recommendation: data.recommendation ?? null,
          chips: data.chips ?? [],
          evidenceSummaries: data.evidenceSummaries ?? null,
          requestPreparation: data.requestPreparation ?? null,
          primaryExplanation: data.primaryExplanation ?? null,
          primaryFactChecked: data.primaryFactChecked ?? null,
          altExplanations: data.altExplanations ?? [],
          isLoading: false,
        }
        return updated
      })
    } catch {
      setChatMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "ai",
          text: "오류가 발생했습니다. 다시 시도해주세요.",
          isLoading: false,
        }
        return updated
      })
    } finally {
      setIsChatSending(false)
    }
  }

  const handleReset = () => {
    setForm(INITIAL_INTAKE_FORM)
    setChatMessages([])
    setIsChatSending(false)
    setError(null)
    setSessionState(null)
    setCandidateSnapshot(null)
    setPhase("intake")
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Feedback widget — always visible */}
      <FeedbackWidget form={form} messages={chatMessages} sessionState={sessionState} />

      {/* Top header — hidden in explore phase */}
      {phase !== "explore" && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b bg-white max-w-2xl mx-auto w-full">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">{localizeIntakeText("YG-1 제품 탐색", language)}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                phase === "intake" ? "bg-blue-100 text-blue-700"
                : phase === "summary" ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-600"
              }`}>
                {phase === "intake"
                  ? localizeIntakeText("조건 입력", language)
                  : phase === "summary"
                    ? localizeIntakeText("조건 확인", language)
                    : localizeIntakeText("검색 중", language)}
              </span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200">
          <AlertCircle size={13} className="text-red-500" />
          <span className="text-xs text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-red-500">닫기</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {phase === "intake" && (
          <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <IntakeGate form={form} onChange={handleFieldChange} onNext={() => setPhase("summary")} />
          </div>
        )}
        {phase === "summary" && (
          <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col min-h-0">
            <IntakeSummaryScreen form={form} onEdit={() => setPhase("intake")} onStart={runRecommendation} />
          </div>
        )}
        {phase === "loading" && <LoadingScreen />}
        {phase === "explore" && (
          <ExplorationScreen
            form={form}
            messages={chatMessages}
            isSending={isChatSending}
            sessionState={sessionState}
            candidateSnapshot={candidateSnapshot}
            onSend={handleChatSend}
            onReset={handleReset}
            onEdit={() => setPhase("intake")}
          />
        )}
      </div>
    </div>
  )
}
