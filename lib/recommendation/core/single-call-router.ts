/**
 * Single-Call Router — routes user intent via ONE Haiku call
 * instead of multiple parallel Haiku calls.
 *
 * Feature-flagged behind USE_SINGLE_CALL_ROUTER.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { LLMMessage } from "@/lib/llm/provider"
import type { ExplorationSessionState, ChatMessage } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"
import { buildCanonicalDomainKnowledgeSnippet } from "@/lib/recommendation/shared/canonical-values"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"
import { QUERY_FIELD_MANIFEST, buildManifestPromptSection } from "@/lib/recommendation/core/query-spec-manifest"
import { selectFewShots, buildFewShotTextScr } from "@/lib/recommendation/core/adaptive-few-shot"
import {
  SEMANTIC_INTERPRETATION_POLICY_PROMPT,
  shouldDeferHardcodedSemanticExecution,
} from "@/lib/recommendation/core/semantic-execution-policy"
import { needsRepair } from "@/lib/recommendation/core/turn-repair"
import { PHANTOM_GUARDED_FIELDS, isGroundedCategoricalValue } from "@/lib/recommendation/core/deterministic-scr"

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
  op?: "eq" | "neq" | "in" | "range" | "gte" | "lte" | "between" | "includes" | "exists"
  targets?: string[]
  message?: string
  /** Set when canonicalization failed — runtime should fall back to legacy */
  _canonFailed?: boolean
}

export interface SingleCallResult {
  actions: SingleCallAction[]
  answer: string
  reasoning: string
  /**
   * Set when the deterministic SCR detects an unqualified token that maps to
   * multiple registry fields (MV reverse-index ambiguity). Runtime returns
   * this as a clarification question instead of guessing a slot.
   */
  clarification?: {
    question: string
    chips: string[]
    /** chip label → registry field id for round-trip resolution by callers */
    chipFieldMap: Record<string, string>
  }
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

const VALID_OPS = new Set(["eq", "neq", "in", "range", "gte", "lte", "between", "exists"])

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
    // CRITICAL: These are filters ALREADY captured from previous turns.
    // They are NOT in the current user message. Do NOT re-emit them.
    // The current message may add, remove, or replace them — but default to ADD.
    parts.push("### Previously Applied Filters (immutable context — do NOT re-emit)")
    for (const f of filters) {
      parts.push(`  - ${f.field}=${f.value} (${f.op})`)
    }
    parts.push("### End Previously Applied Filters")
  } else {
    parts.push("No filters applied yet.")
  }
  parts.push(`Candidate count: ${state.candidateCount ?? 0}`)
  parts.push(`Domain: ${state.resolvedInput?.toolType ?? state.resolvedInput?.machiningCategory ?? "unknown"}`)
  if (state.lastAskedField) parts.push(`Last asked field: ${state.lastAskedField}`)
  if (state.currentMode) parts.push(`Mode: ${state.currentMode}`)
  if (state.displayedChips?.length) parts.push(`Displayed chips: ${state.displayedChips.join(", ")}`)
  if (state.displayedOptions?.length) {
    parts.push(`Displayed options: ${state.displayedOptions.slice(0, 6).map(option => `${option.label}=>${option.field}=${option.value}`).join(" | ")}`)
  }
  if (state.displayedCandidates?.length) {
    parts.push(`Displayed candidates: ${state.displayedCandidates.slice(0, 4).map(candidate => candidate.displayCode ?? candidate.productCode).join(", ")}`)
  }
  if (state.displayedProducts?.length) {
    parts.push(`Displayed products: ${state.displayedProducts.slice(0, 4).map(product => product.displayCode ?? product.productCode).join(", ")}`)
  }
  if (state.displayedSeriesGroups?.length) {
    parts.push(`Displayed series groups: ${state.displayedSeriesGroups.slice(0, 4).map(group => group.seriesName ?? group.seriesKey).join(", ")}`)
  }
  if (state.lastRecommendationArtifact?.length) {
    parts.push(`Last recommendation artifact: ${state.lastRecommendationArtifact.slice(0, 4).map(candidate => candidate.displayCode ?? candidate.productCode).join(", ")}`)
  }
  if (state.lastComparisonArtifact?.comparedProductCodes?.length) {
    parts.push(`Last comparison artifact: ${state.lastComparisonArtifact.comparedProductCodes.join(", ")}`)
  }
  if (state.uiNarrowingPath?.length) {
    parts.push(`UI path: ${state.uiNarrowingPath.slice(-4).map(entry => `${entry.kind}:${entry.label}`).join(" | ")}`)
  }
  if (state.narrowingHistory?.length) {
    parts.push(`Narrowing history: ${state.narrowingHistory.slice(-3).map(turn => `${turn.askedField ?? "unknown"}=>${turn.answer ?? ""}`).join(" | ")}`)
  }
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

/** Comma-separated list of numeric field names derived from QUERY_FIELD_MANIFEST. */
function buildNumericFieldWhitelist(): string {
  return QUERY_FIELD_MANIFEST
    .filter(e => e.valueType === "number")
    .map(e => e.field)
    .join(", ")
}

/** Core anchor examples showing the action vocabulary (routing, not field knowledge). */
const SCR_ANCHOR_EXAMPLES = `User: "Square 빼고" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"remove_filter","field":"toolSubtype"}],"answer":"","reasoning":"remove existing Square filter"}

User: "4날로 바꿔줘" (when fluteCount=6 filter exists)
→ {"actions":[{"type":"replace_filter","field":"fluteCount","from":"6","to":4}],"answer":"","reasoning":"replace flute count"}

User: "TiAlN이 뭐야?"
→ {"actions":[],"answer":"TiAlN은 Ti+Al+N 내열성 코팅으로, 800~900°C까지 버팁니다. 범용 강재·주철·스테인리스 중속 가공에 두루 쓰입니다.","reasoning":"pure term question, no filter change"}

User: "헬릭스가 뭐야?"
→ {"actions":[],"answer":"헬릭스는 엔드밀 날의 비틀림 각도입니다. 30°는 범용, 45°~50°는 고속 마감, 스테인리스처럼 질긴 소재는 38°~45°가 무난합니다.","reasoning":"pure term question"}

User: "공구 수명이 너무 짧아"
→ {"actions":[],"answer":"수명 단축의 3대 원인: ① 절삭속도 과대(스테인리스 Vc 80~120 적정) ② 코팅 부적합(SUS엔 AlCrN/Y-Coating) ③ 업밀링으로 인한 가공경화. 소재와 현재 조건 알려주시면 구체 진단 드리겠습니다.","reasoning":"troubleshooting question, no filter change"}

User: "AlCrN이랑 TiAlN 뭐가 나아? 스테인리스인데"
→ {"actions":[],"answer":"스테인리스엔 AlCrN(Y-Coating)이 우세합니다. AlCrN 내산화 ~1100°C vs TiAlN ~900°C — 스테인리스 절삭열 600~800°C에서 AlCrN이 산화 마모를 훨씬 버텨 수명 1.5~2배 차이가 납니다.","reasoning":"comparison question — answer directly, DO NOT emit TiAlN/Stainless as filters"}

User: "상관없음" / "아무거나 괜찮아"
→ {"actions":[{"type":"skip"}],"answer":"","reasoning":"user skips current question"}

User: "추천 제품 보기" / "지금 바로 제품 보기"
→ {"actions":[{"type":"show_recommendation"}],"answer":"","reasoning":"user wants results"}

User: "GMG55100과 GMG40100 비교해줘"
→ {"actions":[{"type":"compare","targets":["GMG55100","GMG40100"]}],"answer":"","reasoning":"compare two products"}

User: "직경 작은 순으로 보여줘"
→ {"actions":[{"type":"show_recommendation","sort":{"field":"diameterMm","direction":"asc"}}],"answer":"","reasoning":"sort ascending by diameter"}

User: "직경 10mm 근처로"
→ {"actions":[{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq","tolerance":1.0}],"answer":"","reasoning":"tolerance-based fuzzy match around the specified diameter"}

User: "3날 이상" (no existing fluteCount filter)
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":3,"op":"gte"}],"answer":"","reasoning":"gte from 이상"}

User: "Square 아닌거로" (no existing toolSubtype filter)
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"neq"}],"answer":"","reasoning":"neq from 아닌"}

User: "날수 3날 이상이랑 형상 Square 아닌거로"
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":3,"op":"gte"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"neq"}],"answer":"","reasoning":"compound: gte flute + neq subtype"}

User: "전장 100mm 넘는거"
→ {"actions":[{"type":"apply_filter","field":"overallLengthMm","value":100,"op":"gte"}],"answer":"","reasoning":"gte from 넘는 on overall length"}

User: "이 제품이랑 비슷한 스펙"  (when a product is currently displayed)
→ {"actions":[{"type":"show_recommendation","similarTo":{"referenceProductId":"__current__","topK":10}}],"answer":"","reasoning":"similarity query against current product"}`

function buildSystemPromptFull(): string {
  return `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
Given the user's Korean message and the current session state, determine what actions to take.

## Available Actions (return as JSON array)
- apply_filter: Add a new filter. Requires field, value, op.
  Ops: eq (default, exact match), neq (exclude), gte (≥), lte (≤), between (range, requires value2 as upper bound).
  Range cues in Korean → use gte/lte/between, NOT eq:
    - "이상", "넘는", "초과", "그 이상" → op:"gte"
    - "이하", "미만", "넘지 않는" → op:"lte"
    - "A에서 B 사이", "A~B", "A에서 B까지" → op:"between" with value=A, value2=B
  Range ops apply ONLY to numeric fields: ${buildNumericFieldWhitelist()}.
- remove_filter: Remove an existing filter. Requires field.
- replace_filter: Change an existing filter value. Requires field, from, to.
- show_recommendation: User wants to see results now.
- compare: User wants to compare specific products. Requires targets (product name array).
- answer: User asked a general question (no filter change). Set message with the question.
- skip: User wants to skip the current question ("상관없음", "아무거나", "패스"). Optionally set field.
- reset: User wants to start over.
- go_back: User wants to undo the last step.

## CRITICAL: Immutable context vs current message
Session State lists "Previously Applied Filters" — these were captured in earlier turns.
They are NOT part of the current user message. Treat them as immutable context ONLY.

Decision rules (apply in order):
1. Extract filters ONLY from the CURRENT user message (the last user turn).
2. If the message mentions a NEW field not in Previously Applied → emit apply_filter.
3. If the message explicitly says to drop/exclude an already-applied value → emit remove_filter.
4. If the message gives a new value for an already-applied field → emit replace_filter.
5. If the message restates an already-applied value with no change intent → skip it (no action).
6. NEVER ask "should I modify the existing filter or start over?" when the message clearly
   adds new filter fields that don't conflict with existing ones. Just add them.
7. Presence of previously-applied filters MUST NOT make you more conservative.
   A message like "날은 Square고 직경은 10, 날장 20이상" is 3 new apply_filter actions
   regardless of whether workPieceName/machiningCategory were already applied.

## Semantic policy
${SEMANTIC_INTERPRETATION_POLICY_PROMPT}

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

## Intent decision (tone + context first, keywords are hints)
- Directive tone + new condition → apply_filter. Use op:"neq" when the user is excluding; op:"gte"/"lte"/"between" when the user expresses a range.
- Directive tone + same value already filtered → remove_filter. Directive tone + swap one value for another → replace_filter.
- Passive tone (skip/defer/delegate the current field) → skip.
- Question tone / exploration / troubleshooting → action "answer" only; do not extract filters from question context. Write a 2–4 sentence 영업엔지니어 응답 with concrete numbers when useful, ending with a soft next-step question.
- Directive "show me results now" with no new condition → show_recommendation.
- Multiple distinct directive conditions in one message → multiple actions.
Vague descriptors ("다양한/범용/괜찮은 것" 류) are not filter signals — return empty actions.
Intake-form values are load-bearing; only remove them when the user explicitly names the value to drop.

## CRITICAL: Field value rules
- toolSubtype values MUST be English only: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
  NEVER return Korean (스퀘어, 볼, 라디우스, 황삭). Always use English canonical names.
- fluteCount values MUST be numbers only: 2, 3, 4, 5, 6
  NEVER return "2날" or "4날". Just the number.
- coating values: TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated
- diameterMm values: numbers only (e.g., 10, 8, 6.35)

## Available filter fields (source: query-spec-manifest)
${buildManifestPromptSection()}

Additional runtime-only fields (not in manifest, still valid):
- stockStatus: in-stock filter. Triggers: "재고 있는 거", "재고만", "납기 빠른". Use value:"instock" op:"eq".

## Examples (anchor + adaptive)
${SCR_ANCHOR_EXAMPLES}

{{ADAPTIVE_FEWSHOT}}

User: "4날 TiAlN Square 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"3 filters from single message"}

## Response Format (strict JSON only, no markdown, no code blocks)
{
  "actions": [ { "type": "...", ... } ],
  "answer": "",
  "reasoning": "brief explanation"
}

===DYNAMIC===

## Session State
{{SESSION_STATE}}

## Known DB Values (use ONLY these exact values for brand/country/workpiece)
{{DB_VALUES}}`
}

function buildSystemPromptFree(): string {
  return `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
The user speaks Korean. Analyze the message and session state to determine actions.

## Available Actions (JSON array)
- apply_filter: {type, field, value, op}. Valid fields (source: query-spec-manifest):
${buildManifestPromptSection()}
  Numeric fields (gte/lte/between allowed): ${buildNumericFieldWhitelist()}.
  Runtime-only extras: stockStatus("instock", "재고"/"납기").
- remove_filter: {type, field} — "빼고/제외" + existing filter → remove
- replace_filter: {type, field, from, to} — "바꿔/변경" → replace value
- show_recommendation: {type} — "추천해줘/보여줘/제품 보기"
- compare: {type, targets} — product comparison
- answer: {type, message} — general question, NO filter change
- skip: {type, field?} — "상관없음/아무거나/패스/알아서"
- reset/go_back: {type}

## Output contract
- toolSubtype values: Square | Ball | Radius | Roughing | Taper | Chamfer | High-Feed (English canonical only).
- fluteCount / diameterMm values: numbers only, no units or "날" suffix.
- Do not re-apply a filter that is already present in session state.
- Decide actions from tone and full context, not from isolated cue words. Questions (exploratory tone) stay as "answer"; directive conditions turn into filter actions even when the user also says "추천해줘".

## CRITICAL: Immutable context vs current message
"Previously Applied Filters" in Session State = captured in earlier turns, NOT in this message.
Extract filter actions ONLY from the CURRENT user message. Rules:
1. New field mentioned in message + not in Previously Applied → apply_filter.
2. Message explicitly drops an applied value → remove_filter.
3. Message gives a new value for an applied field → replace_filter.
4. Message restates an applied value with no change intent → skip (no action).
5. Message adds new fields that don't conflict with existing filters → just add them.
   Do NOT ask "수정할까요 vs 새로 시작할까요?" in this case — the answer is always "add".
6. Presence of Previously Applied Filters MUST NOT make you more conservative or
   trigger clarification. A directive multi-filter message stays a multi-filter message.

## Conversation Memory
You receive recent conversation history. Use it for references like "아까 그거", "이전에 말한 조건", "그 코팅으로".

## Smart Behavior (CRITICAL — write the "answer" field to look brilliant)
You are not just a router — you are a senior application engineer at YG-1 (40+ years of cutting tool expertise). Every "answer" string you write must read like a knowledgeable expert speaking to a customer. Make the user think "this assistant really understands cutting tools."

When you emit an "answer" action OR set the top-level "answer" field alongside other actions, follow these rules:

(A) NEVER ask a generic question. Generic = "어떤 소재를 가공하시나요?" Smart = explain WHY you need it + offer 2-3 concrete branches the user can pick from.
   ❌ "직경이 어떻게 되나요?"
   ✅ "직경에 따라 코팅·날수·생크 형식이 크게 달라집니다. 보통 6mm/8mm/10mm가 가장 흔한데, 어느 쪽이세요? 아니면 mm로 직접 알려주세요."

(B) When the user gives partial info, ACKNOWLEDGE what they said + name the next decision branch + suggest the most common 2-3 options with brief reason for each.
   user: "스테인리스 측면가공"
   ❌ "더 정보가 필요합니다."
   ✅ "스테인리스(M계열) 측면가공이라면 내열·내마모성이 핵심이에요. 직경부터 좁혀볼까요? 일반적으로 ① 6mm 4날 (좁은 측벽) ② 10mm 4날 (표준 측면) ③ 12mm 5날 (대형/거친 가공) 중 한 분이 가장 많으세요."

(C) When the user asks a domain question (TiAlN이 뭐야? / DLC 차이? / 측면가공 vs 슬롯), give a 2-3 sentence expert answer with concrete recommendation hint.
   ❌ "TiAlN은 코팅의 한 종류입니다."
   ✅ "TiAlN(티타늄알루미늄나이트라이드)은 800°C 이상 고온에서도 경도를 유지하는 범용 1순위 코팅이에요. 강·스테인리스·주철에 두루 강하지만, 알루미늄에서는 응착 때문에 DLC나 무코팅이 더 좋습니다."

(D) When recommending (show_recommendation), the "answer" should briefly state WHY you chose to push to recommendation now (e.g., "조건이 명확해서 바로 후보를 보여드릴게요").

(E) Tone: Korean honorific (~요/입니다), confident but not arrogant. Use cutting tool jargon naturally — 피삭재, 측면가공, 헬릭스, 절삭조건 — but explain when the user seems unfamiliar.

(F) Length: 1-3 short sentences for questions, 2-4 sentences for domain answers. Never one-liner.

(G) NEVER fabricate product names. Reference series/brand names only if they appear in DB Values or session state.

## Key Examples (anchor + adaptive)
${SCR_ANCHOR_EXAMPLES}

{{ADAPTIVE_FEWSHOT}}

${buildCanonicalDomainKnowledgeSnippet()}

Response: strict JSON {"actions": [...], "answer": "", "reasoning": "brief"}

===DYNAMIC===

## Session State
{{SESSION_STATE}}

## Known DB Values (use ONLY these exact values for brand/country/workpiece)
{{DB_VALUES}}`
}

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

function buildSystemPrompt(state: ExplorationSessionState | null, userMessage = ""): string {
  const template = LLM_FREE_INTERPRETATION ? buildSystemPromptFree() : buildSystemPromptFull()
  const adaptive = userMessage ? buildFewShotTextScr(selectFewShots(userMessage, 10)) : ""
  return template
    .replace("{{SESSION_STATE}}", buildSessionSummary(state))
    .replace("{{DB_VALUES}}", buildDbValuesSnippet())
    .replace("{{ADAPTIVE_FEWSHOT}}", adaptive)
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

// Hybrid: deterministic parser first, LLM fallback for unmatched
import {
  buildDeterministicSemanticHints,
  parseDeterministic,
  type DeterministicMeta,
  type MvAmbiguity,
} from "./deterministic-scr"
import { getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"

/**
 * Build a Korean clarification question for an ambiguous token.
 * Uses registry labels when available, falls back to the field id.
 */
function buildAmbiguityClarification(amb: MvAmbiguity): string {
  const labels = amb.fields.map(f => {
    const def = getFilterFieldDefinition(f)
    return def?.label ?? f
  })
  return `'${amb.token}'은(는) ${labels.join(" / ")} 중 어디에 적용할까요?`
}

/**
 * Build chip labels + chip→field map for an ambiguous token. Chip text is
 * a natural Korean phrasing combining the registry label and the original
 * token, so when the user clicks it the resulting message can be re-parsed
 * (or directly resolved via chipFieldMap by the runtime).
 */
function buildClarificationFromMeta(meta: DeterministicMeta): SingleCallResult["clarification"] | null {
  if (meta.ambiguities.length === 0) return null
  const question = meta.ambiguities.map(buildAmbiguityClarification).join("\n")
  const allChips: string[] = []
  const chipFieldMap: Record<string, string> = {}
  for (const amb of meta.ambiguities) {
    const built = buildAmbiguityChips(amb)
    for (const c of built.chips) {
      allChips.push(c)
      chipFieldMap[c] = built.chipFieldMap[c]
    }
  }
  return { question, chips: allChips, chipFieldMap }
}

function buildAmbiguityChips(amb: MvAmbiguity): { chips: string[]; chipFieldMap: Record<string, string> } {
  const chips: string[] = []
  const chipFieldMap: Record<string, string> = {}
  for (const f of amb.fields) {
    const def = getFilterFieldDefinition(f)
    const label = def?.label ?? f
    const chip = `${label}로 적용 (${amb.token})`
    chips.push(chip)
    chipFieldMap[chip] = f
  }
  return { chips, chipFieldMap }
}

function formatDeterministicCandidateHints(actions: SingleCallAction[]): string {
  if (actions.length === 0) return "none"
  return actions
    .filter(action => action.type === "apply_filter" && action.field && action.value != null)
    .map(action => {
      const upper = action.op === "between" && action.value2 != null
        ? `${String(action.value)}..${String(action.value2)}`
        : String(action.value)
      return `- ${action.field} ${action.op ?? "eq"} ${upper}`
    })
    .join("\n")
}

function formatDeterministicSemanticHints(
  hints: ReturnType<typeof buildDeterministicSemanticHints>,
): string {
  return hints.length > 0 ? JSON.stringify(hints) : "none"
}

function formatDeterministicAmbiguities(meta: DeterministicMeta): string {
  if (meta.ambiguities.length === 0) return "none"
  return meta.ambiguities
    .map(amb => `- token "${amb.token}" may belong to: ${amb.fields.join(", ")}`)
    .join("\n")
}

const DET_SCR_ENABLED = process.env.DETERMINISTIC_SCR !== "0"

type SingleCallTurnMode = "new" | "refine" | "repair" | "explain"

function hasSingleCallExplainCue(message: string): boolean {
  return /[?？]/u.test(message)
    || /(?:뭐야|설명|차이|어떻게|왜|비교|meaning|difference|what\s+is|how\s+to|why)/iu.test(message)
}

function classifySingleCallTurnMode(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
): SingleCallTurnMode {
  if (needsRepair(userMessage)) return "repair"
  if (hasSingleCallExplainCue(userMessage)) return "explain"
  return sessionState ? "refine" : "new"
}

export async function routeSingleCall(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider,
  recentMessages?: ChatMessage[],
  kgHint?: string
): Promise<SingleCallResult> {
  let detMeta: DeterministicMeta | null = null
  let detHintActions: SingleCallAction[] = []
  let detSemanticHints: ReturnType<typeof buildDeterministicSemanticHints> = []
  const shouldDeferDeterministicHints = shouldDeferHardcodedSemanticExecution(userMessage)

  // ── 0. Deterministic SCR (DB-driven NL parser, no LLM) ──
  if (DET_SCR_ENABLED && !shouldDeferDeterministicHints) {
    detMeta = { ambiguities: [] }
    // Stateless-replay support: when the caller has no session yet (e.g. each
    // API call is independent as in the evaluation harness) prior user turns'
    // filters get lost because the deterministic parser only sees the latest
    // message. Join all prior user turns into a single parse so every slot
    // mentioned across the conversation is recovered. Skip when a revision
    // keyword is present — those turns must replace, not accumulate.
    const REVISION_RE = /(아니|말고|바꿔|대신|빼|제외|취소|없는\s*걸로)/
    const hasRevision = REVISION_RE.test(userMessage)
    // After a reset turn ("처음부터 다시", "리셋", "초기화"), only parse messages AFTER the reset
    const RESET_RE = /처음부터|초기화|리셋|다시\s*시작|reset|start\s*over/i
    let filteredMessages = recentMessages
    if (!sessionState && !hasRevision && recentMessages && recentMessages.length > 1) {
      const lastResetIdx = recentMessages.map((m, i) => m.role === "user" && RESET_RE.test(m.text) ? i : -1)
        .filter(i => i >= 0).pop()
      if (lastResetIdx !== undefined && lastResetIdx >= 0) {
        filteredMessages = recentMessages.slice(lastResetIdx + 1)
      }
    }
    const parseText = (!sessionState && !hasRevision && filteredMessages && filteredMessages.length > 1)
      ? filteredMessages.filter(m => m.role === "user").map(m => m.text).join(" ")
      : userMessage
    const detActions = parseDeterministic(parseText, detMeta)
    detSemanticHints = buildDeterministicSemanticHints(detActions)
    if (detMeta.ambiguities.length > 0) {
      console.log(`[SCR:det] ${detMeta.ambiguities.length} ambiguities detected: ${detMeta.ambiguities.map(a => `${a.token}→[${a.fields.join("|")}]`).join(", ")}`)
    }
    if (detActions.length > 0) {
      console.log(`[SCR:det] ${detActions.length} actions extracted deterministically: ${detActions.map(a => `${a.field}=${a.value}${a.value2 != null ? '..' + a.value2 : ''}/${a.op}`).join(", ")}`)
      // Canonicalize via filter-field-registry (same path as LLM actions)
      const canonicalized: SingleCallAction[] = []
      for (const action of detActions) {
        const isBetween = action.op === "between" && action.value2 != null
        const inputValue: string | number | Array<string | number> = isBetween
          ? [action.value as string | number, action.value2 as string | number]
          : action.value
        const filter = buildAppliedFilterFromValue(action.field, inputValue, 0, action.op)
        if (filter) {
          canonicalized.push({
            type: "apply_filter",
            field: filter.field,
            value: Array.isArray(filter.rawValue) ? (filter.rawValue[0] as string | number) : (filter.rawValue as string | number),
            value2: Array.isArray(filter.rawValue) ? (filter.rawValue[1] as string | number) : action.value2,
            op: action.op,
          })
        }
      }
      detHintActions = canonicalized
    } else if (detMeta.ambiguities.length > 0) {
      // 결정론적 액션이 하나도 없지만 모호 토큰이 있는 경우 — 질문만 던진다.
      const clarification = buildClarificationFromMeta(detMeta)!
      return {
        actions: [],
        answer: clarification.question,
        reasoning: `deterministic: 0 actions + ${detMeta.ambiguities.length} clarification(s)`,
        clarification,
      }
    }
  }

  const basePrompt = buildSystemPrompt(sessionState, userMessage)
  const promptSections = [basePrompt]
  promptSections.push(
    `## Turn Mode Hint\ncandidateMode=${classifySingleCallTurnMode(userMessage, sessionState)}\nInterpret the full utterance against current session truth before executing any filter delta.`,
  )
  if (kgHint) {
    promptSections.push(`## KG Hint (pre-analyzed entities from Knowledge Graph)\n${kgHint}\nUse these as strong guidance — the entities above are already validated. Emit matching apply_filter actions.`)
  }
  if (detHintActions.length > 0) {
    promptSections.push(
      `## Deterministic Candidate Hints (non-authoritative)\n${formatDeterministicCandidateHints(detHintActions)}\nThese are hardcoded stage-1 hints only. Do not copy them blindly. Interpret the full utterance and session state first, then emit only the actions that remain valid. If the message contains broad semantic cues such as negation, alternatives, comparison, or revision language, do not treat these hints as final truth by themselves.`,
    )
  }
  if (detSemanticHints.length > 0) {
    promptSections.push(
      `## Semantic Hints (deterministic, non-authoritative)\n${formatDeterministicSemanticHints(detSemanticHints)}\nEach hint is advisory only. Validate fieldCandidate/valueCandidate/operatorCue/numericCue/domainCue against the current state, applied filters, UI context, and history before emitting actions.`,
    )
  }
  if (detMeta && detMeta.ambiguities.length > 0) {
    promptSections.push(
      `## Deterministic Ambiguity Alerts\n${formatDeterministicAmbiguities(detMeta)}\nIf the ambiguity blocks safe execution, ask a clarification instead of guessing.`,
    )
  }
  const systemPrompt = promptSections.join("\n\n")
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

    // Phantom guard: drop apply/replace actions on proper-noun fields whose
    // canonical value isn't grounded in the user message. Mirrors the guard in
    // deterministic-scr / semantic-turn-extractor so the LLM can't inject
    // category values it inferred from world knowledge (e.g. aerospace → Titanium).
    const guardedActions = canonicalizedActions.filter(a => {
      const field = a.field
      if (!field || !PHANTOM_GUARDED_FIELDS.has(field)) return true
      if (a.type !== "apply_filter" && a.type !== "replace_filter") return true
      const checked = a.type === "replace_filter"
        ? String(a.to ?? "")
        : String(a.value ?? "")
      if (!checked) return true
      if (isGroundedCategoricalValue(field, checked, userMessage)) return true
      console.warn(`[SCR] phantom ${field} filter dropped: "${checked}" not grounded in "${userMessage.slice(0, 80)}"`)
      return false
    })

    console.log(`[single-call-router] ${guardedActions.length} actions: ${guardedActions.map(a => `${a.type}(${a.field ?? ""}=${a.value ?? a.to ?? ""})`).join(", ")}`)

    // Fallback: if actions empty but reasoning contains field=value patterns, re-extract
    if (guardedActions.length === 0 && result.reasoning) {
      const rescued = rescueActionsFromReasoning(result.reasoning)
      if (rescued.length > 0) {
        console.log(`[SCR] Rescued ${rescued.length} actions from reasoning: ${rescued.map(a => `${a.type}(${a.field}=${a.value})`).join(", ")}`)
        return { actions: rescued, answer: result.answer, reasoning: `${result.reasoning} [rescued]` }
      }
    }

    return { actions: guardedActions, answer: result.answer, reasoning: result.reasoning }
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
