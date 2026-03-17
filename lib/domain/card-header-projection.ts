/**
 * Card Header Projection — scan-friendly product card header builder.
 *
 * Takes a CandidateSnapshot and produces a compact, readable header
 * suitable for quick scanning in recommendation results.
 *
 * Example output:
 *   GEE8302016
 *   ALU-CUT for Korean Market | E5E83
 *   φ2mm · 3날 · Bright Finish · Carbide · Shank 4mm · CL 6mm · OAL 60mm · 45°
 *   [근사 후보] [재고 미확인] [절삭조건 20건] [매칭률 82%]
 */

import type { CandidateSnapshot } from "@/lib/types/exploration"

export interface CardHeaderProjection {
  productCode: string
  brandSeries: string
  specLine: string
  statusTags: string[]
}

export function buildCardHeader(snap: CandidateSnapshot): CardHeaderProjection {
  // Brand & series line
  const brandParts: string[] = []
  if (snap.brand) brandParts.push(snap.brand)
  if (snap.seriesName) brandParts.push(snap.seriesName)
  const brandSeries = brandParts.join(" | ") || "—"

  // Spec line — concatenate non-null fields with · separator
  const specs: string[] = []
  if (snap.diameterMm != null) specs.push(`φ${snap.diameterMm}mm`)
  if (snap.fluteCount != null) specs.push(`${snap.fluteCount}날`)
  if (snap.coating) specs.push(snap.coating)
  if (snap.toolMaterial) specs.push(snap.toolMaterial)
  if (snap.shankDiameterMm != null) specs.push(`Shank ${snap.shankDiameterMm}mm`)
  if (snap.lengthOfCutMm != null) specs.push(`CL ${snap.lengthOfCutMm}mm`)
  if (snap.overallLengthMm != null) specs.push(`OAL ${snap.overallLengthMm}mm`)
  if (snap.helixAngleDeg != null) specs.push(`${snap.helixAngleDeg}°`)
  const specLine = specs.join(" · ") || "—"

  // Status tags
  const statusTags: string[] = []
  if (snap.matchStatus === "approximate") statusTags.push("근사 후보")
  if (snap.matchStatus === "exact") statusTags.push("정확 매칭")
  if (snap.stockStatus === "unknown" || snap.totalStock == null) {
    statusTags.push("재고 미확인")
  } else if (snap.totalStock <= 0) {
    statusTags.push("재고 없음")
  } else {
    statusTags.push(`재고 ${snap.totalStock}개`)
  }
  if (snap.hasEvidence && snap.bestCondition) {
    statusTags.push("절삭조건 있음")
  }
  if (snap.score > 0) {
    const pct = Math.round((snap.score / 110) * 100)
    statusTags.push(`매칭률 ${pct}%`)
  }

  return {
    productCode: snap.displayCode,
    brandSeries,
    specLine,
    statusTags,
  }
}
