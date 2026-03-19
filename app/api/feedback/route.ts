/**
 * /api/feedback
 *
 * POST — Save feedback about chatbot results
 * GET  — Retrieve all feedback entries (for admin/review)
 *
 * Storage: data/feedback/ directory (JSON files per entry)
 * Falls back to /tmp/feedback/ in serverless environments.
 * Also logs to console for Vercel log inspection.
 */

import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { logFeedbackEventToMongo } from "@/lib/mongo/feedback-log"

// ── Feedback entry type ─────────────────────────────────────
interface FeedbackEntry {
  id: string
  timestamp: string
  // Who left the feedback
  authorType: "internal" | "customer" | "anonymous"
  authorName: string
  // What they're commenting on
  sessionId: string | null
  intakeSummary: string | null
  chatHistory: Array<{ role: string; text: string }> | null
  recommendationSummary: string | null
  // The feedback itself
  rating: number | null       // 1-5 stars
  comment: string
  tags: string[]              // e.g., ["wrong-product", "good-evidence", "slow"]
}

// ── Storage helpers ─────────────────────────────────────────
function getFeedbackDir(): string {
  // Try project-local first
  const projectDir = path.join(process.cwd(), "data", "feedback")
  try {
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true })
    // Test write
    const testFile = path.join(projectDir, ".write-test")
    fs.writeFileSync(testFile, "ok")
    fs.unlinkSync(testFile)
    return projectDir
  } catch {
    // Fallback to /tmp for serverless
    const tmpDir = path.join("/tmp", "feedback")
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    return tmpDir
  }
}

function saveTurnFeedback(entry: Record<string, unknown>): string {
  const dir = getFeedbackDir()
  const filename = `${entry.id}.json`
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8")
  console.log("[TURN_FEEDBACK]", JSON.stringify(entry))
  return filepath
}

function sanitizeFeedbackIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120)
}

function buildTurnFeedbackId(body: Record<string, unknown>): string {
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

function saveFeedback(entry: FeedbackEntry): string {
  const dir = getFeedbackDir()
  const filename = `${entry.id}.json`
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8")
  // Also log to console for Vercel log access
  console.log("[FEEDBACK]", JSON.stringify(entry))
  return filepath
}

function loadAllFeedback(): FeedbackEntry[] {
  const dir = getFeedbackDir()
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse()
  const entries: FeedbackEntry[] = []
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8")
      entries.push(JSON.parse(raw))
    } catch {
      // skip corrupted files
    }
  }
  return entries
}

// ── POST: Save feedback ─────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json()

    // ── Success case capture (full state snapshot) ──
    if (body.type === "success_case") {
      const successEntry = {
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
        // Full state snapshot for eval/training
        sessionStateSnapshot: body.sessionStateSnapshot ?? null,
        displayedProducts: body.displayedProducts ?? null,
        displayedOptions: body.displayedOptions ?? null,
        displayedSeriesGroups: body.displayedSeriesGroups ?? null,
        uiNarrowingPath: body.uiNarrowingPath ?? null,
        lastRecommendationArtifact: body.lastRecommendationArtifact ?? null,
        lastComparisonArtifact: body.lastComparisonArtifact ?? null,
        appliedFilters: body.appliedFilters ?? [],
        chatHistory: body.chatHistory ?? null,
        requestPayload: body.requestPayload ?? null,
        responsePayload: body.responsePayload ?? null,
        formSnapshot: body.formSnapshot ?? null,
        candidateSnapshot: body.candidateSnapshot ?? null,
        conversationSnapshot: body.conversationSnapshot ?? null,
        language: body.language ?? null,
        clientCapturedAt: body.clientCapturedAt ?? null,
      }
      const localJsonPath = saveTurnFeedback(successEntry)

      logFeedbackEventToMongo({
        eventType: "success_case",
        request: req,
        rawBody: body,
        persistedEntry: successEntry,
        storage: {
          localJsonId: successEntry.id,
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log success_case to MongoDB:", error)
      })

      // Slack
      import("@/lib/slack-notifier").then(({ notifySuccessCase }) =>
        notifySuccessCase({
          sessionId: successEntry.sessionId,
          mode: successEntry.mode,
          conditions: successEntry.conditions,
          candidateCounts: successEntry.candidateCounts,
          topProducts: successEntry.topProducts,
          narrowingPath: successEntry.narrowingPath,
          userComment: successEntry.userComment,
          lastUserMessage: successEntry.lastUserMessage,
          lastAiResponse: successEntry.lastAiResponse,
          conversationLength: successEntry.conversationLength,
          comparisonArtifact: successEntry.lastComparisonArtifact
            ? JSON.stringify(successEntry.lastComparisonArtifact).slice(0, 200)
            : null,
        }).catch(() => {})
      )

      return NextResponse.json({ success: true, id: successEntry.id })
    }

    // ── Failure case capture ──
    if (body.type === "failure_case") {
      const failureEntry = {
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
        chatHistory: body.chatHistory ?? null,
        feedbackHistory: body.feedbackHistory ?? null,
        requestPayload: body.requestPayload ?? null,
        responsePayload: body.responsePayload ?? null,
        formSnapshot: body.formSnapshot ?? null,
        sessionStateSnapshot: body.sessionStateSnapshot ?? null,
        candidateSnapshot: body.candidateSnapshot ?? null,
        conversationSnapshot: body.conversationSnapshot ?? null,
        language: body.language ?? null,
        clientCapturedAt: body.clientCapturedAt ?? null,
      }
      const localJsonPath = saveTurnFeedback(failureEntry)

      logFeedbackEventToMongo({
        eventType: "failure_case",
        request: req,
        rawBody: body,
        persistedEntry: failureEntry,
        storage: {
          localJsonId: failureEntry.id,
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log failure_case to MongoDB:", error)
      })

      // Slack — failure case alert
      import("@/lib/slack-notifier").then(({ notifyFailureCase }) =>
        notifyFailureCase(failureEntry).catch(() => {})
      )

      return NextResponse.json({ success: true, id: failureEntry.id })
    }

    // ── Turn-level feedback (per AI response) ──
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
      const turnEntry = {
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
        requestPayload: body.requestPayload ?? null,
        responsePayload: body.responsePayload ?? null,
        formSnapshot: body.formSnapshot ?? null,
        sessionStateSnapshot: body.sessionStateSnapshot ?? null,
        candidateSnapshot: body.candidateSnapshot ?? null,
        conversationSnapshot: body.conversationSnapshot ?? null,
        language: body.language ?? null,
        clientCapturedAt: body.clientCapturedAt ?? null,
      }
      const localJsonPath = saveTurnFeedback(turnEntry)

      logFeedbackEventToMongo({
        eventType: "turn_feedback",
        request: req,
        rawBody: body,
        persistedEntry: turnEntry,
        storage: {
          localJsonId: turnEntry.id,
          localJsonPath,
        },
      }).catch(error => {
        console.error("[feedback] Failed to log turn_feedback to MongoDB:", error)
      })

      // Slack 알림 — 턴별 피드백
      import("@/lib/slack-notifier").then(({ notifyTurnFeedback }) =>
        notifyTurnFeedback(turnEntry).catch(() => {})
      )

      return NextResponse.json({ success: true, id: turnEntry.id })
    }

    // ── General feedback (with screenshots) ──
    const screenshots: Array<{ name: string; dataUrl: string; size: number }> = body.screenshots ?? []

    const entry: FeedbackEntry = {
      id: `fb-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      timestamp: new Date().toISOString(),
      authorType: body.authorType ?? "anonymous",
      authorName: body.authorName ?? "",
      sessionId: body.sessionId ?? null,
      intakeSummary: body.intakeSummary ?? null,
      chatHistory: body.chatHistory ?? null,
      recommendationSummary: body.recommendationSummary ?? null,
      rating: body.rating ?? null,
      comment: body.comment ?? "",
      tags: body.tags ?? [],
    }

    if (!entry.comment.trim() && !entry.rating) {
      return NextResponse.json({ error: "Comment or rating required" }, { status: 400 })
    }

    // Save screenshots as separate files
    const screenshotPaths: string[] = []
    if (screenshots.length > 0) {
      const dir = getFeedbackDir()
      for (const ss of screenshots) {
        try {
          const base64Data = ss.dataUrl.replace(/^data:image\/\w+;base64,/, "")
          const ext = ss.name.split(".").pop() ?? "png"
          const ssFilename = `${entry.id}-ss-${screenshotPaths.length}.${ext}`
          fs.writeFileSync(path.join(dir, ssFilename), Buffer.from(base64Data, "base64"))
          screenshotPaths.push(ssFilename)
        } catch (e) {
          console.warn("[feedback] Failed to save screenshot:", e)
        }
      }
    }

    // Save feedback entry (without base64 data, just paths)
    const persistedEntry = {
      ...entry,
      screenshotCount: screenshots.length,
      screenshotPaths,
      requestPayload: body.requestPayload ?? null,
      responsePayload: body.responsePayload ?? null,
      formSnapshot: body.formSnapshot ?? null,
      sessionStateSnapshot: body.sessionStateSnapshot ?? null,
      candidateSnapshot: body.candidateSnapshot ?? null,
      conversationSnapshot: body.conversationSnapshot ?? null,
      language: body.language ?? null,
      clientCapturedAt: body.clientCapturedAt ?? null,
    }
    const localJsonPath = saveTurnFeedback(persistedEntry)

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

    // Slack 알림 — enhanced with screenshot info + full context
    import("@/lib/slack-notifier").then(({ notifyFeedback }) =>
      notifyFeedback({
        rating: entry.rating,
        comment: entry.comment,
        tags: entry.tags,
        authorType: entry.authorType,
        authorName: entry.authorName,
        screenshotCount: screenshots.length,
        intakeSummary: entry.intakeSummary,
        recommendationSummary: entry.recommendationSummary,
        chatHistoryLength: entry.chatHistory?.length ?? 0,
      }).catch(() => {})
    )

    return NextResponse.json({ success: true, id: entry.id, screenshotCount: screenshots.length })
  } catch (err) {
    console.error("[feedback] POST error:", err)
    return NextResponse.json(
      { error: "Failed to save feedback", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}

// ── GET: Retrieve all feedback ──────────────────────────────
export async function GET() {
  try {
    const entries = loadAllFeedback()
    return NextResponse.json({ entries, total: entries.length })
  } catch (err) {
    console.error("[feedback] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load feedback", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}
