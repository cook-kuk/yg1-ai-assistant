export interface CandidateHighlightInput {
  coating?: string | null
  diameterMm?: number | null
  fluteCount?: number | null
  helixAngleDeg?: number | null
  lengthOfCutMm?: number | null
  overallLengthMm?: number | null
  shankDiameterMm?: number | null
  toolMaterial?: string | null
  toolSubtype?: string | null
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
  return [
    candidate.toolSubtype ? `${language === "ko" ? "? ??" : "Subtype"} ${candidate.toolSubtype}` : null,
    candidate.toolMaterial ?? null,
    candidate.shankDiameterMm != null ? `Shank ${candidate.shankDiameterMm}mm` : null,
    candidate.lengthOfCutMm != null ? `CL ${candidate.lengthOfCutMm}mm` : null,
    candidate.overallLengthMm != null ? `OAL ${candidate.overallLengthMm}mm` : null,
    candidate.helixAngleDeg != null ? `${candidate.helixAngleDeg}?` : null,
  ].filter((value): value is string => Boolean(value))
}
