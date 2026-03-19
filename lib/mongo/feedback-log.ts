import { randomBytes } from "node:crypto"
import { getMongoLogDb } from "@/lib/mongo/client"

type JsonRecord = Record<string, unknown>
type FeedbackEventDocument = {
  _id?: string
  [key: string]: unknown
}

type FeedbackLogInput = {
  eventType: string
  request: Request
  rawBody: JsonRecord
  persistedEntry: JsonRecord
  storage: {
    localJsonId: string
    localJsonPath?: string | null
    screenshotPaths?: string[]
  }
}

function toFlatRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as JsonRecord
}

function safeClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function truncateText(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string" || value.length === 0) return null
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function createServerEventId(): string {
  return randomBytes(16).toString("hex")
}

function extractRequestMeta(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const referer = request.headers.get("referer")
  const origin = request.headers.get("origin")
  const userAgent = request.headers.get("user-agent")

  return {
    method: request.method,
    url: request.url,
    origin,
    referer,
    userAgent,
    forwardedFor,
    requestId:
      request.headers.get("x-request-id")
      ?? request.headers.get("x-vercel-id")
      ?? request.headers.get("cf-ray")
      ?? null,
    headers: {
      "content-type": request.headers.get("content-type"),
      "accept-language": request.headers.get("accept-language"),
      "x-forwarded-for": forwardedFor,
      "x-forwarded-proto": request.headers.get("x-forwarded-proto"),
      "x-real-ip": request.headers.get("x-real-ip"),
      "x-vercel-id": request.headers.get("x-vercel-id"),
      origin,
      referer,
      "user-agent": userAgent,
    },
  }
}

function extractIdentifiers(rawBody: JsonRecord, persistedEntry: JsonRecord) {
  const feedbackGroupId = persistedEntry.feedbackGroupId ?? rawBody.feedbackGroupId ?? null
  const turnKey = feedbackGroupId
    ?? `${persistedEntry.sessionId ?? rawBody.sessionId ?? "no-session"}:${persistedEntry.turnNumber ?? rawBody.turnNumber ?? 0}`

  return {
    sessionId: persistedEntry.sessionId ?? rawBody.sessionId ?? null,
    turnNumber: persistedEntry.turnNumber ?? rawBody.turnNumber ?? null,
    feedbackId: persistedEntry.id ?? null,
    clientEventId: rawBody.clientEventId ?? null,
    feedbackTarget: rawBody.feedbackTarget ?? null,
    feedbackGroupId,
    turnKey,
  }
}

function extractSummary(rawBody: JsonRecord, persistedEntry: JsonRecord, eventType: string) {
  const requestPayload = toFlatRecord(rawBody.requestPayload)
  const responsePayload = toFlatRecord(rawBody.responsePayload)
  const sessionStateSnapshot =
    toFlatRecord(rawBody.sessionStateSnapshot)
    ?? toFlatRecord(persistedEntry.sessionStateSnapshot)
  const conversationSnapshot = Array.isArray(rawBody.conversationSnapshot)
    ? rawBody.conversationSnapshot
    : Array.isArray(rawBody.chatHistory)
      ? rawBody.chatHistory
      : null
  const displayedProducts = Array.isArray(rawBody.displayedProducts)
    ? rawBody.displayedProducts
    : Array.isArray(persistedEntry.displayedProducts)
      ? persistedEntry.displayedProducts
      : null

  return {
    eventType,
    feedback: persistedEntry.feedback ?? rawBody.feedback ?? persistedEntry.responseFeedback ?? rawBody.responseFeedback ?? null,
    feedbackEmoji: persistedEntry.feedbackEmoji ?? rawBody.feedbackEmoji ?? persistedEntry.responseFeedbackEmoji ?? rawBody.responseFeedbackEmoji ?? null,
    responseFeedback: persistedEntry.responseFeedback ?? rawBody.responseFeedback ?? null,
    responseFeedbackEmoji: persistedEntry.responseFeedbackEmoji ?? rawBody.responseFeedbackEmoji ?? null,
    chipFeedback: persistedEntry.chipFeedback ?? rawBody.chipFeedback ?? null,
    chipFeedbackEmoji: persistedEntry.chipFeedbackEmoji ?? rawBody.chipFeedbackEmoji ?? null,
    feedbackTarget: rawBody.feedbackTarget ?? null,
    rating: persistedEntry.rating ?? rawBody.rating ?? null,
    tags: Array.isArray(persistedEntry.tags) ? persistedEntry.tags : Array.isArray(rawBody.tags) ? rawBody.tags : [],
    comment: persistedEntry.comment ?? rawBody.comment ?? persistedEntry.userComment ?? rawBody.userComment ?? null,
    lastAction: persistedEntry.lastAction ?? rawBody.lastAction ?? sessionStateSnapshot?.lastAction ?? null,
    mode: persistedEntry.mode ?? rawBody.mode ?? null,
    language: rawBody.language ?? requestPayload?.language ?? responsePayload?.language ?? null,
    candidateCount:
      persistedEntry.candidateCount
      ?? rawBody.candidateCount
      ?? sessionStateSnapshot?.candidateCount
      ?? null,
    conversationLength:
      persistedEntry.conversationLength
      ?? rawBody.conversationLength
      ?? (Array.isArray(conversationSnapshot) ? conversationSnapshot.length : null),
    question: truncateText(persistedEntry.userMessage ?? rawBody.userMessage ?? rawBody.lastUserMessage),
    answer: truncateText(persistedEntry.aiResponse ?? rawBody.aiResponse ?? rawBody.lastAiResponse),
    intakeSummary: truncateText(rawBody.intakeSummary),
    recommendationSummary: truncateText(rawBody.recommendationSummary),
    conditions: truncateText(persistedEntry.conditions ?? rawBody.conditions),
    narrowingPath: truncateText(persistedEntry.narrowingPath ?? rawBody.narrowingPath),
    topProducts: truncateText(persistedEntry.topProducts ?? rawBody.topProducts),
    displayedProductCount: Array.isArray(displayedProducts) ? displayedProducts.length : null,
    appliedFilterCount: Array.isArray(persistedEntry.appliedFilters)
      ? persistedEntry.appliedFilters.length
      : Array.isArray(rawBody.appliedFilters)
        ? rawBody.appliedFilters.length
        : null,
    hasRequestPayload: Boolean(requestPayload),
    hasResponsePayload: Boolean(responsePayload),
    hasSessionStateSnapshot: Boolean(sessionStateSnapshot),
    hasConversationSnapshot: Array.isArray(conversationSnapshot),
  }
}

export async function logFeedbackEventToMongo(input: FeedbackLogInput): Promise<void> {
  const db = await getMongoLogDb()
  if (!db) return

  const collectionName = process.env.MONGO_LOG_COLLECTION || "feedback_events"
  const rawBody = safeClone(input.rawBody)
  const persistedEntry = safeClone(input.persistedEntry)

  const document: FeedbackEventDocument = {
    schemaVersion: 1,
    source: "yg1-ai-catalog/api/feedback",
    eventType: input.eventType,
    updatedAt: new Date(),
    requestMeta: extractRequestMeta(input.request),
    identifiers: extractIdentifiers(rawBody, persistedEntry),
    extraction: extractSummary(rawBody, persistedEntry, input.eventType),
    storage: input.storage,
    rawBody,
    persistedEntry,
  }
  const collection = db.collection<FeedbackEventDocument>(collectionName)

  if (input.eventType === "turn_feedback") {
    const turnKey = document.identifiers && typeof document.identifiers === "object"
      ? (document.identifiers as JsonRecord).turnKey
      : null

    await collection.updateOne(
      {
        eventType: "turn_feedback",
        "identifiers.turnKey": turnKey ?? null,
      },
      {
        $set: document,
        $setOnInsert: {
          _id: createServerEventId(),
          createdAt: new Date(),
        },
      },
      { upsert: true },
    )
    return
  }

  await collection.insertOne({
    _id: createServerEventId(),
    createdAt: new Date(),
    ...document,
  })
}
