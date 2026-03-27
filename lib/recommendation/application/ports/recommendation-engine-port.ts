import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type {
  AppLanguage,
  ChatMessage,
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"

// 추천 세션용 명령. intakeForm과 이전 상태를 함께 넘겨 멀티턴 탐색을 이어간다.
export interface RecommendSessionCommand {
  form: ProductIntakeForm
  messages: ChatMessage[]
  prevState: ExplorationSessionState | null
  displayedProducts?: RecommendationDisplayedProductRequestDto[] | null
  pagination?: Pick<RecommendationPaginationDto, "page" | "pageSize"> | null
  language: AppLanguage
}

// intakeForm 없이 대화만 처리하는 레거시 채팅 경로다.
export interface RecommendLegacyChatCommand {
  messages: ChatMessage[]
  mode?: string
}

// HTTP 레이어가 구체 엔진 구현을 모르게 하기 위한 포트다.
export interface RecommendationEnginePort {
  readonly engineId: string
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}
