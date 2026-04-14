import { NextResponse } from "next/server"
import {
  listConversations,
  saveConversation,
} from "@/lib/recommendation/infrastructure/persistence/conversation-repository"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const userId = url.searchParams.get("userId") ?? "default"
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50))
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0)
  const q = url.searchParams.get("q") ?? undefined

  try {
    const result = await listConversations(userId, limit, offset, q)
    return NextResponse.json(result)
  } catch (e) {
    console.error("[api/conversations] GET error:", e)
    return NextResponse.json({ conversations: [], total: 0 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (!body?.conversationId || typeof body.conversationId !== "string") {
      return NextResponse.json({ ok: false, error: "conversationId required" }, { status: 400 })
    }
    await saveConversation({
      conversationId: body.conversationId,
      userId: body.userId ?? "default",
      messages: Array.isArray(body.messages) ? body.messages : [],
      sessionState: body.sessionState ?? null,
      intakeForm: body.intakeForm ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[api/conversations] POST error:", e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
