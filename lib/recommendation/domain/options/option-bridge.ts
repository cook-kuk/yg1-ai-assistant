/**
 * Option Bridge — Connects SmartOptions to existing DisplayedOption + chips system.
 *
 * Keeps chips and structured options synchronized.
 * displayedOptions remains the source of truth for selectable UI actions.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
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
    topCandidates: candidateSnapshot.slice(0, 5).map(c => ({
      displayCode: c.displayCode,
      seriesName: c.seriesName,
      coating: c.coating,
      fluteCount: c.fluteCount,
      diameterMm: c.diameterMm,
      score: c.score,
      matchStatus: c.matchStatus,
    })),
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
  // 1. Build memory from session
  const rawMemory = buildMemoryFromSession(
    form as unknown as Parameters<typeof buildMemoryFromSession>[0],
    sessionState,
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

  // 5. Build planner context with interpretation + memory
  const plannerCtx: OptionPlannerContext = {
    mode: interpretation.shouldGenerateRepairOptions ? "repair" : plannerMode,
    candidateCount: candidates.length,
    appliedFilters: filters,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    lastAskedField,
    lastAction: unifiedTurnContext?.latestProcessTrace?.routeAction ?? sessionState?.lastAction,
    userMessage: unifiedTurnContext?.latestUserMessage ?? userMessage ?? undefined,
    candidateFieldValues: extractCandidateFieldValues(candidates),
    topCandidates: (unifiedTurnContext?.currentCandidates ?? sessionState?.displayedCandidates ?? []).slice(0, 5).map(c => ({
      displayCode: c.displayCode,
      seriesName: c.seriesName,
      coating: c.coating,
      fluteCount: c.fluteCount,
      diameterMm: c.diameterMm,
      score: c.score,
      matchStatus: c.matchStatus,
    })),
    contextInterpretation: interpretation,
    conversationMemory: unifiedTurnContext?.conversationMemory ?? memory,
    displayedProducts: (unifiedTurnContext?.currentCandidates ?? sessionState?.displayedCandidates ?? []).slice(0, 5).map(c => ({
      displayCode: c.displayCode,
      seriesName: c.seriesName,
      coating: c.coating,
      fluteCount: c.fluteCount,
      stockStatus: c.stockStatus ?? undefined,
    })),
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
