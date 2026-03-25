import { z } from "zod"

import type { ChatMessage, RecommendationResult } from "@/lib/types/canonical"
import type { EvidenceSummary } from "@/lib/types/evidence"
import type { RecommendationExplanation } from "@/lib/types/explanation"
import type { ProductIntakeForm } from "@/lib/types/intake"
import type { RequestPreparationResult } from "@/lib/types/request-preparation"
import type { CuttingConditions } from "@/lib/types/evidence"
import type { ScoreBreakdown } from "@/lib/types/canonical"

export type RecommendationPurpose =
  | "greeting"
  | "question"
  | "recommendation"
  | "comparison"
  | "general_chat"

export type RecommendationResolutionStatus =
  | "none"
  | "broad"
  | "narrowing"
  | "resolved_exact"
  | "resolved_approximate"
  | "resolved_none"

export interface RecommendationDisplayedProductRequestDto {
  rank: number
  code: string
  productCode?: string
  brand: string | null
  series: string | null
  diameter: number | null
  flute: number | null
  coating: string | null
  toolSubtype?: string | null
  materialTags: string[]
  score: number
  matchStatus: string
}

export interface RecommendationCapabilityDto {
  canCompare: boolean
  canRestoreTask: boolean
  canGroupBySeries: boolean
  canFilterDisplayed: boolean
}

export interface RecommendationPaginationDto {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}

export interface RecommendationAppliedFilterDto {
  field: string
  op: string
  value: string
  rawValue?: string | number
  appliedAt?: number
}

export interface RecommendationNarrowingTurnDto {
  question: string
  answer: string
  extractedFilters: RecommendationAppliedFilterDto[]
  candidateCountBefore: number
  candidateCountAfter: number
}

export interface RecommendationDisplayedOptionDto {
  index: number
  label: string
  field: string
  value: string
  count: number
}

export interface RecommendationSeriesGroupSummaryDto {
  seriesKey: string
  seriesName: string
  candidateCount: number
  materialRating?: "EXCELLENT" | "GOOD" | "NULL" | null
  materialRatingScore?: number | null
}

export interface RecommendationUINarrowingPathEntryDto {
  kind: "filter" | "display_filter" | "series_group" | "restore" | "meta"
  label: string
  field?: string
  value?: string
  candidateCount: number
}

export interface RecommendationCheckpointSummaryDto {
  checkpointId: string
  stepIndex: number
  summary: string
  candidateCount: number
  timestamp: number
}

export interface RecommendationCurrentTaskDto {
  taskId: string
  createdAt: number
  intakeSummary: string
  checkpoints: RecommendationCheckpointSummaryDto[]
  finalCandidateCount: number | null
  status: "active" | "archived"
}

export interface RecommendationArchivedTaskDto {
  taskId: string
  createdAt: number
  intakeSummary: string
  checkpointCount: number
  status: "archived"
}

export interface RecommendationPublicSessionDto {
  sessionId: string | null
  candidateCount: number
  appliedFilters: RecommendationAppliedFilterDto[]
  narrowingHistory: RecommendationNarrowingTurnDto[]
  resolutionStatus: RecommendationResolutionStatus
  turnCount: number
  lastAskedField?: string | null
  lastAction?: string | null
  displayedChips: string[]
  displayedOptions: RecommendationDisplayedOptionDto[]
  displayedSeriesGroups?: RecommendationSeriesGroupSummaryDto[]
  uiNarrowingPath?: RecommendationUINarrowingPathEntryDto[]
  currentMode?: string | null
  activeGroupKey?: string | null
  currentTask?: RecommendationCurrentTaskDto | null
  taskHistory?: RecommendationArchivedTaskDto[]
  capabilities: RecommendationCapabilityDto
}

export interface RecommendationCandidateInventoryLocationDto {
  warehouseOrRegion: string
  quantity: number
}

export interface RecommendationCandidateDto {
  rank: number
  productCode: string
  displayCode: string
  displayLabel: string | null
  brand: string | null
  seriesName: string | null
  seriesIconUrl: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  toolSubtype?: string | null
  toolMaterial: string | null
  shankDiameterMm: number | null
  lengthOfCutMm: number | null
  overallLengthMm: number | null
  helixAngleDeg: number | null
  description: string | null
  featureText: string | null
  materialTags: string[]
  score: number
  scoreBreakdown: ScoreBreakdown | null
  matchStatus: "exact" | "approximate" | "none"
  stockStatus: string
  totalStock: number | null
  inventorySnapshotDate: string | null
  inventoryLocations: RecommendationCandidateInventoryLocationDto[]
  hasEvidence: boolean
  bestCondition: CuttingConditions | null
}

export interface RecommendationSessionEnvelopeDto {
  publicState: RecommendationPublicSessionDto | null
  engineState: unknown | null
}

export interface RecommendationResponseMetaDto {
  extractedField?: unknown | null
  orchestratorResult?: Record<string, unknown> | null
  /** Developer-only debug trace. Only populated when DEV_AGENT_DEBUG=true. */
  debugTrace?: import("@/lib/debug/agent-trace").TurnDebugTrace | null
}

export interface RecommendationRequestDto {
  engine?: string
  intakeForm?: ProductIntakeForm
  messages?: ChatMessage[]
  session?: RecommendationSessionEnvelopeDto | null
  sessionState?: unknown | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize"> | null
  language?: "ko" | "en"
  mode?: string
}

export interface RecommendationResponseDto {
  text: string
  purpose: RecommendationPurpose
  chips: string[]
  isComplete: boolean
  recommendation: RecommendationResult | null
  session: RecommendationSessionEnvelopeDto
  candidates: RecommendationCandidateDto[] | null
  pagination: RecommendationPaginationDto | null
  evidenceSummaries: EvidenceSummary[] | null
  requestPreparation: RequestPreparationResult | null
  primaryExplanation: RecommendationExplanation | null
  primaryFactChecked: Record<string, unknown> | null
  altExplanations: RecommendationExplanation[]
  altFactChecked: Array<Record<string, unknown>>
  capabilities: RecommendationCapabilityDto
  meta?: RecommendationResponseMetaDto
  error?: string
  detail?: string
}

export const recommendationPurposeSchema = z.enum([
  "greeting",
  "question",
  "recommendation",
  "comparison",
  "general_chat",
])

export const recommendationResolutionStatusSchema = z.enum([
  "none",
  "broad",
  "narrowing",
  "resolved_exact",
  "resolved_approximate",
  "resolved_none",
])

export const recommendationDisplayedProductRequestSchema = z.object({
  rank: z.number(),
  code: z.string(),
  productCode: z.string().optional(),
  brand: z.string().nullable(),
  series: z.string().nullable(),
  diameter: z.number().nullable(),
  flute: z.number().nullable(),
  coating: z.string().nullable(),
  materialTags: z.array(z.string()),
  score: z.number(),
  matchStatus: z.string(),
}).passthrough()

export const recommendationCapabilitySchema = z.object({
  canCompare: z.boolean(),
  canRestoreTask: z.boolean(),
  canGroupBySeries: z.boolean(),
  canFilterDisplayed: z.boolean(),
})

export const recommendationPaginationSchema = z.object({
  page: z.number().int().min(0),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
})

export const recommendationAppliedFilterSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.string(),
  rawValue: z.union([z.string(), z.number()]).optional(),
  appliedAt: z.number().optional(),
}).passthrough()

export const recommendationNarrowingTurnSchema = z.object({
  question: z.string(),
  answer: z.string(),
  extractedFilters: z.array(recommendationAppliedFilterSchema),
  candidateCountBefore: z.number(),
  candidateCountAfter: z.number(),
}).passthrough()

export const recommendationDisplayedOptionSchema = z.object({
  index: z.number(),
  label: z.string(),
  field: z.string(),
  value: z.string(),
  count: z.number(),
})

export const recommendationSeriesGroupSummarySchema = z.object({
  seriesKey: z.string(),
  seriesName: z.string(),
  candidateCount: z.number(),
  materialRating: z.enum(["EXCELLENT", "GOOD", "NULL"]).nullable().optional(),
  materialRatingScore: z.number().nullable().optional(),
}).passthrough()

export const recommendationUiNarrowingPathEntrySchema = z.object({
  kind: z.enum(["filter", "display_filter", "series_group", "restore", "meta"]),
  label: z.string(),
  field: z.string().optional(),
  value: z.string().optional(),
  candidateCount: z.number(),
}).passthrough()

export const recommendationCheckpointSummarySchema = z.object({
  checkpointId: z.string(),
  stepIndex: z.number(),
  summary: z.string(),
  candidateCount: z.number(),
  timestamp: z.number(),
}).passthrough()

export const recommendationCurrentTaskSchema = z.object({
  taskId: z.string(),
  createdAt: z.number(),
  intakeSummary: z.string(),
  checkpoints: z.array(recommendationCheckpointSummarySchema),
  finalCandidateCount: z.number().nullable(),
  status: z.enum(["active", "archived"]),
}).passthrough()

export const recommendationArchivedTaskSchema = z.object({
  taskId: z.string(),
  createdAt: z.number(),
  intakeSummary: z.string(),
  checkpointCount: z.number(),
  status: z.enum(["archived"]),
}).passthrough()

export const recommendationPublicSessionSchema = z.object({
  sessionId: z.string().nullable(),
  candidateCount: z.number(),
  appliedFilters: z.array(recommendationAppliedFilterSchema),
  narrowingHistory: z.array(recommendationNarrowingTurnSchema),
  resolutionStatus: recommendationResolutionStatusSchema,
  turnCount: z.number(),
  lastAskedField: z.string().nullable().optional(),
  lastAction: z.string().nullable().optional(),
  displayedChips: z.array(z.string()),
  displayedOptions: z.array(recommendationDisplayedOptionSchema),
  displayedSeriesGroups: z.array(recommendationSeriesGroupSummarySchema).optional(),
  uiNarrowingPath: z.array(recommendationUiNarrowingPathEntrySchema).optional(),
  currentMode: z.string().nullable().optional(),
  activeGroupKey: z.string().nullable().optional(),
  currentTask: recommendationCurrentTaskSchema.nullable().optional(),
  taskHistory: z.array(recommendationArchivedTaskSchema).optional(),
  capabilities: recommendationCapabilitySchema,
}).passthrough()

export const recommendationCandidateInventoryLocationSchema = z.object({
  warehouseOrRegion: z.string(),
  quantity: z.number(),
})

export const recommendationCandidateSchema = z.object({
  rank: z.number(),
  productCode: z.string(),
  displayCode: z.string(),
  displayLabel: z.string().nullable(),
  brand: z.string().nullable(),
  seriesName: z.string().nullable(),
  seriesIconUrl: z.string().nullable(),
  diameterMm: z.number().nullable(),
  fluteCount: z.number().nullable(),
  coating: z.string().nullable(),
  toolSubtype: z.string().nullable().optional(),
  toolMaterial: z.string().nullable(),
  shankDiameterMm: z.number().nullable(),
  lengthOfCutMm: z.number().nullable(),
  overallLengthMm: z.number().nullable(),
  helixAngleDeg: z.number().nullable(),
  description: z.string().nullable(),
  featureText: z.string().nullable(),
  materialTags: z.array(z.string()),
  score: z.number(),
  scoreBreakdown: z.unknown().nullable(),
  matchStatus: z.enum(["exact", "approximate", "none"]),
  stockStatus: z.string(),
  totalStock: z.number().nullable(),
  inventorySnapshotDate: z.string().nullable(),
  inventoryLocations: z.array(recommendationCandidateInventoryLocationSchema),
  hasEvidence: z.boolean(),
  bestCondition: z.unknown().nullable(),
}).passthrough()

export const recommendationSessionEnvelopeSchema = z.object({
  publicState: recommendationPublicSessionSchema.nullable().optional(),
  engineState: z.unknown().nullable().optional(),
}).passthrough()

export const recommendationRequestSchema = z.object({
  engine: z.string().optional(),
  intakeForm: z.unknown().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "ai"]),
    text: z.string().min(1).max(5000),
  })).optional(),
  session: recommendationSessionEnvelopeSchema.nullable().optional(),
  sessionState: z.unknown().nullable().optional(),
  displayedProducts: z.array(recommendationDisplayedProductRequestSchema).nullable().optional(),
  pagination: recommendationPaginationSchema.pick({ page: true, pageSize: true }).nullable().optional(),
  language: z.enum(["ko", "en"]).optional(),
  mode: z.string().optional(),
}).passthrough()

export const recommendationResponseMetaSchema = z.object({
  extractedField: z.unknown().nullable().optional(),
  orchestratorResult: z.record(z.unknown()).nullable().optional(),
}).passthrough()

export const recommendationResponseSchema = z.object({
  text: z.string(),
  purpose: recommendationPurposeSchema,
  chips: z.array(z.string()),
  isComplete: z.boolean(),
  recommendation: z.unknown().nullable(),
  session: recommendationSessionEnvelopeSchema,
  candidates: z.array(recommendationCandidateSchema).nullable(),
  pagination: recommendationPaginationSchema.nullable(),
  evidenceSummaries: z.array(z.unknown()).nullable(),
  requestPreparation: z.unknown().nullable(),
  primaryExplanation: z.unknown().nullable(),
  primaryFactChecked: z.record(z.unknown()).nullable(),
  altExplanations: z.array(z.unknown()),
  altFactChecked: z.array(z.record(z.unknown())),
  capabilities: recommendationCapabilitySchema,
  meta: recommendationResponseMetaSchema.optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
}).passthrough()
