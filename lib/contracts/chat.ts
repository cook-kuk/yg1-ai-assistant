import { z } from "zod"

export type ChatPurpose =
  | "general"
  | "product_recommendation"
  | "product_lookup"
  | "cutting_condition"
  | "cross_reference"
  | "coating_material_qa"
  | "web_search"

export type ChatMessageRole = "user" | "ai" | "system"

export interface ChatMessageDto {
  role: ChatMessageRole
  text: string
}

export interface ChatExtractedFieldDto {
  label: string
  value: string
  confidence: "high" | "medium" | "low"
  step: number
}

export interface ChatRequestDto {
  messages: ChatMessageDto[]
  mode?: string
}

export interface ChatResponseDto {
  intent: ChatPurpose
  text: string
  purpose?: string
  chips?: string[] | null
  extractedField?: ChatExtractedFieldDto | null
  isComplete: boolean
  recommendationIds?: string[] | null
  references?: string[] | null
  error?: string
  detail?: string
}

export const chatMessageRoleSchema = z.enum(["user", "ai", "system"])

export const chatMessageSchema = z.object({
  role: chatMessageRoleSchema,
  text: z.string().min(1).max(5000),
}).passthrough()

export const chatExtractedFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  step: z.number(),
}).passthrough()

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema),
  mode: z.string().optional(),
}).passthrough()

export const chatPurposeSchema = z.enum([
  "general",
  "product_recommendation",
  "product_lookup",
  "cutting_condition",
  "cross_reference",
  "coating_material_qa",
  "web_search",
])

// ── Stream event types (NDJSON protocol) ──
export type StreamEventText = { type: "text"; content: string }
export type StreamEventMeta = { type: "meta" } & Omit<ChatResponseDto, "text">
export type StreamEventDone = { type: "done" }
export type StreamEventError = { type: "error"; message: string }
export type StreamEvent = StreamEventText | StreamEventMeta | StreamEventDone | StreamEventError

export const chatResponseSchema = z.object({
  intent: chatPurposeSchema,
  text: z.string(),
  purpose: z.string().optional(),
  chips: z.array(z.string()).nullable().optional(),
  extractedField: chatExtractedFieldSchema.nullable().optional(),
  isComplete: z.boolean(),
  recommendationIds: z.array(z.string()).nullable().optional(),
  references: z.array(z.string()).nullable().optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
}).passthrough()
