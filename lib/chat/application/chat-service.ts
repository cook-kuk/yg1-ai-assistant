import Anthropic from "@anthropic-ai/sdk"

import { CHAT_TOOLS, executeChatTool } from "@/lib/chat/infrastructure/tools/chat-tools"
import { searchKB } from "@/lib/knowledge/yg1-knowledge-base"
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

export async function runChatConversation(
  messages: ChatMessage[],
  deps: ChatServiceDeps
): Promise<ChatServiceResult> {
  const apiMessages = toAnthropicMessages(messages)
  const convState = buildStateFromHistory(messages)
  logConversationState(convState, null)

  const baseSystemPrompt = await buildSystemPrompt()
  const structuredCtx = buildStructuredContext(convState, null)

  // ── KB 프리페치: LLM 호출 전에 회사 관련 키워드 감지 → KB 자동 조회 ──
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
  const kbPrefetch = prefetchKBIfRelevant(lastUserMsg)
  const kbContext = kbPrefetch
    ? `\n\n═══ [시스템 자동 조회] KB 결과 (반드시 이 정보를 기반으로 답변하라) ═══\n${kbPrefetch}\n이 정보는 내부 지식베이스에서 자동 조회한 결과입니다. 이 정보와 다른 답변을 하지 마세요.`
    : ""

  const systemPrompt = `${baseSystemPrompt}\n\n${structuredCtx}${kbContext}`

  let currentMessages = [...apiMessages]
  const toolsUsed: string[] = []
  const toolResults: { name: string; result: string }[] = []

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
  const finalText = injectReferenceBadge(withBrand, toolsUsed, toolResults, !!kbPrefetch)

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

// ── KB 프리페치 ─────────────────────────────────────
// 회사 관련 키워드가 메시지에 있으면 LLM 호출 전에 KB를 자동 조회.
// 결과를 시스템 프롬프트에 주입하여 LLM이 날조할 수 없게 함.
const COMPANY_KEYWORDS = [
  // 사업장
  "공장", "영업소", "연구소", "본사", "물류센터", "교육원",
  "인천", "부평", "서운", "광주", "충주", "익산", "안산",
  "대구", "부산", "창원", "천안",
  // 경영/재무
  "매출", "영업이익", "순이익", "실적", "재무", "주주", "버핏", "imc", "버크셔",
  "주가", "상장", "코스닥", "종목", "주식",
  // 회사 기본
  "설립", "창업", "창립", "대표", "회장", "사장", "ceo",
  "직원", "인원", "몇명",
  "순위", "세계", "1위", "몇위",
  // 기타
  "경쟁사", "수출", "해외", "비전", "미션", "연혁", "역사",
  "수상", "인증", "iso", "채용", "입사",
  "카탈로그", "온라인 주문", "카카오",
  "sns", "인스타", "유튜브",
  "전화", "연락처", "팩스", "주소",
  "산업", "자동차", "항공",
  "정밀", "목표", "2035",
  "제품 라인", "브랜드",
]

function prefetchKBIfRelevant(userMessage: string): string | null {
  const q = userMessage.toLowerCase()
  const isCompanyQuery = COMPANY_KEYWORDS.some(kw => q.includes(kw))
  if (!isCompanyQuery) return null

  const result = searchKB(userMessage)
  if (result.found && result.confidence === "high") {
    console.log(`[chat:kb-prefetch] Hit: "${userMessage.slice(0, 40)}" → ${result.answer.slice(0, 60)}`)
    return result.answer
  }

  // KB에 없는 회사 질문 → "모른다"고 안내하라는 지시
  console.log(`[chat:kb-prefetch] Miss: "${userMessage.slice(0, 40)}" → KB에 없음`)
  return `내부 KB에 "${userMessage.slice(0, 30)}" 관련 정보가 없습니다. 추측하지 말고 "확인할 수 없습니다. YG-1 본사(032-526-0909) 또는 www.yg1.solutions에 문의해 주세요."로 안내하세요.`
}
