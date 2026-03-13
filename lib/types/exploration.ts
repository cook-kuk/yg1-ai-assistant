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

// ── Session State (serializable, sent between client ↔ server) ──
export interface ExplorationSessionState {
  sessionId: string
  candidateCount: number
  appliedFilters: AppliedFilter[]
  narrowingHistory: NarrowingTurn[]
  resolutionStatus: ResolutionStatus
  resolvedInput: RecommendationInput   // accumulated from intake + narrowing
  turnCount: number
  lastAskedField?: string              // which field the question engine just asked about
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
  seriesName: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  materialTags: string[]
  score: number
  scoreBreakdown: import("./canonical").ScoreBreakdown | null
  matchStatus: "exact" | "approximate" | "none"
  stockStatus: string
  totalStock: number | null
  hasEvidence: boolean
  bestCondition: import("./evidence").CuttingConditions | null
}
