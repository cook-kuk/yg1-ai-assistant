import type { RecommendationEnginePort, RecommendLegacyChatCommand, RecommendSessionCommand } from "@/lib/recommendation/application/ports/recommendation-engine-port"

interface MainRecommendationEngineRuntime {
  runSession(command: RecommendSessionCommand): Promise<Response>
  runLegacyChat(command: RecommendLegacyChatCommand): Promise<Response>
}

export function createMainRecommendationEngine(
  runtime: MainRecommendationEngineRuntime
): RecommendationEnginePort {
  return {
    engineId: "main",
    runSession(command) {
      return runtime.runSession(command)
    },
    runLegacyChat(command) {
      return runtime.runLegacyChat(command)
    },
  }
}
