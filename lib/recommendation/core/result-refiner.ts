/**
 * Result Refiner — narrows within existing candidates instead of re-searching.
 *
 * When a user says something like "날수로 좁혀" after seeing results,
 * this module filters the current ResultContext in-memory and recomputes
 * distributions, avoiding a full search round-trip.
 */

import type { ResultContext, CandidateRef } from "./types"

export interface DistributionEntry {
  key: string
  count: number
}

export interface RefinementOption {
  label: string
  value: string
  count: number
}

/**
 * Filter current results by a given field/value and return a new ResultContext.
 * If value is omitted or empty, all candidates pass through unchanged.
 */
export function refineResults(
  currentResults: ResultContext,
  field: string,
  value?: string
): ResultContext {
  let filtered = currentResults.candidates

  if (value) {
    switch (field) {
      case "fluteCount":
      case "flute": {
        const fluteNum = parseInt(value.replace(/[^0-9]/g, ""), 10)
        if (!isNaN(fluteNum)) {
          filtered = filtered.filter(c => c.keySpecs?.flute === fluteNum)
        }
        break
      }
      case "coating": {
        filtered = filtered.filter(c =>
          c.keySpecs?.coating != null &&
          String(c.keySpecs.coating).toLowerCase().includes(value.toLowerCase())
        )
        break
      }
      case "stock": {
        filtered = filtered.filter(c => c.keySpecs?.hasInventory === true)
        break
      }
      default:
        break
    }
  } else if (field === "stock") {
    // stock filter doesn't need a value — just filter by hasInventory
    filtered = filtered.filter(c => c.keySpecs?.hasInventory === true)
  }

  // Re-rank filtered candidates
  const reranked = filtered.map((c, i) => ({ ...c, rank: i + 1 }))

  return {
    candidates: reranked,
    totalConsidered: currentResults.totalConsidered,
    searchTimestamp: currentResults.searchTimestamp,
    constraintsUsed: currentResults.constraintsUsed,
  }
}

/**
 * Compute distribution for a field from the current result set.
 */
export function computeDistribution(
  candidates: CandidateRef[],
  field: string
): DistributionEntry[] {
  const counts = new Map<string, number>()

  for (const c of candidates) {
    let key: string | null = null
    switch (field) {
      case "fluteCount":
      case "flute":
        if (c.keySpecs?.flute != null) key = `${c.keySpecs.flute}날`
        break
      case "coating":
        if (c.keySpecs?.coating != null) key = String(c.keySpecs.coating)
        break
      case "stock":
        key = c.keySpecs?.hasInventory ? "재고있음" : "재고없음"
        break
    }
    if (key != null) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Build refinement options from the distribution of a given field.
 * Returns selectable options with labels like "4날 (12개)".
 */
export function buildRefinementOptions(
  results: ResultContext,
  field: string
): RefinementOption[] {
  const dist = computeDistribution(results.candidates, field)

  return dist
    .filter(d => d.count > 0)
    .map(d => ({
      label: `${d.key} (${d.count}개)`,
      value: d.key,
      count: d.count,
    }))
}
