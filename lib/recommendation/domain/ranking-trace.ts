/**
 * Phase F — RankingTrace
 *
 * Structured per-candidate trace of why a product was ranked where it was.
 * The explanation-builder consumes this (when present) to produce a
 * "왜 이걸 추천했어?" answer grounded in concrete contributions instead of
 * narrative hand-waving.
 *
 * Emission is OPTIONAL — the ranking pipeline (hybrid-retrieval.ts) may
 * populate a parallel `traces: RankingTrace[]` array alongside its scored
 * candidates. When absent, explanation-builder falls back to its existing
 * narrative construction from ScoreBreakdown.
 *
 * Kept in a dedicated file so the ranking pipeline can import the type
 * without pulling in the whole domain/types.ts surface.
 */

export type RankingContributionSource =
  | "filter_match"
  | "similarity"
  | "stock_boost"
  | "workpiece_match"
  | "feedback"
  | "other"

export interface RankingContribution {
  source: RankingContributionSource
  /** Human-readable label, e.g. "직경 10mm 일치" */
  label: string
  /** Signed weight. Positive = boosted the rank, negative = penalized. */
  weight: number
  /** Optional matched value string (e.g. "10mm", "TiAlN"). */
  value?: string
}

export interface RankingTraceConstraint {
  field: string
  value: string
}

export interface RankingTrace {
  productId: string
  finalScore: number
  rank: number
  contributions: RankingContribution[]
  matchedConstraints: RankingTraceConstraint[]
}
