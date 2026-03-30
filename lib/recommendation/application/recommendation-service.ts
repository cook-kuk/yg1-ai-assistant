import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type {
  AppLanguage,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

import type { RecommendationEnginePort } from "./ports/recommendation-engine-port"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"

interface RecommendationServiceParams {
  engineId?: string
  intakeForm?: ProductIntakeForm
  messages?: ChatMessage[]
  prevState?: ExplorationSessionState | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize"> | null
  language: AppLanguage
  mode?: string
}

interface RecommendationServiceOptions {
  defaultEngineId: string
  engines: RecommendationEnginePort[]
}

export class RecommendationService {
  // 기본 엔진 ID와 등록된 엔진 집합만 알고, 세부 구현은 포트 뒤로 숨긴다.
  private readonly defaultEngineId: string
  private readonly enginesById: Map<string, RecommendationEnginePort>

  constructor(options: RecommendationServiceOptions) {
    this.defaultEngineId = options.defaultEngineId
    this.enginesById = new Map(options.engines.map(engine => [engine.engineId, engine]))
  }

  private resolveEngine(engineId?: string): RecommendationEnginePort {
    // 요청이 특정 엔진을 지정하지 않으면 defaultEngineId를 사용한다.
    const selectedEngineId = engineId ?? this.defaultEngineId
    const engine = this.enginesById.get(selectedEngineId)
    if (!engine) {
      throw new Error(`Unknown recommendation engine: ${selectedEngineId}`)
    }

    return engine
  }

  async handleRequest(params: RecommendationServiceParams): Promise<Response> {
    traceRecommendation("service.handleRequest:input", {
      engineId: params.engineId ?? this.defaultEngineId,
      hasIntakeForm: !!params.intakeForm,
      messageCount: params.messages?.length ?? 0,
      hasPrevState: !!params.prevState,
      displayedProducts: params.displayedProducts?.length ?? 0,
      pagination: params.pagination ?? null,
      language: params.language,
      mode: params.mode ?? null,
    })

    try {
      const engine = this.resolveEngine(params.engineId)
      const messages = params.messages ?? []
      const response = params.intakeForm
        ? await engine.runSession({
            form: params.intakeForm,
            messages,
            prevState: params.prevState ?? null,
            displayedProducts: params.displayedProducts ?? null,
            pagination: params.pagination ?? null,
            language: params.language,
          })
        : await engine.runLegacyChat({
            messages,
            mode: params.mode,
          })

      traceRecommendation("service.handleRequest:output", {
        engineId: engine.engineId,
        status: response.status,
        ok: response.ok,
        branch: params.intakeForm ? "session" : "legacy-chat",
      })
      return response
    } catch (error) {
      traceRecommendationError("service.handleRequest:error", error, {
        engineId: params.engineId ?? this.defaultEngineId,
      })
      throw error
    }
  }
}
