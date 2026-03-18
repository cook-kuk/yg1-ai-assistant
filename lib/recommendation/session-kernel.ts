import {
  buildSessionState,
  carryForwardState,
} from "@/lib/domain/session-manager"
import { groupCandidatesBySeries } from "@/lib/domain/series-grouper"
import { ENABLE_SERIES_GROUPING } from "@/lib/feature-flags"
import type { RecommendationInput } from "@/lib/types/canonical"
import type {
  AppliedFilter,
  CandidateSnapshot,
  ClarificationRecord,
  ComparisonArtifact,
  DisplayedOption,
  ExplorationSessionState,
  LastActionType,
  NarrowingStage,
  NarrowingTurn,
  RecommendationCheckpoint,
  SeriesGroup,
  SessionMode,
  ResolutionStatus,
  CandidateCounts,
} from "@/lib/types/exploration"

const PROTECTED_RECOMMENDATION_ACTIONS = new Set<LastActionType>([
  "show_recommendation",
  "filter_displayed",
  "query_displayed",
  "compare_products",
  "restore_previous_group",
  "show_group_menu",
  "answer_general",
  "explain_product",
  "confirm_scope",
  "summarize_task",
])

const ACTIVE_RECOMMENDATION_MODES = new Set<SessionMode>([
  "recommendation",
  "comparison",
  "general_chat",
  "group_menu",
  "group_focus",
  "restore",
])

export interface PersistedSessionBuildParams {
  prevState?: ExplorationSessionState | null
  candidateCount: number
  appliedFilters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  stageHistory: NarrowingStage[]
  resolutionStatus: ResolutionStatus
  resolvedInput: RecommendationInput
  turnCount: number
  lastAskedField?: string
  displayedProducts?: CandidateSnapshot[]
  fullDisplayedProducts?: CandidateSnapshot[] | null
  displayedSetFilter?: ExplorationSessionState["displayedSetFilter"]
  displayedChips?: string[]
  displayedOptions?: DisplayedOption[]
  displayedSeriesGroups?: SeriesGroup[]
  currentMode?: SessionMode
  restoreTarget?: string | null
  lastAction?: LastActionType
  underlyingAction?: LastActionType
  lastComparisonArtifact?: ComparisonArtifact | null
  lastRecommendationArtifact?: CandidateSnapshot[] | null
  candidateCounts?: CandidateCounts
  lastClarification?: ClarificationRecord | null
  activeGroupKey?: string | null
  currentTask?: ExplorationSessionState["currentTask"]
  taskHistory?: ExplorationSessionState["taskHistory"]
  pendingIntents?: Array<{ text: string; category: string }>
  preserveUnderlyingRecommendation?: boolean
}

export function getDisplayedProductsFromState(
  state: ExplorationSessionState | null | undefined,
): CandidateSnapshot[] {
  return state?.displayedProducts ?? state?.displayedCandidates ?? []
}

export function getFullDisplayedProductsFromState(
  state: ExplorationSessionState | null | undefined,
): CandidateSnapshot[] | null {
  return state?.fullDisplayedProducts
    ?? state?.fullDisplayedCandidates
    ?? state?.lastRecommendationArtifact
    ?? getDisplayedProductsFromState(state)
}

export function getDisplayedSeriesGroupsFromState(
  state: ExplorationSessionState | null | undefined,
): SeriesGroup[] | undefined {
  return state?.displayedSeriesGroups ?? state?.displayedGroups
}

export function deriveSessionMode(
  lastAction?: ExplorationSessionState["lastAction"],
): ExplorationSessionState["currentMode"] {
  switch (lastAction) {
    case "show_recommendation":
    case "filter_displayed":
    case "query_displayed":
      return "recommendation"
    case "compare_products":
      return "comparison"
    case "restore_previous_group":
      return "group_focus"
    case "show_group_menu":
      return "group_menu"
    case "answer_general":
    case "explain_product":
    case "confirm_scope":
    case "summarize_task":
      return "general_chat"
    case "start_new_task":
    case "resume_previous_task":
      return "task"
    default:
      return "question"
  }
}

export function hasActiveRecommendationSession(
  state: ExplorationSessionState | null | undefined,
): boolean {
  if (!state) return false
  if (state.currentMode && ACTIVE_RECOMMENDATION_MODES.has(state.currentMode)) {
    return true
  }
  return PROTECTED_RECOMMENDATION_ACTIONS.has(state.lastAction ?? null)
    || PROTECTED_RECOMMENDATION_ACTIONS.has(state.underlyingAction ?? null)
}

export function getLatestCheckpoint(
  state: ExplorationSessionState | null | undefined,
): RecommendationCheckpoint | null {
  if (!state) return null
  const currentCheckpoint = state.currentTask?.checkpoints?.[state.currentTask.checkpoints.length - 1]
  if (currentCheckpoint) return currentCheckpoint
  const archivedCheckpoint = state.taskHistory?.[state.taskHistory.length - 1]?.finalCheckpoint
  return archivedCheckpoint ?? null
}

export function getRecommendationSourceSnapshot(
  state: ExplorationSessionState | null | undefined,
): CandidateSnapshot[] {
  if (!state) return []
  const displayed = getDisplayedProductsFromState(state)
  const fullDisplayed = getFullDisplayedProductsFromState(state) ?? []
  if (displayed.length > 0 && (state.activeGroupKey || state.displayedSetFilter || state.currentMode === "group_focus")) {
    return displayed
  }
  if (displayed.length > 0 && fullDisplayed.length === 0) {
    return displayed
  }
  if (fullDisplayed.length > 0) {
    return fullDisplayed
  }
  return state.lastRecommendationArtifact ?? displayed
}

function buildPersistedUINarrowingPath(
  state: ExplorationSessionState,
  prevState: ExplorationSessionState | null,
): NonNullable<ExplorationSessionState["uiNarrowingPath"]> {
  const path = state.appliedFilters
    .filter(filter => filter.op !== "skip")
    .map(filter => ({
      kind: "filter" as const,
      label: `${filter.field}: ${filter.value}`,
      field: filter.field,
      value: String(filter.rawValue),
      candidateCount: state.candidateCount,
    }))

  if (state.displayedSetFilter) {
    path.push({
      kind: "display_filter",
      label: `${state.displayedSetFilter.field}: ${state.displayedSetFilter.value}`,
      field: state.displayedSetFilter.field,
      value: state.displayedSetFilter.value,
      candidateCount: state.candidateCount,
    })
  }

  if (state.activeGroupKey) {
    path.push({
      kind: "series_group",
      label: state.activeGroupKey,
      value: state.activeGroupKey,
      candidateCount: state.candidateCount,
    })
  }

  if (state.restoreTarget) {
    path.push({
      kind: "restore",
      label: state.restoreTarget,
      value: state.restoreTarget,
      candidateCount: state.candidateCount,
    })
  }

  return path.length > 0 ? path : (prevState?.uiNarrowingPath ?? [])
}

function buildCandidateCounts(
  state: ExplorationSessionState,
  prevState: ExplorationSessionState | null,
): CandidateCounts | undefined {
  const displayedProducts = state.displayedProducts ?? state.displayedCandidates ?? []
  const fullDisplayedProducts = state.fullDisplayedProducts
    ?? state.fullDisplayedCandidates
    ?? state.lastRecommendationArtifact
    ?? displayedProducts
  const displayedGroups = state.displayedSeriesGroups ?? state.displayedGroups

  const fallback = prevState?.candidateCounts
  const hiddenBySeriesCapCount = displayedGroups
    ? Math.max(
        displayedGroups.reduce((sum, group) => sum + group.candidateCount, 0) - displayedProducts.length,
        0,
      )
    : Math.max(fullDisplayedProducts.length - displayedProducts.length, 0)

  return {
    dbMatchCount: fallback?.dbMatchCount ?? Math.max(state.candidateCount, fullDisplayedProducts.length),
    filteredCount: Math.max(fallback?.filteredCount ?? 0, state.candidateCount, fullDisplayedProducts.length),
    rankedCount: fallback?.rankedCount ?? fullDisplayedProducts.length,
    displayedCount: displayedProducts.length,
    hiddenBySeriesCapCount,
  }
}

function repairDisplayedProductsForActiveGroup(
  displayedProducts: CandidateSnapshot[],
  fullDisplayedProducts: CandidateSnapshot[] | null,
  activeGroupKey: string | null,
): CandidateSnapshot[] {
  if (displayedProducts.length > 0 || !fullDisplayedProducts?.length || !activeGroupKey) {
    return displayedProducts
  }
  const repaired = fullDisplayedProducts.filter(candidate => candidate.seriesName === activeGroupKey)
  return repaired.length > 0 ? repaired : displayedProducts
}

export function finalizeSessionState(
  sessionState: ExplorationSessionState,
  prevState: ExplorationSessionState | null,
  options?: {
    currentMode?: ExplorationSessionState["currentMode"]
    restoreTarget?: string | null
    activeGroupKey?: string | null
    preserveUnderlyingRecommendation?: boolean
  },
): ExplorationSessionState {
  const prevDisplayedProducts = getDisplayedProductsFromState(prevState)
  const displayedProducts = repairDisplayedProductsForActiveGroup(
    sessionState.displayedProducts
      ?? sessionState.displayedCandidates
      ?? prevDisplayedProducts,
    sessionState.fullDisplayedProducts
      ?? sessionState.fullDisplayedCandidates
      ?? getFullDisplayedProductsFromState(prevState),
    options?.activeGroupKey !== undefined
      ? options.activeGroupKey
      : (sessionState.activeGroupKey ?? prevState?.activeGroupKey ?? null),
  )

  const fullDisplayedProducts = sessionState.fullDisplayedProducts
    ?? sessionState.fullDisplayedCandidates
    ?? getFullDisplayedProductsFromState(prevState)
    ?? displayedProducts
  const displayedSeriesGroups = sessionState.displayedSeriesGroups
    ?? sessionState.displayedGroups
    ?? getDisplayedSeriesGroupsFromState(prevState)
    ?? (ENABLE_SERIES_GROUPING && fullDisplayedProducts && fullDisplayedProducts.length > 0
      ? groupCandidatesBySeries(fullDisplayedProducts)
      : undefined)
  const displayedOptions = sessionState.displayedOptions?.length
    ? sessionState.displayedOptions
    : (prevState?.displayedOptions ?? [])

  const recommendationContextActive = hasActiveRecommendationSession(sessionState)
    || hasActiveRecommendationSession(prevState)
  const artifactCandidatePoolCount = fullDisplayedProducts?.length ?? displayedProducts.length
  const repairedCandidateCount = recommendationContextActive
    && sessionState.candidateCount <= 0
    && artifactCandidatePoolCount > 0
      ? Math.max(prevState?.candidateCount ?? 0, artifactCandidatePoolCount)
      : sessionState.candidateCount
  const repairedResolutionStatus = recommendationContextActive
    && sessionState.resolutionStatus === "resolved_none"
    && artifactCandidatePoolCount > 0
      ? (prevState?.resolutionStatus && prevState.resolutionStatus !== "resolved_none"
          ? prevState.resolutionStatus
          : "resolved_approximate")
      : sessionState.resolutionStatus

  const finalized: ExplorationSessionState = {
    ...sessionState,
    candidateCount: repairedCandidateCount,
    resolutionStatus: repairedResolutionStatus,
    displayedProducts,
    displayedCandidates: displayedProducts,
    fullDisplayedProducts,
    fullDisplayedCandidates: fullDisplayedProducts ?? undefined,
    displayedOptions,
    displayedSeriesGroups,
    displayedGroups: displayedSeriesGroups,
    currentMode: options?.currentMode ?? sessionState.currentMode ?? deriveSessionMode(sessionState.lastAction),
    activeGroupKey: options?.activeGroupKey !== undefined
      ? options.activeGroupKey
      : (sessionState.activeGroupKey ?? prevState?.activeGroupKey ?? null),
    restoreTarget: options?.restoreTarget !== undefined
      ? options.restoreTarget
      : (sessionState.restoreTarget ?? prevState?.restoreTarget ?? null),
    underlyingAction: options?.preserveUnderlyingRecommendation
      ? (prevState?.underlyingAction ?? prevState?.lastAction ?? "show_recommendation")
      : (sessionState.underlyingAction ?? prevState?.underlyingAction ?? prevState?.lastAction),
    lastComparisonArtifact: sessionState.lastComparisonArtifact !== undefined
      ? sessionState.lastComparisonArtifact
      : (prevState?.lastComparisonArtifact ?? null),
    lastRecommendationArtifact: sessionState.lastRecommendationArtifact !== undefined
      ? sessionState.lastRecommendationArtifact
      : (prevState?.lastRecommendationArtifact ?? fullDisplayedProducts ?? null),
    candidateCounts: sessionState.candidateCounts ?? buildCandidateCounts(sessionState, prevState),
    lastClarification: sessionState.lastClarification !== undefined
      ? sessionState.lastClarification
      : (prevState?.lastClarification ?? null),
    pendingIntents: sessionState.pendingIntents ?? prevState?.pendingIntents,
  }

  if (recommendationContextActive && finalized.displayedProducts.length === 0 && artifactCandidatePoolCount > 0) {
    finalized.displayedProducts = fullDisplayedProducts ?? displayedProducts
    finalized.displayedCandidates = finalized.displayedProducts
  }

  if (finalized.lastRecommendationArtifact == null && finalized.fullDisplayedProducts?.length) {
    finalized.lastRecommendationArtifact = finalized.fullDisplayedProducts
  }

  if (finalized.candidateCounts) {
    finalized.candidateCounts = buildCandidateCounts(finalized, prevState)
  }

  finalized.uiNarrowingPath = buildPersistedUINarrowingPath(finalized, prevState)
  return finalized
}

export function buildPersistedSessionState(
  params: PersistedSessionBuildParams,
): ExplorationSessionState {
  const prevState = params.prevState ?? null
  const displayedProducts = params.displayedProducts ?? getDisplayedProductsFromState(prevState)
  const fullDisplayedProducts = params.fullDisplayedProducts === undefined
    ? (getFullDisplayedProductsFromState(prevState) ?? displayedProducts)
    : params.fullDisplayedProducts
  const displayedSeriesGroups = params.displayedSeriesGroups
    ?? getDisplayedSeriesGroupsFromState(prevState)
    ?? (ENABLE_SERIES_GROUPING && fullDisplayedProducts && fullDisplayedProducts.length > 0
      ? groupCandidatesBySeries(fullDisplayedProducts)
      : undefined)
  const baseState = prevState
    ? carryForwardState(prevState, {
        candidateCount: params.candidateCount,
        appliedFilters: params.appliedFilters,
        narrowingHistory: params.narrowingHistory,
        stageHistory: params.stageHistory,
        resolutionStatus: params.resolutionStatus,
        resolvedInput: params.resolvedInput,
        turnCount: params.turnCount,
        lastAskedField: params.lastAskedField,
        displayedProducts,
        fullDisplayedProducts,
        displayedChips: params.displayedChips ?? prevState.displayedChips,
        displayedOptions: params.displayedOptions ?? prevState.displayedOptions,
        displayedSeriesGroups,
        currentMode: params.currentMode ?? prevState.currentMode,
        restoreTarget: params.restoreTarget,
        lastAction: params.lastAction ?? prevState.lastAction,
        underlyingAction: params.underlyingAction ?? prevState.underlyingAction,
        lastComparisonArtifact: params.lastComparisonArtifact,
        lastRecommendationArtifact: params.lastRecommendationArtifact,
        candidateCounts: params.candidateCounts,
        lastClarification: params.lastClarification,
        activeGroupKey: params.activeGroupKey,
        currentTask: params.currentTask,
        taskHistory: params.taskHistory,
        pendingIntents: params.pendingIntents,
      })
    : buildSessionState({
        candidateCount: params.candidateCount,
        appliedFilters: params.appliedFilters,
        narrowingHistory: params.narrowingHistory,
        stageHistory: params.stageHistory,
        resolutionStatus: params.resolutionStatus,
        resolvedInput: params.resolvedInput,
        turnCount: params.turnCount,
        lastAskedField: params.lastAskedField,
        displayedProducts,
        fullDisplayedProducts,
        displayedCandidates: displayedProducts,
        displayedChips: params.displayedChips ?? [],
        displayedOptions: params.displayedOptions ?? [],
        displayedSeriesGroups,
        currentMode: params.currentMode,
        restoreTarget: params.restoreTarget,
        lastAction: params.lastAction,
        underlyingAction: params.underlyingAction,
        lastComparisonArtifact: params.lastComparisonArtifact ?? null,
        lastRecommendationArtifact: params.lastRecommendationArtifact ?? null,
        candidateCounts: params.candidateCounts,
        lastClarification: params.lastClarification ?? null,
        activeGroupKey: params.activeGroupKey,
        currentTask: params.currentTask,
        taskHistory: params.taskHistory,
        pendingIntents: params.pendingIntents,
      })

  baseState.displayedSetFilter = params.displayedSetFilter
    ?? prevState?.displayedSetFilter
    ?? null

  return finalizeSessionState(baseState, prevState, {
    currentMode: params.currentMode,
    restoreTarget: params.restoreTarget,
    activeGroupKey: params.activeGroupKey,
    preserveUnderlyingRecommendation: params.preserveUnderlyingRecommendation,
  })
}

export function buildRestoreQuestionState(
  prevState: ExplorationSessionState,
  chips: string[],
): ExplorationSessionState {
  return buildPersistedSessionState({
    prevState,
    candidateCount: prevState.candidateCount,
    appliedFilters: prevState.appliedFilters,
    narrowingHistory: prevState.narrowingHistory,
    stageHistory: prevState.stageHistory ?? [],
    resolutionStatus: prevState.resolutionStatus ?? "broad",
    resolvedInput: prevState.resolvedInput,
    turnCount: prevState.turnCount,
    lastAskedField: prevState.lastAskedField,
    displayedProducts: getDisplayedProductsFromState(prevState),
    fullDisplayedProducts: getFullDisplayedProductsFromState(prevState),
    displayedSetFilter: prevState.displayedSetFilter ?? null,
    displayedSeriesGroups: getDisplayedSeriesGroupsFromState(prevState),
    displayedChips: chips,
    displayedOptions: prevState.displayedOptions ?? [],
    lastAction: "answer_general",
    currentMode: "restore",
    restoreTarget: "last_checkpoint",
    lastComparisonArtifact: prevState.lastComparisonArtifact ?? null,
    lastRecommendationArtifact: prevState.lastRecommendationArtifact ?? getFullDisplayedProductsFromState(prevState),
    candidateCounts: prevState.candidateCounts,
    lastClarification: prevState.lastClarification ?? null,
    activeGroupKey: prevState.activeGroupKey ?? null,
    currentTask: prevState.currentTask,
    taskHistory: prevState.taskHistory,
    pendingIntents: prevState.pendingIntents,
    preserveUnderlyingRecommendation: true,
  })
}
