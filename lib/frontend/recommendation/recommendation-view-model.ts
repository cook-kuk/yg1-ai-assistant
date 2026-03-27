import type {
  RecommendationCapabilityDto,
  RecommendationPublicSessionDto,
  RecommendationResponseDto,
} from "@/lib/contracts/recommendation"

export const DEFAULT_RECOMMENDATION_CAPABILITIES: RecommendationCapabilityDto = {
  canCompare: false,
  canRestoreTask: false,
  canGroupBySeries: false,
  canFilterDisplayed: false,
}

export function resolveRecommendationCapabilities(
  response: Pick<RecommendationResponseDto, "capabilities" | "session">
): RecommendationCapabilityDto {
  return response.session.publicState?.capabilities ?? response.capabilities ?? DEFAULT_RECOMMENDATION_CAPABILITIES
}

export function getSessionCapabilities(
  sessionState: RecommendationPublicSessionDto | null,
  fallback: RecommendationCapabilityDto = DEFAULT_RECOMMENDATION_CAPABILITIES
): RecommendationCapabilityDto {
  return sessionState?.capabilities ?? fallback
}

export function isUndoChipEnabled(
  chip: string,
  capabilities: RecommendationCapabilityDto
): boolean {
  return chip === "⟵ 이전 단계" && capabilities.canRestoreTask
}
