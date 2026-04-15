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
import { buildAppliedFilterFromValue } from "../shared/filter-field-registry"

const BASE_TO_LEGACY_FIELD: Record<string, string> = {
  material: "material",
  materialDetail: "workPieceName",
  diameter: "diameterMm",
  operation: "cuttingType",
  machiningCategory: "machiningCategory",
  toolType: "toolType",
  toolSubtype: "toolSubtype",
  endType: "toolSubtype",
  seriesName: "seriesName",
  brand: "brand",
  country: "country",
}

const REFINEMENT_TO_LEGACY_FIELD: Record<string, string> = {
  flute: "fluteCount",
  coating: "coating",
  toolMaterial: "toolMaterial",
  coolantHole: "coolantHole",
  helixAngle: "helixAngleDeg",
  helixAngleDeg: "helixAngleDeg",
  lengthOfCut: "lengthOfCutMm",
  lengthOfCutMm: "lengthOfCutMm",
  overallLength: "overallLengthMm",
  overallLengthMm: "overallLengthMm",
  shankDiameter: "shankDiameterMm",
  shankDiameterMm: "shankDiameterMm",
  ballRadius: "ballRadiusMm",
  ballRadiusMm: "ballRadiusMm",
  taperAngle: "taperAngleDeg",
  taperAngleDeg: "taperAngleDeg",
  brand: "brand",
  seriesName: "seriesName",
  toolSubtype: "toolSubtype",
  country: "country",
}

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
  if (base.materialDetail) input.workPieceName = String(base.materialDetail)
  if (base.diameter) input.diameterMm = Number(base.diameter)
  if (base.operation) input.operationType = String(base.operation)
  if (base.machiningCategory) input.machiningCategory = String(base.machiningCategory)
  if (base.toolType) input.toolType = String(base.toolType)
  if (base.toolSubtype || base.endType) input.toolSubtype = String(base.toolSubtype ?? base.endType)
  if (base.seriesName) input.seriesName = String(base.seriesName)
  if (base.brand) input.brand = String(base.brand)
  if (base.country) input.country = String(base.country)

  // Base constraints that do not have dedicated DB/input handling still become filters.
  for (const [key, value] of Object.entries(base)) {
    if (value == null) continue
    const legacyField = BASE_TO_LEGACY_FIELD[key]
    if (!legacyField) continue
    // TODO: 이 배열 하드코딩 → BASE_TO_LEGACY_FIELD.values() 자동 파생으로 전환
    if (["material", "workPieceName", "diameterMm", "cuttingType", "machiningCategory", "toolType", "toolSubtype", "seriesName", "country"].includes(legacyField)) {
      continue
    }
    const filter = buildAppliedFilterFromValue(legacyField, value)
    if (filter) filters.push(filter)
  }

  for (const [key, value] of Object.entries(refinements)) {
    if (value == null) continue
    const legacyField = REFINEMENT_TO_LEGACY_FIELD[key] ?? key
    const filter = buildAppliedFilterFromValue(legacyField, value)
    if (filter) filters.push(filter)
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
      hasInventory: product.stockStatus === "instock",
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
