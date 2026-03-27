/**
 * Conversation State Manager
 *
 * Extracts, maintains, and builds structured context for the LLM.
 * Ensures retrieval results persist as working memory across turns.
 */

export interface ConversationState {
  // Current intent
  intent: "product_recommendation" | "coating_recommendation" | "cutting_condition" | "competitor_mapping" | "general" | null

  // Accumulated parameters (never re-ask these)
  params: {
    toolType: string | null
    material: string | null
    diameterMm: number | null
    operation: string | null
    coating: string | null
    fluteCount: number | null
    toolSubtype: string | null
  }

  // Retrieval memory — what was found in previous searches
  retrievalMemory: RetrievalMemory | null

  // Topic continuity
  topicStatus: "new" | "continue" | "refine" | "change_param" | "ask_about_result"

  // What's still missing
  missingParams: string[]
}

export interface RetrievalMemory {
  query: string
  totalMatched: number
  displayedCount: number
  topProducts: {
    code: string
    brand: string
    series: string | null
    diameter: number | null
    flute: number | null
    coating: string | null
    materialTags: string[]
  }[]
  activeFilters: Record<string, string>
  conclusion: string
}

interface ChatMessage {
  role: "user" | "ai" | "system"
  text: string
}

// ── Parameter Extraction from User Message ──────────────────

const MATERIAL_PATTERNS: [RegExp, string][] = [
  [/알루미늄|aluminum|aluminium|alu/i, "aluminum"],
  [/스테인리스|스텐|sus\s?\d{3}/i, "stainless"],
  [/탄소강|s45c|s50c|sm45c/i, "carbon_steel"],
  [/주철|cast\s?iron|fc\d{3}/i, "cast_iron"],
  [/티타늄|titan/i, "titanium"],
  [/인코넬|inconel|내열합금/i, "superalloy"],
  [/고경도|hardened|hrc/i, "hardened"],
  [/구리|copper|동/i, "copper"],
]

const OPERATION_PATTERNS: [RegExp, string][] = [
  [/황삭|roughing|rough/i, "roughing"],
  [/정삭|finishing|finish/i, "finishing"],
  [/중삭|semi/i, "semi-finishing"],
  [/측면|side\s?mill/i, "side_milling"],
  [/슬롯|slot/i, "slotting"],
  [/프로파일|profile|profiling/i, "profiling"],
  [/페이싱|facing|평면/i, "facing"],
]

export function extractParamsFromMessage(text: string): Partial<ConversationState["params"]> {
  const params: Partial<ConversationState["params"]> = {}
  const lower = text.toLowerCase()

  // Diameter
  const diamMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mm|밀리|파이)/i) || text.match(/직경\s*(\d+(?:\.\d+)?)/i) || text.match(/φ(\d+(?:\.\d+)?)/i)
  if (diamMatch) params.diameterMm = parseFloat(diamMatch[1])

  // Flute count
  const fluteMatch = text.match(/(\d+)\s*(?:날|플루트|flute)/i)
  if (fluteMatch) params.fluteCount = parseInt(fluteMatch[1])

  // Material
  for (const [pattern, value] of MATERIAL_PATTERNS) {
    if (pattern.test(text)) { params.material = value; break }
  }

  // Operation
  for (const [pattern, value] of OPERATION_PATTERNS) {
    if (pattern.test(text)) { params.operation = value; break }
  }

  // Coating
  if (/tialn/i.test(lower)) params.coating = "TiAlN"
  else if (/alcrn/i.test(lower)) params.coating = "AlCrN"
  else if (/dlc/i.test(lower)) params.coating = "DLC"
  else if (/tin(?!\w)/i.test(lower)) params.coating = "TiN"
  else if (/무코팅|uncoated/i.test(lower)) params.coating = "Uncoated"

  // Tool type
  if (/엔드밀|endmill|end\s?mill/i.test(lower)) params.toolType = "endmill"
  else if (/드릴|drill/i.test(lower)) params.toolType = "drill"
  else if (/탭|tap/i.test(lower)) params.toolType = "tap"

  // Tool subtype
  if (/볼|ball/i.test(lower)) params.toolSubtype = "Ball"
  else if (/라디우스|radius|cr|코너/i.test(lower)) params.toolSubtype = "Radius"
  else if (/스퀘어|square|플랫/i.test(lower)) params.toolSubtype = "Square"

  return params
}

// ── Topic Shift Detection ───────────────────────────────────

export function detectTopicStatus(
  latestMessage: string,
  prevState: ConversationState | null
): ConversationState["topicStatus"] {
  const lower = latestMessage.toLowerCase()

  // Explicit new topic signals
  if (/새로운|다른\s*거|주제\s*바꿀|처음부터|리셋/i.test(lower)) return "new"

  // Asking about previous results
  if (/이\s*중|그\s*중|위\s*제품|추천.*중|그거|이거|어떤\s*게|뭐가\s*더/i.test(lower)) return "ask_about_result"

  // Changing a parameter
  if (/바꿔|변경|대신|말고|상관없/i.test(lower)) return "change_param"

  // If no previous state, it's new
  if (!prevState || !prevState.intent) return "new"

  // Refining with new params
  const newParams = extractParamsFromMessage(latestMessage)
  if (Object.keys(newParams).length > 0) return "refine"

  // Default: continue
  return "continue"
}

// ── Build State from Message History ────────────────────────

export function buildStateFromHistory(messages: ChatMessage[]): ConversationState {
  const state: ConversationState = {
    intent: null,
    params: {
      toolType: null,
      material: null,
      diameterMm: null,
      operation: null,
      coating: null,
      fluteCount: null,
      toolSubtype: null,
    },
    retrievalMemory: null,
    topicStatus: "new",
    missingParams: [],
  }

  // Extract params from all user messages (accumulate)
  for (const msg of messages) {
    if (msg.role !== "user") continue
    const extracted = extractParamsFromMessage(msg.text)
    if (extracted.toolType) state.params.toolType = extracted.toolType
    if (extracted.material) state.params.material = extracted.material
    if (extracted.diameterMm != null) state.params.diameterMm = extracted.diameterMm
    if (extracted.operation) state.params.operation = extracted.operation
    if (extracted.coating) state.params.coating = extracted.coating
    if (extracted.fluteCount != null) state.params.fluteCount = extracted.fluteCount
    if (extracted.toolSubtype) state.params.toolSubtype = extracted.toolSubtype

    // Handle "상관없어" — clear the field
    if (/직경.*상관없|상관없.*직경/i.test(msg.text)) state.params.diameterMm = null
    if (/코팅.*상관없|상관없.*코팅/i.test(msg.text)) state.params.coating = null
    if (/날.*상관없|상관없.*날/i.test(msg.text)) state.params.fluteCount = null
  }

  // Infer intent
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
  if (/추천|검색|찾아|골라/i.test(lastUser)) state.intent = "product_recommendation"
  else if (/코팅.*추천|추천.*코팅/i.test(lastUser)) state.intent = "coating_recommendation"
  else if (/절삭조건|vc|fz|이송|회전/i.test(lastUser)) state.intent = "cutting_condition"
  else if (/대체|경쟁사|sandvik|kennametal|미쓰비시/i.test(lastUser)) state.intent = "competitor_mapping"
  else if (state.params.material || state.params.diameterMm) state.intent = "product_recommendation"

  // Detect topic status
  state.topicStatus = detectTopicStatus(lastUser, null)

  // Calculate missing params
  const missing: string[] = []
  if (!state.params.material) missing.push("피삭재(소재)")
  if (state.params.diameterMm == null) missing.push("직경")
  if (!state.params.operation) missing.push("가공방식")
  if (state.params.fluteCount == null) missing.push("날수")
  if (!state.params.coating) missing.push("코팅")
  state.missingParams = missing

  return state
}

// ── Build Retrieval Memory from Tool Results ────────────────

export function buildRetrievalMemory(
  toolResults: { name: string; result: string }[],
  state: ConversationState
): RetrievalMemory | null {
  for (const tr of toolResults) {
    if (tr.name !== "search_products" && tr.name !== "search_product_by_edp") continue
    try {
      const data = JSON.parse(tr.result)
      if (!data.products || data.products.length === 0) continue

      const filters: Record<string, string> = {}
      if (state.params.material) filters.material = state.params.material
      if (state.params.diameterMm != null) filters.diameter = `${state.params.diameterMm}mm`
      if (state.params.operation) filters.operation = state.params.operation
      if (state.params.coating) filters.coating = state.params.coating
      if (state.params.fluteCount != null) filters.flute = `${state.params.fluteCount}날`

      return {
        query: Object.values(filters).join(", ") || "전체 검색",
        totalMatched: data.totalMatched ?? data.count,
        displayedCount: data.count,
        topProducts: data.products.slice(0, 10).map((p: Record<string, unknown>) => ({
          code: p.displayCode ?? "",
          brand: p.brand ?? "",
          series: p.seriesName ?? null,
          diameter: p.diameterMm ?? null,
          flute: p.fluteCount ?? null,
          coating: p.coating ?? null,
          materialTags: p.materialTags ?? [],
        })),
        activeFilters: filters,
        conclusion: `${data.totalMatched ?? data.count}개 후보 중 ${Math.min(data.count, 10)}개 표시`,
      }
    } catch {
      continue
    }
  }
  return null
}

// ── Build Structured Context for LLM ────────────────────────

export function buildStructuredContext(
  state: ConversationState,
  retrievalMemory: RetrievalMemory | null
): string {
  const sections: string[] = []

  // Working state
  const known = Object.entries(state.params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: ${v}`)

  if (known.length > 0 || state.intent) {
    sections.push(`═══ 현재 대화 상태 ═══
의도: ${state.intent ?? "미확인"}
파악된 조건: ${known.length > 0 ? known.join(", ") : "없음"}
누락된 조건: ${state.missingParams.length > 0 ? state.missingParams.join(", ") : "없음"}
토픽 상태: ${state.topicStatus}`)
  }

  // Retrieval memory
  const memory = retrievalMemory ?? state.retrievalMemory
  if (memory && state.topicStatus !== "new") {
    const productSummary = memory.topProducts.slice(0, 5).map((p, i) =>
      `  ${i + 1}. ${p.code} (${p.brand || "?"}) — φ${p.diameter ?? "?"}mm, ${p.flute ?? "?"}날, ${p.coating ?? "?"}코팅, 소재: ${p.materialTags.join(",") || "?"}`
    ).join("\n")

    sections.push(`═══ 이전 검색 결과 (대화 기억) ═══
검색 조건: ${memory.query}
총 후보: ${memory.totalMatched}개 (${memory.displayedCount}개 표시됨)
주요 후보:
${productSummary}
결론: ${memory.conclusion}

⚠️ 위 검색 결과를 기억하고 활용하라. 사용자가 "이 중에서", "그거", "위 제품" 등으로 참조하면 위 결과에서 답하라.`)
  }

  // Instructions based on topic status
  if (state.topicStatus === "new") {
    sections.push("⚠️ 새로운 주제 시작. 이전 검색 결과는 무시하고 새로 시작하라.")
  } else if (state.topicStatus === "ask_about_result") {
    sections.push("⚠️ 사용자가 이전 검색 결과에 대해 질문 중. 반드시 위 검색 결과를 참조하여 답하라.")
  } else if (state.topicStatus === "change_param") {
    sections.push("⚠️ 사용자가 조건을 변경 중. 변경된 조건으로 재검색이 필요할 수 있다.")
  }

  return sections.join("\n\n")
}

// ── Debug Log ───────────────────────────────────────────────

export function logConversationState(state: ConversationState, retrievalMemory: RetrievalMemory | null): void {
  const known = Object.entries(state.params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`)
  console.log(`[chat-state] topic=${state.topicStatus} intent=${state.intent ?? "?"} known=[${known.join(",")}] missing=[${state.missingParams.join(",")}] hasMemory=${!!retrievalMemory} products=${retrievalMemory?.totalMatched ?? 0}`)
}
