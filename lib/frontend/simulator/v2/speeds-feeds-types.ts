// YG-1 ARIA Simulator v3 — STEP 4
// Tool # 입력 시 재질/op별 SFM·IPT baseline을 자동 로드하기 위한 SSOT 타입.
// Harvey MAP 식 파이프라인: JSON seed → /api/simulator/speeds-feeds → UI.

/**
 * 하나의 공구(toolId)에 대한 baseline 번들.
 *
 * - `toolId`: YG-1/Harvey 등 벤더의 EDP/카탈로그 번호 (예: "942332")
 * - `seriesId`: 상위 시리즈 (예: "942300") — family 매칭용
 * - `cutterDiameter`: mm (inch 카탈로그도 mm로 정규화)
 * - `entries`: 재질 × operation × coating 조합별 conditions
 * - `eduSummary`: Education mode 용 공구 요약 (왜/언제/언제아님)
 */
export interface ToolSpeedsFeedsEntry {
  toolId: string
  seriesId: string
  coating: "UN" | "AlTiN" | "AlCrN" | "DLC" | "TiB2" | "Diamond" | string
  cutterDiameter: number // mm
  flutes: number
  entries: SpeedsFeedsRow[]
  eduSummary: {
    whyThisTool: string
    typicalUse: string
    avoidUse: string
  }
}

/**
 * 단일 cutting condition row.
 *
 * - `materialGroup`: ISO 6대 그룹 (P/M/K/N/S/H)
 * - `materialSubgroup`: presets.ts MATERIAL_SUBGROUPS.key 와 매칭 가능
 * - `operation`: slotting / roughing / finishing / max (Harvey "Max" 열 대응)
 * - `sfm`: surface feet per minute (Harvey PDF 원본 단위)
 * - `vcMetric`: m/min (= sfm × 0.3048)
 * - `iptInch`: inch per tooth (Harvey 원본)
 * - `fzMetric`: mm/tooth (= iptInch × 25.4)
 * - `adocRatio` / `rdocRatio`: 문자열로 "0.5xD", "1-2xD" 등 원본 표기 보존
 * - `source`: 출처 등급 — pdf_verified(검증) > pdf_partial(부분) > estimated(추정)
 * - `confidence`: 1(매우낮음)~5(매우높음)
 * - `sourceRef`: PDF URL 또는 "⚠ placeholder" 마킹
 */
export interface SpeedsFeedsRow {
  materialGroup: "P" | "M" | "K" | "N" | "S" | "H"
  materialSubgroup: string
  condition?: string
  operation: "slotting" | "roughing" | "finishing" | "max"
  sfm: number
  vcMetric: number
  iptInch: number
  fzMetric: number
  adocRatio: string
  rdocRatio: string
  source: "pdf_verified" | "pdf_partial" | "estimated"
  sourceRef?: string
  confidence: 1 | 2 | 3 | 4 | 5
  eduNote?: string
}

/**
 * API 응답 (GET /api/simulator/speeds-feeds).
 * verbose=true 일 때 matchPath / eduSummary 포함.
 */
export interface SpeedsFeedsLookupResponse {
  matched: boolean
  row: SpeedsFeedsRow | null
  source: string
  confidence: number
  /** 매칭 추적 로그 — verbose=true 일 때 채움 */
  matchPath?: string[]
  /** 공구 교육 요약 — verbose=true 일 때 채움 */
  eduSummary?: ToolSpeedsFeedsEntry["eduSummary"]
  /** 디버깅/추적용 메타 */
  meta?: {
    toolId: string
    materialSubgroup?: string | null
    materialGroup?: string | null
    operation?: string | null
    coating?: string | null
  }
}
