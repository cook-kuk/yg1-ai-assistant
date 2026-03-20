import {
  feedbackEntrySchema,
  feedbackEventEntrySchema,
  type FeedbackEntryDto,
  type FeedbackEventEntryDto,
} from "@/lib/contracts/feedback"

type JsonRecord = Record<string, unknown>

function toRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as JsonRecord
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function getRecommendedProducts(value: unknown) {
  return Array.isArray(value) ? value : null
}

function getConversationRecommendations(value: unknown) {
  return Array.isArray(value) ? value : null
}

export function normalizeFeedbackEventRecord(value: unknown): FeedbackEventEntryDto | null {
  const record = toRecord(value)
  if (!record) return null

  const type = record.type
  if (type !== "turn_feedback" && type !== "success_case" && type !== "failure_case") {
    return null
  }

  const normalized = {
    ...record,
    id: typeof record.id === "string" ? record.id : "",
    timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date(0).toISOString(),
    type,
    sessionId: getNullableString(record.sessionId),
    turnNumber: getNullableNumber(record.turnNumber),
    mode: getNullableString(record.mode),
    lastAction: getNullableString(record.lastAction),
    userMessage: getNullableString(record.userMessage),
    aiResponse: getNullableString(record.aiResponse),
    lastUserMessage: getNullableString(record.lastUserMessage),
    lastAiResponse: getNullableString(record.lastAiResponse),
    userComment: getNullableString(record.userComment),
    feedback: getNullableString(record.feedback),
    feedbackEmoji: getNullableString(record.feedbackEmoji),
    responseFeedback: getNullableString(record.responseFeedback),
    chipFeedback: getNullableString(record.chipFeedback),
    chips: getStringArray(record.chips),
    candidateCount: getNullableNumber(record.candidateCount),
    appliedFilters: getStringArray(record.appliedFilters),
    conversationLength: getNullableNumber(record.conversationLength),
    conditions: getNullableString(record.conditions),
    narrowingPath: getNullableString(record.narrowingPath),
    candidateCounts: getNullableString(record.candidateCounts),
    topProducts: getNullableString(record.topProducts),
    language: getNullableString(record.language),
    clientCapturedAt: getNullableString(record.clientCapturedAt),
    chatHistory: Array.isArray(record.chatHistory) ? record.chatHistory : null,
    conversationSnapshot: Array.isArray(record.conversationSnapshot) ? record.conversationSnapshot : null,
    candidateHighlights: Array.isArray(record.candidateHighlights) ? record.candidateHighlights : null,
    recommendedProducts: getRecommendedProducts(record.recommendedProducts),
    conversationRecommendations: getConversationRecommendations(record.conversationRecommendations),
    formSnapshot: record.formSnapshot && typeof record.formSnapshot === "object" && !Array.isArray(record.formSnapshot)
      ? record.formSnapshot
      : null,
    sessionSummary: record.sessionSummary && typeof record.sessionSummary === "object" && !Array.isArray(record.sessionSummary)
      ? record.sessionSummary
      : null,
  }

  const result = feedbackEventEntrySchema.safeParse(normalized)
  return result.success ? result.data : null
}

export function normalizeFeedbackRecord(value: unknown): {
  generalEntry: FeedbackEntryDto | null
  feedbackEntry: FeedbackEventEntryDto | null
} {
  const generalResult = feedbackEntrySchema.safeParse(value)
  if (generalResult.success) {
    return {
      generalEntry: generalResult.data,
      feedbackEntry: null,
    }
  }

  const feedbackResult = feedbackEventEntrySchema.safeParse(value)
  if (feedbackResult.success) {
    return {
      generalEntry: null,
      feedbackEntry: feedbackResult.data,
    }
  }

  return {
    generalEntry: null,
    feedbackEntry: normalizeFeedbackEventRecord(value),
  }
}
