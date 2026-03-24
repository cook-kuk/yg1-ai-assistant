/**
 * Multi-tool orchestration types.
 *
 * Enables planning multiple tool calls for a single user question,
 * aggregating results, and synthesizing answers from structured evidence.
 */

export type ToolName =
  | "candidate_search"
  | "series_lookup"
  | "brand_lookup"
  | "product_lookup"
  | "comparison"
  | "count_aggregation"
  | "inventory_lookup"
  | "cutting_condition_lookup"
  | "field_distribution"
  | "explanation"

export interface PlannedToolCall {
  tool: ToolName
  purpose: string
  priority: number
  required: boolean
  inputSummary: Record<string, unknown>
}

export type AnswerTopic =
  | "series_info"
  | "series_comparison"
  | "brand_info"
  | "brand_comparison"
  | "product_comparison"
  | "count_query"
  | "spec_query"
  | "inventory_query"
  | "cutting_condition_query"
  | "scope_clarification"
  | "result_followup"
  | "field_explanation"
  | "general"

export interface ToolPlan {
  answerTopic: AnswerTopic
  searchScopeConstraints: Record<string, unknown>
  targetEntities: string[]
  plannedCalls: PlannedToolCall[]
}

export type ToolResultStatus = "success" | "partial" | "not_found" | "error"

export interface ToolResult {
  tool: ToolName
  status: ToolResultStatus
  data: Record<string, unknown>
  evidenceSummary: string
}

export interface AggregatedToolResults {
  plan: ToolPlan
  results: ToolResult[]
  allSucceeded: boolean
  missingEvidence: string[]
  conflicts: string[]
  evidenceSummary: string
}
