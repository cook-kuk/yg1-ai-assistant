/**
 * Phase F.2 — Adapter: ScoreBreakdown -> RankingTrace
 *
 * The ranking pipeline currently emits a ScoreBreakdown per ScoredProduct but
 * does NOT emit the structured RankingTrace that explanation-builder now
 * understands. This small adapter bridges the two so "왜 이걸 추천했어?"
 * answers are grounded in concrete contributions rather than the narrative
 * fallback.
 *
 * Data-driven: the contribution mapping is expressed as a single
 * `SCORE_FIELD_MAP` table keyed by the ScoreBreakdown sub-score field names.
 * No hardcoded contribution labels anywhere else.
 */
import type { ScoreBreakdown } from "@/lib/types/canonical"
import type { AppliedFilter } from "@/lib/types/exploration"
import type {
  RankingContribution,
  RankingContributionSource,
  RankingTrace,
  RankingTraceConstraint,
} from "@/lib/recommendation/domain/ranking-trace"

/** Maps each nested sub-score field on ScoreBreakdown to a contribution. */
const SCORE_FIELD_MAP: Record<
  string,
  { source: RankingContributionSource; label: string }
> = {
  diameter:     { source: "filter_match",   label: "직경 일치" },
  flutes:       { source: "filter_match",   label: "날 수 일치" },
  materialTag:  { source: "workpiece_match", label: "소재군 적합" },
  operation:    { source: "filter_match",   label: "가공 방식 일치" },
  toolShape:    { source: "filter_match",   label: "공구 형상 일치" },
  coating:      { source: "filter_match",   label: "코팅 일치" },
  completeness: { source: "other",          label: "데이터 완전성" },
  evidence:     { source: "similarity",     label: "절삭조건 근거" },
}

/**
 * Build a RankingTrace from a ScoreBreakdown. Zero-weight sub-scores are
 * dropped. Contributions are sorted by |weight| descending so the most
 * influential one leads the rendered rationale.
 */
export function buildTraceFromScoreBreakdown(
  productId: string,
  breakdown: ScoreBreakdown,
  rank: number,
  appliedFilters: readonly AppliedFilter[] = [],
): RankingTrace {
  const contributions: RankingContribution[] = []

  for (const [field, meta] of Object.entries(SCORE_FIELD_MAP)) {
    const cell = (breakdown as unknown as Record<string, { score: number; max: number; detail: string }>)[field]
    if (!cell || typeof cell.score !== "number" || cell.score === 0) continue
    contributions.push({
      source: meta.source,
      label: meta.label,
      weight: cell.score,
      value: cell.detail && cell.detail.length > 0 ? cell.detail : undefined,
    })
  }

  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  const matchedConstraints: RankingTraceConstraint[] = appliedFilters.map(f => ({
    field: f.field,
    value: f.value,
  }))

  return {
    productId,
    finalScore: breakdown.total,
    rank,
    contributions,
    matchedConstraints,
  }
}
