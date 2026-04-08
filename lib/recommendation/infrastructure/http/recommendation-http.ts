import { NextResponse } from "next/server"
import { installRecommendationConsoleGuard } from "@/lib/recommendation/infrastructure/observability/recommendation-console-guard"

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
  handleCompetitorCrossReference,
  handleDirectCuttingConditionQuestion,
  handleDirectEntityProfileQuestion,
  handleDirectInventoryQuestion,
  handleDirectProductInfoQuestion,
  handleGeneralChat,
  handleContextualNarrowingQuestion,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-assist"
import { applyFilterToInput, mapIntakeToInput } from "@/lib/recommendation/infrastructure/engines/serve-engine-input"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
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
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import { runWithBenchmark, getBenchmarkTurnUsage } from "@/lib/llm/benchmark-collector"
import type {
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

installRecommendationConsoleGuard()

// 외부 요청 body를 공개 API 계약 스키마로 검증한다.
function parseRecommendationRequest(body: unknown): RecommendationRequestDto {
  return recommendationRequestSchema.parse(body) as RecommendationRequestDto
}

// 신형 sessionState가 있으면 그대로 쓰고, 없으면 구형 session payload를 호환 변환한다.
function getRequestSessionState(body: RecommendationRequestDto): ExplorationSessionState | null {
  if (body.sessionState && typeof body.sessionState === "object") {
    return body.sessionState as ExplorationSessionState
  }

  return getEngineSessionState(body.session ?? null)
}

function summarizeRequestBodyForTrace(body: unknown) {
  if (!body || typeof body !== "object") return { kind: typeof body }

  const raw = body as Record<string, unknown>
  const messages = Array.isArray(raw.messages) ? raw.messages as Array<Record<string, unknown>> : []
  const displayedProducts = Array.isArray(raw.displayedProducts) ? raw.displayedProducts as Array<Record<string, unknown>> : []
  const intakeForm = raw.intakeForm && typeof raw.intakeForm === "object"
    ? raw.intakeForm as Record<string, unknown>
    : null
  const session = raw.session && typeof raw.session === "object"
    ? raw.session as Record<string, unknown>
    : null
  const publicState = session?.publicState && typeof session.publicState === "object"
    ? session.publicState as Record<string, unknown>
    : null

  return {
    keys: Object.keys(raw),
    engine: raw.engine ?? null,
    language: raw.language ?? null,
    mode: raw.mode ?? null,
    intakeKeys: intakeForm ? Object.keys(intakeForm) : [],
    messageCount: messages.length,
    recentMessages: messages.slice(-3).map(message => ({
      role: message.role ?? null,
      text: typeof message.text === "string" ? message.text.slice(0, 120) : null,
    })),
    displayedProductCount: displayedProducts.length,
    displayedProductPreview: displayedProducts.slice(0, 5).map(product => ({
      rank: product.rank ?? null,
      code: product.code ?? null,
      series: product.series ?? null,
      toolSubtype: product.toolSubtype ?? null,
    })),
    hasSession: !!session,
    sessionPublicState: publicState ? {
      currentMode: publicState.currentMode ?? null,
      lastAskedField: publicState.lastAskedField ?? null,
      resolutionStatus: publicState.resolutionStatus ?? null,
      candidateCount: publicState.candidateCount ?? null,
      displayedChipCount: Array.isArray(publicState.displayedChips) ? publicState.displayedChips.length : 0,
      displayedOptionCount: Array.isArray(publicState.displayedOptions) ? publicState.displayedOptions.length : 0,
    } : null,
  }
}

export function jsonRecommendationResponse(
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
): Response {
  // 내부 도메인 응답을 프런트 계약 DTO로 변환한 뒤 JSON으로 내보낸다.
  const dto = buildRecommendationResponseDto(params)
  ;(dto as any)._build = "v3-0406"
  traceRecommendation("http.jsonRecommendationResponse:dto", {
    purpose: dto.purpose,
    chipCount: dto.chips.length,
    chipPreview: dto.chips.slice(0, 6),
    chipGroupCount: dto.chipGroups?.length ?? 0,
    chipGroups: (dto.chipGroups ?? []).map(group => ({
      label: group.label,
      count: group.chips.length,
      preview: group.chips.slice(0, 4),
    })),
    sessionLastAskedField: dto.session.publicState?.lastAskedField ?? null,
    sessionMode: dto.session.publicState?.currentMode ?? null,
  })
  console.log("[chip-groups:server:http]", JSON.stringify({
    purpose: dto.purpose,
    chipCount: dto.chips.length,
    chipPreview: dto.chips.slice(0, 6),
    chipGroupCount: dto.chipGroups?.length ?? 0,
    chipGroups: (dto.chipGroups ?? []).map(group => ({
      label: group.label,
      count: group.chips.length,
      preview: group.chips.slice(0, 4),
    })),
    sessionLastAskedField: dto.session.publicState?.lastAskedField ?? null,
    sessionMode: dto.session.publicState?.currentMode ?? null,
  }))

  return NextResponse.json({
    ...dto,
    // UI 마이그레이션 동안만 유지하는 하위 호환 alias다.
    sessionState: params.sessionState ?? null,
    candidateSnapshot: params.candidateSnapshot ?? null,
    extractedField: params.meta?.extractedField ?? null,
  }, init)
}

function createServeRuntimeDependencies(): ServeEngineRuntimeDependencies {
  // 런타임이 직접 import하지 않도록, 응답/보조 기능들을 의존성으로 묶어 주입한다.
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
      excludeWorkPieceValues?: Parameters<typeof buildQuestionResponse>[17],
      responsePrefix?: Parameters<typeof buildQuestionResponse>[18],
      overrideChips?: Parameters<typeof buildQuestionResponse>[19],
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
      excludeWorkPieceValues,
      responsePrefix,
      overrideChips,
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
    // provider 생성 시점은 요청 처리 직전으로 늦춰, 테스트/런타임 교체를 쉽게 한다.
    handleDirectEntityProfileQuestion: (userMessage, currentInput, prevState, options) =>
      handleDirectEntityProfileQuestion(getProvider(), userMessage, currentInput, prevState, options),
    handleDirectProductInfoQuestion,
    handleDirectBrandReferenceQuestion,
    handleCompetitorCrossReference,
    handleDirectCuttingConditionQuestion,
    handleContextualNarrowingQuestion,
    handleGeneralChat,
    jsonRecommendationResponse,
    getFollowUpChips,
    buildSourceSummary,
  }
}

// API route 레벨에서 서비스 인스턴스를 재사용해 엔진 생성 비용을 줄인다.
let recommendationService: RecommendationService | null = null

export function getRecommendationService(): RecommendationService {
  if (recommendationService) {
    return recommendationService
  }

  const runtimeDeps = createServeRuntimeDependencies()

  recommendationService = new RecommendationService({
    // 별도 engineId가 없으면 serve 엔진을 기본 경로로 사용한다.
    defaultEngineId: "serve",
    engines: [
      createServeRecommendationEngine({
        // 세션 추천 요청은 공통 serve exploration 런타임으로 연결한다.
        runSession: async ({ form, messages, prevState, displayedProducts, pagination, language }) =>
          handleServeExploration(runtimeDeps, form, messages, prevState, displayedProducts ?? null, language, pagination ?? null),
        // intakeForm 없는 레거시 chat 요청도 같은 serve 런타임의 단순 채팅 경로로 보낸다.
        runLegacyChat: async ({ messages, mode }) =>
          handleServeSimpleChat(runtimeDeps, messages, mode ?? "simple"),
      }),
      createMainRecommendationEngine({
        // main 엔진도 현재는 동일한 exploration/runtime 구현을 공유한다.
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
    // 1. 요청 본문을 읽고
    const rawBody = await req.json()
    // Precision mode opt-in: header `x-precision-match: 1` OR body.precisionMode === true.
    // Used by test runners to get exact DB-count matching (skips diameter fuzzy ±2 + knowledge fallback).
    const precisionMode = req.headers.get("x-precision-match") === "1"
      || (rawBody && typeof rawBody === "object" && (rawBody as Record<string, unknown>).precisionMode === true)
    const disableKg = req.headers.get("x-disable-kg") === "1"
      || (rawBody && typeof rawBody === "object" && (rawBody as Record<string, unknown>).disableKg === true)
    const { runWithRuntimeFlags } = await import("@/lib/recommendation/runtime-flags")
    return runWithRuntimeFlags({ precisionMode, disableKg }, () => handleRecommendationPostInner(req, rawBody))
  } catch (err) {
    traceRecommendationError("http.handleRecommendationPost:error", err)
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

async function handleRecommendationPostInner(req: Request, rawBody: unknown): Promise<Response> {
  try {
    traceRecommendation("http.handleRecommendationPost:input", {
      method: "POST",
      url: req.url,
      body: summarizeRequestBodyForTrace(rawBody),
    })
    const body = parseRecommendationRequest(rawBody)
    // 2. 서비스/엔진 진입점을 준비한 뒤
    const recommendationService = getRecommendationService()

    // 3. 공개 DTO를 내부 command 형태로 바꿔 서비스에 넘긴다.
    const response = await runWithBenchmark(() =>
      recommendationService.handleRequest({
        engineId: body.engine,
        intakeForm: body.intakeForm as ProductIntakeForm | undefined,
        messages: body.messages ?? [],
        prevState: getRequestSessionState(body),
        displayedProducts: body.displayedProducts ?? null,
        pagination: body.pagination ?? null,
        language: body.language === "en" ? "en" : "ko",
        mode: body.mode ?? "simple",
      })
    )

    // Inject benchmark LLM usage into response meta
    const benchmarkUsage = getBenchmarkTurnUsage()
    if (benchmarkUsage) {
      try {
        const json = await response.json()
        const meta = (json as Record<string, unknown>).meta ?? {}
        ;(meta as Record<string, unknown>).benchmarkLlmUsage = benchmarkUsage
        ;(json as Record<string, unknown>).meta = meta
        return new Response(JSON.stringify(json), {
          status: response.status,
          headers: response.headers,
        })
      } catch { /* response not JSON — return as-is */ }
    }

    traceRecommendation("http.handleRecommendationPost:output", {
      status: response.status,
      ok: response.ok,
      engineId: body.engine ?? "serve",
    })
    return response
  } catch (err) {
    traceRecommendationError("http.handleRecommendationPost:error", err)
    console.error("[recommend] Error:", err)

    // 계약된 에러 응답 형태를 유지해 UI가 항상 같은 구조를 받도록 한다.
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
