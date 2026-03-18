/**
 * Session Manager — Single source of truth for session state.
 *
 * Owns:
 *   - Session state construction (one function, never inline)
 *   - Undo / restore to previous stage
 *   - Stage history management
 *
 * Rules:
 *   - All session state objects MUST be created via buildSessionState()
 *   - All undo operations MUST go through restoreToStage() or restoreOnePreviousStep()
 *   - LLMs never own state — only this module does
 */

import type {
  ExplorationSessionState,
  AppliedFilter,
  NarrowingTurn,
  NarrowingStage,
  CandidateSnapshot,
  ResolutionStatus,
  LastActionType,
  SeriesGroup,
  ComparisonArtifact,
  CandidateCounts,
  ClarificationRecord,
  DisplayedOption,
  SessionMode,
  UINarrowingPathEntry,
  RecommendationTask,
  ArchivedTask,
} from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

// ════════════════════════════════════════════════════════════════
// SESSION STATE CONSTRUCTION — the only way to build state
// ════════════════════════════════════════════════════════════════

interface BuildSessionStateParams {
  prevSessionId?: string
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
  displayedCandidates: CandidateSnapshot[]
  displayedChips: string[]
  displayedOptions: DisplayedOption[]
  displayedSeriesGroups?: SeriesGroup[]
  uiNarrowingPath?: UINarrowingPathEntry[]
  currentMode?: SessionMode
  restoreTarget?: string | null
  lastAction?: LastActionType
  underlyingAction?: LastActionType
  lastComparisonArtifact?: ComparisonArtifact | null
  lastRecommendationArtifact?: CandidateSnapshot[] | null
  candidateCounts?: CandidateCounts
  lastClarification?: ClarificationRecord | null
  // Series grouping (Phase 1)
  displayedGroups?: SeriesGroup[]
  activeGroupKey?: string | null
  // Task system (Phase 3)
  currentTask?: RecommendationTask | null
  taskHistory?: ArchivedTask[]
  pendingIntents?: Array<{ text: string; category: string }>
}

function buildDefaultUINarrowingPath(
  state: Pick<
    ExplorationSessionState,
    "appliedFilters" | "displayedSetFilter" | "activeGroupKey" | "candidateCount" | "restoreTarget"
  >,
  previousPath?: UINarrowingPathEntry[]
): UINarrowingPathEntry[] {
  const path: UINarrowingPathEntry[] = state.appliedFilters
    .filter(filter => filter.op !== "skip")
    .map(filter => ({
      kind: "filter",
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

  return path.length > 0 ? path : (previousPath ?? [])
}

export function logSessionSnapshot(
  tag: string,
  state: ExplorationSessionState,
  extras?: { restoreTarget?: string | null }
) {
  const displayedProducts = state.displayedProducts ?? state.displayedCandidates ?? []
  const displayedGroups = state.displayedSeriesGroups ?? state.displayedGroups ?? []
  const slots = {
    material: state.resolvedInput.material ?? null,
    operationType: state.resolvedInput.operationType ?? null,
    toolType: state.resolvedInput.toolType ?? null,
    toolSubtype: state.resolvedInput.toolSubtype ?? null,
    diameterMm: state.resolvedInput.diameterMm ?? null,
    seriesName: state.resolvedInput.seriesName ?? null,
    flutePreference: state.resolvedInput.flutePreference ?? null,
    coatingPreference: state.resolvedInput.coatingPreference ?? null,
  }
  const snapshot = {
    slots,
    candidateCount: state.candidateCount,
    displayedArtifactCounts: {
      displayedProducts: displayedProducts.length,
      displayedOptions: state.displayedOptions?.length ?? 0,
      displayedSeriesGroups: displayedGroups.length,
      lastRecommendationArtifact: state.lastRecommendationArtifact?.length ?? 0,
      lastComparisonArtifact: state.lastComparisonArtifact?.comparedProductCodes?.length ?? 0,
    },
    displayedArtifactIds: {
      displayedProducts: displayedProducts.slice(0, 10).map(product => product.productCode),
      displayedSeriesGroups: displayedGroups.slice(0, 10).map(group => group.seriesKey),
    },
    activeSeriesGroup: state.activeGroupKey ?? null,
    currentMode: state.currentMode ?? null,
    lastAction: state.lastAction ?? null,
    restoreTarget: extras?.restoreTarget ?? state.restoreTarget ?? null,
  }
  console.log(`[session-snapshot:${tag}] ${JSON.stringify(snapshot)}`)
}

export function buildSessionState(params: BuildSessionStateParams): ExplorationSessionState {
  const state: ExplorationSessionState = {
    sessionId: params.prevSessionId ?? `ses-${Date.now()}`,
    candidateCount: params.candidateCount,
    appliedFilters: params.appliedFilters,
    narrowingHistory: params.narrowingHistory,
    stageHistory: params.stageHistory,
    resolutionStatus: params.resolutionStatus,
    resolvedInput: params.resolvedInput,
    turnCount: params.turnCount,
    lastAskedField: params.lastAskedField,
    displayedCandidates: params.displayedCandidates,
    displayedChips: params.displayedChips,
    displayedOptions: params.displayedOptions,
    lastAction: params.lastAction,
  }
  state.displayedProducts = params.displayedProducts ?? params.displayedCandidates
  state.displayedCandidates = state.displayedProducts
  state.fullDisplayedProducts = params.fullDisplayedProducts
    ?? params.displayedProducts
    ?? params.displayedCandidates
  state.fullDisplayedCandidates = state.fullDisplayedProducts ?? undefined
  state.displayedSeriesGroups = params.displayedSeriesGroups ?? params.displayedGroups
  state.currentMode = params.currentMode
  state.restoreTarget = params.restoreTarget ?? null
  state.underlyingAction = params.underlyingAction
  state.lastComparisonArtifact = params.lastComparisonArtifact ?? null
  state.lastRecommendationArtifact = params.lastRecommendationArtifact ?? null
  state.candidateCounts = params.candidateCounts
  state.lastClarification = params.lastClarification ?? null
  state.pendingIntents = params.pendingIntents
  state.uiNarrowingPath = params.uiNarrowingPath
  // Optional fields — only set if provided
  if (params.displayedGroups) state.displayedGroups = params.displayedGroups
  if (state.displayedSeriesGroups) state.displayedGroups = state.displayedSeriesGroups
  if (params.activeGroupKey !== undefined) state.activeGroupKey = params.activeGroupKey
  if (params.currentTask !== undefined) state.currentTask = params.currentTask
  if (params.taskHistory) state.taskHistory = params.taskHistory
  state.uiNarrowingPath = buildDefaultUINarrowingPath(state, params.uiNarrowingPath)
  return state
}

/** Carry forward from previous state, overriding only what changed */
export function carryForwardState(
  prev: ExplorationSessionState,
  overrides: Partial<BuildSessionStateParams>
): ExplorationSessionState {
  return buildSessionState({
    prevSessionId: prev.sessionId,
    candidateCount: overrides.candidateCount ?? prev.candidateCount,
    appliedFilters: overrides.appliedFilters ?? prev.appliedFilters,
    narrowingHistory: overrides.narrowingHistory ?? prev.narrowingHistory,
    stageHistory: overrides.stageHistory ?? prev.stageHistory,
    resolutionStatus: overrides.resolutionStatus ?? prev.resolutionStatus,
    resolvedInput: overrides.resolvedInput ?? prev.resolvedInput,
    turnCount: overrides.turnCount ?? prev.turnCount,
    lastAskedField: overrides.lastAskedField ?? prev.lastAskedField,
    displayedProducts: overrides.displayedProducts ?? prev.displayedProducts ?? prev.displayedCandidates,
    fullDisplayedProducts: overrides.fullDisplayedProducts
      ?? prev.fullDisplayedProducts
      ?? prev.fullDisplayedCandidates
      ?? prev.displayedProducts
      ?? prev.displayedCandidates,
    displayedCandidates: overrides.displayedCandidates ?? overrides.displayedProducts ?? prev.displayedProducts ?? prev.displayedCandidates,
    displayedChips: overrides.displayedChips ?? prev.displayedChips,
    displayedOptions: overrides.displayedOptions ?? prev.displayedOptions ?? [],
    displayedSeriesGroups: overrides.displayedSeriesGroups ?? prev.displayedSeriesGroups ?? prev.displayedGroups,
    uiNarrowingPath: overrides.uiNarrowingPath ?? prev.uiNarrowingPath,
    currentMode: overrides.currentMode ?? prev.currentMode,
    restoreTarget: overrides.restoreTarget !== undefined ? overrides.restoreTarget : prev.restoreTarget,
    lastAction: overrides.lastAction ?? prev.lastAction,
    underlyingAction: overrides.underlyingAction ?? prev.underlyingAction,
    lastComparisonArtifact: overrides.lastComparisonArtifact !== undefined
      ? overrides.lastComparisonArtifact
      : prev.lastComparisonArtifact,
    lastRecommendationArtifact: overrides.lastRecommendationArtifact !== undefined
      ? overrides.lastRecommendationArtifact
      : prev.lastRecommendationArtifact,
    candidateCounts: overrides.candidateCounts ?? prev.candidateCounts,
    lastClarification: overrides.lastClarification !== undefined
      ? overrides.lastClarification
      : prev.lastClarification,
    displayedGroups: overrides.displayedGroups ?? overrides.displayedSeriesGroups ?? prev.displayedSeriesGroups ?? prev.displayedGroups,
    activeGroupKey: overrides.activeGroupKey !== undefined ? overrides.activeGroupKey : prev.activeGroupKey,
    currentTask: overrides.currentTask !== undefined ? overrides.currentTask : prev.currentTask,
    taskHistory: overrides.taskHistory ?? prev.taskHistory,
    pendingIntents: overrides.pendingIntents ?? prev.pendingIntents,
  })
}

// ════════════════════════════════════════════════════════════════
// STAGE HISTORY MANAGEMENT
// ════════════════════════════════════════════════════════════════

/** Create initial stage (before any filters) */
export function createInitialStage(
  input: RecommendationInput,
  candidateCount: number
): NarrowingStage {
  return {
    stepIndex: -1,
    stageName: "initial_search",
    filterApplied: null,
    candidateCount,
    resolvedInputSnapshot: { ...input },
    filtersSnapshot: [],
  }
}

/** Create a stage snapshot after applying a filter */
export function createFilterStage(
  filter: AppliedFilter,
  input: RecommendationInput,
  filters: AppliedFilter[],
  candidateCount: number
): NarrowingStage {
  return {
    stepIndex: filter.appliedAt,
    stageName: `${filter.field}_${filter.value}`,
    filterApplied: filter,
    candidateCount,
    resolvedInputSnapshot: { ...input },
    filtersSnapshot: [...filters],
  }
}

// ════════════════════════════════════════════════════════════════
// UNDO / RESTORE — the only way to go back
// ════════════════════════════════════════════════════════════════

export interface RestoreResult {
  rebuiltInput: RecommendationInput
  remainingFilters: AppliedFilter[]
  remainingHistory: NarrowingTurn[]
  remainingStages: NarrowingStage[]
  undoTurnCount: number
  removedFilterDesc: string
}

/**
 * Restore to one step before the current state.
 */
export function restoreOnePreviousStep(
  state: ExplorationSessionState,
  baseInput: RecommendationInput,
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
): RestoreResult {
  const stageHistory = state.stageHistory ?? []
  const lastStageIdx = stageHistory.length - 1

  if (lastStageIdx > 0) {
    // Restore to the stage before the last one
    const prevStage = stageHistory[lastStageIdx - 1]
    return {
      rebuiltInput: { ...prevStage.resolvedInputSnapshot },
      remainingFilters: [...prevStage.filtersSnapshot],
      remainingHistory: state.narrowingHistory.slice(0, Math.max(0, state.narrowingHistory.length - 1)),
      remainingStages: stageHistory.slice(0, lastStageIdx),
      undoTurnCount: prevStage.filtersSnapshot.filter(f => f.op !== "skip").length,
      removedFilterDesc: stageHistory[lastStageIdx]?.filterApplied?.value ?? "마지막 단계",
    }
  }

  // Fallback: replay from base
  return replayFromBase(state, baseInput, applyFilterToInput, state.turnCount - 1)
}

/**
 * Restore to the state just BEFORE a specific filter was applied.
 */
export function restoreToBeforeFilter(
  state: ExplorationSessionState,
  filterValue: string,
  filterField: string | undefined,
  baseInput: RecommendationInput,
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
): RestoreResult {
  const stageHistory = state.stageHistory ?? []

  // Find the target stage by filter value
  const targetIdx = stageHistory.findIndex(s => {
    if (!s.filterApplied) return false
    const fVal = s.filterApplied.value.toLowerCase()
    const fRaw = s.filterApplied.rawValue.toString().toLowerCase()
    const target = filterValue.toLowerCase()
    return fVal.includes(target) || fRaw.includes(target) ||
      (filterField && s.filterApplied.field === filterField)
  })

  if (targetIdx > 0) {
    // Restore to the stage just before the target
    const prevStage = stageHistory[targetIdx - 1]
    return {
      rebuiltInput: { ...prevStage.resolvedInputSnapshot },
      remainingFilters: [...prevStage.filtersSnapshot],
      remainingHistory: state.narrowingHistory.slice(0, targetIdx - 1),
      remainingStages: stageHistory.slice(0, targetIdx),
      undoTurnCount: prevStage.filtersSnapshot.filter(f => f.op !== "skip").length,
      removedFilterDesc: stageHistory[targetIdx].filterApplied?.value ?? filterValue,
    }
  }

  if (targetIdx === 0) {
    // Reverting to before the very first filter → initial state
    return {
      rebuiltInput: { ...baseInput },
      remainingFilters: [],
      remainingHistory: [],
      remainingStages: stageHistory.length > 0 ? [stageHistory[0]] : [],
      undoTurnCount: 0,
      removedFilterDesc: stageHistory[0]?.filterApplied?.value ?? filterValue,
    }
  }

  // Fallback: use replay
  return replayFromBase(state, baseInput, applyFilterToInput, state.turnCount - 1)
}

/** Replay filters from scratch when stage snapshots are missing */
function replayFromBase(
  state: ExplorationSessionState,
  baseInput: RecommendationInput,
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput,
  targetTurnCount: number
): RestoreResult {
  const remainingFilters = state.appliedFilters.filter(f => f.appliedAt < targetTurnCount)
  let rebuiltInput = { ...baseInput }
  for (const f of remainingFilters) {
    rebuiltInput = applyFilterToInput(rebuiltInput, f)
  }
  const remainingHistory = state.narrowingHistory.slice(0, targetTurnCount)
  const remainingStages = (state.stageHistory ?? []).filter(s =>
    !s.filterApplied || s.filterApplied.appliedAt < targetTurnCount
  )
  const removed = state.appliedFilters.find(f => f.appliedAt === targetTurnCount)

  return {
    rebuiltInput,
    remainingFilters,
    remainingHistory,
    remainingStages,
    undoTurnCount: remainingFilters.filter(f => f.op !== "skip").length,
    removedFilterDesc: removed?.value ?? "마지막 단계",
  }
}
