import { getMongoLogDb } from "@/lib/mongo/client"
import { normalizeFeedbackRecord } from "@/lib/feedback/infrastructure/storage/feedback-record-normalizer"
import type { FeedbackEntryDto, FeedbackEventEntryDto } from "@/lib/contracts/feedback"

type MongoDocument = {
  persistedEntry?: unknown
  rawBody?: unknown
  [key: string]: unknown
}

function getFeedbackCollectionNames(): string[] {
  const names = [
    process.env.MONGO_GENERAL_FEEDBACK_COLLECTION || "feedback_general_entries",
    process.env.MONGO_SUCCESS_CASE_COLLECTION || "feedback_success_cases",
    process.env.MONGO_LOG_COLLECTION || "feedback_events",
  ]

  return [...new Set(names.filter(Boolean))]
}

function getDocumentPayload(document: MongoDocument): unknown {
  if (document.persistedEntry) return document.persistedEntry
  if (document.rawBody) return document.rawBody
  return document
}

export async function loadAllFeedbackDataFromMongo(): Promise<{
  generalEntries: FeedbackEntryDto[]
  feedbackEntries: FeedbackEventEntryDto[]
} | null> {
  const db = await getMongoLogDb()
  if (!db) return null

  const generalEntries = new Map<string, FeedbackEntryDto>()
  const feedbackEntries = new Map<string, FeedbackEventEntryDto>()

  for (const collectionName of getFeedbackCollectionNames()) {
    const documents = await db
      .collection<MongoDocument>(collectionName)
      .find({}, { projection: { persistedEntry: 1, rawBody: 1 } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray()

    for (const document of documents) {
      const normalized = normalizeFeedbackRecord(getDocumentPayload(document))
      if (normalized.generalEntry) {
        generalEntries.set(normalized.generalEntry.id, normalized.generalEntry)
      }
      if (normalized.feedbackEntry) {
        feedbackEntries.set(normalized.feedbackEntry.id, normalized.feedbackEntry)
      }
    }
  }

  return {
    generalEntries: [...generalEntries.values()],
    feedbackEntries: [...feedbackEntries.values()],
  }
}
