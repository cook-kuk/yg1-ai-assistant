import crypto from "crypto"

import { type FeedbackEntryDto, type FeedbackListResponseDto } from "@/lib/contracts/feedback"
import {
  loadAllFeedbackData,
  saveFeedbackRecord,
  saveFeedbackScreenshots,
} from "@/lib/feedback/infrastructure/storage/feedback-storage"
import { logFeedbackEventToMongo } from "@/lib/feedback/infrastructure/persistence/feedback-mongo-log"
import { loadAllFeedbackDataFromMongo } from "@/lib/feedback/infrastructure/persistence/feedback-mongo-read"
import {
  notifyFailureCase as slackNotifyFailureCase,
  notifyFeedback as slackNotifyFeedback,
  notifySuccessCase as slackNotifySuccessCase,
  notifyTurnFeedback as slackNotifyTurnFeedback,
} from "@/lib/feedback/infrastructure/notifications/feedback-notifier"

type JsonRecord = Record<string, unknown>
type SuccessCaseNotification = Parameters<typeof slackNotifySuccessCase>[0]
type FailureCaseNotification = Parameters<typeof slackNotifyFailureCase>[0]
type TurnFeedbackNotification = Parameters<typeof slackNotifyTurnFeedback>[0]

type FeedbackPostResult =
  | { status: 200; body: { success: true; id: string; screenshotCount?: number } }
  | { status: 400; body: { error: string } }

function toRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as JsonRecord
}

function saveLoggedFeedbackRecord(entry: JsonRecord, label: string): string {
  const { filepath } = saveFeedbackRecord(entry)
  console.log(label, JSON.stringify(entry))
  return filepath
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function getNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function getBoolean(value: unknown): boolean {
  return value === true
}

function toRecordArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
}

function trimText(value: unknown, maxLength = 2000): string {
  const text = getString(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function sanitizeConversationSnapshot(value: unknown): JsonRecord[] | null {
  const items = toRecordArray(value).map(item => ({
    index: typeof item.index === "number" ? item.index : null,
    role: getString(item.role),
    text: trimText(item.text, 4000),
    isLoading: getBoolean(item.isLoading),
    chips: getStringArray(item.chips),
    feedback: getNullableString(item.feedback),
    chipFeedback: getNullableString(item.chipFeedback),
    createdAt: getNullableString(item.createdAt),
  }))

  return items.length > 0 ? items : null
}

function sanitizeChatHistory(value: unknown): Array<{ role: string; text: string }> | null {
  const items = toRecordArray(value).map(item => ({
    role: getString(item.role),
    text: trimText(item.text, 2000),
  }))

  return items.length > 0 ? items : null
}

function sanitizeFormSnapshot(value: unknown): JsonRecord | null {
  return toRecord(value)
}

function sanitizeSessionSummary(value: unknown): JsonRecord | null {
  const session = toRecord(value)
  if (Object.keys(session).length === 0) return null

  return {
    sessionId: getNullableString(session.sessionId),
    candidateCount: getNullableNumber(session.candidateCount),
    resolutionStatus: getNullableString(session.resolutionStatus),
    turnCount: getNullableNumber(session.turnCount),
    lastAskedField: getNullableString(session.lastAskedField),
    lastAction: getNullableString(session.lastAction),
    currentMode: getNullableString(session.currentMode),
    activeGroupKey: getNullableString(session.activeGroupKey),
    displayedChips: getStringArray(session.displayedChips),
    appliedFilters: Array.isArray(session.appliedFilters) ? session.appliedFilters : [],
    narrowingHistory: Array.isArray(session.narrowingHistory) ? session.narrowingHistory : [],
    uiNarrowingPath: Array.isArray(session.uiNarrowingPath) ? session.uiNarrowingPath : [],
    capabilities: toRecord(session.capabilities),
  }
}

function sanitizeCandidateHighlights(value: unknown): JsonRecord[] | null {
  const items = toRecordArray(value).map(item => ({
    rank: getNullableNumber(item.rank),
    productCode: getString(item.productCode),
    displayCode: getString(item.displayCode),
    score: getNullableNumber(item.score),
  })).filter(item => item.productCode || item.displayCode)

  return items.length > 0 ? items : null
}

function sanitizeRecommendedProducts(value: unknown): JsonRecord[] | null {
  const items = toRecordArray(value).map(item => ({
    rank: getNumber(item.rank),
    productCode: getString(item.productCode),
    displayCode: getString(item.displayCode),
    brand: getNullableString(item.brand),
    seriesName: getNullableString(item.seriesName),
    diameterMm: getNullableNumber(item.diameterMm),
    fluteCount: getNullableNumber(item.fluteCount),
    coating: getNullableString(item.coating),
    toolMaterial: getNullableString(item.toolMaterial),
    score: getNumber(item.score),
    matchStatus: getString(item.matchStatus, "approximate"),
  })).filter(item => item.productCode || item.displayCode)

  return items.length > 0 ? items : null
}

function sanitizeConversationRecommendations(value: unknown): JsonRecord[] | null {
  const items = toRecordArray(value).map(item => ({
    messageIndex: getNumber(item.messageIndex),
    anchorText: getNullableString(item.anchorText),
    products: sanitizeRecommendedProducts(item.products) ?? [],
  })).filter(item => item.products.length > 0)

  return items.length > 0 ? items : null
}

function getFailureFeedbackHistory(value: unknown): FailureCaseNotification["feedbackHistory"] {
  if (!Array.isArray(value)) return null

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map(item => ({
      text: getString(item.text),
      feedback: getNullableString(item.feedback),
      chipFeedback: getNullableString(item.chipFeedback),
    }))
}

function sanitizeFeedbackIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120)
}

function buildTurnFeedbackId(body: JsonRecord): string {
  const feedbackGroupId = typeof body.feedbackGroupId === "string" ? body.feedbackGroupId.trim() : ""
  if (feedbackGroupId) {
    return `tf-${sanitizeFeedbackIdPart(feedbackGroupId)}`
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim()
    ? body.sessionId.trim()
    : "no-session"
  const turnNumber = typeof body.turnNumber === "number" ? body.turnNumber : 0
  return `tf-${sanitizeFeedbackIdPart(`${sessionId}-${turnNumber}`)}`
}

async function notifySuccessCase(entry: JsonRecord) {
  slackNotifySuccessCase({
    sessionId: getNullableString(entry.sessionId),
    mode: getNullableString(entry.mode),
    conditions: getString(entry.conditions),
    candidateCounts: getString(entry.candidateCounts),
    topProducts: getString(entry.topProducts),
    narrowingPath: getString(entry.narrowingPath),
    userComment: getString(entry.userComment),
    lastUserMessage: getString(entry.lastUserMessage),
    lastAiResponse: getString(entry.lastAiResponse),
    conversationLength: getNumber(entry.conversationLength),
    comparisonArtifact: entry.lastComparisonArtifact
      ? JSON.stringify(entry.lastComparisonArtifact).slice(0, 200)
      : null,
  } satisfies SuccessCaseNotification).catch(() => {})
}

async function notifyFailureCase(entry: JsonRecord) {
  slackNotifyFailureCase({
    sessionId: getNullableString(entry.sessionId),
    userComment: getString(entry.userComment),
    mode: getNullableString(entry.mode),
    lastUserMessage: getString(entry.lastUserMessage),
    lastAiResponse: getString(entry.lastAiResponse),
    conditions: getString(entry.conditions),
    candidateCounts: getString(entry.candidateCounts),
    topProducts: getString(entry.topProducts),
    conversationLength: getNumber(entry.conversationLength),
    appliedFilters: getStringArray(entry.appliedFilters),
    feedbackHistory: getFailureFeedbackHistory(entry.feedbackHistory),
  } satisfies FailureCaseNotification).catch(() => {})
}

async function notifyTurnFeedback(entry: JsonRecord) {
  slackNotifyTurnFeedback({
    turnNumber: getNumber(entry.turnNumber),
    feedback: getString(entry.feedback, "neutral"),
    feedbackEmoji: getString(entry.feedbackEmoji, "😐"),
    userMessage: getString(entry.userMessage),
    aiResponse: getString(entry.aiResponse),
    chips: getStringArray(entry.chips),
    sessionId: getNullableString(entry.sessionId),
    candidateCount: getNullableNumber(entry.candidateCount),
    appliedFilters: getStringArray(entry.appliedFilters),
    conversationLength: getNumber(entry.conversationLength),
  } satisfies TurnFeedbackNotification).catch(() => {})
}

async function notifyGeneralFeedback(entry: FeedbackEntryDto, screenshotCount: number) {
  slackNotifyFeedback({
    rating: entry.rating,
    comment: entry.comment,
    tags: entry.tags,
    authorType: entry.authorType,
    authorName: entry.authorName,
    screenshotCount,
    intakeSummary: entry.intakeSummary,
    recommendationSummary: entry.recommendationSummary,
    chatHistoryLength: entry.chatHistory?.length ?? 0,
  }).catch(() => {})
}

export class FeedbackService {
  async save(req: Request, rawBody: unknown): Promise<FeedbackPostResult> {
    const body = toRecord(rawBody)

    if (body.type === "success_case") {
      const successEntry: JsonRecord = {
        id: `sc-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        timestamp: new Date().toISOString(),
        type: "success_case",
        sessionId: body.sessionId ?? null,
        userComment: body.userComment ?? "",
        mode: body.mode ?? null,
        lastAction: body.lastAction ?? null,
        lastUserMessage: body.lastUserMessage ?? "",
        lastAiResponse: body.lastAiResponse ?? "",
        conditions: body.conditions ?? "",
        narrowingPath: body.narrowingPath ?? "",
        candidateCounts: body.candidateCounts ?? "",
        topProducts: body.topProducts ?? "",
        conversationLength: body.conversationLength ?? 0,
        appliedFilters: body.appliedFilters ?? [],
        chatHistory: sanitizeChatHistory(body.chatHistory),
        formSnapshot: sanitizeFormSnapshot(body.formSnapshot),
        sessionSummary: sanitizeSessionSummary(body.sessionStateSnapshot),
        candidateHighlights: sanitizeCandidateHighlights(body.candidateHighlights),
        recommendedProducts: sanitizeRecommendedProducts(body.recommendedProducts),
        conversationRecommendations: sanitizeConversationRecommendations(body.conversationRecommendations),
        conversationSnapshot: sanitizeConversationSnapshot(body.conversationSnapshot),
        language: getNullableString(body.language),
        clientCapturedAt: getNullableString(body.clientCapturedAt),
      }

      const localJsonPath = saveLoggedFeedbackRecord(successEntry, "[TURN_FEEDBACK]")

      logFeedbackEventToMongo({
        eventType: "success_case",
        request: req,
        rawBody: body,
        persistedEntry: successEntry,
        storage: {
          localJsonId: String(successEntry.id),
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log success_case to MongoDB:", error)
      })

      void notifySuccessCase(successEntry)

      return { status: 200, body: { success: true, id: String(successEntry.id) } }
    }

    if (body.type === "failure_case") {
      const failureEntry: JsonRecord = {
        id: `fc-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        timestamp: new Date().toISOString(),
        type: "failure_case",
        sessionId: body.sessionId ?? null,
        userComment: body.userComment ?? "",
        mode: body.mode ?? null,
        lastAction: body.lastAction ?? null,
        lastUserMessage: body.lastUserMessage ?? "",
        lastAiResponse: body.lastAiResponse ?? "",
        conditions: body.conditions ?? "",
        candidateCounts: body.candidateCounts ?? "",
        topProducts: body.topProducts ?? "",
        conversationLength: body.conversationLength ?? 0,
        appliedFilters: body.appliedFilters ?? [],
        chatHistory: sanitizeChatHistory(body.chatHistory),
        feedbackHistory: body.feedbackHistory ?? null,
        formSnapshot: sanitizeFormSnapshot(body.formSnapshot),
        sessionSummary: sanitizeSessionSummary(body.sessionStateSnapshot),
        candidateHighlights: sanitizeCandidateHighlights(body.candidateHighlights),
        recommendedProducts: sanitizeRecommendedProducts(body.recommendedProducts),
        conversationRecommendations: sanitizeConversationRecommendations(body.conversationRecommendations),
        conversationSnapshot: sanitizeConversationSnapshot(body.conversationSnapshot),
        language: getNullableString(body.language),
        clientCapturedAt: getNullableString(body.clientCapturedAt),
      }

      const localJsonPath = saveLoggedFeedbackRecord(failureEntry, "[TURN_FEEDBACK]")

      logFeedbackEventToMongo({
        eventType: "failure_case",
        request: req,
        rawBody: body,
        persistedEntry: failureEntry,
        storage: {
          localJsonId: String(failureEntry.id),
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log failure_case to MongoDB:", error)
      })

      void notifyFailureCase(failureEntry)

      return { status: 200, body: { success: true, id: String(failureEntry.id) } }
    }

    if (body.type === "turn_feedback") {
      const responseFeedback = body.responseFeedback
        ?? (body.feedbackTarget === "response" ? body.feedback : null)
        ?? null
      const responseFeedbackEmoji = body.responseFeedbackEmoji
        ?? (body.feedbackTarget === "response" ? body.feedbackEmoji : null)
        ?? null
      const chipFeedback = body.chipFeedback
        ?? (body.feedbackTarget === "chips" ? body.feedback : null)
        ?? null
      const chipFeedbackEmoji = body.chipFeedbackEmoji
        ?? (body.feedbackTarget === "chips" ? body.feedbackEmoji : null)
        ?? null

      const turnEntry: JsonRecord = {
        id: buildTurnFeedbackId(body),
        timestamp: new Date().toISOString(),
        type: "turn_feedback",
        feedbackGroupId: body.feedbackGroupId ?? null,
        turnNumber: body.turnNumber ?? 0,
        feedback: responseFeedback ?? chipFeedback ?? "neutral",
        feedbackEmoji: responseFeedbackEmoji ?? chipFeedbackEmoji ?? "😐",
        responseFeedback,
        responseFeedbackEmoji,
        chipFeedback,
        chipFeedbackEmoji,
        userMessage: body.userMessage ?? "",
        aiResponse: body.aiResponse ?? "",
        chips: body.chips ?? [],
        sessionId: body.sessionId ?? null,
        candidateCount: body.candidateCount ?? null,
        appliedFilters: body.appliedFilters ?? [],
        conversationLength: body.conversationLength ?? 0,
        formSnapshot: sanitizeFormSnapshot(body.formSnapshot),
        sessionSummary: sanitizeSessionSummary(body.sessionStateSnapshot),
        candidateHighlights: sanitizeCandidateHighlights(body.candidateHighlights),
        recommendedProducts: sanitizeRecommendedProducts(body.recommendedProducts),
        conversationRecommendations: sanitizeConversationRecommendations(body.conversationRecommendations),
        conversationSnapshot: sanitizeConversationSnapshot(body.conversationSnapshot),
        language: getNullableString(body.language),
        clientCapturedAt: getNullableString(body.clientCapturedAt),
      }

      const localJsonPath = saveLoggedFeedbackRecord(turnEntry, "[TURN_FEEDBACK]")

      logFeedbackEventToMongo({
        eventType: "turn_feedback",
        request: req,
        rawBody: body,
        persistedEntry: turnEntry,
        storage: {
          localJsonId: String(turnEntry.id),
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log turn_feedback to MongoDB:", error)
      })

      void notifyTurnFeedback(turnEntry)

      return { status: 200, body: { success: true, id: String(turnEntry.id) } }
    }

    const screenshots = Array.isArray(body.screenshots) ? body.screenshots as Array<{ name: string; dataUrl: string; size: number }> : []

    const entry: FeedbackEntryDto = {
      id: `fb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      timestamp: new Date().toISOString(),
      authorType: (body.authorType as FeedbackEntryDto["authorType"]) ?? "anonymous",
      authorName: typeof body.authorName === "string" ? body.authorName : "",
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      intakeSummary: typeof body.intakeSummary === "string" ? body.intakeSummary : null,
      chatHistory: Array.isArray(body.chatHistory) ? body.chatHistory as FeedbackEntryDto["chatHistory"] : null,
      recommendationSummary: typeof body.recommendationSummary === "string" ? body.recommendationSummary : null,
      rating: typeof body.rating === "number" ? body.rating : null,
      comment: typeof body.comment === "string" ? body.comment : "",
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
    }

    if (!entry.comment.trim() && !entry.rating) {
      return { status: 400, body: { error: "Comment or rating required" } }
    }

    const screenshotPaths = saveFeedbackScreenshots(entry.id, screenshots)
    const persistedEntry: JsonRecord = {
      ...entry,
      screenshotCount: screenshots.length,
      screenshotPaths,
      formSnapshot: sanitizeFormSnapshot(body.formSnapshot),
      sessionSummary: sanitizeSessionSummary(body.sessionStateSnapshot),
      candidateHighlights: sanitizeCandidateHighlights(body.candidateHighlights),
      recommendedProducts: sanitizeRecommendedProducts(body.recommendedProducts),
      conversationRecommendations: sanitizeConversationRecommendations(body.conversationRecommendations),
      conversationSnapshot: sanitizeConversationSnapshot(body.conversationSnapshot),
      language: getNullableString(body.language),
      clientCapturedAt: getNullableString(body.clientCapturedAt),
    }

    const localJsonPath = saveLoggedFeedbackRecord(persistedEntry, "[FEEDBACK]")

    logFeedbackEventToMongo({
      eventType: "general_feedback",
      request: req,
      rawBody: body,
      persistedEntry,
      storage: {
        localJsonId: entry.id,
        localJsonPath,
        screenshotPaths,
      },
    }).catch(error => {
      console.error("[feedback] Failed to log general_feedback to MongoDB:", error)
    })

    void notifyGeneralFeedback(entry, screenshots.length)

    return {
      status: 200,
      body: {
        success: true,
        id: entry.id,
        screenshotCount: screenshots.length,
      },
    }
  }

  async loadAll(): Promise<FeedbackListResponseDto> {
    const mongoData = await loadAllFeedbackDataFromMongo().catch(error => {
      console.error("[feedback] Failed to load feedback from MongoDB, falling back to JSON:", error)
      return null
    })

    const { generalEntries, feedbackEntries } = mongoData ?? loadAllFeedbackData()

    return {
      generalEntries,
      feedbackEntries,
      generalTotal: generalEntries.length,
      feedbackTotal: feedbackEntries.length,
    }
  }
}
