/**
 * Option Simulator — Lightweight projected outcome estimation.
 *
 * For each candidate option, estimates projectedCount, projectedDelta,
 * and conflict signals WITHOUT running full retrieval.
 *
 * Uses current candidate snapshot and applied filters.
 * Deterministic, cheap, directionally useful.
 */

import type { SmartOption } from "./types"

export interface SimulatorContext {
  candidateCount: number
  appliedFilters: Array<{ field: string; op: string; value: string; rawValue: string | number }>
  /** Counts per field value from current candidates */
  candidateFieldValues?: Map<string, Map<string, number>>
}

/**
 * Simulate projected outcomes for a set of options.
 * Mutates projectedCount and projectedDelta on each option.
 */
export function simulateOptions(options: SmartOption[], ctx: SimulatorContext): SmartOption[] {
  for (const option of options) {
    simulateOne(option, ctx)
  }
  return options
}

function simulateOne(option: SmartOption, ctx: SimulatorContext): void {
  const { plan } = option
  const fieldValues = ctx.candidateFieldValues

  switch (plan.type) {
    case "apply_filter": {
      // Adding a filter: estimate by looking at candidate field values
      const addPatch = plan.patches.find(p => p.op === "add" && p.field !== "_action")
      if (addPatch && fieldValues) {
        const values = fieldValues.get(addPatch.field)
        if (values && addPatch.value != null) {
          const matchCount = values.get(String(addPatch.value)) ?? 0
          option.projectedCount = matchCount
          option.projectedDelta = matchCount - ctx.candidateCount
        }
      }
      // Skip/action patches: no change in count
      if (addPatch?.value === "skip" || addPatch?.field === "_action") {
        option.projectedCount = ctx.candidateCount
        option.projectedDelta = 0
      }
      break
    }

    case "replace_filter": {
      // Replacing one filter with another: harder to estimate.
      // Heuristic: removing a filter broadens, adding narrows.
      // Net effect: estimate as the add-part count if available,
      // otherwise use a fraction of total.
      const addPatch = plan.patches.find(p => p.op === "add" && p.field !== "_action")
      const removePatch = plan.patches.find(p => p.op === "remove")

      if (addPatch && fieldValues) {
        const values = fieldValues.get(addPatch.field)
        if (values && addPatch.value != null) {
          const matchCount = values.get(String(addPatch.value)) ?? 0
          // After remove + add: estimate slightly higher since we're broadening first
          const estimated = Math.max(matchCount, Math.round(ctx.candidateCount * 0.3))
          option.projectedCount = estimated
          option.projectedDelta = estimated - ctx.candidateCount
        }
      }

      // If only removing (no add): broaden
      if (!addPatch && removePatch) {
        // Removing a filter typically increases candidates
        const estimated = Math.round(ctx.candidateCount * 1.5)
        option.projectedCount = estimated
        option.projectedDelta = estimated - ctx.candidateCount
      }
      break
    }

    case "relax_filters": {
      // Relaxing multiple filters: estimate based on how many we're removing
      const removeCount = plan.patches.filter(p => p.op === "remove").length
      const multiplier = 1 + removeCount * 0.5
      const estimated = Math.round(ctx.candidateCount * multiplier)
      option.projectedCount = estimated
      option.projectedDelta = estimated - ctx.candidateCount
      break
    }

    case "reset_session": {
      // Full reset: unknown count, mark as null
      option.projectedCount = null
      option.projectedDelta = null
      break
    }
  }
}
