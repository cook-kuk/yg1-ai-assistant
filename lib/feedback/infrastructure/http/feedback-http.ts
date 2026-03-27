import { NextResponse } from "next/server"

import { FeedbackService } from "@/lib/feedback/application/feedback-service"

let feedbackService: FeedbackService | null = null

function getFeedbackService(): FeedbackService {
  if (!feedbackService) {
    feedbackService = new FeedbackService()
  }

  return feedbackService
}

export async function handleFeedbackPost(req: Request): Promise<Response> {
  try {
    const result = await getFeedbackService().save(req, await req.json())
    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    console.error("[feedback] POST error:", err)
    return NextResponse.json(
      { error: "Failed to save feedback", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}

export async function handleFeedbackGet(): Promise<Response> {
  try {
    const result = await getFeedbackService().loadAll()
    return NextResponse.json(result)
  } catch (err) {
    console.error("[feedback] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load feedback", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    )
  }
}
