import { z } from "zod"

export type FeedbackAuthorType = "internal" | "customer" | "anonymous"
export type FeedbackEventType = "turn_feedback" | "success_case" | "failure_case"

export interface FeedbackChatHistoryItemDto {
  role: string
  text: string
}

export interface FeedbackConversationItemDto {
  index: number | null
  role: string
  text: string
  isLoading: boolean
  chips: string[]
  feedback: string | null
  chipFeedback: string | null
  createdAt: string | null
}

export interface FeedbackCandidateHighlightDto {
  rank: number | null
  productCode: string
  displayCode: string
  score: number | null
}

export interface FeedbackRecommendedProductDto {
  rank: number
  productCode: string
  displayCode: string
  brand: string | null
  seriesName: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  toolMaterial: string | null
  score: number
  matchStatus: string
}

export interface FeedbackConversationRecommendationDto {
  messageIndex: number
  anchorText: string | null
  products: FeedbackRecommendedProductDto[]
}

export interface FeedbackEntryDto {
  id: string
  timestamp: string
  authorType: FeedbackAuthorType
  authorName: string
  sessionId: string | null
  intakeSummary: string | null
  chatHistory: FeedbackChatHistoryItemDto[] | null
  recommendationSummary: string | null
  rating: number | null
  comment: string
  tags: string[]
  screenshotCount?: number
  screenshotPaths?: string[]
}

export interface FeedbackEventEntryDto {
  id: string
  timestamp: string
  type: FeedbackEventType
  sessionId: string | null
  turnNumber: number | null
  mode: string | null
  lastAction: string | null
  userMessage: string | null
  aiResponse: string | null
  lastUserMessage: string | null
  lastAiResponse: string | null
  userComment: string | null
  feedback: string | null
  feedbackEmoji: string | null
  responseFeedback: string | null
  chipFeedback: string | null
  chips: string[]
  candidateCount: number | null
  appliedFilters: string[]
  conversationLength: number | null
  conditions: string | null
  narrowingPath: string | null
  candidateCounts: string | null
  topProducts: string | null
  language: string | null
  clientCapturedAt: string | null
  chatHistory: FeedbackChatHistoryItemDto[] | null
  conversationSnapshot: FeedbackConversationItemDto[] | null
  candidateHighlights: FeedbackCandidateHighlightDto[] | null
  recommendedProducts: FeedbackRecommendedProductDto[] | null
  conversationRecommendations: FeedbackConversationRecommendationDto[] | null
  formSnapshot: Record<string, unknown> | null
  sessionSummary: Record<string, unknown> | null
}

export interface FeedbackListResponseDto {
  generalEntries: FeedbackEntryDto[]
  feedbackEntries: FeedbackEventEntryDto[]
  generalTotal: number
  feedbackTotal: number
}

export const feedbackAuthorTypeSchema = z.enum(["internal", "customer", "anonymous"])
export const feedbackEventTypeSchema = z.enum(["turn_feedback", "success_case", "failure_case"])

export const feedbackChatHistoryItemSchema = z.object({
  role: z.string(),
  text: z.string(),
}).passthrough()

export const feedbackConversationItemSchema = z.object({
  index: z.number().nullable(),
  role: z.string(),
  text: z.string(),
  isLoading: z.boolean(),
  chips: z.array(z.string()),
  feedback: z.string().nullable(),
  chipFeedback: z.string().nullable(),
  createdAt: z.string().nullable(),
}).passthrough()

export const feedbackCandidateHighlightSchema = z.object({
  rank: z.number().nullable(),
  productCode: z.string(),
  displayCode: z.string(),
  score: z.number().nullable(),
}).passthrough()

export const feedbackRecommendedProductSchema = z.object({
  rank: z.number(),
  productCode: z.string(),
  displayCode: z.string(),
  brand: z.string().nullable(),
  seriesName: z.string().nullable(),
  diameterMm: z.number().nullable(),
  fluteCount: z.number().nullable(),
  coating: z.string().nullable(),
  toolMaterial: z.string().nullable(),
  score: z.number(),
  matchStatus: z.string(),
}).passthrough()

export const feedbackConversationRecommendationSchema = z.object({
  messageIndex: z.number(),
  anchorText: z.string().nullable(),
  products: z.array(feedbackRecommendedProductSchema),
}).passthrough()

export const feedbackEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  authorType: feedbackAuthorTypeSchema,
  authorName: z.string(),
  sessionId: z.string().nullable(),
  intakeSummary: z.string().nullable(),
  chatHistory: z.array(feedbackChatHistoryItemSchema).nullable(),
  recommendationSummary: z.string().nullable(),
  rating: z.number().nullable(),
  comment: z.string(),
  tags: z.array(z.string()),
  screenshotCount: z.number().optional(),
  screenshotPaths: z.array(z.string()).optional(),
}).passthrough()

export const feedbackEventEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: feedbackEventTypeSchema,
  sessionId: z.string().nullable(),
  turnNumber: z.number().nullable(),
  mode: z.string().nullable(),
  lastAction: z.string().nullable(),
  userMessage: z.string().nullable(),
  aiResponse: z.string().nullable(),
  lastUserMessage: z.string().nullable(),
  lastAiResponse: z.string().nullable(),
  userComment: z.string().nullable(),
  feedback: z.string().nullable(),
  feedbackEmoji: z.string().nullable(),
  responseFeedback: z.string().nullable(),
  chipFeedback: z.string().nullable(),
  chips: z.array(z.string()),
  candidateCount: z.number().nullable(),
  appliedFilters: z.array(z.string()),
  conversationLength: z.number().nullable(),
  conditions: z.string().nullable(),
  narrowingPath: z.string().nullable(),
  candidateCounts: z.string().nullable(),
  topProducts: z.string().nullable(),
  language: z.string().nullable(),
  clientCapturedAt: z.string().nullable(),
  chatHistory: z.array(feedbackChatHistoryItemSchema).nullable(),
  conversationSnapshot: z.array(feedbackConversationItemSchema).nullable(),
  candidateHighlights: z.array(feedbackCandidateHighlightSchema).nullable(),
  recommendedProducts: z.array(feedbackRecommendedProductSchema).nullable(),
  conversationRecommendations: z.array(feedbackConversationRecommendationSchema).nullable(),
  formSnapshot: z.record(z.string(), z.unknown()).nullable(),
  sessionSummary: z.record(z.string(), z.unknown()).nullable(),
}).passthrough()

export const feedbackListResponseSchema = z.object({
  generalEntries: z.array(feedbackEntrySchema),
  feedbackEntries: z.array(feedbackEventEntrySchema),
  generalTotal: z.number(),
  feedbackTotal: z.number(),
}).passthrough()
