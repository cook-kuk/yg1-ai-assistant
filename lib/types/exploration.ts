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
  | "ask_clarification"
  | "skip_field"
  | "show_recommendation"
  | "go_back_one_step"
  | "go_back_to_filter"
  | "compare_products"
  | "explain_product"
  | "answer_general"
  | "filter_displayed"
  | "query_displayed"
  | "redirect_off_topic"
  | "reset_session"
  | "start_new_task"
  | "resume_previous_task"
  | "restore_previous_group"
  | "show_group_menu"
  | "confirm_multi_intent"
  | "confirm_scope"
  | "summarize_task"

// ── Comparison Artifact (persists comparison results across turns) ──
export interface ComparisonArtifact {
  comparedProductCodes: string[]   // codes of compared products
  comparedRanks: number[]          // ranks in displayedCandidates
  compareField?: string            // field-specific comparison (e.g. "overallLengthMm")
  text: string                     // the generated comparison markdown
  timestamp: number
}

// ── Candidate Count Breakdown (transparency & debugging) ──
export interface CandidateCounts {
  dbMatchCount: number             // raw DB/retrieval matches
  filteredCount: number            // after narrowing filters applied
  rankedCount: number              // after scoring/ranking
  displayedCount: number           // shown to user (may be capped)
  hiddenBySeriesCapCount: number   // hidden by series grouping cap
}

export type SessionMode =
  | "narrowing"
  | "question"
  | "recommendation"
  | "comparison"
  | "general_chat"
  | "group_menu"
  | "group_focus"
  | "restore"
  | "task"

export interface UINarrowingPathEntry {
  kind: "filter" | "display_filter" | "series_group" | "restore" | "meta"
  label: string
  field?: string
  value?: string
  candidateCount: number
}

// ── Clarification Record (tracks what was asked & resolved) ──
export interface ClarificationRecord {
  question: string
  options: string[]
  turnAsked: number
  context?: string                 // what triggered the clarification
  resolvedWith?: string            // user's selection or direct input
}

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
  displayedProducts?: CandidateSnapshot[]      // canonical UI list for cards/tables
  fullDisplayedProducts?: CandidateSnapshot[] | null
  displayedSeriesGroups?: SeriesGroup[]
  uiNarrowingPath?: UINarrowingPathEntry[]
  currentMode?: SessionMode
  restoreTarget?: string | null

  // ── Durable UI context (single source of truth) ──
  displayedCandidates: CandidateSnapshot[]  // what the user currently sees
  fullDisplayedCandidates?: CandidateSnapshot[]  // in-display 필터 전 원본 (filter_displayed 복원용)
  displayedSetFilter?: { field: string; operator: string; value: string } | null  // 현재 적용된 in-display 필터
  displayedChips: string[]                  // chips shown with the last question
  displayedOptions: DisplayedOption[]       // structured narrowing options for numbered selection
  lastAction?: LastActionType               // what the system did last turn

  // ── Side Conversation Overlay ──
  // Records the "real" state-machine position before side conversation,
  // so routing rules can still reference the underlying session mode.
  underlyingAction?: LastActionType

  // ── Artifacts (persist displayed results & comparisons) ──
  lastComparisonArtifact?: ComparisonArtifact | null
  lastRecommendationArtifact?: CandidateSnapshot[] | null  // snapshot at last show_recommendation

  // ── Count Breakdown (transparency) ──
  candidateCounts?: CandidateCounts

  // ── Clarification Tracking ──
  lastClarification?: ClarificationRecord | null

  // ── Series Grouping (optional, Phase 1) ──
  displayedGroups?: SeriesGroup[]
  activeGroupKey?: string | null

  // ── Task System (optional, Phase 3) ──
  currentTask?: RecommendationTask | null
  taskHistory?: ArchivedTask[]

  // ── Multi-Intent Queue (pending actions from decomposition) ──
  pendingIntents?: Array<{ text: string; category: string }>
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
  description: string | null       // series_description
  featureText: string | null        // series_feature
  materialTags: string[]
  score: number
  scoreBreakdown: import("./canonical").ScoreBreakdown | null
  matchStatus: "exact" | "approximate" | "none"
  stockStatus: string
  totalStock: number | null
  inventorySnapshotDate: string | null
  inventoryLocations: InventoryLocationSnapshot[]
  hasEvidence: boolean
  bestCondition: import("./evidence").CuttingConditions | null
}

export interface InventoryLocationSnapshot {
  warehouseOrRegion: string
  quantity: number
}

/** Structured narrowing option (persisted for numbered selection) */
export interface DisplayedOption {
  index: number          // 1-based display position
  label: string          // e.g. "Diamond (32개)"
  field: string          // e.g. "coating"
  value: string          // e.g. "Diamond"
  count: number          // candidate count for this option
}

// ── Series Grouping ────────────────────────────────────────────
export interface SeriesGroup {
  seriesKey: string           // seriesName ?? "__ungrouped__"
  seriesName: string          // 표시명 ("(기타)" for null)
  seriesIconUrl: string | null
  description: string | null
  candidateCount: number
  topScore: number
  members: CandidateSnapshot[]
}

export interface SeriesGroupSummary {
  seriesKey: string
  seriesName: string
  candidateCount: number
}

// ── Recommendation Checkpoint ──────────────────────────────────
export interface RecommendationCheckpoint {
  checkpointId: string
  stepIndex: number
  summary: string             // 결정론적 생성 (필터+카운트 기반)
  candidateCount: number
  resolvedInputSnapshot: RecommendationInput
  filtersSnapshot: AppliedFilter[]
  displayedGroups: SeriesGroupSummary[]
  filterApplied: AppliedFilter | null
  timestamp: number
}

// ── Recommendation Task ────────────────────────────────────────
export interface RecommendationTask {
  taskId: string
  createdAt: number
  intakeSummary: string
  checkpoints: RecommendationCheckpoint[]
  finalCandidateCount: number | null
  status: "active" | "archived"
}

export interface ArchivedTask {
  taskId: string
  createdAt: number
  intakeSummary: string
  checkpointCount: number
  finalCheckpoint: RecommendationCheckpoint
  status: "archived"
}
