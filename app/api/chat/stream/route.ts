import Anthropic from "@anthropic-ai/sdk"
import { NextRequest } from "next/server"

import { runChatConversationStreaming } from "@/lib/chat/application/chat-service"
import { chatRequestSchema, type ChatRequestDto } from "@/lib/contracts/chat"
import { resolveModel } from "@/lib/llm/provider"

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
const anthropicChatModel = process.env.ANTHROPIC_FAST_MODEL || resolveModel("sonnet")
const client = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null

export const maxDuration = 120

function parseChatRequest(body: unknown): ChatRequestDto {
  return chatRequestSchema.parse(body) as ChatRequestDto
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = parseChatRequest(await req.json())

    if (!client) {
      return new Response(
        JSON.stringify({ type: "error", message: "Anthropic API key not set" }) + "\n",
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      )
    }

    const apiMessages = messages.filter(m => m.role === "user" || m.role === "ai")
    if (apiMessages.length === 0) {
      return new Response(
        [
          JSON.stringify({ type: "text", content: "안녕하세요! YG-1 AI 어시스턴트입니다. 무엇을 도와드릴까요?" }),
          JSON.stringify({ type: "meta", intent: "general", chips: ["제품 추천", "절삭조건 문의", "코팅 비교"], isComplete: false }),
          JSON.stringify({ type: "done" }),
        ].join("\n") + "\n",
        { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } },
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await runChatConversationStreaming(messages, {
            client: client!,
            model: anthropicChatModel,
            route: "/api/chat/stream",
          }, {
            onText(chunk) {
              const line = JSON.stringify({ type: "text", content: chunk }) + "\n"
              controller.enqueue(encoder.encode(line))
            },
            onMeta(meta) {
              const line = JSON.stringify({ type: "meta", ...meta }) + "\n"
              controller.enqueue(encoder.encode(line))
            },
            onDone() {
              const line = JSON.stringify({ type: "done" }) + "\n"
              controller.enqueue(encoder.encode(line))
              controller.close()
            },
            onError(message) {
              const line = JSON.stringify({ type: "error", message }) + "\n"
              controller.enqueue(encoder.encode(line))
              controller.close()
            },
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          const line = JSON.stringify({ type: "error", message: msg }) + "\n"
          controller.enqueue(encoder.encode(line))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ type: "error", message: msg }) + "\n",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    )
  }
}
