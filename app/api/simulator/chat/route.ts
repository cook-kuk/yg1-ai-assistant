/**
 * AI 채팅 사이드바 API (v3 persistent conversational)
 *
 * POST /api/simulator/chat
 *
 * Body:
 *   {
 *     messages: Array<{ role: "user" | "assistant", content: string }>,
 *     context?: Record<string, unknown>
 *   }
 *
 * Response: SSE streaming text/event-stream
 *   - data: {"type":"delta","text":"..."}
 *   - data: {"type":"done","usage":{...},"stop_reason":"..."}
 *   - data: {"type":"error","message":"..."}
 */

import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_SYSTEM_PROMPT =
  "너는 YG-1 CNC 가공 전문 조언자. 대화 맥락을 유지하며 현재 시뮬 상태를 바탕으로 한국어로 답변. 짧고 구체적. 공식/수치 인용. 친절한 어조."

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type ChatRole = "user" | "assistant"

interface ChatTurn {
  role: ChatRole
  content: string
}

interface ChatRequestBody {
  messages?: ChatTurn[]
  context?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

function sanitizeMessages(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ChatTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    const role = m.role
    const content = m.content
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim().length > 0
    ) {
      out.push({ role, content })
    }
  }
  return out
}

function buildSystemPrompt(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return BASE_SYSTEM_PROMPT
  }
  let ctxJson: string
  try {
    ctxJson = JSON.stringify(context, null, 2)
  } catch {
    ctxJson = "{}"
  }
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "## 현재 시뮬레이터 상태",
    "```json",
    ctxJson,
    "```",
    "",
    "위 상태를 전제로 사용자의 질문에 답하라.",
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const messages = sanitizeMessages(body.messages)
  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages must be a non-empty array" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  // 마지막은 반드시 user 여야 multi-turn 대화 요청으로 유효
  if (messages[messages.length - 1].role !== "user") {
    return new Response(
      JSON.stringify({ error: "last message must be from user" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const systemPrompt = buildSystemPrompt(body.context)
  const client = new Anthropic({ apiKey })

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
          model: process.env.ANTHROPIC_SONNET_MODEL ?? "claude-sonnet-4-6",
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
