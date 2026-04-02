import Anthropic from "@anthropic-ai/sdk"

import { CHAT_TOOLS, executeChatTool } from "@/lib/chat/infrastructure/tools/chat-tools"
import {
  buildStructuredContext,
  buildRetrievalMemory,
  buildStateFromHistory,
  logConversationState,
  type ConversationState,
  type RetrievalMemory,
} from "@/lib/chat/domain/conversation-state"
import { createAnthropicMessageWithLogging } from "@/lib/chat/infrastructure/llm/chat-llm"

import { buildSystemPrompt } from "./chat-prompt"
import {
  extractBrandInfo,
  extractReferences,
  inferIntent,
  injectBrandHeader,
  injectReferenceBadge,
  type ChatMessage,
  type LLMResponse,
} from "../infrastructure/http/chat-response"

interface ChatServiceDeps {
  client: Anthropic
  model: string
  route: string
}

export interface ChatServiceResult {
  response: LLMResponse
  convState: ConversationState
  retrievalMemory: RetrievalMemory | null
  toolsUsed: string[]
  references: string[] | null
  finalText: string
  durationMs: number
  llmUsage: Anthropic.Message["usage"] | undefined
}

const MAX_TOOL_ROUNDS = 5

// ── Streaming version ──────────────────────────────────────────

export interface ChatStreamCallbacks {
  onText: (chunk: string) => void | Promise<void>
  onMeta: (meta: Omit<LLMResponse, "text">) => void | Promise<void>
  onDone: () => void | Promise<void>
  onError: (message: string) => void | Promise<void>
}

/**
 * Streaming chat: tool rounds run non-streaming server-side,
 * then the final text response is streamed token-by-token via Anthropic streaming API.
 */
export async function runChatConversationStreaming(
  messages: ChatMessage[],
  deps: ChatServiceDeps,
  callbacks: ChatStreamCallbacks,
): Promise<void> {
  const { CHAT_TOOLS, executeChatTool } = await import("@/lib/chat/infrastructure/tools/chat-tools")
  const { determineReferenceSource } = await import("../infrastructure/http/chat-response")

  const apiMessages = toAnthropicMessages(messages)
  const convState = buildStateFromHistory(messages)
  logConversationState(convState, null)

  const baseSystemPrompt = await buildSystemPrompt()
  const structuredCtx = buildStructuredContext(convState, null)
  const systemPrompt = `${baseSystemPrompt}\n\n${structuredCtx}`

  let currentMessages: Anthropic.MessageParam[] = [...apiMessages]
  const toolsUsed: string[] = []
  const toolResults: { name: string; result: string }[] = []

  const modelId = deps.model as Parameters<typeof deps.client.messages.create>[0]["model"]

  // ── Tool-use rounds (non-streaming) ──
  // Each round: call LLM, check for tool_use blocks. If text-only → break and stream.
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const llmResponse = await createAnthropicMessageWithLogging({
      client: deps.client,
      route: deps.route,
      operation: round === 0 ? "chat.initial" : `chat.tool_round.${round}`,
      request: {
        model: modelId,
        max_tokens: 2048,
        system: systemPrompt,
        tools: CHAT_TOOLS,
        messages: currentMessages,
      },
    })

    const toolUseBlocks = llmResponse.content.filter(
      (block): block is Anthropic.ContentBlock & { type: "tool_use" } => block.type === "tool_use"
    )

    // No tool use → this is the final text response, but we already have it non-streaming.
    // Instead of wasting an extra API call, we'll simulate streaming from this text.
    if (toolUseBlocks.length === 0) {
      const textBlocks = llmResponse.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      const rawText = textBlocks.map(b => b.text).join("\n")
        || "죄송합니다, 응답을 생성하지 못했습니다."

      await emitFinalStream(rawText, toolsUsed, toolResults, convState, callbacks, determineReferenceSource)
      return
    }

    // Execute tools
    const toolResultMessages: Anthropic.ToolResultBlockParam[] = []
    for (const toolBlock of toolUseBlocks) {
      const toolInput = mergeSearchProductsInput(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        convState,
      )
      const result = await executeChatTool(toolBlock.name, toolInput, {
        anthropicChatModel: deps.model,
        client: deps.client,
        route: deps.route,
      })
      toolsUsed.push(toolBlock.name)
      toolResults.push({ name: toolBlock.name, result })
      toolResultMessages.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result,
      })
    }

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: llmResponse.content },
      { role: "user", content: toolResultMessages },
    ]
  }

  // ── Final round: use streaming API so tokens arrive in real-time ──
  try {
    const intent = inferIntent(toolsUsed)
    const references = extractReferences(toolResults)
    const brandProducts = extractBrandInfo(toolResults)
    const needsBrandHeader =
      intent === "product_recommendation" ||
      intent === "product_lookup" ||
      intent === "cross_reference"

    // Brand header first
    if (needsBrandHeader && brandProducts.length > 0) {
      const header = brandProducts
        .slice(0, 3)
        .map(p => `**브랜드명:** ${p.brand} | **제품코드:** ${p.displayCode}`)
        .join("\n")
      await callbacks.onText(header + "\n\n")
    }

    // Stream the final LLM call
    const stream = deps.client.messages.stream({
      model: modelId,
      max_tokens: 2048,
      system: systemPrompt,
      tools: CHAT_TOOLS,
      messages: currentMessages,
    })

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as { type: string; text?: string }
        if (delta.type === "text_delta" && delta.text) {
          await callbacks.onText(delta.text)
        }
      }
    }

    // Reference badge
    const refSource = determineReferenceSource(toolsUsed, toolResults)
    if (refSource) {
      const REFERENCE_LABELS: Record<string, string> = {
        internal_db: "📋 Reference: YG-1 내부 DB",
        internal_kb: "📋 Reference: YG-1 공식 정보",
        web_search: "📋 Reference: 웹 검색 (외부 소스 — 카탈로그 확인 필요)",
        ai_knowledge: "📋 Reference: AI 일반 지식 (카탈로그 확인 필요)",
        mixed: "📋 Reference: YG-1 내부 DB + 웹 검색",
      }
      await callbacks.onText("\n\n" + REFERENCE_LABELS[refSource])
    }

    await callbacks.onMeta({
      intent,
      chips: resolveChips(intent, ""),
      extractedField: null,
      isComplete: intent !== "general",
      recommendationIds: null,
      references,
    })
    await callbacks.onDone()
  } catch (err) {
    await callbacks.onError(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Emit the final text with simulated streaming (word-by-word) + post-processing.
 * Used when the final LLM response was obtained non-streaming (no tool calls in last round).
 */
async function emitFinalStream(
  rawText: string,
  toolsUsed: string[],
  toolResults: { name: string; result: string }[],
  convState: ConversationState,
  callbacks: ChatStreamCallbacks,
  determineReferenceSource: (toolsUsed: string[], toolResults: { name: string; result: string }[]) => string | null,
) {
  const retrievalMemory = buildRetrievalMemory(toolResults, convState)
  if (retrievalMemory) {
    convState.retrievalMemory = retrievalMemory
    logConversationState(convState, retrievalMemory)
  }

  const intent = inferIntent(toolsUsed)
  const references = extractReferences(toolResults)
  const brandProducts = extractBrandInfo(toolResults)

  const needsBrandHeader =
    intent === "product_recommendation" ||
    intent === "product_lookup" ||
    intent === "cross_reference"

  // Brand header
  if (needsBrandHeader && brandProducts.length > 0) {
    const header = brandProducts
      .slice(0, 3)
      .map(p => `**브랜드명:** ${p.brand} | **제품코드:** ${p.displayCode}`)
      .join("\n")
    await callbacks.onText(header + "\n\n")
  }

  // Clean LLM reference lines
  const cleaned = rawText
    .replace(/\n*📋\s*Reference:?\s*[^\n]*/gi, "")
    .replace(/\n*\[Reference:?\s*[^\]]*\]/gi, "")
    .trimEnd()

  // Simulate streaming: emit in small chunks with real delay for network flush
  const chunks = cleaned.match(/.{1,12}/gs) || [cleaned]
  for (const chunk of chunks) {
    await callbacks.onText(chunk)
    await new Promise(r => setTimeout(r, 20))
  }

  // Reference badge
  const refSource = determineReferenceSource(toolsUsed, toolResults)
  if (refSource) {
    const REFERENCE_LABELS: Record<string, string> = {
      internal_db: "📋 Reference: YG-1 내부 DB",
      internal_kb: "📋 Reference: YG-1 공식 정보",
      web_search: "📋 Reference: 웹 검색 (외부 소스 — 카탈로그 확인 필요)",
      ai_knowledge: "📋 Reference: AI 일반 지식 (카탈로그 확인 필요)",
      mixed: "📋 Reference: YG-1 내부 DB + 웹 검색",
    }
    await callbacks.onText("\n\n" + REFERENCE_LABELS[refSource])
  }

  await callbacks.onMeta({
    intent,
    chips: resolveChips(intent, ""),
    extractedField: null,
    isComplete: intent !== "general",
    recommendationIds: null,
    references,
  })
  await callbacks.onDone()
}

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages
    .filter(message => message.role === "user" || message.role === "ai")
    .map(message => ({
      role: (message.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: message.text,
    }))
    .filter((_, index, items) => !(index === 0 && items[0]?.role === "assistant"))
}

function mergeSearchProductsInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  convState: ConversationState
): Record<string, unknown> {
  if (toolName !== "search_products" || convState.topicStatus === "new") {
    return toolInput
  }

  const merged = { ...toolInput }
  if (!merged.material && convState.params.material) merged.material = convState.params.material
  if (merged.diameter_mm == null && convState.params.diameterMm != null) merged.diameter_mm = convState.params.diameterMm
  if (merged.flute_count == null && convState.params.fluteCount != null) merged.flute_count = convState.params.fluteCount
  if (!merged.operation_type && convState.params.operation) merged.operation_type = convState.params.operation
  if (!merged.coating && convState.params.coating) merged.coating = convState.params.coating

  console.log(
    `[chat] progressive-narrow: LLM sent [${Object.keys(toolInput).join(",")}] -> merged [${Object.keys(merged).filter(key => merged[key] != null).join(",")}]`
  )

  return merged
}

function buildDefaultChips(intent: LLMResponse["intent"]): string[] {
  switch (intent) {
    case "product_recommendation":
      return ["절삭조건도 알려줘", "다른 직경은?", "경쟁사 비교"]
    case "product_lookup":
      return ["절삭조건 보기", "유사 제품 더 보기", "재고 확인"]
    case "cutting_condition":
      return ["다른 소재 조건", "제품 상세 보기", "추천 더 받기"]
    case "cross_reference":
      return ["상세 스펙 비교", "절삭조건 보기", "다른 대체품"]
    case "web_search":
      return ["내부 DB에서 검색", "더 자세히 알려줘", "관련 제품 추천"]
    default:
      return ["제품 추천", "절삭조건 문의", "코팅 비교"]
  }
}

function resolveChips(intent: LLMResponse["intent"], responseText: string): string[] | null {
  const chipPatterns = responseText.match(
    /(?:추가 질문|다른 질문|더 궁금|참고로|도움이 되셨|다음과 같은).*$/m
  )
  if (chipPatterns) return null
  return buildDefaultChips(intent)
}

// ── Pre-search: extract params from conversation via LLM, then search DB ──
const PARAM_EXTRACTION_PROMPT = `대화에서 절삭공구 검색에 필요한 파라미터를 추출하세요.
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{
  "material": "ISO 태그 (P/M/K/N/S/H) 또는 null",
  "diameter_mm": 숫자 또는 null,
  "operation_type": "가공형상 (Drilling/Side_Milling/Slotting 등) 또는 null",
  "flute_count": 숫자 또는 null,
  "coating": "코팅명 또는 null",
  "keyword": "시리즈명/브랜드명/특수 키워드 또는 null"
}
소재 매핑: 탄소강/합금강/일반강=P, 스테인리스=M, 주철=K, 비철/알루미늄=N, 내열합금/티타늄=S, 고경도강=H
가공방식 매핑: Holemaking/드릴=Drilling, 측면가공=Side_Milling, 슬롯=Slotting, 정면가공=Facing
확실하지 않은 파라미터는 null로 두세요.`

async function extractParamsAndPreSearch(
  messages: ChatMessage[],
  deps: ChatServiceDeps,
): Promise<{ preSearchResult: string | null; extractedParams: Record<string, unknown> }> {
  try {
    const conversationText = messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => `[${m.role}] ${m.text}`)
      .join("\n")

    const response = await deps.client.messages.create({
      model: deps.model as Parameters<typeof deps.client.messages.create>[0]["model"],
      max_tokens: 300,
      system: PARAM_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: conversationText }],
    })

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("")

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { preSearchResult: null, extractedParams: {} }

    const params = JSON.parse(jsonMatch[0])
    const extractedParams: Record<string, unknown> = {}

    // Only keep non-null values
    if (params.material) extractedParams.material = params.material
    if (params.diameter_mm) extractedParams.diameter_mm = params.diameter_mm
    if (params.operation_type) extractedParams.operation_type = params.operation_type
    if (params.flute_count) extractedParams.flute_count = params.flute_count
    if (params.coating) extractedParams.coating = params.coating
    if (params.keyword) extractedParams.keyword = params.keyword

    // If we have at least 1 param, do a pre-search
    if (Object.keys(extractedParams).length > 0) {
      const { executeChatTool: execTool } = await import("@/lib/chat/infrastructure/tools/chat-tools")
      const result = await execTool("search_products", extractedParams, {
        anthropicChatModel: deps.model,
        client: deps.client,
        route: deps.route,
      })
      console.log(`[chat] pre-search: params=${JSON.stringify(extractedParams)} → result length=${result.length}`)
      return { preSearchResult: result, extractedParams }
    }

    return { preSearchResult: null, extractedParams }
  } catch (err) {
    console.error("[chat] pre-search failed:", err)
    return { preSearchResult: null, extractedParams: {} }
  }
}

export async function runChatConversation(
  messages: ChatMessage[],
  deps: ChatServiceDeps
): Promise<ChatServiceResult> {
  const apiMessages = toAnthropicMessages(messages)
  const convState = buildStateFromHistory(messages)
  logConversationState(convState, null)

  // ── Step 0: Pre-search (LLM 파라미터 추출 → DB 검색) ──
  const { preSearchResult, extractedParams } = await extractParamsAndPreSearch(messages, deps)

  const baseSystemPrompt = await buildSystemPrompt()
  const structuredCtx = buildStructuredContext(convState, null)

  // Inject pre-search results into system prompt
  let preSearchContext = ""
  if (preSearchResult) {
    preSearchContext = `\n\n═══ 사전 검색 결과 (서버가 대화에서 추출한 파라미터로 미리 검색함) ═══\n추출된 파라미터: ${JSON.stringify(extractedParams)}\n검색 결과:\n${preSearchResult}\n\n★ 위 사전 검색 결과가 있으면 이를 기반으로 바로 추천하라. 불필요한 질문을 하지 마라. 결과가 10개 이하면 즉시 추천하라.\n★ 사전 검색에서 이미 찾은 파라미터를 다시 묻지 마라.\n═══`
  }

  const systemPrompt = `${baseSystemPrompt}\n\n${structuredCtx}${preSearchContext}`

  let currentMessages = [...apiMessages]
  const toolsUsed: string[] = []
  const toolResults: { name: string; result: string }[] = []

  // Pre-search 결과를 toolResults에도 추가 (reference 추적용)
  if (preSearchResult) {
    toolsUsed.push("search_products")
    toolResults.push({ name: "search_products", result: preSearchResult })
  }

  const startedAt = Date.now()
  let llmResponse = await createAnthropicMessageWithLogging({
    client: deps.client,
    route: deps.route,
    operation: "chat.initial",
    request: {
      model: deps.model as Parameters<typeof deps.client.messages.create>[0]["model"],
      max_tokens: 2048,
      system: systemPrompt,
      tools: CHAT_TOOLS,
      messages: currentMessages,
    },
  })

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolUseBlocks = llmResponse.content.filter(
      (block): block is Anthropic.ContentBlock & { type: "tool_use" } => block.type === "tool_use"
    )

    if (toolUseBlocks.length === 0) break

    const toolResultMessages: Anthropic.ToolResultBlockParam[] = []

    for (const toolBlock of toolUseBlocks) {
      const toolInput = mergeSearchProductsInput(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        convState
      )
      const result = await executeChatTool(toolBlock.name, toolInput, {
        anthropicChatModel: deps.model,
        client: deps.client,
        route: deps.route,
      })

      toolsUsed.push(toolBlock.name)
      toolResults.push({ name: toolBlock.name, result })
      toolResultMessages.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result,
      })
    }

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: llmResponse.content },
      { role: "user", content: toolResultMessages },
    ]

    llmResponse = await createAnthropicMessageWithLogging({
      client: deps.client,
      route: deps.route,
      operation: `chat.tool_round.${round + 1}`,
      request: {
        model: deps.model as Parameters<typeof deps.client.messages.create>[0]["model"],
        max_tokens: 2048,
        system: systemPrompt,
        tools: CHAT_TOOLS,
        messages: currentMessages,
      },
    })

    if (llmResponse.stop_reason === "end_turn") break
  }

  const textBlocks = llmResponse.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  )
  const responseText =
    textBlocks.map(block => block.text).join("\n") ||
    "죄송합니다, 응답을 생성하지 못했습니다."

  const retrievalMemory = buildRetrievalMemory(toolResults, convState)
  if (retrievalMemory) {
    convState.retrievalMemory = retrievalMemory
    logConversationState(convState, retrievalMemory)
  }

  const intent = inferIntent(toolsUsed)
  const references = extractReferences(toolResults)
  const brandProducts = extractBrandInfo(toolResults)

  // 1) 브랜드 헤더 주입
  const withBrand =
    intent === "product_recommendation" ||
    intent === "product_lookup" ||
    intent === "cross_reference"
      ? injectBrandHeader(responseText, brandProducts)
      : responseText

  // 2) Reference 강제 주입 (LLM이 붙인 부정확한 것 제거 → 정확한 것 추가)
  const finalText = injectReferenceBadge(withBrand, toolsUsed, toolResults)

  return {
    response: {
      intent,
      text: finalText,
      chips: resolveChips(intent, responseText),
      extractedField: null,
      isComplete: intent !== "general",
      recommendationIds: null,
      references,
    },
    convState,
    retrievalMemory,
    toolsUsed,
    references,
    finalText,
    durationMs: Date.now() - startedAt,
    llmUsage: llmResponse.usage,
  }
}
