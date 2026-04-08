/**
 * Single-Call Router — routes user intent via ONE Haiku call
 * instead of multiple parallel Haiku calls.
 *
 * Feature-flagged behind USE_SINGLE_CALL_ROUTER.
 */

import type { LLMProvider, LLMMessage } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState, ChatMessage } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"
import { buildDomainKnowledgeSnippet } from "@/lib/recommendation/shared/patterns"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"

// ── Types ─────────────────────────────────────────────────────

export interface SingleCallAction {
  type:
    | "apply_filter"
    | "remove_filter"
    | "replace_filter"
    | "show_recommendation"
    | "compare"
    | "answer"
    | "skip"
    | "reset"
    | "go_back"
  field?: string
  value?: string | number
  /** Second value for between op (range upper bound) */
  value2?: string | number
  from?: string
  to?: string
  op?: "eq" | "neq" | "in" | "range" | "gte" | "lte" | "between"
  targets?: string[]
  message?: string
  /** Set when canonicalization failed — runtime should fall back to legacy */
  _canonFailed?: boolean
}

export interface SingleCallResult {
  actions: SingleCallAction[]
  answer: string
  reasoning: string
}

// ── Validation ────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set([
  "apply_filter",
  "remove_filter",
  "replace_filter",
  "show_recommendation",
  "compare",
  "answer",
  "skip",
  "reset",
  "go_back",
])

const VALID_OPS = new Set(["eq", "neq", "in", "range", "gte", "lte", "between"])

export function validateAction(action: unknown): action is SingleCallAction {
  if (!action || typeof action !== "object") return false
  const a = action as Record<string, unknown>
  if (!a.type || typeof a.type !== "string") return false
  if (!VALID_ACTION_TYPES.has(a.type)) return false
  if (a.op !== undefined && !VALID_OPS.has(a.op as string)) return false
  return true
}

export function validateAndCleanResult(raw: unknown): SingleCallResult {
  const empty: SingleCallResult = { actions: [], answer: "", reasoning: "" }
  if (!raw || typeof raw !== "object") return empty

  const r = raw as Record<string, unknown>
  const answer = typeof r.answer === "string" ? r.answer : ""
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : ""

  if (!Array.isArray(r.actions)) return { actions: [], answer, reasoning }

  const validActions = r.actions.filter(validateAction) as SingleCallAction[]
  return { actions: validActions, answer, reasoning }
}

// ── JSON extraction ───────────────────────────────────────────

export function extractJsonFromResponse(text: string): unknown | null {
  // Try direct parse first
  try {
    return JSON.parse(text)
  } catch {
    // noop
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // noop
    }
  }

  // Try finding first { ... } block
  const braceStart = text.indexOf("{")
  const braceEnd = text.lastIndexOf("}")
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1))
    } catch {
      // noop
    }
  }

  return null
}

// ── Prompt builder ────────────────────────────────────────────

function buildSessionSummary(state: ExplorationSessionState | null): string {
  if (!state) return "No session state (first turn)."

  const parts: string[] = []
  const filters = state.appliedFilters ?? []
  if (filters.length > 0) {
    parts.push(`Applied filters: ${filters.map(f => `${f.field}=${f.value}(${f.op})`).join(", ")}`)
  } else {
    parts.push("No filters applied yet.")
  }
  parts.push(`Candidate count: ${state.candidateCount ?? 0}`)
  if (state.lastAskedField) parts.push(`Last asked field: ${state.lastAskedField}`)
  if (state.currentMode) parts.push(`Mode: ${state.currentMode}`)
  if (state.displayedChips?.length) parts.push(`Displayed chips: ${state.displayedChips.join(", ")}`)
  if (state.resolutionStatus) parts.push(`Resolution: ${state.resolutionStatus}`)

  // ── Long-term Memory (accumulated across turns) ──
  const mem = state.conversationMemory
  if (mem) {
    // User behavioral signals
    const signals: string[] = []
    if (mem.userSignals.skippedFields.length > 0) signals.push(`Skipped: ${mem.userSignals.skippedFields.join(", ")}`)
    if (mem.userSignals.revisedFields.length > 0) signals.push(`Revised: ${mem.userSignals.revisedFields.join(", ")}`)
    if (mem.userSignals.prefersDelegate) signals.push("Prefers delegation")
    if (mem.userSignals.prefersExplanation) signals.push("Asks for explanations")
    if (signals.length > 0) parts.push(`User behavior: ${signals.join("; ")}`)

    // Soft preferences
    if (mem.softPreferences.length > 0) {
      parts.push(`Preferences: ${mem.softPreferences.map(p => p.description).join("; ")}`)
    }

    // Recent Q&A for context continuity
    if (mem.recentQA.length > 0) {
      const recent = mem.recentQA.slice(-3)
      parts.push(`Recent Q&A: ${recent.map(qa => `Q:${qa.question.slice(0, 40)} A:${qa.answer.slice(0, 40)}`).join(" | ")}`)
    }

    // Recommendation context
    if (mem.recommendationContext.primaryProductCode) {
      parts.push(`Last recommended: ${mem.recommendationContext.primarySeriesName ?? ""} ${mem.recommendationContext.primaryProductCode}`)
    }

    // Conversation highlights (notable moments)
    if (mem.highlights.length > 0) {
      const recentHighlights = mem.highlights.slice(-3)
      parts.push(`Highlights: ${recentHighlights.map(h => `[${h.type}] ${h.summary}`).join("; ")}`)
    }
  }

  return parts.join("\n")
}

const SYSTEM_PROMPT_FULL = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
Given the user's Korean message and the current session state, determine what actions to take.

## Session State
{{SESSION_STATE}}

## Known DB Values (use ONLY these exact values for brand/country/workpiece)
{{DB_VALUES}}

## Available Actions (return as JSON array)
- apply_filter: Add a new filter. Requires field, value, op.
  Ops: eq (default, exact match), neq (exclude), gte (≥), lte (≤), between (range, requires value2 as upper bound).
  Range cues in Korean → use gte/lte/between, NOT eq:
    - "이상", "넘는", "초과", "그 이상" → op:"gte"
    - "이하", "미만", "넘지 않는" → op:"lte"
    - "A에서 B 사이", "A~B", "A에서 B까지" → op:"between" with value=A, value2=B
  Range ops apply ONLY to numeric fields: diameterMm, fluteCount, lengthOfCutMm, overallLengthMm, helixAngleDeg, shankDiameterMm, ballRadiusMm, taperAngleDeg, pointAngleDeg, threadPitchMm.
- pointAngleDeg: drill tip point angle in degrees (number). Triggers: "포인트 각도", "드릴 각도", "point angle". Example: "포인트 각도 140도" → pointAngleDeg=140 op:eq.
- threadPitchMm: tap/thread pitch in mm (number). Triggers: "피치", "P1.5", "pitch". "M10 P1.5 관통탭" → threadPitchMm=1.5 (plus toolType=tap etc).
- remove_filter: Remove an existing filter. Requires field.
- replace_filter: Change an existing filter value. Requires field, from, to.
- show_recommendation: User wants to see results now.
- compare: User wants to compare specific products. Requires targets (product name array).
- answer: User asked a general question (no filter change). Set message with the question.
- skip: User wants to skip the current question ("상관없음", "아무거나", "패스"). Optionally set field.
- reset: User wants to start over.
- go_back: User wants to undo the last step.

## IMPORTANT: Filter deduplication
If a filter already exists in Applied filters, do NOT re-apply the same value.
If user restates an already-applied condition, just skip that filter action.

## Conversation Memory (Short-term + Long-term)
You receive conversation history AND accumulated memory in Session State.

Short-term (recent messages):
- "아까 그거" / "이전에 말한 거" → reference to previously mentioned condition
- "그 코팅으로" → the coating mentioned in a previous assistant message

Long-term (accumulated in Session State):
- "User behavior" shows: which fields user skipped, revised, or found confusing
- "Preferences" shows: user's soft preferences (coating, speed, etc.)
- "Recent Q&A" shows: recent questions and answers for continuity
- "Last recommended" shows: which product/series was recommended
- Use this to personalize: if user always skips coating → don't ask again about coating

## Korean Intent Patterns
- "빼고/제외/아닌것/없는거" → If the field already has a filter, use remove_filter. If no existing filter, use apply_filter with op:"neq"
  CRITICAL: "X 빼고" means REMOVE X, NOT add X. "Square 빼고" = remove Square filter.
- "바꿔/변경/대신/말고" -> replace_filter
- "상관없음/아무거나/패스/넘어가/알아서" -> skip
- Question ending with ? -> answer (no filter change)
- "추천해줘/보여줘/제품 보기/지금 바로" -> show_recommendation
- Multiple conditions in one message -> multiple actions

## CRITICAL: Field value rules
- toolSubtype values MUST be English only: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
  NEVER return Korean (스퀘어, 볼, 라디우스, 황삭). Always use English canonical names.
- fluteCount values MUST be numbers only: 2, 3, 4, 5, 6
  NEVER return "2날" or "4날". Just the number.
- coating values: TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated
- diameterMm values: numbers only (e.g., 10, 8, 6.35)

## Available filter fields
- toolSubtype: tool shape (Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed)
- fluteCount: number of flutes (2, 3, 4, 5, 6)
- coating: coating type (TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated)
- diameterMm: tool diameter in mm (number)
- lengthOfCutMm: length of cut / flute length in mm (number). "긴 가공" implies larger value.
- overallLengthMm: overall tool length in mm (number)
- workPieceName: specific workpiece material (구리/Copper, 알루미늄/Aluminum, 스테인리스/Stainless, 탄소강/Carbon Steel, 주철/Cast Iron, 티타늄/Titanium, 인코넬/Inconel, 고경도강/Hardened Steel). Use this when user mentions a SPECIFIC material name.
- material: material group code (P, M, K, N, S, H). Use this when user mentions an ISO code.
- country: sales region / country of sale. Use ISO-3 codes or Korean/English natural names — the system canonicalizes them. Examples: "국내"/"국산"/"내수"/"한국" → "국내", "유럽"/"유럽용"/"유럽판매용"/"europe" → "유럽", "독일" → "독일", "일본" → "일본". "수입품 제외" / "해외 제품 제외" → country="국내" (op:"eq"). "국내 제품 말고" → country="국내" (op:"neq").
- ballRadiusMm: corner radius / ball nose radius in mm (number). Triggers: "라디우스 0.3", "코너R 0.5", "R0.2". When user gives a numeric radius value, emit BOTH toolSubtype="Radius" AND ballRadiusMm=<value>.
- coolantHole: presence of internal coolant through-hole (boolean). Triggers: "쿨런트홀", "쿨런트 구멍", "내부 냉각", "coolant hole", "internal coolant". Use value:true for "있는 거/되는 거", value:false for "없는 거/없이".
- stockStatus: in-stock filter (string). Triggers: "재고 있는 거", "재고만", "재고 있는 것만", "재고있음", "instock", "납기 빠른", "즉시 출하". Use value:"instock" with op:"eq". For numeric threshold ("재고 50개 이상"), use value:"50" or include the number in value as text.
- brand: series/brand name (string, pass-through). The canonical list of brands that actually exist in DB is injected below under "## Known DB Values". ONLY emit brand values from that list (closest match if user uses a variant spelling). Triggers: "브랜드 <name>", "<name>로", "<name> 시리즈". If user says "브랜드를 X로 바꿔줘" and NO brand filter exists yet → apply_filter(brand=X). If brand filter already exists → replace_filter(brand, from=<current>, to=X).

## Examples
User: "4날 TiAlN Square 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"3 filters from single message"}

User: "Square 빼고" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"remove_filter","field":"toolSubtype"}],"answer":"","reasoning":"user wants to remove Square filter"}

User: "Square 빼고 나머지로" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"remove_filter","field":"toolSubtype"}],"answer":"","reasoning":"remove existing Square filter to show all other subtypes"}

User: "TiAlN 제외하고" (when coating=TiAlN filter exists)
→ {"actions":[{"type":"remove_filter","field":"coating"}],"answer":"","reasoning":"remove TiAlN coating filter"}

User: "Ball 아닌 것들" (no existing toolSubtype filter)
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Ball","op":"neq"}],"answer":"","reasoning":"exclude Ball subtype"}

User: "4날로 바꿔줘" (when fluteCount=6 filter exists)
→ {"actions":[{"type":"replace_filter","field":"fluteCount","from":"6","to":4}],"answer":"","reasoning":"replace 6 flute with 4 flute"}

User: "Ball로 변경해주세요" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"replace_filter","field":"toolSubtype","from":"Square","to":"Ball"}],"answer":"","reasoning":"replace Square with Ball"}

User: "TiAlN이 뭐야?"
→ {"actions":[],"answer":"TiAlN은 내열성 코팅입니다.","reasoning":"question, no filter change"}

User: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"4 filters: copper workpiece, square subtype, 2 flutes, 10mm diameter"}

User: "구리 스퀘어 2날 10mm"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"4 filters from natural Korean"}

User: "알루미늄 고속가공용 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"알루미늄","op":"eq"}],"answer":"","reasoning":"aluminum workpiece, high-speed implies finishing intent"}

User: "스퀘어를 쓰고싶고, 구리를 가공하고 싶어."
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"}],"answer":"","reasoning":"2 filters: square + copper workpiece"}

User: "3날 무코팅에 스퀘어" (feedback: user wanted 3-flute uncoated square)
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":3,"op":"eq"},{"type":"apply_filter","field":"coating","value":"Uncoated","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"3 filters: 3 flutes, uncoated, square"}

User: "고경도강 밀링에 좋은 Solid end mill은 뭐가 있어?" (no filters yet)
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"고경도강","op":"eq"}],"answer":"","reasoning":"hardened steel workpiece, asking for recommendation"}

User: "SUS304 황삭할 건데 뭐가 좋아?"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"스테인리스","op":"eq"}],"answer":"","reasoning":"SUS304=stainless, roughing intent noted"}

User: "동 가공용 10미리 두날"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"}],"answer":"","reasoning":"동=copper, 10미리=10mm, 두날=2 flutes"}

User: "비철 구리 Square 2날 Ø10"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"비철 구리=copper, Ø10=diameter 10mm"}

User: "10mm 4날 Square TiAlN 탄소강"
→ {"actions":[{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"},{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"workPieceName","value":"탄소강","op":"eq"}],"answer":"","reasoning":"5 filters from single message"}

User: "전체 길이 100mm 이상인 것만"
→ {"actions":[{"type":"apply_filter","field":"overallLengthMm","value":100,"op":"gte"}],"answer":"","reasoning":"OAL ≥ 100mm"}

User: "전장 80mm 이하 짧은 거"
→ {"actions":[{"type":"apply_filter","field":"overallLengthMm","value":80,"op":"lte"}],"answer":"","reasoning":"OAL ≤ 80mm"}

User: "날수 5개 이상"
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":5,"op":"gte"}],"answer":"","reasoning":"flute count ≥ 5"}

User: "헬릭스 각도 45도 이상"
→ {"actions":[{"type":"apply_filter","field":"helixAngleDeg","value":45,"op":"gte"}],"answer":"","reasoning":"helix angle ≥ 45"}

User: "샹크 직경 6에서 10 사이"
→ {"actions":[{"type":"apply_filter","field":"shankDiameterMm","value":6,"value2":10,"op":"between"}],"answer":"","reasoning":"shank diameter range 6-10mm"}

User: "절삭 길이(날장) 20mm 이상"
→ {"actions":[{"type":"apply_filter","field":"lengthOfCutMm","value":20,"op":"gte"}],"answer":"","reasoning":"length of cut ≥ 20mm"}

User: "직경 8mm 이상 12mm 이하 제품만 보여줘"
→ {"actions":[{"type":"apply_filter","field":"diameterMm","value":8,"value2":12,"op":"between"}],"answer":"","reasoning":"diameter range 8-12mm"}

User: "전장 100 이상이고 쿨런트홀 있는 거"
→ {"actions":[{"type":"apply_filter","field":"overallLengthMm","value":100,"op":"gte"},{"type":"apply_filter","field":"coolantHole","value":true,"op":"eq"}],"answer":"","reasoning":"OAL ≥100 + internal coolant through-hole"}

User: "재고 있는 거만 보여줘"
→ {"actions":[{"type":"apply_filter","field":"stockStatus","value":"instock","op":"eq"}],"answer":"","reasoning":"in-stock filter"}

User: "재고 있고 빠른 납기 가능한 거"
→ {"actions":[{"type":"apply_filter","field":"stockStatus","value":"instock","op":"eq"}],"answer":"","reasoning":"in-stock filter (fast delivery implies in stock)"}

User: "한국 재고로 4날 TiAlN 전장 100 이상"
→ {"actions":[{"type":"apply_filter","field":"country","value":"한국","op":"eq"},{"type":"apply_filter","field":"stockStatus","value":"instock","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"overallLengthMm","value":100,"op":"gte"}],"answer":"","reasoning":"5 filters: KR + stock + 4F + TiAlN + OAL≥100"}

User: "M10 P1.5 관통탭"
→ {"actions":[{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"},{"type":"apply_filter","field":"threadPitchMm","value":1.5,"op":"eq"}],"answer":"","reasoning":"Tap M10 with pitch 1.5mm"}

User: "포인트 각도 140도"
→ {"actions":[{"type":"apply_filter","field":"pointAngleDeg","value":140,"op":"eq"}],"answer":"","reasoning":"drill point angle 140 degrees"}

User: "알루파워라는 브랜드는 왜 추천해주지 않나요?" (question about missing brand)
→ {"actions":[],"answer":"알루파워(ALU-POWER) 시리즈가 후보에 포함되어 있는지 확인하겠습니다.","reasoning":"question about brand, no filter change"}

User: "T-Coating 설명해줘"
→ {"actions":[],"answer":"","reasoning":"question about coating type, no filter change"}

User: "SUS304 가공인데" (specific steel grade = workPieceName)
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"SUS304","op":"eq"}],"answer":"","reasoning":"SUS304=stainless steel, set as workPieceName"}

User: "추천 제품 보기" / "지금 바로 제품 보기"
→ {"actions":[{"type":"show_recommendation"}],"answer":"","reasoning":"user wants to see results"}

User: "상관없음" / "아무거나 괜찮아" / "알아서 추천해줘"
→ {"actions":[{"type":"skip"}],"answer":"","reasoning":"user skips current question"}

User: "아까 말한 그 코팅으로 해줘" (conversation history mentions TiAlN)
→ {"actions":[{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"}],"answer":"","reasoning":"references TiAlN from conversation history"}

User: "그거로 해줘" / "네 그걸로" (previous assistant suggested Square)
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"agrees with assistant's previous suggestion"}

User: "고경도강에 추천하는 가공방식은 어떤게 있어?" (question with material context)
→ {"actions":[],"answer":"고경도강 가공에는 Side Milling, Profiling 등이 적합합니다.","reasoning":"question about machining methods, no filter change needed"}

User: "국내용 제품으로만 추천해줄래?" / "국내제품으로만 추천해줘" / "국내 제품으로만 추려줘"
→ {"actions":[{"type":"apply_filter","field":"country","value":"국내","op":"eq"}],"answer":"","reasoning":"Korea-only products"}

User: "수입품은 제외해줘" / "해외 제품 빼고"
→ {"actions":[{"type":"apply_filter","field":"country","value":"국내","op":"eq"}],"answer":"","reasoning":"exclude imports = keep domestic only"}

User: "나 독일사람인데 유럽판매용 제품으로만 먼저 필터링해줘요"
→ {"actions":[{"type":"apply_filter","field":"country","value":"유럽","op":"eq"}],"answer":"","reasoning":"Europe sales region"}

User: "국가가 KOREA 아니라 EUROPE"
→ {"actions":[{"type":"replace_filter","field":"country","from":"한국","to":"유럽"}],"answer":"","reasoning":"change country from Korea to Europe"}

User: "스테인리스 슬로팅 2날 8mm 국내 제품으로"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"스테인리스","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":8,"op":"eq"},{"type":"apply_filter","field":"country","value":"국내","op":"eq"}],"answer":"","reasoning":"stainless + 2 flute + 8mm + Korea"}

User: "브랜드를 X-POWER로 바꿔줘" (no existing brand filter)
→ {"actions":[{"type":"apply_filter","field":"brand","value":"X-POWER","op":"eq"}],"answer":"","reasoning":"apply brand filter (no prior brand to replace)"}

User: "브랜드를 X-POWER로 바꿔줘" (when brand=TitaNox-Power exists)
→ {"actions":[{"type":"replace_filter","field":"brand","from":"TitaNox-Power","to":"X-POWER"}],"answer":"","reasoning":"replace existing brand"}

User: "알루파워 시리즈로 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"brand","value":"ALU-POWER","op":"eq"}],"answer":"","reasoning":"알루파워 = ALU-POWER brand"}

User: "라디우스 0.3mm" / "코너R 0.5"
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Radius","op":"eq"},{"type":"apply_filter","field":"ballRadiusMm","value":0.3,"op":"eq"}],"answer":"","reasoning":"radius subtype + 0.3mm corner radius"}

User: "파란색 코팅 제품 있어?" (color → coating mapping)
→ {"actions":[{"type":"apply_filter","field":"coating","value":"Blue-Coating","op":"eq"}],"answer":"","reasoning":"파란색=Blue-Coating (X5070 brand)"}

User: "DLC 빼고 TiAlN으로" (remove + add in one message, when coating=DLC exists)
→ {"actions":[{"type":"remove_filter","field":"coating"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"}],"answer":"","reasoning":"remove DLC, add TiAlN"}

User: "SEM81010035이 알루미늄 가공에 적합할까?" (product code + question)
→ {"actions":[],"answer":"해당 제품의 소재 적합도를 확인하겠습니다.","reasoning":"question about specific product, no filter change"}

User: "GMG55100과 GMG40100 비교해줘" (product comparison)
→ {"actions":[{"type":"compare","targets":["GMG55100","GMG40100"]}],"answer":"","reasoning":"compare two specific products"}

User: "코너레디우스 0.5 날장 20이상" (multiple spec requirements)
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Radius","op":"eq"},{"type":"apply_filter","field":"lengthOfCutMm","value":20,"op":"range"}],"answer":"","reasoning":"코너레디우스=Radius, 날장=lengthOfCut≥20"}

## Response Format (strict JSON only, no markdown, no code blocks)
{
  "actions": [ { "type": "...", ... } ],
  "answer": "",
  "reasoning": "brief explanation"
}`

const SYSTEM_PROMPT_FREE = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
The user speaks Korean. Analyze the message and session state to determine actions.

## Session State
{{SESSION_STATE}}

## Known DB Values (use ONLY these exact values for brand/country/workpiece)
{{DB_VALUES}}

## Available Actions (JSON array)
- apply_filter: {type, field, value, op} — field: toolSubtype(Square/Ball/Radius/Roughing/Taper/Chamfer/High-Feed), fluteCount(number), coating(TiAlN/AlCrN/DLC/TiCN/Bright Finish/Blue-Coating/X-Coating/Y-Coating/Uncoated), diameterMm(number), lengthOfCutMm(number), overallLengthMm(number), shankDiameterMm(number, "샹크 직경"/"shank diameter"), helixAngleDeg(number, "헬릭스"/"나선각"/"helix"), ballRadiusMm(number, corner R/라디우스), pointAngleDeg(number, drill point angle 140/118/135), threadPitchMm(number, "M10 P1.5"→1.5/"피치"), coolantHole(boolean, "쿨런트홀"), stockStatus(string "instock", "재고"/"납기"), brand(X-POWER/TitaNox-Power/CRX S/ALU-POWER/3S MILL/ONLY ONE — "브랜드를 X로 바꿔"시 기존 brand 필터 있으면 replace, 없으면 apply), workPieceName(구리/알루미늄/스테인리스/탄소강/주철/티타늄/인코넬/고경도강), material(P/M/K/N/S/H), country(국내/유럽/독일/일본/한국 — "국내제품"/"수입품 제외"→country=국내, "유럽판매용"→country=유럽)
- remove_filter: {type, field} — "빼고/제외" + existing filter → remove
- replace_filter: {type, field, from, to} — "바꿔/변경" → replace value
- show_recommendation: {type} — "추천해줘/보여줘/제품 보기"
- compare: {type, targets} — product comparison
- answer: {type, message} — general question, NO filter change
- skip: {type, field?} — "상관없음/아무거나/패스/알아서"
- reset/go_back: {type}

## CRITICAL Rules
- toolSubtype values MUST be English: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
- fluteCount/diameterMm MUST be numbers only (not "2날", just 2)
- "X 빼고" when filter exists = remove_filter(field). NOT add X.
- Questions (ending with ?) = answer action, NO filter changes
- If filter already applied in session, do NOT re-apply
- IMPORTANT: Extract ALL filters from the message, even if it doesn't directly answer the pending question. "Square 추천해줘" when asked about flute count → [apply toolSubtype=Square], NOT skip.
- A message can contain BOTH an answer to the pending question AND additional filters. Extract everything.
- CRITICAL: If message contains filter values NOT yet in session, you MUST emit apply_filter actions BEFORE show_recommendation. Never skip filter extraction just because user said "추천해줘".

## Conversation Memory
You receive recent conversation history. Use it for references like "아까 그거", "이전에 말한 조건", "그 코팅으로".

## Key Examples
"피삭재는 구리 SQUARE 2날 직경 10" → [apply workPieceName=구리, toolSubtype=Square, fluteCount=2, diameterMm=10]
"3날 무코팅에 스퀘어" → [apply fluteCount=3, coating=Uncoated, toolSubtype=Square]
"Square 빼고" (existing filter) → [remove toolSubtype]
"Ball로 바꿔" (toolSubtype=Square exists) → [replace toolSubtype from=Square to=Ball]
"TiAlN이 뭐야?" → answer, no filter
"상관없음" → skip
"탄소강 10mm 4날 Square TiAlN으로 추천해줘" → [apply workPieceName=탄소강, diameterMm=10, fluteCount=4, toolSubtype=Square, coating=TiAlN]
"스퀘어를 쓰고싶고 구리를 가공하고 싶어" → [apply toolSubtype=Square, workPieceName=구리]
"copper square 2flute 10mm endmill 추천해줘" → [apply workPieceName=구리, toolSubtype=Square, fluteCount=2, diameterMm=10]
"국내제품으로만 추천해줘" / "수입품은 제외해줘" → [apply country=국내]
"유럽판매용 제품으로만" → [apply country=유럽]
"라디우스 0.3mm" / "코너R 0.5" → [apply toolSubtype=Radius, ballRadiusMm=0.3]
"브랜드를 X-POWER로 바꿔줘" (no brand filter yet) → [apply brand=X-POWER]
"브랜드를 X-POWER로 바꿔줘" (brand=TitaNox-Power exists) → [replace brand from=TitaNox-Power to=X-POWER]
(pending: fluteCount) "Square 4날 추천해줘" → [apply fluteCount=4, toolSubtype=Square] — answer pending + extract additional
(pending: coating) "그거로 코팅해줘" (prev turn mentioned TiAlN) → [apply coating=TiAlN] — resolve reference from conversation
(pending: toolSubtype) "DLC 빼고 TiAlN으로 바꿔" → [replace coating from=DLC to=TiAlN] — negation + replacement

${buildDomainKnowledgeSnippet()}

Response: strict JSON {"actions": [...], "answer": "", "reasoning": "brief"}`

function buildDbValuesSnippet(): string {
  const schema = getDbSchemaSync()
  if (!schema) return "(DB schema cache not yet warm — rely on session state and prior knowledge.)"

  const parts: string[] = []

  // Brands — most impactful (user-facing, often referenced by name)
  if (schema.brands.length > 0) {
    parts.push(`Brands (${schema.brands.length}): ${schema.brands.join(", ")}`)
  }

  // Workpieces — tag_name (Korean) → normalized (English)
  if (schema.workpieces.length > 0) {
    const wpMap = new Map<string, string>()
    for (const w of schema.workpieces) {
      if (w.tag_name && !wpMap.has(w.tag_name)) wpMap.set(w.tag_name, w.normalized_work_piece_name)
    }
    const wpList = Array.from(wpMap.entries()).map(([k, v]) => `${k}=${v}`).join(", ")
    parts.push(`Workpieces: ${wpList}`)
  }

  // Country codes — unnested from text[] column in schema cache
  if (schema.countries && schema.countries.length > 0) {
    parts.push(`Country codes in DB: ${schema.countries.join(", ")}`)
  }

  return parts.length > 0 ? parts.join("\n") : "(DB schema cache empty)"
}

function buildSystemPrompt(state: ExplorationSessionState | null): string {
  const template = LLM_FREE_INTERPRETATION ? SYSTEM_PROMPT_FREE : SYSTEM_PROMPT_FULL
  return template
    .replace("{{SESSION_STATE}}", buildSessionSummary(state))
    .replace("{{DB_VALUES}}", buildDbValuesSnippet())
}

// ── Main function ─────────────────────────────────────────────

const SINGLE_CALL_ROUTER_MODEL = "haiku" as const

/**
 * Build conversation memory for SCR — includes recent turns so the LLM can understand
 * references like "아까 추천한 거", "이전에 말한 조건", "그거로 해줘"
 */
function buildConversationMemory(
  recentMessages: ChatMessage[],
  userMessage: string,
  maxTurns = 3
): LLMMessage[] {
  const llmMessages: LLMMessage[] = []

  // Include last N turns of conversation (each turn = AI + User pair)
  const relevantMessages = recentMessages.slice(-(maxTurns * 2))
  for (const msg of relevantMessages) {
    llmMessages.push({
      role: msg.role === "ai" ? "assistant" : "user",
      content: msg.text.slice(0, 500), // truncate long messages to save tokens
    })
  }

  // Always add the current user message as the last one
  llmMessages.push({ role: "user", content: userMessage })

  return llmMessages
}

export async function routeSingleCall(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider,
  recentMessages?: ChatMessage[],
  kgHint?: string
): Promise<SingleCallResult> {
  const basePrompt = buildSystemPrompt(sessionState)
  const systemPrompt = kgHint
    ? `${basePrompt}\n\n## KG Hint (pre-analyzed entities from Knowledge Graph)\n${kgHint}\nUse these as strong guidance — the entities above are already validated. Emit matching apply_filter actions.`
    : basePrompt
  const llmMessages = recentMessages && recentMessages.length > 0
    ? buildConversationMemory(recentMessages, userMessage)
    : [{ role: "user" as const, content: userMessage }]

  try {
    console.log(`[SCR] calling LLM, msg: "${userMessage}", hasState: ${!!sessionState}, candidateCount: ${sessionState?.candidateCount ?? "null"}, historyTurns: ${llmMessages.length}`)

    const raw = await provider.complete(
      systemPrompt,
      llmMessages,
      2000,
      SINGLE_CALL_ROUTER_MODEL,
      "single-call-router"
    )

    console.log(`[SCR] raw response (first 500): ${raw?.substring(0, 500)}`)

    const parsed = extractJsonFromResponse(raw)
    if (!parsed) {
      console.warn("[SCR] Failed to parse JSON from LLM response, raw:", raw?.substring(0, 200))
      return { actions: [], answer: "", reasoning: "parse_failure" }
    }

    console.log(`[SCR] parsed raw: ${JSON.stringify(parsed).substring(0, 300)}`)

    const result = validateAndCleanResult(parsed)
    console.log(`[SCR] validated actions (pre-canonicalize): ${result.actions.map(a => `${a.type}(${a.field}=${a.value ?? a.to ?? ""})`).join(", ") || "EMPTY"}`)

    // Canonicalize ALL action values through filter-field-registry
    // This ensures Korean values from LLM (스퀘어→Square, 4날→4) are normalized
    const canonicalizedActions: SingleCallAction[] = []
    for (const action of result.actions) {
      if (action.type === "apply_filter" && action.field && action.value != null) {
        // For between, pass [lo, hi] as array so registry stores rawValue as array.
        const isBetween = action.op === "between" && action.value2 != null
        const inputValue: string | number | Array<string | number> = isBetween
          ? [action.value, action.value2 as string | number]
          : action.value
        const filter = buildAppliedFilterFromValue(action.field, inputValue, 0, action.op)
        if (filter) {
          canonicalizedActions.push({
            ...action,
            field: filter.field,
            value: Array.isArray(filter.rawValue) ? (filter.rawValue[0] as string | number) : (filter.rawValue as string | number),
            value2: Array.isArray(filter.rawValue) ? (filter.rawValue[1] as string | number) : action.value2,
            op: action.op,
          })
        } else {
          console.warn(`[single-call-router] canonicalize failed: field=${action.field} value=${action.value}, passing through with _canonFailed`)
          canonicalizedActions.push({ ...action, _canonFailed: true })
        }
      } else if (action.type === "replace_filter" && action.field && action.to != null) {
        const filter = buildAppliedFilterFromValue(action.field, action.to)
        if (filter) {
          canonicalizedActions.push({ ...action, field: filter.field, to: String(filter.rawValue) })
        } else {
          console.warn(`[single-call-router] canonicalize replace failed: field=${action.field} to=${action.to}, passing through with _canonFailed`)
          canonicalizedActions.push({ ...action, _canonFailed: true })
        }
      } else {
        // skip, reset, go_back, compare, answer, remove_filter, show_recommendation — pass through
        canonicalizedActions.push(action)
      }
    }

    console.log(`[single-call-router] ${canonicalizedActions.length} actions: ${canonicalizedActions.map(a => `${a.type}(${a.field ?? ""}=${a.value ?? a.to ?? ""})`).join(", ")}`)

    // Fallback: if actions empty but reasoning contains field=value patterns, re-extract
    if (canonicalizedActions.length === 0 && result.reasoning) {
      const rescued = rescueActionsFromReasoning(result.reasoning)
      if (rescued.length > 0) {
        console.log(`[SCR] Rescued ${rescued.length} actions from reasoning: ${rescued.map(a => `${a.type}(${a.field}=${a.value})`).join(", ")}`)
        return { actions: rescued, answer: result.answer, reasoning: `${result.reasoning} [rescued]` }
      }
    }

    return { actions: canonicalizedActions, answer: result.answer, reasoning: result.reasoning }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[SCR] ERROR: ${errMsg}`)
    return { actions: [], answer: "", reasoning: `llm_error:${errMsg.slice(0, 100)}` }
  }
}

/**
 * Rescue actions from SCR reasoning text when actions array is empty.
 * Dynamically extracts field=value patterns using registered filter fields.
 */
function rescueActionsFromReasoning(reasoning: string): SingleCallAction[] {
  const actions: SingleCallAction[] = []
  // Match patterns like "fieldName=value" or "fieldName: value" in reasoning
  const fieldNames = getRegisteredFilterFields()
  for (const field of fieldNames) {
    const patterns = [
      new RegExp(`${field}\\s*[=:]\\s*"?([^",\\s}]+)"?`, "i"),
      new RegExp(`${field}\\s*[=:]\\s*([0-9]+)`, "i"),
    ]
    for (const pattern of patterns) {
      const match = reasoning.match(pattern)
      if (match?.[1]) {
        const rawValue = match[1]
        const filter = buildAppliedFilterFromValue(field, rawValue)
        if (filter) {
          // Avoid duplicates
          if (!actions.some(a => a.field === filter.field)) {
            actions.push({
              type: "apply_filter",
              field: filter.field,
              value: filter.rawValue as string | number,
            })
          }
        }
      }
    }
  }
  return actions
}
