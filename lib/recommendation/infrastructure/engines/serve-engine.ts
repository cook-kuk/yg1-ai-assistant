import type { RecommendationEnginePort, RecommendLegacyChatCommand, RecommendSessionCommand } from "@/lib/recommendation/application/ports/recommendation-engine-port"

interface ServeRecommendationEngineRuntime {
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}

export function createServeRecommendationEngine(
  runtime: ServeRecommendationEngineRuntime
): RecommendationEnginePort {
  return {
    engineId: "serve",
    runSession(command) {
      return runtime.runSession(command)
    },
    runLegacyChat(command) {
      return runtime.runLegacyChat(command)
    },
  }
}
