/**
 * Core Types — V2 Recommendation Engine
 *
 * These types define the next-generation recommendation session model.
 * They coexist with the legacy ExplorationSessionState during migration.
 */

import type { DisplayedOption, CandidateSnapshot } from "@/lib/types/exploration"

// ── Journey Phase ──────────────────────────────────────────
export type JourneyPhase =
  | "intake"
  | "narrowing"
  | "results_displayed"
  | "post_result_exploration"
  | "comparison"
  | "revision"

// ── Constraint State ───────────────────────────────────────
/** Tracks all user-provided constraints, split into base (initial) and refinements (narrowing). */
export interface ConstraintState {
  /** Base constraints from intake (e.g., diameter, material, tool type) */
  base: Record<string, string | number | boolean>
  /** Refinements added during narrowing (e.g., coating, flute count) */
  refinements: Record<string, string | number | boolean>
}

// ── Candidate Reference ────────────────────────────────────
/** Lightweight reference to a candidate product (avoids sending full product data). */
export interface CandidateRef {
  productCode: string
  displayCode: string
  rank: number
  score: number
  seriesName: string | null
  /** Optional key specs carried forward for in-memory refinement */
  keySpecs?: {
    flute?: number | null
    coating?: string | null
    hasInventory?: boolean
  }
}

// ── Result Context ─────────────────────────────────────────
/** Snapshot of the current result set and how it was produced. */
export interface ResultContext {
  candidates: CandidateRef[]
  totalConsidered: number
  searchTimestamp: number
  constraintsUsed: ConstraintState
}

// ── Pending Question ───────────────────────────────────────
/** A question the system is waiting for the user to answer. */
export interface PendingQuestion {
  field: string
  questionText: string
  options: DisplayedOption[]
  turnAsked: number
  context: string | null
}

// ── Pending Action ─────────────────────────────────────────
/** A proposed action awaiting user confirmation (e.g., "apply this filter?"). */
export interface PendingAction {
  type: "apply_filter" | "open_comparison" | "show_cutting_conditions" | "show_inventory" | "delegate_choice" | "resume_flow"
  label: string
  payload: {
    field?: string
    value?: string
    productIds?: string[]
  }
  sourceTurnId: string
  createdAt: number
  expiresAfterTurns: number
}

// ── Revision Node ──────────────────────────────────────────
/** An immutable record of a state change in the session history. */
export interface RevisionNode {
  revisionId: string
  parentRevisionId: string | null
  action: ResolvedAction
  constraintsBefore: ConstraintState
  constraintsAfter: ConstraintState
  candidateCountBefore: number
  candidateCountAfter: number | null
  timestamp: number
}

// ── Resolved Action ────────────────────────────────────────
/** The concrete action that was applied to the session state. */
export interface ResolvedAction {
  type:
    | "set_base_constraint"
    | "replace_base_constraint"
    | "apply_refinement"
    | "remove_refinement"
    | "reset_constraints"
    | "no_op"
  field: string | null
  oldValue: string | number | boolean | null
  newValue: string | number | boolean | null
}

// ── Turn Snapshot ──────────────────────────────────────────
/** Immutable snapshot of the session at the start of a turn (input to LLM). */
export interface TurnSnapshot {
  snapshotId: string
  userMessage: string
  journeyPhase: JourneyPhase
  constraints: ConstraintState
  pendingQuestion: PendingQuestion | null
  pendingAction: PendingAction | null
  latestResultContext: ResultContext | null
  displayedProducts: CandidateRef[]
  recentTurns: Array<{ role: "user" | "assistant"; text: string }>
  revisionSummary: string
  sideThreadActive: boolean
}

// ── LLM Turn Decision ──────────────────────────────────────
/** The LLM's interpretation and plan for the current turn. */
export interface LlmTurnDecision {
  phaseInterpretation: {
    currentPhase: JourneyPhase
    confidence: number
  }
  actionInterpretation: {
    type:
      | "continue_narrowing"
      | "replace_slot"
      | "show_recommendation"
      | "go_back"
      | "compare_products"
      | "answer_general"
      | "redirect_off_topic"
      | "reset_session"
      | "skip_field"
      | "ask_clarification"
      | "refine_current_results"
    rationale: string
    confidence: number
  }
  answerIntent: {
    topic: string
    needsGroundedFact: boolean
    shouldUseCurrentResultContext: boolean
    shouldResumePendingQuestion: boolean
  }
  nextQuestion?: {
    field: string
    suggestedOptions: Array<{ label: string; value: string }>
    allowSkip: boolean
  }
  uiPlan: {
    optionMode: "question_options" | "result_followups" | "none" | "comparison_options" | "no_options"
  }
  answerDraft: string
}

// ── Recommendation Session State ───────────────────────────
/** The full V2 session state. Serializable, sent between client and server. */
export interface RecommendationSessionState {
  journeyPhase: JourneyPhase
  constraints: ConstraintState
  resultContext: ResultContext | null
  pendingQuestion: PendingQuestion | null
  pendingAction: PendingAction | null
  revisionNodes: RevisionNode[]
  currentRevisionId: string | null
  sideThreadActive: boolean
  turnCount: number
}

// ── Turn Result ────────────────────────────────────────────
/** The output of a single turn through the V2 orchestrator. */
export interface TurnResult {
  answer: string
  displayedOptions: DisplayedOption[]
  chips: string[]
  sessionState: RecommendationSessionState
  trace: {
    snapshotId: string
    phase: JourneyPhase
    action: string
    confidence: number
    searchExecuted: boolean
    validated: boolean
  }
}
