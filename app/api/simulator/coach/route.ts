/**
 * AI 가공조건 코치 API
 *
 * POST /api/simulator/coach
 *
 * Body:
 *   { state: any, results: any, followUp?: boolean, previousAdvice?: string }
 *
 * Response: SSE streaming text/event-stream
 *   - data: {"type":"delta","text":"..."}
 *   - data: {"type":"done"}
 *   - data: {"type":"error","message":"..."}
 */

import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import * as Sentry from "@sentry/nextjs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { logApiRequest, logApiError, logApiLatency } from "@/lib/logger/sim-logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// System prompt 캐시 (process 수명 동안 유지)
let SYSTEM_PROMPT_CACHE: string | null = null

async function loadSystemPrompt(): Promise<string> {
  if (SYSTEM_PROMPT_CACHE) return SYSTEM_PROMPT_CACHE
  const path = join(process.cwd(), "context", "ai_coach_system_prompt.md")
  try {
    const text = await readFile(path, "utf8")
    SYSTEM_PROMPT_CACHE = text
    return text
  } catch {
    // Fallback inline (파일 누락 시 최소 동작 보장)
    SYSTEM_PROMPT_CACHE =
      "당신은 YG-1 ARIA 가공조건 시뮬레이터의 수석 가공 엔지니어 AI 코치입니다. " +
      "Sandvik/Harvey/Helical/ISO 표준 기반으로 한국어로 400~600자 조언을 제공하세요. " +
      "진단 → 개선 제안(공식·수치) → 함정 경고 → 근거 구조로 작성하세요."
    return SYSTEM_PROMPT_CACHE
  }
}

function buildUserPrompt(
  state: unknown,
  results: unknown,
  followUp: boolean,
  previousAdvice?: string,
): string {
  const stateJson = JSON.stringify(state, null, 2)
  const resultsJson = JSON.stringify(results, null, 2)

  if (followUp && previousAdvice) {
    return [
      "## 이전 조언",
      previousAdvice,
      "",
      "## 현재 시뮬 상태",
      "```json",
      stateJson,
      "```",
      "",
      "## 계산 결과",
      "```json",
      resultsJson,
      "```",
      "",
      "위 조언이 왜 나왔는지, 각 제안의 공식 유도/카탈로그 근거/물리적 직관을 단계별로 풀어 설명해 주세요. " +
        "길이는 500~800자로, 수식은 그대로 인용하고 어디서 어떤 값이 나왔는지 명확히 해주세요.",
    ].join("\n")
  }

  return [
    "## 현재 시뮬 상태",
    "```json",
    stateJson,
    "```",
    "",
    "## 계산 결과",
    "```json",
    resultsJson,
    "```",
    "",
    "위 상태를 진단하고 개선 조언을 해주세요.",
  ].join("\n")
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  logApiRequest("/api/simulator/coach", "POST")
  try {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  let body: {
    state?: unknown
    results?: unknown
    followUp?: boolean
    previousAdvice?: string
  }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const { state, results, followUp = false, previousAdvice } = body
  if (!state || !results) {
    return new Response(
      JSON.stringify({ error: "state and results are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const systemPrompt = await loadSystemPrompt()
  const userPrompt = buildUserPrompt(state, results, followUp, previousAdvice)

  const client = new Anthropic({ apiKey })

  // SSE 스트림 생성
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        )
      }

      try {
        const messageStream = client.messages.stream({
          model: process.env.ANTHROPIC_COACH_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 8192,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userPrompt }],
        })

        messageStream.on("text", (delta: string) => {
          send({ type: "delta", text: delta })
        })

        const finalMessage = await messageStream.finalMessage()

        send({
          type: "done",
          usage: {
            input_tokens: finalMessage.usage.input_tokens,
            output_tokens: finalMessage.usage.output_tokens,
            cache_read_input_tokens:
              finalMessage.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens:
              finalMessage.usage.cache_creation_input_tokens ?? 0,
          },
          stop_reason: finalMessage.stop_reason,
        })
      } catch (err) {
        try { Sentry.captureException(err) } catch {}
        const msg =
          err instanceof Anthropic.APIError
            ? `Anthropic ${err.status ?? ""}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        send({ type: "error", message: msg })
      } finally {
        controller.close()
      }
    },
  })

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
  logApiLatency("/api/simulator/coach", Date.now() - started)
  return response
  } catch (err) {
    logApiError("/api/simulator/coach", err)
    throw err
  }
}
