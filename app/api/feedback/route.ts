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

function saveTurnFeedback(entry: Record<string, unknown>): void {
  const dir = getFeedbackDir()
  const filename = `${entry.id}.json`
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8")
  console.log("[TURN_FEEDBACK]", JSON.stringify(entry))
}

function saveFeedback(entry: FeedbackEntry): void {
  const dir = getFeedbackDir()
  const filename = `${entry.id}.json`
  const filepath = path.join(dir, filename)
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2), "utf-8")
  // Also log to console for Vercel log access
  console.log("[FEEDBACK]", JSON.stringify(entry))
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

    // ── Turn-level feedback (per AI response) ──
    if (body.type === "turn_feedback") {
      const turnEntry = {
        id: `tf-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        timestamp: new Date().toISOString(),
        type: "turn_feedback",
        turnNumber: body.turnNumber ?? 0,
        feedback: body.feedback ?? "neutral",
        feedbackEmoji: body.feedbackEmoji ?? "😐",
        userMessage: body.userMessage ?? "",
        aiResponse: body.aiResponse ?? "",
        chips: body.chips ?? [],
        sessionId: body.sessionId ?? null,
        candidateCount: body.candidateCount ?? null,
        appliedFilters: body.appliedFilters ?? [],
        conversationLength: body.conversationLength ?? 0,
      }
      saveTurnFeedback(turnEntry)

      // Slack 알림 — 턴별 피드백
      import("@/lib/slack-notifier").then(({ notifyTurnFeedback }) =>
        notifyTurnFeedback(turnEntry).catch(() => {})
      )

      return NextResponse.json({ success: true, id: turnEntry.id })
    }

    // ── General feedback (existing) ──
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

    saveFeedback(entry)

    // Slack 알림
    import("@/lib/slack-notifier").then(({ notifyFeedback }) =>
      notifyFeedback({
        rating: entry.rating,
        comment: entry.comment,
        tags: entry.tags,
        authorType: entry.authorType,
        authorName: entry.authorName,
      }).catch(() => {})
    )

    return NextResponse.json({ success: true, id: entry.id })
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
