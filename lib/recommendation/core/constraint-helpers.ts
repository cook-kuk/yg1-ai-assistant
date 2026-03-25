/**
 * Constraint Helpers — Pure functions for manipulating ConstraintState.
 *
 * All mutations return a new state object (immutable).
 */

import type { ConstraintState, RecommendationSessionState, RevisionNode, ResolvedAction } from "./types"

// ── Base Constraint Operations ─────────────────────────────

/** Set a base constraint (only if field is not already set). */
export function setBaseConstraint(
  state: RecommendationSessionState,
  field: string,
  value: string | number | boolean
): RecommendationSessionState {
  const base = { ...state.constraints.base }
  if (field in base) {
    // Field already exists — no-op to avoid accidental overwrites.
    // Use replaceBaseConstraint for intentional replacement.
    return state
  }
  base[field] = value
  return {
    ...state,
    constraints: { ...state.constraints, base },
  }
}

/** Replace a base constraint (overwrites existing or sets new). */
export function replaceBaseConstraint(
  state: RecommendationSessionState,
  field: string,
  value: string | number | boolean
): RecommendationSessionState {
  const base = { ...state.constraints.base }
  base[field] = value
  return {
    ...state,
    constraints: { ...state.constraints, base },
  }
}

// ── Refinement Operations ──────────────────────────────────

/** Apply a refinement constraint (narrowing-phase filters). */
export function applyRefinement(
  state: RecommendationSessionState,
  field: string,
  value: string | number | boolean
): RecommendationSessionState {
  const refinements = { ...state.constraints.refinements }
  refinements[field] = value
  return {
    ...state,
    constraints: { ...state.constraints, refinements },
  }
}

/** Remove a refinement constraint by field name. */
export function removeRefinement(
  state: RecommendationSessionState,
  field: string
): RecommendationSessionState {
  const refinements = { ...state.constraints.refinements }
  if (!(field in refinements)) return state
  delete refinements[field]
  return {
    ...state,
    constraints: { ...state.constraints, refinements },
  }
}

// ── Revision Node ──────────────────────────────────────────

/** Create a RevisionNode recording a state change and append it to the session. */
export function createRevisionNode(
  state: RecommendationSessionState,
  action: ResolvedAction,
  candidateCountAfter: number | null = null
): RecommendationSessionState {
  const revisionId = `rev-${Date.now()}-${state.revisionNodes.length}`
  const parentRevisionId = state.currentRevisionId

  // Apply the action to produce constraintsAfter
  const constraintsAfter = applyActionToConstraints(state.constraints, action)

  const node: RevisionNode = {
    revisionId,
    parentRevisionId,
    action,
    constraintsBefore: { ...state.constraints },
    constraintsAfter,
    candidateCountBefore: state.resultContext?.totalConsidered ?? 0,
    candidateCountAfter,
    timestamp: Date.now(),
  }

  return {
    ...state,
    constraints: constraintsAfter,
    revisionNodes: [...state.revisionNodes, node],
    currentRevisionId: revisionId,
  }
}

// ── Internal Helpers ───────────────────────────────────────

function applyActionToConstraints(constraints: ConstraintState, action: ResolvedAction): ConstraintState {
  const base = { ...constraints.base }
  const refinements = { ...constraints.refinements }

  switch (action.type) {
    case "set_base_constraint":
      if (action.field && action.newValue != null) {
        base[action.field] = action.newValue
      }
      break
    case "replace_base_constraint":
      if (action.field && action.newValue != null) {
        base[action.field] = action.newValue
      }
      break
    case "apply_refinement":
      if (action.field && action.newValue != null) {
        refinements[action.field] = action.newValue
      }
      break
    case "remove_refinement":
      if (action.field) {
        delete refinements[action.field]
      }
      break
    case "reset_constraints":
      return { base: {}, refinements: {} }
    case "no_op":
      break
  }

  return { base, refinements }
}
