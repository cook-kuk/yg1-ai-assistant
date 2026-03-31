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
        "data: " + JSON.stringify({ type: "error", message: "Anthropic API key not set" }) + "\n\n",
        { status: 500, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
      )
    }

    const apiMessages = messages.filter(m => m.role === "user" || m.role === "ai")
    if (apiMessages.length === 0) {
      return new Response(
        [
          "data: " + JSON.stringify({ type: "text", content: "안녕하세요! YG-1 AI 어시스턴트입니다. 무엇을 도와드릴까요?" }),
          "data: " + JSON.stringify({ type: "meta", intent: "general", chips: ["제품 추천", "절삭조건 문의", "코팅 비교"], isComplete: false }),
          "data: " + JSON.stringify({ type: "done" }),
          "",
        ].join("\n\n") + "\n\n",
        { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } },
      )
    }

    const encoder = new TextEncoder()
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    const sendSSE = async (data: unknown) => {
      await writer.write(encoder.encode("data: " + JSON.stringify(data) + "\n\n"))
    }

    // Run streaming in background, write SSE events
    ;(async () => {
      try {
        await runChatConversationStreaming(messages, {
          client: client!,
          model: anthropicChatModel,
          route: "/api/chat/stream",
        }, {
          async onText(chunk) {
            await sendSSE({ type: "text", content: chunk })
          },
          async onMeta(meta) {
            await sendSSE({ type: "meta", ...meta })
          },
          async onDone() {
            await sendSSE({ type: "done" })
            await writer.close()
          },
          async onError(message) {
            await sendSSE({ type: "error", message })
            await writer.close()
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await sendSSE({ type: "error", message: msg })
        await writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return new Response(
      "data: " + JSON.stringify({ type: "error", message: msg }) + "\n\n",
      { status: 500, headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
    )
  }
}
