import type {
  EvidenceSummary,
  RecommendationExplanation,
  RecommendationResult,
  RequestPreparationResult,
} from "@/lib/frontend/recommendation/recommendation-types"

export type TurnFeedback = "good" | "bad" | "neutral" | null
export type LogPayload = unknown

export interface ChatMsg {
  role: "user" | "ai"
  text: string
  recommendation?: RecommendationResult | null
  chips?: string[]
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
}
