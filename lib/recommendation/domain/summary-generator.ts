/**
 * Safe Summary Generator
 * Generates deterministic summaries from real data — no hallucination.
 * LLM summary is optional and layered on top.
 */

import type { RecommendationResult, ScoredProduct, RecommendationInput } from "@/lib/recommendation/domain/types"

function formatDiameter(mm: number | null): string {
  if (mm === null) return "직경 미정"
  return `φ${mm}mm`
}

function formatStock(status: string, total: number | null): string {
  if (status === "instock") return total !== null ? `재고 ${total}개 (즉시 출하)` : "재고 있음"
  if (status === "limited") return total !== null ? `재고 ${total}개 (소량)` : "소량 재고"
  if (status === "outofstock") return "재고 없음"
  return "재고 정보 없음"
}

function formatLeadTime(days: number | null): string {
  if (days === null) return "납기 정보 없음"
  if (days === 0) return "즉시 출하"
  return `표준 납기 ${days}일`
}

/** Build a deterministic, data-only summary (no LLM, no hallucination) */
export function buildDeterministicSummary(result: RecommendationResult): string {
  const { status, query, primaryProduct, alternatives, warnings, totalCandidatesConsidered } = result

  if (status === "none") {
    const hasCandidatePool = totalCandidatesConsidered > 0 || !!primaryProduct || alternatives.length > 0
    if (hasCandidatePool) {
      return query.diameterMm
        ? `조건에 완전히 맞는 제품은 없지만, ${formatDiameter(query.diameterMm)} 기준으로 검토해볼 만한 유사 후보 ${totalCandidatesConsidered}개는 찾았습니다. 현재 후보를 보시거나 직경·소재 조건을 조금만 넓혀보시면 됩니다.`
        : `조건에 완전히 맞는 제품은 없지만, 검토해볼 만한 유사 후보 ${totalCandidatesConsidered}개는 찾았습니다. 현재 후보를 보시거나 조건을 조금만 넓혀보시면 됩니다.`
    }
    return "현재 조건으로는 맞는 제품을 찾지 못했습니다. 직경이나 소재 조건을 조금 조정해서 다시 보시면 좋겠습니다."
  }

  if (!primaryProduct) return "추천 결과가 없습니다."

  const p = primaryProduct.product
  const leadingReasonParts: string[] = []
  if (p.toolSubtype) leadingReasonParts.push(`${p.toolSubtype} 형상`)
  if (p.fluteCount !== null) leadingReasonParts.push(`${p.fluteCount}날`)
  if (p.diameterMm !== null) leadingReasonParts.push(formatDiameter(p.diameterMm))

  const firstSentence = status === "exact"
    ? `이 조건이면 ${p.displayCode}${p.seriesName ? ` (${p.seriesName})` : ""}를 먼저 보시면 됩니다.`
    : `가장 가까운 후보로는 ${p.displayCode}${p.seriesName ? ` (${p.seriesName})` : ""}를 먼저 검토해보시면 됩니다.`

  const secondSentence = leadingReasonParts.length > 0
    ? `${leadingReasonParts.join(", ")} 기준에 잘 맞고${p.coating ? `, 코팅은 ${p.coating}` : ""}${p.materialTags.length > 0 ? `으로 ${p.materialTags.map(t => `${t}군`).join(", ")} 소재 대응 범위를 확인할 수 있습니다` : " 선택 기준을 무난하게 충족합니다"}.`
    : p.coating
      ? `코팅은 ${p.coating} 기준으로 확인되며, 현재 조건에 맞는 우선 후보입니다.`
      : "현재 조건에 맞는 우선 후보입니다."

  const tailParts: string[] = []
  const stockText = formatStock(primaryProduct.stockStatus, primaryProduct.totalStock)
  const leadTimeText = formatLeadTime(primaryProduct.minLeadTimeDays)
  if (stockText !== "재고 정보 없음" || leadTimeText !== "납기 정보 없음") {
    tailParts.push([stockText, leadTimeText].filter(text => text !== "재고 정보 없음" && text !== "납기 정보 없음").join(", "))
  }
  if (warnings.length > 0) {
    tailParts.push(warnings[0])
  } else if (alternatives.length > 0) {
    tailParts.push(`비슷한 대안은 ${alternatives.length}개 더 있습니다`)
  }

  const tailSentence = tailParts.length > 0
    ? `${tailParts.join(". ")}.`
    : ""

  return [firstSentence, secondSentence, tailSentence].filter(Boolean).join(" ").trim()
}

/** Build rationale list from matched fields and data */
export function buildRationale(primary: ScoredProduct, input: RecommendationInput): string[] {
  const rationale: string[] = []
  const p = primary.product

  // Source
  rationale.push(
    `출처: ${p.rawSourceFile}${p.rawSourceSheet ? ` / ${p.rawSourceSheet}` : ""} (신뢰도: ${p.sourceConfidence ?? "unknown"})`
  )

  // Matched fields
  for (const f of primary.matchedFields) {
    rationale.push(f)
  }

  // Data completeness
  rationale.push(`데이터 완성도: ${Math.round(p.dataCompletenessScore * 100)}%`)

  // What we didn't find
  if (!input.diameterMm && p.diameterMm !== null) {
    rationale.push(`직경 미지정 → 기본값 사용 (φ${p.diameterMm}mm)`)
  }
  if (!input.material) {
    rationale.push("소재 미지정 → 전체 소재 대상 검색")
  }

  return rationale
}

/** Build warnings list */
export function buildWarnings(
  primary: ScoredProduct | null,
  input: RecommendationInput
): string[] {
  const warnings: string[] = []

  if (!primary) return ["조건에 맞는 제품 없음"]

  if (primary.matchStatus === "approximate") {
    warnings.push("정확 일치 없음 — 근사 후보 표시 중")
  }
  if (primary.product.dataCompletenessScore < 0.5) {
    warnings.push("제품 데이터 불완전 (일부 스펙 누락)")
  }
  if (primary.stockStatus === "outofstock") {
    warnings.push("현재 재고 없음")
  }
  if (primary.stockStatus === "unknown") {
    warnings.push("재고 정보 없음")
  }
  if (primary.minLeadTimeDays === null) {
    warnings.push("납기 정보 없음")
  }
  if (!input.material) {
    warnings.push("소재 미지정 — 전체 소재 검색 결과")
  }
  if (!input.operationType) {
    warnings.push("가공 방식 미지정 — 전체 가공 유형 검색 결과")
  }

  return warnings
}
