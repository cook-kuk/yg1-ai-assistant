import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { OrchestratorResult } from "@/lib/recommendation/infrastructure/agents/types"
import type {
  AppliedFilter,
  CandidateSnapshot,
  ExplorationSessionState,
  NarrowingTurn,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

/**
 * Shared context passed to every extracted action handler.
 *
 * This mirrors the local variables that `handleServeExplorationInner` builds
 * before entering its action-dispatch switch.
 */
export interface ActionHandlerContext {
  /** jsonRecommendationResponse helper from deps */
  jsonRecommendationResponse: JsonRecommendationResponse

  /** Previous exploration session state (always present when action handlers run) */
  prevState: ExplorationSessionState

  /** Accumulated applied filters for the current turn */
  filters: AppliedFilter[]

  /** Accumulated narrowing history for the current turn */
  narrowingHistory: NarrowingTurn[]

  /** Resolved recommendation input for the current turn */
  currentInput: RecommendationInput

  /** Current turn count */
  turnCount: number

  /** Orchestrator result (for meta tagging) */
  orchResult: OrchestratorResult
}
