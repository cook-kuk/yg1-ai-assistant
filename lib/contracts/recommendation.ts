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
  rawValue?: string | number | boolean | Array<string | number | boolean>
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

export interface RecommendationChipGroupDto {
  label: string
  chips: string[]
}

/**
 * Structured chip — carries action metadata so the frontend can dispatch
 * filter application, navigation, or reset without round-tripping through
 * the LLM re-extraction pipeline. Parallel to the legacy `chips: string[]`
 * array (index-aligned, sparse: `null` slots mean "fall back to text-based
 * dispatch").
 */
export type StructuredChipActionDto =
  | "apply_filter"
  | "remove_filter"
  | "navigate"
  | "reset"
  | "select_option"
  | "ask"

export interface StructuredChipDto {
  text: string
  action: StructuredChipActionDto
  field?: string
  value?: string
  op?: "eq" | "neq" | "gte" | "lte" | "between"
  target?: string
  products?: string[]
}

// Known affinity tiers — kept as a union TYPE for IDE help, but the DTO
// fields below are typed as `MaterialRatingValue | string | null` so a new
// tier emitted by Python (or downstream service) doesn't silently null out.
export type MaterialRatingValue = "EXCELLENT" | "GOOD" | "FAIR" | "NULL"

export interface RecommendationSeriesGroupSummaryDto {
  seriesKey: string
  seriesName: string
  candidateCount: number
  // Open string so future tiers ("OUTSTANDING", localized labels, etc.)
  // pass through. UI components branch on the MaterialRatingValue union
  // and fall back to a generic badge for anything else.
  materialRating?: MaterialRatingValue | string | null
  materialRatingScore?: number | null
}

export interface RecommendationUINarrowingPathEntryDto {
  kind: "filter" | "display_filter" | "series_group" | "restore" | "meta"
  label: string
  field?: string
  value?: string
  candidateCount: number
  candidateCountBefore?: number
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
  /** Index-aligned with displayedChips. Null slots → fall back to text dispatch. */
  displayedStructuredChips?: (StructuredChipDto | null)[]
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
  shankType?: string | null
  lengthOfCutMm: number | null
  overallLengthMm: number | null
  helixAngleDeg: number | null
  coolantHole?: boolean | null
  ballRadiusMm?: number | null
  taperAngleDeg?: number | null
  pointAngleDeg?: number | null
  threadPitchMm?: number | null
  // Added so the chat-inline CandidateCard expand-state can render the same
  // full spec table ProductCard uses. Previously these only lived on the
  // canonical product path (CanonicalProduct), so cards loaded via the
  // Python pipeline had no way to display them.
  neckDiameterMm?: number | null
  neckLengthMm?: number | null
  effectiveLengthMm?: number | null
  cornerRadiusMm?: number | null
  diameterTolerance?: string | null
  edpUnit?: string | null
  description: string | null
  featureText: string | null
  materialTags: string[]
  // Same open-string contract as RecommendationSeriesGroupSummaryDto —
  // see MaterialRatingValue. Unknown tiers from Python pass through; the
  // UI's _coerceRating maps known values to badges and falls back to a
  // neutral chip for the rest (no silent null drop).
  materialRating?: MaterialRatingValue | string | null
  score: number
  scoreBreakdown: ScoreBreakdown | null
  // Open-string match label so a future "partial" / "conditional" /
  // localized value passes through. Adapter still derives one of
  // exact/approximate/none for legacy renderers.
  matchStatus: "exact" | "approximate" | "none" | string
  stockStatus: string
  totalStock: number | null
  inventorySnapshotDate: string | null
  inventoryLocations: RecommendationCandidateInventoryLocationDto[]
  hasEvidence: boolean
  bestCondition: CuttingConditions | null
  xaiNarrative?: string | null
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
  engine?: string | null
  intakeForm?: ProductIntakeForm
  messages?: ChatMessage[]
  session?: RecommendationSessionEnvelopeDto | null
  sessionState?: unknown | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize"> | null
  language?: "ko" | "en"
  mode?: string
  /** Structured chip click short-circuit — when present, the server applies
   * the chip's action directly (e.g. filter injection) and skips LLM
   * re-extraction of the synthetic user message. */
  chipAction?: StructuredChipDto | null
}

export interface RecommendationResponseDto {
  text: string
  purpose: RecommendationPurpose
  chips: string[]
  /** Index-aligned with chips. Null slots → fall back to text dispatch. */
  structuredChips?: (StructuredChipDto | null)[]
  chipGroups?: RecommendationChipGroupDto[]
  isComplete: boolean
  recommendation: RecommendationResult | null
  session: RecommendationSessionEnvelopeDto
  candidates: RecommendationCandidateDto[] | null
  /** "조회한 상품" peek — populated when the user names a specific EDP/series
   * mid-session ("UGMG34919 보여줘"). These bypass the current filter state
   * so the UI renders them in a dedicated section below `candidates`. */
  referenceCandidates?: RecommendationCandidateDto[] | null
  referenceQuery?: string | null
  pagination: RecommendationPaginationDto | null
  evidenceSummaries: EvidenceSummary[] | null
  requestPreparation: RequestPreparationResult | null
  primaryExplanation: RecommendationExplanation | null
  primaryFactChecked: Record<string, unknown> | null
  altExplanations: RecommendationExplanation[]
  altFactChecked: Array<Record<string, unknown>>
  capabilities: RecommendationCapabilityDto
  meta?: RecommendationResponseMetaDto
  /** Uncertainty gate output: FAST/VERIFY/ASK + confidence/risk/reason_codes */
  recommendationMeta?: {
    confidence: "high" | "medium" | "low"
    risk: "low" | "medium" | "high"
    missing_info: string[]
    reason_codes: string[]
    mode: "FAST" | "VERIFY" | "ASK"
    followup_question?: string
    followup_reason?: string
    reason_summary?: string | null
    perspectives?: {
      primary?: { label: string; labelKo: string }
      alternatives?: Array<{ code: string; label: string; labelKo: string }>
    }
  }
  reasoningVisibility?: RecommendationReasoningVisibility | null
  /** 추론 과정 — Claude thinking 처럼 유저에게 "이렇게 이해했습니다" 보여주기 위한 한국어 자연어. */
  thinkingProcess?: string | null
  thinkingDeep?: string | null
  /**
   * Dual-CoT metadata from Python /products. Populated only when the
   * Strong path ran (draft + verify). Feeds the ReasoningBlock header
   * so the collapsed badge can say "심층 분석 완료 · ✓ 검증됨 · 23s".
   */
  cotLevel?: "light" | "strong" | null
  cotElapsedSec?: number | null
  verified?: boolean | null
  /**
   * Response Validator warnings. Populated by guard.validate_response
   * (Python) when unsupported/contradicted claims were detected.
   * `action: "removed"` entries drive the cleaned-text diff (span info);
   * `annotated` / `passed` are metadata-only.
   */
  validatorWarnings?: ValidatorWarningDto[] | null
  /**
   * Structured refine chips with real candidate counts. Prefer these
   * over the legacy `chips: string[]` when non-empty — they carry
   * {field, value, count, action} so the frontend can fire a
   * structured refine payload without sending the natural-language
   * chip text back through SCR.
   */
  refineChips?: RefineChipDto[] | null
  error?: string
  detail?: string
}

export interface ValidatorWarningDto {
  category: "numeric" | "categorical" | "citation" | "existential" | string
  claim_text: string
  evidence_ref?: string | null
  action: "removed" | "annotated" | "passed" | string
  confidence?: number
  span: [number, number]
}

/**
 * Structured refine chip — emitted by Python's refine_engine when the
 * response surfaced a distribution with actionable narrowings. Coexists
 * with the legacy `chips: string[]` (natural-language fallback); frontend
 * prefers refineChips when non-empty.
 */
export interface RefineChipDto {
  field: string
  // Scalar for single-field chips; `Record<string, string|number>` for
  // cross-field chips where `field` has shape "f1+f2".
  value: string | number | Record<string, string | number>
  label: string
  count: number
  action: "narrow" | "drop" | "broaden" | string
}

export type RecommendationReasoningVisibility = "hidden" | "simple" | "full"

export const recommendationPurposeSchema = z.enum([
  "greeting",
  "question",
  "recommendation",
  "comparison",
  "general_chat",
])

export const recommendationReasoningVisibilitySchema = z.enum([
  "hidden",
  "simple",
  "full",
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
  rawValue: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()])),
  ]).optional(),
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

export const recommendationChipGroupSchema = z.object({
  label: z.string(),
  chips: z.array(z.string()),
})

export const structuredChipActionSchema = z.enum([
  "apply_filter",
  "remove_filter",
  "navigate",
  "reset",
  "select_option",
  "ask",
])

export const structuredChipSchema = z.object({
  text: z.string(),
  action: structuredChipActionSchema,
  field: z.string().optional(),
  value: z.string().optional(),
  op: z.enum(["eq", "neq", "gte", "lte", "between"]).optional(),
  target: z.string().optional(),
  products: z.array(z.string()).optional(),
}).passthrough()

export const recommendationSeriesGroupSummarySchema = z.object({
  seriesKey: z.string(),
  seriesName: z.string(),
  candidateCount: z.number(),
  // Open-string contract: known tiers (EXCELLENT/GOOD/FAIR/NULL) plus any
  // future Python emission (localized labels, "OUTSTANDING", etc.). UI
  // adapter (_coerceRating) maps known values to badges and falls back
  // to a neutral chip for the rest.
  materialRating: z.string().nullable().optional(),
  materialRatingScore: z.number().nullable().optional(),
}).passthrough()

export const recommendationUiNarrowingPathEntrySchema = z.object({
  kind: z.enum(["filter", "display_filter", "series_group", "restore", "meta"]),
  label: z.string(),
  field: z.string().optional(),
  value: z.string().optional(),
  candidateCount: z.number(),
  candidateCountBefore: z.number().optional(),
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
  displayedStructuredChips: z.array(structuredChipSchema.nullable()).optional(),
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
  shankType: z.string().nullable().optional(),
  lengthOfCutMm: z.number().nullable(),
  overallLengthMm: z.number().nullable(),
  helixAngleDeg: z.number().nullable(),
  coolantHole: z.boolean().nullable().optional(),
  ballRadiusMm: z.number().nullable().optional(),
  taperAngleDeg: z.number().nullable().optional(),
  pointAngleDeg: z.number().nullable().optional(),
  threadPitchMm: z.number().nullable().optional(),
  neckDiameterMm: z.number().nullable().optional(),
  neckLengthMm: z.number().nullable().optional(),
  effectiveLengthMm: z.number().nullable().optional(),
  cornerRadiusMm: z.number().nullable().optional(),
  diameterTolerance: z.string().nullable().optional(),
  edpUnit: z.string().nullable().optional(),
  description: z.string().nullable(),
  featureText: z.string().nullable(),
  materialTags: z.array(z.string()),
  // Open-string contract: known tiers (EXCELLENT/GOOD/FAIR/NULL) plus any
  // future Python emission (localized labels, "OUTSTANDING", etc.). UI
  // adapter (_coerceRating) maps known values to badges and falls back
  // to a neutral chip for the rest.
  materialRating: z.string().nullable().optional(),
  score: z.number(),
  scoreBreakdown: z.unknown().nullable(),
  // Open string — known values exact/approximate/none, plus future
  // labels (partial / conditional / localized) without zod rejection.
  matchStatus: z.string(),
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
  engine: z.string().nullable().optional(),
  intakeForm: z.unknown().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "ai"]),
    text: z.string().max(5000),
  })).optional(),
  session: recommendationSessionEnvelopeSchema.nullable().optional(),
  sessionState: z.unknown().nullable().optional(),
  displayedProducts: z.array(recommendationDisplayedProductRequestSchema).nullable().optional(),
  pagination: recommendationPaginationSchema.pick({ page: true, pageSize: true }).nullable().optional(),
  language: z.enum(["ko", "en"]).optional(),
  mode: z.string().optional(),
  chipAction: structuredChipSchema.nullable().optional(),
}).passthrough()

export const recommendationResponseMetaSchema = z.object({
  extractedField: z.unknown().nullable().optional(),
  orchestratorResult: z.record(z.unknown()).nullable().optional(),
}).passthrough()

export const recommendationResponseSchema = z.object({
  text: z.string(),
  purpose: recommendationPurposeSchema,
  chips: z.array(z.string()),
  structuredChips: z.array(structuredChipSchema.nullable()).optional(),
  chipGroups: z.array(recommendationChipGroupSchema).optional(),
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
  reasoningVisibility: recommendationReasoningVisibilitySchema.nullable().optional(),
  thinkingProcess: z.string().nullable().optional(),
  thinkingDeep: z.string().nullable().optional(),
  cotLevel: z.enum(["light", "strong"]).nullable().optional(),
  cotElapsedSec: z.number().nullable().optional(),
  verified: z.boolean().nullable().optional(),
  validatorWarnings: z.array(z.object({
    category: z.string(),
    claim_text: z.string(),
    evidence_ref: z.string().nullable().optional(),
    action: z.string(),
    confidence: z.number().optional(),
    span: z.tuple([z.number(), z.number()]),
  })).nullable().optional(),
  refineChips: z.array(z.object({
    field: z.string(),
    value: z.union([z.string(), z.number(), z.record(z.union([z.string(), z.number()]))]),
    label: z.string(),
    count: z.number(),
    action: z.string(),
  })).nullable().optional(),
  error: z.string().optional(),
  detail: z.string().optional(),
}).passthrough()
