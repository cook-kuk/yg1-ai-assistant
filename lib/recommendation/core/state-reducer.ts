/**
 * State Reducer — Centralized state mutation boundary
 *
 * STEP 3 of incremental refactor.
 * Wraps existing carryForwardState with action-typed reducers.
 * DRY-RUN mode: computes nextState but does NOT replace existing flow yet.
 * Used for DebugTrace (stateBefore → stateAfter diff).
 */

import type {
  AppliedFilter,
  CandidateSnapshot,
  ExplorationSessionState,
  NarrowingTurn,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"

// ── Reducer Action (matches existing action.type values) ──

export type ReducerAction =
  | { type: "narrow"; filter: AppliedFilter; candidateCountAfter: number; resolvedInput: RecommendationInput }
  | { type: "skip_field"; field: string }
  | { type: "recommend"; candidateCountAfter: number; displayedCandidates: CandidateSnapshot[] }
  | { type: "ask_question"; field: string }
  | { type: "compare"; }
  | { type: "show_info"; infoType: string }
  | { type: "general_chat" }
  | { type: "reset" }
  | { type: "go_back"; candidateCountAfter: number; remainingFilters: AppliedFilter[] }
  | { type: "stock_filter"; candidateCountAfter: number }
  | { type: "passthrough"; overrides: Partial<ReducerOverrides> }

interface ReducerOverrides {
  candidateCount: number
  appliedFilters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  resolvedInput: RecommendationInput
  turnCount: number
  lastAskedField: string | null
  currentMode: string | null
  lastAction: string | null
  displayedCandidates: CandidateSnapshot[]
  displayedChips: string[]
}

// ── Reducer Result ──

export interface ReducerResult {
  nextState: ExplorationSessionState
  mutations: StateMutation[]
}

export interface StateMutation {
  field: string
  before: unknown
  after: unknown
}

// ── Pure Reducer Functions (per action type) ──

function reduceNarrow(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "narrow" }>,
): ReducerResult {
  const mutations: StateMutation[] = []

  const newFilters = [...prev.appliedFilters, action.filter]
  mutations.push({ field: "appliedFilters", before: prev.appliedFilters.length, after: newFilters.length })

  const newTurnCount = prev.turnCount + 1
  mutations.push({ field: "turnCount", before: prev.turnCount, after: newTurnCount })

  const newCandidateCount = action.candidateCountAfter
  mutations.push({ field: "candidateCount", before: prev.candidateCount, after: newCandidateCount })

  const newPhase = newCandidateCount <= 10 ? "recommendation" : prev.currentMode
  if (newPhase !== prev.currentMode) {
    mutations.push({ field: "currentMode", before: prev.currentMode, after: newPhase })
  }

  return {
    nextState: {
      ...prev,
      appliedFilters: newFilters,
      turnCount: newTurnCount,
      candidateCount: newCandidateCount,
      currentMode: newPhase,
      resolvedInput: action.resolvedInput,
      lastAction: "continue_narrowing",
      lastAskedField: null,
    },
    mutations,
  }
}

function reduceSkipField(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "skip_field" }>,
): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      lastAction: "skip_field",
      lastAskedField: null,
    },
    mutations: [
      { field: "turnCount", before: prev.turnCount, after: prev.turnCount + 1 },
      { field: "lastAskedField", before: prev.lastAskedField, after: null },
    ],
  }
}

function reduceRecommend(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "recommend" }>,
): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      currentMode: "recommendation",
      candidateCount: action.candidateCountAfter,
      displayedCandidates: action.displayedCandidates,
      lastAction: "show_recommendation",
    },
    mutations: [
      { field: "currentMode", before: prev.currentMode, after: "recommendation" },
      { field: "candidateCount", before: prev.candidateCount, after: action.candidateCountAfter },
    ],
  }
}

function reduceAskQuestion(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "ask_question" }>,
): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      lastAskedField: action.field,
      lastAction: "ask_question",
    },
    mutations: [
      { field: "lastAskedField", before: prev.lastAskedField, after: action.field },
    ],
  }
}

function reduceCompare(prev: ExplorationSessionState): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      lastAction: "compare_products",
    },
    mutations: [],
  }
}

function reduceShowInfo(prev: ExplorationSessionState): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      lastAction: "show_info",
    },
    mutations: [],
  }
}

function reduceGeneralChat(prev: ExplorationSessionState): ReducerResult {
  return {
    nextState: {
      ...prev,
      turnCount: prev.turnCount + 1,
      lastAction: "answer_general",
    },
    mutations: [],
  }
}

function reduceReset(): ReducerResult {
  // Return a minimal state — actual reset logic is in buildSessionState
  return {
    nextState: {} as ExplorationSessionState, // placeholder — actual reset handled by existing code
    mutations: [{ field: "*", before: "all", after: "reset" }],
  }
}

function reduceGoBack(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "go_back" }>,
): ReducerResult {
  return {
    nextState: {
      ...prev,
      appliedFilters: action.remainingFilters,
      candidateCount: action.candidateCountAfter,
      lastAction: "go_back",
    },
    mutations: [
      { field: "appliedFilters", before: prev.appliedFilters.length, after: action.remainingFilters.length },
      { field: "candidateCount", before: prev.candidateCount, after: action.candidateCountAfter },
    ],
  }
}

function reduceStockFilter(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "stock_filter" }>,
): ReducerResult {
  return {
    nextState: {
      ...prev,
      candidateCount: action.candidateCountAfter,
      lastAction: "filter_by_stock",
    },
    mutations: [
      { field: "candidateCount", before: prev.candidateCount, after: action.candidateCountAfter },
    ],
  }
}

function reducePassthrough(
  prev: ExplorationSessionState,
  action: Extract<ReducerAction, { type: "passthrough" }>,
): ReducerResult {
  const overrides = action.overrides
  const mutations: StateMutation[] = []
  const next = { ...prev }

  if (overrides.candidateCount !== undefined) {
    mutations.push({ field: "candidateCount", before: prev.candidateCount, after: overrides.candidateCount })
    next.candidateCount = overrides.candidateCount
  }
  if (overrides.turnCount !== undefined) {
    mutations.push({ field: "turnCount", before: prev.turnCount, after: overrides.turnCount })
    next.turnCount = overrides.turnCount
  }
  if (overrides.currentMode !== undefined) {
    mutations.push({ field: "currentMode", before: prev.currentMode, after: overrides.currentMode })
    next.currentMode = overrides.currentMode
  }
  if (overrides.lastAction !== undefined) {
    mutations.push({ field: "lastAction", before: prev.lastAction, after: overrides.lastAction })
    next.lastAction = overrides.lastAction
  }
  if (overrides.lastAskedField !== undefined) {
    mutations.push({ field: "lastAskedField", before: prev.lastAskedField, after: overrides.lastAskedField })
    next.lastAskedField = overrides.lastAskedField
  }

  return { nextState: next, mutations }
}

// ── Main Reducer Dispatch ──

export function reduce(
  prev: ExplorationSessionState,
  action: ReducerAction,
): ReducerResult {
  switch (action.type) {
    case "narrow": return reduceNarrow(prev, action)
    case "skip_field": return reduceSkipField(prev, action)
    case "recommend": return reduceRecommend(prev, action)
    case "ask_question": return reduceAskQuestion(prev, action)
    case "compare": return reduceCompare(prev)
    case "show_info": return reduceShowInfo(prev)
    case "general_chat": return reduceGeneralChat(prev)
    case "reset": return reduceReset()
    case "go_back": return reduceGoBack(prev, action)
    case "stock_filter": return reduceStockFilter(prev, action)
    case "passthrough": return reducePassthrough(prev, action)
  }
}

// ── Compare reducer output vs actual state (for shadow mode) ──

export interface ReducerComparison {
  match: boolean
  differences: Array<{ field: string; reducer: unknown; actual: unknown }>
}

export function compareReducerVsActual(
  reducerState: ExplorationSessionState,
  actualState: ExplorationSessionState,
): ReducerComparison {
  const differences: ReducerComparison["differences"] = []

  const fields: Array<{ field: string; get: (s: ExplorationSessionState) => unknown }> = [
    { field: "candidateCount", get: s => s.candidateCount },
    { field: "turnCount", get: s => s.turnCount },
    { field: "currentMode", get: s => s.currentMode },
    { field: "lastAction", get: s => s.lastAction },
    { field: "lastAskedField", get: s => s.lastAskedField },
    { field: "filterCount", get: s => s.appliedFilters?.length ?? 0 },
  ]

  for (const { field, get } of fields) {
    const rv = get(reducerState)
    const av = get(actualState)
    if (rv !== av) {
      differences.push({ field, reducer: rv, actual: av })
    }
  }

  return { match: differences.length === 0, differences }
}

// ── Dry-run helper for DebugTrace ──

export function dryRunReduce(
  prev: ExplorationSessionState,
  action: ReducerAction,
): { mutations: StateMutation[]; nextStateSummary: Record<string, unknown> } {
  const result = reduce(prev, action)
  return {
    mutations: result.mutations,
    nextStateSummary: {
      candidateCount: result.nextState.candidateCount,
      filterCount: result.nextState.appliedFilters?.length ?? 0,
      currentMode: result.nextState.currentMode,
      turnCount: result.nextState.turnCount,
      lastAction: result.nextState.lastAction,
      lastAskedField: result.nextState.lastAskedField,
    },
  }
}
