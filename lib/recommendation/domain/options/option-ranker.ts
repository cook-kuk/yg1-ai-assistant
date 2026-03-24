/**
 * Option Ranker — Family-specific ranking with weighted signals.
 *
 * Each family uses its own signal set and weights.
 * Weights are easy to adjust. No ML. No telemetry dependency.
 */

import type { SmartOption, NarrowingSignals, RepairSignals, ActionSignals } from "./types"

// ════════════════════════════════════════════════════════════════
// WEIGHTS (easy to adjust)
// ════════════════════════════════════════════════════════════════

const NARROWING_WEIGHTS = {
  infoGain: 0.40,
  answerability: 0.20,
  feasibility: 0.15,
  continuity: 0.15,
  businessValue: 0.10,
}

const REPAIR_WEIGHTS = {
  projectedSuccess: 0.35,
  minimalChange: 0.25,
  contextPreservation: 0.20,
  inventoryReadiness: 0.10,
  clarity: 0.10,
  destructivePenalty: -0.20,
}

const ACTION_WEIGHTS = {
  intentFit: 0.30,
  expectedUtility: 0.25,
  explainability: 0.20,
  continuity: 0.15,
  novelty: 0.10,
}

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════

export interface RankerContext {
  candidateCount: number
  filterCount: number
  hasRecommendation: boolean
  userMessage?: string
  /** Context interpretation for smarter scoring */
  contextInterpretation?: import("../context/context-types").ContextInterpretation
  /** Which UI block the user is likely reacting to — boosts relevant options */
  likelyReferencedUIBlock?: import("../context/ui-context-extractor").UIArtifactKind
}

export function rankOptions(options: SmartOption[], ctx: RankerContext): SmartOption[] {
  for (const option of options) {
    switch (option.family) {
      case "narrowing":
        option.priorityScore = scoreNarrowing(option, ctx)
        break
      case "repair":
        option.priorityScore = scoreRepair(option, ctx)
        break
      case "action":
      case "explore":
      case "compare":
        option.priorityScore = scoreAction(option, ctx)
        break
      case "reset":
        option.priorityScore = scoreReset(option, ctx)
        break
    }
  }

  // Sort within families first, then mark the best as recommended
  options.sort((a, b) => b.priorityScore - a.priorityScore)

  // Mark the top non-destructive option as recommended
  const topNonDestructive = options.find(o => !o.destructive)
  if (topNonDestructive) {
    topNonDestructive.recommended = true
  }

  return options
}

// ════════════════════════════════════════════════════════════════
// NARROWING SCORING
// ════════════════════════════════════════════════════════════════

function scoreNarrowing(option: SmartOption, ctx: RankerContext): number {
  const signals = computeNarrowingSignals(option, ctx)
  return (
    NARROWING_WEIGHTS.infoGain * signals.infoGain +
    NARROWING_WEIGHTS.answerability * signals.answerability +
    NARROWING_WEIGHTS.feasibility * signals.feasibility +
    NARROWING_WEIGHTS.continuity * signals.continuity +
    NARROWING_WEIGHTS.businessValue * signals.businessValue
  )
}

function computeNarrowingSignals(option: SmartOption, ctx: RankerContext): NarrowingSignals {
  const projected = option.projectedCount ?? ctx.candidateCount
  const delta = option.projectedDelta ?? 0
  const total = ctx.candidateCount || 1

  // Info gain: how much does this reduce the candidate set?
  // Best: reduces to ~30-50% of current set
  const reductionRatio = projected / total
  const infoGain = reductionRatio <= 0 ? 0
    : reductionRatio <= 0.1 ? 0.5  // too aggressive
    : reductionRatio <= 0.5 ? 1.0  // ideal range
    : reductionRatio <= 0.8 ? 0.6  // modest reduction
    : 0.2                          // barely reduces

  // Answerability: is this a concrete, easy-to-answer option?
  const isSkip = option.value === "skip"
  const answerability = isSkip ? 0.3 : 0.8

  // Feasibility: will this produce reasonable results?
  const feasibility = projected > 0 ? Math.min(1.0, projected / 3) : 0

  // Continuity: does this preserve the current path?
  const continuity = option.preservesContext ? 0.9 : 0.3

  // Business value: weighted by field importance
  const fieldWeights: Record<string, number> = {
    fluteCount: 0.7, coating: 0.8, seriesName: 0.6,
    toolSubtype: 0.9, diameterMm: 1.0, cuttingType: 0.5,
  }
  const businessValue = fieldWeights[option.field ?? ""] ?? 0.5

  return { infoGain, answerability, feasibility, continuity, businessValue }
}

// ════════════════════════════════════════════════════════════════
// REPAIR SCORING
// ════════════════════════════════════════════════════════════════

function scoreRepair(option: SmartOption, ctx: RankerContext): number {
  const signals = computeRepairSignals(option, ctx)
  return (
    REPAIR_WEIGHTS.projectedSuccess * signals.projectedSuccess +
    REPAIR_WEIGHTS.minimalChange * signals.minimalChange +
    REPAIR_WEIGHTS.contextPreservation * signals.contextPreservation +
    REPAIR_WEIGHTS.inventoryReadiness * signals.inventoryReadiness +
    REPAIR_WEIGHTS.clarity * signals.clarity +
    REPAIR_WEIGHTS.destructivePenalty * signals.destructivePenalty
  )
}

function computeRepairSignals(option: SmartOption, ctx: RankerContext): RepairSignals {
  const projected = option.projectedCount
  const patchCount = option.plan.patches.length

  // Projected success: will this option produce results?
  const projectedSuccess = projected == null ? 0.3
    : projected === 0 ? 0.1
    : projected <= 3 ? 0.7
    : projected <= 10 ? 0.9
    : 0.8

  // Minimal change: fewer patches = more minimal
  const minimalChange = patchCount <= 1 ? 1.0
    : patchCount === 2 ? 0.7
    : patchCount === 3 ? 0.4
    : 0.2

  // Context preservation: does this keep existing artifacts?
  const contextPreservation = option.preservesContext ? 0.9 : 0.1

  // Inventory readiness: default signal (could be enriched later)
  const inventoryReadiness = 0.5

  // Clarity: is the label self-explanatory?
  const clarity = option.subtitle ? 0.8 : 0.6

  // Destructive penalty
  const destructivePenalty = option.destructive ? 1.0 : 0.0

  return { projectedSuccess, minimalChange, contextPreservation, inventoryReadiness, clarity, destructivePenalty }
}

// ════════════════════════════════════════════════════════════════
// ACTION / EXPLORE SCORING
// ════════════════════════════════════════════════════════════════

function scoreAction(option: SmartOption, ctx: RankerContext): number {
  const signals = computeActionSignals(option, ctx)
  return (
    ACTION_WEIGHTS.intentFit * signals.intentFit +
    ACTION_WEIGHTS.expectedUtility * signals.expectedUtility +
    ACTION_WEIGHTS.explainability * signals.explainability +
    ACTION_WEIGHTS.continuity * signals.continuity +
    ACTION_WEIGHTS.novelty * signals.novelty
  )
}

function computeActionSignals(option: SmartOption, ctx: RankerContext): ActionSignals {
  const plan = option.plan
  const actionValue = plan.patches.find(p => p.field === "_action")?.value
  const interp = ctx.contextInterpretation

  // Intent fit: how well does this match what users typically want next?
  let intentFit = 0.5
  if (actionValue) {
    const baseMap: Record<string, number> = {
      compare: 0.9,
      cutting_conditions: 0.85,
      explain_recommendation: 0.7,
      undo: 0.5,
    }
    intentFit = baseMap[actionValue] ?? 0.5
  }

  // Boost intent fit based on context interpretation
  if (interp) {
    if (interp.intentShift === "compare_products" && (option.family === "compare" || plan.type === "compare_products")) {
      intentFit = Math.min(1.0, intentFit + 0.2)
    }
    if (interp.intentShift === "explain_recommendation" && (plan.type === "explain_recommendation" || actionValue === "explain_recommendation")) {
      intentFit = Math.min(1.0, intentFit + 0.2)
    }
    if (interp.intentShift === "refine_existing" && option.field === interp.referencedField) {
      intentFit = Math.min(1.0, intentFit + 0.15)
    }
    // Revision boost: when user wants to revise or regenerate, boost undo/revision options
    if ((interp.shouldShowRevisionOptions || interp.shouldRegenerateOptions) && plan.type === "replace_filter") {
      intentFit = Math.min(1.0, intentFit + 0.25)
    }
  }

  // ── UI artifact boost: actions relevant to what the user sees get higher priority ──
  const uiBlock = ctx.likelyReferencedUIBlock
  if (uiBlock) {
    // Recommendation card visible → boost cutting conditions, compare, explain
    if (uiBlock === "recommendation_card") {
      if (actionValue === "cutting_conditions") intentFit = Math.min(1.0, intentFit + 0.2)
      if (option.family === "compare" || actionValue === "compare") intentFit = Math.min(1.0, intentFit + 0.15)
      if (actionValue === "explain_recommendation") intentFit = Math.min(1.0, intentFit + 0.1)
    }
    // Comparison table visible → boost revision/different-condition options
    if (uiBlock === "comparison_table") {
      if (plan.type === "replace_filter") intentFit = Math.min(1.0, intentFit + 0.2)
      if (option.field === "coating" || option.field === "fluteCount") intentFit = Math.min(1.0, intentFit + 0.1)
    }
    // Cutting conditions visible → boost inventory, compare, different product options
    if (uiBlock === "cutting_conditions") {
      if (actionValue === "inventory_detail") intentFit = Math.min(1.0, intentFit + 0.2)
      if (option.family === "compare") intentFit = Math.min(1.0, intentFit + 0.15)
    }
    // Candidate list visible → boost compare, show recommendation
    if (uiBlock === "candidate_list") {
      if (option.family === "compare") intentFit = Math.min(1.0, intentFit + 0.2)
      if (actionValue === "show_recommendation") intentFit = Math.min(1.0, intentFit + 0.15)
    }
  }

  // Expected utility
  const expectedUtility = option.family === "explore" ? 0.7
    : option.family === "compare" ? 0.85
    : 0.8

  // Explainability
  const explainability = option.subtitle ? 0.9 : 0.7

  // Continuity
  const continuity = option.preservesContext ? 0.8 : 0.3

  // Novelty: explore and compare options get a novelty boost
  const novelty = option.family === "explore" ? 0.8
    : option.family === "compare" ? 0.7
    : 0.4

  return { intentFit, expectedUtility, explainability, continuity, novelty }
}

// ════════════════════════════════════════════════════════════════
// RESET SCORING (always low unless explicitly useful)
// ════════════════════════════════════════════════════════════════

function scoreReset(option: SmartOption, ctx: RankerContext): number {
  // Reset should rank low unless there are many filters and few candidates
  const baseScore = 0.1
  const manyFiltersBonus = ctx.filterCount > 3 ? 0.1 : 0
  const noCandidatesBonus = ctx.candidateCount === 0 ? 0.3 : 0
  return baseScore + manyFiltersBonus + noCandidatesBonus
}
