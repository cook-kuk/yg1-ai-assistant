/**
 * Context Interpretation Types — Structured interpretation of conversation state.
 *
 * The context interpreter produces this before chip/option generation.
 * Deterministic, serializable, easy for downstream logic to consume.
 */

// ── Context Mode ─────────────────────────────────────────────
export type ContextMode =
  | "intake"
  | "narrowing"
  | "recommended"
  | "repair"
  | "explore"
  | "compare"
  | "reset"

// ── Intent Shift ─────────────────────────────────────────────
export type IntentShift =
  | "none"
  | "refine_existing"
  | "replace_constraint"
  | "branch_exploration"
  | "compare_products"
  | "explain_recommendation"
  | "restart"

// ── Active Constraint ────────────────────────────────────────
export interface ActiveConstraint {
  field: string
  value: string
  source: "intake" | "narrowing" | "repair" | "user_followup"
  durable: boolean  // true = intake fact, false = narrowing/temporary
}

// ── Conflict ─────────────────────────────────────────────────
export interface DetectedConflict {
  newField: string
  newValue: string
  conflictingConstraints: Array<{ field: string; value: string }>
  severity: "soft" | "hard"  // soft = may coexist, hard = incompatible
}

// ── Context Interpretation ───────────────────────────────────
export interface ContextInterpretation {
  mode: ContextMode
  intentShift: IntentShift
  activeConstraints: ActiveConstraint[]
  resolvedFacts: Array<{ field: string; value: string }>
  temporaryFilters: Array<{ field: string; value: string }>
  referencedProducts: string[]
  referencedField: string | null
  preserveContext: boolean
  hasConflict: boolean
  detectedConflicts: DetectedConflict[]
  shouldAskFollowup: boolean
  shouldGenerateRepairOptions: boolean
  suggestedNextAction: "narrow" | "repair" | "compare" | "explain" | "recommend" | "reset" | "ask_clarification"
  /** Fields already answered — avoid re-asking */
  answeredFields: string[]
  /** How many turns have been in the current narrowing flow */
  conversationDepth: number
}
