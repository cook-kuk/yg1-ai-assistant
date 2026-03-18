/**
 * Task Manager — Manages recommendation tasks, checkpoints, and restoration.
 *
 * Owns:
 *   - Checkpoint creation (deterministic summary, no LLM)
 *   - Task lifecycle (create, archive, restore)
 *   - Restoration from checkpoint or archived task
 */

import type {
  RecommendationCheckpoint,
  RecommendationTask,
  ArchivedTask,
  AppliedFilter,
  SeriesGroupSummary,
  ExplorationSessionState,
} from "@/lib/types/exploration"
import type { RecommendationInput } from "@/lib/types/canonical"

// ════════════════════════════════════════════════════════════════
// CHECKPOINT MANAGEMENT
// ════════════════════════════════════════════════════════════════

/**
 * Create a checkpoint from the current state.
 * Summary is deterministic (filter + count based, no LLM).
 */
export function createCheckpoint(
  state: ExplorationSessionState,
  groups: SeriesGroupSummary[],
  filter: AppliedFilter | null
): RecommendationCheckpoint {
  return {
    checkpointId: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stepIndex: state.turnCount,
    summary: buildCheckpointSummary(state, filter),
    candidateCount: state.candidateCount,
    resolvedInputSnapshot: { ...state.resolvedInput },
    filtersSnapshot: [...state.appliedFilters],
    displayedGroups: groups,
    filterApplied: filter ? { ...filter } : null,
    timestamp: Date.now(),
  }
}

/**
 * Build a deterministic summary string for a checkpoint.
 * Format: "[필터1, 필터2, ...] → N개 후보"
 */
export function buildCheckpointSummary(
  state: ExplorationSessionState,
  filter: AppliedFilter | null
): string {
  const activeFilters = state.appliedFilters.filter(f => f.op !== "skip")
  const filterDesc = activeFilters.length > 0
    ? activeFilters.map(f => `${f.field}=${f.value}`).join(", ")
    : "초기 검색"

  const filterNote = filter
    ? ` (+${filter.field}=${filter.value})`
    : ""

  return `[${filterDesc}${filterNote}] → ${state.candidateCount}개 후보`
}

/**
 * Restore state from a checkpoint.
 * Returns the input and filters needed to re-run retrieval.
 */
export function restoreFromCheckpoint(
  checkpoint: RecommendationCheckpoint
): { rebuiltInput: RecommendationInput; remainingFilters: AppliedFilter[] } {
  return {
    rebuiltInput: { ...checkpoint.resolvedInputSnapshot },
    remainingFilters: [...checkpoint.filtersSnapshot],
  }
}

// ════════════════════════════════════════════════════════════════
// TASK LIFECYCLE
// ════════════════════════════════════════════════════════════════

/**
 * Create a new recommendation task.
 */
export function createTask(intakeSummary: string): RecommendationTask {
  return {
    taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    intakeSummary,
    checkpoints: [],
    finalCandidateCount: null,
    status: "active",
  }
}

/**
 * Archive a task (freeze it for later restoration).
 */
export function archiveTask(task: RecommendationTask): ArchivedTask {
  const lastCheckpoint = task.checkpoints[task.checkpoints.length - 1]
  if (!lastCheckpoint) {
    // Create a minimal checkpoint if none exist
    throw new Error("Cannot archive task with no checkpoints")
  }

  return {
    taskId: task.taskId,
    createdAt: task.createdAt,
    intakeSummary: task.intakeSummary,
    checkpointCount: task.checkpoints.length,
    finalCheckpoint: lastCheckpoint,
    status: "archived",
  }
}

/**
 * Restore state from an archived task.
 * Uses the final checkpoint to rebuild input + filters.
 */
export function restoreFromArchivedTask(
  archived: ArchivedTask
): { rebuiltInput: RecommendationInput; remainingFilters: AppliedFilter[] } {
  return restoreFromCheckpoint(archived.finalCheckpoint)
}

/**
 * Add a checkpoint to the current task (mutates task).
 */
export function addCheckpointToTask(
  task: RecommendationTask,
  checkpoint: RecommendationCheckpoint
): void {
  task.checkpoints.push(checkpoint)
  task.finalCandidateCount = checkpoint.candidateCount
}

/**
 * Build a task intake summary from the session state.
 * Deterministic: based on resolvedInput fields.
 */
export function buildTaskIntakeSummary(input: RecommendationInput): string {
  const parts: string[] = []
  if (input.material) parts.push(`소재: ${input.material}`)
  if (input.diameterMm) parts.push(`직경: ${input.diameterMm}mm`)
  if (input.operationType) parts.push(`가공: ${input.operationType}`)
  if (input.toolType) parts.push(`공구: ${input.toolType}`)
  return parts.length > 0 ? parts.join(" | ") : "조건 미지정"
}
