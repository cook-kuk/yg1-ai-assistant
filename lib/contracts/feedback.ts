import { z } from "zod"

export type FeedbackAuthorType = "internal" | "customer" | "anonymous"

export interface FeedbackChatHistoryItemDto {
  role: string
  text: string
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
}

export interface FeedbackListResponseDto {
  entries: FeedbackEntryDto[]
  total: number
}

export const feedbackAuthorTypeSchema = z.enum(["internal", "customer", "anonymous"])

export const feedbackChatHistoryItemSchema = z.object({
  role: z.string(),
  text: z.string(),
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
}).passthrough()

export const feedbackListResponseSchema = z.object({
  entries: z.array(feedbackEntrySchema),
  total: z.number(),
}).passthrough()
