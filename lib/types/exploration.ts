// ============================================================
// YG-1 AI Assistant — Product Exploration Session Types
// Tracks the full narrowing conversation state.
// Passed between client ↔ server (stateless server).
// ============================================================

import type { ScoredProduct, RecommendationInput, ChatMessage } from "./canonical"
import type { ProductIntakeForm } from "./intake"
import type { EvidenceSummary } from "./evidence"

// ── Resolution Status ────────────────────────────────────────
export type ResolutionStatus =
  | "broad"                // many candidates, needs narrowing
  | "narrowing"            // actively asking questions
  | "resolved_exact"       // found exact match(es)
  | "resolved_approximate" // best available are approximate
  | "resolved_none"        // no candidates match

// ── Applied Filter ───────────────────────────────────────────
export interface AppliedFilter {
  field: string            // e.g. "fluteCount", "coating", "cuttingType"
  op: string               // "eq", "includes", "range"
  value: string            // display value (e.g. "4날", "AlTiN")
  rawValue: string | number // actual filter value
  appliedAt: number        // narrowing turn index
}

// ── Narrowing Turn ───────────────────────────────────────────
export interface NarrowingTurn {
  question: string
  answer: string
  extractedFilters: AppliedFilter[]
  candidateCountBefore: number
  candidateCountAfter: number
}

// ── Stage Snapshot (for back-navigation) ─────────────────────
/** Immutable snapshot of the narrowing state at each step */
export interface NarrowingStage {
  stepIndex: number
  stageName: string                    // e.g. "initial_search", "toolSubtype_Square", "fluteCount_4"
  filterApplied: AppliedFilter | null  // null for initial stage
  candidateCount: number
  resolvedInputSnapshot: RecommendationInput  // full input state at this stage
  filtersSnapshot: AppliedFilter[]     // all filters up to this point
}

// ── Last Action Record ────────────────────────────────────────
export type LastActionType =
  | "start_exploration"
  | "continue_narrowing"
  | "replace_slot"
  | "skip_field"
  | "show_recommendation"
  | "go_back_one_step"
  | "go_back_to_filter"
  | "compare_products"
  | "explain_product"
  | "confirm_scope"
  | "side_conversation"
  | "answer_general"
  | "redirect_off_topic"
  | "reset_session"

// ── Session State (serializable, sent between client ↔ server) ──
export interface ExplorationSessionState {
  sessionId: string
  candidateCount: number
  appliedFilters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  stageHistory: NarrowingStage[]       // ordered stage snapshots for back-navigation
  resolutionStatus: ResolutionStatus
  resolvedInput: RecommendationInput   // accumulated from intake + narrowing
  turnCount: number
  lastAskedField?: string              // which field the question engine just asked about

  // ── Durable UI context (single source of truth) ──
  displayedCandidates: CandidateSnapshot[]  // what the user currently sees
  displayedChips: string[]                  // chips shown with the last question
  displayedOptions: DisplayedOption[]       // structured narrowing options for numbered selection
  lastAction?: LastActionType               // what the system did last turn

  // ── Comparison persistence (GPT-style task-scoped memory) ──
  lastComparedProductCodes?: string[]       // product codes from last comparison
  lastComparisonSummary?: string            // brief text summary of last comparison

  // ── Conversation overlay (Gemini ADK-style session/state separation) ──
  overlayMode?: "side_conversation" | null  // tracks when side chat is active
}

// ── Full Exploration Session (server-side, includes heavy data) ──
export interface ProductExplorationSession {
  sessionId: string
  intakeForm: ProductIntakeForm
  candidatePool: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  appliedFilters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  resolutionStatus: ResolutionStatus
  resolvedInput: RecommendationInput
  messages: ChatMessage[]
}

// ── API Response Extensions ──────────────────────────────────
export interface ExplorationAPIResponse {
  text: string
  purpose: "greeting" | "question" | "recommendation"
  chips: string[]
  isComplete: boolean
  recommendation: import("./canonical").RecommendationResult | null
  sessionState: ExplorationSessionState
  evidenceSummaries: EvidenceSummary[] | null
  candidateSnapshot: CandidateSnapshot[] | null
}

/** Lightweight candidate info for UI (avoids sending full ScoredProduct) */
export interface CandidateSnapshot {
  rank: number
  productCode: string
  displayCode: string
  displayLabel: string | null  // e.g. "4날 롱 스퀘어 엔드밀"
  brand: string | null
  seriesName: string | null
  seriesIconUrl: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  toolMaterial: string | null
  shankDiameterMm: number | null
  lengthOfCutMm: number | null
  overallLengthMm: number | null
  helixAngleDeg: number | null
  materialTags: string[]
  score: number
  scoreBreakdown: import("./canonical").ScoreBreakdown | null
  matchStatus: "exact" | "approximate" | "none"
  stockStatus: string
  totalStock: number | null
  hasEvidence: boolean
  bestCondition: import("./evidence").CuttingConditions | null
}

/** Structured narrowing option (persisted for numbered selection) */
export interface DisplayedOption {
  index: number          // 1-based display position
  label: string          // e.g. "Diamond (32개)"
  field: string          // e.g. "coating"
  value: string          // e.g. "Diamond"
  count: number          // candidate count for this option
}
