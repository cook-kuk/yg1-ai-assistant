/**
 * Option Bridge — Connects SmartOptions to existing DisplayedOption + chips system.
 *
 * Keeps chips and structured options synchronized.
 * displayedOptions remains the source of truth for selectable UI actions.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import type { StructuredChipDto } from "@/lib/contracts/recommendation"
import type {
  AppliedFilter,
  CandidateSnapshot,
  DisplayedOption,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import type { ContextInterpretation } from "../context/context-types"
import type { UnifiedTurnContext } from "../context/turn-context-builder"
import type { ConversationMemory } from "../memory/conversation-memory"
import { interpretContext } from "../context/context-interpreter"
import { buildMemoryFromSession } from "../memory/conversation-memory"
import { updateMemory } from "../memory/memory-manager"
import { extractFilterFieldValueMap } from "@/lib/recommendation/shared/filter-field-registry"

type CandidateLike = CandidateSnapshot | ScoredProduct

const SNAPSHOT_FIELD_GETTERS: Array<{
  field: string
  getValue: (candidate: CandidateSnapshot) => string | number | boolean | null | undefined
}> = [
  { field: "fluteCount", getValue: candidate => candidate.fluteCount },
  { field: "coating", getValue: candidate => candidate.coating },
  { field: "seriesName", getValue: candidate => candidate.seriesName },
  { field: "toolSubtype", getValue: candidate => candidate.toolSubtype },
  { field: "toolMaterial", getValue: candidate => candidate.toolMaterial },
  { field: "diameterMm", getValue: candidate => candidate.diameterMm },
  { field: "ballRadiusMm", getValue: candidate => candidate.ballRadiusMm },
  { field: "taperAngleDeg", getValue: candidate => candidate.taperAngleDeg },
  { field: "coolantHole", getValue: candidate => candidate.coolantHole },
  { field: "stockStatus", getValue: candidate => candidate.stockStatus },
]

function isScoredProductCandidate(candidate: CandidateLike): candidate is ScoredProduct {
  return "product" in candidate
}

function extractFieldValueMapFromSnapshots(
  candidates: CandidateSnapshot[]
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()

  for (const { field, getValue } of SNAPSHOT_FIELD_GETTERS) {
    const distribution = new Map<string, number>()

    for (const candidate of candidates) {
      const value = getValue(candidate)
      if (value == null) continue

      const label = String(value)
      distribution.set(label, (distribution.get(label) ?? 0) + 1)
    }

    if (distribution.size > 1) {
      result.set(field, distribution)
    }
  }

  return result
}

function mapTopCandidates(candidates: CandidateLike[]): NonNullable<OptionPlannerContext["topCandidates"]> {
  return candidates.slice(0, 5).map(candidate => (
    isScoredProductCandidate(candidate)
      ? {
          displayCode: candidate.product.displayCode,
          seriesName: candidate.product.seriesName,
          coating: candidate.product.coating,
          fluteCount: candidate.product.fluteCount,
          diameterMm: candidate.product.diameterMm,
          score: candidate.score,
          matchStatus: candidate.matchStatus,
        }
      : {
          displayCode: candidate.displayCode,
          seriesName: candidate.seriesName,
          coating: candidate.coating,
          fluteCount: candidate.fluteCount,
          diameterMm: candidate.diameterMm,
          score: candidate.score,
          matchStatus: candidate.matchStatus,
        }
  ))
}

function mapDisplayedProducts(candidates: CandidateLike[]): NonNullable<OptionPlannerContext["displayedProducts"]> {
  return candidates.slice(0, 5).map(candidate => (
    isScoredProductCandidate(candidate)
      ? {
          displayCode: candidate.product.displayCode,
          seriesName: candidate.product.seriesName,
          coating: candidate.product.coating,
          fluteCount: candidate.product.fluteCount,
          stockStatus: candidate.stockStatus ?? undefined,
        }
      : {
          displayCode: candidate.displayCode,
          seriesName: candidate.seriesName,
          coating: candidate.coating,
          fluteCount: candidate.fluteCount,
          stockStatus: candidate.stockStatus ?? undefined,
        }
  ))
}

function sanitizeFiltersForMemory(
  filters: ExplorationSessionState["appliedFilters"] | undefined
): Array<{ field: string; op: string; value: string; rawValue: string | number; appliedAt: number }> | undefined {
  if (!filters) return undefined

  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: typeof filter.rawValue === "string" || typeof filter.rawValue === "number"
      ? filter.rawValue
      : filter.value,
    appliedAt: filter.appliedAt,
  }))
}

/**
 * Extract field value distributions from scored candidates.
 * Used by the planner to generate narrowing options.
 */
export function extractCandidateFieldValues(
  candidates: ScoredProduct[]
): Map<string, Map<string, number>> {
  return extractFilterFieldValueMap(candidates, [
    "fluteCount",
    "coating",
    "seriesName",
    "toolSubtype",
    "toolMaterial",
    "toolType",
    "brand",
    "country",
    "diameterMm",
    "shankDiameterMm",
    "lengthOfCutMm",
    "overallLengthMm",
    "helixAngleDeg",
    "ballRadiusMm",
    "taperAngleDeg",
    "coolantHole",
    "stockStatus",
  ])
}

export function extractCandidateLikeFieldValues(
  candidates: CandidateLike[]
): Map<string, Map<string, number>> {
  if (candidates.length === 0) return new Map()
  return isScoredProductCandidate(candidates[0])
    ? extractCandidateFieldValues(candidates as ScoredProduct[])
    : extractFieldValueMapFromSnapshots(candidates as CandidateSnapshot[])
}

export function summarizeCandidateFieldValues(
  candidateFieldValues?: Map<string, Map<string, number>>,
  maxFields = 6,
  maxValuesPerField = 4,
): Array<{ field: string; values: Array<{ value: string; count: number }> }> {
  if (!candidateFieldValues || candidateFieldValues.size === 0) return []

  return Array.from(candidateFieldValues.entries())
    .map(([field, values]) => ({
      field,
      diversity: values.size,
      topCount: Math.max(...Array.from(values.values())),
      values: Array.from(values.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, maxValuesPerField)
        .map(([value, count]) => ({ value, count })),
    }))
    .sort((left, right) => right.diversity - left.diversity || left.topCount - right.topCount)
    .slice(0, maxFields)
    .map(({ field, values }) => ({ field, values }))
}

/**
 * Convert SmartOptions to DisplayedOptions for backward compatibility.
 * Preserves field, value, label from smart options while maintaining
 * the numbered index format expected by the UI.
 */
export function smartOptionsToDisplayedOptions(smartOptions: SmartOption[]): DisplayedOption[] {
  return smartOptions
    .filter(o => o.family !== "reset" && o.plan.type !== "reset_session")
    .map((option, index) => ({
      index: index + 1,
      label: option.label,
      field: option.field ?? "_action",
      value: option.value ?? option.label,
      count: option.projectedCount ?? 0,
    }))
}

/**
 * Convert SmartOptions to chips array for backward compatibility.
 * Keeps the chip label format consistent with the existing system.
 */
export function smartOptionsToChips(smartOptions: SmartOption[]): string[] {
  return smartOptions.map(option => option.label)
}

/**
 * Convert SmartOptions to structured chips — parallel to smartOptionsToChips,
 * index-aligned with the label array. Carries action/field/value/op metadata
 * so the frontend can dispatch directly (apply_filter / reset / etc.) without
 * routing through the LLM re-extraction pipeline.
 *
 * Returns `null` for slots where no meaningful structured action can be
 * derived (defensive — lets the caller fall back to text dispatch).
 */
export function smartOptionsToStructuredChips(smartOptions: SmartOption[]): (StructuredChipDto | null)[] {
  return smartOptions.map(option => {
    const text = option.label

    // reset_session → reset action
    if (option.plan.type === "reset_session") {
      return { text, action: "reset" }
    }

    // compare_products → navigate to compare with product codes from patches
    if (option.plan.type === "compare_products") {
      const products = option.plan.patches
        .filter(p => p.op === "add" && typeof p.value === "string")
        .map(p => String(p.value))
      return { text, action: "navigate", target: "compare", products }
    }

    // explain_recommendation → navigate action (explainer panel)
    if (option.plan.type === "explain_recommendation") {
      return { text, action: "navigate", target: "explain" }
    }

    // branch_session → ask action (user confirmation required before branching)
    if (option.plan.type === "branch_session") {
      return { text, action: "ask" }
    }

    // relax_filters → remove_filter (if single field) otherwise ask
    if (option.plan.type === "relax_filters") {
      const removePatch = option.plan.patches.find(p => p.op === "remove")
      if (removePatch && removePatch.field) {
        return { text, action: "remove_filter", field: removePatch.field }
      }
      return { text, action: "ask" }
    }

    // apply_filter / replace_filter → structured filter application.
    // Prefer the direct option.field/value (set by buildQuestionFieldOptions);
    // fall back to the first patch if missing.
    if (option.plan.type === "apply_filter" || option.plan.type === "replace_filter") {
      const field = option.field ?? option.plan.patches.find(p => p.op === "add" || p.op === "replace")?.field
      const value = option.value ?? option.plan.patches.find(p => p.op === "add" || p.op === "replace")?.value
      if (!field) return null

      // Action-bucket pseudo-fields (_action=undo / skip) shouldn't be
      // dispatched as filter clicks — fall through to text handler.
      if (field === "_action") return null

      // "skip" value → select_option (user's intent is "ignore this field"),
      // which the server needs to convert into a skip filter.
      if (value === "skip") {
        return { text, action: "select_option", field, value: "skip" }
      }

      const op = option.plan.patches.find(p => (p.op === "add" || p.op === "replace") && p.field === field)?.op === "replace"
        ? "eq"
        : "eq"

      return {
        text,
        action: "apply_filter",
        field,
        value: value != null ? String(value) : "",
        op,
      }
    }

    return null
  })
}

/**
 * Build a planner context for narrowing mode from session/candidate data.
 */
export function buildNarrowingPlannerContext(
  candidates: ScoredProduct[],
  filters: AppliedFilter[],
  resolvedInput: RecommendationInput,
  lastAskedField?: string
): OptionPlannerContext {
  return {
    mode: "narrowing",
    candidateCount: candidates.length,
    appliedFilters: filters,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    lastAskedField,
    candidateFieldValues: extractCandidateFieldValues(candidates),
  }
}

/**
 * Build a planner context for post-recommendation mode.
 */
export function buildPostRecommendationPlannerContext(
  candidateSnapshot: CandidateSnapshot[],
  filters: AppliedFilter[],
  resolvedInput: RecommendationInput
): OptionPlannerContext {
  return {
    mode: "recommended",
    candidateCount: candidateSnapshot.length,
    appliedFilters: filters,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    candidateFieldValues: extractFieldValueMapFromSnapshots(candidateSnapshot),
    topCandidates: mapTopCandidates(candidateSnapshot),
    displayedProducts: mapDisplayedProducts(candidateSnapshot),
  }
}

/**
 * Build a planner context for repair mode (conflict detected).
 */
export function buildRepairPlannerContext(
  candidates: ScoredProduct[],
  filters: AppliedFilter[],
  resolvedInput: RecommendationInput,
  conflictField: string,
  conflictValue: string
): OptionPlannerContext {
  return {
    mode: "repair",
    candidateCount: candidates.length,
    appliedFilters: filters,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    conflictField,
    conflictValue,
    candidateFieldValues: extractCandidateFieldValues(candidates),
  }
}

/**
 * Build a context-aware planner context using interpretation + memory.
 * This is the upgraded entry point that replaces mode-only planning.
 */
export function buildContextAwarePlannerContext(
  form: ProductIntakeForm,
  sessionState: ExplorationSessionState | null,
  resolvedInput: RecommendationInput,
  userMessage: string | null,
  candidates: ScoredProduct[],
  filters: AppliedFilter[],
  lastAskedField?: string,
  unifiedTurnContext?: UnifiedTurnContext,
): {
  plannerCtx: OptionPlannerContext
  interpretation: ContextInterpretation
  memory: ConversationMemory
} {
  const memorySessionState = sessionState
    ? {
        ...sessionState,
        appliedFilters: sanitizeFiltersForMemory(sessionState.appliedFilters),
      }
    : null

  // 1. Build memory from session
  const rawMemory = buildMemoryFromSession(
    form as unknown as Parameters<typeof buildMemoryFromSession>[0],
    memorySessionState,
    sessionState?.turnCount ?? 0
  )

  // 2. Interpret context
  const interpretation = interpretContext({
    form,
    sessionState,
    resolvedInput,
    userMessage,
    memory: rawMemory,
  })

  // 3. Update memory with interpretation
  const { memory } = updateMemory(rawMemory, interpretation, sessionState?.turnCount ?? 0)

  // 4. Map interpretation mode to planner mode
  const modeMap: Record<string, OptionPlannerContext["mode"]> = {
    intake: "intake",
    narrowing: "narrowing",
    recommended: "recommended",
    repair: "repair",
    explore: "recommended",
    compare: "recommended",
    reset: "repair",
  }
  const plannerMode = modeMap[interpretation.mode] ?? "narrowing"
  const plannerCandidates: CandidateLike[] = (
    unifiedTurnContext?.currentCandidates?.length
      ? unifiedTurnContext.currentCandidates
      : sessionState?.displayedCandidates?.length
        ? sessionState.displayedCandidates
        : candidates
  )
  const candidateCount = candidates.length > 0 ? candidates.length : plannerCandidates.length

  // 5. Build planner context with interpretation + memory
  const plannerCtx: OptionPlannerContext = {
    mode: interpretation.shouldGenerateRepairOptions ? "repair" : plannerMode,
    candidateCount,
    appliedFilters: filters,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    lastAskedField,
    lastAction: unifiedTurnContext?.latestProcessTrace?.routeAction ?? sessionState?.lastAction,
    userMessage: unifiedTurnContext?.latestUserMessage ?? userMessage ?? undefined,
    candidateFieldValues: extractCandidateLikeFieldValues(plannerCandidates),
    topCandidates: mapTopCandidates(plannerCandidates),
    contextInterpretation: interpretation,
    conversationMemory: unifiedTurnContext?.conversationMemory ?? memory,
    displayedProducts: mapDisplayedProducts(plannerCandidates),
    visibleArtifacts: {
      hasRecommendation: unifiedTurnContext?.uiArtifacts.some(artifact => artifact.kind === "recommendation_card")
        ?? !!sessionState?.lastRecommendationArtifact,
      hasComparison: unifiedTurnContext?.uiArtifacts.some(artifact => artifact.kind === "comparison_table")
        ?? !!sessionState?.lastComparisonArtifact,
      hasCuttingConditions: unifiedTurnContext?.uiArtifacts.some(artifact => artifact.kind === "cutting_conditions") ?? false,
    },
  }

  // Set conflict fields from interpretation
  if (interpretation.detectedConflicts.length > 0) {
    const conflict = interpretation.detectedConflicts[0]
    plannerCtx.conflictField = conflict.newField
    plannerCtx.conflictValue = conflict.newValue
  }

  return { plannerCtx, interpretation, memory }
}
