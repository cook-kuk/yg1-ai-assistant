/**
 * Tool Result Aggregator — Merges multiple tool results into a structured aggregate.
 *
 * Handles:
 * - partial success (some tools succeeded, some failed)
 * - missing evidence detection
 * - conflict detection across tool results
 * - evidence summary generation
 *
 * Deterministic. No LLM calls.
 */

import type { ToolPlan, ToolResult, AggregatedToolResults } from "./tool-types"

/**
 * Aggregate results from multiple tool calls into a unified result.
 */
export function aggregateToolResults(
  plan: ToolPlan,
  results: ToolResult[]
): AggregatedToolResults {
  const allSucceeded = results.every(r => r.status === "success")

  // Detect missing evidence from required tools
  const missingEvidence: string[] = []
  for (const planned of plan.plannedCalls) {
    if (!planned.required) continue
    const result = results.find(r => r.tool === planned.tool)
    if (!result || result.status === "not_found" || result.status === "error") {
      missingEvidence.push(`${planned.purpose} (${planned.tool})`)
    }
  }

  // Detect conflicts across results
  const conflicts = detectConflicts(results)

  // Build evidence summary
  const successResults = results.filter(r => r.status === "success" || r.status === "partial")
  const evidenceSummary = successResults.length > 0
    ? successResults.map(r => r.evidenceSummary).filter(Boolean).join(" | ")
    : "확인된 정보가 없습니다."

  return {
    plan,
    results,
    allSucceeded,
    missingEvidence,
    conflicts,
    evidenceSummary,
  }
}

/**
 * Detect conflicts between tool results.
 * For example, two different series lookups might have conflicting spec data.
 */
function detectConflicts(results: ToolResult[]): string[] {
  const conflicts: string[] = []

  // Check for conflicting product recommendations
  const productSets = results
    .filter(r => r.data.products && Array.isArray(r.data.products))
    .map(r => new Set((r.data.products as Array<{ code: string }>).map(p => p.code)))

  if (productSets.length >= 2) {
    const overlap = [...productSets[0]].filter(code => productSets[1].has(code))
    if (overlap.length === 0 && productSets[0].size > 0 && productSets[1].size > 0) {
      conflicts.push("비교 대상 시리즈에 공통 제품이 없습니다.")
    }
  }

  return conflicts
}

/**
 * Generate a no-speculation answer suffix when evidence is missing.
 */
export function buildMissingEvidenceNote(missing: string[]): string {
  if (missing.length === 0) return ""
  return `\n\n⚠ 확인되지 않은 정보: ${missing.join(", ")}. 이 정보는 현재 DB에서 확인할 수 없습니다.`
}

/**
 * Check if the aggregate has enough evidence to answer the question.
 */
export function hasMinimumEvidence(aggregate: AggregatedToolResults): boolean {
  const requiredCount = aggregate.plan.plannedCalls.filter(c => c.required).length
  const successCount = aggregate.results.filter(r => r.status === "success" || r.status === "partial").length
  return successCount > 0 && aggregate.missingEvidence.length < requiredCount
}
