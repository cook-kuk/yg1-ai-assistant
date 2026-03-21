/**
 * Portfolio Reranker — Final selection of displayed options.
 *
 * Avoids showing 4 nearly identical options.
 * Ensures a balanced top set with diversity across families.
 *
 * Output shape:
 * - 1 best overall option
 * - 1 low-risk / context-preserving option
 * - 1 exploratory option
 * - reset only if genuinely useful
 *
 * Max final options: 4
 */

import type { SmartOption } from "./types"

const MAX_PORTFOLIO_SIZE = 4

export interface PortfolioConfig {
  maxOptions?: number
  /** If true, always include reset in the portfolio */
  forceReset?: boolean
}

export function buildPortfolio(
  rankedOptions: SmartOption[],
  config?: PortfolioConfig
): SmartOption[] {
  const maxOptions = config?.maxOptions ?? MAX_PORTFOLIO_SIZE

  if (rankedOptions.length <= maxOptions) {
    return deduplicate(rankedOptions)
  }

  const portfolio: SmartOption[] = []
  const used = new Set<string>()

  // 1. Best overall (highest score, non-reset)
  const best = rankedOptions.find(o => o.family !== "reset" && !used.has(o.id))
  if (best) {
    portfolio.push(best)
    used.add(best.id)
  }

  // 2. Low-risk / context-preserving option (different from #1)
  const lowRisk = rankedOptions.find(
    o => o.preservesContext && !o.destructive && !used.has(o.id) && !isSimilar(o, best)
  )
  if (lowRisk) {
    portfolio.push(lowRisk)
    used.add(lowRisk.id)
  }

  // 3. Exploratory option (explore family, or different family from above)
  const exploratory = rankedOptions.find(
    o => !used.has(o.id) && (o.family === "explore" || !portfolio.some(p => p.family === o.family))
      && !isSimilar(o, best) && !isSimilar(o, lowRisk)
  )
  if (exploratory) {
    portfolio.push(exploratory)
    used.add(exploratory.id)
  }

  // 4. Fill remaining slots with diverse options
  for (const option of rankedOptions) {
    if (portfolio.length >= maxOptions) break
    if (used.has(option.id)) continue
    if (option.family === "reset" && !config?.forceReset && portfolio.length > 0) continue
    if (portfolio.some(p => isSimilar(p, option))) continue

    portfolio.push(option)
    used.add(option.id)
  }

  // 5. Add reset only if genuinely useful (no candidates, or forced)
  if (config?.forceReset || (portfolio.length < maxOptions && !portfolio.some(o => o.family === "reset"))) {
    const reset = rankedOptions.find(o => o.family === "reset" && !used.has(o.id))
    if (reset && portfolio.length < maxOptions) {
      portfolio.push(reset)
    }
  }

  return portfolio.slice(0, maxOptions)
}

/**
 * Check if two options are too similar to show together.
 * Similar means: same field + same family, or nearly identical labels.
 */
function isSimilar(a: SmartOption | undefined, b: SmartOption | undefined): boolean {
  if (!a || !b) return false
  if (a.id === b.id) return true

  // Same field + same family = likely redundant
  if (a.field && b.field && a.field === b.field && a.family === b.family) return true

  // Nearly identical labels
  if (a.label === b.label) return true

  return false
}

/**
 * Remove exact duplicates by id.
 */
function deduplicate(options: SmartOption[]): SmartOption[] {
  const seen = new Set<string>()
  return options.filter(o => {
    if (seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })
}
