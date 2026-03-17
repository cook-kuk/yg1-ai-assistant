/**
 * Multi-Agent Orchestration — Type Definitions
 *
 * Model tiering:
 *   Haiku  → intent classification, slot extraction, command detection
 *   Sonnet → orchestration, narrowing strategy, recommendation reasoning, response composition
 *   Opus   → ambiguity resolution, complex multi-step reasoning
 */

import type { ModelTier } from "@/lib/llm/provider"
import type { RecommendationInput, ScoredProduct } from "@/lib/types/canonical"
import type { ExplorationSessionState, AppliedFilter, CandidateSnapshot } from "@/lib/types/exploration"
import type { ProductIntakeForm } from "@/lib/types/intake"

// ── Narrowing Intent (state-machine commands) ────────────────
export type NarrowingIntent =
  | "SET_PARAMETER"               // user provides a value (e.g., "4날", "Square")
  | "SELECT_OPTION"               // user picks from presented options
  | "ASK_RECOMMENDATION"          // user wants results now ("추천해줘")
  | "ASK_COMPARISON"              // user wants to compare products ("1번이랑 2번 차이?")
  | "ASK_REASON"                  // user asks why something was recommended
  | "GO_BACK_ONE_STEP"            // "이전으로"
  | "GO_BACK_TO_SPECIFIC_STAGE"   // "Square 선택전으로"
  | "RESET_SESSION"               // "처음부터 다시"
  | "START_NEW_TOPIC"             // unrelated question during session
  | "ASK_EXPLANATION"             // "그게 뭐야?", "차이가 뭐야?"
  | "OUT_OF_SCOPE"                // nonsense, off-domain

// ── Intent Classification Result ─────────────────────────────
export interface IntentClassification {
  intent: NarrowingIntent
  confidence: number          // 0-1
  extractedValue?: string     // e.g., "Square" for GO_BACK_TO_SPECIFIC_STAGE
  reasoning?: string          // debug: why this intent was chosen
  modelUsed: ModelTier
}

// ── Parameter Extraction Result ──────────────────────────────
export interface ExtractedParameters {
  fluteCount?: number
  coating?: string
  toolSubtype?: string
  seriesName?: string
  diameterMm?: number
  material?: string
  operationType?: string
  productCode?: string
  comparisonTargets?: string[] // e.g., ["1번", "2번"]
  rawValue?: string           // the extracted value as-is
  modelUsed: ModelTier
}

// ── Ambiguity Resolution Result ──────────────────────────────
export interface AmbiguityResolution {
  resolvedIntent: NarrowingIntent
  resolvedValue?: string
  resolvedTargets?: string[]  // for comparison references
  explanation: string         // why this interpretation was chosen
  confidence: number
  modelUsed: "opus"
}

// ── Orchestrator Decision ────────────────────────────────────
export type OrchestratorAction =
  | { type: "continue_narrowing"; filter: AppliedFilter }
  | { type: "skip_field" }
  | { type: "show_recommendation" }
  | { type: "go_back_one_step" }
  | { type: "go_back_to_filter"; filterValue: string; filterField?: string }
  | { type: "reset_session" }
  | { type: "compare_products"; targets: string[] }
  | { type: "explain_product"; target?: string }
  | { type: "answer_general"; message: string; preGenerated?: boolean }
  | { type: "redirect_off_topic" }

export interface OrchestratorResult {
  action: OrchestratorAction
  reasoning: string
  agentsInvoked: { agent: string; model: ModelTier; durationMs: number }[]
  escalatedToOpus: boolean
  escalationReason?: string
}

// ── Turn Context (assembled before each agent call) ──────────
export interface TurnContext {
  userMessage: string
  intakeForm: ProductIntakeForm
  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  candidateCount: number
  displayedProducts: CandidateSnapshot[] | null
  currentCandidates: ScoredProduct[]
}

// ── Response Composition Result ──────────────────────────────
export interface ComposedResponse {
  text: string
  chips: string[]
  purpose: "greeting" | "question" | "recommendation" | "comparison" | "explanation" | "general_chat"
  modelUsed: ModelTier
}
