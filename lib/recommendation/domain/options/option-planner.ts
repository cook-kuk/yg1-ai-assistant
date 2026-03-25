/**
 * Option Planner — Deterministic candidate option generation.
 *
 * Generates structured SmartOptions from session state, resolved input,
 * applied filters, candidates, and current mode.
 *
 * No LLM calls. No external services. Purely deterministic.
 *
 * Implementation split into focused modules:
 *   - planner-utils.ts         — ID generation, field labels
 *   - plan-narrowing.ts        — Pre-recommendation narrowing options
 *   - plan-repair.ts           — Conflict recovery options
 *   - plan-post-recommendation.ts — Post-recommendation options
 *   - plan-context-aware.ts    — Context-interpretation-driven routing
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import { planNarrowingOptions } from "./plan-narrowing"
import { planRepairOptions } from "./plan-repair"
import { planPostRecommendationOptions } from "./plan-post-recommendation"
import { planContextAwareOptions } from "./plan-context-aware"

// Re-export utilities so existing imports keep working
export { resetOptionCounter } from "./planner-utils"

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════

export function planOptions(ctx: OptionPlannerContext): SmartOption[] {
  const interp = ctx.contextInterpretation

  // If context interpretation is available, use it to determine mode and options
  if (interp) {
    return planContextAwareOptions(ctx, interp)
  }

  // Fallback: use mode-based planning
  switch (ctx.mode) {
    case "intake":
    case "narrowing":
      return planNarrowingOptions(ctx)
    case "repair":
      return planRepairOptions(ctx)
    case "recommended":
      return planPostRecommendationOptions(ctx)
    default:
      return []
  }
}
