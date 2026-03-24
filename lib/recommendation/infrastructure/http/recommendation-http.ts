import { NextResponse } from "next/server"

import { recommendationRequestSchema, type RecommendationRequestDto } from "@/lib/contracts/recommendation"
import { RecommendationService } from "@/lib/recommendation/application/recommendation-service"
import { createMainRecommendationEngine } from "@/lib/recommendation/infrastructure/engines/main-engine"
import { createServeRecommendationEngine } from "@/lib/recommendation/infrastructure/engines/serve-engine"
import {
  handleServeExploration,
  handleServeSimpleChat,
  type ServeEngineRuntimeDependencies,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"
import {
  handleDirectBrandReferenceQuestion,
  handleDirectCuttingConditionQuestion,
  handleDirectInventoryQuestion,
  handleGeneralChat,
  handleContextualNarrowingQuestion,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-assist"
import { applyFilterToInput, mapIntakeToInput } from "@/lib/recommendation/infrastructure/engines/serve-engine-input"
import {
  buildCandidateSnapshot,
  buildQuestionResponse,
  buildRecommendationResponse,
  buildSourceSummary,
  getFollowUpChips,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-response"
import {
  buildRecommendationResponseDto,
  getEngineSessionState,
} from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type {
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

function parseRecommendationRequest(body: unknown): RecommendationRequestDto {
  return recommendationRequestSchema.parse(body) as RecommendationRequestDto
}

function getRequestSessionState(body: RecommendationRequestDto): ExplorationSessionState | null {
  if (body.sessionState && typeof body.sessionState === "object") {
    return body.sessionState as ExplorationSessionState
  }

  return getEngineSessionState(body.session ?? null)
}

export function jsonRecommendationResponse(
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
): Response {
  const dto = buildRecommendationResponseDto(params)

  return NextResponse.json({
    ...dto,
    // Backward-compatible aliases kept temporarily while the UI migrates.
    sessionState: params.sessionState ?? null,
    candidateSnapshot: params.candidateSnapshot ?? null,
    extractedField: params.meta?.extractedField ?? null,
  }, init)
}

function createServeRuntimeDependencies(): ServeEngineRuntimeDependencies {
  const responseDeps = { jsonRecommendationResponse }

  return {
    mapIntakeToInput,
    applyFilterToInput,
    buildQuestionResponse: (
      form: ProductIntakeForm,
      candidates: Parameters<typeof buildQuestionResponse>[2],
      evidenceMap: Parameters<typeof buildQuestionResponse>[3],
      totalCandidateCount: Parameters<typeof buildQuestionResponse>[4],
      pagination: Parameters<typeof buildQuestionResponse>[5],
      displayCandidates: Parameters<typeof buildQuestionResponse>[6],
      displayEvidenceMap: Parameters<typeof buildQuestionResponse>[7],
      input: Parameters<typeof buildQuestionResponse>[8],
      history: Parameters<typeof buildQuestionResponse>[9],
      filters: Parameters<typeof buildQuestionResponse>[10],
      turnCount: Parameters<typeof buildQuestionResponse>[11],
      messages: Parameters<typeof buildQuestionResponse>[12],
      provider: Parameters<typeof buildQuestionResponse>[13],
      language: Parameters<typeof buildQuestionResponse>[14],
      overrideText?: Parameters<typeof buildQuestionResponse>[15],
      existingStageHistory?: Parameters<typeof buildQuestionResponse>[16],
    ) => buildQuestionResponse(
      responseDeps,
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      pagination,
      displayCandidates,
      displayEvidenceMap,
      input,
      history,
      filters,
      turnCount,
      messages,
      provider,
      language,
      overrideText,
      existingStageHistory,
    ),
    buildRecommendationResponse: (
      form: ProductIntakeForm,
      candidates: Parameters<typeof buildRecommendationResponse>[2],
      evidenceMap: Parameters<typeof buildRecommendationResponse>[3],
      totalCandidateCount: Parameters<typeof buildRecommendationResponse>[4],
      pagination: Parameters<typeof buildRecommendationResponse>[5],
      displayCandidates: Parameters<typeof buildRecommendationResponse>[6],
      displayEvidenceMap: Parameters<typeof buildRecommendationResponse>[7],
      input: Parameters<typeof buildRecommendationResponse>[8],
      history: Parameters<typeof buildRecommendationResponse>[9],
      filters: Parameters<typeof buildRecommendationResponse>[10],
      turnCount: Parameters<typeof buildRecommendationResponse>[11],
      messages: Parameters<typeof buildRecommendationResponse>[12],
      provider: Parameters<typeof buildRecommendationResponse>[13],
      language: Parameters<typeof buildRecommendationResponse>[14],
      displayedProducts?: Parameters<typeof buildRecommendationResponse>[15],
    ) => buildRecommendationResponse(
      responseDeps,
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      pagination,
      displayCandidates,
      displayEvidenceMap,
      input,
      history,
      filters,
      turnCount,
      messages,
      provider,
      language,
      displayedProducts,
    ),
    buildCandidateSnapshot,
    handleDirectInventoryQuestion,
    handleDirectBrandReferenceQuestion,
    handleDirectCuttingConditionQuestion,
    handleContextualNarrowingQuestion,
    handleGeneralChat,
    jsonRecommendationResponse,
    getFollowUpChips,
    buildSourceSummary,
  }
}

let recommendationService: RecommendationService | null = null

export function getRecommendationService(): RecommendationService {
  if (recommendationService) {
    return recommendationService
  }

  const runtimeDeps = createServeRuntimeDependencies()

  recommendationService = new RecommendationService({
    defaultEngineId: "serve",
    engines: [
      createServeRecommendationEngine({
        runSession: async ({ form, messages, prevState, displayedProducts, pagination, language }) =>
          handleServeExploration(runtimeDeps, form, messages, prevState, displayedProducts ?? null, language, pagination ?? null),
        runLegacyChat: async ({ messages, mode }) =>
          handleServeSimpleChat(runtimeDeps, messages, mode ?? "simple"),
      }),
      createMainRecommendationEngine({
        runSession: async ({ form, messages, prevState, displayedProducts, pagination, language }) =>
          handleServeExploration(runtimeDeps, form, messages, prevState, displayedProducts ?? null, language, pagination ?? null),
        runLegacyChat: async ({ messages, mode }) =>
          handleServeSimpleChat(runtimeDeps, messages, mode ?? "simple"),
      }),
    ],
  })

  return recommendationService
}

export async function handleRecommendationPost(req: Request): Promise<Response> {
  try {
    const body = parseRecommendationRequest(await req.json())
    const recommendationService = getRecommendationService()

    return recommendationService.handleRequest({
      engineId: body.engine,
      intakeForm: body.intakeForm as ProductIntakeForm | undefined,
      messages: body.messages ?? [],
      prevState: getRequestSessionState(body),
      displayedProducts: body.displayedProducts ?? null,
      pagination: body.pagination ?? null,
      language: body.language === "en" ? "en" : "ko",
      mode: body.mode ?? "simple",
    })
  } catch (err) {
    console.error("[recommend] Error:", err)

    return jsonRecommendationResponse({
      error: "internal_error",
      detail: err instanceof Error ? err.message : "Unknown error",
      text: "죄송합니다, 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
      purpose: "question",
      chips: ["처음부터 다시", "소재 입력", "직경 입력"],
      isComplete: false,
      recommendation: null,
      sessionState: null,
      evidenceSummaries: null,
      candidateSnapshot: null,
    }, { status: 500 })
  }
}
