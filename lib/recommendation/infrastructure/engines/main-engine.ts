import type { RecommendationEnginePort, RecommendLegacyChatCommand, RecommendSessionCommand } from "@/lib/recommendation/application/ports/recommendation-engine-port"

interface MainRecommendationEngineRuntime {
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}

export function createMainRecommendationEngine(
  runtime: MainRecommendationEngineRuntime
): RecommendationEnginePort {
  return {
    // main 엔진 식별자. 현재는 serve와 같은 runtime을 공유하지만 선택 포인트는 유지한다.
    engineId: "main",
    runSession(command) {
      return runtime.runSession(command)
    },
    runLegacyChat(command) {
      return runtime.runLegacyChat(command)
    },
  }
}
