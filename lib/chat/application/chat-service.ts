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

import type { ChatProductDto } from "@/lib/contracts/chat"

const MAX_TOOL_ROUNDS = 5

async function extractProductsFromToolResults(
  toolResults: { name: string; result: string }[],
  options: { trustOnlyFirstSearch?: boolean } = {},
): Promise<ChatProductDto[]> {
  const { InventoryRepo } = await import("@/lib/data/repos/inventory-repo")
  const products: ChatProductDto[] = []
  const seen = new Set<string>()

  // pre-search 결과가 있으면 그것만 신뢰. LLM이 추가로 호출한
  // get_product_detail/find_yg1_alternative 등은 환각 코드일 수 있어 무시.
  const firstSearchIdx = options.trustOnlyFirstSearch
    ? toolResults.findIndex(tr => tr.name === "search_products")
    : -1

  for (let i = 0; i < toolResults.length; i++) {
    const tr = toolResults[i]
    if (firstSearchIdx >= 0 && i !== firstSearchIdx) continue
    if (tr.name !== "search_products" && tr.name !== "get_competitor_mapping" && tr.name !== "get_product_detail") continue
    try {
      const data = JSON.parse(tr.result)
      const items = data.products ?? data.yg1Alternatives ?? []
      for (const p of items) {
        const code = p.displayCode
        if (!code || seen.has(code)) continue
        seen.add(code)
        products.push({
          displayCode: code,
          seriesName: p.seriesName ?? null,
          brand: p.brand ?? null,
          diameterMm: p.diameterMm ?? null,
          fluteCount: p.fluteCount ?? null,
          coating: p.coating ?? null,
          materialTags: p.materialTags ?? [],
          toolType: p.toolType ?? null,
          toolSubtype: p.toolSubtype ?? null,
          toolMaterial: p.toolMaterial ?? null,
          featureText: p.featureText ?? null,
          description: p.description ?? null,
          seriesIconUrl: p.seriesIconUrl ?? null,
          shankDiameterMm: p.shankDiameterMm ?? null,
          lengthOfCutMm: p.lengthOfCutMm ?? null,
          overallLengthMm: p.overallLengthMm ?? null,
          helixAngleDeg: p.helixAngleDeg ?? null,
          stockStatus: "unknown",
          totalStock: null,
        })
      }
    } catch { /* ignore parse errors */ }
  }

  // Enrich with inventory data
  const enriched = await Promise.all(
    products.slice(0, 10).map(async (p) => {
      try {
        const inv = await InventoryRepo.getEnrichedAsync(p.displayCode)
        return { ...p, stockStatus: inv.stockStatus, totalStock: inv.totalStock }
      } catch {
        return p
      }
    })
  )

  return enriched
}

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
        undefined, // streaming path has no pre-search params
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
  convState: ConversationState,
  preSearchParams?: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "search_products") {
    return toolInput
  }

  const merged = { ...toolInput }

  // 1. Merge conversation state params (existing behavior)
  if (convState.topicStatus !== "new") {
    if (!merged.material && convState.params.material) merged.material = convState.params.material
    if (merged.diameter_mm == null && convState.params.diameterMm != null) merged.diameter_mm = convState.params.diameterMm
    if (merged.flute_count == null && convState.params.fluteCount != null) merged.flute_count = convState.params.fluteCount
    if (!merged.operation_type && convState.params.operation) merged.operation_type = convState.params.operation
    if (!merged.coating && convState.params.coating) merged.coating = convState.params.coating
  }

  // 2. Enforce pre-search extracted params (critical: tool_type, tool_subtype, diameter)
  // These are validated params from user's explicit input — LLM should not override
  if (preSearchParams) {
    // Hard enforcement: tool_type and tool_subtype ALWAYS override LLM
    if (preSearchParams.tool_type && !merged.tool_type) merged.tool_type = preSearchParams.tool_type
    if (preSearchParams.tool_subtype && !merged.tool_subtype) merged.tool_subtype = preSearchParams.tool_subtype
    // Diameter: enforce if LLM didn't specify
    if (preSearchParams.diameter_mm != null && merged.diameter_mm == null) merged.diameter_mm = preSearchParams.diameter_mm
    // Material: enforce if LLM didn't specify
    if (preSearchParams.material && !merged.material) merged.material = preSearchParams.material
    // Others: soft merge
    if (preSearchParams.flute_count != null && merged.flute_count == null) merged.flute_count = preSearchParams.flute_count
    if (preSearchParams.coating && !merged.coating) merged.coating = preSearchParams.coating
    if (preSearchParams.keyword && !merged.keyword) merged.keyword = preSearchParams.keyword
    if (preSearchParams.operation_type && !merged.operation_type) merged.operation_type = preSearchParams.operation_type
    // Hard enforcement: country and tool_material — explicit user intent must not be silently dropped
    if (preSearchParams.country && !merged.country) merged.country = preSearchParams.country
    if (preSearchParams.tool_material && !merged.tool_material) merged.tool_material = preSearchParams.tool_material
  }

  console.log(
    `[chat] merge: LLM=[${Object.keys(toolInput).join(",")}] + preSearch=[${Object.keys(preSearchParams ?? {}).join(",")}] → final=[${Object.keys(merged).filter(key => merged[key] != null).join(",")}]`
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
import { readFileSync } from "fs"
import { join } from "path"

function loadParamExtractionPolicy(): string {
  try {
    return readFileSync(join(process.cwd(), "data", "param-extraction-policy.md"), "utf-8")
  } catch {
    // Fallback if file not found
    return `대화에서 절삭공구 검색 파라미터를 추출하세요.
JSON 형식으로만 응답: {"material":"P/M/K/N/S/H 또는 null","diameter_mm":숫자 또는 null,"operation_type":"가공형상 또는 null","flute_count":숫자 또는 null,"coating":"코팅명 또는 null","keyword":"시리즈명 또는 null"}
확실하지 않으면 null.`
  }
}

// ── Regex-based fast parameter extraction (no LLM needed) ──
function fastExtractParams(text: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  const lower = text.toLowerCase()

  // intake form labels first (🌐 국가: KOREA, 🧱 가공 소재: 초내열합금, etc.)
  const intakeCountry = text.match(/국가\s*:\s*([^\n]+)/)?.[1]?.trim()
  const intakeMaterial = text.match(/가공\s*소재\s*:\s*([^\n]+)/)?.[1]?.trim()
  const intakeShape = text.match(/가공\s*형상\s*:\s*([^\n]+)/)?.[1]?.trim()
  const intakeMethod = text.match(/가공\s*방식\s*:\s*([^\n]+)/)?.[1]?.trim()
  const intakeDia = text.match(/공구\s*직경\s*:\s*(\d+(?:\.\d+)?)/)?.[1]
  if (intakeDia) params.diameter_mm = parseFloat(intakeDia)
  if (intakeShape && intakeShape !== "모름") params.operation_type = intakeShape
  if (intakeMethod) {
    const m = intakeMethod.toLowerCase()
    if (m.includes("mill")) params.tool_type = "endmill"
    else if (m.includes("drill")) params.tool_type = "drill"
    else if (m.includes("tap")) params.tool_type = "tap"
  }

  // diameter (free-form fallback)
  if (params.diameter_mm == null) {
    const diamMatch = text.match(/(?:φ|ø|직경\s*)(\d+(?:\.\d+)?)\s*mm?/i) ?? text.match(/(\d+(?:\.\d+)?)\s*mm/)
    if (diamMatch) params.diameter_mm = parseFloat(diamMatch[1])
  }

  // flute count
  const fluteMatch = text.match(/(\d+)\s*날/)
  if (fluteMatch) params.flute_count = parseInt(fluteMatch[1])

  // country (free-form — overridable by intake)
  const countrySource = intakeCountry || lower
  const cs = countrySource.toLowerCase()
  if (/국내|국산|한국|대한민국|\bkorea\b|\bkor\b/.test(cs)) params.country = "KOR"
  else if (/미국|\busa\b|\bus\b\s|america/.test(cs)) params.country = "USA"
  else if (/일본|japan|\bjp\b/.test(cs)) params.country = "JPN"
  else if (/중국|china|\bcn\b/.test(cs)) params.country = "CHN"
  else if (/독일|germany|\bde\b/.test(cs)) params.country = "DEU"
  else if (intakeCountry && intakeCountry !== "ALL") params.country = intakeCountry.toUpperCase()

  // tool material (carbide vs HSS) — explicit "초경/하이스" cue
  if (/초경|카바이드|carbide|cemented/i.test(lower)) params.tool_material = "carbide"
  else if (/하이스|고속도강|\bhss\b|high.?speed/i.test(lower)) params.tool_material = "hss"

  // tool type — only set if not already from intake form
  if (!params.tool_type) {
    if (/엔드밀|endmill|end mill/i.test(lower)) params.tool_type = "endmill"
    else if (/드릴|drill/i.test(lower)) params.tool_type = "drill"
    else if (/탭|\btap\b/i.test(lower)) params.tool_type = "tap"
  }

  // tool subtype
  if (/square|스퀘어/i.test(lower)) params.tool_subtype = "square"
  else if (/ball|볼/i.test(lower)) params.tool_subtype = "ball"
  else if (/radius|코너\s*r/i.test(lower)) params.tool_subtype = "radius"
  else if (/roughing|황삭/i.test(lower)) params.tool_subtype = "roughing"

  // material (ISO)
  if (/탄소강|s45c|sm45c|일반강|carbon steel/i.test(lower)) params.material = "P"
  else if (/스테인리스|스텐|sus|stainless/i.test(lower)) params.material = "M"
  else if (/주철|cast iron/i.test(lower)) params.material = "K"
  else if (/알루미늄|비철|aluminum|non.?ferrous/i.test(lower)) params.material = "N"
  else if (/인코넬|초내열|titanium|inconel|티타늄/i.test(lower)) params.material = "S"
  else if (/고경도|hrc|hardened|경화강/i.test(lower)) params.material = "H"

  // coating
  if (/tialn/i.test(lower)) params.coating = "TiAlN"
  else if (/dlc/i.test(lower)) params.coating = "DLC"
  else if (/비코팅|무코팅|uncoated/i.test(lower)) params.coating = "Uncoated"

  return params
}

async function extractParamsAndPreSearch(
  messages: ChatMessage[],
  deps: ChatServiceDeps,
): Promise<{ preSearchResult: string | null; extractedParams: Record<string, unknown> }> {
  try {
    const conversationText = messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => `[${m.role}] ${m.text}`)
      .join("\n")

    const lastUserText = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
    // Combine all user messages so intake form labels (sent in an earlier turn)
    // are still visible to the regex extractor along with the latest free-form ask.
    const allUserText = messages
      .filter(m => m.role === "user")
      .map(m => m.text)
      .join("\n")

    // ── Fast path: regex extraction (skip LLM if 2+ params found) ──
    const fastParams = fastExtractParams(allUserText || lastUserText)
    const fastParamCount = Object.keys(fastParams).length

    let extractedParams: Record<string, unknown>

    if (fastParamCount >= 2) {
      // Skip LLM — regex extraction is sufficient
      console.log(`[pre-search] fast-path: ${fastParamCount} params from regex, skipping LLM`)
      extractedParams = fastParams
    } else {
      // ── LLM extraction (Haiku — fast & cheap) ──
      const policy = loadParamExtractionPolicy()
      const { resolveModel } = await import("@/lib/llm/provider")
      const haikuModel = resolveModel("haiku")
      const response = await deps.client.messages.create({
        model: (haikuModel || deps.model) as Parameters<typeof deps.client.messages.create>[0]["model"],
        max_tokens: 300,
        system: policy,
        messages: [{ role: "user", content: conversationText }],
      })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text).join("")

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { preSearchResult: null, extractedParams: {} }

      const params = JSON.parse(jsonMatch[0])
      extractedParams = {}

      if (params.material) extractedParams.material = params.material
      if (params.diameter_mm) extractedParams.diameter_mm = params.diameter_mm
      if (params.operation_type) extractedParams.operation_type = params.operation_type
      if (params.flute_count) extractedParams.flute_count = params.flute_count
      if (params.coating) extractedParams.coating = params.coating
      if (params.keyword) extractedParams.keyword = params.keyword
      if (params.tool_type) extractedParams.tool_type = params.tool_type
      if (params.tool_subtype) extractedParams.tool_subtype = params.tool_subtype
      if (params.country) extractedParams.country = params.country
      if (params.tool_material) extractedParams.tool_material = params.tool_material

      // Merge fast params for fields LLM missed
      for (const [k, v] of Object.entries(fastParams)) {
        if (!extractedParams[k]) extractedParams[k] = v
      }
    }

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
  let preSearchHasSufficientResults = false
  if (preSearchResult) {
    toolsUsed.push("search_products")
    toolResults.push({ name: "search_products", result: preSearchResult })
    // pre-search로 충분한 결과가 이미 있으면 LLM이 중복 search_products 호출하지 않도록 제거
    try {
      const parsed = JSON.parse(preSearchResult)
      // 임계값 1: pre-search가 명시적 사용자 파라미터로 1건이라도 찾으면 정답으로
      // 인정하고 LLM이 자기 판단으로 search_products를 다시 호출해 환각 제품을
      // 끌어오지 못하도록 차단한다.
      preSearchHasSufficientResults = (parsed.totalMatched ?? 0) >= 1
    } catch { /* ignore parse errors */ }
  }

  const effectiveTools = preSearchHasSufficientResults
    ? CHAT_TOOLS.filter(t => t.name !== "search_products")
    : CHAT_TOOLS

  const startedAt = Date.now()
  let llmResponse = await createAnthropicMessageWithLogging({
    client: deps.client,
    route: deps.route,
    operation: "chat.initial",
    request: {
      model: deps.model as Parameters<typeof deps.client.messages.create>[0]["model"],
      max_tokens: 2048,
      system: systemPrompt,
      tools: effectiveTools,
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
        convState,
        extractedParams,
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
        tools: effectiveTools,
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

  // Extract structured product data. preSearchHasSufficientResults=true 이면
  // pre-search 결과만 인정 (LLM이 추가 호출한 detail/alternative는 환각 위험).
  const recommendedProducts = await extractProductsFromToolResults(toolResults, {
    trustOnlyFirstSearch: preSearchHasSufficientResults,
  })

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
      recommendationIds: recommendedProducts.length > 0 ? recommendedProducts.map(p => p.displayCode) : null,
      recommendedProducts: recommendedProducts.length > 0 ? recommendedProducts : null,
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
