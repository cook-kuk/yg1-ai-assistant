/**
 * Search Adapter — bridges V2 orchestrator types to legacy hybrid-retrieval engine.
 *
 * Converts ConstraintState → RecommendationInput + AppliedFilter[],
 * and ScoredProduct[] → ResultContext for the V2 session state.
 */

import type {
  RecommendationSessionState,
  ResultContext,
  CandidateRef,
  LlmTurnDecision,
} from "./types"
import type {
  AppliedFilter,
  RecommendationInput,
  ScoredProduct,
} from "../domain/types"

// ── Convert V2 constraints → legacy filters for hybrid-retrieval ──

export function constraintsToFilters(state: RecommendationSessionState): {
  input: RecommendationInput
  filters: AppliedFilter[]
} {
  const input: RecommendationInput = {
    manufacturerScope: "yg1-only",
    locale: "ko",
  }
  const filters: AppliedFilter[] = []

  const { base, refinements } = state.constraints

  // Map base constraints to RecommendationInput fields
  if (base.material) input.material = String(base.material)
  if (base.diameter) input.diameterMm = Number(base.diameter)
  if (base.operation) input.operationType = String(base.operation)
  if (base.toolType) input.toolType = String(base.toolType)
  if (base.toolSubtype) input.toolSubtype = String(base.toolSubtype)
  if (base.seriesName) input.seriesName = String(base.seriesName)
  if (base.brand) input.brand = String(base.brand)
  if (base.country) input.country = String(base.country)

  // Map refinements to AppliedFilter[]
  if (refinements.flute != null) {
    filters.push({
      field: "fluteCount",
      op: "eq",
      value: `${refinements.flute}`,
      rawValue: Number(refinements.flute),
      appliedAt: 0,
    })
  }
  if (refinements.coating != null) {
    filters.push({
      field: "coating",
      op: "includes",
      value: String(refinements.coating),
      rawValue: String(refinements.coating),
      appliedAt: 0,
    })
  }
  if (refinements.toolMaterial != null) {
    filters.push({
      field: "toolMaterial",
      op: "includes",
      value: String(refinements.toolMaterial),
      rawValue: String(refinements.toolMaterial),
      appliedAt: 0,
    })
  }
  if (refinements.coolantHole != null) {
    filters.push({
      field: "coolantHole",
      op: "eq",
      value: String(refinements.coolantHole),
      rawValue: refinements.coolantHole,
      appliedAt: 0,
    })
  }

  return { input, filters }
}

// ── Convert ScoredProduct → CandidateRef ──

export function scoredProductToCandidateRef(
  product: ScoredProduct,
  rank: number
): CandidateRef {
  return {
    productCode: product.product.normalizedCode,
    displayCode: product.product.displayCode,
    rank,
    score: product.score,
    seriesName: product.product.seriesName,
    keySpecs: {
      flute: product.product.fluteCount ?? null,
      coating: product.product.coating ?? null,
      hasInventory: product.stockStatus === "in_stock",
    },
  }
}

// ── Build ResultContext from search results ──

export function buildResultContext(
  candidates: ScoredProduct[],
  state: RecommendationSessionState
): ResultContext {
  return {
    candidates: candidates.map((c, i) => scoredProductToCandidateRef(c, i + 1)),
    totalConsidered: candidates.length,
    searchTimestamp: Date.now(),
    constraintsUsed: { ...state.constraints },
  }
}

// ── Determine if search is needed based on LLM decision ──

const SEARCH_TRIGGERING_ACTIONS = new Set([
  "set_base_constraint",
  "replace_base_constraint",
  "apply_refinement",
  "show_top3",
  "refine_current_results",
  "show_recommendation",
  "replace_slot",
  "continue_narrowing",
])

export function shouldSearch(decision: LlmTurnDecision): boolean {
  if (decision.answerIntent.needsGroundedFact) return true
  return SEARCH_TRIGGERING_ACTIONS.has(decision.actionInterpretation.type)
}
