export interface CandidateHighlightInput {
  ballRadiusMm?: number | null
  coating?: string | null
  coolantHole?: boolean | null
  diameterMm?: number | null
  fluteCount?: number | null
  helixAngleDeg?: number | null
  lengthOfCutMm?: number | null
  overallLengthMm?: number | null
  pointAngleDeg?: number | null
  shankDiameterMm?: number | null
  shankType?: string | null
  taperAngleDeg?: number | null
  threadPitchMm?: number | null
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

  const shankType = candidate.shankType?.trim()
  if (shankType) {
    badges.push({
      label: language === "ko" ? "생크" : "Shank",
      value: shankType,
    })
  }

  const toolMaterial = candidate.toolMaterial?.trim()
  if (toolMaterial) {
    badges.push({
      label: language === "ko" ? "소재" : "Material",
      value: toolMaterial,
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

  if (candidate.helixAngleDeg != null) {
    badges.push({
      label: language === "ko" ? "헬릭스" : "Helix",
      value: `${candidate.helixAngleDeg}°`,
    })
  }

  // 드릴 전용: 포인트 각도
  if (candidate.pointAngleDeg != null) {
    badges.push({
      label: language === "ko" ? "포인트각" : "Point",
      value: `${candidate.pointAngleDeg}°`,
    })
  }

  // 탭 전용: 나사 피치
  if (candidate.threadPitchMm != null) {
    badges.push({
      label: language === "ko" ? "피치" : "Pitch",
      value: `${formatBadgeValue(candidate.threadPitchMm)}mm`,
    })
  }

  // 쿨런트홀: true 일 때만 (false/null 은 숨김)
  if (candidate.coolantHole === true) {
    badges.push({
      label: language === "ko" ? "쿨런트홀" : "Coolant",
      value: language === "ko" ? "있음" : "Yes",
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
