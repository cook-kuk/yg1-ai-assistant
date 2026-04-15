/**
 * Scoring & Capacity Configuration (SSOT)
 *
 * 모든 스코어링 가중치·보부/감산·다양성·capacity 파라미터를 한 곳에서 관리.
 * ENV 변수로 오버라이드 가능 → 코드 변경 없이 A/B 테스트.
 *
 * ENV naming convention:
 *   SCORING_WEIGHT_*        — 매칭 가중치
 *   SCORING_*_BOOST / DEMOTE — 브랜드 기반 가중
 *   DIVERSITY_*             — 다양성 리랭커 파라미터
 *   CAPACITY_*              — enrichment 상한 (OOM 방지)
 */

function envNum(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

// ── Matching Weights ────────────────────────────────────────
export const SCORING_WEIGHTS = {
  diameter:     envNum("SCORING_WEIGHT_DIAMETER", 40),
  flutes:       envNum("SCORING_WEIGHT_FLUTES", 15),
  materialTag:  envNum("SCORING_WEIGHT_MATERIAL_TAG", 20),
  operation:    envNum("SCORING_WEIGHT_OPERATION", 15),
  toolShape:    envNum("SCORING_WEIGHT_TOOL_SHAPE", 15),
  coating:      envNum("SCORING_WEIGHT_COATING", 5),
  completeness: envNum("SCORING_WEIGHT_COMPLETENESS", 5),
  evidence:     envNum("SCORING_WEIGHT_EVIDENCE", 10),
} as const

// ── Brand Boost / Demote ────────────────────────────────────
export const BRAND_SCORING = {
  /** 대표 시리즈 1차 boost (pre-cut, pure-neq 쿼리에서 대중 라인 우선). */
  flagshipBoostPrimary:   envNum("SCORING_FLAGSHIP_BOOST_PRIMARY", 100),
  /** 대표 시리즈 2차 boost (evidence 단계). 1차(100)보다 작은 값 — 미세 조정용. */
  flagshipBoostSecondary: envNum("SCORING_FLAGSHIP_BOOST_SECONDARY", 5),
  /** 마이크로 시리즈 감산. */
  microBrandDemote:       envNum("SCORING_MICRO_BRAND_DEMOTE", 200),
  /** 소경(<= threshold mm) 감산. */
  microDiaDemote:         envNum("SCORING_MICRO_DIA_DEMOTE", 80),
  /** 소경 기준 (이하이면 demote). */
  microDiaThreshold:      envNum("SCORING_MICRO_DIA_THRESHOLD", 5),
} as const

// ── Brand × WorkPiece Affinity Boost ────────────────────────
// 소스: public.brand_material_affinity (연구소 정의 매트릭스).
// 같은 `materialRating` 티어 안에서 전용 브랜드(예: ALU-CUT × Aluminum)를
// 범용 브랜드(예: DREAM DRILLS-INOX × Aluminum 미등록)보다 위로 올려준다.
// 하드코딩 0 — 새 브랜드 등록/제거는 DB INSERT/DELETE 만으로 반영.
export const BRAND_MATERIAL_AFFINITY = {
  /** rating_score 에 곱해 boost 계산. workpiece(0~100) * factor. */
  boostFactor:          envNum("BRAND_AFFINITY_BOOST_FACTOR", 0.5),
  /** boost 상한 — outlier 제어 및 다른 스코어와의 균형. */
  boostMax:             envNum("BRAND_AFFINITY_BOOST_MAX", 60),
  /** iso_group kind 는 0~1 스케일이라 별도 multiplier. 0 이면 iso_group 미사용. */
  isoGroupMultiplier:   envNum("BRAND_AFFINITY_ISO_GROUP_MULTIPLIER", 20),
} as const

// ── Diversity ───────────────────────────────────────────────
export const DIVERSITY_CONFIG = {
  /** Top-N 윈도우 내 시리즈당 최대 후보 수. */
  maxPerSeriesInTop:  envNum("DIVERSITY_MAX_PER_SERIES", 2),
  /** 다양성 적용 윈도우 크기. */
  topDiversityWindow: envNum("DIVERSITY_WINDOW", 5),
} as const

// ── Capacity Limits ─────────────────────────────────────────
export const CAPACITY_LIMITS = {
  /** 재고 필터 enrichment 상한 (OOM 방지). */
  stockFilterEnrichCap: envNum("CAPACITY_STOCK_ENRICH_CAP", 2000),
  /** evidence/inventory enrich 상한. 200이면 display N=50 + 여유. */
  scoreEvidenceHardCap: envNum("CAPACITY_SCORE_EVIDENCE_CAP", 200),
} as const
