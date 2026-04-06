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

const EXCLUDED_OPS = new Set(["between", "gte", "lte", "in", "not_in"])

// ── Score Constants ─────────────────────────────────────────

const MARGIN = 0.15  // planner must beat production by this margin

// ── Production Score ────────────────────────────────────────

export function scoreProduction(
  productionFilters: AppliedFilter[],
  kgHit: boolean,
  sqlAgentHit: boolean,
): DecisionScore {
  const factors: string[] = []
  let score = 0

  if (kgHit) {
    score += 0.9
    factors.push("kg-hit(+0.9)")
  } else if (sqlAgentHit) {
    score += 0.7
    factors.push("sql-agent-hit(+0.7)")
  } else if (productionFilters.length > 0) {
    score += 0.5
    factors.push("fallback-filters(+0.5)")
  } else {
    score += 0.1
    factors.push("no-production-result(+0.1)")
  }

  return { score, factors }
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
      score += 0.85
      factors.push(`navigation-${spec.navigation}(+0.85)`)
    } else {
      score += 0.1
      factors.push("no-constraints(+0.1)")
    }
    return { score, factors }
  }

  // Multi-constraint → not eligible
  if (spec.constraints.length > 1) {
    score += 0.3
    factors.push("multi-constraint(+0.3, ineligible)")
    return { score, factors }
  }

  // Single constraint scoring
  const c = spec.constraints[0]

  // Excluded ops
  if (EXCLUDED_OPS.has(c.op)) {
    score += 0.2
    factors.push(`excluded-op:${c.op}(+0.2)`)
    return { score, factors }
  }

  // Field confidence
  if (HIGH_CONFIDENCE_FIELDS.has(c.field)) {
    score += 0.85
    factors.push(`high-confidence-field:${c.field}(+0.85)`)
  } else if (MEDIUM_CONFIDENCE_FIELDS.has(c.field)) {
    score += 0.7
    factors.push(`medium-confidence-field:${c.field}(+0.7)`)
  } else {
    score += 0.5
    factors.push(`standard-field:${c.field}(+0.5)`)
  }

  // neq bonus: planner neq parsing is verified 100% accurate
  if (c.op === "neq") {
    score += 0.1
    factors.push("neq-bonus(+0.1)")
  }

  // Bridge-safe: filter was successfully built
  if (shadowFilters.length > 0) {
    score += 0.05
    factors.push("bridge-ok(+0.05)")
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
  const productionScore = scoreProduction(productionFilters, kgHit, sqlAgentHit)
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
