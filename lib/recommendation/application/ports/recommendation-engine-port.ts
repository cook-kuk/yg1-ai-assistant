import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type {
  AppLanguage,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

export interface RecommendSessionCommand {
  form: ProductIntakeForm
  messages: ChatMessage[]
  prevState: ExplorationSessionState | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize"> | null
  language: AppLanguage
}

export interface RecommendLegacyChatCommand {
  messages: ChatMessage[]
  mode?: string
}

export interface RecommendationEnginePort {
  readonly engineId: string
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}
