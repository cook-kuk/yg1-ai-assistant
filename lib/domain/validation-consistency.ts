/**
 * Validation & Consistency Checks — Deterministic state validation.
 *
 * All functions are non-blocking: they return warnings, never throw.
 * Used after state changes to detect inconsistencies early.
 */

import type {
  ExplorationSessionState,
  AppliedFilter,
  SeriesGroup,
  CandidateSnapshot,
  RecommendationCheckpoint,
} from "@/lib/types/exploration"

export interface ValidationWarning {
  code: string
  message: string
  severity: "warn" | "error"
}

/**
 * Validate that a slot replacement targets a field that exists in current filters.
 * Detects stale slot references.
 */
export function validateSlotReplacement(
  state: ExplorationSessionState,
  field: string,
  newValue: string
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  const existingFilter = state.appliedFilters.find(f => f.field === field && f.op !== "skip")
  if (!existingFilter) {
    warnings.push({
      code: "STALE_SLOT",
      message: `replace_slot for field="${field}" but no existing filter found — this is an add, not replace`,
      severity: "warn",
    })
  }

  if (existingFilter && String(existingFilter.rawValue) === newValue) {
    warnings.push({
      code: "NOOP_SLOT",
      message: `replace_slot for field="${field}" with same value "${newValue}" — no-op`,
      severity: "warn",
    })
  }

  return warnings
}

/**
 * Validate that claimed candidate count matches actual count.
 */
export function validateCountConsistency(
  claimed: number,
  actual: number
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  if (claimed !== actual) {
    warnings.push({
      code: "COUNT_MISMATCH",
      message: `State claims ${claimed} candidates but actual is ${actual}`,
      severity: claimed === 0 || actual === 0 ? "error" : "warn",
    })
  }

  return warnings
}

/**
 * Validate that series groups are consistent with the displayed candidates.
 * Checks: total member count == total candidates, no orphaned candidates.
 */
export function validateGroupDisplayConsistency(
  groups: SeriesGroup[],
  candidates: CandidateSnapshot[]
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  const totalGroupMembers = groups.reduce((sum, g) => sum + g.candidateCount, 0)
  if (totalGroupMembers !== candidates.length) {
    warnings.push({
      code: "GROUP_COUNT_MISMATCH",
      message: `Groups have ${totalGroupMembers} total members but ${candidates.length} candidates exist`,
      severity: "warn",
    })
  }

  // Check for candidates not in any group
  const groupedCodes = new Set(groups.flatMap(g => g.members.map(m => m.productCode)))
  const orphaned = candidates.filter(c => !groupedCodes.has(c.productCode))
  if (orphaned.length > 0) {
    warnings.push({
      code: "ORPHANED_CANDIDATES",
      message: `${orphaned.length} candidates not in any group: ${orphaned.slice(0, 3).map(c => c.productCode).join(", ")}`,
      severity: "warn",
    })
  }

  return warnings
}

/**
 * Validate checkpoint integrity against current state.
 * Checks: filter count consistency, input snapshot freshness.
 */
export function validateCheckpointIntegrity(
  checkpoint: RecommendationCheckpoint,
  state: ExplorationSessionState
): ValidationWarning[] {
  const warnings: ValidationWarning[] = []

  // Check that checkpoint filters are a subset of (or equal to) current filters
  if (checkpoint.filtersSnapshot.length > state.appliedFilters.length) {
    warnings.push({
      code: "CHECKPOINT_FILTER_EXCESS",
      message: `Checkpoint has ${checkpoint.filtersSnapshot.length} filters but state has ${state.appliedFilters.length}`,
      severity: "warn",
    })
  }

  // Check timestamp sanity
  if (checkpoint.timestamp > Date.now() + 60000) {
    warnings.push({
      code: "CHECKPOINT_FUTURE_TS",
      message: `Checkpoint timestamp is in the future`,
      severity: "error",
    })
  }

  return warnings
}

/**
 * Run all applicable validations and log warnings.
 * Non-blocking: always returns, never throws.
 */
export function runConsistencyValidation(
  state: ExplorationSessionState,
  actualCandidateCount: number,
  groups?: SeriesGroup[],
  candidates?: CandidateSnapshot[]
): void {
  const allWarnings: ValidationWarning[] = []

  // Count consistency
  allWarnings.push(...validateCountConsistency(state.candidateCount, actualCandidateCount))

  // Group consistency
  if (groups && candidates) {
    allWarnings.push(...validateGroupDisplayConsistency(groups, candidates))
  }

  // Checkpoint integrity (latest)
  if (state.currentTask?.checkpoints?.length) {
    const latest = state.currentTask.checkpoints[state.currentTask.checkpoints.length - 1]
    allWarnings.push(...validateCheckpointIntegrity(latest, state))
  }

  // Log warnings
  for (const w of allWarnings) {
    const level = w.severity === "error" ? "error" : "warn"
    console[level](`[validation:${w.code}] ${w.message}`)
  }
}
