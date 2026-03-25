import { NextResponse } from "next/server"
import { getMongoLogDb, isMongoLogEnabled } from "@/lib/mongo/client"

const COLLECTION_NAME = process.env.MONGO_ADMIN_FIELDS_COLLECTION || "feedback_admin_fields"

/**
 * GET /api/feedback/admin — 전체 관리자 필드 조회
 */
export async function GET() {
  if (!isMongoLogEnabled()) {
    return NextResponse.json({ fields: {} })
  }

  try {
    const db = await getMongoLogDb()
    if (!db) return NextResponse.json({ fields: {} })

    const docs = await db.collection(COLLECTION_NAME).find({}).toArray()
    const fields: Record<string, { csComment: string; dueDate: string; completed: boolean }> = {}
    for (const doc of docs) {
      fields[doc.feedbackId as string] = {
        csComment: (doc.csComment as string) ?? "",
        dueDate: (doc.dueDate as string) ?? "",
        completed: (doc.completed as boolean) ?? false,
      }
    }

    return NextResponse.json({ fields })
  } catch (error) {
    console.error("[admin-fields] GET error:", error)
    return NextResponse.json({ fields: {} })
  }
}

/**
 * PUT /api/feedback/admin — 관리자 필드 저장 (upsert)
 * Body: { feedbackId: string, csComment?: string, dueDate?: string, completed?: boolean }
 */
export async function PUT(request: Request) {
  if (!isMongoLogEnabled()) {
    return NextResponse.json({ ok: false, reason: "MongoDB not enabled" }, { status: 503 })
  }

  try {
    const body = await request.json()
    const { feedbackId, csComment, dueDate, completed } = body as {
      feedbackId: string
      csComment?: string
      dueDate?: string
      completed?: boolean
    }

    if (!feedbackId) {
      return NextResponse.json({ ok: false, reason: "feedbackId required" }, { status: 400 })
    }

    const db = await getMongoLogDb()
    if (!db) {
      return NextResponse.json({ ok: false, reason: "DB unavailable" }, { status: 503 })
    }

    await db.collection(COLLECTION_NAME).updateOne(
      { feedbackId },
      {
        $set: {
          feedbackId,
          csComment: csComment ?? "",
          dueDate: dueDate ?? "",
          completed: completed ?? false,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[admin-fields] PUT error:", error)
    return NextResponse.json({ ok: false, reason: "Internal error" }, { status: 500 })
  }
}
