import type { RecommendationEnginePort, RecommendLegacyChatCommand, RecommendSessionCommand } from "@/lib/recommendation/application/ports/recommendation-engine-port"

interface ServeRecommendationEngineRuntime {
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}

export function createServeRecommendationEngine(
  runtime: ServeRecommendationEngineRuntime
): RecommendationEnginePort {
  return {
    // 서비스 레이어가 engineId로 선택할 수 있도록 식별자를 노출한다.
    engineId: "serve",
    runSession(command) {
      // 실제 동작은 주입된 runtime에 그대로 위임한다.
      return runtime.runSession(command)
    },
    runLegacyChat(command) {
      return runtime.runLegacyChat(command)
    },
  }
}
