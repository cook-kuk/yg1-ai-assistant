import {
  recommendationResponseSchema,
  type RecommendationCandidateDto,
  type RecommendationDisplayedProductRequestDto,
  type RecommendationPaginationDto,
  type RecommendationPublicSessionDto,
  type RecommendationRequestDto,
  type RecommendationResponseDto,
  type RecommendationSessionEnvelopeDto,
} from "@/lib/contracts/recommendation"

import type { RecommendationChatMessage as ChatMessage } from "@/lib/frontend/recommendation/recommendation-types"
import type { ProductIntakeForm } from "@/lib/frontend/recommendation/intake-types"

export function parseRecommendationResponse(payload: unknown): RecommendationResponseDto {
  return recommendationResponseSchema.parse(payload) as RecommendationResponseDto
}

export function buildRecommendationSessionEnvelope(
  publicState: RecommendationPublicSessionDto | null,
  engineState: unknown | null
): RecommendationSessionEnvelopeDto | null {
  if (!publicState && !engineState) return null

  return {
    publicState,
    engineState,
  }
}

export function buildDisplayedProductsForRequest(
  candidates: RecommendationCandidateDto[] | null
): RecommendationDisplayedProductRequestDto[] | null {
  return candidates?.slice(0, 10).map(candidate => ({
    rank: candidate.rank,
    code: candidate.displayCode,
    productCode: candidate.productCode,
    brand: candidate.brand,
    series: candidate.seriesName,
    diameter: candidate.diameterMm,
    flute: candidate.fluteCount,
    coating: candidate.coating,
    materialTags: candidate.materialTags,
    score: candidate.score,
    matchStatus: candidate.matchStatus,
  })) ?? null
}

interface CreateInitialRecommendationRequestParams {
  form: ProductIntakeForm
  language: "ko" | "en"
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize">
  engine?: string
}

export function createInitialRecommendationRequest(
  params: CreateInitialRecommendationRequestParams
): RecommendationRequestDto {
  return {
    engine: params.engine,
    intakeForm: params.form,
    messages: [],
    session: null,
    pagination: params.pagination ?? null,
    language: params.language,
  }
}

interface CreateFollowUpRecommendationRequestParams {
  form: ProductIntakeForm
  messages: ChatMessage[]
  session: RecommendationSessionEnvelopeDto | null
  candidates: RecommendationCandidateDto[] | null
  language: "ko" | "en"
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize">
  engine?: string
}

export function createFollowUpRecommendationRequest(
  params: CreateFollowUpRecommendationRequestParams
): RecommendationRequestDto {
  return {
    engine: params.engine,
    intakeForm: params.form,
    messages: params.messages,
    session: params.session,
    displayedProducts: buildDisplayedProductsForRequest(params.candidates),
    pagination: params.pagination ?? null,
    language: params.language,
  }
}

interface CreateCandidatePaginationRequestParams {
  form: ProductIntakeForm
  session: RecommendationSessionEnvelopeDto | null
  language: "ko" | "en"
  pagination: Pick<RecommendationPaginationDto, "page" | "pageSize">
  engine?: string
}

export function createCandidatePaginationRequest(
  params: CreateCandidatePaginationRequestParams
): RecommendationRequestDto {
  return {
    engine: params.engine,
    intakeForm: params.form,
    messages: [],
    session: params.session,
    pagination: params.pagination,
    language: params.language,
  }
}
