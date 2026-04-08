export interface CandidateHighlightInput {
  ballRadiusMm?: number | null
  coating?: string | null
  diameterMm?: number | null
  fluteCount?: number | null
  helixAngleDeg?: number | null
  lengthOfCutMm?: number | null
  overallLengthMm?: number | null
  shankDiameterMm?: number | null
  taperAngleDeg?: number | null
  toolMaterial?: string | null
  toolSubtype?: string | null
}

function formatBadgeValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "")
}

export function buildCandidateDetailBadges(
  candidate: CandidateHighlightInput,
  language: "ko" | "en"
): CandidateHighlightBadge[] {
  const badges: CandidateHighlightBadge[] = []

  const subtype = buildCandidateSubtypeHighlight(candidate, language)
  if (subtype) badges.push(subtype)

  const coating = candidate.coating?.trim()
  if (coating) {
    badges.push({
      label: language === "ko" ? "코팅" : "Coating",
      value: coating,
    })
  }

  if (candidate.fluteCount != null) {
    badges.push({
      label: language === "ko" ? "날수" : "Flutes",
      value: `${candidate.fluteCount}`,
    })
  }

  if (candidate.ballRadiusMm != null) {
    badges.push({
      label: "R",
      value: formatBadgeValue(candidate.ballRadiusMm),
    })
  }

  if (candidate.taperAngleDeg != null) {
    badges.push({
      label: language === "ko" ? "테이퍼" : "Taper",
      value: `${candidate.taperAngleDeg}°`,
    })
  }

  return badges
}

export interface CandidateHighlightBadge {
  label: string
  value: string
}

export function buildCandidateSubtypeHighlight(
  candidate: CandidateHighlightInput,
  language: "ko" | "en"
): CandidateHighlightBadge | null {
  const toolSubtype = candidate.toolSubtype?.trim()
  if (!toolSubtype) return null

  return {
    label: language === "ko" ? "형상" : "Subtype",
    value: toolSubtype,
  }
}

export function buildCandidateSpecFallback(candidate: CandidateHighlightInput): string[] {
  // 날 형상(toolSubtype)이 있으면 최우선 표시
  if (candidate.toolSubtype?.trim()) {
    return [candidate.toolSubtype.trim()]
  }
  // toolSubtype 없으면 빈 배열 (φ/날수/코팅 fallback 제거)
  return []
}


export function buildSubtypeFirstSummary(candidate: CandidateHighlightInput, language: "ko" | "en"): string[] {
  // 설일석 피드백(2026-04-07): 가공깊이 구분용 "날장(flute length)"을 카드 헤더에 노출.
  // CL → 날장 으로 라벨 변경하고 형상 바로 다음에 배치한다.
  return [
    candidate.toolSubtype ? `${language === "ko" ? "형상" : "Subtype"} ${candidate.toolSubtype}` : null,
    candidate.lengthOfCutMm != null ? `${language === "ko" ? "날장" : "LOC"} ${candidate.lengthOfCutMm}mm` : null,
    candidate.toolMaterial ?? null,
    candidate.shankDiameterMm != null ? `Shank ${candidate.shankDiameterMm}mm` : null,
    candidate.overallLengthMm != null ? `OAL ${candidate.overallLengthMm}mm` : null,
    candidate.helixAngleDeg != null ? `${candidate.helixAngleDeg}°` : null,
  ].filter((value): value is string => Boolean(value))
}
