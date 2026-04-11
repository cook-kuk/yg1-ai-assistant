import type {
  EvidenceSummary,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
} from "@/lib/frontend/recommendation/recommendation-types"
import type { RecommendationCandidateDto, StructuredChipDto } from "@/lib/contracts/recommendation"

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
  /**
   * Inline product-card list rendered directly in the chat (not in the side
   * panel). Populated when the user clicks the "📋 지금 바로 제품 보기" CTA so
   * the candidate snapshot is poured into the conversation flow.
   */
  candidateCards?: RecommendationCandidateDto[] | null
}
