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
export { buildContextAwarePlannerContext } from "./option-bridge"
export type { ContextInterpretation } from "../context/context-types"
export type { ConversationMemory } from "../memory/conversation-memory"

export interface SmartOptionEngineInput {
  plannerCtx: OptionPlannerContext
  simulatorCtx: SimulatorContext
  rankerCtx: RankerContext
  portfolioConfig?: PortfolioConfig
}

/**
 * Run the smart option pipeline up to ranked candidate hints.
 * This preserves the broader option pool so the chip selector can decide
 * what to surface from the current state instead of from a pre-trimmed menu.
 */
export function generateSmartOptionCandidates(input: SmartOptionEngineInput): SmartOption[] {
  const candidates = planOptions(input.plannerCtx)
  if (candidates.length === 0) return []

  simulateOptions(candidates, input.simulatorCtx)
  rankOptions(candidates, input.rankerCtx)

  return candidates
}

/**
 * Run the full smart option pipeline:
 * 1. Plan candidate options from session state
 * 2. Simulate projected outcomes
 * 3. Rank with family-specific signals
 * 4. Build a balanced portfolio
 */
export function generateSmartOptions(input: SmartOptionEngineInput): SmartOption[] {
  const candidates = generateSmartOptionCandidates(input)
  if (candidates.length === 0) return []

  return buildPortfolio(candidates, input.portfolioConfig)
}
