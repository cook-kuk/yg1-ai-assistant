import type { RecommendationDisplayedProductRequestDto } from "@/lib/contracts/recommendation"
import type {
  AppLanguage,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

import type { RecommendationEnginePort } from "./ports/recommendation-engine-port"

interface RecommendationServiceParams {
  engineId?: string
  intakeForm?: ProductIntakeForm
  messages?: ChatMessage[]
  prevState?: ExplorationSessionState | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  language: AppLanguage
  mode?: string
}

interface RecommendationServiceOptions {
  defaultEngineId: string
  engines: RecommendationEnginePort[]
}

export class RecommendationService {
  private readonly defaultEngineId: string
  private readonly enginesById: Map<string, RecommendationEnginePort>

  constructor(options: RecommendationServiceOptions) {
    this.defaultEngineId = options.defaultEngineId
    this.enginesById = new Map(options.engines.map(engine => [engine.engineId, engine]))
  }

  private resolveEngine(engineId?: string): RecommendationEnginePort {
    const selectedEngineId = engineId ?? this.defaultEngineId
    const engine = this.enginesById.get(selectedEngineId)
    if (!engine) {
      throw new Error(`Unknown recommendation engine: ${selectedEngineId}`)
    }

    return engine
  }

  async handleRequest(params: RecommendationServiceParams): Promise<Response> {
    const engine = this.resolveEngine(params.engineId)
    const messages = params.messages ?? []

    if (params.intakeForm) {
      return engine.runSession({
        form: params.intakeForm,
        messages,
        prevState: params.prevState ?? null,
        displayedProducts: params.displayedProducts ?? null,
        language: params.language,
      })
    }

    return engine.runLegacyChat({
      messages,
      mode: params.mode,
    })
  }
}
