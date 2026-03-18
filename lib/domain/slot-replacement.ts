/**
 * SlotReplacementEngine — Encapsulates filter slot replacement logic.
 *
 * Handles:
 * - Removing old filter value for the target field
 * - Building new filter
 * - Rebuilding RecommendationInput from base + all filters
 * - Re-running retrieval
 * - Zero-candidate guard with automatic revert
 * - Narrowing history entry
 *
 * Copied pattern: LangGraph checkpointed operations with rollback.
 */

import type { AppliedFilter, NarrowingTurn } from "@/lib/types/exploration"
import type { RecommendationInput, ScoredProduct } from "@/lib/types/canonical"
import type { EvidenceSummary } from "@/lib/types/evidence"
import { runHybridRetrieval } from "@/lib/domain/hybrid-retrieval"

export interface SlotReplacementParams {
  field: string
  newValue: string
  displayValue?: string
  currentFilters: AppliedFilter[]
  baseInput: RecommendationInput
  currentInput: RecommendationInput
  turnCount: number
  prevCandidateCount: number
  applyFilterToInput: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
}

export interface SlotReplacementSuccess {
  success: true
  newFilters: AppliedFilter[]
  newFilter: AppliedFilter
  rebuiltInput: RecommendationInput
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  narrowingEntry: NarrowingTurn
  message: string
  oldValue: string
}

export interface SlotReplacementFailure {
  success: false
  revertedFilters: AppliedFilter[]
  revertedInput: RecommendationInput
  revertReason: string
  message: string
}

export type SlotReplacementResult = SlotReplacementSuccess | SlotReplacementFailure

export async function executeSlotReplacement(
  params: SlotReplacementParams
): Promise<SlotReplacementResult> {
  const {
    field, newValue, displayValue,
    currentFilters, baseInput, turnCount, prevCandidateCount,
    applyFilterToInput,
  } = params

  // Clone filters to avoid mutation until committed
  const filters = [...currentFilters]

  // Remove existing filter for this field
  const existingIdx = filters.findIndex(f => f.field === field && f.op !== "skip")
  let oldValue = "(없음)"
  let savedOldFilter: AppliedFilter | null = null
  if (existingIdx >= 0) {
    oldValue = filters[existingIdx].value
    savedOldFilter = { ...filters[existingIdx] }
    filters.splice(existingIdx, 1)
  }

  // Build new filter
  const isNumeric = !isNaN(Number(newValue))
  const newFilter: AppliedFilter = {
    field,
    op: isNumeric ? "eq" : "includes",
    value: displayValue ?? newValue,
    rawValue: isNumeric ? Number(newValue) : newValue,
    appliedAt: turnCount,
  }
  filters.push(newFilter)

  // Rebuild input from base + all filters
  let rebuiltInput = { ...baseInput }
  for (const f of filters) {
    rebuiltInput = applyFilterToInput(rebuiltInput, f)
  }

  // Re-run retrieval
  const result = await runHybridRetrieval(rebuiltInput, filters.filter(f => f.op !== "skip"))

  // Zero-candidate guard: revert if no candidates
  if (result.candidates.length === 0) {
    const revertedFilters = [...currentFilters]
    let revertedInput = { ...baseInput }
    for (const f of revertedFilters) {
      revertedInput = applyFilterToInput(revertedInput, f)
    }

    console.log(`[slot-replacement] ${field}=${newValue} → 0 candidates — REVERTED`)

    return {
      success: false,
      revertedFilters,
      revertedInput,
      revertReason: "zero_candidates",
      message: `"${displayValue ?? newValue}" 조건을 적용하면 후보가 없습니다. 현재 ${prevCandidateCount}개 후보에서 다른 값을 선택해주세요.`,
    }
  }

  // Build narrowing history entry
  const narrowingEntry: NarrowingTurn = {
    question: "slot-replace",
    answer: `${field}: ${oldValue} → ${displayValue ?? newValue}`,
    extractedFilters: [newFilter],
    candidateCountBefore: prevCandidateCount,
    candidateCountAfter: result.candidates.length,
  }

  const message = `${field}를 ${oldValue}에서 **${displayValue ?? newValue}**로 변경했습니다.\n후보가 ${result.candidates.length}개로 업데이트되었습니다.`

  console.log(`[slot-replacement] ${field}: ${oldValue} → ${newValue} | ${prevCandidateCount} → ${result.candidates.length} candidates`)

  return {
    success: true,
    newFilters: filters,
    newFilter,
    rebuiltInput,
    candidates: result.candidates,
    evidenceMap: result.evidenceMap,
    narrowingEntry,
    message,
    oldValue,
  }
}
