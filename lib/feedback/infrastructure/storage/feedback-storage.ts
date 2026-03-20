import fs from "fs"
import path from "path"

import {
  feedbackEntrySchema,
  feedbackEventEntrySchema,
  type FeedbackEntryDto,
  type FeedbackEventEntryDto,
} from "@/lib/contracts/feedback"

type ScreenshotInput = {
  name: string
  dataUrl: string
  size: number
}

type JsonRecord = Record<string, unknown>

export function getFeedbackDir(): string {
  const projectDir = path.join(process.cwd(), "data", "feedback")
  try {
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true })
    const testFile = path.join(projectDir, ".write-test")
    fs.writeFileSync(testFile, "ok")
    fs.unlinkSync(testFile)
    return projectDir
  } catch {
    const tmpDir = path.join("/tmp", "feedback")
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    return tmpDir
  }
}

export function saveFeedbackRecord(entry: Record<string, unknown>): { filepath: string; filename: string } {
  const dir = getFeedbackDir()
  const filename = `${entry.id}.json`
  const filepath = path.join(dir, filename)

  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8")

  return { filepath, filename }
}

export function saveFeedbackScreenshots(
  entryId: string,
  screenshots: ScreenshotInput[]
): string[] {
  if (screenshots.length === 0) return []

  const dir = getFeedbackDir()
  const screenshotPaths: string[] = []

  for (const ss of screenshots) {
    try {
      const base64Data = ss.dataUrl.replace(/^data:image\/\w+;base64,/, "")
      const ext = ss.name.split(".").pop() ?? "png"
      const filename = `${entryId}-ss-${screenshotPaths.length}.${ext}`
      fs.writeFileSync(path.join(dir, filename), Buffer.from(base64Data, "base64"))
      screenshotPaths.push(filename)
    } catch (error) {
      console.warn("[feedback] Failed to save screenshot:", error)
    }
  }

  return screenshotPaths
}

export function loadAllFeedbackEntries(): FeedbackEntryDto[] {
  return loadAllFeedbackData().generalEntries
}

function readFeedbackJsonFiles(): unknown[] {
  const dir = getFeedbackDir()
  const files = fs.readdirSync(dir).filter(file => file.endsWith(".json")).sort().reverse()
  const records: unknown[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8")
      records.push(JSON.parse(raw))
    } catch {
      // Ignore corrupted or non-feedback files.
    }
  }

  return records
}

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

function normalizeFeedbackEventRecord(value: unknown): FeedbackEventEntryDto | null {
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

export function loadAllFeedbackData(): {
  generalEntries: FeedbackEntryDto[]
  feedbackEntries: FeedbackEventEntryDto[]
} {
  const records = readFeedbackJsonFiles()
  const generalEntries: FeedbackEntryDto[] = []
  const feedbackEntries: FeedbackEventEntryDto[] = []

  for (const record of records) {
    const generalResult = feedbackEntrySchema.safeParse(record)
    if (generalResult.success) {
      generalEntries.push(generalResult.data)
      continue
    }

    const feedbackResult = feedbackEventEntrySchema.safeParse(record)
    if (feedbackResult.success) {
      feedbackEntries.push(feedbackResult.data)
      continue
    }

    const normalizedFeedback = normalizeFeedbackEventRecord(record)
    if (normalizedFeedback) {
      feedbackEntries.push(normalizedFeedback)
    }
  }

  return {
    generalEntries,
    feedbackEntries,
  }
}
