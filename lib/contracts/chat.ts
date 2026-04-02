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

export interface ChatProductDto {
  displayCode: string
  seriesName: string | null
  brand: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  materialTags: string[]
  toolType: string | null
  toolSubtype: string | null
  toolMaterial: string | null
  featureText: string | null
  description: string | null
  seriesIconUrl: string | null
  shankDiameterMm: number | null
  lengthOfCutMm: number | null
  overallLengthMm: number | null
  helixAngleDeg: number | null
}

export interface ChatResponseDto {
  intent: ChatPurpose
  text: string
  purpose?: string
  chips?: string[] | null
  extractedField?: ChatExtractedFieldDto | null
  isComplete: boolean
  recommendationIds?: string[] | null
  recommendedProducts?: ChatProductDto[] | null
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

export const chatProductSchema = z.object({
  displayCode: z.string(),
  seriesName: z.string().nullable(),
  brand: z.string().nullable(),
  diameterMm: z.number().nullable(),
  fluteCount: z.number().nullable(),
  coating: z.string().nullable(),
  materialTags: z.array(z.string()),
  toolType: z.string().nullable(),
  toolSubtype: z.string().nullable(),
  toolMaterial: z.string().nullable(),
  featureText: z.string().nullable(),
  description: z.string().nullable(),
  seriesIconUrl: z.string().nullable(),
  shankDiameterMm: z.number().nullable(),
  lengthOfCutMm: z.number().nullable(),
  overallLengthMm: z.number().nullable(),
  helixAngleDeg: z.number().nullable(),
}).passthrough()

export const chatResponseSchema = z.object({
  intent: chatPurposeSchema,
  text: z.string(),
  purpose: z.string().optional(),
  chips: z.array(z.string()).nullable().optional(),
  extractedField: chatExtractedFieldSchema.nullable().optional(),
  isComplete: z.boolean(),
  recommendationIds: z.array(z.string()).nullable().optional(),
  recommendedProducts: z.array(chatProductSchema).nullable().optional(),
  references: z.array(z.string()).nullable().optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
}).passthrough()
