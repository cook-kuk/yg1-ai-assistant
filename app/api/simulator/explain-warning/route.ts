/**
 * AI 경고 해설 API
 *
 * POST /api/simulator/explain-warning
 *
 * Body:
 *   {
 *     warning: { level: "error" | "warn" | "info", message: string },
 *     context: {
 *       Vc: number, fz: number, ap: number, ae: number,
 *       materialGroup: string, diameter: number, fluteCount: number,
 *       stickoutMm: number, rpm: number
 *     }
 *   }
 *
 * Response: NextResponse.json({ explanation: string })
 *
 * 참고: /app/api/simulator/coach/route.ts (Anthropic SDK 사용 패턴)
 */

import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import * as Sentry from "@sentry/nextjs"
import { logApiRequest, logApiError, logApiLatency } from "@/lib/logger/sim-logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const HAIKU_MODEL =
  process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001"

const SYSTEM_PROMPT =
  "너는 CNC 가공 엔지니어 멘토. 검증 경고 메시지와 현재 가공 조건을 바탕으로 " +
  "초보자도 이해하기 쉽게 한국어로 설명. " +
  "1) 이게 왜 위험한가? 2) 왜 이 조건에서 발생했는가? 3) 어떻게 해결? " +
  "3개 bullet로. 200자 이내."

interface SimWarning {
  level: "error" | "warn" | "info"
  message: string
}

interface SimContext {
  Vc: number
  fz: number
  ap: number
  ae: number
  materialGroup: string
  diameter: number
  fluteCount: number
  stickoutMm: number
  rpm: number
}

function buildUserPrompt(warning: SimWarning, context: SimContext): string {
  return [
    "## 경고",
    `- level: ${warning.level}`,
    `- message: ${warning.message}`,
    "",
    "## 현재 가공 조건",
    `- Vc(절삭속도): ${context.Vc} m/min`,
    `- fz(날당 이송): ${context.fz} mm/tooth`,
    `- ap(축방향 절입): ${context.ap} mm`,
    `- ae(반경방향 절입): ${context.ae} mm`,
    `- 재질군: ${context.materialGroup}`,
    `- 공구경: ${context.diameter} mm`,
    `- 날수: ${context.fluteCount}`,
    `- 돌출량: ${context.stickoutMm} mm`,
    `- rpm: ${context.rpm}`,
    "",
    "위 경고를 3개 bullet(왜 위험/왜 발생/어떻게 해결)로 200자 이내 한국어 해설해 주세요.",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  logApiRequest("/api/simulator/explain-warning", "POST")
  try {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    )
  }

  let body: { warning?: SimWarning; context?: SimContext }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const { warning, context } = body
  if (
    !warning ||
    typeof warning.message !== "string" ||
    !context ||
    typeof context.materialGroup !== "string"
  ) {
    return NextResponse.json(
      { error: "warning and context are required" },
      { status: 400 },
    )
  }

  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUserPrompt(warning, context) },
      ],
    })

    const explanation = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim()

    logApiLatency("/api/simulator/explain-warning", Date.now() - started)
    return NextResponse.json({ explanation })
  } catch (err) {
    try { Sentry.captureException(err) } catch {}
    const msg =
      err instanceof Anthropic.APIError
        ? `Anthropic ${err.status ?? ""}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  } catch (err) {
    logApiError("/api/simulator/explain-warning", err)
    throw err
  }
}
