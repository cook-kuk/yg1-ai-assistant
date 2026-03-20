import fs from "fs"
import path from "path"

import { NextResponse } from "next/server"

import { getFeedbackDir } from "@/lib/feedback/infrastructure/storage/feedback-storage"

export const runtime = "nodejs"

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ filename: string }> }
): Promise<Response> {
  const { filename } = await context.params
  const safeFilename = path.basename(filename)
  const ext = path.extname(safeFilename).toLowerCase()
  const contentType = CONTENT_TYPES[ext]

  if (!contentType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }

  const fullPath = path.join(getFeedbackDir(), safeFilename)

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  const fileBuffer = fs.readFileSync(fullPath)

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileBuffer.byteLength),
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${safeFilename}"`,
    },
  })
}
