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
  return [
    candidate.diameterMm != null ? `φ${candidate.diameterMm}mm` : null,
    candidate.fluteCount != null ? `${candidate.fluteCount}날` : null,
    candidate.coating ?? null,
  ].filter((value): value is string => Boolean(value))
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
