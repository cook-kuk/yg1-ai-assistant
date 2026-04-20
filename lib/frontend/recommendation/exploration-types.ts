import type {
  EvidenceSummary,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
} from "@/lib/frontend/recommendation/recommendation-types"
import type {
  RecommendationCandidateDto,
  RecommendationPaginationDto,
  RecommendationReasoningVisibility,
  StructuredChipDto,
} from "@/lib/contracts/recommendation"

export type TurnFeedback = "good" | "bad" | "neutral" | null
export type LogPayload = unknown

export interface ChatMsg {
  role: "user" | "ai"
  text: string
  recommendation?: RecommendationResult | null
  chips?: string[]
  /** Index-aligned with `chips`. Null slots fall back to text dispatch. */
  structuredChips?: (StructuredChipDto | null)[]
  chipGroups?: Array<{ label: string; chips: string[] }>
  evidenceSummaries?: EvidenceSummary[] | null
  isLoading?: boolean
  feedback?: TurnFeedback
  chipFeedback?: TurnFeedback
  recommendationFeedback?: TurnFeedback
  requestPreparation?: RequestPreparationResult | null
  primaryExplanation?: RecommendationExplanation | null
  primaryFactChecked?: Record<string, unknown> | null
  altExplanations?: RecommendationExplanation[]
  requestPayload?: LogPayload | null
  responsePayload?: LogPayload | null
  createdAt?: string
  feedbackGroupId?: string
  /** Developer debug trace — only populated when DEV_AGENT_DEBUG=true */
  debugTrace?: import("@/lib/debug/agent-trace").TurnDebugTrace | null
  /** Server-emitted reasoning trail — Claude-style "추론 과정 보기" collapsible. */
  thinkingProcess?: string | null
  /** Full LLM chain-of-thought (separate channel from staged heartbeat). */
  thinkingDeep?: string | null
  /** Structured agent decision trace (short-circuit hits, intent classify, SQL, filters, ranking). */
  thinkingAgent?: string | null
  reasoningVisibility?: RecommendationReasoningVisibility | null
  /**
   * Python CoT metadata forwarded to the reasoning block header so the
   * collapsed-state badge can say "심층 분석 완료 · ✓ 검증됨 · 23s".
   * All optional — light-path and legacy engines leave them null.
   */
  cotLevel?: "light" | "strong" | null
  cotElapsedSec?: number | null
  verified?: boolean | null
  /**
   * Response-Validator warnings — populated by guard.validate_response
   * (Python) when the streamed answer had unsupported/contradicted
   * claims stripped. `action: "removed"` entries are what drove the
   * text diff; the badge only renders when the array has ≥1 entry with
   * action ≠ "passed".
   */
  validatorWarnings?: Array<{
    category: string
    claim_text: string
    evidence_ref?: string | null
    action: string
    confidence?: number
    span: [number, number]
  }> | null
  /**
   * Inline product-card list rendered directly in the chat (not in the side
   * panel). Populated on every search result and on "제품 보기" CTA so the
   * candidate snapshot lives inside the conversation flow.
   */
  candidateCards?: RecommendationCandidateDto[] | null
  /**
   * Pagination that goes with {@link candidateCards}. Only the latest AI
   * message's pagination is interactive; older messages keep their frozen
   * page view.
   */
  candidatePagination?: RecommendationPaginationDto | null
}
