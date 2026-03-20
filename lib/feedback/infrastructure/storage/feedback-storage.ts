import fs from "fs"
import path from "path"

import { type FeedbackEntryDto, type FeedbackEventEntryDto } from "@/lib/contracts/feedback"
import { normalizeFeedbackRecord } from "@/lib/feedback/infrastructure/storage/feedback-record-normalizer"

type ScreenshotInput = {
  name: string
  dataUrl: string
  size: number
}

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

export function loadAllFeedbackData(): {
  generalEntries: FeedbackEntryDto[]
  feedbackEntries: FeedbackEventEntryDto[]
} {
  const records = readFeedbackJsonFiles()
  const generalEntries: FeedbackEntryDto[] = []
  const feedbackEntries: FeedbackEventEntryDto[] = []

  for (const record of records) {
    const normalized = normalizeFeedbackRecord(record)
    if (normalized.generalEntry) generalEntries.push(normalized.generalEntry)
    if (normalized.feedbackEntry) feedbackEntries.push(normalized.feedbackEntry)
  }

  return {
    generalEntries,
    feedbackEntries,
  }
}
