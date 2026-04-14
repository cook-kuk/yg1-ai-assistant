/**
 * Planner Decision Layer
 *
 * production filters와 planner filters를 비교하여
 * confidence 기반으로 어느 쪽을 사용할지 결정.
 *
 * 제한: 단일 constraint만 대상. multi-constraint / range 제외.
 */

import type { QuerySpec, QueryConstraint } from "./query-spec"
import type { AppliedFilter } from "@/lib/types/exploration"
import {
  PLANNER_DECISION,
  PLANNER_PROD_SCORE,
  PLANNER_SCORE,
} from "@/lib/recommendation/infrastructure/config/planner-config"

// ── Types ───────────────────────────────────────────────────

export interface DecisionScore {
  score: number
  factors: string[]
}

export interface PlannerDecision {
  winner: "production" | "planner" | "skip"
  productionScore: DecisionScore
  plannerScore: DecisionScore
  margin: number
  reason: string
}

// ── Safe Fields / Ops ───────────────────────────────────────

const HIGH_CONFIDENCE_FIELDS = new Set([
  "shankType", "brand", "seriesName",
])

const MEDIUM_CONFIDENCE_FIELDS = new Set([
  "toolSubtype", "coating", "workpiece",
])

// Phase 2: gte/lte/between은 이제 지원. in/not_in만 excluded.
const EXCLUDED_OPS = new Set(["in", "not_in"])

// ── Score Constants ─────────────────────────────────────────

const MARGIN = PLANNER_DECISION.margin

// ── Production Score ────────────────────────────────────────

export function scoreProduction(
  productionFilters: AppliedFilter[],
  kgHit: boolean,
  sqlAgentHit: boolean,
  plannerSpec?: QuerySpec,
): DecisionScore {
  const factors: string[] = []
  let score = 0

  if (kgHit) {
    score += PLANNER_PROD_SCORE.kgHit
    factors.push(`kg-hit(+${PLANNER_PROD_SCORE.kgHit})`)
  } else if (sqlAgentHit) {
    score += PLANNER_PROD_SCORE.sqlAgentHit
    factors.push(`sql-agent-hit(+${PLANNER_PROD_SCORE.sqlAgentHit})`)
  } else if (productionFilters.length > 0) {
    score += PLANNER_PROD_SCORE.fallbackFilters
    factors.push(`fallback-filters(+${PLANNER_PROD_SCORE.fallbackFilters})`)
  } else {
    score += PLANNER_PROD_SCORE.noProduction
    factors.push(`no-production-result(+${PLANNER_PROD_SCORE.noProduction})`)
  }

  // Semantic loss penalty: production이 eq로 뭉갠 경우 감점
  if (plannerSpec && plannerSpec.constraints.length === 1) {
    const plannerOp = plannerSpec.constraints[0].op
    const isRichOp = plannerOp === "gte" || plannerOp === "lte" || plannerOp === "between"
    if (isRichOp && productionFilters.some(f => f.field === FIELD_REVERSE_MAP[plannerSpec.constraints[0].field] && f.op === "eq")) {
      score -= PLANNER_PROD_SCORE.semanticLossPenalty
      factors.push(`semantic-loss-penalty(-${PLANNER_PROD_SCORE.semanticLossPenalty})`)
    }
  }

  return { score, factors }
}

// QueryField → filter field reverse lookup for penalty check
const FIELD_REVERSE_MAP: Record<string, string> = {
  diameterMm: "diameterMm",
  fluteCount: "fluteCount",
  workpiece: "workPieceName",
  toolSubtype: "toolSubtype",
  coating: "coating",
  brand: "brand",
}

// ── Planner Score ───────────────────────────────────────────

export function scorePlanner(
  spec: QuerySpec,
  shadowFilters: AppliedFilter[],
): DecisionScore {
  const factors: string[] = []
  let score = 0

  // No constraints → navigation or question → low score for filter override
  if (spec.constraints.length === 0) {
    if (spec.navigation !== "none") {
      score += PLANNER_SCORE.navigation
      factors.push(`navigation-${spec.navigation}(+${PLANNER_SCORE.navigation})`)
    } else {
      score += PLANNER_SCORE.noConstraints
      factors.push(`no-constraints(+${PLANNER_SCORE.noConstraints})`)
    }
    return { score, factors }
  }

  // Multi-constraint → not eligible
  if (spec.constraints.length > 1) {
    score += PLANNER_SCORE.multiConstraint
    factors.push(`multi-constraint(+${PLANNER_SCORE.multiConstraint}, ineligible)`)
    return { score, factors }
  }

  // Single constraint scoring
  const c = spec.constraints[0]

  // Excluded ops
  if (EXCLUDED_OPS.has(c.op)) {
    score += PLANNER_SCORE.excludedOp
    factors.push(`excluded-op:${c.op}(+${PLANNER_SCORE.excludedOp})`)
    return { score, factors }
  }

  // Field confidence
  if (HIGH_CONFIDENCE_FIELDS.has(c.field)) {
    score += PLANNER_SCORE.highConfidenceField
    factors.push(`high-confidence-field:${c.field}(+${PLANNER_SCORE.highConfidenceField})`)
  } else if (MEDIUM_CONFIDENCE_FIELDS.has(c.field)) {
    score += PLANNER_SCORE.mediumConfidenceField
    factors.push(`medium-confidence-field:${c.field}(+${PLANNER_SCORE.mediumConfidenceField})`)
  } else {
    score += PLANNER_SCORE.standardField
    factors.push(`standard-field:${c.field}(+${PLANNER_SCORE.standardField})`)
  }

  // Op-specific bonuses (Phase 2)
  if (c.op === "neq") {
    score += PLANNER_SCORE.neqBonus
    factors.push(`neq-bonus(+${PLANNER_SCORE.neqBonus})`)
  } else if (c.op === "gte" || c.op === "lte") {
    score += PLANNER_SCORE.rangeBonus
    factors.push(`range-${c.op}-bonus(+${PLANNER_SCORE.rangeBonus})`)
  } else if (c.op === "between") {
    score += PLANNER_SCORE.betweenBonus
    factors.push(`between-bonus(+${PLANNER_SCORE.betweenBonus})`)
  }

  // Bridge-safe: filter was successfully built
  if (shadowFilters.length > 0) {
    score += PLANNER_SCORE.bridgeOk
    factors.push(`bridge-ok(+${PLANNER_SCORE.bridgeOk})`)
  }

  return { score, factors }
}

// ── Decision ────────────────────────────────────────────────

export function decidePlannerOverride(
  spec: QuerySpec,
  shadowFilters: AppliedFilter[],
  productionFilters: AppliedFilter[],
  kgHit: boolean,
  sqlAgentHit: boolean,
): PlannerDecision {
  const productionScore = scoreProduction(productionFilters, kgHit, sqlAgentHit, spec)
  const plannerScore = scorePlanner(spec, shadowFilters)
  const margin = plannerScore.score - productionScore.score

  // Skip: planner produced nothing useful
  if (spec.constraints.length === 0 && spec.navigation === "none") {
    return {
      winner: "skip",
      productionScore,
      plannerScore,
      margin,
      reason: "planner empty",
    }
  }

  // Hard block: multi-constraint → never override (Phase 2)
  if (spec.constraints.length > 1) {
    return {
      winner: "production",
      productionScore,
      plannerScore,
      margin,
      reason: "multi-constraint blocked",
    }
  }

  // Hard block: excluded ops (range) → never override
  if (spec.constraints.length === 1 && EXCLUDED_OPS.has(spec.constraints[0].op)) {
    return {
      winner: "production",
      productionScore,
      plannerScore,
      margin,
      reason: `excluded op: ${spec.constraints[0].op}`,
    }
  }

  // Planner wins: must exceed production by MARGIN
  if (margin > MARGIN) {
    return {
      winner: "planner",
      productionScore,
      plannerScore,
      margin,
      reason: `planner wins by ${margin.toFixed(2)} (threshold=${MARGIN})`,
    }
  }

  // Production wins (or tie → production)
  return {
    winner: "production",
    productionScore,
    plannerScore,
    margin,
    reason: margin >= 0
      ? `tie/margin too small (${margin.toFixed(2)} < ${MARGIN})`
      : `production wins by ${(-margin).toFixed(2)}`,
  }
}
