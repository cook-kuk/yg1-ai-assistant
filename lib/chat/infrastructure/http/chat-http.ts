import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

import { runChatConversation } from "@/lib/chat/application/chat-service"
import { chatRequestSchema, type ChatRequestDto } from "@/lib/contracts/chat"
import { buildEmptyChatResponse, mockChatResponse } from "@/lib/chat/infrastructure/http/chat-response"
import {
  notifyChatResponse,
  notifyError,
  notifyLlmCall,
} from "@/lib/chat/infrastructure/notifications/chat-notifier"
import {
  appendRuntimeLog,
  logRuntimeError,
} from "@/lib/chat/infrastructure/runtime/chat-runtime-log"

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
const anthropicChatModel = process.env.ANTHROPIC_FAST_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
const client = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null

function parseChatRequest(body: unknown): ChatRequestDto {
  return chatRequestSchema.parse(body) as ChatRequestDto
}

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { messages } = parseChatRequest(await req.json())

    if (!client) {
      console.warn("Anthropic API key not set. Using mock chat response.")
      await appendRuntimeLog({
        level: "warn",
        category: "llm",
        event: "chat.mock_response",
        context: {
          route: "/api/chat",
          reason: "Anthropic API key not set",
        },
      })
      return NextResponse.json(mockChatResponse(messages))
    }

    const lastUserMsg = [...messages].reverse().find(message => message.role === "user")?.text ?? ""

    const apiMessages = messages.filter(
      message => message.role === "user" || message.role === "ai"
    )
    if (apiMessages.length === 0) {
      return NextResponse.json(buildEmptyChatResponse())
    }

    const chatResult = await runChatConversation(messages, {
      client,
      model: anthropicChatModel,
      route: "/api/chat",
    })

    const knownParams = Object.entries(chatResult.convState.params)
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key}=${value}`)
      .join(",")

    console.log(
      `[chat] topic=${chatResult.convState.topicStatus} intent=${chatResult.response.intent} known=[${knownParams}] missing=[${chatResult.convState.missingParams.join(",")}] memory=${chatResult.retrievalMemory?.totalMatched ?? 0}products tools=[${chatResult.toolsUsed.join(",")}]`
    )

    notifyChatResponse({
      userMessage: lastUserMsg,
      intent: chatResult.response.intent,
      toolsUsed: chatResult.toolsUsed,
      productCount: chatResult.references?.length ?? 0,
    }).catch(() => {})

    notifyLlmCall({
      model: anthropicChatModel,
      route: "/api/chat",
      promptPreview: lastUserMsg,
      responsePreview: chatResult.finalText,
      durationMs: chatResult.durationMs,
      inputTokens: chatResult.llmUsage?.input_tokens,
      outputTokens: chatResult.llmUsage?.output_tokens,
    }).catch(() => {})

    await appendRuntimeLog({
      category: "llm",
      event: "chat.final_response",
      context: {
        route: "/api/chat",
        intent: chatResult.response.intent,
        toolsUsed: chatResult.toolsUsed,
        references: chatResult.references,
        durationMs: chatResult.durationMs,
        response: chatResult.response,
      },
    })

    return NextResponse.json(chatResult.response)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Chat API error:", msg)
    await logRuntimeError({
      category: "error",
      event: "chat.api.error",
      error,
      context: {
        route: "/api/chat",
      },
    })
    notifyError({ route: "/api/chat", error: msg }).catch(() => {})
    return NextResponse.json(
      { error: "AI 응답을 가져오는데 실패했습니다", detail: msg },
      { status: 500 }
    )
  }
}
