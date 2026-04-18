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
