/**
 * Turn Boundaries — Planner/Validator/Executor wrappers
 *
 * STEP 2 of incremental refactor.
 * Wraps existing orchestrateTurn output into structured PlannerResult.
 * Wraps existing action execution into executeAction.
 * NO behavior change — just boundary extraction for future refactoring.
 */

import type { TraceCollector } from "@/lib/debug/agent-trace"

// ── Planner Result (normalized from existing orchestrator) ──

export interface AgentInvocation {
  agent: string
  model: string
  durationMs: number
}

export interface PlannerResult {
  action: { type: string; [key: string]: unknown }
  reasoning: string | null
  rawExtractions: Array<{ field: string; rawValue: string; source: "explicit" | "inferred" }>
  confidence: "high" | "medium" | "low"
  agentsInvoked: AgentInvocation[]
  wasIntercepted: boolean
  originalActionType: string | null
}

/**
 * Normalize existing orchestrator result into PlannerResult.
 * Does NOT change any logic — just wraps the output.
 */
export function normalizePlannerResult(
  orchResult: { action: { type: string; [key: string]: unknown }; reasoning?: string | null; agentsInvoked: AgentInvocation[]; escalatedToOpus: boolean },
  finalAction: { type: string; [key: string]: unknown },
  wasIntercepted: boolean,
): PlannerResult {
  return {
    action: finalAction,
    reasoning: orchResult.reasoning ?? null,
    rawExtractions: extractRawParams(finalAction),
    confidence: orchResult.escalatedToOpus ? "low" : wasIntercepted ? "medium" : "high",
    agentsInvoked: orchResult.agentsInvoked,
    wasIntercepted,
    originalActionType: wasIntercepted ? orchResult.action.type : null,
  }
}

function extractRawParams(action: { type: string; [key: string]: unknown }): PlannerResult["rawExtractions"] {
  const extractions: PlannerResult["rawExtractions"] = []

  if (action.type === "continue_narrowing" && action.filter) {
    const filter = action.filter as { field?: string; value?: string }
    if (filter.field && filter.value) {
      extractions.push({ field: filter.field, rawValue: String(filter.value), source: "explicit" })
    }
  }

  return extractions
}

// ── Validator (minimal — log-only for now) ──

export interface ValidationResult {
  isValid: boolean
  action: PlannerResult["action"]
  warnings: string[]
}

/**
 * Validate planner result. For now: pass through, log warnings.
 * Future: reject invalid params, trigger ask_clarification.
 */
export function validatePlannerResult(
  plannerResult: PlannerResult,
  trace?: TraceCollector,
): ValidationResult {
  const warnings: string[] = []

  // Check for unknown action types
  const knownActions = [
    "continue_narrowing", "skip_field", "show_recommendation", "recommend",
    "compare_products", "answer_general", "redirect_off_topic",
    "reset_session", "go_back_one_step", "go_back_to_filter",
    "explain_product", "filter_by_stock",
  ]

  if (!knownActions.includes(plannerResult.action.type)) {
    warnings.push(`Unknown action type: "${plannerResult.action.type}"`)
  }

  // Check for empty filter in narrowing
  if (plannerResult.action.type === "continue_narrowing") {
    const filter = plannerResult.action.filter as { field?: string; value?: string } | undefined
    if (!filter?.field || !filter?.value) {
      warnings.push("continue_narrowing action has missing filter field/value")
    }
  }

  // Check for interception
  if (plannerResult.wasIntercepted) {
    warnings.push(`Action intercepted: ${plannerResult.originalActionType} → ${plannerResult.action.type}`)
  }

  // Log warnings to trace
  if (warnings.length > 0 && trace) {
    trace.add("validator", "validator", {
      actionType: plannerResult.action.type,
      warningCount: warnings.length,
    }, {
      warnings,
      isValid: true, // pass through for now
    }, warnings.join("; "))
  }

  return {
    isValid: true, // always pass through for now — future: block on critical errors
    action: plannerResult.action,
    warnings,
  }
}

// ── Executor Result (summary of what execution produced) ──

export interface ExecutorResultSummary {
  actionExecuted: string
  candidateCountAfter: number | null
  filterCountAfter: number
  responseType: "question" | "recommendation" | "comparison" | "info" | "reset" | "unknown"
  executionTimeMs: number
}

/**
 * Build executor result summary for DebugTrace.
 * Called AFTER existing execution logic runs.
 */
export function buildExecutorSummary(
  actionType: string,
  candidateCount: number | null,
  filterCount: number,
  responseType: string,
  startTime: number,
): ExecutorResultSummary {
  return {
    actionExecuted: actionType,
    candidateCountAfter: candidateCount,
    filterCountAfter: filterCount,
    responseType: (responseType as ExecutorResultSummary["responseType"]) ?? "unknown",
    executionTimeMs: Date.now() - startTime,
  }
}
