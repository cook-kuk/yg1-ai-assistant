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
  AppliedFilter,
  ArchivedTask,
  CandidateSnapshot,
  RecommendationTask,
  DisplayedOption,
  ExplorationSessionState,
  LastActionType,
  NarrowingStage,
  NarrowingTurn,
  RecommendationInput,
  ResolutionStatus,
  SeriesGroup,
  SessionMode,
  UINarrowingPathEntry,
} from "@/lib/recommendation/domain/types"

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
  displayedSeriesGroups?: SeriesGroup[]
  uiNarrowingPath?: UINarrowingPathEntry[]
  currentMode?: SessionMode
  activeGroupKey?: string | null
  displayedCandidates: CandidateSnapshot[]
  fullDisplayedCandidates?: CandidateSnapshot[]
  displayedChips: string[]
  displayedOptions?: DisplayedOption[]
  lastAction?: LastActionType
  currentTask?: RecommendationTask | null
  taskHistory?: ArchivedTask[]
  conversationMemory?: import("@/lib/recommendation/domain/memory/conversation-memory").ConversationMemory
  conversationLog?: import("@/lib/recommendation/domain/memory/memory-compressor").ConversationLog
}

export function buildSessionState(params: BuildSessionStateParams): ExplorationSessionState {
  return {
    sessionId: params.prevSessionId ?? `ses-${Date.now()}`,
    candidateCount: params.candidateCount,
    appliedFilters: params.appliedFilters,
    narrowingHistory: params.narrowingHistory,
    stageHistory: params.stageHistory,
    resolutionStatus: params.resolutionStatus,
    resolvedInput: params.resolvedInput,
    turnCount: params.turnCount,
    lastAskedField: params.lastAskedField,
    displayedProducts: params.displayedProducts ?? params.displayedCandidates,
    fullDisplayedProducts: params.fullDisplayedProducts ?? params.displayedCandidates,
    displayedSeriesGroups: params.displayedSeriesGroups,
    uiNarrowingPath: params.uiNarrowingPath ?? [],
    currentMode: params.currentMode,
    activeGroupKey: params.activeGroupKey ?? null,
    displayedCandidates: params.displayedCandidates,
    fullDisplayedCandidates: params.fullDisplayedCandidates ?? params.displayedCandidates,
    displayedChips: params.displayedChips,
    displayedOptions: params.displayedOptions ?? [],
    lastAction: params.lastAction,
    currentTask: params.currentTask ?? null,
    taskHistory: params.taskHistory ?? [],
    conversationMemory: params.conversationMemory,
    conversationLog: params.conversationLog,
  }
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
    fullDisplayedProducts: overrides.fullDisplayedProducts ?? prev.fullDisplayedProducts ?? prev.displayedProducts ?? prev.displayedCandidates,
    displayedSeriesGroups: overrides.displayedSeriesGroups ?? prev.displayedSeriesGroups ?? prev.displayedGroups,
    uiNarrowingPath: overrides.uiNarrowingPath ?? prev.uiNarrowingPath ?? [],
    currentMode: overrides.currentMode ?? prev.currentMode,
    activeGroupKey: overrides.activeGroupKey ?? prev.activeGroupKey ?? null,
    displayedCandidates: overrides.displayedCandidates ?? prev.displayedCandidates,
    fullDisplayedCandidates: overrides.fullDisplayedCandidates ?? prev.fullDisplayedCandidates ?? prev.displayedCandidates,
    displayedChips: overrides.displayedChips ?? prev.displayedChips,
    displayedOptions: overrides.displayedOptions ?? prev.displayedOptions ?? [],
    lastAction: overrides.lastAction ?? prev.lastAction,
    currentTask: overrides.currentTask ?? prev.currentTask ?? null,
    taskHistory: overrides.taskHistory ?? prev.taskHistory ?? [],
    conversationMemory: overrides.conversationMemory ?? prev.conversationMemory,
    conversationLog: overrides.conversationLog ?? prev.conversationLog,
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
