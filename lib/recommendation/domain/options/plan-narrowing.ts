/**
 * Narrowing Option Planning — Pre-recommendation option generation.
 *
 * Generates narrowing options based on candidate field value distributions
 * using entropy-based field ranking.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import { nextOptionId } from "./planner-utils"

// ════════════════════════════════════════════════════════════════
// NARROWING OPTIONS (before recommendation)
// ════════════════════════════════════════════════════════════════

export function planNarrowingOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const fieldValues = ctx.candidateFieldValues

  if (!fieldValues) return options

  // Generate options for the best narrowing fields
  const fields = rankNarrowingFields(fieldValues, ctx)

  for (const { field, values } of fields.slice(0, 3)) {
    // Top values by count for this field
    const sortedValues = Array.from(values.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)

    for (const [value, count] of sortedValues) {
      const delta = count - ctx.candidateCount
      options.push({
        id: nextOptionId("narrowing"),
        family: "narrowing",
        label: formatNarrowingLabel(field, value, count),
        subtitle: `${count}개 후보`,
        field,
        value,
        reason: `${field} = ${value}로 축소`,
        projectedCount: count,
        projectedDelta: delta,
        preservesContext: true,
        destructive: false,
        recommended: false,
        priorityScore: 0, // scored later by ranker
        plan: {
          type: "apply_filter",
          patches: [{ op: "add", field, value }],
        },
      })
    }
  }

  // Add skip option if there's a lastAskedField
  if (ctx.lastAskedField) {
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: "상관없음",
      field: ctx.lastAskedField,
      value: "skip",
      projectedCount: ctx.candidateCount,
      projectedDelta: 0,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: ctx.lastAskedField, value: "skip" }],
      },
    })
  }

  return options
}

interface FieldRank {
  field: string
  values: Map<string, number>
  entropy: number
}

// toolSubtype values that belong to Threading/Tapping — never show as Milling chips
const THREADING_SUBTYPES = new Set([
  "spiral flute", "point tap", "roll tap", "straight flute",
  "spiral point", "forming tap", "hand tap", "nut tap", "pipe tap",
])

function rankNarrowingFields(
  fieldValues: Map<string, Map<string, number>>,
  ctx: OptionPlannerContext
): FieldRank[] {
  const askedFields = new Set(ctx.appliedFilters.map(f => f.field))
  const machiningCategory = (ctx.resolvedInput as Record<string, unknown>)?.machiningCategory as string | undefined
  const results: FieldRank[] = []

  fieldValues.forEach((values, field) => {
    if (askedFields.has(field)) return
    if (values.size <= 1) return

    // Filter out cross-category toolSubtype values
    if (field === "toolSubtype" && machiningCategory && machiningCategory !== "Threading") {
      for (const key of values.keys()) {
        if (THREADING_SUBTYPES.has(key.toLowerCase())) values.delete(key)
      }
      if (values.size <= 1) return
    }

    const entropy = computeEntropy(values, ctx.candidateCount)
    results.push({ field, values, entropy })
  })

  // Sort by entropy (highest information gain first)
  results.sort((a, b) => b.entropy - a.entropy)
  return results
}

function computeEntropy(distribution: Map<string, number>, total: number): number {
  if (total === 0 || distribution.size <= 1) return 0
  let entropy = 0
  distribution.forEach(count => {
    if (count === 0) return
    const p = count / total
    entropy -= p * Math.log2(p)
  })
  const maxEntropy = Math.log2(distribution.size)
  return maxEntropy > 0 ? entropy / maxEntropy : 0
}

function formatNarrowingLabel(field: string, value: string, count: number): string {
  const fieldNames: Record<string, string> = {
    fluteCount: "날 수",
    coating: "코팅",
    seriesName: "시리즈",
    toolSubtype: "공구 형상",
    cuttingType: "가공 유형",
    workPieceName: "세부 피삭재",
  }
  const fieldLabel = fieldNames[field] ?? field
  return `${value} (${count}개)`
}
