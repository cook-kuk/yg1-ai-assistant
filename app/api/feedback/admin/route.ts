import { NextResponse } from "next/server"
import { getMongoLogDb, isMongoLogEnabled } from "@/lib/mongo/client"

/**
 * Feedback collection names — same as feedback-mongo-read.ts
 */
function getFeedbackCollectionNames(): string[] {
  const names = [
    process.env.MONGO_GENERAL_FEEDBACK_COLLECTION || "feedback_general_entries",
    process.env.MONGO_SUCCESS_CASE_COLLECTION || "feedback_success_cases",
    process.env.MONGO_LOG_COLLECTION || "feedback_events",
  ]
  return [...new Set(names.filter(Boolean))]
}

/**
 * GET /api/feedback/admin — 전체 관리자 필드 조회
 * 기존 feedback 문서에서 adminFields 가 있는 것만 추출
 */
export async function GET() {
  if (!isMongoLogEnabled()) {
    return NextResponse.json({ fields: {} })
  }

  try {
    const db = await getMongoLogDb()
    if (!db) return NextResponse.json({ fields: {} })

    const fields: Record<string, { csComment: string; dueDate: string; completed: boolean }> = {}

    for (const collectionName of getFeedbackCollectionNames()) {
      const docs = await db
        .collection(collectionName)
        .find(
          { "extraction.adminFields": { $exists: true } },
          { projection: { "persistedEntry.id": 1, "rawBody.id": 1, "identifiers.feedbackId": 1, "extraction.adminFields": 1 } }
        )
        .toArray()

      for (const doc of docs) {
        const id =
          (doc.persistedEntry as Record<string, unknown>)?.id as string
          ?? (doc.rawBody as Record<string, unknown>)?.id as string
          ?? (doc.identifiers as Record<string, unknown>)?.feedbackId as string
          ?? null
        const af = (doc.extraction as Record<string, unknown>)?.adminFields as Record<string, unknown> | undefined
        if (id && af) {
          fields[id] = {
            csComment: (af.csComment as string) ?? "",
            dueDate: (af.dueDate as string) ?? "",
            completed: (af.completed as boolean) ?? false,
          }
        }
      }
    }

    return NextResponse.json({ fields })
  } catch (error) {
    console.error("[admin-fields] GET error:", error)
    return NextResponse.json({ fields: {} })
  }
}

/**
 * PUT /api/feedback/admin — 관리자 필드를 기존 feedback 문서에 직접 $set
 * serve 브랜치의 updateFeedbackCheckedInMongo 패턴과 동일
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

    const adminFields = {
      csComment: csComment ?? "",
      dueDate: dueDate ?? "",
      completed: completed ?? false,
    }

    // 기존 feedback 문서를 ID로 찾아서 adminFields를 $set
    for (const collectionName of getFeedbackCollectionNames()) {
      const result = await db.collection(collectionName).updateOne(
        {
          $or: [
            { "persistedEntry.id": feedbackId },
            { "rawBody.id": feedbackId },
            { "identifiers.feedbackId": feedbackId },
          ],
        },
        {
          $set: {
            updatedAt: new Date(),
            "extraction.adminFields": adminFields,
          },
        },
      )

      if (result.matchedCount > 0) {
        return NextResponse.json({ ok: true })
      }
    }

    return NextResponse.json({ ok: false, reason: "Document not found" }, { status: 404 })
  } catch (error) {
    console.error("[admin-fields] PUT error:", error)
    return NextResponse.json({ ok: false, reason: "Internal error" }, { status: 500 })
  }
}
