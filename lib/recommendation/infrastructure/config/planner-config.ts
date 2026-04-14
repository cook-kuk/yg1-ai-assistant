/**
 * Planner & Pattern-Mining Configuration (SSOT)
 *
 * planner-decision(scoreProduction/scorePlanner) + pattern-mining/candidate-miner.
 * ENV 변수로 오버라이드 가능 → 코드 변경 없이 A/B 테스트.
 *
 * ENV naming convention:
 *   PLANNER_*          — production/planner 경쟁 점수 & margin
 *   PATTERN_MINING_*   — KG 승격 후보 채굴 임계값
 */

function envNum(name: string, defaultValue: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const n = Number(raw)
  return Number.isFinite(n) ? n : defaultValue
}

// ── Planner vs Production Decision ──────────────────────────
export const PLANNER_DECISION = {
  /** Planner가 production을 이기려면 넘어야 할 최소 margin. */
  margin: envNum("PLANNER_MARGIN", 0.15),
} as const

/** Production path 별 기본 confidence 점수. */
export const PLANNER_PROD_SCORE = {
  kgHit:            envNum("PLANNER_PROD_SCORE_KG", 0.9),
  sqlAgentHit:      envNum("PLANNER_PROD_SCORE_SQL_AGENT", 0.7),
  fallbackFilters:  envNum("PLANNER_PROD_SCORE_FALLBACK", 0.5),
  noProduction:     envNum("PLANNER_PROD_SCORE_NONE", 0.1),
  /** planner가 rich op(gte/lte/between)인데 production이 eq로 뭉갠 경우 감점. */
  semanticLossPenalty: envNum("PLANNER_PROD_SCORE_SEMANTIC_LOSS_PENALTY", 0.2),
} as const

/** Planner path 별 점수. */
export const PLANNER_SCORE = {
  navigation:         envNum("PLANNER_SCORE_NAVIGATION", 0.85),
  noConstraints:      envNum("PLANNER_SCORE_NO_CONSTRAINTS", 0.1),
  multiConstraint:    envNum("PLANNER_SCORE_MULTI_CONSTRAINT", 0.3),
  excludedOp:         envNum("PLANNER_SCORE_EXCLUDED_OP", 0.2),
  highConfidenceField:   envNum("PLANNER_SCORE_HIGH_CONFIDENCE", 0.85),
  mediumConfidenceField: envNum("PLANNER_SCORE_MEDIUM_CONFIDENCE", 0.7),
  standardField:         envNum("PLANNER_SCORE_STANDARD_FIELD", 0.5),
  neqBonus:           envNum("PLANNER_SCORE_NEQ_BONUS", 0.1),
  rangeBonus:         envNum("PLANNER_SCORE_RANGE_BONUS", 0.15),
  betweenBonus:       envNum("PLANNER_SCORE_BETWEEN_BONUS", 0.2),
  bridgeOk:           envNum("PLANNER_SCORE_BRIDGE_OK", 0.05),
} as const

// ── Pattern Mining (Candidate Miner) ────────────────────────
export const PATTERN_MINING_CONFIG = {
  /** 후보 생성에 필요한 최소 지지 수. */
  minSupportCount: envNum("PATTERN_MINING_MIN_SUPPORT", 3),
  /** 동일 field+op+value로 해석된 비율 최소치. */
  minConsistency:  envNum("PATTERN_MINING_MIN_CONSISTENCY", 0.8),
} as const
