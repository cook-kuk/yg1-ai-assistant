/**
 * Smart Option Types — Structured option model for the recommendation state machine.
 *
 * Every selectable option has a stable id, family, and executable plan.
 * displayedOptions remains the source of truth for selectable UI actions.
 */

// ── Option Family ────────────────────────────────────────────
export type SmartOptionFamily = "narrowing" | "repair" | "action" | "explore" | "compare" | "reset"

// ── Option Plan ──────────────────────────────────────────────
export type SmartOptionPlanType = "apply_filter" | "replace_filter" | "relax_filters" | "branch_session" | "compare_products" | "explain_recommendation" | "reset_session"

export interface SmartOptionPatch {
  op: "add" | "remove" | "replace"
  field: string
  value?: string | number
}

export interface SmartOptionPlan {
  type: SmartOptionPlanType
  patches: SmartOptionPatch[]
}

// ── Smart Option ─────────────────────────────────────────────
export interface SmartOption {
  id: string
  family: SmartOptionFamily
  label: string
  subtitle?: string
  field?: string
  value?: string
  reason?: string
  projectedCount: number | null
  projectedDelta: number | null
  preservesContext: boolean
  destructive: boolean
  recommended: boolean
  priorityScore: number
  plan: SmartOptionPlan
}

// ── Planner Context ──────────────────────────────────────────
export interface OptionPlannerContext {
  mode: "intake" | "narrowing" | "recommended" | "repair"
  candidateCount: number
  appliedFilters: Array<{
    field: string
    op: string
    value: string
    rawValue: string | number | boolean | Array<string | number | boolean>
  }>
  resolvedInput: Record<string, unknown>
  lastAskedField?: string
  lastAction?: string
  userMessage?: string
  /** Available values per field from current candidates */
  candidateFieldValues?: Map<string, Map<string, number>>
  /** Top candidates for post-recommendation actions */
  topCandidates?: Array<{ displayCode: string; seriesName: string | null; coating: string | null; fluteCount: number | null; diameterMm: number | null; score: number; matchStatus: string }>
  /** Field that conflicts with current filters */
  conflictField?: string
  conflictValue?: string
  /** Context interpretation (when available) */
  contextInterpretation?: import("../context/context-types").ContextInterpretation
  /** Conversation memory (when available) */
  conversationMemory?: import("../memory/conversation-memory").ConversationMemory
  /** Currently displayed products — for context-aware post-recommendation chips */
  displayedProducts?: Array<{ displayCode: string; seriesName: string | null; coating: string | null; fluteCount: number | null; stockStatus?: string }>
  /** Whether recommendation/comparison/cutting-condition artifacts are visible */
  visibleArtifacts?: {
    hasRecommendation: boolean
    hasComparison: boolean
    hasCuttingConditions: boolean
  }
}

// ── Ranking Signals ──────────────────────────────────────────
export interface NarrowingSignals {
  infoGain: number
  answerability: number
  feasibility: number
  continuity: number
  businessValue: number
}

export interface RepairSignals {
  projectedSuccess: number
  minimalChange: number
  contextPreservation: number
  inventoryReadiness: number
  clarity: number
  destructivePenalty: number
}

export interface ActionSignals {
  intentFit: number
  expectedUtility: number
  explainability: number
  continuity: number
  novelty: number
}
