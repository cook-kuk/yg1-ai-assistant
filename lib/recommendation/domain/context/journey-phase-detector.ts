/**
 * Journey Phase Detector — Determines where the user is in the recommendation journey.
 *
 * Pure function, no LLM calls. Used to prevent post-result questions
 * (series comparison, brand explanation, etc.) from falling back into
 * narrowing field questions.
 */

import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import type { JourneyPhase } from "@/lib/types/exploration"

/**
 * Compute the current journey phase from session state.
 *
 * - "intake": no meaningful state yet
 * - "narrowing": actively asking field questions, no results shown
 * - "results_displayed": recommendation results are visible to the user
 */
export function detectJourneyPhase(sessionState: ExplorationSessionState | null): JourneyPhase {
  if (!sessionState) return "intake"

  const hasResults = sessionState.resolutionStatus?.startsWith("resolved") ?? false
  const hasDisplayedProducts = (sessionState.displayedCandidates?.length ?? 0) > 0
  const isRecommendationMode = sessionState.currentMode === "recommendation"

  if (hasResults || (hasDisplayedProducts && isRecommendationMode)) {
    return "results_displayed"
  }

  if (sessionState.currentMode === "question" && sessionState.lastAskedField) {
    return "narrowing"
  }

  return "intake"
}

/**
 * Returns true when the user is in a post-result phase where forced narrowing
 * should be suppressed.
 */
export function isPostResultPhase(phase: JourneyPhase): boolean {
  return phase === "results_displayed" || phase === "post_result_exploration" || phase === "comparison"
}
