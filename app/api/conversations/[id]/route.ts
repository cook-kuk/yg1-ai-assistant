import { NextResponse } from "next/server"
import {
  deleteConversation,
  getConversation,
} from "@/lib/recommendation/infrastructure/persistence/conversation-repository"

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  try {
    const conv = await getConversation(id)
    if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(conv)
  } catch (e) {
    console.error("[api/conversations/id] GET error:", e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  try {
    await deleteConversation(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[api/conversations/id] DELETE error:", e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
