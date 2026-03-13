/**
 * Recommendation Explanation Builder
 *
 * Builds structured explanations from ScoredProduct + evidence data.
 * Every fact comes from canonical data — never generated.
 *
 * Output: RecommendationExplanation per product
 */

import type { ScoredProduct, RecommendationInput, ScoreBreakdown } from "@/lib/types/canonical"
import type { EvidenceSummary } from "@/lib/types/evidence"
import type {
  RecommendationExplanation,
  MatchedFact,
  UnmatchedFact,
  SupportingEvidence,
} from "@/lib/types/explanation"
import { resolveMaterialTag, getMaterialDisplay } from "@/lib/domain/material-resolver"

// ── Main Entry ──────────────────────────────────────────────

export function buildExplanation(
  scored: ScoredProduct,
  input: RecommendationInput,
  evidenceSummary: EvidenceSummary | null
): RecommendationExplanation {
  const p = scored.product
  const breakdown = scored.scoreBreakdown

  const matchedFacts = buildMatchedFacts(scored, input, breakdown)
  const unmatchedFacts = buildUnmatchedFacts(scored, input, breakdown)
  const supportingEvidence = buildSupportingEvidence(scored, evidenceSummary)
  const warnings = buildExplanationWarnings(scored, input, evidenceSummary)
  const summaryText = buildExplanationSummary(matchedFacts, unmatchedFacts, supportingEvidence, scored)

  return {
    productCode: p.normalizedCode,
    displayCode: p.displayCode,
    matchPct: breakdown?.matchPct ?? 0,
    matchStatus: scored.matchStatus,
    matchedFacts,
    unmatchedFacts,
    supportingEvidence,
    warnings,
    summaryText,
  }
}

// ── Matched Facts ───────────────────────────────────────────

function buildMatchedFacts(
  scored: ScoredProduct,
  input: RecommendationInput,
  breakdown: ScoreBreakdown | null
): MatchedFact[] {
  const facts: MatchedFact[] = []
  const p = scored.product

  if (!breakdown) return facts

  // Diameter
  if (input.diameterMm && p.diameterMm !== null) {
    const diff = Math.abs(p.diameterMm - input.diameterMm)
    if (diff <= 2) {
      facts.push({
        field: "diameter",
        label: "직경",
        requestedValue: `${input.diameterMm}mm`,
        productValue: `${p.diameterMm}mm`,
        matchType: diff === 0 ? "exact" : diff <= 0.5 ? "close" : "partial",
        score: breakdown.diameter.score,
        maxScore: breakdown.diameter.max,
      })
    }
  }

  // Material tag
  if (input.material) {
    const tag = resolveMaterialTag(input.material)
    if (tag && p.materialTags.includes(tag)) {
      const display = getMaterialDisplay(tag)
      facts.push({
        field: "materialTag",
        label: "소재군",
        requestedValue: `${input.material} (${tag}군)`,
        productValue: `${tag}군 (${display.ko})`,
        matchType: "exact",
        score: breakdown.materialTag.score,
        maxScore: breakdown.materialTag.max,
      })
    }
  }

  // Flute count
  if (input.flutePreference && p.fluteCount === input.flutePreference) {
    facts.push({
      field: "fluteCount",
      label: "날 수",
      requestedValue: `${input.flutePreference}날`,
      productValue: `${p.fluteCount}날`,
      matchType: "exact",
      score: breakdown.flutes.score,
      maxScore: breakdown.flutes.max,
    })
  }

  // Coating
  if (input.coatingPreference && p.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase())) {
    facts.push({
      field: "coating",
      label: "코팅",
      requestedValue: input.coatingPreference,
      productValue: p.coating!,
      matchType: "exact",
      score: breakdown.coating.score,
      maxScore: breakdown.coating.max,
    })
  }

  // Operation
  if (breakdown.operation.score > 0 && input.operationType) {
    facts.push({
      field: "operation",
      label: "가공 방식",
      requestedValue: input.operationType,
      productValue: p.applicationShapes.join(", ") || "정보 없음",
      matchType: breakdown.operation.score === breakdown.operation.max ? "exact" : "partial",
      score: breakdown.operation.score,
      maxScore: breakdown.operation.max,
    })
  }

  return facts
}

// ── Unmatched Facts ─────────────────────────────────────────

function buildUnmatchedFacts(
  scored: ScoredProduct,
  input: RecommendationInput,
  breakdown: ScoreBreakdown | null
): UnmatchedFact[] {
  const facts: UnmatchedFact[] = []
  const p = scored.product

  if (!breakdown) return facts

  // Diameter mismatch
  if (input.diameterMm && p.diameterMm !== null) {
    const diff = Math.abs(p.diameterMm - input.diameterMm)
    if (diff > 2) {
      facts.push({
        field: "diameter",
        label: "직경",
        requestedValue: `${input.diameterMm}mm`,
        productValue: `${p.diameterMm}mm`,
        reason: `요청 직경과 ${diff.toFixed(1)}mm 차이 (허용 범위 초과)`,
        impact: "critical",
      })
    }
  } else if (input.diameterMm && p.diameterMm === null) {
    facts.push({
      field: "diameter",
      label: "직경",
      requestedValue: `${input.diameterMm}mm`,
      productValue: null,
      reason: "제품 직경 정보 없음",
      impact: "moderate",
    })
  }

  // Material mismatch
  if (input.material) {
    const tag = resolveMaterialTag(input.material)
    if (tag && !p.materialTags.includes(tag)) {
      facts.push({
        field: "materialTag",
        label: "소재군",
        requestedValue: `${input.material} (${tag}군)`,
        productValue: p.materialTags.length > 0 ? p.materialTags.join(", ") + "군" : null,
        reason: `${tag}군 소재에 대한 적합성 미확인`,
        impact: "critical",
      })
    }
  }

  // Flute count mismatch
  if (input.flutePreference && p.fluteCount !== null && p.fluteCount !== input.flutePreference) {
    facts.push({
      field: "fluteCount",
      label: "날 수",
      requestedValue: `${input.flutePreference}날`,
      productValue: `${p.fluteCount}날`,
      reason: `요청 ${input.flutePreference}날 vs 제품 ${p.fluteCount}날`,
      impact: "moderate",
    })
  }

  // Coating mismatch
  if (input.coatingPreference && p.coating && !p.coating.toLowerCase().includes(input.coatingPreference.toLowerCase())) {
    facts.push({
      field: "coating",
      label: "코팅",
      requestedValue: input.coatingPreference,
      productValue: p.coating,
      reason: `요청 코팅 (${input.coatingPreference})과 제품 코팅 (${p.coating}) 불일치`,
      impact: "minor",
    })
  }

  return facts
}

// ── Supporting Evidence ─────────────────────────────────────

function buildSupportingEvidence(
  scored: ScoredProduct,
  evidenceSummary: EvidenceSummary | null
): SupportingEvidence[] {
  const evidence: SupportingEvidence[] = []

  // Catalog spec evidence
  evidence.push({
    type: "catalog_spec",
    summary: `${scored.product.rawSourceFile} 카탈로그 데이터 (신뢰도: ${scored.product.sourceConfidence ?? "unknown"})`,
    conditions: null,
    confidence: scored.product.dataCompletenessScore,
    source: scored.product.rawSourceFile,
    sourceCount: 1,
  })

  // Cutting condition evidence
  if (evidenceSummary && evidenceSummary.chunks.length > 0) {
    evidence.push({
      type: "cutting_condition",
      summary: `절삭조건 ${evidenceSummary.sourceCount}건 (신뢰도: ${Math.round(evidenceSummary.bestConfidence * 100)}%)`,
      conditions: evidenceSummary.bestCondition,
      confidence: evidenceSummary.bestConfidence,
      source: evidenceSummary.chunks[0]?.sourceFile ?? "unknown",
      sourceCount: evidenceSummary.sourceCount,
    })
  }

  // Inventory evidence
  if (scored.inventory.length > 0) {
    evidence.push({
      type: "inventory",
      summary: `재고 정보 ${scored.inventory.length}건 (${scored.stockStatus})`,
      conditions: null,
      confidence: 1.0,
      source: "inventory-db",
      sourceCount: scored.inventory.length,
    })
  }

  // Lead time evidence
  if (scored.leadTimes.length > 0) {
    const minLT = scored.minLeadTimeDays
    evidence.push({
      type: "lead_time",
      summary: `납기 정보 ${scored.leadTimes.length}건 (최소 ${minLT ?? "?"}일)`,
      conditions: null,
      confidence: 1.0,
      source: "lead-time-db",
      sourceCount: scored.leadTimes.length,
    })
  }

  return evidence
}

// ── Warnings ────────────────────────────────────────────────

function buildExplanationWarnings(
  scored: ScoredProduct,
  input: RecommendationInput,
  evidenceSummary: EvidenceSummary | null
): string[] {
  const warnings: string[] = []

  if (scored.matchStatus === "approximate") {
    warnings.push("정확 일치 없음 — 근사 후보입니다")
  }
  if (scored.product.dataCompletenessScore < 0.5) {
    warnings.push("제품 데이터 불완전 (일부 스펙 누락)")
  }
  if (scored.stockStatus === "outofstock") {
    warnings.push("현재 재고 없음")
  }
  if (scored.stockStatus === "unknown") {
    warnings.push("재고 정보 확인 불가")
  }
  if (!evidenceSummary || evidenceSummary.chunks.length === 0) {
    warnings.push("절삭조건 데이터 없음 — 카탈로그에서 별도 확인 필요")
  }
  if (evidenceSummary && evidenceSummary.bestConfidence < 0.7) {
    warnings.push(`절삭조건 신뢰도 낮음 (${Math.round(evidenceSummary.bestConfidence * 100)}%)`)
  }
  if (!input.material) {
    warnings.push("소재 미지정 — 소재 적합성 미확인")
  }

  return warnings
}

// ── Summary Text ────────────────────────────────────────────

function buildExplanationSummary(
  matched: MatchedFact[],
  unmatched: UnmatchedFact[],
  evidence: SupportingEvidence[],
  scored: ScoredProduct
): string {
  const parts: string[] = []

  // Match summary
  const matchCount = matched.length
  const unmatchCount = unmatched.filter(f => f.impact === "critical").length

  if (matchCount > 0) {
    const matchLabels = matched.map(f => f.label).join(", ")
    parts.push(`${matchLabels} 일치 (${matchCount}개 조건)`)
  }
  if (unmatchCount > 0) {
    const unmatchLabels = unmatched.filter(f => f.impact === "critical").map(f => f.label).join(", ")
    parts.push(`${unmatchLabels} 불일치 (${unmatchCount}개 주의)`)
  }

  // Evidence summary
  const cuttingEvidence = evidence.find(e => e.type === "cutting_condition")
  if (cuttingEvidence) {
    parts.push(`절삭조건 ${cuttingEvidence.sourceCount}건 보유`)
  }

  // Score
  parts.push(`매칭률 ${scored.scoreBreakdown?.matchPct ?? 0}%`)

  return parts.join(" | ")
}
