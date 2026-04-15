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

  console.log(`[narrowing-plan] entered candidateCount=${ctx.candidateCount} hasFieldValues=${!!fieldValues} fieldCount=${fieldValues ? Object.keys(fieldValues).length : 0} lastAskedField=${ctx.lastAskedField ?? 'none'}`)

  if (!fieldValues) { console.log(`[narrowing-plan] EXIT early — no candidateFieldValues`); return options }

  // Generate options for ALL discriminative narrowing fields.
  // No pre-slicing — downstream LLM chip selector sees the full distribution and
  // decides which field + values are actually discriminative for the current turn.
  const fields = rankNarrowingFields(fieldValues, ctx)

  for (const { field, values } of fields) {
    // Emit every value for this field; LLM will prune non-discriminative ones.
    const sortedValues = Array.from(values.entries())
      .sort((a, b) => b[1] - a[1])

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

/** DB 영어값 → 한국어(영어) 병기 레이블 */
const DISPLAY_LABEL_KO: Record<string, Record<string, string>> = {
  workPieceName: {
    "Alloy Steels": "합금강(Alloy Steels)",
    "Carbon Steels": "탄소강(Carbon Steels)",
    "Structural Steels": "구조용강(Structural Steels)",
    "Stainless Steels": "스테인리스(Stainless Steels)",
    "Cast Iron": "주철(Cast Iron)",
    "Tool Steels": "공구강(Tool Steels)",
    "Hardened Steels(HRc45~55)": "고경도강 HRc45~55",
    "Hardened Steels(HRc55~70)": "고경도강 HRc55~70",
    "High Alloyed": "고합금강(High Alloyed)",
    "High Carbon Steels": "고탄소강(High Carbon Steels)",
    "Aluminum": "알루미늄(Aluminum)",
    "Aluminum Alloy": "알루미늄합금(Al Alloy)",
    "Copper": "구리(Copper)",
    "Copper Alloy": "구리합금(Cu Alloy)",
    "Graphite": "그라파이트(Graphite)",
    "Titanium": "티타늄(Titanium)",
    "Titanium Alloy": "티타늄합금(Ti Alloy)",
    "Inconel": "인코넬(Inconel)",
    "Nickel Alloy": "니켈합금(Ni Alloy)",
    "Heat Resistant Alloy": "내열합금(Heat Resistant)",
  },
  coating: {
    "Uncoated": "무코팅(Uncoated)",
    "Bright": "브라이트(무코팅)",
    "Bright Finish": "브라이트(무코팅)",
  },
  toolSubtype: {
    "Square": "스퀘어(Square)",
    "Ball": "볼(Ball)",
    "Radius": "코너R(Radius)",
    "Roughing": "황삭(Roughing)",
    "Taper": "테이퍼(Taper)",
    "Chamfer": "챔퍼(Chamfer)",
    "High-Feed": "하이피드(High-Feed)",
  },
}

function localizeValue(field: string, value: string): string {
  return DISPLAY_LABEL_KO[field]?.[value] ?? value
}

function formatNarrowingLabel(_field: string, value: string, count: number): string {
  // Field label SSOT 는 filter-field-registry 이지만 현재 UI 스타일상 라벨은 값만 노출.
  // (필드명 노출이 필요해지면 getFilterFieldLabel(_field) 로 교체)
  return `${localizeValue(_field, value)} (${count}개)`
}
