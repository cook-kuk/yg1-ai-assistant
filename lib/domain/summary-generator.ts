/**
 * Safe Summary Generator
 * Generates deterministic summaries from real data — no hallucination.
 * LLM summary is optional and layered on top.
 */

import type { RecommendationResult, ScoredProduct, RecommendationInput } from "@/lib/types/canonical"
import { getMaterialDisplay } from "@/lib/domain/material-resolver"
import { getOperationLabel } from "@/lib/domain/operation-resolver"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"

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
  const { status, query, primaryProduct, alternatives, warnings } = result

  if (status === "none") {
    const parts = ["현재 샘플 데이터에서 조건에 맞는 제품을 찾지 못했습니다."]
    if (query.diameterMm) parts.push(`(검색 직경: ${formatDiameter(query.diameterMm)})`)
    if (alternatives.length > 0) {
      parts.push(`유사 후보 ${alternatives.length}건이 있습니다. 조건을 조정해보세요.`)
    }
    return parts.join(" ")
  }

  if (!primaryProduct) return "추천 결과가 없습니다."

  const p = primaryProduct.product
  const parts: string[] = []

  // Match quality statement
  if (status === "exact") {
    parts.push(`✓ 정확 매칭: ${p.displayCode}`)
  } else {
    parts.push(`⚠ 근사 후보: ${p.displayCode} (일부 조건 불일치)`)
  }

  // Product basics
  const specs: string[] = []
  if (p.diameterMm !== null) specs.push(formatDiameter(p.diameterMm))
  if (p.fluteCount !== null) specs.push(`${p.fluteCount}날`)
  if (p.coating) specs.push(`코팅: ${p.coating}`)
  if (p.toolMaterial) specs.push(p.toolMaterial)
  if (specs.length) parts.push(specs.join(", "))

  // Brand & Series info
  const brandSeries = [p.brand, p.seriesName].filter(Boolean).join(" / ")
  if (brandSeries) parts.push(`시리즈: ${brandSeries}`)

  // Material compatibility
  if (p.materialTags.length > 0) {
    const tagLabels = p.materialTags.map(t => {
      const d = getMaterialDisplay(t)
      return `${t}군(${d.ko})`
    })
    parts.push(`적용 소재: ${tagLabels.join(", ")}`)
  }

  // Matched fields
  if (primaryProduct.matchedFields.length > 0) {
    parts.push(`매칭 근거: ${primaryProduct.matchedFields.join(" / ")}`)
  }

  // Inventory + lead time
  parts.push(formatStock(primaryProduct.stockStatus, primaryProduct.totalStock))
  parts.push(formatLeadTime(primaryProduct.minLeadTimeDays))

  // Alternatives count
  if (alternatives.length > 0) {
    parts.push(`대체 후보 ${alternatives.length}건 있음`)
  }

  // Warnings
  if (warnings.length) {
    parts.push(`⚠ 주의: ${warnings.join(", ")}`)
  }

  return parts.join(" | ")
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
