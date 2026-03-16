// ============================================================
// Request Preparation Types
// Intent classification, slot extraction, route planning.
// ============================================================

import type { RecommendationInput } from "./canonical"
import type { ProductIntakeForm } from "./intake"
import type { ExplorationSessionState } from "./exploration"

// ── Intent Types ────────────────────────────────────────────
export type UserIntent =
  | "product_recommendation"   // 신규 제품 추천
  | "substitute_search"        // 대체품 찾기
  | "cutting_condition_query"  // 절삭조건 문의
  | "product_lookup"           // 제품 정보 조회
  | "narrowing_answer"         // 축소 질문에 대한 답변
  | "refinement"               // 추천 후 추가 조건 변경
  | "general_question"         // 일반 질문 (비추천)

// ── Slot Types ──────────────────────────────────────────────
export interface ExtractedSlot {
  field: string                // material, diameterMm, fluteCount, coating, etc.
  value: string | number
  confidence: "high" | "medium" | "low"
  source: "intake" | "chat" | "inferred"
}

// ── Completeness ────────────────────────────────────────────
export interface CompletenessCheck {
  isComplete: boolean
  answeredSlots: string[]
  missingSlots: string[]
  unknownSlots: string[]     // user explicitly said "모름"
  completionPct: number       // 0-100
}

// ── Route Types ─────────────────────────────────────────────
export type RouteAction =
  | "start_exploration"       // first call, show greeting + first question
  | "continue_narrowing"      // apply filter, ask next question
  | "show_recommendation"     // resolved, show fact-checked result
  | "skip_to_result"          // user requested immediate result
  | "handle_refinement"       // post-recommendation refinement
  | "reset_session"           // user wants to start over
  | "undo_narrowing"          // revert last narrowing step

export interface RoutePlan {
  action: RouteAction
  reason: string              // human-readable explanation
  needsLLM: boolean           // whether this route needs LLM call
  riskFlags: string[]         // e.g. "low_candidates", "no_evidence", "incomplete_input"
}

// ── Full Request Preparation Result ─────────────────────────
export interface RequestPreparationResult {
  intent: UserIntent
  intentConfidence: "high" | "medium" | "low"
  slots: ExtractedSlot[]
  completeness: CompletenessCheck
  route: RoutePlan
  sessionContext: SessionContext
}

// ── Session Context (built from form + state + message) ─────
export interface SessionContext {
  intakeForm: ProductIntakeForm
  resolvedInput: RecommendationInput
  sessionState: ExplorationSessionState | null
  lastUserMessage: string | null
  turnCount: number
}
