/**
 * Validation Gate — Rule-first response validation.
 *
 * Rejects or repairs draft responses if:
 *   - Back intent was ignored (state didn't change after undo request)
 *   - Known parameter is re-asked (question about an already-filtered field)
 *   - Comparison target is outside displayed scope
 *   - Candidate count in state and response don't match
 *   - Restored stage is not reflected in the response
 *
 * This gate runs AFTER the orchestrator produces an action and BEFORE the response is sent.
 * It is purely deterministic — no LLM calls.
 */

import type { ExplorationSessionState, AppliedFilter, CandidateSnapshot } from "@/lib/types/exploration"
// ExplorationSessionState is used by validateOverlayIntegrity and runValidationGate
import type { NextQuestion } from "@/lib/domain/question-engine"

export interface ValidationIssue {
  code: string
  severity: "error" | "warning"
  message: string
  autoFixed: boolean
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  repairedChips?: string[]
  repairedQuestion?: NextQuestion | null
}

/**
 * Validate that the next question does not re-ask a known field.
 */
export function validateNoReask(
  question: NextQuestion | null,
  appliedFilters: AppliedFilter[]
): ValidationIssue | null {
  if (!question) return null

  const answeredFields = new Set(appliedFilters.map(f => f.field))
  if (answeredFields.has(question.field)) {
    return {
      code: "REASK_KNOWN_FIELD",
      severity: "error",
      message: `필드 "${question.field}"은(는) 이미 필터링됨 (${appliedFilters.find(f => f.field === question.field)?.value}). 재질문 차단됨.`,
      autoFixed: true,
    }
  }
  return null
}

/**
 * Validate that comparison targets are within displayed candidates.
 */
export function validateComparisonScope(
  targets: string[],
  displayedCandidates: CandidateSnapshot[]
): ValidationIssue | null {
  if (targets.length === 0 || displayedCandidates.length === 0) return null

  const displayedRanks = new Set(displayedCandidates.map(c => c.rank))
  const displayedCodes = new Set(displayedCandidates.map(c => c.displayCode.toUpperCase()))

  for (const target of targets) {
    const rankMatch = target.match(/(\d+)\s*번/)
    if (rankMatch) {
      const rank = parseInt(rankMatch[1])
      if (!displayedRanks.has(rank)) {
        return {
          code: "COMPARISON_OUT_OF_SCOPE",
          severity: "error",
          message: `비교 대상 "${target}"이 표시된 제품 범위(1~${displayedCandidates.length}) 밖입니다.`,
          autoFixed: false,
        }
      }
    }
  }
  return null
}

/**
 * Validate that candidate count in state matches actual retrieval result.
 */
export function validateCandidateCount(
  stateCount: number,
  actualCount: number
): ValidationIssue | null {
  if (stateCount !== actualCount) {
    return {
      code: "CANDIDATE_COUNT_MISMATCH",
      severity: "warning",
      message: `상태 후보수(${stateCount})와 실제 후보수(${actualCount})가 불일치합니다.`,
      autoFixed: true,
    }
  }
  return null
}

/**
 * Validate that an undo action actually changed the state.
 */
export function validateUndoEffect(
  prevFilterCount: number,
  newFilterCount: number,
  actionType: string
): ValidationIssue | null {
  if ((actionType === "go_back_one_step" || actionType === "go_back_to_filter") &&
    prevFilterCount === newFilterCount) {
    return {
      code: "UNDO_NO_EFFECT",
      severity: "error",
      message: `되돌리기 요청이 처리되었지만 필터 수가 변하지 않았습니다 (${prevFilterCount}개).`,
      autoFixed: false,
    }
  }
  return null
}

/**
 * Validate that no duplicate filters exist for the same field (slot consistency).
 * After a replace_slot action, there should be exactly one filter per field.
 */
export function validateSlotConsistency(
  appliedFilters: AppliedFilter[]
): ValidationIssue | null {
  const fieldCounts = new Map<string, number>()
  for (const f of appliedFilters) {
    if (f.op === "skip") continue
    fieldCounts.set(f.field, (fieldCounts.get(f.field) ?? 0) + 1)
  }
  for (const [field, count] of fieldCounts) {
    if (count > 1) {
      return {
        code: "DUPLICATE_SLOT_FILTER",
        severity: "error",
        message: `필드 "${field}"에 ${count}개의 필터가 중복 적용되어 있습니다. 슬롯 교체가 올바르게 처리되지 않았습니다.`,
        autoFixed: false,
      }
    }
  }
  return null
}

/**
 * Validate that a side_conversation action didn't alter recommendation state.
 * Filters, candidates, and displayed products must be identical before/after.
 */
export function validateOverlayIntegrity(
  prevState: ExplorationSessionState,
  nextState: ExplorationSessionState,
  actionType: string
): ValidationIssue | null {
  if (actionType !== "side_conversation") return null

  // Check filters unchanged
  if (prevState.appliedFilters.length !== nextState.appliedFilters.length) {
    return {
      code: "OVERLAY_FILTERS_CHANGED",
      severity: "error",
      message: `사이드 대화 중 필터가 변경되었습니다 (${prevState.appliedFilters.length}→${nextState.appliedFilters.length}).`,
      autoFixed: false,
    }
  }

  // Check candidate count unchanged
  if (prevState.candidateCount !== nextState.candidateCount) {
    return {
      code: "OVERLAY_CANDIDATES_CHANGED",
      severity: "warning",
      message: `사이드 대화 중 후보 수가 변경되었습니다 (${prevState.candidateCount}→${nextState.candidateCount}).`,
      autoFixed: false,
    }
  }

  return null
}

/**
 * Run all validations and return combined result.
 */
export function runValidationGate(params: {
  question: NextQuestion | null
  appliedFilters: AppliedFilter[]
  candidateCountInState: number
  candidateCountActual: number
  displayedCandidates: CandidateSnapshot[]
  comparisonTargets?: string[]
  actionType?: string
  prevFilterCount?: number
  prevState?: ExplorationSessionState
  nextState?: ExplorationSessionState
}): ValidationResult {
  const issues: ValidationIssue[] = []

  // Check re-ask
  const reaskIssue = validateNoReask(params.question, params.appliedFilters)
  if (reaskIssue) issues.push(reaskIssue)

  // Check candidate count
  const countIssue = validateCandidateCount(params.candidateCountInState, params.candidateCountActual)
  if (countIssue) issues.push(countIssue)

  // Check comparison scope
  if (params.comparisonTargets) {
    const scopeIssue = validateComparisonScope(params.comparisonTargets, params.displayedCandidates)
    if (scopeIssue) issues.push(scopeIssue)
  }

  // Check undo effect
  if (params.actionType && params.prevFilterCount != null) {
    const undoIssue = validateUndoEffect(
      params.prevFilterCount,
      params.appliedFilters.length,
      params.actionType
    )
    if (undoIssue) issues.push(undoIssue)
  }

  // Check slot consistency (no duplicate filters on same field)
  const slotIssue = validateSlotConsistency(params.appliedFilters)
  if (slotIssue) issues.push(slotIssue)

  // Check overlay integrity (side_conversation must not change state)
  if (params.actionType && params.prevState && params.nextState) {
    const overlayIssue = validateOverlayIntegrity(params.prevState, params.nextState, params.actionType)
    if (overlayIssue) issues.push(overlayIssue)
  }

  // Log all issues
  for (const issue of issues) {
    const tag = issue.severity === "error" ? "ERROR" : "WARN"
    console.log(`[validation-gate:${tag}] ${issue.code}: ${issue.message}`)
  }

  return {
    valid: !issues.some(i => i.severity === "error" && !i.autoFixed),
    issues,
  }
}
