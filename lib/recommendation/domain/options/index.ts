/**
 * Smart Option Engine — Main entry point.
 *
 * Orchestrates: planner → simulator → ranker → portfolio.
 * Single function call produces the final structured option set.
 */

export type { SmartOption, SmartOptionFamily, SmartOptionPlan, SmartOptionPatch, OptionPlannerContext } from "./types"

import type { SmartOption, OptionPlannerContext } from "./types"
import type { SimulatorContext } from "./option-simulator"
import type { RankerContext } from "./option-ranker"
import type { PortfolioConfig } from "./option-portfolio"

import { planOptions } from "./option-planner"
import { simulateOptions } from "./option-simulator"
import { rankOptions } from "./option-ranker"
import { buildPortfolio } from "./option-portfolio"

export { planOptions } from "./option-planner"
export { simulateOptions } from "./option-simulator"
export { rankOptions } from "./option-ranker"
export { buildPortfolio } from "./option-portfolio"
export { resetOptionCounter } from "./option-planner"

export interface SmartOptionEngineInput {
  plannerCtx: OptionPlannerContext
  simulatorCtx: SimulatorContext
  rankerCtx: RankerContext
  portfolioConfig?: PortfolioConfig
}

/**
 * Run the full smart option pipeline:
 * 1. Plan candidate options from session state
 * 2. Simulate projected outcomes
 * 3. Rank with family-specific signals
 * 4. Build a balanced portfolio
 */
export function generateSmartOptions(input: SmartOptionEngineInput): SmartOption[] {
  // 1. Plan
  const candidates = planOptions(input.plannerCtx)
  if (candidates.length === 0) return []

  // 2. Simulate
  simulateOptions(candidates, input.simulatorCtx)

  // 3. Rank
  rankOptions(candidates, input.rankerCtx)

  // 4. Portfolio
  return buildPortfolio(candidates, input.portfolioConfig)
}
